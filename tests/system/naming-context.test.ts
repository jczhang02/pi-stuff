import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

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
    await host.command('/autoname');
    await host.terminal.screen.waitForText('Session named:', {timeoutMs: 4000});
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
    await host.command('/autoname');
    await host.terminal.screen.waitForText('Session named:', {timeoutMs: 4000});
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
