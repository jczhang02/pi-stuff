// Actual Terminal Control captures and bounded interaction checks, not painted mockups.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {TerminalControl, type Session} from '@kitlangton/terminal-control';
import {
  sandbox,
  terminalBinary,
  font,
  root,
  runEffect,
  type Palette,
} from './launch';
import {scenes} from './fixtures';
import {captureLive} from './capture-live';
const args = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    theme: {type: 'string', default: 'catppuccin-latte'},
    cols: {type: 'string', default: '120'},
    out: {type: 'string'},
    interact: {type: 'boolean', default: false},
    cancel: {type: 'boolean', default: false},
  },
});
const theme = args.values.theme;
if (theme !== 'catppuccin-latte' && theme !== 'catppuccin-mocha')
  throw new Error('Unknown theme');
const cols = Number(args.values.cols);
if (!Number.isInteger(cols) || cols < 40 || cols > 200)
  throw new Error('Columns must be 40..200');
const scene = scenes.find(
  s => s.name === (args.positionals[0] ?? 'investigate'),
);
if (!scene) throw new Error('Unknown scene');
const rows = 40;
const out = args.values.out ?? join(import.meta.dir, 'captures');
const wait = {timeoutMs: 15000};
const draft = '保留这段草稿';
async function click(session: Session, label: string): Promise<void> {
  const text = await session.screen.text();
  const lines = text.split('\n');
  const y = lines.findIndex(line => line.includes(label));
  const line = lines[y];
  if (y < 0 || !line) throw new Error(`Cannot click hidden ${label}`);
  await session.mouse({
    action: 'click',
    x: Math.max(
      1,
      line.indexOf(label) + label.length - label.trimStart().length,
    ),
    y,
    button: 'left',
  });
}
async function save(
  session: Session,
  label: string,
  expected: readonly string[],
  palette: {text: string; base: string},
  selectedTheme: Palette,
): Promise<void> {
  const screen = await session.screen.capture({
    settleMs: scene?.name.startsWith('live') ? 80 : 200,
    deadlineMs: 1500,
    includeAnsi: true,
  });
  for (const token of expected)
    if (!screen.text.includes(token))
      throw new Error(`${label}: missing ${token}`);
  if (!screen.ansi) throw new Error('No ANSI evidence');
  const hex = (c: {r: number; g: number; b: number}) =>
    '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  if (
    hex(screen.frame.background) !== palette.base ||
    hex(screen.frame.foreground) !== palette.text
  )
    throw new Error('Palette mismatch');
  for (const cell of screen.frame.cells)
    if (cell.x + cell.width > screen.frame.cols)
      throw new Error('Clipped cell');
  const stem = join(
    out,
    `${scene?.name}-${selectedTheme}-${screen.frame.cols}-${label}`,
  );
  await writeFile(stem + '.txt', screen.text);
  await writeFile(stem + '.ansi', screen.ansi);
  const child = Bun.spawn(
    [
      terminalBinary,
      'save',
      '--input',
      stem + '.ansi',
      '--format',
      'png',
      '--out',
      stem + '.png',
      '--font-family',
      font,
      '--cols',
      String(screen.frame.cols),
      '--rows',
      String(rows),
      '--cell-width',
      '9',
      '--cell-height',
      '18',
      '--padding',
      '18',
      '--pixel-ratio',
      '2',
      '--hide-cursor',
    ],
    {cwd: root, stdout: 'pipe', stderr: 'pipe'},
  );
  if ((await child.exited) !== 0)
    throw new Error(await new Response(child.stderr).text());
  console.log(stem + '.png');
}
await runEffect(async () => {
  await mkdir(out, {recursive: true});
  const host = await sandbox(
    scene.name,
    theme,
    'capture',
    scene.name !== 'thoughts-visible',
  );
  let terminal: TerminalControl | undefined;
  let session: Session | undefined;
  try {
    terminal = await TerminalControl.make({
      binaryPath: terminalBinary,
      env: {
        DISPLAY: undefined,
        WAYLAND_DISPLAY: undefined,
        DBUS_SESSION_BUS_ADDRESS: undefined,
      },
    });
    session = await terminal.launch({
      command: host.command,
      cwd: host.directory,
      inheritEnv: false,
      env: host.env,
      host: 'opentui',
      viewport: {cols, rows},
    });
    if (scene.name === 'live' || scene.name === 'live-error') {
      await captureLive(
        session,
        scene.name === 'live-error',
        args.values.cancel,
        (label, expected) =>
          save(session!, label, expected, host.palette, theme),
      );
    } else if (scene.name === 'replay') {
      await session.screen.waitForText('Thinking', wait);
      await session.keyboard.type(draft);
      await save(session, 'thinking', ['Thinking', draft], host.palette, theme);
      await session.screen.waitForText('Checking pagination boundaries', wait);
      await save(
        session,
        'running',
        ['Running', 'Checking pagination', draft],
        host.palette,
        theme,
      );
      if (args.values.cancel) {
        await session.keyboard.press('Escape');
        await session.screen.waitForText('Operation aborted', wait);
        await Bun.sleep(4500);
        if ((await session.screen.text()).includes('8 tests passed'))
          throw new Error('Cancelled replay resumed');
        await save(
          session,
          'cancelled',
          ['Cancelled', 'Operation aborted', draft],
          host.palette,
          theme,
        );
      } else {
        await session.screen.waitForText('8 tests passed', wait);
        await save(
          session,
          'completed',
          ['Thoughts · 4s', 'Exit 0', draft],
          host.palette,
          theme,
        );
        if ((await session.screen.text()).includes('Checking pagination'))
          throw new Error('Completed output did not collapse');
      }
    } else {
      const token = scene.tokens[0];
      await session.screen.waitForText(token, wait);
      await save(session, 'main', scene.tokens, host.palette, theme);
      if (args.values.interact) {
        await session.keyboard.type(draft);
        if (scene.name === 'investigate') {
          await click(session, 'Read 2 files');
          await session.screen.waitForText('Read 4 lines', wait);
          await save(
            session,
            'group-open',
            ['Read 4 lines', 'Found 3 matches', draft],
            host.palette,
            theme,
          );
          await click(session, 'Read(src/search/paginate.ts)');
          await session.screen.waitForText('return {items: page.items', wait);
          await save(
            session,
            'read-open',
            ['return {items: page.items', draft],
            host.palette,
            theme,
          );
          await click(session, 'Read 2 files');
          await session.screen.waitUntil(
            s => !s.text.includes('Read 4 lines'),
            wait,
          );
          await save(
            session,
            'group-closed',
            ['Read 2 files', draft],
            host.palette,
            theme,
          );
        } else if (scene.name === 'folding') {
          await click(session, 'Read 1 file');
          await session.screen.waitForText('Read 4 lines', wait);
          const lines = (await session.screen.text()).split('\n');
          const read = lines.find(line =>
            line.includes('Read(src/search/paginate.ts)'),
          );
          const failure = lines.find(line =>
            line.includes('Read(src/search/cursor.ts)'),
          );
          if (!read || !failure || read.indexOf('•') !== failure.indexOf('•'))
            throw new Error('Expanded group member is misaligned');
          await save(
            session,
            'group-open',
            ['Read 4 lines', 'File not found', draft],
            host.palette,
            theme,
          );
          await click(session, 'Thoughts · 4s');
          await session.screen.waitForText('Thoughts:', wait);
          await save(
            session,
            'thought-open',
            ['Thoughts:', 'previousIds', draft],
            host.palette,
            theme,
          );
        } else if (
          scene.name === 'thoughts' ||
          scene.name === 'thoughts-visible'
        ) {
          const hidden = scene.name === 'thoughts';
          await click(session, hidden ? 'Thoughts · 4s' : 'Thoughts:');
          await session.screen.waitForText(
            hidden ? 'Thoughts:' : 'Thoughts · 4s',
            wait,
          );
          await save(
            session,
            'open',
            [hidden ? 'Thoughts:' : 'Thoughts · 4s', draft],
            host.palette,
            theme,
          );
          await session.keyboard.press('Control+T');
          await session.screen.waitForText(
            hidden ? 'Thinking blocks: visible' : 'Thinking blocks: hidden',
            wait,
          );
          await session.screen.waitForText(
            hidden ? 'Thoughts:' : 'Thoughts · 4s',
            wait,
          );
          await save(
            session,
            'setting-toggled',
            [hidden ? 'Thoughts:' : 'Thoughts · 4s', draft],
            host.palette,
            theme,
          );
          await session.keyboard.press('Control+T');
          await session.screen.waitForText(
            hidden ? 'Thoughts · 4s' : 'Thoughts:',
            wait,
          );
        } else if (scene.name === 'web') {
          await click(session, 'Searched web');
          await session.screen.waitForText('WebFetch(', wait);
          await save(
            session,
            'group-open',
            ['WebSearch(', 'WebFetch(', 'WebRead(', draft],
            host.palette,
            theme,
          );
          await click(session, 'WebFetch');
          await session.screen.waitForText('contentId=page-01', wait);
          await save(
            session,
            'fetch-open',
            ['fetch_content', 'contentId=page-01', draft],
            host.palette,
            theme,
          );
          await click(session, 'WebFetch');
          await session.screen.waitUntil(
            s => !s.text.includes('contentId=page-01'),
            wait,
          );
        } else if (scene.name === 'failures') {
          await click(session, 'WebFetch');
          await session.screen.waitForText(
            'No page content was retrieved',
            wait,
          );
          const failureText = await session.screen.text();
          if (
            failureText.includes('contentId=page-01') ||
            failureText.includes('nextOffset')
          )
            throw new Error('Failed fetch retained success metadata');
          await save(
            session,
            'fetch-failed-open',
            ['old-pagination', 'HTTP 404', draft],
            host.palette,
            theme,
          );
          await click(session, 'WebFetch');
          await session.screen.waitUntil(
            s => !s.text.includes('No page content was retrieved'),
            wait,
          );
        } else if (scene.name === 'changes') {
          await click(session, 'Write(');
          await session.screen.waitForText('toEqual', wait);
          await save(
            session,
            'write-open',
            ['toEqual', draft],
            host.palette,
            theme,
          );
          await click(session, 'Write(');
          await session.screen.waitUntil(
            s => !s.text.includes('toEqual'),
            wait,
          );
        }
        await session.keyboard.press('Control+O');
        await session.screen.waitForText('Tool output: expanded', wait);
        const expandedToken =
          scene.name === 'failures'
            ? 'Received:'
            : scene.name === 'thoughts'
              ? 'Thoughts · 4s'
              : scene.name === 'thoughts-visible'
                ? 'Thoughts:'
                : scene.name === 'web'
                  ? 'offset=228'
                  : scene.name === 'changes' || scene.name === 'folding'
                    ? 'Ran 8 tests across 2 files.'
                    : scene.name === 'empty'
                      ? 'image/png'
                      : scene.name === 'long-diff'
                        ? 'including empty filtered pages'
                        : 'previousIds';
        await session.screen.waitForText(expandedToken, wait);
        await save(
          session,
          'keyboard-open',
          [expandedToken, draft],
          host.palette,
          theme,
        );
        await session.keyboard.press('Control+O');
        await session.screen.waitForText('Tool output: collapsed', wait);
        await session.screen.waitForIdle({timeoutMs: 15000, quietForMs: 200});
        const text = await session.screen.text();
        if (!text.split('\n').slice(-8).join('\n').includes(draft))
          throw new Error('Draft lost');
        await save(session, 'restored', [draft], host.palette, theme);
      }
      if (scene.name === 'response-error' || scene.name === 'interrupted') {
        const text = await session.screen.text();
        if (text.includes('⎿') || text.includes('Assistant response'))
          throw new Error('Assistant status uses tool chrome');
      }
    }
  } catch (error) {
    if (session)
      await writeFile(
        join(out, `${scene.name}-failure.txt`),
        await session.screen.text(),
      );
    throw error;
  } finally {
    try {
      await session?.stop();
    } finally {
      try {
        await terminal?.close();
      } finally {
        await host.cleanup();
      }
    }
  }
});
