import {Effect, Schema} from 'effect';
import {mkdir} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {captureBaseline} from './workspace-baseline';
import {WorkspaceError} from './workspace-error';
import {
  addWorktree,
  artifactRef,
  baselineRef,
  canonicalPath,
  existingDirectory,
  findRepository,
  forgetMissingWorktree,
  git,
  gitFailure,
  normalizePaths,
  repositoryHead,
  requireGit,
  resolveCommit,
  retainRef,
  segment,
  within,
  worktreeCommit,
  worktreeRepository,
  workspaceRef,
  workspaceStatus,
} from './workspace-git';

export {WorkspaceError} from './workspace-error';

const WORKSPACE_MODES = ['snapshot', 'write', 'live', 'direct'] as const;

export const Workspace = Schema.Struct({
  directory: Schema.String,
  cwd: Schema.String,
  repository: Schema.NullOr(Schema.String),
  baseline: Schema.mutableKey(Schema.NullOr(Schema.String)),
  mode: Schema.Literals(WORKSPACE_MODES),
  released: Schema.mutableKey(Schema.Boolean),
  restoredFrom: Schema.optional(Schema.String),
});
export type Workspace = typeof Workspace.Type;

export interface WorkspaceRequest {
  agentId: string;
  taskId: string;
  source: string;
  directory: string;
  mode: (typeof WORKSPACE_MODES)[number];
  baseline?: string;
  include?: string[];
}

export const Artifact = Schema.Struct({
  commit: Schema.NullOr(Schema.String),
  baseline: Schema.NullOr(Schema.String),
  diff: Schema.String,
  files: Schema.Array(Schema.String),
  checks: Schema.Array(Schema.String),
});
export type Artifact = typeof Artifact.Type;

export const WorkspaceInspection = Schema.Struct({
  dirty: Schema.Boolean,
  files: Schema.Array(Schema.String),
  ignored: Schema.Array(Schema.String),
});
export type WorkspaceInspection = typeof WorkspaceInspection.Type;

function parseWorkspaceStatus(status: string): WorkspaceInspection {
  const files: string[] = [];
  const ignored: string[] = [];
  const entries = status.split('\0').filter(entry => entry.length > 0);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.length < 3) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    let relatedPath: string | undefined;
    if (code.includes('R') || code.includes('C')) {
      relatedPath = entries[index + 1];
      if (relatedPath !== undefined) {
        index += 1;
      }
    }
    if (code === '!!') ignored.push(path);
    else {
      files.push(path);
      if (relatedPath !== undefined) files.push(relatedPath);
    }
  }
  return {dirty: files.length > 0 || ignored.length > 0, files, ignored};
}

async function inspectWorkspaceInternal(
  workspace: Workspace,
  signal: AbortSignal,
): Promise<WorkspaceInspection> {
  if (workspace.released)
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace was released.',
    });
  if (workspace.mode === 'direct')
    return {dirty: false, files: [], ignored: []};
  if (workspace.repository === null) {
    if (workspace.mode === 'live')
      return {dirty: false, files: [], ignored: []};
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The retained workspace has no Git repository.',
    });
  }
  if (!(await existingDirectory(workspace.directory)))
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace directory is missing.',
    });
  const repository = await worktreeRepository(workspace.directory, signal);
  if (repository !== workspace.repository)
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace repository changed.',
    });
  return parseWorkspaceStatus(
    await workspaceStatus(workspace.directory, signal),
  );
}

export function inspectWorkspace(
  workspace: Workspace,
): Effect.Effect<WorkspaceInspection, WorkspaceError> {
  return Effect.tryPromise({
    try: signal => inspectWorkspaceInternal(workspace, signal),
    catch: error =>
      Schema.is(WorkspaceError)(error)
        ? error
        : new WorkspaceError({
            kind: 'io',
            message: 'Could not inspect the workspace.',
          }),
  });
}

async function prepareWorkspaceInternal(
  request: WorkspaceRequest,
  previous: Workspace | undefined,
  signal: AbortSignal,
): Promise<Workspace> {
  const agent = segment(request.agentId, 'agentId');
  const task = segment(request.taskId, 'taskId');
  const source = await canonicalPath(request.source);
  if (!(await existingDirectory(source)))
    throw new WorkspaceError({
      kind: 'input',
      message: 'Workspace source must be a directory.',
    });
  const state = resolve(request.directory);
  const include = request.include ?? [];
  const mode =
    previous !== undefined && request.baseline === undefined
      ? previous.mode
      : request.mode;

  if (previous !== undefined && previous.released)
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace was released.',
    });

  if (mode === 'direct') {
    if (request.baseline !== undefined)
      throw new WorkspaceError({
        kind: 'input',
        message: 'Direct workspaces cannot select a baseline.',
      });
    if (previous !== undefined && previous.mode !== 'direct')
      throw new WorkspaceError({
        kind: 'input',
        message: 'A retained Git workspace cannot become direct.',
      });
    if (
      previous !== undefined &&
      (await canonicalPath(previous.directory)) !== source
    )
      throw new WorkspaceError({
        kind: 'workspace',
        message: 'The retained direct workspace changed.',
      });
    return {
      directory: source,
      cwd: source,
      repository: null,
      baseline: null,
      mode: 'direct',
      released: false,
    };
  }

  const checkout = await findRepository(source, signal);
  if (checkout === null) {
    if (mode === 'live') {
      if (request.baseline !== undefined)
        throw new WorkspaceError({
          kind: 'input',
          message: 'Live workspaces cannot select a baseline.',
        });
      if (previous !== undefined) {
        if (previous.mode !== 'live' || previous.repository !== null)
          throw new WorkspaceError({
            kind: 'workspace',
            message: 'The retained workspace repository changed.',
          });
        if ((await canonicalPath(previous.directory)) !== source)
          throw new WorkspaceError({
            kind: 'workspace',
            message: 'The retained live workspace changed.',
          });
      }
      return {
        directory: source,
        cwd: source,
        repository: null,
        baseline: null,
        mode: 'live',
        released: false,
      };
    }
    throw new WorkspaceError({
      kind: 'unsupported',
      message: `${mode} mode requires a Git repository.`,
    });
  }
  const repository = await worktreeRepository(checkout, signal);
  const sourceOffset = relative(checkout, source);

  if (previous !== undefined) {
    if (previous.repository !== repository)
      throw new WorkspaceError({
        kind: 'workspace',
        message: 'The retained workspace repository changed.',
      });
    const previousDirectory = resolve(previous.directory);
    if (previous.mode === 'live' || mode === 'live') {
      if (request.baseline !== undefined)
        throw new WorkspaceError({
          kind: 'input',
          message: 'Live workspaces cannot select a baseline.',
        });
      return {
        directory: source,
        cwd: source,
        repository,
        baseline: await repositoryHead(checkout, signal),
        mode: 'live',
        released: false,
      };
    }
    if (!within(state, previousDirectory))
      throw new WorkspaceError({
        kind: 'workspace',
        message: 'The retained workspace escaped its owner directory.',
      });
    if (!(await existingDirectory(previousDirectory))) {
      const savedBaseline = request.baseline ?? previous.baseline;
      if (savedBaseline === null)
        throw new WorkspaceError({
          kind: 'workspace',
          message:
            'The missing workspace has no saved baseline; unsaved content cannot be recovered.',
        });
      const commit = await resolveCommit(repository, savedBaseline, signal);
      await forgetMissingWorktree(repository, previousDirectory, signal);
      await addWorktree(repository, previousDirectory, commit, signal);
      await retainRef(repository, baselineRef(task, commit), commit, signal);
      await retainRef(repository, workspaceRef(task), commit, signal);
      return {
        directory: previousDirectory,
        cwd: join(previousDirectory, sourceOffset),
        repository,
        baseline: commit,
        mode,
        released: false,
        restoredFrom: commit,
      };
    }
    const actualRepository = await worktreeRepository(
      previousDirectory,
      signal,
    );
    if (actualRepository !== repository)
      throw new WorkspaceError({
        kind: 'workspace',
        message: 'The retained workspace is bound to another repository.',
      });
    const current = await worktreeCommit(previousDirectory, signal);
    if (request.baseline !== undefined) {
      const requested = await resolveCommit(
        repository,
        request.baseline,
        signal,
      );
      if (requested !== current) {
        const status = await workspaceStatus(previousDirectory, signal);
        if (status.length > 0)
          throw new WorkspaceError({
            kind: 'workspace',
            message:
              'Cannot change the workspace baseline while it has unsaved content.',
          });
        requireGit(
          'change workspace baseline',
          await git(['reset', '--hard', requested], previousDirectory, signal),
          'workspace',
        );
        await retainRef(
          repository,
          baselineRef(task, requested),
          requested,
          signal,
        );
        await retainRef(repository, workspaceRef(task), requested, signal);
        return {
          directory: previousDirectory,
          cwd: join(previousDirectory, sourceOffset),
          repository,
          baseline: requested,
          mode,
          released: false,
        };
      }
    }
    await retainRef(repository, baselineRef(task, current), current, signal);
    await retainRef(repository, workspaceRef(task), current, signal);
    return {
      directory: previousDirectory,
      cwd: join(previousDirectory, sourceOffset),
      repository,
      baseline: current,
      mode,
      released: false,
    };
  }

  if (mode === 'live') {
    if (request.baseline !== undefined)
      throw new WorkspaceError({
        kind: 'input',
        message: 'Live workspaces cannot select a baseline.',
      });
    return {
      directory: source,
      cwd: source,
      repository,
      baseline: await repositoryHead(checkout, signal),
      mode: 'live',
      released: false,
    };
  }

  const workspaceDirectory = join(state, agent);
  await mkdir(state, {recursive: true, mode: 0o700});
  if (await existingDirectory(workspaceDirectory))
    throw new WorkspaceError({
      kind: 'workspace',
      message:
        'An existing workspace needs an explicit retained workspace record.',
    });
  const baseline =
    request.baseline === undefined
      ? await captureBaseline(
          checkout,
          normalizePaths(
            checkout,
            include.map(path => resolve(source, path)),
            'include',
          ),
          task,
          signal,
        )
      : await resolveCommit(repository, request.baseline, signal);
  await retainRef(repository, baselineRef(task, baseline), baseline, signal);
  await addWorktree(repository, workspaceDirectory, baseline, signal);
  await retainRef(repository, workspaceRef(task), baseline, signal);
  return {
    directory: workspaceDirectory,
    cwd: join(workspaceDirectory, sourceOffset),
    repository,
    baseline,
    mode,
    released: false,
  };
}

export function prepareWorkspace(
  request: WorkspaceRequest,
  previous?: Workspace,
): Effect.Effect<Workspace, WorkspaceError> {
  return Effect.tryPromise({
    try: signal => prepareWorkspaceInternal(request, previous, signal),
    catch: error =>
      Schema.is(WorkspaceError)(error)
        ? error
        : new WorkspaceError({
            kind: 'io',
            message: 'Could not prepare the workspace.',
          }),
  });
}

async function saveArtifactInternal(
  workspace: Workspace,
  taskId: string,
  paths: readonly string[],
  checks: readonly string[],
  signal: AbortSignal,
): Promise<Artifact> {
  if (workspace.released)
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace was released.',
    });
  if (workspace.mode !== 'write' || workspace.repository === null)
    throw new WorkspaceError({
      kind: 'artifact',
      message: 'Only Git write workspaces can save artifacts.',
    });
  segment(taskId, 'taskId');
  if (!(await existingDirectory(workspace.directory)))
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace directory is missing.',
    });
  const repository = await worktreeRepository(workspace.directory, signal);
  if (repository !== workspace.repository)
    throw new WorkspaceError({
      kind: 'workspace',
      message: 'The workspace repository changed.',
    });
  const normalized = normalizePaths(
    workspace.directory,
    paths.map(path => resolve(workspace.cwd, path)),
    'artifact paths',
  );
  const head = await worktreeCommit(workspace.directory, signal);
  const baseline =
    workspace.baseline === null
      ? head
      : await resolveCommit(repository, workspace.baseline, signal);
  const committedPaths = requireGit(
    'inspect committed artifact scope',
    await git(
      ['diff', '--no-renames', '--name-only', '-z', baseline, head, '--'],
      workspace.directory,
      signal,
    ),
    'artifact',
  )
    .split('\0')
    .filter(Boolean);
  const selectedCommittedPaths = normalized.length
    ? requireGit(
        'inspect selected committed paths',
        await git(
          [
            'diff',
            '--no-renames',
            '--name-only',
            '-z',
            baseline,
            head,
            '--',
            ...normalized,
          ],
          workspace.directory,
          signal,
        ),
        'artifact',
      )
        .split('\0')
        .filter(Boolean)
    : [];
  const undeclared = committedPaths.filter(
    path => !selectedCommittedPaths.includes(path),
  );
  if (undeclared.length)
    throw new WorkspaceError({
      kind: 'artifact',
      message: `Committed changes outside declared artifact paths: ${undeclared.join(', ')}. Declare the complete intended change set before delivery.`,
    });
  if (!normalized.length)
    return {commit: null, baseline, diff: '', files: [], checks: [...checks]};
  requireGit(
    'stage artifact paths',
    await git(
      ['add', '-A', '-f', '--', ...normalized],
      workspace.directory,
      signal,
    ),
    'artifact',
  );
  const staged = await git(
    ['diff', '--cached', '--quiet', '--', ...normalized],
    workspace.directory,
    signal,
  );
  if (staged.code !== 0 && staged.code !== 1)
    throw gitFailure('inspect artifact paths', staged, 'artifact');
  if (staged.code === 1)
    requireGit(
      'save artifact commit',
      await git(
        [
          '-c',
          'user.name=Pi Stuff',
          '-c',
          'user.email=pi-stuff@localhost',
          '-c',
          'commit.gpgSign=false',
          'commit',
          '--only',
          '--no-verify',
          '-m',
          'Pi Stuff task artifact',
          '--',
          ...normalized,
        ],
        workspace.directory,
        signal,
      ),
      'artifact',
    );
  const commit = await worktreeCommit(workspace.directory, signal);
  const diff = requireGit(
    'read artifact diff',
    await git(
      [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--binary',
        baseline,
        commit,
        '--',
        ...normalized,
      ],
      workspace.directory,
      signal,
    ),
    'artifact',
  );
  const filesText = requireGit(
    'read artifact files',
    await git(
      ['diff', '--name-only', '-z', baseline, commit, '--', ...normalized],
      workspace.directory,
      signal,
    ),
    'artifact',
  );
  const files = filesText.split('\0').filter(file => file.length > 0);
  workspace.baseline = commit;
  if (!files.length)
    return {commit: null, baseline, diff: '', files: [], checks: [...checks]};
  await retainRef(
    workspace.repository,
    artifactRef(taskId, commit),
    commit,
    signal,
  );
  await retainRef(workspace.repository, workspaceRef(taskId), commit, signal);
  return {commit, baseline, diff, files, checks: [...checks]};
}

export function saveArtifact(
  workspace: Workspace,
  taskId: string,
  paths: string[],
  checks: string[],
): Effect.Effect<Artifact, WorkspaceError> {
  return Effect.tryPromise({
    try: signal =>
      saveArtifactInternal(workspace, taskId, paths, checks, signal),
    catch: error =>
      Schema.is(WorkspaceError)(error)
        ? error
        : new WorkspaceError({
            kind: 'io',
            message: 'Could not save the workspace artifact.',
          }),
  });
}

async function releaseWorkspaceInternal(
  workspace: Workspace,
  signal: AbortSignal,
): Promise<void> {
  if (workspace.released) return;
  if (workspace.mode === 'direct' || workspace.mode === 'live') {
    workspace.released = true;
    return;
  }
  if (!(await existingDirectory(workspace.directory)))
    throw new WorkspaceError({
      kind: 'release',
      message: 'The workspace directory is missing.',
    });
  if (workspace.repository === null)
    throw new WorkspaceError({
      kind: 'release',
      message: 'A non-Git retained workspace cannot be released.',
    });
  const repository = await worktreeRepository(workspace.directory, signal);
  if (repository !== workspace.repository)
    throw new WorkspaceError({
      kind: 'release',
      message: 'The workspace repository changed.',
    });
  const status = await workspaceStatus(workspace.directory, signal);
  if (status.length > 0)
    throw new WorkspaceError({
      kind: 'release',
      message:
        'Workspace contains unsaved tracked, untracked, or ignored content.',
    });
  requireGit(
    'release worktree',
    await git(['worktree', 'remove', workspace.directory], repository, signal),
    'release',
  );
  workspace.released = true;
}

export function releaseWorkspace(
  workspace: Workspace,
): Effect.Effect<void, WorkspaceError> {
  return Effect.tryPromise({
    try: signal => releaseWorkspaceInternal(workspace, signal),
    catch: error =>
      Schema.is(WorkspaceError)(error)
        ? error
        : new WorkspaceError({
            kind: 'io',
            message: 'Could not release the workspace.',
          }),
  });
}
