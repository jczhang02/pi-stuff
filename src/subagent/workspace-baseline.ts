import {createHash} from 'node:crypto';
import {
  lstat,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  utimes,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Schema} from 'effect';
import {WorkspaceError} from './workspace-error';
import {
  git,
  gitFailure,
  indexEnvironment,
  repositoryCommit,
  requireGit,
} from './workspace-git';

const CAPTURE_ATTEMPTS = 2;

interface SourceFingerprint {
  head: string;
  value: string;
}

async function sourceFingerprint(
  repository: string,
  include: readonly string[],
  signal: AbortSignal,
): Promise<SourceFingerprint> {
  const head = requireGit(
    'read source HEAD',
    await git(['rev-parse', '--verify', 'HEAD^{commit}'], repository, signal),
    'capture',
  );
  const cached = requireGit(
    'read staged source changes',
    await git(
      ['diff', '--cached', '--no-ext-diff', '--raw', '-z', '--'],
      repository,
      signal,
    ),
    'capture',
  );
  const working = requireGit(
    'read source changes',
    await git(
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--binary',
        '--full-index',
        'HEAD',
        '--',
      ],
      repository,
      signal,
    ),
    'capture',
  );
  const statusResult = await git(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored'],
    repository,
    signal,
  );
  if (statusResult.code !== 0)
    throw gitFailure('read source status', statusResult, 'capture');
  const status = statusResult.stdout;
  const selected = await Promise.all(
    include.map(path => fingerprintPath(repository, path)),
  );
  return {
    head,
    value: JSON.stringify({head, cached, working, status, selected}),
  };
}

async function fingerprintPath(root: string, path: string): Promise<string> {
  const absolute = path === '.' ? root : join(root, ...path.split('/'));
  try {
    const entry = await lstat(absolute);
    if (entry.isSymbolicLink())
      return `${path}:link:${await readlink(absolute)}`;
    if (entry.isDirectory()) {
      const children = (await readdir(absolute, {withFileTypes: true}))
        .filter(child => child.name !== '.git')
        .sort((a, b) => a.name.localeCompare(b.name));
      const nested = await Promise.all(
        children.map(child =>
          fingerprintPath(
            root,
            `${path === '.' ? '' : `${path}/`}${child.name}`,
          ),
        ),
      );
      return `${path}:directory:${nested.join('|')}`;
    }
    const contents = await readFile(absolute);
    return `${path}:file:${createHash('sha256').update(contents).digest('hex')}`;
  } catch (error) {
    if (Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}))(error))
      return `${path}:missing`;
    throw error;
  }
}

export async function captureBaseline(
  repository: string,
  include: readonly string[],
  taskId: string,
  signal: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt++) {
    const before = await sourceFingerprint(repository, include, signal);
    const parent = await repositoryCommit(repository, signal);
    if (before.head !== parent) continue;
    const temporary = await mkdtemp(join(tmpdir(), 'pi-stuff-index-'));
    const index = join(temporary, 'index');
    try {
      const sourceIndex = requireGit(
        'locate source index',
        await git(
          ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
          repository,
          signal,
        ),
        'capture',
      );
      const sourceIndexStat = await stat(sourceIndex);
      await copyFile(sourceIndex, index);
      // A newer copied index disables Git's racy-stat protection. Keep its
      // timestamp conservatively older without discarding intent-to-add,
      // skip-worktree or other index metadata. Whole seconds avoid rounding
      // a nanosecond source timestamp forward during the utimes conversion.
      const captureTime = Math.floor(sourceIndexStat.mtimeMs / 1000) - 1;
      await utimes(index, captureTime, captureTime);
      requireGit(
        'capture tracked source changes',
        await git(['add', '-u'], repository, signal, indexEnvironment(index)),
        'capture',
      );
      if (include.length > 0)
        requireGit(
          'capture selected source files',
          await git(
            ['add', '-f', '--', ...include],
            repository,
            signal,
            indexEnvironment(index),
          ),
          'capture',
        );
      const tree = requireGit(
        'write source baseline tree',
        await git(['write-tree'], repository, signal, indexEnvironment(index)),
        'capture',
      );
      const commit = requireGit(
        'save source baseline',
        await git(
          [
            'commit-tree',
            tree,
            '-p',
            parent,
            '-m',
            `Pi Stuff workspace baseline ${taskId}`,
          ],
          repository,
          signal,
          {
            ...indexEnvironment(index),
            GIT_AUTHOR_NAME: 'Pi Stuff',
            GIT_AUTHOR_EMAIL: 'pi-stuff@localhost',
            GIT_COMMITTER_NAME: 'Pi Stuff',
            GIT_COMMITTER_EMAIL: 'pi-stuff@localhost',
          },
        ),
        'capture',
      ).split('\n')[0];
      const after = await sourceFingerprint(repository, include, signal);
      if (
        before.value === after.value &&
        commit !== undefined &&
        commit.length > 0
      )
        return commit;
    } finally {
      await rm(temporary, {recursive: true, force: true});
    }
  }
  throw new WorkspaceError({
    kind: 'race',
    message: 'Source changed while its workspace baseline was being captured.',
  });
}
