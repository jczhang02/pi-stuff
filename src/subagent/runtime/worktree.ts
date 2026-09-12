import {execFile} from 'node:child_process';
import {access, realpath, symlink} from 'node:fs/promises';
import {promisify} from 'node:util';
import {join, resolve} from 'node:path';

const execFileAsync = promisify(execFile);
const BRANCH_PREFIX = 'subagents/';
const SAFE_COMPONENT = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_BRANCH = /^subagents\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

export interface Worktree {
  root: string;
  path: string;
  branch: string;
}

async function gitRaw(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return result.stdout;
}

async function git(root: string, args: string[]): Promise<string> {
  return (await gitRaw(root, args)).trim();
}

async function gitOk(root: string, args: string[]): Promise<boolean> {
  try {
    await git(root, args);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function repoRoot(cwd: string): Promise<string | undefined> {
  if (!(await pathExists(cwd))) return undefined;
  try {
    return realpath(await git(cwd, ['rev-parse', '--show-toplevel']));
  } catch {
    return undefined;
  }
}

export async function createWorktree(
  cwd: string,
  runId: string,
  taskId: string,
): Promise<Worktree | undefined> {
  if (!SAFE_COMPONENT.test(runId) || !SAFE_COMPONENT.test(taskId))
    throw new Error('runId and taskId must be safe path components');
  const root = await repoRoot(cwd);
  if (!root) return undefined;
  const container = await subagentsDir(root);
  if (!container) return undefined;
  let base: string;
  try {
    base = await git(root, ['rev-parse', 'HEAD']);
  } catch {
    throw new Error(
      'The repository needs a HEAD commit before creating a child worktree.',
    );
  }
  const path = join(container, runId, taskId);
  const branch = `${BRANCH_PREFIX}${runId}/${taskId}`;
  if (
    (await pathExists(path)) ||
    (await gitOk(root, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]))
  )
    throw new Error(`worktree or branch already exists: ${branch}`);
  await git(root, ['worktree', 'add', '-b', branch, path, base]);
  await linkNodeModules(root, path);
  return {root, path, branch};
}

export async function attachWorktree(
  cwd: string,
  branch: string,
): Promise<Worktree | undefined> {
  if (!SAFE_BRANCH.test(branch)) return undefined;
  const root = await repoRoot(cwd);
  if (!root) return undefined;
  const container = await subagentsDir(root);
  if (!container) return undefined;
  if (
    !(await gitOk(root, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]))
  )
    return undefined;
  const path = join(container, branch.slice(BRANCH_PREFIX.length));
  const registered = await worktreePaths(root);
  if (!registered?.includes(path)) {
    if (await pathExists(path))
      throw new Error(`refusing to replace existing path: ${path}`);
    await git(root, ['worktree', 'add', path, branch]);
  }
  await linkNodeModules(root, path);
  return {root, path, branch};
}

async function linkNodeModules(root: string, path: string): Promise<void> {
  const source = join(root, 'node_modules');
  const destination = join(path, 'node_modules');
  if (!(await pathExists(source)) || (await pathExists(destination))) return;
  try {
    await symlink(source, destination, 'junction');
  } catch {
    // Dependency linking is an optimization; the worktree remains valid without it.
  }
}

async function subagentsDir(root: string): Promise<string | undefined> {
  try {
    return join(
      await git(root, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ]),
      'subagents',
    );
  } catch {
    try {
      return join(
        resolve(root, await git(root, ['rev-parse', '--git-common-dir'])),
        'subagents',
      );
    } catch {
      return undefined;
    }
  }
}

async function worktreePaths(root: string): Promise<string[] | undefined> {
  try {
    const listing = await gitRaw(root, [
      'worktree',
      'list',
      '--porcelain',
      '-z',
    ]);
    return listing
      .split('\0')
      .filter(record => record.startsWith('worktree '))
      .map(record => record.slice('worktree '.length));
  } catch {
    try {
      return (await git(root, ['worktree', 'list', '--porcelain']))
        .split('\n')
        .filter(record => record.startsWith('worktree '))
        .map(record => record.slice('worktree '.length));
    } catch {
      return undefined;
    }
  }
}
