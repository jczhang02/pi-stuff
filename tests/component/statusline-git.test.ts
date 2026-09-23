import {expect, test} from 'bun:test';
import {mkdtemp, writeFile, rm, mkdir, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {readGit} from '../../src/statusline/git';

test('Git snapshots: unborn, dirty, rename, detached, conflicts and worktree operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'statusline-git-'));
  const repository = join(root, 'repository');
  await mkdir(repository);
  const git = async (...args: string[]) => {
    const process = Bun.spawn(['git', ...args], {
      cwd: repository,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(process.stdout).text();
    const error = await new Response(process.stderr).text();
    if ((await process.exited) !== 0) throw new Error(error);
    return output.trim();
  };
  const snapshot = (cwd = repository) =>
    Effect.runPromise(readGit(cwd, new AbortController().signal));
  try {
    expect(await snapshot()).toEqual({kind: 'outside'});
    await git('init', '-b', 'MainCase');
    await git('config', 'user.name', 'Fixture');
    await git('config', 'user.email', 'fixture@example.invalid');
    expect(await snapshot()).toMatchObject({
      kind: 'ready',
      snapshot: {branch: 'MainCase', staged: 0, modified: 0},
    });
    await writeFile(join(repository, 'tracked'), 'first\n');
    await git('add', 'tracked');
    await git('commit', '-m', 'fixture');
    await git('branch', 'upstream');
    await git('branch', '--set-upstream-to=upstream');
    await writeFile(join(repository, 'tracked'), 'staged\n');
    await git('add', 'tracked');
    await writeFile(join(repository, 'tracked'), 'unstaged\n');
    await writeFile(join(repository, 'odd\n? name'), 'untracked');
    expect(await snapshot()).toMatchObject({
      snapshot: {staged: 1, modified: 1, untracked: 1},
    });
    await git('add', '.');
    await git('commit', '-m', 'ahead');
    expect(await snapshot()).toMatchObject({snapshot: {ahead: 1, behind: 0}});
    await git('mv', 'tracked', 'renamed');
    expect(await snapshot()).toMatchObject({
      snapshot: {staged: 1, modified: 0, untracked: 0},
    });
    await git('commit', '-m', 'rename');
    const worktree = join(root, 'worktree');
    await git('worktree', 'add', '-b', 'OtherCase', worktree);
    await writeFile(join(worktree, 'local'), 'worktree only');
    expect(await snapshot(worktree)).toMatchObject({
      snapshot: {branch: 'OtherCase', untracked: 1},
    });
    expect(await snapshot()).toMatchObject({
      snapshot: {branch: 'MainCase', untracked: 0},
    });
    const worktreeGit = join(repository, '.git', 'worktrees', 'worktree');
    await mkdir(join(worktreeGit, 'rebase-merge'));
    expect(await snapshot(worktree)).toMatchObject({
      snapshot: {operation: 'rebase'},
    });
    expect(await snapshot()).toMatchObject({snapshot: {operation: ''}});
    await git('checkout', '--detach');
    expect(await snapshot()).toMatchObject({
      snapshot: {
        branch: `detached ${await git('rev-parse', '--short=7', 'HEAD')}`,
      },
    });
    await git('checkout', '-b', 'conflict-source', 'upstream');
    await writeFile(join(repository, 'tracked'), 'other\n');
    await git('commit', '-am', 'conflict');
    await git('checkout', 'MainCase');
    const merge = Bun.spawn(['git', 'merge', 'conflict-source'], {
      cwd: repository,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await merge.exited).toBe(1);
    expect(await snapshot()).toMatchObject({
      snapshot: {operation: 'merge', conflicts: 1},
    });
    await git('merge', '--abort');
    expect(await snapshot()).toMatchObject({
      snapshot: {operation: '', conflicts: 0},
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('Git process failure, timeout and cancellation discard counts and recover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'statusline-git-failure-'));
  const previous = process.env.PATH;
  try {
    await writeFile(join(root, 'git'), '#!/bin/sh\nexit 1\n');
    await chmod(join(root, 'git'), 0o700);
    process.env.PATH = root;
    expect(
      await Effect.runPromise(readGit(root, new AbortController().signal)),
    ).toEqual({kind: 'unknown'});
    await writeFile(join(root, 'git'), '#!/bin/sh\nexec /bin/sleep 10\n');
    const started = performance.now();
    expect(
      await Effect.runPromise(readGit(root, new AbortController().signal)),
    ).toEqual({kind: 'unknown'});
    expect(performance.now() - started).toBeLessThan(4000);
    const controller = new AbortController();
    const pending = Effect.runPromise(readGit(root, controller.signal));
    controller.abort();
    expect(await pending).toEqual({kind: 'unknown'});
    process.env.PATH = previous;
    expect(
      await Effect.runPromise(readGit(root, new AbortController().signal)),
    ).toEqual({kind: 'outside'});
  } finally {
    process.env.PATH = previous;
    await rm(root, {recursive: true, force: true});
  }
}, 10000);
