import {expect, test} from 'bun:test';
import {writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';
import {
  openNamingSettings,
  backToNamingHome,
  closeNamingHome,
  namingConfiguration,
} from './naming-panel-helpers';

const configured = {
  naming: {automatic: false, model: {provider: 'fixture', id: 'naming'}},
};

test('panel fields save independently, preserve other configuration and apply without switching the conversation model', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({naming: {automatic: false}, rtk: {ansi: false}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await openNamingSettings(host);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitUntil(
      async () => (await namingConfiguration(host)).naming?.automatic === true,
      {timeoutMs: 4000},
    );
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Search models', {timeoutMs: 4000});
    await host.terminal.keyboard.type('fixture/naming');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('newline', {timeoutMs: 4000});
    await host.terminal.keyboard.press('Control+U');
    const rules =
      'Use a specific English task name.\nPreserve OAuth and user intent.';
    await host.terminal.keyboard.type(rules);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('submit', {timeoutMs: 4000});
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.press('Control+K');
    await host.terminal.keyboard.type('0');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'Maximum length must be a positive integer.',
      {timeoutMs: 4000},
    );
    expect((await namingConfiguration(host)).naming?.maxLength).toBeUndefined();
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.type('64');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    expect(await namingConfiguration(host)).toEqual({
      rtk: {ansi: false},
      naming: {
        automatic: true,
        model: {provider: 'fixture', id: 'naming'},
        prompt: rules,
        maxLength: 64,
      },
    });
    await backToNamingHome(host);
    await closeNamingHome(host);
    await host.invoke('', '{}');
    expect(provider.requests).toHaveLength(0);
    await host.command('/autoname Research OAuth compatibility');
    await host.waitForName(provider.title);
    expect(provider.requests).toHaveLength(1);
    expect(JSON.stringify(provider.requests[0]?.messages)).toContain(
      'at most 64 Unicode',
    );
    expect(JSON.stringify(provider.requests[0]?.messages)).toContain(
      'Preserve OAuth and user intent.',
    );
    expect(await host.terminal.logs.text()).not.toContain('Session named:');
    await host.reload();
    await openNamingSettings(host);
    expect(await host.terminal.screen.text()).toContain('fixture/naming');
    expect(await host.terminal.screen.text()).toContain('custom');
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

test('restoring defaults is confirmed, keeps the name and does not rearm the current session', async () => {
  const provider = new NamingProvider();
  const host = await launchPi(
    JSON.stringify({...configured, rtk: {ansi: false}}),
    undefined,
    'rtk',
    'fullscreen',
    provider.reply,
  );
  try {
    await host.command('/name Agreed OAuth task');
    await host.waitForName('Agreed OAuth task');
    await openNamingSettings(host);
    for (let i = 0; i < 4; i++) await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('All naming settings', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Restore naming defaults?', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('Control+C');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('Restore naming defaults?'),
      {timeoutMs: 4000},
    );
    expect((await namingConfiguration(host)).naming).toEqual(configured.naming);
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('All naming settings', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Restore naming defaults?', {
      timeoutMs: 4000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Automatic naming', {
      timeoutMs: 4000,
    });
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('Restore naming defaults?'),
      {timeoutMs: 4000},
    );
    expect(await namingConfiguration(host)).toEqual({
      naming: {},
      rtk: {ansi: false},
    });
    await backToNamingHome(host);
    expect(await host.terminal.screen.text()).toContain('Agreed OAuth task');
    await closeNamingHome(host);
    await host.invoke('', '{}');
    await host.command('/name');
    await host.terminal.screen.waitForText('Session name: Agreed OAuth task', {
      timeoutMs: 4000,
    });
    expect(provider.requests).toHaveLength(0);
  } finally {
    await host.close();
  }
}, 30000);

test.each([false, true])(
  'configuration save cancels old naming only after a successful commit; external edit: %s',
  async externalEdit => {
    const provider = new NamingProvider();
    provider.held = true;
    let aborted = false;
    const host = await launchPi(
      JSON.stringify(configured),
      undefined,
      'rtk',
      'fullscreen',
      (body, signal) => {
        if (body.model === 'naming')
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
            },
            {once: true},
          );
        return provider.reply(body, signal);
      },
    );
    try {
      await host.command('/autoname Research cancellation');
      await host.terminal.screen.waitUntil(
        () => provider.requests.length === 1,
        {timeoutMs: 4000},
      );
      await openNamingSettings(host);
      const external = '{"rtk":{"ansi":false}}';
      if (externalEdit)
        await writeFile(join(host.agent, 'pi-stuff.json'), external);
      await host.terminal.keyboard.press('Enter');
      if (externalEdit) {
        await host.terminal.screen.waitForText('Settings changed on disk.', {
          timeoutMs: 4000,
        });
        expect(await readFile(join(host.agent, 'pi-stuff.json'), 'utf8')).toBe(
          external,
        );
        expect(aborted).toBe(false);
        provider.release();
        await host.waitForName(provider.title);
        expect(await host.terminal.screen.text()).toContain('disabled');
      } else {
        await host.terminal.screen.waitUntil(() => aborted, {timeoutMs: 4000});
        provider.release();
        expect((await namingConfiguration(host)).naming?.automatic).toBe(true);
      }
      await backToNamingHome(host);
      await closeNamingHome(host);
      await host.invoke('', '{}');
      expect(provider.requests).toHaveLength(1);
      await host.command('/name');
      await host.terminal.screen.waitForText(
        externalEdit ? `Session name: ${provider.title}` : 'Usage: /name',
        {timeoutMs: 4000},
      );
    } finally {
      provider.release();
      await host.close();
    }
  },
  30000,
);

test.each(['close', 'settings'])(
  'panel generation rejects empty input and cancels on %s without a late name or notice',
  async destination => {
    const provider = new NamingProvider();
    provider.held = true;
    let aborted = false;
    const host = await launchPi(
      JSON.stringify(configured),
      undefined,
      'rtk',
      'fullscreen',
      (body, signal) => {
        if (body.model === 'naming')
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
            },
            {once: true},
          );
        return provider.reply(body, signal);
      },
    );
    try {
      await host.command('/autoname panel');
      await host.terminal.screen.waitForText('Generate name', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press('ArrowDown');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('No dialogue to name yet', {
        timeoutMs: 4000,
      });
      expect(provider.requests).toHaveLength(0);
      await closeNamingHome(host);
      await host.invoke('', '{}');
      await host.command('/autoname panel');
      await host.terminal.screen.waitForText('Generate name', {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press('ArrowDown');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitUntil(
        () => provider.requests.length === 1,
        {
          timeoutMs: 4000,
        },
      );
      expect(await host.terminal.screen.text()).not.toContain('Naming...');
      await host.terminal.keyboard.press('Enter');
      expect(provider.requests).toHaveLength(1);
      if (destination === 'settings') {
        await host.terminal.keyboard.press('ArrowUp');
        await host.terminal.keyboard.press('Enter');
        await host.terminal.screen.waitForText('Automatic naming', {
          timeoutMs: 4000,
        });
      } else await closeNamingHome(host);
      await host.terminal.screen.waitUntil(() => aborted, {timeoutMs: 4000});
      if (destination === 'settings') {
        provider.release();
        expect(await host.terminal.screen.text()).toContain(
          'AutoName / Settings',
        );
        await backToNamingHome(host);
        await closeNamingHome(host);
      }
      provider.release();
      await host.invoke('', '{}');
      await host.command('/name');
      await host.terminal.screen.waitForText('Usage: /name', {timeoutMs: 4000});
      expect(provider.requests).toHaveLength(1);
      expect(await host.terminal.logs.text()).not.toContain(
        'Naming superseded',
      );
      expect(await host.terminal.logs.text()).not.toContain(
        'Name not saved yet.',
      );
    } finally {
      provider.release();
      await host.close();
    }
  },
  30000,
);
