import {expect, test} from 'bun:test';
import {resolve} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('skill and prompt render in one native-colored card, expand and survive reload', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/editor-visualizations.ts'),
  );
  try {
    await host.command('/fixture-skill');
    await host.terminal.screen.waitForText('Check the fixture.', {
      timeoutMs: 5000,
    });
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('/skill:review Check the fixture.');
    expect(screen).not.toContain('[skill]');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('Inspect every change carefully.', {
      timeoutMs: 5000,
    });
    await host.reload();
    expect(await host.terminal.screen.text()).toContain(
      '/skill:review Check the fixture.',
    );
  } finally {
    await host.close();
  }
}, 30000);

test('editor colors regex matches and full skills, preserves typing, and toggle persists', async () => {
  const host = await launchPi(
    JSON.stringify({
      editor: {
        keywords: [
          {pattern: 'review'},
          {pattern: 'FIX', caseSensitive: true},
          {pattern: '['},
        ],
      },
    }),
  );
  try {
    await host.terminal.screen.waitForText('Invalid editor keyword regex', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type(
      'plain Review preview /skill:review fix FIX',
    );
    await host.terminal.screen.waitUntil(
      async () => {
        const frame = await host.terminal.screen.frame();
        return (
          frame.cells.filter(
            cell =>
              cell.attributes.bold &&
              cell.foreground.r === 63 &&
              cell.foreground.g === 81 &&
              cell.foreground.b === 177,
          ).length >= 8
        );
      },
      {timeoutMs: 5000},
    );
    expect(await host.terminal.screen.text()).toContain(
      'plain Review preview /skill:review fix FIX',
    );
    await host.terminal.keyboard.press('Control+A');
    await host.terminal.keyboard.press('ArrowRight');
    await host.terminal.keyboard.type('X');
    await host.terminal.screen.waitForText(
      'pXlain Review preview /skill:review fix FIX',
      {timeoutMs: 3000},
    );
    await host.terminal.keyboard.press('Control+C');
    await host.command('/editor');
    await host.terminal.screen.waitForText('Skill and keyword colors', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('disabled', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.keyboard.type('/skill:review ');
    const disabled = await host.terminal.screen.frame();
    expect(
      disabled.cells.filter(
        cell =>
          cell.foreground.r === 63 &&
          cell.foreground.g === 81 &&
          cell.foreground.b === 177,
      ),
    ).toHaveLength(0);
  } catch (error) {
    console.error(await host.terminal.logs.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

test('user tree and chart display project while source survives reload', async () => {
  const host = await launchPi();
  try {
    await host.terminal.keyboard.type('```tree\nproject\n  src\n  tests\n```');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('├── src', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('└── tests');
    expect(await host.terminal.screen.text()).not.toContain(
      'pi-stuff-visualization',
    );
    await host.reload();
    expect(await host.terminal.screen.text()).toContain('├── src');
  } finally {
    await host.close();
  }
}, 30000);

test('a pathological keyword regex cannot block editor input or a new session', async () => {
  const host = await launchPi(
    JSON.stringify({editor: {keywords: [{pattern: '(a+)+$'}]}}),
  );
  try {
    await host.terminal.keyboard.type('a'.repeat(80) + '!');
    await host.terminal.keyboard.type(' STILL_RESPONSIVE');
    await host.terminal.screen.waitForText('STILL_RESPONSIVE', {
      timeoutMs: 2000,
    });
    await host.terminal.keyboard.press('Control+C');
    await host.command('/new');
    await host.terminal.screen.waitForText('fixture', {timeoutMs: 5000});
    await host.terminal.keyboard.type('new /skill:review ');
    await host.terminal.screen.waitForText('new /skill:review', {
      timeoutMs: 3000,
    });
    const frame = await host.terminal.screen.frame();
    expect(
      frame.cells.some(
        cell =>
          cell.text === '/' && cell.attributes.bold && cell.foreground.r === 63,
      ),
    ).toBe(true);
  } finally {
    await host.close();
  }
}, 20000);
