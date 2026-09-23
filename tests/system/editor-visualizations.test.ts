import {expect, test} from 'bun:test';
import {resolve, join} from 'node:path';
import {mkdtemp, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import type {ModelRequest} from './fixtures/pi-terminal';
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
    await host.terminal.screen.waitUntil(
      async () =>
        (await readFile(join(host.agent, 'pi-stuff.json'), 'utf8')).includes(
          '"enabled": false',
        ),
      {timeoutMs: 5000},
    );
    await host.reload();
    await host.terminal.keyboard.type('/skill:review ');
    await host.terminal.screen.waitForText('/skill:review', {timeoutMs: 3000});
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
    // Exceed the worker's request deadline before replacing the failing draft.
    await Bun.sleep(350);
    await host.terminal.keyboard.press('Control+C');
    await host.terminal.keyboard.type('aaaa');
    await host.terminal.screen.waitUntil(
      shot =>
        shot.frame.cells.some(
          cell =>
            cell.text === 'a' &&
            cell.attributes.bold &&
            cell.foreground.r === 63 &&
            cell.foreground.g === 81 &&
            cell.foreground.b === 177,
        ),
      {timeoutMs: 5000},
    );
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

for (const theme of ['dark', 'light']) {
  test(`native skill command preserves one canonical message and ${theme} transcript colors`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-editor-skill-'));
    const skillFile = join(directory, 'SKILL.md');
    await writeFile(
      skillFile,
      '---\nname: review\ndescription: Inspect code.\n---\nInspect every change carefully.',
    );
    const requests: ModelRequest[] = [];
    const host = await launchPi(
      JSON.stringify({editor: {keywords: [{pattern: 'review'}]}}),
      undefined,
      'rtk',
      'fullscreen',
      body => {
        requests.push(body);
        return undefined;
      },
      ['--skill', skillFile, '--use-theme', theme],
    );
    try {
      await host.command('/skill:review Check this file.');
      await host.terminal.screen.waitForText('RTK_TURN_0_DONE', {
        timeoutMs: 5000,
      });
      expect(await host.terminal.screen.text()).toContain(
        '/skill:review Check this file.',
      );
      const users =
        requests[0]?.messages.filter(message => message.role === 'user') ?? [];
      expect(users).toHaveLength(1);
      expect(JSON.stringify(users[0]?.content)).toContain('<skill name=');
      expect(JSON.stringify(users[0]?.content)).toContain(
        'Inspect every change carefully.',
      );
      const frame = await host.terminal.screen.frame();
      expect(
        frame.cells.filter(
          cell =>
            cell.foreground.r === 63 &&
            cell.foreground.g === 81 &&
            cell.foreground.b === 177 &&
            cell.attributes.bold,
        ),
      ).toHaveLength(0);
      const files = (
        await readdir(join(host.directory, 'sessions'), {recursive: true})
      ).filter(file => file.endsWith('.jsonl'));
      const file = join(host.directory, 'sessions', files[0] ?? '');
      const stored = await readFile(file, 'utf8');
      await host.reload();
      expect(await readFile(file, 'utf8')).toBe(stored);
      await host.restart(['--session', file]);
      await host.terminal.screen.waitForText('/skill:review Check this file.', {
        timeoutMs: 5000,
      });
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText(
        'Inspect every change carefully.',
        {timeoutMs: 5000},
      );
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.keyboard.type('Review /skill:review');
      await host.terminal.screen.waitUntil(
        async () =>
          (await host.terminal.screen.frame()).cells.filter(
            cell =>
              cell.attributes.bold &&
              cell.foreground.r === 63 &&
              cell.foreground.g === 81 &&
              cell.foreground.b === 177,
          ).length >= 4,
        {timeoutMs: 5000},
      );
      if (process.env.PI_EDITOR_EVIDENCE) {
        const capture = await host.terminal.screen.capture({
          includeAnsi: true,
          settleMs: 100,
          deadlineMs: 2000,
        });
        if (capture.ansi)
          await writeFile(
            join(process.env.PI_EDITOR_EVIDENCE, `editor-${theme}.ansi`),
            capture.ansi,
          );
      }
    } finally {
      await host.close();
      await rm(directory, {recursive: true, force: true});
    }
  }, 30000);
}

test('assistant visualizations retain model source and fit a narrow terminal', async () => {
  const source =
    'Module layout\n\n```tree\nproject\n  src\n    editor\n    visualizations\n  tests\n```\n\nWeekly counts\n\n```chart\ntype: sparkline\n2 4 3 8 5 9\n```';
  let finish = () => {};
  const host = await launchPi('{}', undefined, 'rtk', 'fullscreen', () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (content: string, finishReason: string | null) =>
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: 'visualizations',
                object: 'chat.completion.chunk',
                choices: [
                  {index: 0, delta: {content}, finish_reason: finishReason},
                ],
              })}\n\n`,
            ),
          );
        send(source.slice(0, -3), null);
        finish = () => {
          send('```', 'stop');
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        };
      },
    });
    return new Response(stream, {
      headers: {'content-type': 'text/event-stream'},
    });
  });
  try {
    await host.terminal.keyboard.type(
      'Show the module layout and weekly counts.',
    );
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('type: sparkline', {
      timeoutMs: 5000,
    });
    finish();
    await host.terminal.screen.waitForText('▁', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('└── tests', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).not.toContain('type: sparkline');
    expect(await host.terminal.screen.text()).toContain('Weekly counts');
    expect(await host.terminal.screen.text()).not.toContain(
      'pi-stuff-visualization',
    );
    const files = (
      await readdir(join(host.directory, 'sessions'), {recursive: true})
    ).filter(file => file.endsWith('.jsonl'));
    const file = join(host.directory, 'sessions', files[0] ?? '');
    await host.terminal.screen.waitUntil(
      async () =>
        (await readFile(file, 'utf8')).includes(JSON.stringify(source)),
      {timeoutMs: 5000},
    );
    const stored = await readFile(file, 'utf8');
    await host.reload();
    expect(await readFile(file, 'utf8')).toBe(stored);
    await host.terminal.resize({cols: 60, rows: 30});
    await host.terminal.screen.waitForText('└── tests', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toMatch(/[▁▂▃▄▅▆▇█]/u);
    expect(await host.terminal.screen.text()).not.toContain('type: sparkline');
    expect(await host.terminal.screen.text()).toContain('Weekly counts');
    if (process.env.PI_EDITOR_EVIDENCE) {
      const capture = await host.terminal.screen.capture({
        includeAnsi: true,
        settleMs: 100,
        deadlineMs: 2000,
      });
      if (capture.ansi)
        await writeFile(
          join(process.env.PI_EDITOR_EVIDENCE, 'visualizations.ansi'),
          capture.ansi,
        );
    }
  } finally {
    await host.close();
  }
}, 30000);
