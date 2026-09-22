import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Retrieval group opens aligned compact calls before revealing an individual result', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await writeFile(join(host.directory, 'first.txt'), 'FIRST_BODY\n');
    await writeFile(join(host.directory, 'second.txt'), 'SECOND_BODY\n');
    await host.sequence([
      {name: 'read', parameters: JSON.stringify({path: 'first.txt'})},
      {name: 'read', parameters: JSON.stringify({path: 'second.txt'})},
    ]);
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Read 2 files');
    expect(compact).not.toContain('Read(first.txt)');
    const rows = compact.split('\n');
    const y = rows.findIndex(row => row.includes('Read 2 files'));
    const x = rows[y]?.indexOf('•') ?? -1;
    expect(x).toBeGreaterThanOrEqual(0);
    await host.terminal.mouse({action: 'click', x, y, button: 'left'});
    await host.terminal.screen.waitForText('Read(first.txt)', {
      timeoutMs: 5000,
    });
    const open = (await host.terminal.screen.text()).split('\n');
    const first = open.findIndex(row => row.includes('Read(first.txt)'));
    const second = open.findIndex(row => row.includes('Read(second.txt)'));
    expect(open[first]?.indexOf('•')).toBe(x);
    expect(open[second]?.indexOf('•')).toBe(x);
    expect(open.join('\n')).not.toContain('FIRST_BODY');
    expect(open.join('\n')).not.toContain('SECOND_BODY');
    await host.terminal.mouse({action: 'click', x, y: first, button: 'left'});
    await host.terminal.screen.waitForText('FIRST_BODY', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).not.toContain('SECOND_BODY');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('SECOND_BODY', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 30000);

test('Retrieval groups retain web members across reload and keep failures and Bash outside', async () => {
  const host = await launchPi('{"rtk":{"rewrite":false}}', undefined, 'ui');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response('WEB_GROUP_BODY', {
        headers: {'content-type': 'text/plain'},
      }),
  });
  try {
    await host.terminal.resize({cols: 120, rows: 50});
    await host.command('/host-tools read,bash,fetch_content');
    await host.terminal.screen.waitForText('HOST_SELECTION:', {
      timeoutMs: 5000,
    });
    await writeFile(join(host.directory, 'local.txt'), 'LOCAL_GROUP_BODY\n');
    await host.sequence([
      {name: 'read', parameters: JSON.stringify({path: 'local.txt'})},
      {
        name: 'fetch_content',
        parameters: JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
      },
      {name: 'read', parameters: JSON.stringify({path: 'missing.txt'})},
      {name: 'read', parameters: JSON.stringify({path: 'local.txt'})},
      {
        name: 'bash',
        parameters: JSON.stringify({command: 'printf GROUP_BOUNDARY'}),
      },
      {name: 'read', parameters: JSON.stringify({path: 'local.txt'})},
    ]);
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('Read 1 file · Read web content 1 time');
    expect(screen).not.toContain('Read 3 files');
    expect(screen.match(/Read 1 file/gu)).toHaveLength(3);
    expect(screen).toContain('Read(missing.txt)');
    expect(screen).toContain('ENOENT');
    expect(screen).toContain('Bash(printf GROUP_BOUNDARY)');
    expect(screen).not.toContain('WEB_GROUP_BODY');
    await host.reload();
    await host.terminal.screen.waitForText(
      'Read 1 file · Read web content 1 time',
      {timeoutMs: 5000},
    );
    const restored = await host.terminal.screen.text();
    expect(restored.match(/Read 1 file/gu)).toHaveLength(3);
    expect(restored).toContain('Read(missing.txt)');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('WEB_GROUP_BODY', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('LOCAL_GROUP_BODY');
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);
