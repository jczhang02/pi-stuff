import {SessionManager} from '@earendil-works/pi-coding-agent';
import type {AssistantMessage} from '@earendil-works/pi-ai';
import {cacheHit} from '../../src/statusline/usage';
import {expect, test} from 'bun:test';
import {getThemeByName} from '../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import {visibleWidth} from '@earendil-works/pi-tui';
import {Effect} from 'effect';
import {
  renderFooter,
  statusText,
  type FooterView,
} from '../../src/statusline/footer';
import {readConfiguration} from '../../src/pi/configuration';

const base: FooterView = {
  directory: '~/dev/pi-stuff',
  model: 'gpt-6-astra',
  thinking: 'medium',
  usage: {tokens: 84320, contextWindow: 272000, percent: 31},
  capacity: 272000,
  compaction: {enabled: true, reserveTokens: 32000},
  hit: 83.8,
  git: {
    kind: 'ready',
    snapshot: {
      branch: 'main',
      staged: 1,
      modified: 2,
      untracked: 3,
      conflicts: 1,
      ahead: 2,
      behind: 1,
      operation: 'rebase',
    },
  },
  branch: 'main',
  statuses: new Map([
    ['z', 'LAST'],
    ['a', 'FIRST'],
  ]),
};

for (const name of ['dark', 'light']) {
  const theme = getThemeByName(name);
  if (!theme) throw new Error(`Missing built-in theme ${name}`);
  test(`${name}: two rows retain directory/Git and hide whole optional fields`, () => {
    const wide = renderFooter(150, theme, base).map(Bun.stripANSI);
    expect(wide[0]).toContain(
      '~/dev/pi-stuff · ctx 31%/272k ━━━━━━━━━━ · hit 83.8%',
    );
    expect(wide[0]).toContain('main · rebase · !1 · +1 · ~2 · ?3 · ↑2 · ↓1');
    expect(wide[1]).toMatch(/^gpt-6-astra · medium\s+FIRST · LAST$/);
    for (const width of [100, 80, 50]) {
      const lines = renderFooter(width, theme, base).map(Bun.stripANSI);
      expect(lines).toHaveLength(2);
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
      expect(lines.join('\n')).toContain('~/dev/pi-stuff');
      for (const field of [
        'main',
        'rebase',
        '!1',
        '+1',
        '~2',
        '?3',
        '↑2',
        '↓1',
      ])
        expect(lines.join('\n')).toContain(field);
      expect(lines.join('\n')).not.toContain('…');
    }
  });
  test(`${name}: compaction thresholds, disabled settings and unknown usage`, () => {
    for (const [used, color] of [
      [215999, 'accent'],
      [216000, 'warning'],
      [239999, 'warning'],
      [240000, 'error'],
    ] as const) {
      const lines = renderFooter(200, theme, {
        ...base,
        usage: {tokens: used, contextWindow: 272000, percent: used / 2720},
      });
      expect(lines[0]).toContain(
        theme.fg(color, `${Math.round(used / 2720)}%`),
      );
      expect(lines[0]).toContain(
        theme.fg(color, '━'.repeat(Math.round(used / 27200))),
      );
    }
    for (const [used, color] of [
      [217599, 'accent'],
      [217600, 'warning'],
      [244800, 'error'],
    ] as const) {
      expect(
        renderFooter(200, theme, {
          ...base,
          compaction: {enabled: false, reserveTokens: 32000},
          usage: {tokens: used, contextWindow: 272000, percent: used / 2720},
        })[0],
      ).toContain(theme.fg(color, `${Math.round(used / 2720)}%`));
    }
    const unknown =
      renderFooter(200, theme, {
        ...base,
        usage: {tokens: null, contextWindow: 272000, percent: null},
        hit: undefined,
      })[0] ?? '';
    expect(Bun.stripANSI(unknown)).toContain('ctx ?/272k');
    expect(unknown).not.toContain('━');
    expect(unknown).not.toContain('hit');
    expect(
      renderFooter(200, theme, {...base, compaction: undefined})[0],
    ).toContain(theme.fg('text', '31%'));
    expect(
      renderFooter(200, theme, {
        ...base,
        compaction: {enabled: true, reserveTokens: 272000},
      })[0],
    ).toContain(theme.fg('error', '31%'));
  });
}

test('status strings retain SGR and case without terminal commands or extra rows', () => {
  expect(
    statusText('\x1b[31mUPPER\x1b[0m\nnext\tpart\x1b[2J\x1b]0;title\x07'),
  ).toBe('\x1b[31mUPPER\x1b[0m next part');
  expect(statusText('a\x1bPpayload\x1b\\b\x1bc')).toBe('ab');
});

test('statusline configuration accepts only enabled boolean', async () => {
  expect(
    await Effect.runPromise(
      readConfiguration(Effect.succeed('{"statusline":{"enabled":false}}')),
    ),
  ).toEqual({statusline: {enabled: false}});
  for (const settings of ['{"enabled":"false"}', '{"color":"red"}']) {
    const error = await Effect.runPromise(
      Effect.flip(
        readConfiguration(Effect.succeed(`{"statusline":${settings}}`)),
      ),
    );
    expect(error.message).toContain('Correct it and /reload');
  }
});

test('cache hit follows the selected native branch and ignores failed responses', () => {
  const session = SessionManager.inMemory();
  function response(
    input: number,
    cacheRead: number,
    cacheWrite = 0,
    stopReason: AssistantMessage['stopReason'] = 'stop',
  ) {
    return session.appendMessage({
      role: 'assistant',
      api: 'openai-completions',
      provider: 'fixture',
      model: 'fixture',
      content: [{type: 'text', text: 'Done'}],
      usage: {
        input,
        output: 10,
        cacheRead,
        cacheWrite,
        totalTokens: input + cacheRead + cacheWrite + 10,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
      },
      stopReason,
      timestamp: 1,
    });
  }
  expect(cacheHit(session.getBranch())).toBeUndefined();
  const first = response(1620, 8380);
  expect(cacheHit(session.getBranch())).toBe(83.8);
  response(100, 0, 0, 'error');
  response(100, 0, 0, 'aborted');
  expect(cacheHit(session.getBranch())).toBe(83.8);
  response(100, 300, 100, 'toolUse');
  expect(cacheHit(session.getBranch())).toBe(60);
  response(100, 0);
  expect(cacheHit(session.getBranch())).toBe(0);
  session.branch(first);
  expect(cacheHit(session.getBranch())).toBe(83.8);
});
