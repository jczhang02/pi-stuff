import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Third-party Read keeps execution and rendering across UI toggles and reload', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/foreign-read.ts'),
    'ui',
  );
  try {
    for (const [index, enabled] of [true, false, true].entries()) {
      const path = `source-${index}.txt`;
      await writeFile(join(host.directory, path), 'NATIVE_FILE_CONTENT');
      await writeFile(
        join(host.agent, 'pi-stuff.json'),
        JSON.stringify({ui: {enabled}}),
      );
      await host.reload();
      expect(await host.invoke('read', JSON.stringify({path}))).toBe(
        `FOREIGN_READ_EXECUTION:${path}`,
      );
      const visible = await host.terminal.screen.text();
      expect(visible).toContain(`FOREIGN_READ_HEADING:${path}`);
      expect(visible).toContain(`FOREIGN_READ_RESULT_VIEW:${path}`);
      expect(visible).not.toContain('Read 1 file');
      expect(visible).not.toContain('NATIVE_FILE_CONTENT');
    }
  } finally {
    await host.close();
  }
}, 30000);
