import {expect, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';
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

test('Explicit third-party takeover changes only presentation and can be removed on reload', async () => {
  const host = await launchPi(
    '{"ui":{"takeoverTools":["read"]}}',
    resolve('tests/system/fixtures/foreign-read.ts'),
    'ui',
  );
  try {
    const path = 'takeover.txt';
    await writeFile(join(host.directory, path), 'NATIVE_FILE_CONTENT');
    expect(await host.invoke('read', JSON.stringify({path}))).toBe(
      `FOREIGN_READ_EXECUTION:${path}`,
    );
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('read({"path":"takeover.txt"})');
    expect(compact).toContain('1 more line');
    expect(compact).not.toContain('FOREIGN_READ_HEADING');
    expect(compact).not.toContain('FOREIGN_READ_RESULT_VIEW');
    expect(compact).not.toContain('Read 1 file');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText(`FOREIGN_READ_EXECUTION:${path}`, {
      timeoutMs: 5000,
    });
    expect(await readFile(join(host.directory, path), 'utf8')).toBe(
      'NATIVE_FILE_CONTENT',
    );
    await host.reload();
    await host.terminal.screen.waitForText('read({"path":"takeover.txt"})', {
      timeoutMs: 5000,
    });
    await writeFile(join(host.agent, 'pi-stuff.json'), '{}');
    await host.reload();
    const restored = await host.terminal.screen.text();
    expect(restored).toContain(`FOREIGN_READ_HEADING:${path}`);
    expect(restored).toContain(`FOREIGN_READ_RESULT_VIEW:${path}`);
    expect(restored).not.toContain('read({"path":"takeover.txt"})');
  } finally {
    await host.close();
  }
}, 30000);

test('Generic takeover preserves foreign arguments, details and visible failures', async () => {
  const host = await launchPi(
    '{"ui":{"takeoverTools":["foreign_job"]}}',
    resolve('tests/system/fixtures/foreign-read.ts'),
    'web',
  );
  try {
    expect(
      await host.invoke('foreign_job', JSON.stringify({jobId: 'A-19'})),
    ).toBe('JOB:A-19\nDONE');
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Job({"jobId":"A-19"})');
    expect(compact).toContain('2 more lines');
    expect(compact).not.toContain('FOREIGN_JOB_VIEW');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('⎿ JOB:A-19', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Control+O');
    expect(
      await host.invoke(
        'foreign_job',
        JSON.stringify({jobId: 'A-20', fail: true}),
      ),
    ).toContain('JOB_FAILED:A-20');
    expect(await host.terminal.screen.text()).toContain('⎿ JOB_FAILED:A-20');
  } finally {
    await host.close();
  }
}, 30000);
