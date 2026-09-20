import {expect, test} from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import {
  Artifact,
  Workspace,
  inspectWorkspace,
  prepareWorkspace,
  releaseWorkspace,
  saveArtifact,
} from '../../src/subagent/workspace';

test('workspace and artifact schemas decode nullable persisted records', () => {
  const workspace = Schema.decodeUnknownSync(Workspace)({
    directory: '/tmp/workspace',
    cwd: '/tmp/workspace',
    repository: null,
    baseline: null,
    mode: 'snapshot',
    released: false,
  });
  const artifact = Schema.decodeUnknownSync(Artifact)({
    commit: null,
    baseline: null,
    diff: '',
    files: [],
    checks: [],
  });
  expect(workspace.repository).toBeNull();
  expect(artifact.commit).toBeNull();
});

const runGit = async (directory: string, args: string[]) => {
  const process = Bun.spawn(['git', '-C', directory, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  return stdout.trim();
};

const createRepository = async (root: string) => {
  const source = join(root, 'source');
  const state = join(root, 'state');
  await runGit(root, ['init', source]);
  await runGit(source, ['config', 'user.name', 'Fixture']);
  await runGit(source, ['config', 'user.email', 'fixture@example.com']);
  await writeFile(join(source, 'tracked.txt'), 'before\n');
  await runGit(source, ['add', 'tracked.txt']);
  await runGit(source, ['commit', '-m', 'initial']);
  return {source, state};
};

test('write preparation snapshots tracked changes and selected untracked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-workspace-'));
  const state = join(root, 'state');
  const source = join(root, 'source');
  try {
    await runGit(root, ['init', source]);
    await runGit(source, ['config', 'user.name', 'Fixture']);
    await runGit(source, ['config', 'user.email', 'fixture@example.com']);
    await writeFile(join(source, 'tracked.txt'), 'before\n');
    await runGit(source, ['add', 'tracked.txt']);
    await runGit(source, ['commit', '-m', 'initial']);
    await writeFile(join(source, 'tracked.txt'), 'after\n');
    await writeFile(join(source, 'selected.txt'), 'selected\n');
    await writeFile(join(source, 'ignored.txt'), 'ignored\n');
    await writeFile(join(source, '.gitignore'), 'ignored.txt\n');
    const sourceIndex = await runGit(source, ['write-tree']);
    const sourceStatus = await runGit(source, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]);

    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-1',
        taskId: 'task-1',
        source,
        directory: state,
        mode: 'write',
        include: ['selected.txt'],
      }),
    );

    expect(workspace.repository).toBe(source);
    expect(workspace.mode).toBe('write');
    expect(workspace.released).toBe(false);
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe('after\n');
    expect(await readFile(join(source, 'selected.txt'), 'utf8')).toBe(
      'selected\n',
    );
    expect(await runGit(source, ['write-tree'])).toBe(sourceIndex);
    expect(
      await runGit(source, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]),
    ).toBe(sourceStatus);
    expect(
      await readFile(join(workspace.directory, 'tracked.txt'), 'utf8'),
    ).toBe('after\n');
    expect(
      await readFile(join(workspace.directory, 'selected.txt'), 'utf8'),
    ).toBe('selected\n');
    await expect(
      readFile(join(workspace.directory, 'ignored.txt'), 'utf8'),
    ).rejects.toThrow();
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('snapshot rechecks racy tracked and staged-new contents without changing the source index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-racy-index-'));
  try {
    const {source, state} = await createRepository(root);
    await runGit(source, ['config', 'core.trustctime', 'false']);
    const tracked = join(source, 'tracked.txt');
    const staged = join(source, 'staged.txt');
    await writeFile(staged, 'staged1\n');
    await runGit(source, ['add', 'staged.txt']);
    const timestamp = new Date('2000-01-01T00:00:00Z');
    await utimes(tracked, timestamp, timestamp);
    await utimes(staged, timestamp, timestamp);
    await runGit(source, ['update-index', '--refresh']);
    const index = join(source, '.git', 'index');
    await utimes(index, timestamp, timestamp);
    await writeFile(tracked, 'after!\n');
    await writeFile(staged, 'staged2\n');
    await utimes(tracked, timestamp, timestamp);
    await utimes(staged, timestamp, timestamp);
    const originalIndex = await readFile(index);

    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'reader',
        taskId: 'racy-index',
        source,
        directory: state,
        mode: 'snapshot',
      }),
    );
    expect(
      await readFile(join(workspace.directory, 'tracked.txt'), 'utf8'),
    ).toBe('after!\n');
    expect(
      await readFile(join(workspace.directory, 'staged.txt'), 'utf8'),
    ).toBe('staged2\n');
    expect(await readFile(index)).toEqual(originalIndex);
    expect(await runGit(source, ['show', ':tracked.txt'])).toBe('before');
    expect(await runGit(source, ['show', ':staged.txt'])).toBe('staged1');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('snapshot preserves intent-to-add and skip-worktree entries in the source index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-index-flags-'));
  try {
    const {source, state} = await createRepository(root);
    await runGit(source, ['update-index', '--skip-worktree', 'tracked.txt']);
    await rm(join(source, 'tracked.txt'));
    await writeFile(join(source, 'intent.txt'), 'intent content\n');
    await runGit(source, ['add', '-N', 'intent.txt']);
    const index = join(source, '.git', 'index');
    const originalIndex = await readFile(index);
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'reader',
        taskId: 'index-flags',
        source,
        directory: state,
        mode: 'snapshot',
      }),
    );
    const contents = await Promise.all(
      ['tracked.txt', 'intent.txt'].map(name =>
        readFile(join(workspace.directory, name), 'utf8').catch(
          () => 'missing',
        ),
      ),
    );
    expect(contents).toEqual(['before\n', 'intent content\n']);
    expect(await readFile(index)).toEqual(originalIndex);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('artifact saving is scoped and release inspects ignored content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-artifact-'));
  try {
    const {source, state} = await createRepository(root);
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-1',
        taskId: 'task-1',
        source,
        directory: state,
        mode: 'write',
      }),
    );
    await writeFile(join(workspace.directory, 'tracked.txt'), 'saved\n');
    await writeFile(join(workspace.directory, 'unrelated.txt'), 'keep\n');
    await runGit(workspace.directory, ['add', 'unrelated.txt']);
    await writeFile(join(workspace.directory, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(workspace.directory, 'ignored.txt'), 'keep too\n');
    const inspection = await Effect.runPromise(inspectWorkspace(workspace));
    expect(inspection.dirty).toBe(true);
    expect(inspection.files).toContain('tracked.txt');
    expect(inspection.ignored).toEqual(['ignored.txt']);

    const taskBaseline = workspace.baseline;
    const artifact = await Effect.runPromise(
      saveArtifact(workspace, 'task-1', ['tracked.txt'], ['check fixture']),
    );
    expect(artifact.commit).not.toBeNull();
    expect(artifact.baseline).toBeTruthy();
    expect(artifact.files).toEqual(['tracked.txt']);
    expect(artifact.diff).toContain('+saved');
    expect(artifact.diff).not.toContain('unrelated.txt');
    expect(artifact.checks).toEqual(['check fixture']);
    const noChange = await Effect.runPromise(
      saveArtifact(workspace, 'task-1', ['tracked.txt'], ['check no change']),
    );
    expect(noChange.commit).toBeNull();
    expect(noChange.baseline).toBe(artifact.commit);
    expect(noChange.diff).toBe('');
    expect(noChange.files).toEqual([]);
    expect(noChange.checks).toEqual(['check no change']);
    await writeFile(join(workspace.directory, 'tracked.txt'), 'saved again\n');
    const cumulative = await Effect.runPromise(
      saveArtifact(
        {...workspace, baseline: taskBaseline},
        'task-1',
        ['tracked.txt'],
        [],
      ),
    );
    expect(cumulative.commit).not.toBeNull();
    expect(cumulative.baseline).toBe(taskBaseline);
    expect(cumulative.diff).toContain('+saved again');
    expect(cumulative.files).toEqual(['tracked.txt']);
    expect(
      await readFile(join(workspace.directory, 'unrelated.txt'), 'utf8'),
    ).toBe('keep\n');
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe(
      'before\n',
    );
    expect(
      await runGit(workspace.directory, ['diff', '--cached', '--name-only']),
    ).toBe('unrelated.txt');
    await expect(
      Effect.runPromise(releaseWorkspace(workspace)),
    ).rejects.toThrow('ignored content');
    await runGit(workspace.directory, ['reset', '--', 'unrelated.txt']);
    await rm(join(workspace.directory, 'unrelated.txt'));
    await rm(join(workspace.directory, 'ignored.txt'));
    await rm(join(workspace.directory, '.gitignore'));
    expect((await Effect.runPromise(inspectWorkspace(workspace))).dirty).toBe(
      false,
    );
    await Effect.runPromise(releaseWorkspace(workspace));
    expect(workspace.released).toBe(true);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('retained workspaces reuse partial changes and reject an unsafe baseline switch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-reuse-'));
  try {
    const {source, state} = await createRepository(root);
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-1',
        taskId: 'task-1',
        source,
        directory: state,
        mode: 'write',
      }),
    );
    await writeFile(join(workspace.directory, 'tracked.txt'), 'partial\n');
    const reused = await Effect.runPromise(
      prepareWorkspace(
        {
          agentId: 'agent-1',
          taskId: 'task-2',
          source,
          directory: state,
          mode: 'write',
        },
        workspace,
      ),
    );
    expect(reused.directory).toBe(workspace.directory);
    expect(reused.baseline).toBe(workspace.baseline);
    expect(await readFile(join(reused.directory, 'tracked.txt'), 'utf8')).toBe(
      'partial\n',
    );
    const otherBaseline = await runGit(source, ['rev-parse', 'HEAD']);
    await expect(
      Effect.runPromise(
        prepareWorkspace(
          {
            agentId: 'agent-1',
            taskId: 'task-3',
            source,
            directory: state,
            mode: 'write',
            baseline: otherBaseline,
          },
          reused,
        ),
      ),
    ).rejects.toThrow('unsaved content');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('worktree setup failure never falls back to the source directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-isolation-'));
  try {
    const {source, state} = await createRepository(root);
    await mkdir(join(state, 'agent-1'), {recursive: true});
    await writeFile(join(state, 'agent-1', 'foreign.txt'), 'foreign\n');
    await expect(
      Effect.runPromise(
        prepareWorkspace({
          agentId: 'agent-1',
          taskId: 'task-1',
          source,
          directory: state,
          mode: 'write',
        }),
      ),
    ).rejects.toThrow('existing workspace');
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe(
      'before\n',
    );
    expect(await readFile(join(state, 'agent-1', 'foreign.txt'), 'utf8')).toBe(
      'foreign\n',
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('missing retained worktrees recover only from the saved workspace commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-recovery-'));
  try {
    const {source, state} = await createRepository(root);
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-1',
        taskId: 'task-1',
        source,
        directory: state,
        mode: 'write',
      }),
    );
    await writeFile(join(workspace.directory, 'tracked.txt'), 'saved\n');
    const artifact = await Effect.runPromise(
      saveArtifact(workspace, 'task-1', ['tracked.txt'], []),
    );
    if (artifact.commit === null) throw new Error('Expected a saved commit.');
    await rm(workspace.directory, {recursive: true, force: true});
    const restored = await Effect.runPromise(
      prepareWorkspace(
        {
          agentId: 'agent-1',
          taskId: 'task-2',
          source,
          directory: state,
          mode: 'write',
        },
        workspace,
      ),
    );
    expect(restored.baseline).toBe(artifact.commit);
    expect(restored.restoredFrom).toBe(artifact.commit);
    expect(
      await readFile(join(restored.directory, 'tracked.txt'), 'utf8'),
    ).toBe('saved\n');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('snapshot followups preserve their captured view and live release keeps the source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-view-'));
  try {
    const {source, state} = await createRepository(root);
    await writeFile(join(source, 'tracked.txt'), 'captured\n');
    const snapshot = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-1',
        taskId: 'task-1',
        source,
        directory: state,
        mode: 'snapshot',
      }),
    );
    await writeFile(join(source, 'tracked.txt'), 'changed later\n');
    const reused = await Effect.runPromise(
      prepareWorkspace(
        {
          agentId: 'agent-1',
          taskId: 'task-2',
          source,
          directory: state,
          mode: 'write',
        },
        snapshot,
      ),
    );
    expect(reused.mode).toBe('snapshot');
    expect(await readFile(join(reused.directory, 'tracked.txt'), 'utf8')).toBe(
      'captured\n',
    );

    const live = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-2',
        taskId: 'task-live',
        source,
        directory: state,
        mode: 'live',
      }),
    );
    const liveFollowup = await Effect.runPromise(
      prepareWorkspace(
        {
          agentId: 'agent-2',
          taskId: 'task-live-followup',
          source,
          directory: state,
          mode: 'write',
        },
        live,
      ),
    );
    expect(liveFollowup.directory).toBe(source);
    expect(liveFollowup.mode).toBe('live');
    await Effect.runPromise(releaseWorkspace(live));
    expect(live.released).toBe(true);
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe(
      'changed later\n',
    );
    await runGit(source, ['restore', 'tracked.txt']);
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe(
      'before\n',
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('direct writes are explicit and non-Git snapshots fail clearly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-direct-'));
  try {
    const source = join(root, 'documents');
    const state = join(root, 'state');
    await mkdir(source, {recursive: true});
    await writeFile(join(source, 'note.txt'), 'direct\n');
    const direct = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-1',
        taskId: 'task-direct',
        source,
        directory: state,
        mode: 'direct',
      }),
    );
    expect(direct.repository).toBeNull();
    expect(direct.directory).toBe(source);
    await Effect.runPromise(releaseWorkspace(direct));
    expect(direct.released).toBe(true);
    expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('direct\n');
    const live = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'agent-2',
        taskId: 'task-live',
        source,
        directory: state,
        mode: 'live',
      }),
    );
    expect(live.repository).toBeNull();
    expect(live.baseline).toBeNull();
    await Effect.runPromise(releaseWorkspace(live));
    expect(live.released).toBe(true);
    expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('direct\n');
    await expect(
      Effect.runPromise(
        prepareWorkspace({
          agentId: 'agent-2',
          taskId: 'task-snapshot',
          source,
          directory: state,
          mode: 'snapshot',
        }),
      ),
    ).rejects.toThrow('requires a Git repository');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('linked checkout and nested cwd preserve their source and support retained artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-linked-'));
  try {
    const {source, state} = await createRepository(root);
    await mkdir(join(source, 'api'));
    await writeFile(
      join(source, 'api', 'handler.ts'),
      'export const version = 1;\n',
    );
    await runGit(source, ['add', '.']);
    await runGit(source, ['commit', '-m', 'add api']);
    const linked = join(root, 'linked');
    await runGit(source, ['worktree', 'add', '--detach', linked]);
    await writeFile(
      join(linked, 'api', 'handler.ts'),
      'export const version = 2;\n',
    );
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'lead',
        taskId: 'lead-first',
        source: join(linked, 'api'),
        directory: state,
        mode: 'write',
      }),
    );
    expect(
      await readFile(join(workspace.directory, 'api', 'handler.ts'), 'utf8'),
    ).toContain('version = 2');
    expect((await Effect.runPromise(inspectWorkspace(workspace))).dirty).toBe(
      false,
    );
    expect(workspace.cwd).toBe(join(workspace.directory, 'api'));
    const child = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'child',
        taskId: 'child-first',
        source: join(workspace.directory, 'api'),
        directory: state,
        mode: 'write',
      }),
    );
    await writeFile(
      join(child.directory, 'api', 'handler.ts'),
      'export const version = 3;\n',
    );
    const artifact = await Effect.runPromise(
      saveArtifact(child, 'child-first', ['handler.ts'], []),
    );
    expect(artifact.files).toEqual(['api/handler.ts']);
    const resumed = await Effect.runPromise(
      prepareWorkspace(
        {
          agentId: 'child',
          taskId: 'child-next',
          source: join(workspace.directory, 'api'),
          directory: state,
          mode: 'write',
        },
        child,
      ),
    );
    expect(resumed.baseline).toBe(artifact.commit);
    await Effect.runPromise(releaseWorkspace(resumed));
    await Effect.runPromise(releaseWorkspace(workspace));
    expect(await readFile(join(linked, 'api', 'handler.ts'), 'utf8')).toContain(
      'version = 2',
    );
    expect(await readFile(join(source, 'api', 'handler.ts'), 'utf8')).toContain(
      'version = 1',
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('already committed child changes remain a fixed artifact relative to the assignment baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-committed-'));
  try {
    const {source, state} = await createRepository(root);
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'writer',
        taskId: 'write-1',
        source,
        directory: state,
        mode: 'write',
      }),
    );
    await writeFile(
      join(workspace.directory, 'tracked.txt'),
      'committed by child\n',
    );
    await runGit(workspace.directory, ['add', 'tracked.txt']);
    await runGit(workspace.directory, ['commit', '-m', 'child change']);
    const head = await runGit(workspace.directory, ['rev-parse', 'HEAD']);
    const artifact = await Effect.runPromise(
      saveArtifact(workspace, 'write-1', ['tracked.txt'], ['child check']),
    );
    expect(artifact.commit).toBe(head);
    expect(artifact.files).toEqual(['tracked.txt']);
    expect(artifact.diff).toContain('+committed by child');
    const consumer = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'reader',
        taskId: 'read-1',
        source,
        directory: state,
        mode: 'snapshot',
        baseline: head,
      }),
    );
    expect(
      await readFile(join(consumer.directory, 'tracked.txt'), 'utf8'),
    ).toBe('committed by child\n');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('capture retries when a dirty file changes during index capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-capture-race-'));
  const previousPath = process.env.PATH;
  try {
    const {source, state} = await createRepository(root);
    await writeFile(join(source, 'tracked.txt'), 'dirty before\n');
    const tools = join(root, 'tools');
    await mkdir(tools);
    const wrapper = join(tools, 'git');
    // The external Git boundary changes the source once after the first
    // fingerprint, before the final fingerprint can validate the capture.
    await writeFile(
      wrapper,
      `#!/bin/sh
case " $* " in
  *" write-tree "*)
    if [ ! -e '${root}/mutated' ]; then
      printf 'dirty after\\n' > '${source}/tracked.txt'
      touch '${root}/mutated'
    fi
    ;;
esac
exec /usr/bin/git "$@"
`,
    );
    await chmod(wrapper, 0o700);
    process.env.PATH = `${tools}:${previousPath ?? '/usr/bin:/bin'}`;
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'reader',
        taskId: 'capture-race',
        source,
        directory: state,
        mode: 'snapshot',
      }),
    );
    expect(await readFile(join(source, 'tracked.txt'), 'utf8')).toBe(
      'dirty after\n',
    );
    expect(
      await readFile(join(workspace.directory, 'tracked.txt'), 'utf8'),
    ).toBe('dirty after\n');
    expect(await runGit(source, ['diff', '--cached', '--name-only'])).toBe('');
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, {recursive: true, force: true});
  }
});

test('a self-committed artifact cannot deliver undeclared files through its commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-subagent-artifact-scope-'));
  try {
    const {source, state} = await createRepository(root);
    const workspace = await Effect.runPromise(
      prepareWorkspace({
        agentId: 'writer',
        taskId: 'scope',
        source,
        directory: state,
        mode: 'write',
      }),
    );
    const baseline = workspace.baseline;
    await writeFile(
      join(workspace.directory, 'tracked.txt'),
      'declared change\n',
    );
    await writeFile(
      join(workspace.directory, 'hidden.txt'),
      'undeclared change\n',
    );
    await runGit(workspace.directory, ['add', '.']);
    await runGit(workspace.directory, ['commit', '-m', 'two child changes']);
    const head = await runGit(workspace.directory, ['rev-parse', 'HEAD']);
    await expect(
      Effect.runPromise(saveArtifact(workspace, 'scope', ['tracked.txt'], [])),
    ).rejects.toThrow('Committed changes outside declared artifact paths');
    expect(workspace.baseline).toBe(baseline);
    expect(await runGit(workspace.directory, ['rev-parse', 'HEAD'])).toBe(head);
    await expect(
      Effect.runPromise(saveArtifact(workspace, 'scope', [], [])),
    ).rejects.toThrow('Committed changes outside declared artifact paths');
    const artifact = await Effect.runPromise(
      saveArtifact(workspace, 'scope', ['tracked.txt', 'hidden.txt'], []),
    );
    expect(artifact.commit).toBe(head);
    expect(artifact.files).toEqual(['hidden.txt', 'tracked.txt']);
    expect(artifact.diff).toContain('+undeclared change');
    const unchanged = await Effect.runPromise(
      saveArtifact(workspace, 'next', [], []),
    );
    expect(unchanged.commit).toBeNull();
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
