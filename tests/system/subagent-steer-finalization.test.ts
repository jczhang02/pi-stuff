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
const WRITER_MARKER = 'WRITER_FINALIZE_MARKER';
const SIBLING_MARKER = 'SIBLING_ACTIVE_MARKER';
const STEER_MARKER = 'WHOLE_RUN_STEER_MARKER';

const Question = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  expiresAt: Schema.Number,
});

const Workspace = Schema.Struct({
  branch: Schema.String,
  path: Schema.String,
});

const Git = Schema.Struct({
  status: Schema.String,
  changedFiles: Schema.Array(Schema.String),
});

const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  finalizing: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  preservationError: Schema.optional(Schema.String),
  pendingInstructions: Schema.Array(Schema.String),
  question: Schema.optional(Question),
  workspace: Schema.optional(Workspace),
  git: Schema.optional(Git),
});

const RunSnapshot = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskSnapshot),
});

type RunSnapshot = Schema.Schema.Type<typeof RunSnapshot>;
type PiMessage = PiFixtureRequest['messages'][number];
type SubagentInput = Readonly<{
  command:
    | 'dispatch'
    | 'status'
    | 'result'
    | 'steer'
    | 'reply'
    | 'wait'
    | 'cancel';
  runId?: string;
  taskId?: string;
  questionId?: string;
  message?: string;
  autoAwait?: boolean;
  notifyPerTask?: boolean;
  tasks?: readonly Readonly<{
    id: string;
    agent: string;
    task: string;
    cwd?: string;
    write?: boolean;
  }>[];
  concurrency?: number;
}>;

function messageText(message: PiMessage): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function decodeRun(serialized: string): RunSnapshot {
  return Schema.decodeUnknownSync(RunSnapshot)(JSON.parse(serialized));
}

function taskById(run: RunSnapshot, taskId: string) {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined)
    throw new Error(`Run ${run.id} did not include task ${taskId}.`);
  return task;
}

async function invokeRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  input: SubagentInput,
): Promise<RunSnapshot> {
  return decodeRun(await host.invoke('subagent', JSON.stringify(input)));
}

async function waitForRun(
  host: Awaited<ReturnType<typeof launchPi>>,
  runId: string,
  predicate: (run: RunSnapshot) => boolean,
  timeoutMs: number,
): Promise<RunSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let run = await invokeRun(host, {command: 'result', runId});
  while (!predicate(run) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    run = await invokeRun(host, {command: 'result', runId});
  }
  return run;
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

async function createRepository(directory: string): Promise<string> {
  const root = join(directory, 'project');
  await mkdir(root);
  await exec('git', ['init', '-b', 'main'], {cwd: root});
  await writeFile(join(root, 'base.txt'), 'parent base\n');
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
  await writeFile(
    join(root, '.git', 'hooks', 'post-commit'),
    '#!/bin/sh\ncommon=$(git rev-parse --git-common-dir)\ntouch "$common/finalizing-started"\nwhile [ ! -f "$common/release-finalizing" ]; do sleep 0.05; done\n',
    {
      mode: 0o755,
    },
  );
  return root;
}

function fixtureCallback(
  writerPrompts: string[],
  siblingPrompts: string[],
): PiFixtureResponseCallback {
  let writerStarted = false;
  let siblingStarted = false;
  return request => {
    const names = request.tools?.map(tool => tool.function.name) ?? [];
    if (names.includes('subagent')) return undefined;
    const text = requestText(request);
    const last = request.messages.at(-1);
    if (text.includes(WRITER_MARKER)) {
      writerPrompts.push(text);
      if (!writerStarted) {
        writerStarted = true;
        return {
          type: 'tool_call',
          name: 'write',
          arguments: JSON.stringify({
            path: 'writer.txt',
            content: 'writer change\n',
          }),
        };
      }
      if (last?.role !== 'tool')
        throw new Error(`Writer callback saw an unexpected request: ${text}`);
      return {type: 'content', content: 'WRITER_REPORT'};
    }
    if (!text.includes(SIBLING_MARKER))
      throw new Error(`Unexpected child callback request: ${text}`);
    if (text.includes(STEER_MARKER)) {
      siblingPrompts.push(text);
      return {type: 'content', content: 'SIBLING_STEERED'};
    }
    if (!siblingStarted) {
      siblingStarted = true;
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question: 'Hold this sibling open.'}),
      };
    }
    if (last?.role !== 'tool')
      throw new Error(`Sibling callback saw an unexpected request: ${text}`);
    return {type: 'content', content: 'SIBLING_REPORT'};
  };
}

test('whole-run steer skips a writer finalizing Git while steering its active sibling', async () => {
  const writerPrompts: string[] = [];
  const siblingPrompts: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(writerPrompts, siblingPrompts),
  );
  let root: string | undefined;
  try {
    root = await createRepository(host.directory);
    const dispatched = await invokeRun(host, {
      command: 'dispatch',
      tasks: [
        {
          id: 'writer',
          agent: 'writer',
          task: WRITER_MARKER,
          cwd: root,
          write: true,
        },
        {
          id: 'sibling',
          agent: 'questioner',
          task: SIBLING_MARKER,
          cwd: root,
        },
      ],
      concurrency: 2,
      autoAwait: false,
      notifyPerTask: false,
    });
    const settled = await waitForRun(
      host,
      dispatched.id,
      run => {
        const candidateWriter = taskById(run, 'writer');
        const candidateSibling = taskById(run, 'sibling');
        return (
          candidateWriter.finalizing === true &&
          candidateSibling.question !== undefined
        );
      },
      5000,
    );
    const finalizingWriter = taskById(settled, 'writer');
    const waitingSibling = taskById(settled, 'sibling');
    expect(finalizingWriter.finalizing).toBe(true);
    expect(waitingSibling.question?.text).toBe('Hold this sibling open.');

    const writerOnlyFailure = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'steer',
        runId: dispatched.id,
        taskId: 'writer',
        message: 'WRITER_ONLY_STEER',
      }),
    );
    expect(writerOnlyFailure).toMatch(/No live child can accept/i);

    const steered = await invokeRun(host, {
      command: 'steer',
      runId: dispatched.id,
      message: STEER_MARKER,
    });
    expect(taskById(steered, 'sibling').pendingInstructions).toContain(
      STEER_MARKER,
    );
    expect(
      writerPrompts.some(prompt => prompt.includes('WRITER_ONLY_STEER')),
    ).toBe(false);
    expect(writerPrompts.some(prompt => prompt.includes(STEER_MARKER))).toBe(
      false,
    );
    expect(taskById(steered, 'writer').finalizing).toBe(true);

    const steeredStatus = await invokeRun(host, {
      command: 'result',
      runId: dispatched.id,
    });
    const question = taskById(steeredStatus, 'sibling').question;
    if (question !== undefined) {
      await invokeRun(host, {
        command: 'reply',
        runId: dispatched.id,
        taskId: 'sibling',
        questionId: question.id,
        message: 'Continue after the steer.',
      });
    }
    await writeFile(join(root, '.git', 'release-finalizing'), 'release');
    const completed = await waitForRun(
      host,
      dispatched.id,
      run => run.status === 'completed',
      10000,
    );
    const completedWriter = taskById(completed, 'writer');
    const completedSibling = taskById(completed, 'sibling');
    expect(completed.status).toBe('completed');
    expect(completedWriter.status).toBe('completed');
    expect(completedWriter.finalizing).toBe(false);
    expect(completedWriter.git?.status).toBe('committed');
    expect(completedWriter.git?.changedFiles).toEqual(['writer.txt']);
    expect(completedSibling.status).toBe('completed');
    expect(completedSibling.finalText).toContain('SIBLING_STEERED');
    expect(siblingPrompts.some(prompt => prompt.includes(STEER_MARKER))).toBe(
      true,
    );
    expect(completedSibling.pendingInstructions).toEqual([]);
    expect(await readFile(join(root, 'base.txt'), 'utf8')).toBe(
      'parent base\n',
    );
    await expect(readFile(join(root, 'writer.txt'))).rejects.toThrow();
    const worktrees = await exec('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
    });
    expect(worktrees.stdout).not.toContain(
      completedWriter.workspace?.path ?? '',
    );
  } finally {
    if (root)
      await writeFile(join(root, '.git', 'release-finalizing'), 'release');
    await host.close();
  }
}, 60000);

test('cancelled writer stays finalizing until a failing prepare-commit hook is released', async () => {
  const writerPrompts: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(writerPrompts, []),
  );
  let root: string | undefined;
  try {
    root = await createRepository(host.directory);
    const common = join(root, '.git');
    await writeFile(
      join(root, '.git', 'hooks', 'post-commit'),
      '#!/bin/sh\nexit 0\n',
      {mode: 0o755},
    );
    await writeFile(
      join(root, '.git', 'hooks', 'prepare-commit-msg'),
      '#!/bin/sh\ncommon=$(git rev-parse --git-common-dir)\ntouch "$common/prepare-commit-started"\nwhile [ ! -f "$common/release-prepare-commit" ]; do sleep 0.05; done\nprintf "prepare-commit gate failed\\n" >&2\nexit 1\n',
      {mode: 0o755},
    );

    const dispatched = await invokeRun(host, {
      command: 'dispatch',
      tasks: [
        {
          id: 'writer',
          agent: 'writer',
          task: WRITER_MARKER,
          cwd: root,
          write: true,
        },
      ],
      autoAwait: false,
      notifyPerTask: false,
    });
    const prepareCommitStarted = join(common, 'prepare-commit-started');
    const releasePrepareCommit = join(common, 'release-prepare-commit');
    await waitForFile(prepareCommitStarted, 5000);

    const cancelling = await invokeRun(host, {
      command: 'cancel',
      runId: dispatched.id,
      taskId: 'writer',
    });
    expect(taskById(cancelling, 'writer').status).toBe('stopping');
    const blocked = await waitForRun(
      host,
      dispatched.id,
      run => {
        const writer = taskById(run, 'writer');
        return writer.status === 'stopping' && writer.finalizing === true;
      },
      5000,
    );
    const blockedWriter = taskById(blocked, 'writer');
    expect(blockedWriter.status).toBe('stopping');
    expect(blockedWriter.finalizing).toBe(true);

    const stillBlocked = await invokeRun(host, {
      command: 'result',
      runId: dispatched.id,
    });
    expect(taskById(stillBlocked, 'writer').status).toBe('stopping');
    expect(taskById(stillBlocked, 'writer').finalizing).toBe(true);

    await writeFile(releasePrepareCommit, 'release');
    const stopped = await waitForRun(
      host,
      dispatched.id,
      run => {
        const writer = taskById(run, 'writer');
        return (
          run.status === 'stopped' &&
          writer.status === 'stopped' &&
          writer.finalizing === false &&
          writer.preservationError !== undefined
        );
      },
      10000,
    );
    const stoppedWriter = taskById(stopped, 'writer');
    expect(stopped.status).toBe('stopped');
    expect(stoppedWriter.status).toBe('stopped');
    expect(stoppedWriter.finalizing).toBe(false);
    expect(stoppedWriter.preservationError).toMatch(
      /prepare-commit|gate|commit|save/i,
    );
    expect(stoppedWriter.finalText).toContain('WRITER_REPORT');
    expect(stoppedWriter.workspace?.path).toBeDefined();
    const workspacePath = stoppedWriter.workspace?.path;
    if (workspacePath === undefined)
      throw new Error('Stopped writer omitted its workspace path.');
    expect(await readFile(join(workspacePath, 'writer.txt'), 'utf8')).toBe(
      'writer change\n',
    );
    expect(writerPrompts.some(prompt => prompt.includes(WRITER_MARKER))).toBe(
      true,
    );
  } finally {
    if (root)
      await writeFile(
        join(root, '.git', 'release-prepare-commit'),
        'release',
      ).catch(() => undefined);
    await host.close();
  }
}, 60000);
