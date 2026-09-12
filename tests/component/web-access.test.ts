import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {createWebTools} from '../../src/web/index';

// Exercise the definitions registered with Pi, with only network I/O supplied.
test('fetch accepts reachable local and private targets, including redirects', async () => {
  const requested: string[] = [];
  const web = createWebTools({
    request: request => {
      requested.push(request.url.href);
      return Effect.succeed(
        request.url.hostname === 'example.com'
          ? new Response(null, {
              status: 302,
              headers: {location: 'http://127.0.0.1/fixture'},
            })
          : new Response('reachable fixture', {
              headers: {'content-type': 'text/plain'},
            }),
      );
    },
  });
  const result = await web.fetchContent.execute(
    'f',
    {
      urls: [
        'http://127.1/',
        'http://localhost:3000/',
        'https://private.example',
        'https://example.com',
      ],
    },
    undefined,
  );
  expect(requested).toContain('http://127.0.0.1/');
  expect(requested).toContain('http://localhost:3000/');
  expect(requested).toContain('https://private.example/');
  expect(requested).toContain('http://127.0.0.1/fixture');
  expect(result.content[0]?.text.match(/contentId:/g)).toHaveLength(4);
  expect(result.content[0]?.text).not.toContain('error:');
});

test('fetch preserves ordered partial failures and extracts readable HTML', async () => {
  const html =
    '<html><head><title>Article</title></head><body><nav>Navigation</nav><article><h1>Article</h1><p>' +
    'This public article explains a useful API. '.repeat(30) +
    '</p></article></body></html>';
  const web = createWebTools({
    request: request =>
      Effect.succeed(
        request.url.pathname === '/bad'
          ? new Response('not found', {status: 404})
          : new Response(html, {headers: {'content-type': 'text/html'}}),
      ),
  });
  const result = await web.fetchContent.execute(
    'f',
    {urls: ['https://example.com/bad', 'https://example.com/article']},
    undefined,
  );
  const text = result.content[0]?.text ?? '';
  expect(text).toContain('HTTP 404');
  expect(text.indexOf('HTTP 404')).toBeLessThan(text.indexOf('contentId:'));
  expect(text).toContain('This public article');
  expect(text).not.toContain('<html>');
  expect(text).not.toContain('Navigation');
});
test('fetch retains raw text for subsequent paging without hidden body details', async () => {
  const web = createWebTools({
    request: () =>
      Effect.succeed(
        new Response('alpha beta gamma', {
          headers: {'content-type': 'text/plain'},
        }),
      ),
  });
  const fetched = await web.fetchContent.execute(
    'fetch',
    {urls: ['https://example.com'], mode: 'raw'},
    undefined,
  );
  const text = fetched.content[0]?.text ?? '';
  const id = /contentId: (\S+)/.exec(text)?.[1];
  expect(id).toBeDefined();
  expect(fetched.details).toBeUndefined();
  const page = await web.getSearchContent.execute(
    'page',
    {contentId: id ?? '', offset: 6, limit: 4},
    undefined,
  );
  expect(page.content[0]?.text).toContain('beta');
  expect(page.content[0]?.text).toContain('nextOffset: 10');
});

test('minimum UTF-16 pages always advance through supplementary characters', async () => {
  const web = createWebTools({
    request: () =>
      Effect.succeed(
        new Response('\u{1f600}x', {headers: {'content-type': 'text/plain'}}),
      ),
  });
  const fetched = await web.fetchContent.execute(
    'fetch',
    {urls: ['https://example.com']},
    undefined,
  );
  const id = /contentId: (\S+)/.exec(fetched.content[0]?.text ?? '')?.[1] ?? '';
  let combined = '';
  for (const offset of [0, 1, 2]) {
    const page = await web.getSearchContent.execute(
      'page',
      {contentId: id, offset, limit: 1},
      undefined,
    );
    const text = page.content[0]?.text ?? '';
    expect(text).toContain(`nextOffset: ${offset + 1}`);
    combined += text.split('\n\n')[1];
  }
  expect(combined).toBe('\u{1f600}x');
});

test('byte-bounded paging continues exactly and find reports UTF-16 positions', async () => {
  const body = '界'.repeat(18000) + 'İ [a] BETA beta';
  const web = createWebTools({
    request: () =>
      Effect.succeed(
        new Response(body, {headers: {'content-type': 'text/plain'}}),
      ),
  });
  const fetched = await web.fetchContent.execute(
    'f',
    {urls: ['https://example.com']},
    undefined,
  );
  const id = /contentId: (\S+)/.exec(fetched.content[0]?.text ?? '')?.[1] ?? '';
  const page = await web.getSearchContent.execute(
    'p',
    {contentId: id, limit: 20000},
    undefined,
  );
  const text = page.content[0]?.text ?? '';
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32768);
  const next = Number(/nextOffset: (\d+)/.exec(text)?.[1]);
  const rest = await web.getSearchContent.execute(
    'p',
    {contentId: id, offset: next, limit: 20000},
    undefined,
  );
  expect(
    text.split('\n\n')[1] + (rest.content[0]?.text.split('\n\n')[1] ?? ''),
  ).toBe(body);
  const found = await web.getSearchContent.execute(
    'find',
    {contentId: id, find: 'beta'},
    undefined,
  );
  expect(found.content[0]?.text).toContain('position: 18006');
  expect(found.content[0]?.text).toContain('position: 18011');
  await expect(
    web.getSearchContent.execute(
      'bad',
      {contentId: id, find: 'beta', offset: 0},
      undefined,
    ),
  ).rejects.toThrow('mix');
  web.clear();
  await expect(
    web.getSearchContent.execute('old', {contentId: id}, undefined),
  ).rejects.toThrow('again');
});
