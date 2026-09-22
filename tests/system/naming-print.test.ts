import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {NamingProvider} from './fixtures/naming-provider';

for (const mode of ['json', 'text']) {
  test.each([
    ['missing', 'Naming failed: model unavailable', 0],
    ['invalid', 'Naming failed: invalid name', 1],
    ['unsaved', 'Unsaved session', 1],
  ] as const)(
    `${mode} print reports %s naming feedback before exit`,
    async (scenario, feedback, count) => {
      const provider = new NamingProvider();
      if (scenario === 'invalid') provider.title = 'Invalid\nname';
      const host = await launchPi(
        JSON.stringify({
          naming: {
            automatic: false,
            model: {
              provider: 'fixture',
              id: scenario === 'missing' ? 'missing' : 'naming',
            },
          },
        }),
        undefined,
        'rtk',
        'fullscreen',
        provider.reply,
      );
      try {
        await host.restart(
          [
            '--mode',
            mode,
            '-p',
            '--no-session',
            '/autoname Test print feedback',
          ],
          false,
        );
        const exit = await host.terminal.waitForExit({timeoutMs: 18000});
        expect(exit.reason).toBe('exited');
        if (exit.reason === 'exited') expect(exit.exit.code).toBe(0);
        expect(provider.requests).toHaveLength(count);
        expect(await host.terminal.logs.text()).toContain(feedback);
      } finally {
        await host.close();
      }
    },
    30000,
  );
}
