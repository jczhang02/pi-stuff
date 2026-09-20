import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const Admission = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('accepted'),
    dispatchId: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);

const Snapshot = Schema.fromJsonString(
  Schema.Struct({
    agents: Schema.Array(
      Schema.Struct({id: Schema.String, held: Schema.Boolean}),
    ),
    dispatches: Schema.Array(
      Schema.Struct({id: Schema.String, admitted: Schema.Number}),
    ),
    tasks: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        agentId: Schema.String,
        prompt: Schema.String,
        phase: Schema.String,
        outcome: Schema.NullOr(Schema.String),
      }),
    ),
  }),
);

type RecoveryHost = Awaited<ReturnType<typeof launchPi>>;
type SnapshotValue = typeof Snapshot.Type;
type Outcome = 'fulfilled' | 'unable';

function latestMarker(
  request: ModelRequest,
  markers: readonly string[],
): string | undefined {
  const users = request.messages
    .filter(message => message.role === 'user')
    .map(message => JSON.stringify(message.content ?? ''))
    .join('\n');
  return markers
    .map(marker => ({marker, position: users.lastIndexOf(marker)}))
    .filter(candidate => candidate.position >= 0)
    .toSorted((left, right) => right.position - left.position)[0]?.marker;
}

function finish(outcome: Outcome, text: string): FixtureReply {
  return {
    tool: 'subagent',
    arguments: JSON.stringify({command: 'finish', outcome, text}),
  };
}

async function inspect(host: RecoveryHost): Promise<SnapshotValue> {
  return Schema.decodeUnknownSync(Snapshot)(
    await host.invoke('subagent', '{"command":"inspect"}'),
  );
}

async function waitForState(
  host: RecoveryHost,
  predicate: (snapshot: SnapshotValue) => boolean,
): Promise<SnapshotValue> {
  let latest: SnapshotValue | undefined;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    latest = await inspect(host);
    if (predicate(latest)) return latest;
    await Bun.sleep(40);
  }
  throw new Error(`Recovery state did not settle: ${JSON.stringify(latest)}`);
}

async function admit(
  host: RecoveryHost,
  input: string,
): Promise<typeof Admission.Type> {
  return Schema.decodeUnknownSync(Admission)(
    await host.invoke('subagent', input),
  );
}

interface RecoveryTrial {
  readonly duringRecovery: SnapshotValue;
  readonly final: SnapshotValue;
  readonly order: readonly string[];
  readonly queuedTaskId: string;
  readonly recoveryTaskId: string;
}

async function runHeldRecovery(
  recoveryOutcome: Outcome,
): Promise<RecoveryTrial> {
  const initialStarted = Promise.withResolvers<void>();
  const releaseInitial = Promise.withResolvers<void>();
  const recoveryStarted = Promise.withResolvers<void>();
  const releaseRecovery = Promise.withResolvers<void>();
  const stages = new Map<string, number>();
  const order: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async (request): Promise<FixtureReply | undefined> => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const marker = latestMarker(request, [
        'HELD_FAILURE',
        'HELD_QUEUE',
        'RECOVERY_ATTEMPT',
      ]);
      if (marker === undefined) throw new Error('Recovery marker is missing.');
      const stage = stages.get(marker) ?? 0;
      stages.set(marker, stage + 1);
      if (marker === 'HELD_FAILURE' && stage === 0) {
        initialStarted.resolve();
        await releaseInitial.promise;
        return finish('unable', 'Initial assignment failed.');
      }
      if (marker === 'RECOVERY_ATTEMPT' && stage === 0) {
        order.push(marker);
        recoveryStarted.resolve();
        await releaseRecovery.promise;
        return finish(recoveryOutcome, 'Recovery assignment settled.');
      }
      if (stage === 0) order.push(marker);
      return stage === 0
        ? finish('fulfilled', `${marker} settled.`)
        : {text: `${marker} delivered.`};
    },
  );
  try {
    const initial = await admit(
      host,
      '{"command":"dispatch","tasks":[{"name":"failing-agent","prompt":"HELD_FAILURE","workspace":"direct","tools":["subagent"]}]}',
    );
    const initialTask = initial.tasks[0];
    if (!initialTask) throw new Error('Initial task was not admitted.');
    await initialStarted.promise;

    const queued = await admit(
      host,
      JSON.stringify({
        command: 'followup',
        agentId: initialTask.agentId,
        text: 'HELD_QUEUE',
      }),
    );
    const queuedTask = queued.tasks[0];
    if (!queuedTask) throw new Error('Queued task was not admitted.');
    await waitForState(host, snapshot => {
      const task = snapshot.tasks.find(item => item.id === queuedTask.taskId);
      return task?.phase === 'queued';
    });

    releaseInitial.resolve();
    const held = await waitForState(host, snapshot => {
      const initialRecord = snapshot.tasks.find(
        item => item.id === initialTask.taskId,
      );
      const queuedRecord = snapshot.tasks.find(
        item => item.id === queuedTask.taskId,
      );
      return (
        initialRecord?.outcome === 'unable' &&
        queuedRecord?.phase === 'queued' &&
        snapshot.agents.find(agent => agent.id === initialTask.agentId)
          ?.held === true
      );
    });
    expect(held.tasks.find(item => item.id === queuedTask.taskId)?.phase).toBe(
      'queued',
    );

    const recovery = await admit(
      host,
      JSON.stringify({
        command: 'followup',
        agentId: initialTask.agentId,
        text: 'RECOVERY_ATTEMPT',
        recovery: true,
      }),
    );
    const recoveryTask = recovery.tasks[0];
    if (!recoveryTask) throw new Error('Recovery task was not admitted.');
    await recoveryStarted.promise;
    const duringRecovery = await inspect(host);
    expect(
      duringRecovery.tasks.find(item => item.id === queuedTask.taskId)?.phase,
    ).toBe('queued');
    expect(order).toEqual(['RECOVERY_ATTEMPT']);

    releaseRecovery.resolve();
    const final = await waitForState(host, snapshot => {
      const recovered = snapshot.tasks.find(
        item => item.id === recoveryTask.taskId,
      );
      const oldQueue = snapshot.tasks.find(
        item => item.id === queuedTask.taskId,
      );
      return (
        recovered?.outcome === recoveryOutcome &&
        (recoveryOutcome === 'fulfilled'
          ? oldQueue?.outcome === 'fulfilled'
          : oldQueue?.phase === 'queued')
      );
    });
    return {
      duringRecovery,
      final,
      order,
      queuedTaskId: queuedTask.taskId,
      recoveryTaskId: recoveryTask.taskId,
    };
  } finally {
    releaseInitial.resolve();
    releaseRecovery.resolve();
    await host.close();
  }
}

test('held queue stays stopped during recovery and resumes after success', async () => {
  const result = await runHeldRecovery('fulfilled');
  expect(
    result.duringRecovery.tasks.find(item => item.id === result.queuedTaskId)
      ?.phase,
  ).toBe('queued');
  expect(
    result.final.tasks.find(item => item.id === result.queuedTaskId)?.outcome,
  ).toBe('fulfilled');
  expect(result.order).toEqual(['RECOVERY_ATTEMPT', 'HELD_QUEUE']);
});

test('a failed recovery reholds its independent queue', async () => {
  const result = await runHeldRecovery('unable');
  const queued = result.final.tasks.find(
    item => item.id === result.queuedTaskId,
  );
  const recovery = result.final.tasks.find(
    item => item.id === result.recoveryTaskId,
  );
  expect(recovery?.outcome).toBe('unable');
  expect(queued?.phase).toBe('queued');
  expect(result.order).toEqual(['RECOVERY_ATTEMPT']);
});

test('cancelling a dispatch ends its queued branch before a later recovery', async () => {
  const initialStarted = Promise.withResolvers<void>();
  const releaseInitial = Promise.withResolvers<void>();
  const stages = new Map<string, number>();
  let queuedCalls = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async (request): Promise<FixtureReply | undefined> => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const marker = latestMarker(request, [
        'CANCEL_INITIAL',
        'CANCEL_QUEUE',
        'CANCEL_RECOVERY',
      ]);
      if (marker === undefined) throw new Error('Cancellation marker missing.');
      const stage = stages.get(marker) ?? 0;
      stages.set(marker, stage + 1);
      if (marker === 'CANCEL_INITIAL' && stage === 0) {
        initialStarted.resolve();
        await releaseInitial.promise;
        return finish('fulfilled', 'Cancelled initial assignment.');
      }
      if (marker === 'CANCEL_QUEUE') {
        queuedCalls++;
        return finish('fulfilled', 'Cancelled queue must not run.');
      }
      return stage === 0
        ? finish('fulfilled', 'Recovery after cancellation.')
        : {text: 'Recovery after cancellation.'};
    },
  );
  try {
    const initial = await admit(
      host,
      '{"command":"dispatch","tasks":[{"name":"cancelled-agent","prompt":"CANCEL_INITIAL","workspace":"direct","tools":["subagent"]}]}',
    );
    const initialTask = initial.tasks[0];
    if (!initialTask) throw new Error('Cancellation task was not admitted.');
    await initialStarted.promise;
    const queued = await admit(
      host,
      JSON.stringify({
        command: 'followup',
        agentId: initialTask.agentId,
        text: 'CANCEL_QUEUE',
      }),
    );
    const queuedTask = queued.tasks[0];
    if (!queuedTask) throw new Error('Cancellation queue was not admitted.');
    await waitForState(host, snapshot =>
      snapshot.tasks.some(
        item => item.id === queuedTask.taskId && item.phase === 'queued',
      ),
    );

    await host.invoke(
      'subagent',
      JSON.stringify({command: 'cancel', dispatchId: initial.dispatchId}),
    );
    releaseInitial.resolve();
    const cancelled = await waitForState(host, snapshot => {
      const initialRecord = snapshot.tasks.find(
        item => item.id === initialTask.taskId,
      );
      const queuedRecord = snapshot.tasks.find(
        item => item.id === queuedTask.taskId,
      );
      return (
        initialRecord?.phase === 'ended' &&
        initialRecord.outcome === 'cancelled' &&
        queuedRecord?.phase === 'ended' &&
        queuedRecord.outcome === 'cancelled'
      );
    });
    expect(queuedCalls).toBe(0);
    expect(
      cancelled.tasks.find(item => item.id === queuedTask.taskId)?.outcome,
    ).toBe('cancelled');

    const recovery = await admit(
      host,
      JSON.stringify({
        command: 'followup',
        agentId: initialTask.agentId,
        text: 'CANCEL_RECOVERY',
        recovery: true,
      }),
    );
    const recoveryTask = recovery.tasks[0];
    if (!recoveryTask)
      throw new Error('Cancellation recovery was not admitted.');
    const final = await waitForState(host, snapshot =>
      snapshot.tasks.some(
        item => item.id === recoveryTask.taskId && item.outcome === 'fulfilled',
      ),
    );
    expect(queuedCalls).toBe(0);
    expect(
      final.tasks.find(item => item.id === queuedTask.taskId)?.outcome,
    ).toBe('cancelled');
  } finally {
    releaseInitial.resolve();
    await host.close();
  }
}, 60000);

test('recovery cannot jump ahead of an unheld agent queue', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const stages = new Set<string>();
  const order: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async (request): Promise<FixtureReply | undefined> => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      const marker = latestMarker(request, [
        'FIFO_INITIAL',
        'FIFO_ONE',
        'FIFO_TWO',
        'FIFO_RECOVERY',
      ]);
      if (marker === undefined) throw new Error('FIFO marker is missing.');
      if (stages.has(marker)) return {text: `${marker} delivered.`};
      stages.add(marker);
      order.push(marker);
      if (marker === 'FIFO_INITIAL') {
        started.resolve();
        await release.promise;
      }
      return finish('fulfilled', `${marker} settled.`);
    },
  );
  try {
    const initial = await admit(
      host,
      '{"command":"dispatch","tasks":[{"name":"fifo-agent","prompt":"FIFO_INITIAL","workspace":"direct","tools":["subagent"]}]}',
    );
    const first = initial.tasks[0];
    if (!first) throw new Error('Initial FIFO task was not admitted.');
    await started.promise;
    for (const text of ['FIFO_ONE', 'FIFO_TWO'])
      await admit(
        host,
        JSON.stringify({command: 'followup', agentId: first.agentId, text}),
      );
    const rejected = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId: first.agentId,
        text: 'FIFO_RECOVERY',
        recovery: true,
      }),
    );
    expect(rejected).toContain('Recovery requires a held agent queue');
    expect((await inspect(host)).tasks).toHaveLength(3);
    release.resolve();
    await waitForState(host, snapshot =>
      snapshot.tasks.every(task => task.phase === 'ended'),
    );
    expect(order).toEqual(['FIFO_INITIAL', 'FIFO_ONE', 'FIFO_TWO']);
  } finally {
    release.resolve();
    await host.close();
  }
}, 60000);

test('recovery is rejected while cancellation is still settling and leaves admission unchanged', async () => {
  const initialStarted = Promise.withResolvers<void>();
  const releaseInitial = Promise.withResolvers<void>();
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async (request): Promise<FixtureReply | undefined> => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const marker = latestMarker(request, [
        'CANCELLING_INITIAL',
        'CANCELLING_RECOVERY',
      ]);
      if (marker === undefined) throw new Error('Cancellation marker missing.');
      if (marker === 'CANCELLING_INITIAL') {
        initialStarted.resolve();
        await releaseInitial.promise;
        return finish('fulfilled', 'Initial assignment released.');
      }
      return finish('fulfilled', 'Recovery after cancellation.');
    },
  );
  try {
    const initial = await admit(
      host,
      '{"command":"dispatch","tasks":[{"name":"cancelling-agent","prompt":"CANCELLING_INITIAL","workspace":"direct","tools":["subagent"]}]}',
    );
    const initialTask = initial.tasks[0];
    if (!initialTask) throw new Error('Cancellation task was not admitted.');
    await initialStarted.promise;

    await host.invoke(
      'subagent',
      JSON.stringify({command: 'cancel', taskId: initialTask.taskId}),
    );

    const rejected = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId: initialTask.agentId,
        text: 'CANCELLING_RECOVERY',
        recovery: true,
      }),
    );
    expect(rejected).toContain('wait until the previous execution stops');
    const beforeSettlement = await inspect(host);
    expect(beforeSettlement.tasks).toHaveLength(1);
    expect(beforeSettlement.dispatches[0]?.admitted).toBe(1);

    releaseInitial.resolve();
    const settled = await waitForState(host, snapshot => {
      const task = snapshot.tasks.find(item => item.id === initialTask.taskId);
      return task?.phase === 'ended' && task.outcome === 'cancelled';
    });
    expect(
      settled.agents.find(agent => agent.id === initialTask.agentId)?.held,
    ).toBe(true);

    const recovery = await admit(
      host,
      JSON.stringify({
        command: 'followup',
        agentId: initialTask.agentId,
        text: 'CANCELLING_RECOVERY',
        recovery: true,
      }),
    );
    const recoveryTask = recovery.tasks[0];
    if (!recoveryTask) throw new Error('Recovery task was not admitted.');
    const final = await waitForState(host, snapshot =>
      snapshot.tasks.some(
        item => item.id === recoveryTask.taskId && item.outcome === 'fulfilled',
      ),
    );
    expect(final.tasks).toHaveLength(2);
    expect(final.dispatches[0]?.admitted).toBe(2);
  } finally {
    releaseInitial.resolve();
    await host.close();
  }
}, 60000);
