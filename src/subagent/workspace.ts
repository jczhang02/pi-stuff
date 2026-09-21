import {execFile} from 'node:child_process';
import {
  access,
  lstat,
  mkdir,
  readlink,
  realpath,
  symlink,
  unlink,
} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {Effect, Schema} from 'effect';

const BRANCH_PREFIX = 'subagents/';
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const COMPONENT = /^[A-Za-z0-9_-]{1,64}$/;
const COMMIT_CONFIG = [
  '-c',
  'commit.gpgsign=false',
  '-c',
  'user.name=pi subagent',
  '-c',
  'user.email=subagent@local',
];

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
  'WorkspaceError',
  {
    kind: Schema.Literals([
      'repository',
      'validation',
      'prepare',
      'attach',
      'save',
      'release',
    ]),
    message: Schema.String,
  },
) {}

export interface Workspace {
  readonly root: string;
  readonly path: string;
  readonly cwd: string;
  readonly branch: string;
  readonly base: string;
}

export type WorkspaceSaveResult =
  | {
      readonly status: 'empty';
      readonly diffStat: '';
      readonly changedFiles: readonly [];
    }
  | {
      readonly status: 'committed';
      readonly commitSha: string;
      readonly diffStat: string;
      readonly changedFiles: readonly string[];
    };

interface WorkspaceLocation {
  readonly root: string;
  readonly commonDir: string;
  readonly path: string;
  readonly branch: string;
}

function executeGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveResult, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER,
        timeout: GIT_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr).trim() || error.message;
          reject(new Error(detail));
          return;
        }
        resolveResult(String(stdout));
      },
    );
  });
}

function runGit(
  cwd: string,
  args: readonly string[],
  kind: WorkspaceError['kind'],
  trim = true,
): Effect.Effect<string, WorkspaceError> {
  return Effect.tryPromise({
    try: () =>
      executeGit(cwd, args).then(stdout => (trim ? stdout.trim() : stdout)),
    catch: error =>
      new WorkspaceError({
        kind,
        message: error instanceof Error ? error.message : 'Git command failed.',
      }),
  });
}

function pathExists(path: string): Effect.Effect<boolean> {
  return Effect.match(
    Effect.tryPromise({
      try: () => access(path),
      catch: () => undefined,
    }),
    {onFailure: () => false, onSuccess: () => true},
  );
}

function ensureDirectory(
  path: string,
  kind: WorkspaceError['kind'],
): Effect.Effect<void, WorkspaceError> {
  return Effect.tryPromise({
    try: () => mkdir(path, {recursive: true}),
    catch: error =>
      new WorkspaceError({
        kind,
        message:
          error instanceof Error
            ? `Could not create workspace directory: ${error.message}`
            : 'Could not create workspace directory.',
      }),
  }).pipe(Effect.asVoid);
}

function pathInside(parent: string, child: string): boolean {
  const rest = relative(resolve(parent), resolve(child));
  return rest.length > 0 && !rest.startsWith('..') && !isAbsolute(rest);
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter(line => line.length > 0);
}

function nulLines(text: string): string[] {
  return text.split('\0').filter(line => line.length > 0);
}

function worktreePaths(listing: string): string[] {
  const records = listing.includes('\0') ? listing.split('\0') : lines(listing);
  return records
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length));
}

function branchParts(branch: string): readonly [string, string] | undefined {
  if (!branch.startsWith(BRANCH_PREFIX)) return undefined;
  const parts = branch.slice(BRANCH_PREFIX.length).split('/');
  if (parts.length !== 2) return undefined;
  const [runId, taskId] = parts;
  if (!runId || !taskId || !COMPONENT.test(runId) || !COMPONENT.test(taskId)) {
    return undefined;
  }
  return [runId, taskId];
}

function locationForBranch(
  root: string,
  commonDir: string,
  branch: string,
): WorkspaceLocation | undefined {
  const parts = branchParts(branch);
  if (!parts) return undefined;
  const container = join(commonDir, 'subagents');
  const path = join(container, ...parts);
  if (!pathInside(container, path)) return undefined;
  return {root, commonDir, path, branch};
}

function componentValidation(
  label: string,
  value: string,
): WorkspaceError | undefined {
  return COMPONENT.test(value)
    ? undefined
    : new WorkspaceError({
        kind: 'validation',
        message: `${label} must contain only letters, digits, underscores and hyphens.`,
      });
}

function ensureNodeModules(
  root: string,
  path: string,
  kind: WorkspaceError['kind'],
): Effect.Effect<void, WorkspaceError> {
  return Effect.gen(function* () {
    const source = join(root, 'node_modules');
    if (!(yield* pathExists(source))) return;
    const destination = join(path, 'node_modules');
    if (yield* pathExists(destination)) return;
    yield* Effect.tryPromise({
      try: () => symlink(source, destination, 'dir'),
      catch: error =>
        new WorkspaceError({
          kind,
          message:
            error instanceof Error
              ? `Could not link shared node_modules: ${error.message}`
              : 'Could not link shared node_modules.',
        }),
    });
  });
}

function removeSharedNodeModulesLink(
  root: string,
  path: string,
  kind: WorkspaceError['kind'],
): Effect.Effect<void, WorkspaceError> {
  return Effect.gen(function* () {
    const source = join(root, 'node_modules');
    const destination = join(path, 'node_modules');
    if (!(yield* pathExists(destination))) return;
    const stats = yield* Effect.tryPromise({
      try: () => lstat(destination),
      catch: error =>
        new WorkspaceError({
          kind,
          message:
            error instanceof Error
              ? `Could not inspect shared node_modules: ${error.message}`
              : 'Could not inspect shared node_modules.',
        }),
    });
    if (!stats.isSymbolicLink()) return;
    const target = yield* Effect.tryPromise({
      try: () => readlink(destination),
      catch: error =>
        new WorkspaceError({
          kind,
          message:
            error instanceof Error
              ? `Could not read shared node_modules link: ${error.message}`
              : 'Could not read shared node_modules link.',
        }),
    });
    const resolvedTarget = isAbsolute(target)
      ? target
      : resolve(dirname(destination), target);
    if (!samePath(resolvedTarget, source)) return;
    yield* Effect.tryPromise({
      try: () => unlink(destination),
      catch: error =>
        new WorkspaceError({
          kind,
          message:
            error instanceof Error
              ? `Could not remove shared node_modules link: ${error.message}`
              : 'Could not remove shared node_modules link.',
        }),
    });
  });
}

function verifyWorkspace(
  workspace: Workspace,
  kind: 'attach' | 'save' | 'release',
): Effect.Effect<Workspace, WorkspaceError> {
  return Effect.gen(function* () {
    const root = yield* runGit(
      workspace.root,
      ['rev-parse', '--show-toplevel'],
      kind,
    );
    const common = yield* runGit(root, ['rev-parse', '--git-common-dir'], kind);
    const location = locationForBranch(
      root,
      resolve(root, common),
      workspace.branch,
    );
    if (
      !location ||
      !samePath(location.path, workspace.path) ||
      (!samePath(workspace.cwd, workspace.path) &&
        !pathInside(workspace.path, workspace.cwd))
    ) {
      return yield* Effect.fail(
        new WorkspaceError({
          kind,
          message: 'Workspace path is outside its own task worktree.',
        }),
      );
    }
    const registered = worktreePaths(
      yield* runGit(root, ['worktree', 'list', '--porcelain', '-z'], kind),
    );
    if (!registered.some(path => samePath(path, workspace.path))) {
      return yield* Effect.fail(
        new WorkspaceError({
          kind,
          message: 'Workspace is not a registered worktree.',
        }),
      );
    }
    const head = yield* runGit(
      workspace.path,
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      kind,
    );
    if (head !== workspace.branch) {
      return yield* Effect.fail(
        new WorkspaceError({
          kind,
          message: `Workspace HEAD is ${head || 'detached'}, expected ${workspace.branch}.`,
        }),
      );
    }
    const base = yield* runGit(
      root,
      [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${workspace.base}^{commit}`,
      ],
      kind,
    );
    return {
      ...workspace,
      root,
      path: location.path,
      cwd: workspace.cwd,
      base,
    };
  });
}

export function prepareWorkspace(
  cwd: string,
  runId: string,
  taskId: string,
  baseBranch?: string,
): Effect.Effect<Workspace, WorkspaceError> {
  const invalidRun = componentValidation('runId', runId);
  const invalidTask = componentValidation('taskId', taskId);
  if (invalidRun) return Effect.fail(invalidRun);
  if (invalidTask) return Effect.fail(invalidTask);
  if (baseBranch !== undefined && baseBranch.trim().length === 0) {
    return Effect.fail(
      new WorkspaceError({
        kind: 'validation',
        message: 'baseBranch cannot be empty.',
      }),
    );
  }

  return Effect.gen(function* () {
    const root = yield* runGit(
      cwd,
      ['rev-parse', '--show-toplevel'],
      'repository',
    );
    const offset = yield* Effect.tryPromise({
      try: async () => relative(await realpath(root), await realpath(cwd)),
      catch: error =>
        new WorkspaceError({
          kind: 'prepare',
          message: `Could not resolve task directory: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });
    if (offset === '..' || offset.startsWith('../') || isAbsolute(offset))
      return yield* Effect.fail(
        new WorkspaceError({
          kind: 'prepare',
          message: 'Task directory is outside the repository.',
        }),
      );
    const common = yield* runGit(
      root,
      ['rev-parse', '--git-common-dir'],
      'prepare',
    );
    const commonDir = resolve(root, common);
    const container = join(commonDir, 'subagents');
    const path = join(container, runId, taskId);
    const childCwd = join(path, offset);
    const branch = `${BRANCH_PREFIX}${runId}/${taskId}`;
    if (!pathInside(container, path)) {
      return yield* Effect.fail(
        new WorkspaceError({
          kind: 'validation',
          message: 'Workspace path is unsafe.',
        }),
      );
    }
    if (yield* pathExists(path)) {
      return yield* Effect.fail(
        new WorkspaceError({
          kind: 'prepare',
          message: 'Workspace path is already occupied.',
        }),
      );
    }
    const base = yield* runGit(
      root,
      [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${baseBranch ?? 'HEAD'}^{commit}`,
      ],
      'prepare',
    );
    yield* ensureDirectory(dirname(path), 'prepare');
    yield* runGit(
      root,
      ['worktree', 'add', '-b', branch, path, base],
      'prepare',
    );
    yield* ensureDirectory(childCwd, 'prepare').pipe(
      Effect.andThen(ensureNodeModules(root, path, 'prepare')),
      Effect.mapError(
        error =>
          new WorkspaceError({
            kind: 'prepare',
            message: `${error.message} Workspace retained at ${path} on branch ${branch}.`,
          }),
      ),
    );
    return {root, path, cwd: childCwd, branch, base};
  });
}

export function attachWorkspace(
  workspace: Workspace,
): Effect.Effect<Workspace, WorkspaceError> {
  return Effect.gen(function* () {
    const root = yield* runGit(
      workspace.root,
      ['rev-parse', '--show-toplevel'],
      'attach',
    );
    const common = yield* runGit(
      root,
      ['rev-parse', '--git-common-dir'],
      'attach',
    );
    const location = locationForBranch(
      root,
      resolve(root, common),
      workspace.branch,
    );
    if (
      !location ||
      !samePath(location.path, workspace.path) ||
      (!samePath(workspace.cwd, workspace.path) &&
        !pathInside(workspace.path, workspace.cwd))
    ) {
      return yield* Effect.fail(
        new WorkspaceError({
          kind: 'attach',
          message: 'Workspace branch or path is not owned.',
        }),
      );
    }
    const workspacePath = location.path;
    const base = yield* runGit(
      root,
      [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${workspace.base}^{commit}`,
      ],
      'attach',
    );
    yield* runGit(
      root,
      [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `refs/heads/${workspace.branch}^{commit}`,
      ],
      'attach',
    );
    const registered = worktreePaths(
      yield* runGit(root, ['worktree', 'list', '--porcelain', '-z'], 'attach'),
    );
    if (!registered.some(path => samePath(path, workspace.path))) {
      if (yield* pathExists(workspacePath)) {
        return yield* Effect.fail(
          new WorkspaceError({
            kind: 'attach',
            message:
              'Workspace target exists but is not a registered worktree.',
          }),
        );
      }
      yield* ensureDirectory(dirname(workspacePath), 'attach');
      yield* runGit(
        root,
        ['worktree', 'add', workspacePath, workspace.branch],
        'attach',
      );
    } else {
      const head = yield* runGit(
        workspacePath,
        ['symbolic-ref', '--quiet', '--short', 'HEAD'],
        'attach',
      );
      if (head !== workspace.branch) {
        return yield* Effect.fail(
          new WorkspaceError({
            kind: 'attach',
            message: 'Registered worktree has another branch.',
          }),
        );
      }
    }
    yield* ensureNodeModules(root, workspacePath, 'attach');
    yield* ensureDirectory(workspace.cwd, 'attach');
    return {
      ...workspace,
      root,
      path: workspacePath,
      cwd: workspace.cwd,
      base,
    };
  });
}

export function saveWorkspace(
  workspace: Workspace,
  message: string,
): Effect.Effect<WorkspaceSaveResult, WorkspaceError> {
  return Effect.gen(function* () {
    const current = yield* verifyWorkspace(workspace, 'save');
    yield* runGit(
      current.path,
      [
        'add',
        '-A',
        '--',
        '.',
        ':(exclude)node_modules',
        ':(exclude,glob)**/node_modules/**',
      ],
      'save',
    );
    const staged = lines(
      yield* runGit(current.path, ['diff', '--cached', '--name-only'], 'save'),
    );
    if (staged.length > 0) {
      yield* runGit(
        current.path,
        [...COMMIT_CONFIG, 'commit', '-m', message, '--no-verify'],
        'save',
      );
    }
    const commitsAhead = yield* runGit(
      current.root,
      ['rev-list', '--count', `${current.base}..${current.branch}`],
      'save',
    );
    if (commitsAhead === '0') {
      return {status: 'empty', diffStat: '', changedFiles: []};
    }
    const commitSha = yield* runGit(
      current.path,
      ['rev-parse', 'HEAD'],
      'save',
    );
    const changedFiles = nulLines(
      yield* runGit(
        current.root,
        ['diff', '--name-only', '-z', `${current.base}...${current.branch}`],
        'save',
        false,
      ),
    );
    const diffStat = yield* runGit(
      current.root,
      ['diff', '--stat', `${current.base}...${current.branch}`],
      'save',
    );
    return {status: 'committed', commitSha, diffStat, changedFiles};
  });
}

export function releaseWorkspace(
  workspace: Workspace,
): Effect.Effect<void, WorkspaceError> {
  return Effect.gen(function* () {
    const current = yield* verifyWorkspace(workspace, 'release');
    const status = yield* runGit(
      current.path,
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        '.',
        ':(exclude)node_modules',
        ':(exclude,glob)**/node_modules/**',
      ],
      'release',
    );
    if (status.length > 0) {
      return yield* Effect.fail(
        new WorkspaceError({
          kind: 'release',
          message: 'Workspace has uncommitted changes and cannot be released.',
        }),
      );
    }
    yield* removeSharedNodeModulesLink(current.root, current.path, 'release');
    yield* runGit(
      current.root,
      ['worktree', 'remove', current.path],
      'release',
    );
  });
}
