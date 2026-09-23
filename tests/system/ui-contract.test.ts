import {expect, test} from 'bun:test';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('UI on/off preserves native schemas, model results, stored details and shell options', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/ui-contract.ts'),
    'ui',
  );
  let baseline: {recorded: string; model: string[]} | undefined;
  try {
    await mkdir(join(host.directory, 'data'));
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({
        shellPath: '/bin/bash',
        shellCommandPrefix: 'export UI_CONTRACT=kept',
      }),
    );
    for (const enabled of [false, true, false]) {
      await writeFile(
        join(host.agent, 'pi-stuff.json'),
        JSON.stringify({ui: {enabled}, rtk: {rewrite: false, ansi: false}}),
      );
      await host.reload();
      await host.command('/host-session new');
      await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
        timeoutMs: 5000,
      });
      const calls = [
        {
          name: 'write',
          args: {
            path: 'data/source.ts',
            content: 'export const value = 1;\n// last\n',
          },
        },
        {
          name: 'edit',
          args: {
            path: 'data/source.ts',
            oldText: 'value = 1',
            newText: 'value = 2',
          },
        },
        {name: 'read', args: {path: 'data/source.ts', offset: 1, limit: 1}},
        {name: 'grep', args: {path: 'data', pattern: 'value', limit: 1}},
        {name: 'find', args: {path: 'data', pattern: '*.ts', limit: 1}},
        {name: 'ls', args: {path: 'data', limit: 1}},
        {
          name: 'bash',
          args: {command: 'printf "%s" "$UI_CONTRACT"; exit 7', timeout: 9},
        },
      ];
      const model: string[] = [];
      for (const call of calls)
        model.push(await host.invoke(call.name, JSON.stringify(call.args)));
      expect(model.at(-1)).toContain('kept');
      expect(model.at(-1)).toContain('Command exited with code 7');
      expect(
        await readFile(join(host.directory, 'data/source.ts'), 'utf8'),
      ).toBe('export const value = 2;\n// last\n');
      await rm(join(host.directory, 'contract.json'), {force: true});
      await host.command('/ui-contract');
      await host.terminal.screen.waitForText('CONTRACT_RECORDED', {
        timeoutMs: 5000,
      });
      const recorded = await readFile(
        join(host.directory, 'contract.json'),
        'utf8',
      );
      for (const call of calls)
        expect(recorded).toContain(`"toolName":"${call.name}"`);
      if (baseline === undefined) {
        baseline = {recorded, model};
      } else {
        expect(recorded).toBe(baseline.recorded);
        expect(model).toEqual(baseline.model);
      }
    }
  } finally {
    await host.close();
  }
}, 30000);
