import {expect, test} from 'bun:test';
import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const exec = promisify(execFile);

const Git = Schema.Struct({
  status: Schema.String,
  commitSha: Schema.optional(Schema.String),
  diffStat: Schema.String,
  changedFiles: Schema.Array(Schema.String),
});

const Workspace = Schema.Struct({
  branch: Schema.String,
  path: Schema.String,
});

const Usage = Schema.Struct({
  input: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
  cacheRead: Schema.optional(Schema.Number),
  cacheWrite: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  turns: Schema.optional(Schema.Number),
});

const RequestSnapshot = Schema.Struct({
  requestId: Schema.String,
  task: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  workspace: Schema.optional(Workspace),
  git: Schema.optional(Git),
  usage: Schema.optional(Usage),
});

const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  requestId: Schema.String,
  task: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  workspace: Schema.optional(Workspace),
  git: Schema.optional(Git),
  usage: Schema.optional(Usage),
  history: Schema.Array(RequestSnapshot),
});

const RunSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
type PiMessage = PiFixtureRequest['messages'][number];

function messageText(message: PiMessage): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
}

function decodeRun(serialized: string): RunSnapshot {
  return Schema.decodeUnknownSync(RunSnapshot)(JSON.parse(serialized));
}

function taskOf(run: RunSnapshot): RunSnapshot['tasks'][number] {
  const task = run.tasks[0];
  if (task === undefined) throw new Error('The run did not include a task.');
  return task;
}

async function createProject(directory: string): Promise<string> {
  const root = join(directory, 'project');
  await mkdir(root);
  await exec('git', ['init', '-b', 'main'], {cwd: root});
  await writeFile(join(root, 'base.txt'), 'committed parent\n');
  await exec('git', ['add', 'base.txt'], {cwd: root});
  await exec(
    'git',
    [
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'initial',
    ],
    {cwd: root},
  );
  await writeFile(join(root, 'base.txt'), 'dirty parent\n');
  return root;
}

function writerCallback(
  phase: () => 'initial' | 'follow-up',
  childStarts: string[],
  readResults: string[],
): PiFixtureResponseCallback {
  let initialStarted = false;
  let continuationReadStarted = false;
  let continuationWriteStarted = false;
  return request => {
    if (toolNames(request).includes('subagent')) return undefined;
    const last = request.messages.at(-1);
    if (phase() === 'initial') {
      if (!initialStarted) {
        initialStarted = true;
        childStarts.push('initial');
        return {
          type: 'tool_call',
          name: 'write',
          arguments: JSON.stringify({
            path: 'child.txt',
            content: 'first change\n',
          }),
        };
      }
      if (last?.role !== 'tool')
        throw new Error(
          `Expected the initial write result, got ${requestText(request)}`,
        );
      return {type: 'content', content: 'FIRST_REPORT'};
    }

    if (!continuationReadStarted) {
      continuationReadStarted = true;
      childStarts.push('follow-up');
      return {
        type: 'tool_call',
        name: 'read',
        arguments: JSON.stringify({path: 'child.txt'}),
      };
    }
    if (!continuationWriteStarted) {
      continuationWriteStarted = true;
      readResults.push(last === undefined ? '' : messageText(last));
      return {
        type: 'tool_call',
        name: 'write',
        arguments: JSON.stringify({
          path: 'child.txt',
          content: 'second change\n',
        }),
      };
    }
    if (last?.role !== 'tool')
      throw new Error(
        `Expected the continuation write result, got ${requestText(request)}`,
      );
    return {type: 'content', content: 'FOLLOW_UP_REPORT'};
  };
}

test('a writer follow-up reattaches its branch and preserves the first commit', async () => {
  let phase: 'initial' | 'follow-up' = 'initial';
  const childStarts: string[] = [];
  const readResults: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    writerCallback(() => phase, childStarts, readResults),
  );
  try {
    const root = await createProject(host.directory);
    const first = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          agent: 'writer',
          task: 'Create child.txt.',
          cwd: root,
          write: true,
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    const firstTask = taskOf(first);
    const firstGit = firstTask.git;
    const firstWorkspace = firstTask.workspace;
    if (firstGit === undefined || firstWorkspace === undefined)
      throw new Error('The initial writer report lacks Git metadata.');
    const firstCommit = firstGit.commitSha;
    if (firstCommit === undefined)
      throw new Error('The initial writer report lacks a commit SHA.');
    expect(first.status).toBe('completed');
    expect(firstTask.status).toBe('completed');
    expect(firstGit.status).toBe('committed');
    expect(firstGit.changedFiles).toEqual(['child.txt']);
    expect(firstCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(childStarts).toEqual(['initial']);
    const firstWorktrees = await exec(
      'git',
      ['worktree', 'list', '--porcelain'],
      {
        cwd: root,
      },
    );
    expect(firstWorktrees.stdout).not.toContain(firstWorkspace.path);

    phase = 'follow-up';
    const continued = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'follow-up',
          runId: first.id,
          taskId: firstTask.id,
          message: 'FOLLOW_UP_MARKER: read child.txt and update it.',
          autoAwait: true,
        }),
      ),
    );
    const continuedTask = taskOf(continued);
    const continuedGit = continuedTask.git;
    const continuedWorkspace = continuedTask.workspace;
    const oldRequest = continuedTask.history[0];
    if (
      continuedGit === undefined ||
      continuedWorkspace === undefined ||
      oldRequest === undefined
    )
      throw new Error('The continuation report lacks required metadata.');
    const continuedCommit = continuedGit.commitSha;
    if (continuedCommit === undefined)
      throw new Error('The continuation report lacks a commit SHA.');
    expect(continued.status).toBe('completed');
    expect(continuedTask.status).toBe('completed');
    expect(childStarts).toEqual(['initial', 'follow-up']);
    expect(readResults).toHaveLength(1);
    expect(readResults[0]).toContain('first change');
    expect(continuedWorkspace.branch).toBe(firstWorkspace.branch);
    expect(continuedWorkspace.path).toBe(firstWorkspace.path);
    expect(continuedGit.status).toBe('committed');
    expect(continuedGit.changedFiles).toEqual(['child.txt']);
    expect(continuedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(continuedCommit).not.toBe(firstCommit);
    expect(continuedTask.requestId).not.toBe(firstTask.requestId);
    expect(continuedTask.history).toHaveLength(1);
    expect(oldRequest.requestId).toBe(firstTask.requestId);
    expect(oldRequest.task).toBe(firstTask.task);
    expect(oldRequest.status).toBe(firstTask.status);
    expect(oldRequest.finalText).toBe(firstTask.finalText);
    expect(oldRequest.workspace).toEqual(firstTask.workspace);
    expect(oldRequest.git).toEqual(firstTask.git);

    expect(
      (
        await exec('git', ['rev-parse', firstWorkspace.branch], {
          cwd: root,
        })
      ).stdout.trim(),
    ).toBe(continuedCommit);
    expect(
      (
        await exec(
          'git',
          ['rev-list', '--count', `${firstCommit}..${continuedCommit}`],
          {
            cwd: root,
          },
        )
      ).stdout.trim(),
    ).toBe('1');
    expect(
      (
        await exec('git', ['show', `${firstWorkspace.branch}:child.txt`], {
          cwd: root,
        })
      ).stdout,
    ).toBe('second change\n');
    expect(
      (
        await exec('git', ['show', `${firstCommit}:child.txt`], {
          cwd: root,
        })
      ).stdout,
    ).toBe('first change\n');
    expect(await readFile(join(root, 'base.txt'), 'utf8')).toBe(
      'dirty parent\n',
    );
    await expect(readFile(join(root, 'child.txt'))).rejects.toThrow();
    expect(
      (
        await exec('git', ['branch', '--show-current'], {
          cwd: root,
        })
      ).stdout.trim(),
    ).toBe('main');
    expect(
      (
        await exec('git', ['status', '--short'], {
          cwd: root,
        })
      ).stdout,
    ).toBe(' M base.txt\n');
    await expect(
      exec('git', ['merge-base', '--is-ancestor', continuedCommit, 'main'], {
        cwd: root,
      }),
    ).rejects.toThrow();
    const finalWorktrees = await exec(
      'git',
      ['worktree', 'list', '--porcelain'],
      {cwd: root},
    );
    expect(finalWorktrees.stdout).not.toContain(firstWorkspace.path);
  } finally {
    await host.close();
  }
}, 60000);

test('a missing writer branch rejects continuation before starting its model', async () => {
  let phase: 'initial' | 'follow-up' = 'initial';
  const childStarts: string[] = [];
  const readResults: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    writerCallback(() => phase, childStarts, readResults),
  );
  try {
    const root = await createProject(host.directory);
    const first = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          agent: 'writer',
          task: 'Create child.txt.',
          cwd: root,
          write: true,
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    const firstTask = taskOf(first);
    const firstGit = firstTask.git;
    const firstWorkspace = firstTask.workspace;
    if (firstGit === undefined || firstWorkspace === undefined)
      throw new Error('The initial writer report lacks Git metadata.');
    const startsBeforeFailure = childStarts.length;
    await exec('git', ['branch', '-D', firstWorkspace.branch], {cwd: root});

    phase = 'follow-up';
    const failure = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'follow-up',
        runId: first.id,
        taskId: firstTask.id,
        message: 'FOLLOW_UP_MARKER: read child.txt and update it.',
        autoAwait: true,
      }),
    );
    expect(failure).toMatch(/fatal|workspace|branch/i);
    expect(childStarts).toHaveLength(startsBeforeFailure);
    expect(readResults).toEqual([]);

    const afterFailure = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'status',
          runId: first.id,
        }),
      ),
    );
    const afterTask = taskOf(afterFailure);
    expect(afterFailure.status).toBe('completed');
    expect(afterTask.status).toBe(firstTask.status);
    expect(afterTask.requestId).toBe(firstTask.requestId);
    expect(afterTask.finalText).toBe(firstTask.finalText);
    expect(afterTask.history).toEqual([]);
    expect(afterTask.git).toEqual(firstTask.git);
    expect(afterTask.workspace).toEqual(firstTask.workspace);
  } finally {
    await host.close();
  }
}, 60000);
