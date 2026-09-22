import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('Welcome uses square corners and the actual model, then clears on the first turn', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 120, rows: 32});
    await host.terminal.screen.waitForText('Welcome back!', {timeoutMs: 5000});
    const wide = await host.terminal.screen.text();
    expect(wide).toMatch(/┌─+ Pi Stuff /u);
    expect(wide).toContain('fixture');
    expect(wide).toContain('10 tools');
    expect(wide).toContain('0 skills');
    expect(wide).not.toContain('gpt-5.4');
    expect(wide).not.toContain('╭');
    await host.terminal.resize({cols: 60, rows: 30});
    await host.terminal.screen.waitForText(/^┌─ Pi Stuff /mu, {
      timeoutMs: 5000,
    });
    const narrow = await host.terminal.screen.text();
    expect(narrow).toContain('Welcome back!');
    expect(narrow).not.toContain('Tips for getting started');
    expect(narrow).toContain('fixture');
    await host.invoke('bash', JSON.stringify({command: 'printf STARTED'}));
    expect(await host.terminal.screen.text()).not.toContain('Welcome back!');
    await host.reload();
    expect(await host.terminal.screen.text()).not.toContain('Welcome back!');
  } finally {
    await host.close();
  }
}, 30000);
