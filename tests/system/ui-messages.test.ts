import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('Welcome survives replacement and reload of an empty session', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.screen.waitForText('Welcome back!', {timeoutMs: 5000});
    await host.command('/host-session new');
    await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('Welcome back!');
    await host.reload();
    expect(await host.terminal.screen.text()).toContain('Welcome back!');
    await host.startResponse('EMPTY_SESSION_REPLACED');
    await host.terminal.screen.waitForText('EMPTY_SESSION_REPLACED', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('Welcome back!');
  } catch (error) {
    console.error(await host.terminal.logs.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

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

test('Thoughts retain native global and local disclosure independently of tools', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 100, rows: 45});
    await host.startResponse('FIRST_ANSWER', 'FIRST_THOUGHT');
    await host.terminal.screen.waitForText('FIRST_ANSWER', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('FIRST_THOUGHT');
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('FIRST_THOUGHT'),
      {timeoutMs: 5000},
    );
    await host.startResponse('SECOND_ANSWER', 'SECOND_THOUGHT');
    await host.terminal.screen.waitForText('SECOND_ANSWER', {timeoutMs: 5000});
    expect(host.sentAssistant()).toBe('"FIRST_ANSWER"');
    const hidden = await host.terminal.screen.text();
    expect(hidden).not.toContain('FIRST_THOUGHT');
    expect(hidden).not.toContain('SECOND_THOUGHT');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('Tool output: expanded', {
      timeoutMs: 5000,
    });
    const toolsExpanded = await host.terminal.screen.text();
    expect(toolsExpanded).not.toContain('FIRST_THOUGHT');
    expect(toolsExpanded).not.toContain('SECOND_THOUGHT');
    const rows = toolsExpanded.split('\n');
    const y = rows.findIndex(row => /Thinking|Thoughts/u.test(row));
    const x = rows[y]?.search(/\S/u) ?? -1;
    expect(x).toBeGreaterThanOrEqual(0);
    await host.terminal.mouse({action: 'click', x, y, button: 'left'});
    await host.terminal.screen.waitForText('FIRST_THOUGHT', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).not.toContain('SECOND_THOUGHT');
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitForText('SECOND_THOUGHT', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('FIRST_THOUGHT');
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitUntil(
      snapshot =>
        !snapshot.text.includes('FIRST_THOUGHT') &&
        !snapshot.text.includes('SECOND_THOUGHT'),
      {timeoutMs: 5000},
    );
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);
