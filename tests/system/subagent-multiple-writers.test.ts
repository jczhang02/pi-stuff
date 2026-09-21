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
const FIRST_MARKER = 'FIRST_WRITER_MARKER';
const SECOND_MARKER = 'SECOND_WRITER_MARKER';
const CONSUMER_MARKER = 'CONSUMER_WRITER_MARKER';

const Workspace = Schema.Struct({
  branch: Schema.String,
  path: Schema.String,
});

const Git = Schema.Struct({
  status: Schema.String,
  commitSha: Schema.String,
  changedFiles: Schema.Array(Schema.String),
});

const TaskSnapshot = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  task: Schema.String,
  needs: Schema.Array(Schema.String),
  status: Schema.String,
  finalText: Schema.String,
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
  command: 'dispatch';
  cwd: string;
  tasks: readonly Readonly<{
    id: string;
    agent: string;
    task: string;
    write: boolean;
    needs?: readonly string[];
  }>[];
  concurrency: number;
  autoAwait: boolean;
  notifyPerTask: boolean;
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

function fixtureCallback(consumerPrompts: string[]): PiFixtureResponseCallback {
  let firstStarted = false;
  let secondStarted = false;
  let consumerStarted = false;
  return request => {
    const names = request.tools?.map(tool => tool.function.name) ?? [];
    if (names.includes('subagent')) return undefined;
    const text = requestText(request);
    const last = request.messages.at(-1);
    if (text.includes(FIRST_MARKER)) {
      if (!firstStarted) {
        firstStarted = true;
        return {
          type: 'tool_call',
          name: 'write',
          arguments: JSON.stringify({
            path: 'first.txt',
            content: 'first writer change\n',
          }),
        };
      }
      if (last?.role !== 'tool')
        throw new Error(
          `First writer callback saw an unexpected request: ${text}`,
        );
      return {type: 'content', content: 'FIRST_REPORT'};
    }
    if (text.includes(SECOND_MARKER)) {
      if (!secondStarted) {
        secondStarted = true;
        return {
          type: 'tool_call',
          name: 'write',
          arguments: JSON.stringify({
            path: 'second.txt',
            content: 'second writer change\n',
          }),
        };
      }
      if (last?.role !== 'tool')
        throw new Error(
          `Second writer callback saw an unexpected request: ${text}`,
        );
      return {type: 'content', content: 'SECOND_REPORT'};
    }
    if (!text.includes(CONSUMER_MARKER))
      throw new Error(`Unexpected child callback request: ${text}`);
    if (!text.includes('FIRST_REPORT') || !text.includes('SECOND_REPORT'))
      throw new Error(`Consumer prompt omitted a predecessor report: ${text}`);
    consumerPrompts.push(text);
    if (!consumerStarted) {
      consumerStarted = true;
      return {
        type: 'tool_call',
        name: 'write',
        arguments: JSON.stringify({
          path: 'consumer.txt',
          content: 'consumer change\n',
        }),
      };
    }
    if (last?.role !== 'tool')
      throw new Error(`Consumer callback saw an unexpected request: ${text}`);
    return {type: 'content', content: 'CONSUMER_REPORT'};
  };
}

test('a consumer writer uses only the last eligible writer branch while receiving both reports', async () => {
  const consumerPrompts: string[] = [];
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    fixtureCallback(consumerPrompts),
  );
  try {
    const root = await createProject(host.directory);
    const input: SubagentInput = {
      command: 'dispatch',
      cwd: root,
      tasks: [
        {
          id: 'first',
          agent: 'writer',
          task: FIRST_MARKER,
          write: true,
        },
        {
          id: 'second',
          agent: 'writer',
          task: SECOND_MARKER,
          write: true,
        },
        {
          id: 'consumer',
          agent: 'writer',
          task: CONSUMER_MARKER,
          write: true,
          needs: ['first', 'second'],
        },
      ],
      concurrency: 3,
      autoAwait: true,
      notifyPerTask: false,
    };
    const run = decodeRun(await host.invoke('subagent', JSON.stringify(input)));
    const first = taskById(run, 'first');
    const second = taskById(run, 'second');
    const consumer = taskById(run, 'consumer');
    if (
      first.workspace === undefined ||
      second.workspace === undefined ||
      consumer.workspace === undefined ||
      first.git === undefined ||
      second.git === undefined ||
      consumer.git === undefined
    )
      throw new Error('The writer reports lack workspace or Git metadata.');

    expect(run.status).toBe('completed');
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(consumer.status).toBe('completed');
    expect(first.git.status).toBe('committed');
    expect(second.git.status).toBe('committed');
    expect(consumer.git.status).toBe('committed');
    expect(first.git.changedFiles).toEqual(['first.txt']);
    expect(second.git.changedFiles).toEqual(['second.txt']);
    expect(consumer.git.changedFiles).toEqual(['consumer.txt']);
    expect(consumer.needs).toEqual(['first', 'second']);
    expect(
      consumerPrompts.some(
        prompt =>
          prompt.includes('FIRST_REPORT') && prompt.includes('SECOND_REPORT'),
      ),
    ).toBe(true);

    expect(
      (
        await exec('git', ['show', `${first.workspace.branch}:first.txt`], {
          cwd: root,
        })
      ).stdout,
    ).toBe('first writer change\n');
    await expect(
      exec('git', ['show', `${first.workspace.branch}:second.txt`], {
        cwd: root,
      }),
    ).rejects.toThrow();
    expect(
      (
        await exec('git', ['show', `${second.workspace.branch}:second.txt`], {
          cwd: root,
        })
      ).stdout,
    ).toBe('second writer change\n');
    await expect(
      exec('git', ['show', `${second.workspace.branch}:first.txt`], {
        cwd: root,
      }),
    ).rejects.toThrow();
    expect(
      (
        await exec('git', ['show', `${consumer.workspace.branch}:second.txt`], {
          cwd: root,
        })
      ).stdout,
    ).toBe('second writer change\n');
    await expect(
      exec('git', ['show', `${consumer.workspace.branch}:first.txt`], {
        cwd: root,
      }),
    ).rejects.toThrow();
    expect(
      (
        await exec('git', ['show', `${consumer.workspace.branch}:base.txt`], {
          cwd: root,
        })
      ).stdout,
    ).toBe('committed parent\n');
    expect(await readFile(join(root, 'base.txt'), 'utf8')).toBe(
      'dirty parent\n',
    );
    await expect(readFile(join(root, 'first.txt'))).rejects.toThrow();
    await expect(readFile(join(root, 'second.txt'))).rejects.toThrow();
    await expect(readFile(join(root, 'consumer.txt'))).rejects.toThrow();
    expect(
      (
        await exec('git', ['status', '--short'], {
          cwd: root,
        })
      ).stdout,
    ).toBe(' M base.txt\n');
    const worktrees = await exec('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
    });
    expect(worktrees.stdout).not.toContain(first.workspace.path);
    expect(worktrees.stdout).not.toContain(second.workspace.path);
    expect(worktrees.stdout).not.toContain(consumer.workspace.path);
  } finally {
    await host.close();
  }
}, 60000);
