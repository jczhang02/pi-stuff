import {expect, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const AdmissionJson = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('accepted'),
    dispatchId: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);
const SnapshotJson = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        agentId: Schema.String,
        prompt: Schema.String,
        phase: Schema.String,
        outcome: Schema.NullOr(Schema.String),
        durability: Schema.String,
        currentTools: Schema.Array(Schema.String),
        report: Schema.String,
      }),
    ),
    agents: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        currentTools: Schema.Array(Schema.String),
        held: Schema.Boolean,
      }),
    ),
    messages: Schema.Array(
      Schema.Struct({
        kind: Schema.String,
        taskId: Schema.NullOr(Schema.String),
        text: Schema.String,
      }),
    ),
  }),
);
const WaitJson = Schema.fromJsonString(
  Schema.Struct({waitStatus: Schema.String}),
);
function decodeAdmission(text: string): typeof AdmissionJson.Type {
  try {
    return Schema.decodeUnknownSync(AdmissionJson)(text);
  } catch (error) {
    console.error(`Admission response did not match accepted schema: ${text}`);
    throw error;
  }
}

type AuthorityHost = Awaited<ReturnType<typeof launchPi>>;
type Snapshot = typeof SnapshotJson.Type;

function lastToolText(request: ModelRequest): string {
  const last = request.messages.at(-1);
  if (last?.role !== 'tool' || !Schema.is(Schema.String)(last.content))
    return '';
  return last.content;
}

function latestMarker(request: ModelRequest, markers: readonly string[]) {
  const users = request.messages
    .filter(message => message.role === 'user')
    .map(message => JSON.stringify(message.content ?? ''))
    .join('\n');
  return markers
    .map(marker => ({marker, position: users.lastIndexOf(marker)}))
    .filter(candidate => candidate.position >= 0)
    .toSorted((left, right) => right.position - left.position)[0]?.marker;
}

function decodeSnapshot(text: string): Snapshot {
  return Schema.decodeUnknownSync(SnapshotJson)(text);
}

async function inspect(host: AuthorityHost): Promise<Snapshot> {
  return decodeSnapshot(await host.invoke('subagent', '{"command":"inspect"}'));
}

async function waitForTaskEnded(
  host: AuthorityHost,
  taskId: string,
): Promise<Snapshot> {
  let snapshot: Snapshot | undefined;
  await host.terminal.screen.waitUntil(
    async () => {
      snapshot = await inspect(host);
      return snapshot.tasks.some(
        task => task.id === taskId && task.phase === 'ended',
      );
    },
    {timeoutMs: 15000},
  );
  if (snapshot === undefined)
    throw new Error('Task snapshot was not observed.');
  return snapshot;
}

async function waitForFleet(host: AuthorityHost): Promise<void> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const result = Schema.decodeUnknownSync(WaitJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'wait', timeoutMs: 5000}),
      ),
    );
    if (result.waitStatus === 'settled') return;
    if (
      result.waitStatus !== 'changed' &&
      result.waitStatus !== 'message' &&
      result.waitStatus !== 'expired'
    )
      throw new Error(`Fleet wait ended with ${result.waitStatus}.`);
  }
  throw new Error('Fleet did not settle after 16 event-driven waits.');
}

async function waitForPath(host: AuthorityHost, path: string): Promise<void> {
  await host.terminal.screen.waitUntil(
    async () => {
      try {
        await readFile(path, 'utf8');
        return true;
      } catch {
        return false;
      }
    },
    {timeoutMs: 15000},
  );
}

function finish(argumentsText: string): FixtureReply {
  return {tool: 'subagent', arguments: argumentsText};
}

test('tightening a retained agent before a queued follow-up removes the saved tool grant', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let host: AuthorityHost | undefined;
  let initialSawBash = false;
  let followupSawBash = false;
  try {
    const stages = new Map<string, number>();
    host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      async request => {
        const history = JSON.stringify(request.messages);
        if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
        const marker = latestMarker(request, [
          'QUEUED_PERMISSION_INITIAL',
          'QUEUED_PERMISSION_FOLLOWUP',
        ]);
        if (marker === undefined) throw new Error('Permission marker missing.');
        const tools = request.tools?.map(tool => tool.function.name) ?? [];
        if (marker === 'QUEUED_PERMISSION_INITIAL') {
          initialSawBash ||= tools.includes('bash');
          const stage = stages.get(marker) ?? 0;
          if (stage === 0) {
            stages.set(marker, 1);
            started.resolve();
            await release.promise;
            return finish(
              '{"command":"finish","outcome":"fulfilled","text":"Initial assignment finished."}',
            );
          }
          stages.set(marker, stage + 1);
          return {text: 'Initial assignment delivered.'};
        }
        followupSawBash ||= tools.includes('bash');
        const stage = stages.get(marker) ?? 0;
        if (stage === 0) {
          stages.set(marker, 1);
          return finish(
            '{"command":"finish","outcome":"fulfilled","text":"Queued follow-up finished."}',
          );
        }
        stages.set(marker, stage + 1);
        return {text: 'Queued follow-up delivered.'};
      },
    );
    const initial = decodeAdmission(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'permission-initial',
              prompt: 'QUEUED_PERMISSION_INITIAL',
              workspace: 'direct',
              tools: ['bash', 'subagent'],
            },
          ],
        }),
      ),
    );
    const taskId = initial.tasks[0]?.taskId;
    const agentId = initial.tasks[0]?.agentId;
    if (taskId === undefined || agentId === undefined)
      throw new Error('Initial permission admission was incomplete.');
    await started.promise;
    const followup = decodeAdmission(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId,
          text: 'QUEUED_PERMISSION_FOLLOWUP',
        }),
      ),
    );
    const followupTaskId = followup.tasks[0]?.taskId;
    if (followupTaskId === undefined)
      throw new Error('Queued follow-up admission was incomplete.');
    const queued = await inspect(host);
    expect(queued.tasks.find(task => task.id === followupTaskId)?.phase).toBe(
      'queued',
    );
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'restrict',
          taskId,
          tools: ['subagent'],
        }),
      ),
    ).toContain('"status":"accepted"');
    expect(
      inspect(host).then(
        snapshot =>
          snapshot.agents.find(agent => agent.id === agentId)?.currentTools,
      ),
    ).resolves.toEqual(['subagent']);
    release.resolve();
    await waitForFleet(host);
    expect(initialSawBash).toBe(true);
    expect(followupSawBash).toBe(false);
    const final = await inspect(host);
    expect(final.tasks.find(task => task.id === followupTaskId)?.outcome).toBe(
      'fulfilled',
    );
    expect(
      final.tasks.find(task => task.id === followupTaskId)?.currentTools,
    ).toEqual(['subagent']);
  } finally {
    release.resolve();
    await host?.close();
  }
}, 60000);

test('tightening an active slow tool leaves it cancelling and keeps the queued next task stopped until actual exit', async () => {
  let host: AuthorityHost | undefined;
  let stopPath = '';
  let followupCalls = 0;
  let followupSawBash = false;
  try {
    const stages = new Map<string, number>();
    host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      async request => {
        const history = JSON.stringify(request.messages);
        if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
        const marker = latestMarker(request, [
          'ACTIVE_RESTRICT_INITIAL',
          'ACTIVE_RESTRICT_FOLLOWUP',
        ]);
        if (marker === undefined)
          throw new Error('Active restriction marker missing.');
        const stage = stages.get(marker) ?? 0;
        if (marker === 'ACTIVE_RESTRICT_INITIAL') {
          if (stage === 0) {
            stages.set(marker, 1);
            return {
              tool: 'bash',
              arguments: JSON.stringify({
                command: `printf started > ${join(host?.directory ?? '', 'active-started')}; trap '' TERM; while [ ! -e ${stopPath} ]; do sleep 0.01; done`,
              }),
            };
          }
          stages.set(marker, stage + 1);
          return finish(
            '{"command":"finish","outcome":"fulfilled","text":"Unexpected active completion."}',
          );
        }
        followupCalls++;
        followupSawBash ||=
          request.tools?.some(tool => tool.function.name === 'bash') ?? false;
        if (stage === 0) {
          stages.set(marker, 1);
          return finish(
            '{"command":"finish","outcome":"fulfilled","text":"Restricted follow-up finished."}',
          );
        }
        stages.set(marker, stage + 1);
        return {text: 'Restricted follow-up delivered.'};
      },
    );
    stopPath = join(host.directory, 'stop-active');
    const startedPath = join(host.directory, 'active-started');
    const initial = decodeAdmission(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'active-restriction',
              prompt: 'ACTIVE_RESTRICT_INITIAL',
              workspace: 'direct',
              tools: ['bash', 'subagent'],
            },
          ],
        }),
      ),
    );
    const taskId = initial.tasks[0]?.taskId;
    const agentId = initial.tasks[0]?.agentId;
    if (taskId === undefined || agentId === undefined)
      throw new Error('Active restriction admission was incomplete.');
    await waitForPath(host, startedPath);
    const followup = decodeAdmission(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId,
          text: 'ACTIVE_RESTRICT_FOLLOWUP',
        }),
      ),
    );
    const followupTaskId = followup.tasks[0]?.taskId;
    if (followupTaskId === undefined)
      throw new Error('Active restriction follow-up admission was incomplete.');
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'restrict',
          taskId,
          tools: ['subagent'],
        }),
      ),
    ).toContain('"status":"accepted"');
    const cancelling = await inspect(host);
    expect(cancelling.tasks.find(task => task.id === taskId)?.phase).toBe(
      'cancelling',
    );
    expect(
      cancelling.tasks.find(task => task.id === followupTaskId)?.phase,
    ).toBe('queued');
    expect(followupCalls).toBe(0);
    await writeFile(stopPath, 'stop\n');
    await waitForTaskEnded(host, taskId);
    expect(followupCalls).toBe(0);
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({command: 'queue', agentId, queueAction: 'continue'}),
      ),
    ).toContain('"status":"accepted"');
    const final = await waitForTaskEnded(host, followupTaskId);
    expect(followupCalls).toBeGreaterThan(0);
    expect(followupSawBash).toBe(false);
    expect(final.tasks.find(task => task.id === taskId)?.outcome).toBe(
      'cancelled',
    );
    expect(final.tasks.find(task => task.id === followupTaskId)?.outcome).toBe(
      'fulfilled',
    );
  } finally {
    if (stopPath !== '') await writeFile(stopPath, 'stop\n');
    await host?.close();
  }
}, 60000);

test('restricting an old retained assignment also stops removed tools in its new descendants', async () => {
  let stopPath = '';
  let descendantCalls = 0;
  const stages = new Map<string, number>();
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      const marker = latestMarker(request, [
        'RESTRICT_OLD',
        'RESTRICT_NEW_PARENT',
        'RESTRICT_NEW_CHILD',
      ]);
      if (!marker) throw new Error('Missing retained restriction marker.');
      const stage = stages.get(marker) ?? 0;
      stages.set(marker, stage + 1);
      if (marker === 'RESTRICT_NEW_CHILD') {
        descendantCalls++;
        return {
          tool: 'bash',
          arguments: JSON.stringify({
            command: `trap '' TERM; printf started > nested-started; while [ ! -e ${stopPath} ]; do sleep 0.01; done`,
          }),
        };
      }
      if (marker === 'RESTRICT_NEW_PARENT' && stage === 0)
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'dispatch',
            tasks: [
              {
                name: 'new-descendant',
                prompt: 'RESTRICT_NEW_CHILD',
                workspace: 'direct',
                tools: ['bash', 'subagent'],
              },
            ],
          }),
        };
      if (marker === 'RESTRICT_NEW_PARENT' && stage === 1)
        return {
          tool: 'subagent',
          arguments: '{"command":"wait","timeoutMs":10000}',
        };
      if (marker === 'RESTRICT_NEW_PARENT' && stage === 2)
        return finish(
          '{"command":"finish","outcome":"unable","text":"Descendant tool grant was revoked."}',
        );
      if (marker === 'RESTRICT_OLD' && stage === 0)
        return finish(
          '{"command":"finish","outcome":"fulfilled","text":"Original assignment completed."}',
        );
      return {text: 'Delivery ended.'};
    },
  );
  try {
    stopPath = join(host.directory, 'nested-stop');
    const original = decodeAdmission(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'retained-owner',
              prompt: 'RESTRICT_OLD',
              workspace: 'direct',
              tools: ['bash', 'subagent'],
            },
          ],
        }),
      ),
    );
    const old = original.tasks[0];
    if (!old) throw new Error('Missing original task.');
    await waitForTaskEnded(host, old.taskId);
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId: old.agentId,
        text: 'RESTRICT_NEW_PARENT',
      }),
    );
    await waitForPath(host, join(host.directory, 'nested-started'));
    const before = await inspect(host);
    const child = before.tasks.find(
      task => task.prompt === 'RESTRICT_NEW_CHILD',
    );
    if (!child) throw new Error('Missing newly owned descendant.');
    expect(child.phase).toBe('executing');
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'restrict',
          taskId: old.taskId,
          tools: ['subagent'],
        }),
      ),
    ).toContain('"status":"accepted"');
    const cancelling = await inspect(host);
    expect(cancelling.tasks.find(task => task.id === child.id)?.phase).toBe(
      'cancelling',
    );
    await writeFile(stopPath, 'stop');
    const ended = await waitForTaskEnded(host, child.id);
    expect(ended.tasks.find(task => task.id === child.id)?.outcome).toBe(
      'cancelled',
    );
    expect(descendantCalls).toBe(1);
  } finally {
    if (stopPath) await writeFile(stopPath, 'stop');
    await host.close();
  }
}, 30000);

test('a child cannot cancel, steer or follow up a peer task', async () => {
  let host: AuthorityHost | undefined;
  let stopPath = '';
  try {
    const stages = new Map<string, number>();
    let peerTargetTaskId = '';
    let peerTargetAgentId = '';
    const peerResponses: string[] = [];
    host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      async request => {
        const history = JSON.stringify(request.messages);
        if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
        const marker = latestMarker(request, ['PEER_ATTACK', 'PEER_TARGET']);
        if (marker === undefined) throw new Error('Peer marker missing.');
        const stage = stages.get(marker) ?? 0;
        if (marker === 'PEER_TARGET') {
          if (stage === 0) {
            stages.set(marker, 1);
            return {
              tool: 'bash',
              arguments: JSON.stringify({
                command: `printf started > ${join(host?.directory ?? '', 'peer-started')}; trap '' TERM; while [ ! -e ${stopPath} ]; do sleep 0.01; done`,
              }),
            };
          }
          if (stage === 1) {
            stages.set(marker, 2);
            return finish(
              '{"command":"finish","outcome":"fulfilled","text":"Peer target stopped."}',
            );
          }
          stages.set(marker, stage + 1);
          return {text: 'Peer target delivered.'};
        }
        if (stage === 0) {
          stages.set(marker, 1);
          return {
            tool: 'subagent',
            arguments: '{"command":"inspect"}',
          };
        }
        if (stage === 1) {
          const snapshot = decodeSnapshot(lastToolText(request));
          const target = snapshot.tasks.find(
            task => task.prompt === 'PEER_TARGET',
          );
          if (target === undefined)
            throw new Error('Peer target was not visible to the attacker.');
          peerTargetTaskId = target.id;
          peerTargetAgentId = target.agentId;
          stages.set(marker, 2);
          return {
            tool: 'subagent',
            arguments: JSON.stringify({
              command: 'cancel',
              taskId: target.id,
            }),
          };
        }
        if (stage === 2) {
          peerResponses.push(lastToolText(request));
          stages.set(marker, 3);
          return {
            tool: 'subagent',
            arguments: JSON.stringify({
              command: 'steer',
              taskId: peerTargetTaskId,
              text: 'Peer steering must be rejected.',
            }),
          };
        }
        if (stage === 3) {
          peerResponses.push(lastToolText(request));
          stages.set(marker, 4);
          return {
            tool: 'subagent',
            arguments: JSON.stringify({
              command: 'followup',
              agentId: peerTargetAgentId,
              text: 'Peer follow-up must be rejected.',
            }),
          };
        }
        if (stage === 4) {
          peerResponses.push(lastToolText(request));
          stages.set(marker, 5);
          return finish(
            JSON.stringify({
              command: 'finish',
              outcome: 'fulfilled',
              text: peerResponses.join('\n'),
            }),
          );
        }
        stages.set(marker, stage + 1);
        return {text: 'Peer authority checks delivered.'};
      },
    );
    stopPath = join(host.directory, 'stop-peer');
    const admission = decodeAdmission(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'peer-attacker',
              prompt: 'PEER_ATTACK',
              workspace: 'direct',
              tools: ['subagent'],
            },
            {
              name: 'peer-target',
              prompt: 'PEER_TARGET',
              workspace: 'direct',
              tools: ['bash', 'subagent'],
            },
          ],
        }),
      ),
    );
    const attackerTaskId = admission.tasks[0]?.taskId;
    const targetTaskId = admission.tasks[1]?.taskId;
    if (attackerTaskId === undefined || targetTaskId === undefined)
      throw new Error('Peer authority admission was incomplete.');
    const startedPath = join(host.directory, 'peer-started');
    await waitForPath(host, startedPath);
    const attacker = await waitForTaskEnded(host, attackerTaskId);
    const attackerTask = attacker.tasks.find(
      task => task.id === attackerTaskId,
    );
    expect(attackerTask?.outcome).toBe('fulfilled');
    expect(attackerTask?.report).toContain(
      'Cancellation requires current task ownership.',
    );
    expect(attackerTask?.report).toContain(
      'Steering requires current task ownership.',
    );
    expect(attackerTask?.report).toContain(
      'Follow-up requires a known retained descendant agent.',
    );
    expect(attacker.tasks.find(task => task.id === targetTaskId)?.phase).toBe(
      'executing',
    );
    await writeFile(stopPath, 'stop\n');
    const final = await waitForTaskEnded(host, targetTaskId);
    expect(final.tasks.find(task => task.id === targetTaskId)?.outcome).toBe(
      'fulfilled',
    );
  } finally {
    if (stopPath !== '') await writeFile(stopPath, 'stop\n');
    await host?.close();
  }
}, 60000);

test('a child cannot send communication across dispatches without main-agent relay', async () => {
  let host: AuthorityHost | undefined;
  let stopPath = '';
  let targetTaskId = '';
  try {
    const stages = new Map<string, number>();
    let crossDispatchResponse = '';
    host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      async request => {
        const history = JSON.stringify(request.messages);
        if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
        const marker = latestMarker(request, ['CROSS_TARGET', 'CROSS_ATTACK']);
        if (marker === undefined)
          throw new Error('Cross-dispatch marker missing.');
        const stage = stages.get(marker) ?? 0;
        if (marker === 'CROSS_TARGET') {
          if (stage === 0) {
            stages.set(marker, 1);
            return {
              tool: 'bash',
              arguments: JSON.stringify({
                command: `printf started > ${join(host?.directory ?? '', 'cross-started')}; trap '' TERM; while [ ! -e ${stopPath} ]; do sleep 0.01; done`,
              }),
            };
          }
          if (stage === 1) {
            stages.set(marker, 2);
            return finish(
              '{"command":"finish","outcome":"fulfilled","text":"Cross-dispatch target stopped."}',
            );
          }
          stages.set(marker, stage + 1);
          return {text: 'Cross-dispatch target delivered.'};
        }
        if (stage === 0) {
          stages.set(marker, 1);
          return {
            tool: 'subagent',
            arguments: JSON.stringify({
              command: 'message',
              taskId: targetTaskId,
              text: 'CROSS_DISPATCH_MESSAGE',
            }),
          };
        }
        if (stage === 1) {
          crossDispatchResponse = lastToolText(request);
          stages.set(marker, 2);
          return finish(
            JSON.stringify({
              command: 'finish',
              outcome: 'fulfilled',
              text: crossDispatchResponse,
            }),
          );
        }
        stages.set(marker, stage + 1);
        return {text: 'Cross-dispatch check delivered.'};
      },
    );
    stopPath = join(host.directory, 'stop-cross');
    const target = decodeAdmission(
      await host.invoke(
        'subagent',
        '{"command":"dispatch","tasks":[{"name":"cross-target","prompt":"CROSS_TARGET","workspace":"direct","tools":["bash","subagent"]}]}',
      ),
    );
    targetTaskId = target.tasks[0]?.taskId ?? '';
    if (targetTaskId === '')
      throw new Error('Cross-dispatch target admission was incomplete.');
    await waitForPath(host, join(host.directory, 'cross-started'));
    const attacker = decodeAdmission(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'cross-attacker',
              prompt: `CROSS_ATTACK:${targetTaskId}`,
              workspace: 'direct',
              tools: ['subagent'],
            },
          ],
        }),
      ),
    );
    const attackerTaskId = attacker.tasks[0]?.taskId;
    if (attackerTaskId === undefined)
      throw new Error('Cross-dispatch attacker admission was incomplete.');
    const finalAttacker = await waitForTaskEnded(host, attackerTaskId);
    const attackerTask = finalAttacker.tasks.find(
      task => task.id === attackerTaskId,
    );
    expect(crossDispatchResponse).toContain(
      'Cross-dispatch messages require a main-agent relay.',
    );
    expect(attackerTask?.report).toContain(
      'Cross-dispatch messages require a main-agent relay.',
    );
    expect(
      finalAttacker.messages.some(message =>
        message.text.includes('CROSS_DISPATCH_MESSAGE'),
      ),
    ).toBe(false);
    await writeFile(stopPath, 'stop\n');
    await waitForTaskEnded(host, targetTaskId);
  } finally {
    if (stopPath !== '') await writeFile(stopPath, 'stop\n');
    await host?.close();
  }
}, 60000);
