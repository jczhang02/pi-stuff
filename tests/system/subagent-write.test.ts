import {expect, test} from 'bun:test';
import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const exec = promisify(execFile);
const Result = Schema.Struct({
  status: Schema.String,
  tasks: Schema.Array(
    Schema.Struct({
      status: Schema.String,
      finalText: Schema.String,
      workspace: Schema.Struct({branch: Schema.String, path: Schema.String}),
      git: Schema.Struct({
        status: Schema.String,
        commitSha: Schema.String,
        changedFiles: Schema.Array(Schema.String),
      }),
    }),
  ),
});

test('a native writer saves its own branch without editing the parent checkout', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const tools = request.tools?.map(tool => tool.function.name) ?? [];
      if (tools.includes('subagent')) return undefined;
      if (request.messages.at(-1)?.role === 'tool')
        return {type: 'content', content: 'Created child.txt in my worktree.'};
      return {
        type: 'tool_call',
        name: 'write',
        arguments: JSON.stringify({
          path: 'child.txt',
          content: 'child change\n',
        }),
      };
    },
  );
  try {
    const root = join(host.directory, 'project');
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
    const serialized = await host.invoke(
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
    );
    const result = Schema.decodeUnknownSync(Result)(JSON.parse(serialized));
    expect(result.status).toBe('completed');
    const child = result.tasks[0];
    if (!child) throw new Error('Missing writer result.');
    expect(child.status).toBe('completed');
    expect(child.git.status).toBe('committed');
    expect(child.git.changedFiles).toEqual(['child.txt']);
    expect(child.git.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(root, 'base.txt'), 'utf8')).toBe(
      'dirty parent\n',
    );
    await expect(readFile(join(root, 'child.txt'))).rejects.toThrow();
    const saved = await exec(
      'git',
      ['show', `${child.workspace.branch}:child.txt`],
      {cwd: root},
    );
    expect(saved.stdout).toBe('child change\n');
    const inherited = await exec(
      'git',
      ['show', `${child.workspace.branch}:base.txt`],
      {cwd: root},
    );
    expect(inherited.stdout).toBe('committed parent\n');
    const worktrees = await exec('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
    });
    expect(worktrees.stdout).not.toContain(child.workspace.path);
  } finally {
    await host.close();
  }
}, 60000);

test('a completed report retains the worktree when its commit fails', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      if (request.messages.at(-1)?.role === 'tool')
        return {
          type: 'content',
          content: 'The partial file is ready for inspection.',
        };
      return {
        type: 'tool_call',
        name: 'bash',
        arguments: JSON.stringify({
          command:
            'printf "retained change\\n" > partial.txt; touch "$(git rev-parse --git-path index.lock)"',
        }),
      };
    },
  );
  try {
    const root = join(host.directory, 'project');
    await mkdir(root);
    await exec('git', ['init', '-b', 'main'], {cwd: root});
    await exec(
      'git',
      [
        '-c',
        'user.name=fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      ],
      {cwd: root},
    );
    const serialized = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'writer',
        task: 'Prepare a partial change.',
        cwd: root,
        write: true,
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    const result = Schema.decodeUnknownSync(
      Schema.Struct({
        status: Schema.String,
        tasks: Schema.Array(
          Schema.Struct({
            status: Schema.String,
            finalText: Schema.String,
            preservationError: Schema.String,
            workspace: Schema.Struct({path: Schema.String}),
          }),
        ),
      }),
    )(JSON.parse(serialized));
    expect(result.status).toBe('completed');
    const child = result.tasks[0];
    if (!child) throw new Error('Missing writer result.');
    expect(child.status).toBe('completed');
    expect(child.finalText).toContain('ready for inspection');
    expect(child.preservationError).toContain('index.lock');
    expect(
      await readFile(join(child.workspace.path, 'partial.txt'), 'utf8'),
    ).toBe('retained change\n');
    await expect(readFile(join(root, 'partial.txt'))).rejects.toThrow();
  } finally {
    await host.close();
  }
}, 60000);

test('a writer outside Git fails before calling its model', async () => {
  let childCalls = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      childCalls++;
      return {
        type: 'content',
        content: 'This child should never have started.',
      };
    },
  );
  try {
    const serialized = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'writer',
        task: 'Write a file.',
        cwd: host.directory,
        write: true,
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    const result = Schema.decodeUnknownSync(
      Schema.Struct({
        status: Schema.String,
        tasks: Schema.Array(
          Schema.Struct({status: Schema.String, error: Schema.String}),
        ),
      }),
    )(JSON.parse(serialized));
    expect(result.status).toBe('failed');
    expect(result.tasks[0]?.status).toBe('failed');
    expect(result.tasks[0]?.error).toContain('not a git repository');
    expect(childCalls).toBe(0);
  } finally {
    await host.close();
  }
}, 60000);
