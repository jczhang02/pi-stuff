import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Admission = Schema.fromJsonString(
  Schema.Struct({tasks: Schema.Array(Schema.Struct({agentId: Schema.String}))}),
);

function selectedHistory(text: string, index: number): boolean {
  return text
    .split('\n')
    .some(
      line =>
        line.trimStart().startsWith('●') && line.includes(`HISTORY_${index}`),
    );
}

test('long History reveals the selected assignment and opens its retained prompt', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const latestUser = [...request.messages]
        .reverse()
        .find(message => message.role === 'user');
      if (JSON.stringify(latestUser?.content).includes('Run RTK turn'))
        return undefined;
      if (
        !JSON.stringify(request.messages).includes('HISTORY_REVIEW_ASSIGNMENT')
      )
        return undefined;
      if (request.messages.at(-1)?.role === 'tool')
        return {text: 'Settled history review.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"History review complete."}',
      };
    },
  );
  try {
    const agent = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'history-review',
              description: 'HISTORY_0 ● literal',
              prompt: 'HISTORY_REVIEW_ASSIGNMENT HISTORY_0',
              workspace: 'live',
            },
          ],
        }),
      ),
    ).tasks[0];
    if (!agent) throw new Error('History agent was not admitted.');
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    for (let index = 1; index < 8; index++) {
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId: agent.agentId,
          text: `HISTORY_REVIEW_ASSIGNMENT HISTORY_${index}`,
        }),
      );
      await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    }

    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Agents / history-review', {
      timeoutMs: 5000,
    });
    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('● ▸ History and evidence', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('l');
    await host.terminal.screen.waitUntil(
      screen => selectedHistory(screen.text, 7),
      {timeoutMs: 5000},
    );

    async function select(key: string, index: number): Promise<void> {
      await host.terminal.keyboard.type(key);
      const screen = await host.terminal.screen.waitUntil(
        snapshot => selectedHistory(snapshot.text, index),
        {timeoutMs: 5000},
      );
      expect(selectedHistory(screen.text, index)).toBe(true);
    }
    for (const rows of [24, 12]) {
      await host.terminal.resize({cols: 80, rows});
      await select('G', 7);
      await host.terminal.keyboard.type('h');
      await host.terminal.screen.waitForText('● ▸ History and evidence', {
        timeoutMs: 5000,
      });
      await host.terminal.keyboard.type('l');
      await host.terminal.screen.waitUntil(
        screen => selectedHistory(screen.text, 7),
        {timeoutMs: 5000},
      );
      await select('g', 0);
      await select('j', 1);
      await select('k', 0);
      await select('G', 7);
      await host.terminal.keyboard.type('u');
      await host.terminal.screen.waitUntil(
        screen => !selectedHistory(screen.text, 7),
        {timeoutMs: 5000},
      );
      await select('G', 7);
    }
    await select('g', 0);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('● ▾ Prompt', {timeoutMs: 5000});
    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.screen.waitForText(
      'Original request: HISTORY_REVIEW_ASSIGNMENT HISTORY_0',
      {timeoutMs: 5000},
    );
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 60000);
