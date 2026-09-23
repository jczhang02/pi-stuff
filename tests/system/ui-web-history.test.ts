import {expect, test} from 'bun:test';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Disabled Web tools retain historical views without fetching or becoming callable', async () => {
  const host = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'web',
  );
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      requests++;
      return new Response('RETAINED_WEB_BODY\nSECOND_WEB_LINE\n', {
        headers: {'content-type': 'text/plain'},
      });
    },
  });
  try {
    await host.terminal.resize({cols: 110, rows: 55});
    const fetched = await host.invoke(
      'fetch_content',
      JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
    );
    const id = /contentId: ([^\s]+)/u.exec(fetched)?.[1];
    if (!id) throw new Error('Missing content ID');
    await host.invoke(
      'get_search_content',
      JSON.stringify({contentId: id, find: 'SECOND_WEB_LINE'}),
    );
    await writeFile(
      join(host.agent, 'auth.json'),
      JSON.stringify({exa: {type: 'api_key', key: 'invalid\nfixture'}}),
    );
    await host.invoke(
      'web_search',
      JSON.stringify({queries: ['offline authentication failure']}),
    );
    const directory = join(host.directory, 'sessions');
    const name = (await readdir(directory, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!name) throw new Error('Missing session');
    const file = join(directory, name);
    const saved = await readFile(file, 'utf8');
    const initialRequests = requests;
    expect(initialRequests).toBeGreaterThan(0);
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({
        ui: {retrievalGroups: false},
        tools: {
          fetch_content: false,
          get_search_content: false,
          web_search: false,
        },
      }),
    );
    for (const stage of ['reload', 'resume']) {
      if (stage === 'reload') await host.reload();
      else {
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
      expect(compact).toContain('WebFetch(1 page)');
      expect(compact).toContain('WebRead(retained content)');
      expect(compact).toContain('WebSearch(1 query)');
      expect(compact).toContain('error: authentication:');
      expect(compact).not.toContain('RETAINED_WEB_BODY');
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('RETAINED_WEB_BODY', {
        timeoutMs: 5000,
      });
      expect(await host.terminal.screen.text()).toContain('SECOND_WEB_LINE');
      expect(requests).toBe(initialRequests);
      expect(await readFile(file, 'utf8')).toBe(saved);
      await host.terminal.keyboard.press('Control+O');
    }
    await host.startResponse('Availability observation');
    await host.terminal.screen.waitForText('Availability observation', {
      timeoutMs: 5000,
    });
    expect(host.offered()).not.toContain('fetch_content');
    expect(host.offered()).not.toContain('get_search_content');
    expect(host.offered()).not.toContain('web_search');
    expect(requests).toBe(initialRequests);
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test('Registered Web renderers rebuild their group after same-runtime session replacement', async () => {
  const host = await launchPi('{}', undefined, 'web');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response('SAME_RUNTIME_BODY', {
        headers: {'content-type': 'text/plain'},
      }),
  });
  try {
    const call = {
      name: 'fetch_content',
      parameters: JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
    };
    await host.sequence([call, call]);
    expect(await host.terminal.screen.text()).toContain(
      'Read web content 2 times',
    );
    const directory = join(host.directory, 'sessions');
    const name = (await readdir(directory, {recursive: true})).find(path =>
      path.endsWith('.jsonl'),
    );
    if (!name) throw new Error('Missing session');
    await host.command('/host-session new');
    await host.terminal.screen.waitForText('HOST_SESSION_NEW', {
      timeoutMs: 5000,
    });
    await host.command(`/host-session ${join(directory, name)}`);
    await host.terminal.screen.waitForText('Resumed session', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain(
      'Read web content 2 times',
    );
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('SAME_RUNTIME_BODY', {
      timeoutMs: 5000,
    });
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);
