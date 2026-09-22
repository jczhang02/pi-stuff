import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

test('Pi names the opening exchange once and retains it through later turns', async () => {
  let requests = 0;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    body => {
      if (body.model !== 'naming') return undefined;
      requests++;
      return new Response(
        `data: ${JSON.stringify({
          id: 'name',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {content: 'research: Investigate RTK command output'},
              finish_reason: 'stop',
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
        {headers: {'content-type': 'text/event-stream'}},
      );
    },
  );
  try {
    await host.invoke('', '{}');
    await host.terminal.screen.waitUntil(() => requests === 1, {
      timeoutMs: 4000,
    });
    await host.command('/name');
    await host.terminal.screen.waitForText(
      'research: Investigate RTK command output',
      {timeoutMs: 4000},
    );
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText(
      'research: Investigate RTK command output',
      {timeoutMs: 4000},
    );
    expect(requests).toBe(1);
  } finally {
    await host.close();
  }
}, 30000);

test('parent-linked sessions skip automatic naming but retain explicit generation', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/host-parent-session');
    await host.terminal.screen.waitForText('HOST_PARENT_SESSION', {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(0);
    await host.command('/autoname Research linked sessions');
    await host.terminal.screen.waitForText('Session named:', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(1);
  } finally {
    await host.close();
  }
}, 30000);

test('opening authentication failure before an agent run consumes automatic eligibility', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/host-provider off');
    await host.terminal.screen.waitForText('HOST_PROVIDER_off', {
      timeoutMs: 4000,
    });
    await host.start('', '{}');
    try {
      await host.terminal.screen.waitForText('No API key', {timeoutMs: 4000});
    } catch (error) {
      console.error(await host.terminal.screen.text());
      throw error;
    }
    await host.command('/host-provider on');
    await host.terminal.screen.waitForText('HOST_PROVIDER_on', {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(0);
  } finally {
    await host.close();
  }
}, 30000);

test('a failed opening is never named or deferred to a later successful exchange', async () => {
  const provider = new NamingProvider();
  let rejected = false;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    (body, signal) => {
      if (body.model === 'fixture' && !rejected) {
        rejected = true;
        return new Response(
          JSON.stringify({
            error: {message: 'Opening rejected', type: 'invalid_request_error'},
          }),
          {status: 400},
        );
      }
      return provider.reply(body, signal);
    },
  );
  try {
    await host.start('', '{}');
    await host.terminal.screen.waitForText('Opening rejected', {
      timeoutMs: 5000,
    });
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(0);
    await host.command('/autoname Research opening failures');
    await host.terminal.screen.waitForText('Session named:', {timeoutMs: 4000});
    expect(provider.requests).toHaveLength(1);
  } finally {
    await host.close();
  }
}, 30000);

test('an explicit opening name prevents automatic generation and preserves direct renames', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/autoname Research RTK command output');
    await host.terminal.screen.waitForText(
      'Session named: research: Investigate RTK command output',
      {timeoutMs: 4000},
    );
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(1);
    provider.held = true;
    await host.command('/autoname Investigate cancellation');
    await host.terminal.screen.waitUntil(() => provider.requests.length === 2, {
      timeoutMs: 4000,
    });
    await host.command('/name User chosen name');
    await host.terminal.screen.waitForText(
      'Session name set: User chosen name',
      {timeoutMs: 4000},
    );
    provider.release();
    await host.terminal.screen.waitForText('Naming superseded', {
      timeoutMs: 4000,
    });
    await host.command('/name');
    await host.terminal.screen.waitForText('User chosen name', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(2);
  } finally {
    provider.release();
    await host.close();
  }
}, 30000);
