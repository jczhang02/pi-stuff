import {expect, test} from 'bun:test';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import {
  inspectExecutions,
  trackedBashOperations,
  trackedCommand,
  withExecutionTracking,
} from '../../src/subagent/processes';

test('direct command arguments are literal and execution scopes retain their own witnesses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-process-'));
  const argument = 'text with spaces; $(printf unexpected)';
  let output = '';
  try {
    const result = await withExecutionTracking(directory, () =>
      trackedCommand('/usr/bin/printf', ['%s', argument], directory, {
        onStdout: data => {
          output += data.toString();
        },
        onStderr: () => {},
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(output).toBe(argument);
    expect(
      (await readdir(directory)).filter(name => name.endsWith('.json')),
    ).toHaveLength(1);
    expect((await Effect.runPromise(inspectExecutions(directory))).active).toBe(
      false,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('child shell persists a process witness before executing and waits for background group exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-process-'));
  let output = '';
  try {
    const began = Date.now();
    const result = await trackedBashOperations(directory).exec(
      'test -n "$(find . -name \'*.json\' -print -quit)" || exit 20; (sleep 0.2; printf child) & printf parent',
      directory,
      {
        onData: data => {
          output += data.toString();
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(output).toContain('parent');
    expect(output).toContain('child');
    expect(Date.now() - began).toBeGreaterThanOrEqual(150);
    const names = (await readdir(directory)).filter(name =>
      name.endsWith('.json'),
    );
    expect(names).toHaveLength(1);
    expect(await readFile(join(directory, names[0] ?? ''), 'utf8')).toContain(
      '"state":"ended"',
    );
    expect(await Effect.runPromise(inspectExecutions(directory))).toEqual({
      active: false,
      unknown: false,
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('cancellation does not settle a TERM-ignoring child before its process group stops', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-process-'));
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  let settled = false;
  let group: number | undefined;
  const execution = trackedBashOperations(directory)
    .exec(
      "trap '' TERM; printf ready; while :; do sleep 0.1; done",
      directory,
      {signal: controller.signal, onData: () => started.resolve()},
    )
    .finally(() => {
      settled = true;
    });
  const result = execution.catch(error =>
    error instanceof Error ? error.message : String(error),
  );
  try {
    await started.promise;
    const name = (await readdir(directory)).find(name =>
      name.endsWith('.json'),
    );
    if (!name) throw new Error('Missing process witness.');
    group = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.Struct({group: Schema.Number})),
    )(await readFile(join(directory, name), 'utf8')).group;
    controller.abort();
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    expect((await Effect.runPromise(inspectExecutions(directory))).active).toBe(
      true,
    );
    process.kill(-group, 'SIGKILL');
    expect(await result).toContain('cancelled after process-group exit');
    expect((await Effect.runPromise(inspectExecutions(directory))).active).toBe(
      false,
    );
  } finally {
    if (!settled && group !== undefined) process.kill(-group, 'SIGKILL');
    await result;
    await rm(directory, {recursive: true, force: true});
  }
});

test('a failed shell spawn is reported without leaving an execution witness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-process-'));
  try {
    await expect(
      trackedBashOperations(directory).exec(
        'printf unexpected',
        join(directory, 'missing'),
        {
          onData: () => {
            throw new Error('A failed spawn cannot produce output.');
          },
        },
      ),
    ).rejects.toThrow('ENOENT');
    expect(await Effect.runPromise(inspectExecutions(directory))).toEqual({
      active: false,
      unknown: false,
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('a failed output consumer stops and settles the owned shell before rejecting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-process-'));
  try {
    await expect(
      trackedBashOperations(directory).exec(
        'printf ready; sleep 30',
        directory,
        {
          onData: () => {
            throw new Error('Output storage failed.');
          },
        },
      ),
    ).rejects.toThrow('Output storage failed.');
    expect(await Effect.runPromise(inspectExecutions(directory))).toEqual({
      active: false,
      unknown: false,
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('cancellation signals a background group after its command shell has exited', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-background-'));
  const controller = new AbortController();
  const ready = Promise.withResolvers<void>();
  const execution = trackedBashOperations(directory)
    .exec('sleep 3 >/dev/null 2>&1 & printf ready', directory, {
      signal: controller.signal,
      onData: () => ready.resolve(),
    })
    .catch(error => (error instanceof Error ? error.message : String(error)));
  try {
    await ready.promise;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    const started = Date.now();
    controller.abort();
    expect(await execution).toContain('cancelled after process-group exit');
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await Effect.runPromise(inspectExecutions(directory))).active).toBe(
      false,
    );
  } finally {
    controller.abort();
    await execution;
    await rm(directory, {recursive: true, force: true});
  }
});
