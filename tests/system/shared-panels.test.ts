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
          const screen = (await host.terminal.screen.text())
            .split('\n')
            .map(line => line.trimEnd());
          const heading = screen.findIndex(line =>
            line.trimStart().startsWith(title!),
          );
          expect(screen[heading - 2]).toMatch(/^─+$/u);
          expect(screen[heading + 1]).toBe('');
          expect(screen[heading + 2]?.trim()).toBe(description!);
          if (title === 'AutoName') {
            const name = screen.findIndex(
              line => line.trim() === 'No name yet',
            );
            expect(name).toBeGreaterThan(heading);
            expect(screen[name + 1]).toBe('');
            expect(screen[name + 2]).toMatch(/^→ Settings/u);
            const hint = screen.findIndex(line => line.includes('back'));
            expect(screen[hint + 2]).toMatch(/^─+$/u);
          }
          homes.push(screen);
          expect(screen.find(line => line.includes('Settings'))).toMatch(
            /^→ Settings/u,
          );
          await host.terminal.keyboard.press('Enter');
          await host.terminal.screen.waitForText(`${title} / Settings`, {
            timeoutMs: 4000,
          });
          const rows = (await host.terminal.screen.text())
            .split('\n')
            .map(line => line.trimEnd());
          expect(rows.some(line => line.includes('Type to search'))).toBe(true);
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
        expect(homes[0]!.find(line => line.includes('navigate'))).toBe(
          homes[1]!.find(line => line.includes('navigate')),
        );
        expect(settings[0]!.find(line => line.includes('Type to search'))).toBe(
          settings[1]!.find(line => line.includes('Type to search')),
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

test.each(['/autoname panel', '/rtk'])(
  'mouse navigation retains the routing owner for subsequent keyboard input: %s',
  async command => {
    const host = await launchPi('{"naming":{"automatic":false}}');
    try {
      await host.command(command);
      await host.terminal.screen.waitForText('Settings', {timeoutMs: 4000});
      const lines = (await host.terminal.screen.text()).split('\n');
      const y = lines.findIndex(line => line.startsWith('→ Settings'));
      expect(y).toBeGreaterThan(0);
      await host.terminal.mouse({action: 'click', button: 'left', x: 4, y});
      const title = command === '/rtk' ? 'RTK' : 'AutoName';
      await host.terminal.screen.waitForText(`${title} / Settings`, {
        timeoutMs: 4000,
      });
      await host.terminal.keyboard.press('Control+C');
      await host.terminal.screen.waitForText(
        command === '/rtk' ? 'Configure RTK' : 'Current name',
        {timeoutMs: 4000},
      );
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText(`${title} / Settings`, {
        timeoutMs: 4000,
      });
      if (command !== '/rtk') {
        await host.terminal.keyboard.type('rules');
        await host.terminal.keyboard.press('Enter');
        await host.terminal.screen.waitForText('external editor', {
          timeoutMs: 4000,
        });
        await host.terminal.keyboard.press('Control+C');
        await host.terminal.screen.waitForText('AutoName / Settings', {
          timeoutMs: 4000,
        });
      }
    } finally {
      await host.close();
    }
  },
  30000,
);
