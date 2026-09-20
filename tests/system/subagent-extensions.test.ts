import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const Admission = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(Schema.Struct({taskId: Schema.String})),
  }),
);

function lastToolText(request: ModelRequest) {
  const last = request.messages.at(-1);
  return last?.role === 'tool' && Schema.is(Schema.String)(last.content)
    ? last.content
    : '';
}

test('child extension exposure is filtered and sibling cancellation preserves separate retained content', async () => {
  const slowStarted = Promise.withResolvers<void>();
  const slowAborted = Promise.withResolvers<void>();
  const retained = Promise.withResolvers<void>();
  const readRetained = Promise.withResolvers<void>();
  let childContentId = '';
  let recovered = '';
  let filtered = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/slow') {
        slowStarted.resolve();
        return new Promise<Response>(resolve => {
          request.signal.addEventListener(
            'abort',
            () => {
              slowAborted.resolve();
              resolve(new Response(null, {status: 499}));
            },
            {once: true},
          );
        });
      }
      return new Response(
        new URL(request.url).pathname === '/child'
          ? 'CHILD_PRIVATE_CONTENT'
          : 'MAIN_PRIVATE_CONTENT',
      );
    },
  });
  let childStage = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'web',
    'fullscreen',
    async (request): Promise<FixtureReply | undefined> => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      const names = request.tools?.map(tool => tool.function.name).toSorted();
      filtered =
        JSON.stringify(names) ===
        JSON.stringify(['fetch_content', 'get_search_content', 'subagent']);
      if (history.includes('SLOW_EXTENSION_CHILD'))
        return {
          tool: 'fetch_content',
          arguments: JSON.stringify({urls: [`${server.url}slow`], mode: 'raw'}),
        };
      if (childStage++ === 0)
        return {
          tool: 'fetch_content',
          arguments: JSON.stringify({
            urls: [`${server.url}child`],
            mode: 'raw',
          }),
        };
      if (childStage === 2) {
        childContentId =
          /contentId: ([^\s]+)/.exec(lastToolText(request))?.[1] ?? '';
        retained.resolve();
        await readRetained.promise;
        return {
          tool: 'get_search_content',
          arguments: JSON.stringify({contentId: childContentId}),
        };
      }
      if (childStage === 3) {
        recovered = lastToolText(request);
        return {
          tool: 'subagent',
          arguments:
            '{"command":"finish","outcome":"fulfilled","text":"Separate extension content remained readable."}',
        };
      }
      return {text: 'Finished.'};
    },
  );
  try {
    const parent = await host.invoke(
      'fetch_content',
      JSON.stringify({urls: [`${server.url}parent`], mode: 'raw'}),
    );
    const parentId = /contentId: ([^\s]+)/.exec(parent)?.[1];
    expect(parentId).toBeDefined();
    const admitted = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'slow',
              prompt: 'SLOW_EXTENSION_CHILD',
              workspace: 'live',
              extensions: ['pi-stuff:web'],
              tools: ['subagent', 'fetch_content', 'get_search_content'],
            },
            {
              name: 'reader',
              prompt: 'RETAIN_EXTENSION_CHILD',
              workspace: 'live',
              extensions: ['pi-stuff:web'],
              tools: ['subagent', 'fetch_content', 'get_search_content'],
            },
          ],
        }),
      ),
    );
    await Promise.all([slowStarted.promise, retained.promise]);
    expect(filtered).toBe(true);
    expect(childContentId).not.toBe('');
    expect(
      await host.invoke(
        'get_search_content',
        JSON.stringify({contentId: childContentId}),
      ),
    ).toContain('fetch again');
    await host.invoke(
      'subagent',
      JSON.stringify({command: 'cancel', taskId: admitted.tasks[0]?.taskId}),
    );
    await slowAborted.promise;
    readRetained.resolve();
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'wait',
        taskId: admitted.tasks[1]?.taskId,
        timeoutMs: 5000,
      }),
    );
    expect(recovered).toContain('CHILD_PRIVATE_CONTENT');
    expect(
      await host.invoke(
        'get_search_content',
        JSON.stringify({contentId: parentId}),
      ),
    ).toContain('MAIN_PRIVATE_CONTENT');
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'unsafe',
              prompt: 'Must not start',
              extensions: ['arbitrary-global-factory'],
              workspace: 'live',
            },
          ],
        }),
      ),
    ).toContain('Unsupported child extension');
  } finally {
    readRetained.resolve();
    await host.close();
    await server.stop(true);
  }
}, 30000);
