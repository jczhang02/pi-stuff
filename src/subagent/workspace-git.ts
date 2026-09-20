import {trackedCommand} from './processes';
import {lstat, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {WorkspaceError} from './workspace-error';

const GIT_OUTPUT_BYTES = 1024 * 1024;

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runGit(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  signal: AbortSignal | undefined,
): Promise<GitResult> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const append = (chunks: Buffer[], bytes: number, data: Buffer) => {
    if (bytes + data.byteLength > GIT_OUTPUT_BYTES)
      throw new WorkspaceError({
        kind: 'git',
        message: 'Git output exceeded the safety limit.',
      });
    chunks.push(data);
    return bytes + data.byteLength;
  };
  try {
    const options: Parameters<typeof trackedCommand>[3] = {
      onStdout: data => {
        stdoutBytes = append(stdout, stdoutBytes, data);
      },
      onStderr: data => {
        stderrBytes = append(stderr, stderrBytes, data);
      },
    };
    if (env !== undefined) options.env = env;
    if (signal !== undefined) options.signal = signal;
    const result = await trackedCommand(
      'git',
      ['--no-optional-locks', ...args],
      cwd,
      options,
    );
    return {
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      code: result.exitCode ?? -1,
    };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError({
      kind: signal?.aborted ? 'cancelled' : 'git',
      message: error instanceof Error ? error.message : 'Git execution failed.',
    });
  }
}

export function gitFailure(
  operation: string,
  result: GitResult,
  kind: WorkspaceError['kind'] = 'git',
): WorkspaceError {
  const detail = result.stderr.trim().replace(/\s+/g, ' ');
  const suffix = detail.length > 0 ? `: ${detail.slice(0, 400)}` : '';
  return new WorkspaceError({
    kind,
    message: `Git ${operation} failed${suffix}`,
  });
}

export function requireGit(
  operation: string,
  result: GitResult,
  kind: WorkspaceError['kind'] = 'git',
): string {
  if (result.code !== 0) throw gitFailure(operation, result, kind);
  return result.stdout.trim();
}

export async function git(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  env?: NodeJS.ProcessEnv,
): Promise<GitResult> {
  return runGit(args, cwd, env, signal);
}

export async function existingDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

export function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child === '' ||
    (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  );
}

export function segment(value: string, label: string): string {
  if (value.length === 0)
    throw new WorkspaceError({
      kind: 'input',
      message: `${label} must not be empty.`,
    });
  if (value === '.' || value === '..')
    throw new WorkspaceError({kind: 'input', message: `${label} is invalid.`});
  if (/^[A-Za-z0-9._-]+$/.test(value)) return value;
  return `id-${Buffer.from(value).toString('hex')}`;
}

export function normalizePaths(
  root: string,
  paths: readonly string[],
  label: string,
): string[] {
  const normalized: string[] = [];
  for (const path of paths) {
    if (path.length === 0)
      throw new WorkspaceError({
        kind: 'input',
        message: `${label} contains an empty path.`,
      });
    const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
    if (!within(root, absolute))
      throw new WorkspaceError({
        kind: 'input',
        message: `${label} must stay inside the repository workspace.`,
      });
    const relativePath = relative(root, absolute).split(sep).join('/');
    if (relativePath.split('/').includes('.git'))
      throw new WorkspaceError({
        kind: 'input',
        message: `${label} cannot select the Git administrative directory.`,
      });
    if (relativePath.length === 0) normalized.push('.');
    else if (!normalized.includes(relativePath)) normalized.push(relativePath);
  }
  return normalized;
}

export async function findRepository(
  source: string,
  signal: AbortSignal,
): Promise<string | null> {
  let result: GitResult;
  try {
    result = await git(['rev-parse', '--show-toplevel'], source, signal);
  } catch (error) {
    if (error instanceof WorkspaceError && error.kind === 'cancelled')
      throw error;
    return null;
  }
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  if (root.length === 0) return null;
  return canonicalPath(root);
}

export async function repositoryCommit(
  repository: string,
  signal: AbortSignal,
): Promise<string> {
  const commit = await repositoryHead(repository, signal);
  if (commit === null)
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The Git repository has no saved commit baseline.',
    });
  return commit;
}

export async function repositoryHead(
  repository: string,
  signal: AbortSignal,
): Promise<string | null> {
  const result = await git(
    ['rev-parse', '--verify', 'HEAD^{commit}'],
    repository,
    signal,
  );
  if (result.code !== 0) return null;
  const commit = result.stdout.trim().split('\n')[0];
  return commit === undefined || commit.length === 0 ? null : commit;
}

export async function resolveCommit(
  repository: string,
  value: string,
  signal: AbortSignal,
): Promise<string> {
  if (value.length === 0 || value.startsWith('-'))
    throw new WorkspaceError({
      kind: 'input',
      message: 'Baseline must be a Git commit.',
    });
  const commit = requireGit(
    'resolve baseline',
    await git(
      ['rev-parse', '--verify', `${value}^{commit}`],
      repository,
      signal,
    ),
    'input',
  ).split('\n')[0];
  if (commit === undefined || commit.length === 0)
    throw new WorkspaceError({
      kind: 'input',
      message: 'Baseline is not a Git commit.',
    });
  return commit;
}

export function indexEnvironment(index: string): NodeJS.ProcessEnv {
  return {GIT_INDEX_FILE: index};
}

export function workspaceRef(taskId: string): string {
  return `refs/pi-stuff/subagents/${segment(taskId, 'taskId')}/workspace`;
}

export function baselineRef(taskId: string, commit: string): string {
  return `refs/pi-stuff/subagents/${segment(taskId, 'taskId')}/baseline-${commit}`;
}

export function artifactRef(taskId: string, commit: string): string {
  return `refs/pi-stuff/subagents/${segment(taskId, 'taskId')}/artifact-${commit}`;
}

export async function retainRef(
  repository: string,
  ref: string,
  commit: string,
  signal: AbortSignal,
): Promise<void> {
  requireGit(
    'retain workspace result',
    await git(['update-ref', ref, commit], repository, signal),
    'workspace',
  );
}

export async function addWorktree(
  repository: string,
  directory: string,
  commit: string,
  signal: AbortSignal,
): Promise<void> {
  if (await existingDirectory(directory))
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The retained workspace directory already exists.',
    });
  requireGit(
    'create isolated worktree',
    await git(
      ['worktree', 'add', '--detach', directory, commit],
      repository,
      signal,
    ),
    'workspace',
  );
}

export async function forgetMissingWorktree(
  repository: string,
  directory: string,
  signal: AbortSignal,
): Promise<void> {
  const result = await git(
    ['worktree', 'remove', '--force', directory],
    repository,
    signal,
  );
  if (result.code === 0) return;
  const detail = result.stderr.toLowerCase();
  if (detail.includes('not a working tree')) return;
  throw gitFailure('remove missing worktree registration', result, 'workspace');
}

export async function worktreeCommit(
  directory: string,
  signal: AbortSignal,
): Promise<string> {
  const commit = requireGit(
    'read workspace baseline',
    await git(['rev-parse', '--verify', 'HEAD^{commit}'], directory, signal),
    'workspace',
  ).split('\n')[0];
  if (commit === undefined || commit.length === 0)
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace has no saved commit baseline.',
    });
  return commit;
}

export async function worktreeRepository(
  directory: string,
  signal: AbortSignal,
): Promise<string> {
  const commonDirectory = requireGit(
    'read workspace repository',
    await git(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      directory,
      signal,
    ),
    'workspace',
  );
  return canonicalPath(dirname(resolve(directory, commonDirectory)));
}

export async function workspaceStatus(
  directory: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await git(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored'],
    directory,
    signal,
  );
  if (result.code !== 0)
    throw gitFailure('inspect workspace content', result, 'release');
  return result.stdout;
}
