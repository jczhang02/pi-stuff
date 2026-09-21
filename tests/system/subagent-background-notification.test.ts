import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Run = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(Schema.Struct({id: Schema.String})),
});

for (const mode of [
  'background',
  'awaited',
  'awaited-per-task',
  'timed-out',
] as const) {
  test(`native parent receives a run completion notice for ${mode} work only when needed`, async () => {
    let release = Promise.withResolvers<void>();
    const notices: string[] = [];
    const host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      async request => {
        if (request.tools?.some(tool => tool.function.name === 'subagent')) {
          const last = request.messages.at(-1);
          const body = Schema.is(Schema.String)(last?.content)
            ? last.content
            : (last?.content?.map(part => part.text ?? '').join('') ?? '');
          if (
            body.includes('Subagent run completed') ||
            body.includes('researcher: completed')
          )
            notices.push(body);
          return undefined;
        }
        await release.promise;
        return {type: 'content', content: 'BACKGROUND_REPORT'};
      },
    );
    try {
      if (mode.startsWith('awaited')) release.resolve();
      const run = Schema.decodeUnknownSync(Run)(
        JSON.parse(
          await host.invoke(
            'subagent',
            JSON.stringify({
              command: 'dispatch',
              agent: 'researcher',
              task: 'Complete a background investigation.',
              notifyPerTask: mode === 'awaited-per-task',
              autoAwait: mode.startsWith('awaited'),
            }),
          ),
        ),
      );
      if (mode.startsWith('awaited')) {
        expect(run.status).toBe('completed');
        expect(notices).toEqual([]);
        expect(await host.terminal.screen.text()).not.toContain(
          'Subagent run completed',
        );
        expect(await host.terminal.screen.text()).not.toContain(
          'researcher: completed',
        );
      } else {
        if (mode === 'timed-out') {
          const waiting = Schema.decodeUnknownSync(Run)(
            JSON.parse(
              await host.invoke(
                'subagent',
                JSON.stringify({
                  command: 'wait',
                  runId: run.id,
                  timeoutMs: 1,
                }),
              ),
            ),
          );
          expect(waiting.status).toBe('running');
        }
        release.resolve();
        await host.terminal.screen.waitUntil(() => notices.length === 1, {
          timeoutMs: 5000,
        });
        expect(notices[0]).toContain('BACKGROUND_REPORT');
        await host.terminal.screen.waitForText('No additional action.', {
          timeoutMs: 5000,
        });
        if (mode === 'background') {
          release = Promise.withResolvers<void>();
          const continued = Schema.decodeUnknownSync(Run)(
            JSON.parse(
              await host.invoke(
                'subagent',
                JSON.stringify({
                  command: 'follow-up',
                  runId: run.id,
                  taskId: run.tasks[0]?.id,
                  message: 'Continue the investigation.',
                  autoAwait: false,
                }),
              ),
            ),
          );
          expect(continued.status).toBe('running');
          release.resolve();
          await host.terminal.screen.waitUntil(() => notices.length === 2, {
            timeoutMs: 5000,
          });
          expect(notices).toHaveLength(2);
        }
      }
    } finally {
      release.resolve();
      await host.close();
    }
  }, 60000);
}
