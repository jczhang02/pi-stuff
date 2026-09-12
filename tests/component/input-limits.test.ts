import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {createWebTools} from '../../src/web';

test('search length is bounded in UTF-16 units, not grapheme clusters', async () => {
  let requests = 0;
  const web = createWebTools(
    {
      request: () => {
        requests++;
        return Effect.succeed(Response.json({results: []}));
      },
    },
    {provider: 'exa'},
    {
      exa: () => Effect.succeed('fixture'),
      openai: () => Effect.succeed(undefined),
    },
  );
  for (const query of ['a' + '\u0301'.repeat(2000), '😀'.repeat(1001)]) {
    await expect(
      web.webSearch.execute('over', {queries: [query]}, undefined),
    ).rejects.toThrow('Invalid search arguments');
  }
  expect(requests).toBe(0);
  const result = await web.webSearch.execute(
    'edge',
    {queries: ['a' + '\u0301'.repeat(1999), '😀'.repeat(1000)]},
    undefined,
  );
  expect(requests).toBe(2);
  expect(result.content[0]?.text).not.toContain('error:');
});

test('URL length is bounded in UTF-16 units before any fetch', async () => {
  let requests = 0;
  const prefix = 'https://example.com/';
  const web = createWebTools({
    request: () => {
      requests++;
      return Effect.succeed(
        new Response('boundary accepted', {
          headers: {'content-type': 'text/plain'},
        }),
      );
    },
  });
  for (const path of ['a' + '\u0301'.repeat(8192), '😀'.repeat(4096)]) {
    await expect(
      web.fetchContent.execute(
        'over',
        {urls: [prefix + path], mode: 'raw'},
        undefined,
      ),
    ).rejects.toThrow('Invalid fetch arguments');
  }
  expect(requests).toBe(0);
  const result = await web.fetchContent.execute(
    'edge',
    {urls: [prefix + '\u0301'.repeat(8192 - prefix.length)], mode: 'raw'},
    undefined,
  );
  expect(requests).toBe(1);
  expect(result.content[0]?.text).toContain('boundary accepted');
});
