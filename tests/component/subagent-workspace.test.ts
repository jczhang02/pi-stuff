import {expect, test} from 'bun:test';
import {execFile} from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {Effect} from 'effect';
import {
  attachWorkspace,
  prepareWorkspace,
  releaseWorkspace,
  saveWorkspace,
} from '../../src/subagent/workspace';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  return result.stdout.trim();
}

async function makeRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi-workspace-'));
  await git(root, ['init', '-b', 'main']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(root, ['add', 'base.txt']);
  await git(root, [
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'initial',
  ]);
  return root;
}

test('prepareWorkspace creates an isolated worktree from clean HEAD', async () => {
  const root = await makeRepository();
  try {
    await writeFile(join(root, 'dirty.txt'), 'parent-only\n');
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-1', 'task-1'),
    );

    expect(workspace.root).toBe(root);
    expect(workspace.cwd).toBe(workspace.path);
    expect(workspace.branch).toBe('subagents/run-1/task-1');
    expect(await readFile(join(workspace.cwd, 'base.txt'), 'utf8')).toBe(
      'base\n',
    );
    await expect(
      readFile(join(workspace.cwd, 'dirty.txt'), 'utf8'),
    ).rejects.toThrow();

    await Effect.runPromise(releaseWorkspace(workspace));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('saveWorkspace commits and reports actual Git evidence', async () => {
  const root = await makeRepository();
  try {
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-save', 'task-save'),
    );
    await writeFile(join(workspace.cwd, 'change.txt'), 'saved\n');

    const result = await Effect.runPromise(
      saveWorkspace(workspace, 'save fixture change'),
    );

    expect(result.status).toBe('committed');
    if (result.status === 'committed') {
      expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.changedFiles).toEqual(['change.txt']);
      expect(result.diffStat).toContain('change.txt');
    }
    expect(await git(workspace.cwd, ['log', '-1', '--pretty=%s'])).toBe(
      'save fixture change',
    );

    await Effect.runPromise(releaseWorkspace(workspace));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('saveWorkspace reports a commit made before its save pass', async () => {
  const root = await makeRepository();
  try {
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-manual-commit', 'task-manual-commit'),
    );
    await writeFile(join(workspace.cwd, 'manual.txt'), 'manual\n');
    await git(workspace.cwd, ['add', 'manual.txt']);
    await git(workspace.cwd, [
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'manual child commit',
    ]);

    const result = await Effect.runPromise(
      saveWorkspace(workspace, 'save after manual commit'),
    );

    expect(result.status).toBe('committed');
    if (result.status === 'committed') {
      expect(result.commitSha).toBe(
        await git(workspace.cwd, ['rev-parse', 'HEAD']),
      );
      expect(result.changedFiles).toEqual(['manual.txt']);
      expect(result.diffStat).toContain('manual.txt');
    }

    await Effect.runPromise(releaseWorkspace(workspace));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('saveWorkspace preserves unusual changed file names', async () => {
  const root = await makeRepository();
  try {
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-raw-path', 'task-raw-path'),
    );
    const filename = 'line\nname.txt';
    await writeFile(join(workspace.cwd, filename), 'raw path\n');

    const result = await Effect.runPromise(
      saveWorkspace(workspace, 'raw path change'),
    );

    expect(result.status).toBe('committed');
    if (result.status === 'committed') {
      expect(result.changedFiles).toEqual([filename]);
    }
    await Effect.runPromise(releaseWorkspace(workspace));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('attachWorkspace recovers its own saved branch', async () => {
  const root = await makeRepository();
  try {
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-attach', 'task-attach'),
    );
    await writeFile(join(workspace.cwd, 'saved.txt'), 'saved\n');
    await Effect.runPromise(saveWorkspace(workspace, 'attach fixture change'));
    await Effect.runPromise(releaseWorkspace(workspace));

    const attached = await Effect.runPromise(attachWorkspace(workspace));
    expect(attached.branch).toBe(workspace.branch);
    expect(await readFile(join(attached.cwd, 'saved.txt'), 'utf8')).toBe(
      'saved\n',
    );

    await Effect.runPromise(releaseWorkspace(attached));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a task started in a subdirectory keeps that directory after reattachment', async () => {
  const root = await makeRepository();
  try {
    const selected = join(root, 'packages', 'worker');
    await mkdir(selected, {recursive: true});
    const workspace = await Effect.runPromise(
      prepareWorkspace(selected, 'run-subdir', 'task-subdir'),
    );
    expect(workspace.cwd).toBe(join(workspace.path, 'packages', 'worker'));
    await writeFile(join(workspace.cwd, 'child.txt'), 'subdirectory result\n');
    await Effect.runPromise(saveWorkspace(workspace, 'subdirectory change'));
    await Effect.runPromise(releaseWorkspace(workspace));
    const attached = await Effect.runPromise(attachWorkspace(workspace));
    expect(attached.cwd).toBe(workspace.cwd);
    expect(await readFile(join(attached.cwd, 'child.txt'), 'utf8')).toBe(
      'subdirectory result\n',
    );
    await Effect.runPromise(releaseWorkspace(attached));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('independent writers stay separate and a selected base is visible', async () => {
  const root = await makeRepository();
  try {
    await writeFile(join(root, 'parent-dirty.txt'), 'parent only\n');
    const first = await Effect.runPromise(
      prepareWorkspace(root, 'run-writers', 'task-first'),
    );
    await writeFile(join(first.cwd, 'first.txt'), 'first\n');
    await Effect.runPromise(saveWorkspace(first, 'first writer'));

    const independent = await Effect.runPromise(
      prepareWorkspace(root, 'run-writers', 'task-independent'),
    );
    expect(independent.path).not.toBe(first.path);
    await expect(
      readFile(join(independent.cwd, 'first.txt'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(independent.cwd, 'parent-dirty.txt'), 'utf8'),
    ).rejects.toThrow();

    const stacked = await Effect.runPromise(
      prepareWorkspace(root, 'run-writers', 'task-stacked', first.branch),
    );
    expect(await readFile(join(stacked.cwd, 'first.txt'), 'utf8')).toBe(
      'first\n',
    );
    expect(stacked.base).toBe(
      await git(root, ['rev-parse', `${first.branch}^{commit}`]),
    );

    await Effect.runPromise(releaseWorkspace(stacked));
    await Effect.runPromise(releaseWorkspace(independent));
    await Effect.runPromise(releaseWorkspace(first));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('prepareWorkspace rejects an invalid selected base without creating a fallback', async () => {
  const root = await makeRepository();
  try {
    await expect(
      Effect.runPromise(
        prepareWorkspace(
          root,
          'run-invalid-base',
          'task-invalid-base',
          'missing',
        ),
      ),
    ).rejects.toMatchObject({kind: 'prepare'});
    expect(
      await git(root, [
        'branch',
        '--list',
        'subagents/run-invalid-base/task-invalid-base',
      ]),
    ).toBe('');
    await expect(
      readFile(
        join(
          root,
          '.git',
          'subagents',
          'run-invalid-base',
          'task-invalid-base',
        ),
      ),
    ).rejects.toThrow();
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('attachWorkspace does not delete an occupied unknown target', async () => {
  const root = await makeRepository();
  try {
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-occupied', 'task-occupied'),
    );
    await Effect.runPromise(releaseWorkspace(workspace));
    await mkdir(workspace.path, {recursive: true});
    await writeFile(join(workspace.path, 'sentinel.txt'), 'keep\n');

    await expect(
      Effect.runPromise(attachWorkspace(workspace)),
    ).rejects.toMatchObject({kind: 'attach'});
    expect(await readFile(join(workspace.path, 'sentinel.txt'), 'utf8')).toBe(
      'keep\n',
    );

    await rm(workspace.path, {recursive: true, force: true});
    const attached = await Effect.runPromise(attachWorkspace(workspace));
    await Effect.runPromise(releaseWorkspace(attached));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('saveWorkspace retains a failed commit worktree for recovery', async () => {
  const root = await makeRepository();
  try {
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-save-failure', 'task-save-failure'),
    );
    await writeFile(join(workspace.cwd, 'failed-save.txt'), 'retain\n');

    await expect(
      Effect.runPromise(saveWorkspace(workspace, '')),
    ).rejects.toMatchObject({kind: 'save'});
    expect(await readFile(join(workspace.cwd, 'failed-save.txt'), 'utf8')).toBe(
      'retain\n',
    );

    await git(workspace.cwd, ['reset', '--hard', 'HEAD']);
    await Effect.runPromise(releaseWorkspace(workspace));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('releaseWorkspace retains dirty work and node_modules stays shared', async () => {
  const root = await makeRepository();
  try {
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'shared.txt'), 'shared\n');
    const workspace = await Effect.runPromise(
      prepareWorkspace(root, 'run-retain', 'task-retain'),
    );
    const dependency = await lstat(join(workspace.cwd, 'node_modules'));
    expect(dependency.isSymbolicLink()).toBe(true);
    expect(await readlink(join(workspace.cwd, 'node_modules'))).toBe(
      join(root, 'node_modules'),
    );
    expect(
      await readFile(join(workspace.cwd, 'node_modules', 'shared.txt'), 'utf8'),
    ).toBe('shared\n');

    await writeFile(join(workspace.cwd, 'unsaved.txt'), 'retain\n');
    await expect(
      Effect.runPromise(releaseWorkspace(workspace)),
    ).rejects.toMatchObject({kind: 'release'});
    expect(await readFile(join(workspace.cwd, 'unsaved.txt'), 'utf8')).toBe(
      'retain\n',
    );

    await Effect.runPromise(saveWorkspace(workspace, 'retained change'));
    await Effect.runPromise(releaseWorkspace(workspace));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
