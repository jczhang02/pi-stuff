import {expect, test} from 'bun:test';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
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
    expect(await host.terminal.screen.text()).toContain(
      '• Thoughts: FIRST_THOUGHT',
    );
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('FIRST_THOUGHT'),
      {timeoutMs: 5000},
    );
    await host.startResponse('SECOND_ANSWER', 'SECOND_THOUGHT');
    await host.terminal.screen.waitForText('SECOND_ANSWER', {timeoutMs: 5000});
    expect(host.sentAssistant()).toBe('"FIRST_ANSWER"');
    const hidden = await host.terminal.screen.text();
    expect(hidden).toContain('• Thoughts');
    expect(hidden).not.toContain('Thinking...');
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
    await host.reload();
    expect(await host.terminal.screen.text()).toContain('• Thoughts');
    await host.command('/host-session new');
    await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
      timeoutMs: 5000,
    });
    await host.startResponse('AFTER_REPLACEMENT', 'REPLACED_THOUGHT');
    await host.terminal.screen.waitForText('AFTER_REPLACEMENT', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('• Thoughts');
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

test('Assistant gutter survives list-first Markdown, reload and theme changes', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const answer = '- FIRST_ITEM\n- SECOND_ITEM';
  try {
    await host.startResponse(answer);
    await host.terminal.screen.waitForText('SECOND_ITEM', {timeoutMs: 5000});
    for (const change of ['initial', 'reload', 'theme'] as const) {
      if (change === 'reload') await host.reload();
      if (change === 'theme') {
        await host.command('/host-theme catppuccin-latte');
        await host.terminal.screen.waitForText('HOST_THEME:catppuccin-latte', {
          timeoutMs: 5000,
        });
      }
      for (const cols of [60, 80, 120]) {
        await host.terminal.resize({cols, rows: 30});
        const snapshot = await host.terminal.screen.waitUntil(
          snapshot =>
            snapshot.frame.cols === cols &&
            snapshot.text.includes('SECOND_ITEM'),
          {timeoutMs: 5000},
        );
        const rows = snapshot.text.split('\n');
        const first = rows.find(row => row.includes('FIRST_ITEM')) ?? '';
        const second = rows.find(row => row.includes('SECOND_ITEM')) ?? '';
        expect(first).toStartWith('• ');
        expect(second).toStartWith('  ');
        expect(first.indexOf('FIRST_ITEM')).toBe(second.indexOf('SECOND_ITEM'));
      }
    }
    await host.startResponse('AFTER_LIST');
    await host.terminal.screen.waitForText('AFTER_LIST', {timeoutMs: 5000});
    expect(host.sentAssistant()).toBe(JSON.stringify(answer));
  } finally {
    await host.close();
  }
}, 30000);

test('Assistant gutter follows the UI switch across reload and session replacement', async () => {
  const host = await launchPi('{"ui":{"enabled":false}}', undefined, 'ui');
  try {
    for (const [index, enabled] of [false, true, true, false, true].entries()) {
      if (index > 0) {
        await writeFile(
          join(host.agent, 'pi-stuff.json'),
          JSON.stringify({ui: {enabled}}),
        );
        await host.reload();
      }
      await host.command('/host-session new');
      await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
        timeoutMs: 5000,
      });
      const answer = `ANSWER_${index}`;
      await host.startResponse(answer);
      await host.terminal.screen.waitForText(answer, {timeoutMs: 5000});
      const row =
        (await host.terminal.screen.text())
          .split('\n')
          .find(row => row.includes(answer)) ?? '';
      expect(row.trimEnd()).toBe(`${enabled ? '• ' : ' '}${answer}`);
    }
  } finally {
    await host.close();
  }
}, 30000);

test('Thoughts keep independent measured durations and omit them after reload', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const gate = Promise.withResolvers<void>();
  const answerGate = Promise.withResolvers<void>();
  try {
    await host.terminal.resize({cols: 100, rows: 45});
    await host.startResponse(
      'SLOW_ANSWER',
      'SLOW_REASONING',
      gate.promise,
      answerGate.promise,
    );
    await host.terminal.screen.waitForText('SLOW_REASONING', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitForText(/• Thinking · [1-9]\d*s/u, {
      timeoutMs: 5000,
    });
    gate.resolve();
    await host.terminal.screen.waitForText('SLOW_ANSWER', {timeoutMs: 5000});
    await host.terminal.screen.waitForText(/• Thoughts · \d+s/u, {
      timeoutMs: 5000,
    });
    const first =
      (
        await host.terminal.screen.capture({
          allowIncomplete: true,
          deadlineMs: 200,
        })
      ).text.match(/• Thoughts · (\d+)s/u)?.[0] ?? '';
    expect(Number(first.match(/(\d+)s/u)?.[1])).toBeGreaterThanOrEqual(1);
    await Bun.sleep(1200);
    const duringAnswer = await host.terminal.screen.capture({
      allowIncomplete: true,
      deadlineMs: 200,
    });
    expect(duringAnswer.text).toContain(first);
    expect(duringAnswer.text).not.toContain('• Thinking');
    answerGate.resolve();
    await host.startResponse('FAST_ANSWER', 'FAST_REASONING');
    await host.terminal.screen.waitForText('FAST_ANSWER', {timeoutMs: 5000});
    const rows = (await host.terminal.screen.text())
      .split('\n')
      .filter(row => row.includes('• Thoughts ·'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(first);
    expect(rows[1]).toContain('• Thoughts · 0s');
    expect(host.sentAssistant()).toBe('"SLOW_ANSWER"');
    const sessions = join(host.directory, 'sessions');
    const path = (await readdir(sessions, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!path) throw new Error('The completed session was not persisted');
    const session = join(sessions, path);
    const saved = await readFile(session, 'utf8');
    expect(saved).toContain('"thinking":"SLOW_REASONING"');
    expect(saved).toContain('"thinking":"FAST_REASONING"');
    expect(saved).not.toContain('Thoughts');
    await host.reload();
    expect(await readFile(session, 'utf8')).toBe(saved);
    const history = await host.terminal.screen.text();
    expect(history).toContain('• Thoughts');
    expect(history).not.toMatch(/Thoughts · \d+s/u);
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitForText('SLOW_REASONING', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('FAST_REASONING');
    await host.command('/host-session new');
    await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
      timeoutMs: 5000,
    });
    await host.command(`/host-session ${session}`);
    await host.terminal.screen.waitForText('Resumed session', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('SLOW_REASONING');
    expect(await readFile(session, 'utf8')).toBe(saved);
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('SLOW_REASONING'),
      {timeoutMs: 5000},
    );
    expect(await host.terminal.screen.text()).not.toMatch(/Thoughts · \d+s/u);
  } finally {
    gate.resolve();
    answerGate.resolve();
    await host.close();
  }
}, 30000);

test('Cancelling thinking freezes its duration and preserves native interruption', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const gate = Promise.withResolvers<void>();
  try {
    await host.terminal.resize({cols: 100, rows: 45});
    await host.startResponse(
      'UNREACHED_ANSWER',
      'CANCELLED_REASONING',
      gate.promise,
    );
    await host.terminal.screen.waitForText('CANCELLED_REASONING', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Control+T');
    await host.terminal.screen.waitForText(/• Thinking · \d+s/u, {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText(/operation(?: was)? aborted/iu, {
      timeoutMs: 5000,
    });
    gate.resolve();
    const cancelled = await host.terminal.screen.text();
    expect(cancelled).toMatch(/• Thoughts · \d+s/u);
    expect(cancelled).not.toContain('UNREACHED_ANSWER');
    const label = cancelled.match(/• Thoughts · \d+s/u)?.[0] ?? '';
    await host.startResponse('RECOVERED_ANSWER', 'RECOVERED_REASONING');
    await host.terminal.screen.waitForText('RECOVERED_ANSWER', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain(label);
  } finally {
    gate.resolve();
    await host.close();
  }
}, 30000);
