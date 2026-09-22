import {expect, test} from 'bun:test';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
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

test('New sessions discard old retrieval group state', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await writeFile(join(host.directory, 'old.txt'), 'OLD_SESSION_BODY');
    await host.sequence([
      {name: 'read', parameters: JSON.stringify({path: 'old.txt'})},
      {name: 'read', parameters: JSON.stringify({path: 'old.txt'})},
    ]);
    expect(await host.terminal.screen.text()).toContain('Read 2 files');
    await host.command('/host-session new');
    await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('Read 2 files');
    await writeFile(join(host.directory, 'new.txt'), 'NEW_SESSION_BODY');
    await host.invoke('read', JSON.stringify({path: 'new.txt'}));
    const fresh = await host.terminal.screen.text();
    expect(fresh).toContain('Read 1 file');
    expect(fresh).not.toContain('Read 3 files');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('NEW_SESSION_BODY', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('OLD_SESSION_BODY');
  } finally {
    await host.close();
  }
}, 30000);

test('Resumed sessions rebuild historical retrieval groups', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await writeFile(join(host.directory, 'old.txt'), 'OLD_SESSION_BODY');
    await host.sequence([
      {name: 'read', parameters: JSON.stringify({path: 'old.txt'})},
      {name: 'read', parameters: JSON.stringify({path: 'old.txt'})},
    ]);
    expect(await host.terminal.screen.text()).toContain('Read 2 files');
    const sessions = join(host.directory, 'sessions');
    const original = (await readdir(sessions, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!original) throw new Error('The completed session was not persisted');
    await host.command('/host-session new');
    await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('Read 2 files');
    await writeFile(join(host.directory, 'new.txt'), 'NEW_SESSION_BODY');
    await host.invoke('read', JSON.stringify({path: 'new.txt'}));
    const fresh = await host.terminal.screen.text();
    expect(fresh).toContain('Read 1 file');
    expect(fresh).not.toContain('Read 3 files');
    await host.command(`/host-session ${join(sessions, original)}`);
    await host.terminal.screen.waitForText('Resumed session', {
      timeoutMs: 5000,
    });
    const restored = await host.terminal.screen.text();
    expect(restored).toContain('Read 2 files');
    expect(restored).not.toContain('RTK_TURN_2_DONE');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('OLD_SESSION_BODY', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('NEW_SESSION_BODY');
  } catch (error) {
    console.error(await host.terminal.logs.text());
    throw error;
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

test('Parallel retrievals retain pending calls and failures in source order', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const gate = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch() {
      await gate.promise;
      return new Response('SLOW_WEB_BODY', {
        headers: {'content-type': 'text/plain'},
      });
    },
  });
  try {
    await host.terminal.resize({cols: 120, rows: 50});
    await host.command('/host-tools fetch_content,read,ls');
    await host.terminal.screen.waitForText('HOST_SELECTION:', {
      timeoutMs: 5000,
    });
    await writeFile(join(host.directory, 'fast.txt'), 'FAST_READ_BODY');
    await mkdir(join(host.directory, 'entries'));
    await writeFile(join(host.directory, 'entries', 'last.txt'), 'LAST_BODY');
    await host.startParallel([
      {
        name: 'fetch_content',
        parameters: JSON.stringify({
          urls: [String(server.url)],
          mode: 'raw',
        }),
      },
      {name: 'read', parameters: JSON.stringify({path: 'fast.txt'})},
      {name: 'read', parameters: JSON.stringify({path: 'missing.txt'})},
      {name: 'ls', parameters: JSON.stringify({path: 'entries'})},
    ]);
    await host.terminal.screen.waitForText('Listed 1 directory', {
      timeoutMs: 5000,
    });
    const pending = (
      await host.terminal.screen.capture({
        allowIncomplete: true,
        deadlineMs: 200,
      })
    ).text;
    expect(pending).toContain('WebFetch(1 page)');
    expect(pending).toContain('Read 1 file');
    expect(pending).toContain('Read(missing.txt)');
    expect(pending).toContain('ENOENT');
    expect(pending).not.toContain('Read web content');
    expect(pending).not.toContain('FAST_READ_BODY');
    expect(pending).not.toContain('RTK_TURN_1_DONE');
    gate.resolve();
    await host.terminal.screen.waitForText('RTK_TURN_1_DONE', {
      timeoutMs: 5000,
    });
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Read 1 file · Read web content 1 time');
    expect(compact).toContain('Listed 1 directory');
    expect(compact).toContain('ENOENT');
    const rows = compact.split('\n');
    const y = rows.findIndex(row => row.includes('Read web content 1 time'));
    const x = rows[y]?.indexOf('•') ?? -1;
    expect(x).toBeGreaterThanOrEqual(0);
    await host.terminal.mouse({action: 'click', x, y, button: 'left'});
    await host.terminal.screen.waitForText('Read(fast.txt)', {
      timeoutMs: 5000,
    });
    const open = (await host.terminal.screen.text()).split('\n');
    const slow = open.findIndex(row => row.includes('WebFetch(1 page)'));
    const fast = open.findIndex(row => row.includes('Read(fast.txt)'));
    const failed = open.findIndex(row => row.includes('Read(missing.txt)'));
    const last = open.findIndex(row => row.includes('Listed 1 directory'));
    expect(slow).toBeGreaterThanOrEqual(0);
    expect(fast).toBeGreaterThan(slow);
    expect(failed).toBeGreaterThan(fast);
    expect(last).toBeGreaterThan(failed);
    expect(open[slow]?.indexOf('•')).toBe(x);
    expect(open[fast]?.indexOf('•')).toBe(x);
    expect(open.join('\n')).not.toContain('SLOW_WEB_BODY');
    await host.terminal.mouse({action: 'click', x, y: fast, button: 'left'});
    await host.terminal.screen.waitForText('FAST_READ_BODY', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain('SLOW_WEB_BODY');
  } finally {
    gate.resolve();
    try {
      await server.stop(true);
    } finally {
      await host.close();
    }
  }
}, 30000);
