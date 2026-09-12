import {afterEach, expect, test} from 'bun:test';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  attachWorktree,
  createWorktree,
  repoRoot,
} from '../../src/subagent/runtime/worktree';
import {resolveAgentFile} from '../../src/subagent/runtime/agentfile';

const runGit = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, {recursive: true, force: true})),
  );
});

async function temporaryRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi-stuff-io-'));
  roots.push(root);
  await runGit('git', ['-C', root, 'init', '-q']);
  await runGit('git', ['-C', root, 'config', 'user.name', 'test']);
  await runGit('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await runGit('git', ['-C', root, 'add', 'README.md']);
  await runGit('git', ['-C', root, 'commit', '-qm', 'base']);
  return root;
}

test('creates an isolated worktree and retains branch changes', async () => {
  const root = await temporaryRepo();
  const worktree = await createWorktree(root, 'run_test', 'task_test');
  expect(worktree?.root).toBe(root);
  expect(worktree?.path).not.toBe(root);
  expect(worktree?.branch).toBe('subagents/run_test/task_test');
  await writeFile(join(worktree!.path, 'README.md'), 'changed\n');
  await writeFile(join(worktree!.path, 'new.txt'), 'untracked\n');
  expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('base\n');
  expect(await readFile(join(worktree!.path, 'README.md'), 'utf8')).toBe(
    'changed\n',
  );
  expect(await attachWorktree(root, worktree!.branch)).toMatchObject({
    path: worktree!.path,
  });
  expect(await readFile(join(worktree!.path, 'new.txt'), 'utf8')).toBe(
    'untracked\n',
  );
});

test('fails closed outside a repository and on unsafe identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-plain-'));
  roots.push(directory);
  expect(await repoRoot(directory)).toBeUndefined();
  await expect(createWorktree(directory, '../escape', 'task')).rejects.toThrow(
    'safe path components',
  );
  expect(
    await attachWorktree(directory, 'subagents/../escape/task'),
  ).toBeUndefined();
});

test('ignores malformed agent frontmatter while resolving valid files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-stuff-agents-'));
  roots.push(root);
  const agents = join(root, '.agents', 'agents');
  await mkdir(agents, {recursive: true});
  await writeFile(
    join(agents, 'broken.md'),
    '---\ntools: {bad: true}\n---\nnope',
  );
  await writeFile(
    join(agents, 'reviewer.md'),
    '---\nname: reviewer\ndescription: review code changes\ntools: [read]\n---\nDo review.\n',
  );
  const file = resolveAgentFile(
    'reviewer',
    'review code changes',
    root,
    join(root, '.config'),
  );
  expect(file?.name).toBe('reviewer');
  expect(file?.tools).toEqual(['read']);
  expect(file?.body).toContain('Do review.');
});
