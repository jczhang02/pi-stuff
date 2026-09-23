import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider, modelResponse} from './fixtures/naming-provider';

test('host recovery of a transient opening error still produces only one automatic name', async () => {
  const provider = new NamingProvider();
  let mainCalls = 0;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    (body, signal) => {
      if (body.model === 'fixture' && ++mainCalls === 1)
        return new Response(
          JSON.stringify({error: {message: 'Transient opening error'}}),
          {status: 503},
        );
      return provider.reply(body, signal);
    },
  );
  try {
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({
        retry: {
          enabled: true,
          maxRetries: 1,
          baseDelayMs: 10,
          provider: {maxRetries: 0},
        },
      }),
    );
    await host.restart([]);
    await host.invoke('', '{}');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
    expect(mainCalls).toBe(3);
    expect(provider.requests).toHaveLength(1);
  } finally {
    await host.close();
  }
}, 30000);

test.each([false, true])(
  'overflow compaction preserves opening identity with a separate queued request: %s',
  async queued => {
    const provider = new NamingProvider();
    let calls = 0;
    let release: (() => void) | undefined;
    const host = await launchPi(
      JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
      undefined,
      'rtk',
      'fullscreen',
      async (body, signal) => {
        if (body.model !== 'fixture') return provider.reply(body, signal);
        calls++;
        if (calls === 1)
          return modelResponse('Incomplete opening answer', 'length');
        if (calls === 2) {
          await new Promise<void>(resolve => {
            release = resolve;
            signal.addEventListener('abort', () => resolve(), {once: true});
          });
          return modelResponse(
            'The user requested OAuth compatibility research.',
          );
        }
        return modelResponse('QUEUED_SECOND_TASK_FINAL_ANSWER');
      },
    );
    try {
      await writeFile(
        join(host.agent, 'settings.json'),
        JSON.stringify({
          compaction: {enabled: true, keepRecentTokens: 1, reserveTokens: 128},
          retry: {enabled: false},
        }),
      );
      await host.restart([]);
      await host.command('Research OAuth compatibility without implementation');
      await host.terminal.screen.waitUntil(() => calls === 2, {
        timeoutMs: 4000,
      });
      if (queued) {
        await host.command('Implement an unrelated S3 uploader instead');
        await host.terminal.screen.waitForText(
          'Queued message for after compaction',
          {timeoutMs: 4000},
        );
      }
      release?.();
      await host.terminal.screen.waitForText(
        'QUEUED_SECOND_TASK_FINAL_ANSWER',
        {
          timeoutMs: 4000,
        },
      );
      await host.command('/name');
      if (queued) {
        await host.terminal.screen.waitForText('Usage: /name', {
          timeoutMs: 4000,
        });
        expect(provider.requests).toHaveLength(0);
      } else {
        await host.terminal.screen.waitUntil(
          () => provider.requests.length === 1,
          {timeoutMs: 4000},
        );
        const payload = JSON.stringify(provider.requests[0]?.messages);
        expect(payload).toContain(
          'Research OAuth compatibility without implementation',
        );
        expect(payload).toContain('QUEUED_SECOND_TASK_FINAL_ANSWER');
        expect(payload).not.toContain('Incomplete opening answer');
      }
    } finally {
      release?.();
      await host.close();
    }
  },
  30000,
);

test('tool continuations finish the opening without including tool output in either naming request', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    const result = await host.invoke(
      'bash',
      JSON.stringify({command: 'printf TOOL_RESULT_EXCLUDED'}),
    );
    expect(result).toContain('TOOL_RESULT_EXCLUDED');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    expect(JSON.stringify(provider.requests[0]?.messages)).not.toContain(
      'TOOL_RESULT_EXCLUDED',
    );
    expect(JSON.stringify(provider.requests[0]?.messages)).toContain(
      'RTK_TURN_1_DONE',
    );
    provider.title = 'research: Review the agreed task';
    await host.command('/autoname');
    await host.waitForName(provider.title);
    expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(provider.requests[1]?.messages)).not.toContain(
      'TOOL_RESULT_EXCLUDED',
    );
  } finally {
    await host.close();
  }
}, 30000);

test('raw skill requests and manual context omit loaded skill instructions', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    const skill = join(host.directory, 'SKILL.md');
    await writeFile(
      skill,
      '---\nname: naming-fixture\ndescription: Test naming input boundaries\n---\nSKILL_INSTRUCTIONS_EXCLUDED\n',
    );
    await host.restart(['--skill', skill]);
    await host.command('/skill:naming-fixture Research OAuth compatibility');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    const opening = JSON.stringify(provider.requests[0]?.messages);
    expect(opening).toContain(
      '/skill:naming-fixture Research OAuth compatibility',
    );
    expect(opening).not.toContain('SKILL_INSTRUCTIONS_EXCLUDED');
    provider.title = 'research: Review the agreed task';
    await host.command('/autoname');
    await host.waitForName(provider.title);
    const manual = JSON.stringify(provider.requests[1]?.messages);
    expect(manual).toContain('Research OAuth compatibility');
    expect(manual).not.toContain('SKILL_INSTRUCTIONS_EXCLUDED');
  } finally {
    await host.close();
  }
}, 30000);

test('explicit generation during the opening consumes automation even when generation fails', async () => {
  const provider = new NamingProvider();
  provider.title = '';
  let started = false;
  let release: (() => void) | undefined;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    async (body, signal) => {
      if (body.model === 'fixture' && !started) {
        started = true;
        await new Promise<void>(resolve => {
          release = resolve;
          signal.addEventListener('abort', () => resolve(), {once: true});
        });
      }
      return provider.reply(body, signal);
    },
  );
  try {
    await host.start('', '{}');
    await host.terminal.screen.waitUntil(() => started, {timeoutMs: 4000});
    await host.command('/autoname Research the opening');
    await host.terminal.screen.waitForText('Naming failed: invalid name', {
      timeoutMs: 4000,
    });
    release?.();
    await host.terminal.screen.waitForText('RTK_TURN_1_DONE', {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(1);
  } finally {
    release?.();
    await host.close();
  }
}, 30000);
