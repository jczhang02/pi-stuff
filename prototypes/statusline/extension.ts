// Offline sample execution for the statusline prototype, inside the real Pi host.
import {setTimeout as delay} from 'node:timers/promises';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import type {AssistantMessage} from '@earendil-works/pi-ai';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Effect, Schema} from 'effect';
import {renderFooter} from './footer';

export default function statuslinePrototype(pi: ExtensionAPI): void {
  const scenario = Schema.decodeUnknownSync(
    Schema.Literals(['base', 'extended', 'long']),
  )(process.env.PI_STATUSLINE_SCENARIO);
  let completed = 0;
  let redraw = () => {};

  pi.registerProvider('statusline-sample', {
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-sample',
    models: [
      {
        id: 'gpt-6-astra',
        name: 'gpt-6-astra',
        reasoning: true,
        input: ['text'],
        contextWindow: 272000,
        maxTokens: 8192,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      },
    ],
    streamSimple(model, _context, options) {
      const stream = createAssistantMessageEventStream();
      const content = {type: 'text' as const, text: ''};
      const message: AssistantMessage = {
        role: 'assistant',
        content: [content],
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason: 'stop',
        usage: {
          input: 1000,
          output: 1000,
          cacheRead: 5173,
          cacheWrite: 0,
          totalTokens: 7173,
          cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
        },
      };
      // No request is sent. Timed chunks exercise Pi's native submit/cancel path.
      void Effect.runPromise(
        Effect.tryPromise({
          try: async () => {
            stream.push({type: 'start', partial: message});
            stream.push({
              type: 'text_start',
              contentIndex: 0,
              partial: message,
            });
            const chunks = [
              'The branch and working tree have been inspected.\n\n',
              'The checks passed. ',
              'Ready for review before committing.',
            ];
            for (const delta of chunks) {
              await delay(650, undefined, {signal: options?.signal});
              content.text += delta;
              stream.push({
                type: 'text_delta',
                contentIndex: 0,
                delta,
                partial: message,
              });
            }
            stream.push({
              type: 'text_end',
              contentIndex: 0,
              content: content.text,
              partial: message,
            });
            stream.push({type: 'done', reason: 'stop', message});
          },
          catch: error =>
            error instanceof Error ? error : new Error(String(error)),
        }).pipe(
          Effect.catch(error =>
            Effect.sync(() => {
              message.stopReason = options?.signal?.aborted
                ? 'aborted'
                : 'error';
              message.errorMessage = error.message;
              stream.push({
                type: 'error',
                reason: message.stopReason,
                error: message,
              });
            }),
          ),
        ),
      );
      return stream;
    },
  });

  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setFooter((tui, theme) => {
      redraw = () => tui.requestRender();
      return {
        render: width =>
          renderFooter(width, theme, {
            scenario,
            completed,
            model: ctx.model?.id ?? 'gpt-6-astra',
            thinking: pi.getThinkingLevel(),
          }),
        invalidate() {},
        dispose() {
          redraw = () => {};
        },
      };
    });
    pi.sendUserMessage('Show the current branch and run the checks.');
  });
  pi.on('message_end', event => {
    if (
      event.message.role === 'assistant' &&
      event.message.stopReason === 'stop'
    )
      completed += 1;
  });
  pi.on('agent_end', () => {
    redraw();
  });
}
