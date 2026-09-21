import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('FleetView follows the footer and detail preserves the main draft', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      return {
        type: 'content',
        content:
          'Cancellation retains the previous report and stops active tools.',
      };
    },
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {agent: 'lifecycle', task: 'Trace cancellation behavior'},
          {agent: 'packages', task: 'Compare existing packages'},
        ],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    const initial = await host.terminal.screen.text();
    expect(initial).toContain('○ main');
    const mainLine = initial
      .split('\n')
      .findIndex(line => line.startsWith('○ main'));
    expect(mainLine).toBeGreaterThan(
      initial.split('\n').findIndex(line => line.startsWith(host.directory)),
    );
    expect(initial).not.toContain('esc back');
    await host.terminal.keyboard.type('Keep this draft');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('esc back', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('● main');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● lifecycle', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('● lifecycle');
    expect((await host.terminal.screen.frame()).cursor).toBeNull();
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    const detail = await host.terminal.screen.text();
    expect(detail).toContain('RTK_TURN_1_DONE');
    expect(detail).toContain('Cancellation retains the previous report');
    expect(detail).toContain('▸ Prompt');
    expect(detail).not.toContain('Keep this draft');
    expect(detail).not.toContain('○ main');
    await host.terminal.resize({cols: 35, rows: 24});
    await host.terminal.screen.waitForText('Resize terminal.', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('esc back');
    await host.terminal.resize({cols: 100, rows: 30});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● lifecycle', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('● lifecycle');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
    const returned = await host.terminal.screen.text();
    expect(returned).toContain('Keep this draft');
    expect(returned).not.toContain('esc back');
    await host.terminal.keyboard.press('Control+C');
    await host.reload();
    await host.terminal.keyboard.press('ArrowUp');
    await host.terminal.screen.waitUntil(
      snapshot =>
        snapshot.text
          .split('\n')
          .filter(line => line.trim() === 'Run RTK turn 1').length > 1 &&
        !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
    const history = await host.terminal.screen.text();
    expect(history).not.toContain('● main');
    expect(
      history.split('\n').filter(line => line.trim() === 'Run RTK turn 1')
        .length,
    ).toBeGreaterThan(1);
  } finally {
    await host.close();
  }
}, 60000);

test('detail keeps the paragraph being read when Markdown reflows', async () => {
  const report = Array.from(
    {length: 35},
    (_, index) =>
      `PARA_${String(index).padStart(2, '0')} Read the cancellation boundary and preserve the previous task report for later review.`,
  ).join('\n\n');
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request =>
      request.tools?.some(tool => tool.function.name === 'subagent')
        ? undefined
        : {type: 'content', content: report},
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [{agent: 'reviewer', task: 'Inspect cancellation'}],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● reviewer', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('f latest', {timeoutMs: 5000});
    const before = await host.terminal.screen.text();
    const paragraph = before.match(/PARA_\d+/)?.[0];
    expect(paragraph).toBeDefined();
    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.screen.waitUntil(
      snapshot => snapshot.frame.cols === 80 && snapshot.text !== before,
      {
        timeoutMs: 5000,
      },
    );
    const after = await host.terminal.screen.text();
    expect(after.match(/PARA_\d+/)?.[0]).toBe(paragraph);
    await host.terminal.resize({cols: 120, rows: 36});
    await host.terminal.screen.waitUntil(
      snapshot => snapshot.frame.cols === 120 && snapshot.text !== after,
      {
        timeoutMs: 5000,
      },
    );
    expect((await host.terminal.screen.text()).match(/PARA_\d+/)?.[0]).toBe(
      paragraph,
    );
  } finally {
    await host.close();
  }
}, 60000);

test('a wrapped quotation retains its content anchor across repeated resizing', async () => {
  const report = Array.from(
    {length: 35},
    (_, index) =>
      `> PARA_${String(index).padStart(2, '0')} Read the cancellation boundary and preserve the previous task report for later review.`,
  ).join('\n>\n');
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request =>
      request.tools?.some(tool => tool.function.name === 'subagent')
        ? undefined
        : {type: 'content', content: report},
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [{agent: 'reviewer', task: 'Inspect cancellation'}],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● reviewer', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('f latest', {timeoutMs: 5000});
    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.screen.waitForText('/ 106', {timeoutMs: 5000});
    const narrow = await host.terminal.screen.text();
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitUntil(snapshot => snapshot.text !== narrow, {
      timeoutMs: 5000,
    });
    const before = await host.terminal.screen.text();
    const paragraph = before.match(/PARA_\d+/)?.[0];
    expect(paragraph).toBeDefined();
    await host.terminal.resize({cols: 120, rows: 36});
    await host.terminal.screen.waitForText('/ 71', {timeoutMs: 5000});
    const after = await host.terminal.screen.text();
    expect(after.match(/PARA_\d+/)?.[0]).toBe(paragraph);
  } finally {
    await host.close();
  }
}, 60000);

test('table cell wrapping keeps the selected reading row', async () => {
  const report = [
    '| Finding | Evidence |',
    '| --- | --- |',
    ...Array.from(
      {length: 35},
      (_, index) =>
        `| ROW_${String(index).padStart(2, '0')} Capture cancellation context safely | Keep the report and pending instructions |`,
    ),
  ].join('\n');
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request =>
      request.tools?.some(tool => tool.function.name === 'subagent')
        ? undefined
        : {type: 'content', content: report},
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [{agent: 'reviewer', task: 'Inspect cancellation'}],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● reviewer', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type(']');
    await host.terminal.screen.waitForText('f latest', {timeoutMs: 5000});
    const before = await host.terminal.screen.text();
    const row = before.match(/ROW_\d+/)?.[0];
    expect(row).toBeDefined();
    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.screen.waitForText('/ 110', {timeoutMs: 5000});
    expect((await host.terminal.screen.text()).match(/ROW_\d+/)?.[0]).toBe(row);
    await host.terminal.resize({cols: 120, rows: 36});
    await host.terminal.screen.waitForText('/ 75', {timeoutMs: 5000});
    expect((await host.terminal.screen.text()).match(/ROW_\d+/)?.[0]).toBe(row);
  } finally {
    await host.close();
  }
}, 60000);
