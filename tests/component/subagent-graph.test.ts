import {expect, test} from 'bun:test';
import {
  applyUpstream,
  GraphValidationError,
  runWaveScheduler,
  resolveNeeds,
  SchedulerTaskFailure,
  type SchedulerTaskOutcome,
} from '../../src/subagent/graph';

test('chain dependencies use stable implicit task ids', () => {
  expect(resolveNeeds([{id: 'first'}, {}, {id: 'last'}], 'chain')).toEqual([
    [],
    ['first'],
    ['task_2'],
  ]);
});

test('graph validation rejects malformed dependencies before execution', async () => {
  const invalidGraphs = [
    {
      inputs: [{id: 'same'}, {id: 'same'}],
      message: 'Duplicate task id: same',
    },
    {
      inputs: [{id: 'reader', needs: ['missing']}],
      message: 'needs unknown task id: missing',
    },
    {
      inputs: [{id: 'self', needs: ['self']}],
      message: 'cannot need itself',
    },
    {
      inputs: [
        {id: 'first', needs: ['second']},
        {id: 'second', needs: ['first']},
      ],
      message: 'Cycle in subagent needs',
    },
  ] as const;

  for (const graph of invalidGraphs) {
    expect(() => resolveNeeds(graph.inputs, 'parallel')).toThrow(graph.message);
  }

  let calls = 0;
  await expect(
    runWaveScheduler(
      [{id: 'first', needs: ['missing']}],
      1,
      new Map<string, string>(),
      new Set<string>(),
      async () => {
        calls++;
        return {status: 'completed', output: 'unexpected'};
      },
    ),
  ).rejects.toBeInstanceOf(GraphValidationError);
  expect(calls).toBe(0);
});

test('upstream output blocks are named and {previous} uses the first need', () => {
  const outputs = new Map([
    ['first', 'first report'],
    ['second', 'second report'],
  ]);
  expect(applyUpstream('Review {previous}', ['first', 'second'], outputs)).toBe(
    '## Output of first\n' +
      'first report\n\n' +
      '## Output of second\n' +
      'second report\n\n' +
      '---\n\n' +
      'Review first report',
  );
  expect(applyUpstream('Review {previous}', [], outputs)).toContain(
    '(Note: {previous} was empty',
  );
});

test('scheduler keeps a ready wave together before starting dependents', async () => {
  const tasks = [
    {id: 'alpha', needs: []},
    {id: 'beta', needs: []},
    {id: 'review', needs: ['alpha']},
  ];
  const events: string[] = [];
  const releases = new Map<string, () => void>();
  let resolveFirstWave: (() => void) | undefined;
  const firstWaveStarted = new Promise<void>(resolve => {
    resolveFirstWave = resolve;
  });

  const execution = runWaveScheduler(
    tasks,
    2,
    new Map<string, string>(),
    new Set<string>(),
    task =>
      new Promise<SchedulerTaskOutcome>(resolve => {
        events.push(`start:${task.id}`);
        if (task.id === 'review') {
          events.push('done:review');
          resolve({status: 'completed', output: task.id});
          return;
        }
        releases.set(task.id, () => {
          events.push(`done:${task.id}`);
          resolve({status: 'completed', output: task.id});
        });
        if (releases.has('alpha') && releases.has('beta')) {
          resolveFirstWave?.();
        }
      }),
  );

  const started = await Promise.race([
    firstWaveStarted.then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100)),
  ]);
  expect(started).toBe(true);
  expect(events).toEqual(['start:alpha', 'start:beta']);

  releases.get('alpha')?.();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(events).toEqual(['start:alpha', 'start:beta', 'done:alpha']);

  releases.get('beta')?.();
  const result = await execution;

  expect(events).toEqual([
    'start:alpha',
    'start:beta',
    'done:alpha',
    'done:beta',
    'start:review',
    'done:review',
  ]);
  expect(result.outcomes).toEqual([
    {id: 'alpha', status: 'completed', output: 'alpha'},
    {id: 'beta', status: 'completed', output: 'beta'},
    {id: 'review', status: 'completed', output: 'review'},
  ]);
});

test('failed prerequisites skip transitive dependents while siblings continue', async () => {
  const tasks = [
    {id: 'failed'},
    {id: 'independent'},
    {id: 'child', needs: ['failed']},
    {id: 'grandchild', needs: ['child']},
  ];
  const calls: string[] = [];
  const outputs = new Map<string, string>();
  const settled = new Set<string>();
  const result = await runWaveScheduler(
    tasks,
    2,
    outputs,
    settled,
    async task => {
      calls.push(task.id);
      if (task.id === 'failed') {
        return {
          status: 'failed',
          failure: new SchedulerTaskFailure({
            taskId: task.id,
            message: 'fixture failure',
          }),
        };
      }
      return {status: 'completed', output: `${task.id} report`};
    },
  );

  expect(calls).toEqual(['failed', 'independent']);
  expect(result.skipped).toEqual([
    {id: 'child', needs: ['failed']},
    {id: 'grandchild', needs: ['child']},
  ]);
  expect(result.outcomes.map(outcome => outcome.id)).toEqual([
    'failed',
    'independent',
  ]);
  expect(outputs).toEqual(new Map([['independent', 'independent report']]));
  expect(settled).toEqual(
    new Set(['failed', 'independent', 'child', 'grandchild']),
  );
});

test('runner exceptions become typed failures without stopping the wave', async () => {
  const result = await runWaveScheduler(
    [{id: 'bad'}, {id: 'good'}],
    2,
    new Map<string, string>(),
    new Set<string>(),
    async task => {
      if (task.id === 'bad') throw new Error('fixture runner failure');
      return {status: 'completed', output: 'good report'};
    },
  );

  const bad = result.outcomes.find(outcome => outcome.id === 'bad');
  expect(bad?.status).toBe('failed');
  if (bad?.status === 'failed') {
    expect(bad.failure).toBeInstanceOf(SchedulerTaskFailure);
    expect(bad.failure.message).toBe('fixture runner failure');
  }
  expect(result.outcomes.find(outcome => outcome.id === 'good')).toEqual({
    id: 'good',
    status: 'completed',
    output: 'good report',
  });
});

test('concurrency bounds each ready wave', async () => {
  let active = 0;
  let maximum = 0;
  const result = await runWaveScheduler(
    [{id: 'one'}, {id: 'two'}, {id: 'three'}],
    2,
    new Map<string, string>(),
    new Set<string>(),
    async task => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      active--;
      return {status: 'completed', output: task.id};
    },
  );

  expect(maximum).toBe(2);
  expect(result.outcomes).toHaveLength(3);
});

test('observes runnable waves and clears after each wave', async () => {
  const waveEvents: string[][] = [];
  let active = 0;
  let maximum = 0;
  const result = await runWaveScheduler(
    [
      {id: 'first'},
      {id: 'second'},
      {id: 'third'},
      {id: 'review', needs: ['first']},
    ],
    2,
    new Map<string, string>(),
    new Set<string>(),
    async task => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      active--;
      return {status: 'completed', output: `${task.id} output`};
    },
    ids => waveEvents.push([...ids]),
  );

  expect(waveEvents).toEqual([
    ['first', 'second', 'third'],
    [],
    ['review'],
    [],
  ]);
  expect(maximum).toBe(2);
  expect(result.outcomes.map(outcome => outcome.id)).toEqual([
    'first',
    'second',
    'third',
    'review',
  ]);
});
