import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Read keeps image results outside text groups and uses native media fallback', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    // A one-pixel PNG exercises the actual native image reader without codecs
    // or a terminal-image implementation in the extension.
    await writeFile(
      join(host.directory, 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const result = await host.invoke(
      'read',
      JSON.stringify({path: 'pixel.png'}),
    );
    expect(result).toContain('Read image file [image/png]');
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Read(pixel.png)');
    expect(compact).not.toContain('Read 1 file');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('[Image: [image/png] 1x1]', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('[image:');
  } finally {
    await host.close();
  }
}, 30000);
