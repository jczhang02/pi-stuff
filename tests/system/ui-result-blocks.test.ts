import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Wrapped Read, Edit and Write errors stay aligned with their result block', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 60, rows: 42});
    await writeFile(
      join(host.directory, 'occupied'),
      'a file, not a directory',
    );
    const path = 'long-path-for-a-native-tool-error/不存在的目录/source.ts';
    for (const [tool, args] of [
      ['read', {path}],
      ['edit', {path, edits: [{oldText: 'before', newText: 'after'}]}],
      ['write', {path: `occupied/${path}`, content: 'source'}],
    ] as const) {
      const result = await host.invoke(tool, JSON.stringify(args));
      expect(result).toMatch(/ENOENT|ENOTDIR/u);
      const rows = (await host.terminal.screen.text()).split('\n');
      const first = rows.findLastIndex(row => row.includes('⎿'));
      expect(first).toBeGreaterThan(-1);
      const end = rows.findIndex(
        (row, index) => index > first && row.trim() === '',
      );
      const body = rows.slice(first, end);
      expect(body.length).toBeGreaterThan(1);
      expect(body[0]).toStartWith('  ⎿  ');
      for (const continuation of body.slice(1))
        expect(continuation).toStartWith('     ');
    }
  } finally {
    await host.close();
  }
}, 30000);

test('Wrapped Web batch warnings keep their own connector and aligned continuation', async () => {
  const host = await launchPi('{}', undefined, 'web');
  try {
    await host.terminal.resize({cols: 60, rows: 36});
    await writeFile(
      join(host.agent, 'auth.json'),
      JSON.stringify({exa: {type: 'api_key', key: 'invalid\nfixture'}}),
    );
    const result = await host.invoke(
      'web_search',
      JSON.stringify({queries: ['offline authentication failure']}),
    );
    expect(result).toContain('error: authentication:');
    const rows = (await host.terminal.screen.text()).split('\n');
    const first = rows.findIndex(row =>
      row.includes('⎿  error: authentication:'),
    );
    expect(first).toBeGreaterThan(-1);
    expect(rows[first + 1]?.trim()).not.toBe('');
    expect(rows[first + 1]).toStartWith('     ');
  } finally {
    await host.close();
  }
}, 30000);
