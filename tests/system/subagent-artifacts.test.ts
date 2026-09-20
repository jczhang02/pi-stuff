import {expect, test} from 'bun:test';
import {
  readFile,
  readdir,
  writeFile,
  mkdir,
  rm,
  access,
} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {FleetRecord} from '../../src/subagent/records';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const FleetRecordJson = Schema.fromJsonString(FleetRecord);
const AdmissionJson = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('accepted'),
    dispatchId: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);
const WaitJson = Schema.fromJsonString(
  Schema.Struct({waitStatus: Schema.String}),
);
const OperationJson = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.String,
    message: Schema.optional(Schema.String),
    agentId: Schema.optional(Schema.String),
  }),
);

type ChildPlan = {
  command: string;
  files: string[];
  checks: string[];
  report: string;
};

type SourceSnapshot = {
  status: string;
  cached: string;
  working: string;
  tracked: string;
  sourceOnly: string;
};

async function git(directory: string, args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Pi Fixture',
      GIT_AUTHOR_EMAIL: 'pi-fixture@localhost',
      GIT_COMMITTER_NAME: 'Pi Fixture',
      GIT_COMMITTER_EMAIL: 'pi-fixture@localhost',
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (code !== 0)
    throw new Error(
      `git ${args.join(' ')} failed with ${code}: ${stderr.trim()}`,
    );
  return stdout;
}

async function createRepository(directory: string) {
  const repository = join(directory, 'project');
  await mkdir(repository, {recursive: true});
  await writeFile(join(repository, 'tracked.txt'), 'base\n');
  await writeFile(join(repository, '.gitignore'), '*.ignored\n');
  await git(repository, ['init', '-q']);
  await git(repository, ['add', '.']);
  await git(repository, [
    '-c',
    'user.name=Pi Fixture',
    '-c',
    'user.email=pi-fixture@localhost',
    'commit',
    '-qm',
    'initial',
  ]);
  return repository;
}

async function makeDirtySource(repository: string) {
  const tracked = join(repository, 'tracked.txt');
  await writeFile(tracked, 'staged source\n');
  await git(repository, ['add', 'tracked.txt']);
  await writeFile(tracked, 'dirty working tree\n');
  await writeFile(join(repository, 'source-only.txt'), 'source only\n');
}

async function sourceSnapshot(repository: string): Promise<SourceSnapshot> {
  return {
    status: await git(repository, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignored',
    ]),
    cached: await git(repository, [
      'diff',
      '--cached',
      '--no-ext-diff',
      '--binary',
    ]),
    working: await git(repository, ['diff', '--no-ext-diff', '--binary']),
    tracked: await readFile(join(repository, 'tracked.txt'), 'utf8'),
    sourceOnly: await readFile(join(repository, 'source-only.txt'), 'utf8'),
  };
}

function latestUserText(request: ModelRequest): string {
  const message = request.messages
    .filter(candidate => candidate.role === 'user')
    .at(-1);
  return JSON.stringify(message?.content ?? '');
}

function childModel(plans: ReadonlyMap<string, ChildPlan>) {
  const stages = new Map<string, number>();
  return (request: ModelRequest): FixtureReply | undefined => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
    const users = request.messages
      .filter(message => message.role === 'user')
      .map(message => JSON.stringify(message.content ?? ''))
      .join('\n');
    const marker = [...plans.keys()]
      .map(key => ({key, position: users.lastIndexOf(key)}))
      .filter(candidate => candidate.position >= 0)
      .sort((left, right) => right.position - left.position)[0]?.key;
    if (marker === undefined)
      throw new Error(
        `No fixture plan matched child request: ${latestUserText(request)}`,
      );
    const plan = plans.get(marker);
    if (plan === undefined)
      throw new Error(`Missing fixture plan for ${marker}.`);
    const stage = stages.get(marker) ?? 0;
    if (stage === 0) {
      stages.set(marker, 1);
      return {
        tool: 'bash',
        arguments: JSON.stringify({command: plan.command}),
      };
    }
    if (stage === 1) {
      stages.set(marker, 2);
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: plan.report,
          files: plan.files,
          checks: plan.checks,
        }),
      };
    }
    stages.set(marker, stage + 1);
    return {text: `Completed ${marker}.`};
  };
}

async function findRecordFile(directory: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(directory, {withFileTypes: true});
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === 'records.json') return path;
    if (entry.isDirectory()) {
      const nested = await findRecordFile(path);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

async function readFleetRecord(agentDirectory: string) {
  const path = await findRecordFile(
    join(agentDirectory, 'pi-stuff', 'subagents'),
  );
  if (path === undefined)
    throw new Error('Persisted subagent records were not found.');
  return Schema.decodeUnknownSync(FleetRecordJson)(
    await readFile(path, 'utf8'),
  );
}

async function waitForFleet(host: Awaited<ReturnType<typeof launchPi>>) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const result = Schema.decodeUnknownSync(WaitJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'wait', timeoutMs: 10000}),
      ),
    );
    if (result.waitStatus === 'settled') return;
    expect(result.waitStatus).toBe('changed');
  }
  throw new Error('Fleet did not settle after 16 event-driven waits.');
}

test('real Pi write artifacts isolate dirty sources, fixed inputs and retained workspaces', async () => {
  let writerCommit = '';
  const plans = new Map<string, ChildPlan>([
    [
      'WRITE_DIRTY_ARTIFACT',
      {
        command:
          'test "$(cat tracked.txt)" = "dirty working tree" && test ! -e source-only.txt && printf "writer artifact\\n" > artifact.txt',
        files: ['artifact.txt'],
        checks: ['git diff --check'],
        report: 'Writer saved one scoped artifact.',
      },
    ],
    [
      'READ_FIXED_INPUT',
      {
        command: '',
        files: ['downstream.txt'],
        checks: ['git diff --check'],
        report: 'Downstream consumed the fixed upstream artifact.',
      },
    ],
    [
      'FOLLOWUP_ARTIFACT',
      {
        command:
          'test "$(cat artifact.txt)" = "writer artifact" && printf "followup artifact\\n" > followup.txt',
        files: ['followup.txt'],
        checks: ['git diff --check'],
        report: 'Retained writer workspace produced a second artifact.',
      },
    ],
  ]);
  const model = childModel(plans);
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('READ_FIXED_INPUT')) return model(request);
      const plan = plans.get('READ_FIXED_INPUT');
      if (plan === undefined) throw new Error('Downstream plan is missing.');
      if (plan.command.length === 0) {
        if (writerCommit.length === 0)
          throw new Error(
            'Downstream started before the upstream commit was known.',
          );
        plan.command = `test "$(git rev-parse HEAD)" = "${writerCommit}" && test ! -e source-after.txt && test "$(cat artifact.txt)" = "writer artifact" && printf "downstream artifact\\n" > downstream.txt`;
      }
      return model(request);
    },
  );
  try {
    const repository = await createRepository(host.directory);
    await makeDirtySource(repository);
    const beforeWriter = await sourceSnapshot(repository);
    const sourceIndex = await readFile(join(repository, '.git', 'index'));
    const initial = await host.invoke('subagent', '{"command":"inspect"}');
    expect(initial).toContain('"tasks"');
    for (const tool of [
      'bash',
      'read',
      'subagent',
      'web_search',
      'fetch_content',
      'get_search_content',
    ])
      expect(host.offered()).toContain(tool);

    const admitted = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'writer',
              prompt: 'WRITE_DIRTY_ARTIFACT',
              cwd: 'project',
              workspace: 'write',
              tools: ['bash', 'read', 'subagent'],
            },
          ],
        }),
      ),
    );
    const writerTaskId = admitted.tasks[0]?.taskId;
    const writerAgentId = admitted.tasks[0]?.agentId;
    expect(writerTaskId).toBeDefined();
    expect(writerAgentId).toBeDefined();
    await waitForFleet(host);

    let record = await readFleetRecord(host.agent);
    const writer = record.tasks.find(task => task.id === writerTaskId);
    expect(writer).toBeDefined();
    expect(writer?.outcome).toBe('fulfilled');
    expect(writer?.durability).toBe('saved');
    expect(writer?.files).toEqual(['artifact.txt']);
    expect(writer?.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(writer?.workspaceDirectory).toBeTruthy();
    writerCommit = writer?.commit ?? '';
    expect(await readFile(join(repository, '.git', 'index'))).toEqual(
      sourceIndex,
    );
    expect(await sourceSnapshot(repository)).toEqual(beforeWriter);

    await writeFile(join(repository, 'source-after.txt'), 'moving source\n');
    await git(repository, ['add', 'source-after.txt']);
    await git(repository, [
      '-c',
      'user.name=Pi Fixture',
      '-c',
      'user.email=pi-fixture@localhost',
      'commit',
      '--only',
      '-qm',
      'advance source branch',
      '--',
      'source-after.txt',
    ]);
    const afterSourceAdvance = await sourceSnapshot(repository);

    const downstream = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'downstream',
              prompt: 'READ_FIXED_INPUT',
              cwd: 'project',
              workspace: 'write',
              tools: ['bash', 'read', 'subagent'],
              inputs: [writerTaskId],
            },
          ],
        }),
      ),
    );
    const downstreamTaskId = downstream.tasks[0]?.taskId;
    expect(downstreamTaskId).toBeDefined();
    await waitForFleet(host);
    record = await readFleetRecord(host.agent);
    const downstreamTask = record.tasks.find(
      task => task.id === downstreamTaskId,
    );
    expect(downstreamTask?.outcome).toBe('fulfilled');
    expect(downstreamTask?.durability).toBe('saved');
    expect(downstreamTask?.baseline).toBe(writerCommit);
    expect(downstreamTask?.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(downstreamTask?.workspaceDirectory).toBeTruthy();
    expect(downstreamTask?.workspaceDirectory).not.toBe(
      writer?.workspaceDirectory,
    );
    expect(
      await readFile(
        join(downstreamTask?.workspaceDirectory ?? '', 'downstream.txt'),
        'utf8',
      ),
    ).toBe('downstream artifact\n');
    expect(await sourceSnapshot(repository)).toEqual(afterSourceAdvance);

    const followup = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: writerAgentId,
          text: 'FOLLOWUP_ARTIFACT',
        }),
      ),
    );
    const followupTaskId = followup.tasks[0]?.taskId;
    expect(followupTaskId).toBeDefined();
    await waitForFleet(host);
    record = await readFleetRecord(host.agent);
    const firstResult = record.tasks.find(task => task.id === writerTaskId);
    const followupResult = record.tasks.find(
      task => task.id === followupTaskId,
    );
    expect(
      record.tasks.filter(task => task.agentId === writerAgentId),
    ).toHaveLength(2);
    expect(firstResult?.report).toBe('Writer saved one scoped artifact.');
    expect(firstResult?.commit).toBe(writerCommit);
    expect(followupResult?.outcome).toBe('fulfilled');
    expect(followupResult?.durability).toBe('saved');
    expect(followupResult?.workspaceDirectory).toBe(
      firstResult?.workspaceDirectory,
    );
    expect(followupResult?.files).toEqual(['followup.txt']);
    expect(followupResult?.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(followupResult?.commit).not.toBe(writerCommit);
    expect(
      await readFile(
        join(firstResult?.workspaceDirectory ?? '', 'artifact.txt'),
        'utf8',
      ),
    ).toBe('writer artifact\n');
    expect(
      await readFile(
        join(followupResult?.workspaceDirectory ?? '', 'followup.txt'),
        'utf8',
      ),
    ).toBe('followup artifact\n');

    const workspace = firstResult?.workspaceDirectory;
    expect(workspace).toBeTruthy();
    await writeFile(
      join(workspace ?? '', 'unsaved.txt'),
      'must be preserved\n',
    );
    await writeFile(join(workspace ?? '', 'leftover.ignored'), 'ignored\n');
    const rejected = Schema.decodeUnknownSync(OperationJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'release', agentId: writerAgentId}),
      ),
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.message).toContain(
      'Workspace contains unsaved tracked, untracked, or ignored content.',
    );
    await rm(join(workspace ?? '', 'unsaved.txt'));
    await rm(join(workspace ?? '', 'leftover.ignored'));
    const released = Schema.decodeUnknownSync(OperationJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'release', agentId: writerAgentId}),
      ),
    );
    expect(released.status).toBe('released');
    expect(
      await access(workspace ?? '').then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    record = await readFleetRecord(host.agent);
    expect(
      record.agents.find(agent => agent.id === writerAgentId)?.released,
    ).toBe(true);
    expect(await sourceSnapshot(repository)).toEqual(afterSourceAdvance);
    await expect(
      readFile(join(repository, 'artifact.txt'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(repository, 'followup.txt'), 'utf8'),
    ).rejects.toThrow();
  } finally {
    await host.close();
  }
}, 60000);

test('real Pi requires an explicit integration baseline and retains conflict resolution as a fixed artifact', async () => {
  const plans = new Map<string, ChildPlan>([
    [
      'FIRST_CODE_INPUT',
      {
        command: 'printf "first code input\\n" > tracked.txt',
        files: ['tracked.txt'],
        checks: [],
        report: 'First code input saved.',
      },
    ],
    [
      'SECOND_CODE_INPUT',
      {
        command: 'printf "second code input\\n" > tracked.txt',
        files: ['tracked.txt'],
        checks: [],
        report: 'Second code input saved.',
      },
    ],
  ]);
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    childModel(plans),
  );
  try {
    const repository = await createRepository(host.directory);
    const first = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'first',
              prompt: 'FIRST_CODE_INPUT',
              cwd: 'project',
              workspace: 'write',
              tools: ['bash', 'read', 'subagent'],
            },
            {
              name: 'second',
              prompt: 'SECOND_CODE_INPUT',
              cwd: 'project',
              workspace: 'write',
              tools: ['bash', 'read', 'subagent'],
            },
          ],
        }),
      ),
    );
    const firstTaskId = first.tasks[0]?.taskId;
    const secondTaskId = first.tasks[1]?.taskId;
    expect(firstTaskId).toBeDefined();
    expect(secondTaskId).toBeDefined();
    await waitForFleet(host);
    let record = await readFleetRecord(host.agent);
    const firstTask = record.tasks.find(task => task.id === firstTaskId);
    const secondTask = record.tasks.find(task => task.id === secondTaskId);
    expect(firstTask?.reason).toBe('');
    expect(secondTask?.reason).toBe('');
    expect(firstTask?.outcome).toBe('fulfilled');
    expect(secondTask?.outcome).toBe('fulfilled');
    expect(firstTask?.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(secondTask?.commit).toMatch(/^[0-9a-f]{40,64}$/);

    const integration = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'integration',
              prompt: 'MULTI_CODE_INTEGRATION',
              cwd: 'project',
              workspace: 'write',
              tools: ['bash', 'read', 'subagent'],
              inputs: [firstTaskId, secondTaskId],
            },
          ],
        }),
      ),
    );
    const integrationTaskId = integration.tasks[0]?.taskId;
    expect(integrationTaskId).toBeDefined();
    await waitForFleet(host);
    record = await readFleetRecord(host.agent);
    const integrationTask = record.tasks.find(
      task => task.id === integrationTaskId,
    );
    expect(integrationTask?.phase).toBe('ended');
    expect(integrationTask?.outcome).toBe('failed');
    expect(integrationTask?.reason).toContain(
      'Multiple fixed code inputs require an explicit integration baseline.',
    );
    expect(integrationTask?.workspaceDirectory).toBeNull();
    expect(integrationTask?.commit).toBeNull();
    expect(integrationTask?.durability).toBe('saved');
    expect((await git(repository, ['rev-parse', 'HEAD'])).trim()).toMatch(
      /^[0-9a-f]{40,64}$/u,
    );
    if (!firstTask?.commit || !secondTask?.commit)
      throw new Error('Integration requires two saved commits.');
    plans.set('EXPLICIT_INTEGRATION', {
      command: `git -c user.name=Fixture -c user.email=fixture@localhost cherry-pick ${secondTask.commit}; test -n "$(git diff --name-only --diff-filter=U)" && printf "resolved both inputs\\n" > tracked.txt && git add tracked.txt && git -c commit.gpgSign=false -c user.name=Fixture -c user.email=fixture@localhost cherry-pick --continue`,
      files: ['tracked.txt'],
      checks: ['Resolved the tracked.txt cherry-pick conflict.'],
      report: 'Integrated both saved inputs after resolving their conflict.',
    });
    const resolvedAdmission = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'resolver',
              prompt: 'EXPLICIT_INTEGRATION',
              cwd: 'project',
              workspace: 'write',
              tools: ['bash', 'read', 'subagent'],
              inputs: [firstTaskId, secondTaskId],
              baseline: firstTask.commit,
            },
          ],
        }),
      ),
    );
    await waitForFleet(host);
    record = await readFleetRecord(host.agent);
    const resolved = record.tasks.find(
      task => task.id === resolvedAdmission.tasks[0]?.taskId,
    );
    expect(resolved?.reason).toBe('');
    expect(resolved?.outcome).toBe('fulfilled');
    expect(resolved?.durability).toBe('saved');
    expect(resolved?.baseline).toBe(firstTask.commit);
    expect(resolved?.diff).toContain('+resolved both inputs');
    expect(resolved?.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(await readFile(join(repository, 'tracked.txt'), 'utf8')).toBe(
      'base\n',
    );
    expect(record.tasks.find(task => task.id === firstTaskId)?.commit).toBe(
      firstTask.commit,
    );
    expect(record.tasks.find(task => task.id === secondTaskId)?.commit).toBe(
      secondTask.commit,
    );
  } finally {
    await host.close();
  }
}, 60000);

test('real Pi recursively delegates from a linked checkout subdirectory with the intended relative cwd', async () => {
  let parentCalls = 0;
  let childCalls = 0;
  let childSawCapturedContent = false;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const firstUser = JSON.stringify(
        request.messages.find(message => message.role === 'user')?.content,
      );
      if (firstUser.includes('WORKDIR_CHILD')) {
        childCalls++;
        if (childCalls === 1)
          return {tool: 'read', arguments: '{"path":"handler.ts"}'};
        if (childCalls === 2) {
          childSawCapturedContent = history.includes('dirty linked content');
          return {
            tool: 'subagent',
            arguments:
              '{"command":"finish","outcome":"fulfilled","text":"Nested reader inspected handler.ts."}',
          };
        }
        return {text: 'Nested reader delivered.'};
      }
      parentCalls++;
      if (parentCalls === 1)
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'dispatch',
            tasks: [
              {
                name: 'nested',
                prompt: 'WORKDIR_CHILD',
                workspace: 'snapshot',
                tools: ['read', 'subagent'],
              },
            ],
          }),
        };
      if (
        request.messages.at(-1)?.role === 'tool' &&
        JSON.stringify(request.messages.at(-1)?.content).includes(
          'Declaration recorded',
        )
      )
        return {text: 'Lead delivered.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Lead incorporated nested findings."}',
      };
    },
  );
  try {
    const source = await createRepository(host.directory);
    await mkdir(join(source, 'api'));
    await writeFile(join(source, 'api', 'handler.ts'), 'original source\n');
    await git(source, ['add', 'api']);
    await git(source, ['commit', '-qm', 'api']);
    const linked = join(host.directory, 'linked');
    await git(source, ['worktree', 'add', '--detach', linked]);
    await writeFile(
      join(linked, 'api', 'handler.ts'),
      'dirty linked content\n',
    );
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'lead',
            prompt: 'WORKDIR_LEAD',
            cwd: 'linked/api',
            workspace: 'write',
            tools: ['bash', 'read', 'subagent'],
          },
        ],
      }),
    );
    await waitForFleet(host);
    const record = await readFleetRecord(host.agent);
    expect(record.tasks).toHaveLength(2);
    for (const task of record.tasks) {
      expect(task.reason).toBe('');
      expect(task.outcome).toBe('fulfilled');
      expect(task.workspaceDirectory).toEndWith('/api');
    }
    expect(childSawCapturedContent).toBe(true);
    expect(await readFile(join(source, 'api', 'handler.ts'), 'utf8')).toBe(
      'original source\n',
    );
    expect(await readFile(join(linked, 'api', 'handler.ts'), 'utf8')).toBe(
      'dirty linked content\n',
    );
  } finally {
    await host.close();
  }
}, 60000);

test('explicit follow-up restores its missing saved worktree and applies a cwd override to child tools', async () => {
  const plans = new Map<string, ChildPlan>([
    [
      'SAVE_BEFORE_MISSING',
      {
        command: 'printf "saved root artifact\\n" > artifact.txt',
        files: ['artifact.txt'],
        checks: [],
        report: 'Saved the initial artifact.',
      },
    ],
    [
      'RESTORE_IN_API',
      {
        command:
          'test "$(basename "$PWD")" = api && test "$(cat marker.txt)" = "api input" && test "$(cat ../artifact.txt)" = "saved root artifact" && printf "restored API result\\n" > result.txt',
        files: ['result.txt'],
        checks: [],
        report: 'Rebuilt the saved worktree and used the selected API cwd.',
      },
    ],
  ]);
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    childModel(plans),
  );
  try {
    const repository = await createRepository(host.directory);
    await mkdir(join(repository, 'api'));
    await writeFile(join(repository, 'api', 'marker.txt'), 'api input\n');
    await git(repository, ['add', '.']);
    await git(repository, ['commit', '-qm', 'api input']);
    const admitted = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'writer',
              prompt: 'SAVE_BEFORE_MISSING',
              cwd: repository,
              workspace: 'write',
              tools: ['bash', 'read', 'subagent'],
            },
          ],
        }),
      ),
    );
    await waitForFleet(host);
    const before = await readFleetRecord(host.agent);
    const first = before.tasks.find(
      task => task.id === admitted.tasks[0]?.taskId,
    );
    if (!first?.workspaceDirectory || !first.commit)
      throw new Error('Initial write artifact was not saved.');
    await rm(first.workspaceDirectory, {recursive: true, force: true});
    const followup = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: first.agentId,
          text: 'RESTORE_IN_API',
          overrides: {cwd: join(repository, 'api')},
        }),
      ),
    );
    await waitForFleet(host);
    const after = await readFleetRecord(host.agent);
    const restored = after.tasks.find(
      task => task.id === followup.tasks[0]?.taskId,
    );
    expect(restored?.reason).toBe('');
    expect(restored?.outcome).toBe('fulfilled');
    expect(restored?.durability).toBe('saved');
    expect(restored?.baseline).toBe(first.commit);
    expect(restored?.workspaceDirectory).toBe(
      join(first.workspaceDirectory, 'api'),
    );
    expect(restored?.files).toEqual(['api/result.txt']);
    expect(
      await readFile(
        join(restored?.workspaceDirectory ?? '', 'result.txt'),
        'utf8',
      ),
    ).toBe('restored API result\n');
    expect(after.tasks.find(task => task.id === first.id)?.commit).toBe(
      first.commit,
    );
    await expect(
      readFile(join(repository, 'api', 'result.txt')),
    ).rejects.toThrow();
  } finally {
    await host.close();
  }
}, 60000);
