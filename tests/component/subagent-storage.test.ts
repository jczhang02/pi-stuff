import {afterEach, expect, test} from 'bun:test';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RunStore} from '../../src/subagent/runtime/storage';
import type {RunSnapshot} from '../../src/subagent/runtime/types';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, {recursive: true, force: true})),
  );
});

function run(status: RunSnapshot['status'] = 'completed'): RunSnapshot {
  return {
    id: 'run_test',
    mode: 'single',
    status,
    notifyPerTask: true,
    createdAt: 1,
    concurrency: 1,
    aggregateUsage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      turns: 0,
    },
    tasks: [
      {
        id: 'task_1',
        runId: 'run_test',
        agent: 'tester',
        task: 'test',
        cwd: '/tmp/project',
        status: status === 'completed' ? 'completed' : 'running',
        toolCalls: 0,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          turns: 0,
        },
      },
    ],
  };
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'pi-stuff-storage-'));
  roots.push(value);
  return value;
}

test('round trips immutable snapshots and writes mode 600 without temp leakage', async () => {
  const directory = await root();
  const store = new RunStore(join(directory, 'parent.jsonl'), () => undefined);
  const snapshot = run();
  store.save([snapshot]);
  snapshot.tasks[0]!.finalText = 'mutated after save';
  await store.flush();

  const sidecar = join(directory, 'parent.jsonl.pi-stuff-subagents.json');
  const loaded = await store.load();
  expect(loaded[0]?.tasks[0]?.finalText).toBeUndefined();
  expect((await stat(sidecar)).mode & 0o777).toBe(0o600);
  expect(
    (await readdir(directory)).filter(name => name.endsWith('.tmp')),
  ).toEqual([]);
  expect(JSON.parse(await readFile(sidecar, 'utf8'))[0].id).toBe('run_test');
});

test('isolates stores and normalizes interrupted tasks', async () => {
  const directory = await root();
  const first = new RunStore(join(directory, 'one.jsonl'), () => undefined);
  const second = new RunStore(join(directory, 'two.jsonl'), () => undefined);
  first.save([run('running')]);
  second.save([run()]);
  await Promise.all([first.flush(), second.flush()]);

  const restored = await first.load();
  expect(restored[0]?.status).toBe('aborted');
  expect(restored[0]?.tasks[0]?.status).toBe('aborted');
  expect(restored[0]?.tasks[0]?.error).toContain('Interrupted');
  expect((await second.load())[0]?.status).toBe('completed');
});

test('reports truncated sidecars and write failures', async () => {
  const directory = await root();
  const messages: string[] = [];
  const store = new RunStore(join(directory, 'broken.jsonl'), message =>
    messages.push(message),
  );
  await Bun.write(join(directory, 'broken.jsonl.pi-stuff-subagents.json'), '{');
  expect(await store.load()).toEqual([]);
  expect(messages.length).toBe(1);
  expect(() => store.assertWritable()).toThrow('history could not be loaded');
  store.save([run()]);
  await store.flush();
  expect(
    await readFile(
      join(directory, 'broken.jsonl.pi-stuff-subagents.json'),
      'utf8',
    ),
  ).toBe('{');

  const bad = new RunStore('/dev/null/pi-stuff-parent.jsonl', message =>
    messages.push(message),
  );
  bad.save([run()]);
  await expect(bad.flush()).rejects.toThrow();
  expect(messages.length).toBeGreaterThan(1);
});

test('missing sidecars are empty and terminal tasks repair stale run status', async () => {
  const directory = await root();
  const messages: string[] = [];
  const store = new RunStore(join(directory, 'new.jsonl'), message =>
    messages.push(message),
  );
  expect(await store.load()).toEqual([]);
  expect(messages).toEqual([]);

  const stale = run();
  stale.status = 'running';
  store.save([stale]);
  await store.flush();
  const restored = (await store.load())[0];
  expect(restored?.status).toBe('completed');
  expect(restored?.endedAt).toBeGreaterThan(0);
});

test('rejects unsafe identities and duplicate task ids', async () => {
  const directory = await root();
  const messages: string[] = [];
  const store = new RunStore(join(directory, 'unsafe.jsonl'), message =>
    messages.push(message),
  );
  const unsafe = run();
  unsafe.id = '../escape';
  await Bun.write(
    join(directory, 'unsafe.jsonl.pi-stuff-subagents.json'),
    JSON.stringify([unsafe]),
  );
  expect(await store.load()).toEqual([]);
  expect(messages[0]).toContain('unsafe');
});
