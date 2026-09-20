import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Admission = Schema.Struct({
  tasks: Schema.Array(Schema.Struct({taskId: Schema.String})),
});

const decodeAdmission = (value: string) =>
  Schema.decodeUnknownSync(Admission)(JSON.parse(value));

type PiHost = Awaited<ReturnType<typeof launchPi>>;

async function visibleActionLines(host: PiHost): Promise<string[]> {
  return (await host.terminal.screen.text())
    .split('\n')
    .filter(line => line.includes('● ') || line.includes('○ '));
}

async function selectVisibleAction(host: PiHost, label: string): Promise<void> {
  const lines = await visibleActionLines(host);
  const current = lines.findIndex(line => line.includes('● '));
  const target = lines.findIndex(line => line.includes(label));
  expect(target).toBeGreaterThanOrEqual(0);
  expect(current).toBeGreaterThanOrEqual(0);
  if (target > current)
    await host.terminal.keyboard.type('j'.repeat(target - current));
  else if (target < current)
    await host.terminal.keyboard.type('k'.repeat(current - target));
  await host.terminal.keyboard.press('Enter');
}

async function confirmStop(host: PiHost): Promise<void> {
  const lines = await visibleActionLines(host);
  const selected = lines.some(line => line.includes('● Confirm stop'));
  if (!selected) {
    await host.terminal.keyboard.type('j');
    await new Promise(resolve => setTimeout(resolve, 100));
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('● Confirm stop', {
      timeoutMs: 5000,
    });
  }
}

test('forward dependencies preserve admission order among ready overview nodes', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Ready order verified"}',
      };
    },
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            key: 'c',
            name: 'forward-C',
            prompt: 'Consume A',
            needs: ['a'],
            workspace: 'live',
          },
          {
            key: 'b',
            name: 'ready-B',
            prompt: 'Independent B',
            workspace: 'live',
          },
          {key: 'a', name: 'ready-A', prompt: 'Supply C', workspace: 'live'},
        ],
      }),
    );
    await host.command('/agents');
    await host.terminal.screen.waitForText('● ready-B', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.screen.waitForText('● ready-A', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.screen.waitForText('● forward-C', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 20000);

// Real model requests pause at controlled boundaries while the actual Pi UI stays live.
test('a long Stop preview follows new descendants and keeps confirmation reachable', async () => {
  const firstBranch = Promise.withResolvers<void>();
  const addLateChild = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  let leadCalls = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      const messages = JSON.stringify(request.messages);
      if (!messages.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      if (messages.includes('BRANCH_LEAD')) {
        leadCalls++;
        if (leadCalls === 1)
          return {
            tool: 'subagent',
            arguments: JSON.stringify({
              command: 'dispatch',
              tasks: Array.from({length: 24}, (_, index) => ({
                name: `member-${index}`,
                prompt: `OWNED_MEMBER_${index}`,
                workspace: 'live',
              })),
            }),
          };
        if (leadCalls === 2) {
          firstBranch.resolve();
          await addLateChild.promise;
          return {
            tool: 'subagent',
            arguments: JSON.stringify({
              command: 'dispatch',
              tasks: [
                {
                  name: 'late-member',
                  prompt: 'LATE_OWNED_MEMBER',
                  workspace: 'live',
                },
              ],
            }),
          };
        }
      }
      await cleanup.promise;
      return {text: 'Stopped fixture work.'};
    },
  );
  try {
    await host.terminal.resize({cols: 80, rows: 24});
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [{name: 'lead', prompt: 'BRANCH_LEAD', workspace: 'live'}],
      }),
    );
    await firstBranch.promise;
    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Agents / Actions', {
      timeoutMs: 5000,
    });
    await selectVisibleAction(host, 'Stop owned branch');
    await host.terminal.screen.waitForText('Agents / Stop branch', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain(
      'LATE_OWNED_MEMBER',
    );
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('OWNED_MEMBER_23', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('Back without stopping', {
      timeoutMs: 5000,
    });
    addLateChild.resolve();
    await host.terminal.screen.waitForText('LATE_OWNED_MEMBER', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('The preview remains live', {
      timeoutMs: 5000,
    });
    await confirmStop(host);
    await host.terminal.screen.waitForText('● Confirm stop', {timeoutMs: 5000});
    const confirmation = await host.terminal.screen.text();
    expect(confirmation).toContain('Agents / Stop branch');
    expect(confirmation).toContain('q back');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Cancellation accepted', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitUntil(
      screen => !/^Agents \/|^Fleet$/mu.test(screen.text),
      {timeoutMs: 5000},
    );
    const observed = await host.invoke('subagent', '{"command":"inspect"}');
    expect(observed).toContain('"stopOutcome":"cancelled"');
    expect(observed).toContain('LATE_OWNED_MEMBER');
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    addLateChild.resolve();
    cleanup.resolve();
    await host.close();
  }
}, 30000);

test('overview selection reveals distant and saved-input nodes while summary scroll stays local', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
        return undefined;
      if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"SAVED_NAVIGATION_RESULT"}',
      };
    },
  );
  try {
    await host.terminal.resize({cols: 80, rows: 24});
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: Array.from({length: 8}, (_, index) => ({
          key: `n${index}`,
          name: `node${index}`,
          prompt:
            index === 7
              ? 'LONG_SUMMARY '.repeat(40)
              : `Inspect branch ${index}`,
          workspace: 'live',
          needs: index === 0 ? [] : [`n${index - 1}`],
        })),
      }),
    );
    const admission = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          tasks: Schema.Array(Schema.Struct({taskId: Schema.String})),
        }),
      ),
    )(admitted);
    for (let index = 0; index < 10; index++) {
      if (
        (
          await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}')
        ).includes('"waitStatus":"settled"')
      )
        break;
    }
    await host.command('/agents');
    await host.terminal.screen.waitForText('Agents / Overview', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('● node7', {timeoutMs: 5000});
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('● node0', {timeoutMs: 5000});
    await host.terminal.keyboard.type('/');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('node7');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('● node7', {timeoutMs: 5000});
    await host.terminal.keyboard.type('/');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.type('ABSENT_NODE');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('No matches for ABSENT_NODE', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('● node7');
    await host.terminal.keyboard.press('Tab');
    await host.terminal.screen.waitForText('● Selected assignment', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('Result: SAVED_NAVIGATION_RESULT', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('● node7');
    await host.terminal.keyboard.press('Tab');
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Agents / Actions', {
      timeoutMs: 5000,
    });
    await selectVisibleAction(host, 'Open detail');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('/');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('LONG_SUMMARY');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Reader · node7 / Prompt', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('No matches');
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('Agents / node7', {timeoutMs: 5000});
    await host.terminal.keyboard.type('f');
    await host.terminal.screen.waitForText('Following latest output', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('/');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('ABSENT_RECORD');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('No matches for ABSENT_RECORD', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('n');
    expect(await host.terminal.screen.text()).toContain(
      'No matches for ABSENT_RECORD',
    );
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('Agents / node7', {timeoutMs: 5000});
    const detailSections = [
      'Prompt',
      'Progress',
      'Result',
      'Communication',
      'Relations and queue',
      'Configuration and usage',
      'Workspace and recovery',
      'History and evidence',
    ];
    for (let index = 1; index < detailSections.length; index++) {
      await host.terminal.keyboard.type('j');
      await new Promise(resolve => setTimeout(resolve, 300));
      const screen = await host.terminal.screen.text();
      const selectedIndex = detailSections.findIndex(section =>
        screen
          .split('\n')
          .some(line => line.includes('● ') && line.includes(section)),
      );
      if (selectedIndex === index - 1) await host.terminal.keyboard.type('j');
    }
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('● ▸ History and evidence', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('Agents / node7');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Reader · node7 / History', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Agents / node7', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('● ▾ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Reader · node7 / Prompt', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Agents / node7', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('Agents / Overview', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitUntil(
      screen => !/^Agents \/|^Fleet$/mu.test(screen.text),
      {timeoutMs: 5000},
    );
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'consumer',
            prompt: 'Read the saved report',
            workspace: 'live',
            inputs: [admission.tasks[0]?.taskId],
          },
        ],
      }),
    );
    await host.command('/agents');
    await host.terminal.screen.waitForText('Agents / Overview', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type(']G');
    await host.terminal.screen.waitForText('Saved input reference', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('● Saved node0', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Agents / node0', {timeoutMs: 5000});
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('Saved input reference', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('● Saved node0');
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('Agents / Overview'),
      {timeoutMs: 5000},
    );
    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('/');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.type('ABSENT_AGENT');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('No matches for ABSENT_AGENT', {
      timeoutMs: 5000,
    });
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

test('a cancelled task without queued work remains Cancelled in Fleet', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let childRequests = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      if (!JSON.stringify(request.messages).includes('CANCEL_ONLY_ASSIGNMENT'))
        return undefined;
      if (request.messages.at(-1)?.role === 'tool')
        return {text: 'recovery settled'};
      if (childRequests++ === 0) {
        started.resolve();
        await release.promise;
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'finish',
            outcome: 'fulfilled',
            text: 'cancel-only response',
          }),
        };
      }
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: 'RECOVERY_FINISHED',
        }),
      };
    },
  );
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'cancel-only',
            prompt: 'CANCEL_ONLY_ASSIGNMENT',
            workspace: 'live',
          },
        ],
      }),
    );
    const taskId = decodeAdmission(admitted).tasks[0]?.taskId;
    expect(taskId).toBeString();
    await started.promise;
    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('cancel-only', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Agents / Actions', {
      timeoutMs: 5000,
    });
    await selectVisibleAction(host, 'Stop owned branch');
    await host.terminal.screen.waitForText('Agents / Stop branch', {
      timeoutMs: 5000,
    });
    await confirmStop(host);
    await host.terminal.screen.waitForText('● Confirm stop', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Cancellation accepted', {
      timeoutMs: 5000,
    });
    release.resolve();
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('Cancelled', {timeoutMs: 5000});
    const fleet = await host.terminal.screen.text();
    expect(fleet).toContain('Cancelled');
    expect(fleet).not.toContain('Held');

    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Agents / Actions', {
      timeoutMs: 5000,
    });
    const recoveryActions = await visibleActionLines(host);
    expect(recoveryActions[0]).toContain('Recover held or unknown queue');
    expect(
      recoveryActions.some(line =>
        line.includes('Follow up with retained context'),
      ),
    ).toBe(false);
    expect(recoveryActions.some(line => line.includes('Queue controls'))).toBe(
      false,
    );
    await selectVisibleAction(host, 'Recover held or unknown queue');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('RECOVERY_FOLLOWUP');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('followup accepted', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    const recoveredFleet = await host.terminal.screen.text();
    expect(recoveredFleet).toContain('RECOVERY_FOLLOWUP');
    expect(recoveredFleet).toContain('Done');
    await host.terminal.keyboard.press('Escape');
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);
