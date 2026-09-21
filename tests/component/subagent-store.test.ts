import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {loadRuns, saveRuns} from '../../src/subagent/store';
import type {
  RequestRecord,
  RunSnapshot,
  TaskSnapshot,
} from '../../src/subagent/records';

function requestRecord(
  id: string,
  task: string,
  requestId: string,
): RequestRecord {
  return {
    id,
    agent: 'fixture-agent',
    task,
    cwd: '/tmp/fixture-cwd',
    prompt: task,
    write: false,
    tools: ['read'],
    explicitTools: false,
    needs: [],
    maxRuntimeMs: 1_000,
    requestId,
    status: 'completed',
    finalText: `${task} report`,
    pendingInstructions: [],
    configurationNotes: [],
  };
}

function runSnapshot(
  runId: string,
  taskId: string,
  requestId: string,
): RunSnapshot {
  const history = requestRecord(
    taskId,
    `${taskId} initial`,
    `${requestId}-history`,
  );
  const task: TaskSnapshot = {
    ...requestRecord(taskId, `${taskId} follow-up`, requestId),
    history: [history],
    cumulativeUsage: {
      input: 12,
      output: 8,
      cacheRead: 3,
      cacheWrite: 1,
      cost: 0.42,
      turns: 2,
    },
  };
  return {
    id: runId,
    mode: 'single',
    notifyPerTask: false,
    status: 'completed',
    tasks: [task],
    intercom: [],
  };
}

function archiveBytes(runs: readonly RunSnapshot[]): string {
  return JSON.stringify({version: 1, runs});
}

function firstTask(run: RunSnapshot): TaskSnapshot {
  const task = run.tasks[0];
  if (task === undefined) throw new Error(`Run ${run.id} has no task.`);
  return task;
}

function firstHistory(task: TaskSnapshot): RequestRecord {
  const request = task.history[0];
  if (request === undefined) throw new Error(`Task ${task.id} has no history.`);
  return request;
}

async function sidecarPath(): Promise<{
  directory: string;
  parentFile: string;
  path: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-store-'));
  const parentFile = join(directory, 'parent.jsonl');
  return {
    directory,
    parentFile,
    path: `${parentFile}.pi-stuff-subagents.json`,
  };
}

test('saveRuns and loadRuns round-trip history and cumulative usage', async () => {
  const files = await sidecarPath();
  const first = runSnapshot('run-1', 'task-1', 'request-1');
  const second = runSnapshot('run-2', 'task-2', 'request-2');
  firstTask(second).write = true;
  firstTask(second).tools = ['read', 'write'];
  firstTask(second).workspace = {
    root: '/tmp/project',
    path: '/tmp/project/.git/subagents/run-2/task-2',
    cwd: '/tmp/project/.git/subagents/run-2/task-2',
    branch: 'subagents/run-2/task-2',
    base: 'base',
  };
  try {
    await Effect.runPromise(saveRuns(files.parentFile, [first, second]));
    const loaded = await Effect.runPromise(loadRuns(files.parentFile));

    expect(loaded).toEqual([first, second]);
    expect(loaded[0]?.tasks[0]?.history).toHaveLength(1);
    expect(loaded[0]?.tasks[0]?.cumulativeUsage?.turns).toBe(2);
  } finally {
    await rm(files.directory, {recursive: true, force: true});
  }
});

test('loadRuns treats a missing sidecar as an empty archive', async () => {
  const files = await sidecarPath();
  try {
    expect(await Effect.runPromise(loadRuns(files.parentFile))).toEqual([]);
    await expect(readFile(files.path, 'utf8')).rejects.toThrow();
  } finally {
    await rm(files.directory, {recursive: true, force: true});
  }
});

test('loadRuns rejects invalid archives without changing their bytes', async () => {
  const files = await sidecarPath();
  const run = runSnapshot('run-1', 'task-1', 'request-1');
  const duplicateRun = runSnapshot('run-2', 'task-2', 'request-2');
  const duplicateRequest = {
    ...duplicateRun,
    tasks: [
      {
        ...firstTask(duplicateRun),
        requestId: firstTask(run).requestId,
      },
    ],
  };
  const invalidDependency = {
    ...run,
    tasks: [{...firstTask(run), needs: ['missing-task']}],
  };
  const invalidCurrentTools = {
    ...run,
    tasks: [{...firstTask(run), tools: ['bash']}],
  };
  const invalidHistoryTools = {
    ...run,
    tasks: [
      {
        ...firstTask(run),
        history: [{...firstHistory(firstTask(run)), tools: ['edit']}],
      },
    ],
  };
  const workspace = {
    root: '/tmp/project',
    path: '/tmp/project/.git/subagents/run-1/task-1',
    cwd: '/tmp/project/.git/subagents/run-1/task-1',
    branch: 'subagents/run-1/task-1',
    base: 'base',
  };
  const readonlyWorkspace = {
    ...run,
    tasks: [{...firstTask(run), workspace}],
  };
  const otherWorkspace = {
    ...run,
    tasks: [
      {
        ...firstTask(run),
        write: true,
        workspace: {...workspace, branch: 'subagents/run-2/task-2'},
      },
    ],
  };
  const cases: ReadonlyArray<{
    name: string;
    bytes: string;
    message: RegExp;
  }> = [
    {
      name: 'corrupt JSON',
      bytes: '{"version":1,"runs":[',
      message: /Invalid subagent records/,
    },
    {
      name: 'unsupported archive version',
      bytes: '{"version":2,"runs":[]}',
      message: /Invalid subagent records/,
    },
    {
      name: 'duplicate run',
      bytes: archiveBytes([run, run]),
      message: /Duplicate run: run-1/,
    },
    {
      name: 'duplicate request',
      bytes: archiveBytes([run, duplicateRequest]),
      message: /Duplicate request: request-1/,
    },
    {
      name: 'invalid dependency',
      bytes: archiveBytes([invalidDependency]),
      message: /needs unknown task id: missing-task/,
    },
    {
      name: 'workspace attached to read-only request',
      bytes: archiveBytes([readonlyWorkspace]),
      message: /Request has another task's workspace/,
    },
    {
      name: 'workspace from another task',
      bytes: archiveBytes([otherWorkspace]),
      message: /Request has another task's workspace/,
    },
    {
      name: 'write tool on current read-only request',
      bytes: archiveBytes([invalidCurrentTools]),
      message: /Read-only request has write tools: request-1/,
    },
    {
      name: 'write tool on historical read-only request',
      bytes: archiveBytes([invalidHistoryTools]),
      message: /Read-only request has write tools: request-1-history/,
    },
  ];

  try {
    for (const invalid of cases) {
      await writeFile(files.path, invalid.bytes);
      await expect(
        Effect.runPromise(loadRuns(files.parentFile)),
      ).rejects.toThrow(invalid.message);
      expect(await readFile(files.path, 'utf8')).toBe(invalid.bytes);
    }
  } finally {
    await rm(files.directory, {recursive: true, force: true});
  }
});

test('saveRuns preserves an existing path and removes its temporary file on atomic failure', async () => {
  const files = await sidecarPath();
  try {
    await mkdir(files.path);
    const sentinel = join(files.path, 'sentinel');
    await writeFile(sentinel, 'existing sidecar path');

    await expect(
      Effect.runPromise(
        saveRuns(files.parentFile, [
          runSnapshot('run-1', 'task-1', 'request-1'),
        ]),
      ),
    ).rejects.toThrow('Could not save subagent records');

    expect(await readFile(sentinel, 'utf8')).toBe('existing sidecar path');
    expect(await readdir(files.directory)).toEqual([basename(files.path)]);
  } finally {
    await rm(files.directory, {recursive: true, force: true});
  }
});
