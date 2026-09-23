import {expect, test} from 'bun:test';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Bash history retains output and failures without replaying commands or inventing timings', async () => {
  const host = await launchPi('{"rtk":{"rewrite":false}}');
  try {
    await host.terminal.resize({cols: 100, rows: 50});
    await host.sequence([
      {
        name: 'bash',
        parameters: JSON.stringify({
          command:
            "printf x >> calls; printf 'one\\ntwo\\nthree\\nfour\\nfive\\n'",
          timeout: 7,
        }),
      },
      {
        name: 'bash',
        parameters: JSON.stringify({
          command: 'printf x >> calls; printf failure; exit 17',
        }),
      },
    ]);
    const directory = join(host.directory, 'sessions');
    const name = (await readdir(directory, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!name) throw new Error('Missing session');
    const file = join(directory, name);
    const saved = await readFile(file, 'utf8');
    for (const stage of ['live', 'reload', 'resume']) {
      if (stage === 'reload') await host.reload();
      if (stage === 'resume') {
        await host.command('/host-session new');
        await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
          timeoutMs: 5000,
        });
        await host.command(`/host-session ${file}`);
        await host.terminal.screen.waitForText('Resumed session', {
          timeoutMs: 5000,
        });
      }
      const compact = await host.terminal.screen.text();
      expect(compact).toContain('Bash(');
      expect(compact).toContain('2 more lines');
      expect(compact).toContain('⎿ timeout 7s');
      expect(compact).toContain('Exit code 17');
      if (stage === 'live') expect(compact).toMatch(/Completed · \d+\.\d+s/u);
      else expect(compact).not.toMatch(/· \d+\.\d+s/u);
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitUntil(
        async () => /^\s+five$/mu.test(await host.terminal.screen.text()),
        {timeoutMs: 5000},
      );
      expect(await readFile(join(host.directory, 'calls'), 'utf8')).toBe('xx');
      expect(await readFile(file, 'utf8')).toBe(saved);
      await host.terminal.keyboard.press('Control+O');
    }
  } finally {
    await host.close();
  }
}, 30000);
