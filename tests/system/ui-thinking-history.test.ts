import {expect, test} from 'bun:test';
import {resolve, join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {launchPi} from './fixtures/pi-terminal';

test('Measured thinking follows tree selection and survives a compaction cut after its timing entry', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/ui-lifecycle.ts'),
    'ui',
  );
  const gate = Promise.withResolvers<void>();
  try {
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({
        compaction: {enabled: false, keepRecentTokens: 1, reserveTokens: 100},
      }),
    );
    await host.reload();
    await host.terminal.resize({cols: 100, rows: 45});
    await host.startResponse('EARLY_ANSWER', 'EARLY_THOUGHT');
    await host.terminal.screen.waitForText('EARLY_ANSWER', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Control+T');
    await host.command('/lifecycle-mark early');
    await host.terminal.screen.waitForText('MARKED:early', {timeoutMs: 5000});
    await host.startResponse('KEPT_ANSWER', 'KEPT_THOUGHT', gate.promise);
    await host.terminal.screen.waitForText(/• Thinking · [1-9]\d*s/u, {
      timeoutMs: 5000,
    });
    gate.resolve();
    await host.terminal.screen.waitForText('KEPT_ANSWER', {timeoutMs: 5000});
    const label = (await host.terminal.screen.text()).match(
      /• Thoughts · [1-9]\d*s/u,
    )?.[0];
    if (!label) throw new Error('Missing measured duration');
    await host.command('/lifecycle-mark kept');
    await host.terminal.screen.waitForText('MARKED:kept', {timeoutMs: 5000});
    await host.command('/lifecycle-tree early');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('KEPT_ANSWER'),
      {timeoutMs: 5000},
    );
    expect(await host.terminal.screen.text()).toContain('• Thoughts · 0s');
    expect(await host.terminal.screen.text()).not.toContain(label);
    await host.command('/lifecycle-tree kept');
    await host.terminal.screen.waitForText('KEPT_ANSWER', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain(label);
    await host.command('/compact fixture-keep-thinking');
    await host.terminal.screen.waitForText('Compacted', {timeoutMs: 5000});
    for (const stage of ['compacted', 'reload']) {
      if (stage === 'reload') await host.reload();
      const screen = await host.terminal.screen.text();
      expect(screen).toContain('KEPT_ANSWER');
      expect(screen).toContain(label);
      expect(screen).not.toContain('EARLY_ANSWER');
    }
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    gate.resolve();
    await host.close();
  }
}, 30000);
