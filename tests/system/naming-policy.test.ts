import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';
import {Schema} from 'effect';

test('missing naming authentication gives an actionable error without a provider request', async () => {
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
    await host.command('/autoname Research authentication');
    await host.terminal.screen.waitForText(
      'Naming failed: authentication unavailable',
      {timeoutMs: 4000},
    );
    expect(provider.requests).toHaveLength(0);
    await host.command('/host-provider on');
    await host.terminal.screen.waitForText('HOST_PROVIDER_on', {
      timeoutMs: 4000,
    });
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(0);
  } finally {
    await host.close();
  }
}, 30000);

test('provider failures make one HTTP request and keep explicit generation available', async () => {
  const provider = new NamingProvider();
  let failures = 0;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    (body, signal) => {
      if (body.model === 'naming' && failures < 3) {
        failures++;
        return new Response(
          JSON.stringify({error: {message: 'SENSITIVE_PROVIDER_DETAILS'}}),
          {status: 503},
        );
      }
      return provider.reply(body, signal);
    },
  );
  try {
    await host.command('/autoname Investigate provider failures');
    await host.terminal.screen.waitForText('Naming failed', {timeoutMs: 7000});
    expect(failures).toBe(1);
    expect(await host.terminal.screen.text()).not.toContain(
      'SENSITIVE_PROVIDER_DETAILS',
    );
    failures = 3;
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(0);
    await host.command('/autoname Investigate recovery');
    await host.terminal.screen.waitForText('Session named:', {timeoutMs: 4000});
    const request = provider.requests[0];
    expect(
      request?.max_tokens ?? request?.max_completion_tokens,
    ).toBeGreaterThan(0);
    expect(
      request?.max_tokens ?? request?.max_completion_tokens,
    ).toBeLessThanOrEqual(1024);
    expect(request?.reasoning_effort).toBeUndefined();
  } finally {
    await host.close();
  }
}, 30000);

test('a naming deadline releases the command without retrying or stopping the conversation', async () => {
  const provider = new NamingProvider();
  provider.held = true;
  const host = await launchPi(
    JSON.stringify({naming: {model: {provider: 'fixture', id: 'naming'}}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/name Keep this name');
    await host.terminal.screen.waitForText('Session name set: Keep this name', {
      timeoutMs: 4000,
    });
    const started = Date.now();
    await host.command('/autoname Research deadlines');
    await host.terminal.screen.waitForText('Naming timed out', {
      timeoutMs: 17000,
    });
    expect(Date.now() - started).toBeLessThan(17000);
    expect(provider.requests).toHaveLength(1);
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText('Session name: Keep this name', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(1);
  } finally {
    provider.release();
    await host.close();
  }
}, 30000);

test('manual-only naming applies a custom language and independent length limit', async () => {
  const provider = new NamingProvider();
  provider.title = '调查 RTK 调用约定';
  const host = await launchPi(
    JSON.stringify({
      naming: {
        automatic: false,
        prompt: '用中文描述主任务, 保留标识符',
        maxLength: 24,
        model: {provider: 'fixture', id: 'naming'},
      },
    }),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(0);
    await host.command('/autoname 研究 RTK 的调用约定');
    await host.terminal.screen.waitForText('Session named: 调查 RTK 调用约定', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(1);
    expect(JSON.stringify(provider.requests[0]?.messages)).toContain(
      '用中文描述主任务, 保留标识符',
    );
    provider.title = '这是超过配置长度上限的名称'.repeat(3);
    await host.command('/autoname 研究超长输出');
    await host.terminal.screen.waitForText('Naming failed: invalid name', {
      timeoutMs: 4000,
    });
    await host.command('/name');
    await host.terminal.screen.waitForText('Session name: 调查 RTK 调用约定', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(2);
  } finally {
    await host.close();
  }
}, 30000);

test('naming bounds input while preserving the request after a long paste and a long hint', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({
      naming: {
        model: {provider: 'fixture', id: 'naming'},
      },
    }),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command(
      'Opening context ' +
        '日志内容'.repeat(1200) +
        ' Research OAuth compatibility without implementing it',
    );
    await host.terminal.screen.waitUntil(() => provider.requests.length === 1, {
      timeoutMs: 4000,
    });
    const automatic = provider.requests[0]?.messages.at(-1)?.content;
    if (!Schema.is(Schema.String)(automatic))
      throw new Error('Expected text naming input');
    expect(Array.from(automatic).length).toBeLessThanOrEqual(2000);
    expect(automatic).toContain('Opening context');
    expect(automatic).toContain(
      'Research OAuth compatibility without implementing it',
    );
    await host.terminal.screen.waitForText(
      'research: Investigate RTK command output',
      {timeoutMs: 4000},
    );
    await host.command(
      '/autoname Current task ' +
        '说明'.repeat(3000) +
        ' Compare OAuth provider support',
    );
    await host.terminal.screen.waitUntil(() => provider.requests.length === 2, {
      timeoutMs: 4000,
    });
    const explicit = provider.requests[1]?.messages.at(-1)?.content;
    if (!Schema.is(Schema.String)(explicit))
      throw new Error('Expected text naming input');
    expect(Array.from(explicit).length).toBeLessThanOrEqual(4000);
    expect(explicit).toContain('Current task');
    expect(explicit).toContain('Compare OAuth provider support');
  } finally {
    await host.close();
  }
}, 30000);
