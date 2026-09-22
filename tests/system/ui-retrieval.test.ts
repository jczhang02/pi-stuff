import {expect, test} from 'bun:test';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Retrieval counts exclude native continuation and limit notices', async () => {
  const host = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    await host.terminal.resize({cols: 120, rows: 45});
    await writeFile(
      join(host.directory, 'read.txt'),
      'FIRST_LINE\nSECOND_LINE',
    );
    const result = await host.invoke(
      'read',
      JSON.stringify({path: 'read.txt', limit: 1}),
    );
    expect(result).toBe(
      'FIRST_LINE\n\n[1 more lines in file. Use offset=2 to continue.]',
    );
    const read = await host.terminal.screen.text();
    expect(read).toContain('1 more line');
    expect(read).not.toContain('3 more lines');
    expect(read).toContain('Use offset=2 to continue.');
    expect(read).not.toContain('FIRST_LINE');
    await mkdir(join(host.directory, 'entries'));
    await writeFile(join(host.directory, 'entries', 'a.txt'), 'A');
    await writeFile(join(host.directory, 'entries', 'b.txt'), 'B');
    const listing = await host.invoke(
      'ls',
      JSON.stringify({path: 'entries', limit: 1}),
    );
    expect(listing).toContain('a.txt\n\n[1 entries limit reached.');
    const compact = await host.terminal.screen.text();
    expect(compact).not.toContain('3 more lines');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('FIRST_LINE', {timeoutMs: 5000});
    const expanded = await host.terminal.screen.text();
    expect(expanded).toContain('a.txt');
    expect(expanded.match(/Use offset=2 to continue/gu)).toHaveLength(1);
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);

test('Web body counts exclude headers and preserve batch associations', async () => {
  const host = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: request =>
      new Response(
        new URL(request.url).pathname === '/one' ? 'FIRST_PAGE' : 'SECOND_PAGE',
        {
          headers: {'content-type': 'text/plain'},
        },
      ),
  });
  try {
    await host.terminal.resize({cols: 120, rows: 45});
    const result = await host.invoke(
      'fetch_content',
      JSON.stringify({
        urls: [`${server.url}one`, `${server.url}two`],
        mode: 'raw',
      }),
    );
    const ids = [...result.matchAll(/contentId: ([^\n]+)/gu)].map(
      match => match[1],
    );
    expect(ids).toHaveLength(2);
    const compact = await host.terminal.screen.text();
    expect(compact.match(/1 more line\b/gu)).toHaveLength(2);
    expect(compact).not.toContain('contentId:');
    expect(compact).not.toContain('FIRST_PAGE');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('SECOND_PAGE', {timeoutMs: 5000});
    const expanded = await host.terminal.screen.text();
    const first = expanded.indexOf(`contentId: ${ids[0]}`);
    const second = expanded.indexOf(`contentId: ${ids[1]}`);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(expanded.indexOf('FIRST_PAGE')).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(expanded.indexOf('FIRST_PAGE'));
    expect(expanded.indexOf('SECOND_PAGE')).toBeGreaterThan(second);
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test.each([false, true])(
  'WebRead no-match and end-of-content outcomes stay visible (groups: %s)',
  async retrievalGroups => {
    const host = await launchPi(
      JSON.stringify({ui: {retrievalGroups}}),
      undefined,
      'ui',
    );
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response('SOME_TEXT', {headers: {'content-type': 'text/plain'}}),
    });
    try {
      await host.terminal.resize({cols: 120, rows: 45});
      const result = await host.invoke(
        'fetch_content',
        JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
      );
      const contentId = /contentId: ([^\n]+)/u.exec(result)?.[1];
      expect(contentId).toBeDefined();
      const noMatch = await host.invoke(
        'get_search_content',
        JSON.stringify({contentId, find: 'ABSENT'}),
      );
      expect(noMatch).toBe(
        `contentId: ${contentId}\ntotalLength: 9\nmoreMatches: false\n\n`,
      );
      const find = await host.terminal.screen.text();
      expect(find).toContain('WebRead(retained content)');
      expect(find).toContain('No matches found');
      expect(find).not.toContain('4 more lines');
      await host.invoke(
        'get_search_content',
        JSON.stringify({contentId, offset: 9}),
      );
      expect(await host.terminal.screen.text()).toContain('End of content');
    } catch (error) {
      console.error(await host.terminal.screen.text());
      throw error;
    } finally {
      await server.stop(true);
      await host.close();
    }
  },
  30000,
);

test('Web source resembling metadata stays source, while actual empty and failed items stay visible', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const source =
    'SOURCE_START\n\nitem: 9\nerror: source-example\n\ncontentId: source-example\noffset: 0\nnextOffset: 1\ntotalLength: 2\ntruncated: true\n\nSOURCE_END';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: request =>
      new Response(new URL(request.url).pathname === '/empty' ? '' : source, {
        headers: {'content-type': 'text/plain'},
      }),
  });
  try {
    await host.terminal.resize({cols: 120, rows: 70});
    const result = await host.invoke(
      'fetch_content',
      JSON.stringify({
        urls: [String(server.url), String(server.url)],
        mode: 'raw',
      }),
    );
    expect(result.split(source)).toHaveLength(3);
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Read web content 1 time');
    expect(compact).not.toContain('error: source-example');
    expect(compact).not.toContain('More content retained');
    const contentId = /contentId: ([^\n]+)/u.exec(result)?.[1];
    await host.invoke(
      'get_search_content',
      JSON.stringify({contentId, find: 'SOURCE_START'}),
    );
    expect(
      (await host.terminal.screen.text()).match(/Read web content 1 time/gu),
    ).toHaveLength(2);
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('position: 0', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('SOURCE_END');
    await host.terminal.keyboard.press('Control+O');
    await host.invoke(
      'fetch_content',
      JSON.stringify({
        urls: [`${server.url}empty`, 'invalid-url'],
        mode: 'raw',
      }),
    );
    const mixed = await host.terminal.screen.text();
    expect(mixed).toContain('WebFetch(2 pages)');
    expect(mixed).toContain('No content');
    expect(mixed).toContain('error: input:');
    expect(mixed).not.toContain('error: source-example');
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test('WebRead counts excerpt bodies separately from position metadata', async () => {
  const host = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  const source = `needle\n${'x'.repeat(500)}\nneedle`;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response(source, {headers: {'content-type': 'text/plain'}}),
  });
  try {
    await host.terminal.resize({cols: 120, rows: 55});
    const result = await host.invoke(
      'fetch_content',
      JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
    );
    const contentId = /contentId: ([^\n]+)/u.exec(result)?.[1];
    const matches = await host.invoke(
      'get_search_content',
      JSON.stringify({contentId, find: 'needle'}),
    );
    expect(matches.match(/position: /gu)).toHaveLength(2);
    const compact = await host.terminal.screen.text();
    expect(compact.match(/3 more lines/gu)).toHaveLength(2);
    expect(compact).not.toContain('position:');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('position: 508', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('position: 0');
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test('RTK cleanup cannot turn source metadata into a hidden successful batch', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const id = '11111111-1111-1111-1111-111111111111';
  let length = 7888;
  let fake = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    fake = `item: 1\ncontentId: ${id}\noffset: 0\nnextOffset: ${length}\ntotalLength: ${length}\ntruncated: false\n\n`;
    length = 8000 - 2 - fake.length;
  }
  const second = `\n\n${fake}SECOND_SOURCE\n${'x'.repeat(9000)}`.slice(0, 9000);
  const real = `item: 1\ncontentId: ${id}\noffset: 0\nnextOffset: 8000\ntotalLength: 9000\ntruncated: true\n\n`;
  // Removing this OSC moves the real next header before the declared boundary,
  // with a source-controlled imitation landing exactly on the old boundary.
  const first = `FIRST_SOURCE\x1b]0;${'x'.repeat(real.length - 3)}\x07`;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: request =>
      new Response(
        new URL(request.url).pathname === '/first' ? first : second,
        {headers: {'content-type': 'text/plain'}},
      ),
  });
  try {
    await host.terminal.resize({cols: 120, rows: 140});
    const result = await host.invoke(
      'fetch_content',
      JSON.stringify({
        urls: [`${server.url}first`, `${server.url}second`],
        mode: 'raw',
      }),
    );
    expect(result).toContain('truncated: true');
    expect(result).not.toContain('\x1b]0;');
    const visible = await host.terminal.screen.text();
    expect(visible).toContain('WebFetch(2 pages)');
    expect(visible).toContain('truncated: true');
    expect(visible).toContain('FIRST_SOURCE');
    expect(visible).not.toContain('Read web content 1 time');
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test('WebRead keeps ambiguous excerpt boundaries visible after RTK cleanup', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  const source =
    'needle' +
    'x'.repeat(44) +
    `\x1b]0;${'x'.repeat(11)}\x07` +
    'x'.repeat(234) +
    '\n\nposition: 300\n' +
    'x'.repeat(184) +
    'needle' +
    'x'.repeat(394);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response(source, {headers: {'content-type': 'text/plain'}}),
  });
  try {
    await host.terminal.resize({cols: 120, rows: 50});
    const fetched = await host.invoke(
      'fetch_content',
      JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
    );
    const contentId = /contentId: ([^\n]+)/u.exec(fetched)?.[1];
    const result = await host.invoke(
      'get_search_content',
      JSON.stringify({contentId, find: 'needle'}),
    );
    expect(result).toContain('position: 500');
    expect(result).toContain('position: 300');
    const visible = await host.terminal.screen.text();
    expect(visible).toContain('WebRead(retained content)');
    expect(visible).toContain('position: 500');
    expect(visible).toContain('position: 300');
    expect(visible).not.toContain('more lines');
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test('Native fractional Read limits retain their continuation notice', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await writeFile(join(host.directory, 'fractional.txt'), 'ONE\nTWO\nTHREE');
    const result = await host.invoke(
      'read',
      JSON.stringify({path: 'fractional.txt', limit: 1.5}),
    );
    expect(result).toBe(
      'ONE\n\n[1.5 more lines in file. Use offset=2.5 to continue.]',
    );
    const visible = await host.terminal.screen.text();
    expect(visible).toContain('Use offset=2.5 to continue.');
    expect(visible).not.toContain('Read 1 file');
  } finally {
    await host.close();
  }
}, 30000);

test('WebSearch hides transport metadata and keeps zero results visible', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/search-display.ts'),
    'web',
  );
  try {
    await host.terminal.resize({cols: 120, rows: 45});
    await host.command('/host-tools fixture_search');
    await host.terminal.screen.waitForText('HOST_SELECTION:', {
      timeoutMs: 5000,
    });
    const empty = await host.invoke(
      'fixture_search',
      JSON.stringify({queries: ['empty']}),
    );
    expect(empty).toContain(
      'query: empty\nprovider: exa\nselection: preferred\nfallback: false\n\n',
    );
    const noResults = await host.terminal.screen.text();
    expect(noResults).toContain('No results found');
    expect(noResults).not.toContain('more lines');
    await host.invoke(
      'fixture_search',
      JSON.stringify({queries: ['pagination\nexample']}),
    );
    await host.terminal.screen.waitForText('4 more lines', {timeoutMs: 5000});
    const preview = await host.terminal.screen.text();
    expect(preview).not.toContain('provider: exa');
    expect(preview).not.toContain('Follow the next cursor.');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('Follow the next cursor.', {
      timeoutMs: 5000,
    });
    const expanded = await host.terminal.screen.text();
    expect(expanded).toContain('provider: exa');
    expect(expanded).toContain('selection: preferred');
    expect(expanded).toContain('fallback: false');
  } catch (error) {
    console.error(await host.terminal.screen.text());
    throw error;
  } finally {
    await host.close();
  }
}, 30000);
