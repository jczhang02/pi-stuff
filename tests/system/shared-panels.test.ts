import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

for (const theme of ['light', 'dark']) {
  test.each([56, 100])(
    `RTK and AutoName share navigation and layout in ${theme} at %s columns`,
    async cols => {
      const host = await launchPi(JSON.stringify({naming: {automatic: false}}));
      try {
        await writeFile(
          join(host.agent, 'settings.json'),
          JSON.stringify({theme}),
        );
        await host.restart([]);
        await host.terminal.resize({cols, rows: 30});
        const homes: string[][] = [];
        const settings: string[][] = [];
        for (const [command, title, description] of [
          ['/rtk', 'RTK', 'Configure RTK and inspect usage.'],
          [
            '/autoname panel',
            'AutoName',
            'Configure automatic naming and name this session.',
          ],
        ]) {
          await host.command(command!);
          await host.terminal.screen.waitForText(description!, {
            timeoutMs: 4000,
          });
          const screen = (await host.terminal.screen.text()).split('\n');
          const heading = screen.findIndex(line => line.startsWith(title!));
          expect(screen[heading - 1]).toMatch(/^─+$/u);
          expect(screen[heading + 1]).toBe('');
          expect(screen[heading + 2]).toBe(description!);
          homes.push(screen);
          expect(screen.find(line => line.includes('Settings'))).toMatch(
            /^→ Settings/u,
          );
          await host.terminal.keyboard.press('Enter');
          await host.terminal.screen.waitForText(`${title} / Settings`, {
            timeoutMs: 4000,
          });
          const rows = (await host.terminal.screen.text()).split('\n');
          const behavior = rows.indexOf('Behavior');
          expect(behavior).toBeGreaterThan(0);
          expect(rows[behavior + 1]).toMatch(/^→ /u);
          settings.push(rows);
          await host.terminal.keyboard.press('Escape');
          await host.terminal.screen.waitForText(description!, {
            timeoutMs: 4000,
          });
          await host.terminal.keyboard.press('Escape');
          await host.terminal.screen.waitUntil(
            screen => !screen.text.includes(description!),
            {timeoutMs: 4000},
          );
        }
        const menuColumn = homes.map(lines =>
          lines
            .find(line => line.includes('Settings'))!
            .search(/Rewrite|Automation/u),
        );
        expect(menuColumn[0]).toBeGreaterThan(0);
        expect(menuColumn[0]).toBe(menuColumn[1]);
        expect(homes[0]!.find(line => line.includes('Navigate'))).toBe(
          homes[1]!.find(line => line.includes('Navigate')),
        );
        expect(settings[0]!.find(line => line.includes('Navigate'))).toBe(
          settings[1]!.find(line => line.includes('Navigate')),
        );
      } catch (error) {
        console.error(await host.terminal.screen.text());
        throw error;
      } finally {
        await host.close();
      }
    },
    30000,
  );
}
