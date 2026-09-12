import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {createWebTools} from '../../src/web/index';

test('cancellation stops three active fetches without starting queued URLs', async () => {
  const started = Promise.withResolvers<void>();
  let requests = 0;
  let cancelled = 0;
  const web = createWebTools({
    request: () =>
      Effect.tryPromise({
        try: signal =>
          new Promise<Response>((_resolve, reject) => {
            requests++;
            signal.addEventListener(
              'abort',
              () => {
                cancelled++;
                reject(signal.reason);
              },
              {once: true},
            );
            if (requests === 3) started.resolve();
          }),
        catch: () => new Error('cancelled'),
      }).pipe(Effect.orDie),
  });
  const controller = new AbortController();
  const result = web.fetchContent.execute(
    'f',
    {
      urls: Array.from({length: 5}, (_, i) => `https://example.com/${i}`),
    },
    controller.signal,
  );
  await started.promise;
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(requests).toBe(3);
  expect(cancelled).toBe(3);
}, 5000);

test('already cancelled calls perform no network work', async () => {
  let requests = 0;
  const web = createWebTools({
    request: () => {
      requests++;
      return Effect.succeed(new Response('unexpected'));
    },
  });
  await expect(
    web.fetchContent.execute(
      'f',
      {
        urls: ['https://example.com'],
      },
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
  expect(requests).toBe(0);
});

test('body and retained-text limits fail individual items and release body streams', async () => {
  let released = 0;
  const web = createWebTools({
    request: request =>
      Effect.succeed(
        new Response(
          request.url.pathname === '/body'
            ? new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
                },
                cancel() {
                  released++;
                },
              })
            : 'x'.repeat(1024 * 1024 + 1),
          {headers: {'content-type': 'text/plain'}},
        ),
      ),
  });
  const result = await web.fetchContent.execute(
    'f',
    {
      urls: ['https://example.com/body', 'https://example.com/text'],
    },
    undefined,
  );
  expect(result.content[0]?.text).toContain('exceeds 5 MiB');
  expect(result.content[0]?.text).toContain('exceeds 1 MiB');
  expect(result.content[0]?.text).not.toContain('contentId:');
  expect(released).toBe(1);
});

for (const [size, count] of [
  [1, 65],
  [1024 * 1024, 33],
] as const) {
  test(`cache evicts oldest stored content at ${size}-byte item budget`, async () => {
    const web = createWebTools({
      request: () =>
        Effect.succeed(
          new Response('x'.repeat(size), {
            headers: {'content-type': 'text/plain'},
          }),
        ),
    });
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const result = await web.fetchContent.execute(
        'f',
        {
          urls: ['https://example.com'],
        },
        undefined,
      );
      const id = /contentId: (\S+)/.exec(result.content[0]?.text ?? '')?.[1];
      expect(id).toBeDefined();
      ids.push(id ?? '');
    }
    await expect(
      web.getSearchContent.execute(
        'p',
        {
          contentId: ids[0] ?? '',
        },
        undefined,
      ),
    ).rejects.toThrow('again');
    const remaining = await web.getSearchContent.execute(
      'p',
      {
        contentId: ids[1] ?? '',
        limit: 1,
      },
      undefined,
    );
    expect(remaining.content[0]?.text).toContain('nextOffset: 1');
  });
}
