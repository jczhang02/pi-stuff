import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {Effect, Schema} from 'effect';
import {lstat} from 'node:fs/promises';
import type {NamingSettings} from './settings';

class NamingError extends Schema.TaggedError<NamingError>()('NamingError', {
  message: Schema.String,
}) {}

export function registerNaming(
  pi: ExtensionAPI,
  settings: NamingSettings = {},
) {
  let available = false;
  let opening: string | undefined;
  let lifetime = 0;
  let pending: AbortController | undefined;

  function invalidate() {
    pending?.abort();
    pending = undefined;
  }

  function dialogue(ctx: ExtensionContext) {
    return ctx.sessionManager
      .getBranch()
      .flatMap(entry => {
        if (entry.type !== 'message') return [];
        const message = entry.message;
        if (message.role !== 'user' && message.role !== 'assistant') return [];
        const content = message.content;
        return [
          Schema.is(Schema.String)(content)
            ? content
            : content
                .flatMap(block => (block.type === 'text' ? [block.text] : []))
                .join('\n'),
        ];
      })
      .join('\n');
  }

  async function generate(
    ctx: ExtensionContext,
    input: string,
    explicit: boolean,
  ) {
    invalidate();
    const request = new AbortController();
    pending = request;
    const origin = lifetime;
    const model = settings.model
      ? ctx.modelRegistry.find(settings.model.provider, settings.model.id)
      : ctx.model;
    if (!model) {
      pending = undefined;
      if (explicit)
        ctx.ui.notify(
          'Naming failed: model unavailable. Check naming.model and /reload.',
          'error',
        );
      return;
    }
    if (explicit) ctx.ui.setStatus('pi-stuff-naming', 'Naming...');
    await Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          ctx.modelRegistry.complete(
            model,
            {
              systemPrompt:
                'Return only a concise English session name in the form type: Action object. Describe the user task, not its progress. The user request takes precedence over an assistant misunderstanding.',
              messages: [{role: 'user', content: input, timestamp: Date.now()}],
            },
            {signal: request.signal},
          ),
        catch: () =>
          new NamingError({
            message: 'Naming failed. Existing name kept. Try /autoname again.',
          }),
      }).pipe(
        Effect.map(result => {
          if (origin !== lifetime) return;
          if (pending !== request) {
            if (explicit)
              ctx.ui.notify('Naming superseded. Existing name kept.', 'info');
            return;
          }
          if (result.stopReason !== 'stop') {
            if (explicit)
              ctx.ui.notify(
                'Naming failed. Existing name kept. Try /autoname again.',
                'error',
              );
            return;
          }
          const name = result.content
            .flatMap(block => (block.type === 'text' ? [block.text] : []))
            .join('')
            .trim();
          if (name) {
            pending = undefined;
            pi.setSessionName(name);
            if (explicit) ctx.ui.notify(`Session named: ${name}`, 'info');
          }
        }),
        Effect.catch(error =>
          Effect.sync(() => {
            if (explicit && origin === lifetime)
              ctx.ui.notify(
                pending === request
                  ? error.message
                  : 'Naming superseded. Existing name kept.',
                'error',
              );
          }),
        ),
      ),
    );
    if (origin === lifetime && (pending === request || pending === undefined)) {
      pending = undefined;
      if (explicit) ctx.ui.setStatus('pi-stuff-naming', undefined);
    }
  }

  pi.on('session_start', async (event, ctx) => {
    invalidate();
    lifetime++;
    opening = undefined;
    available = false;
    const session = ctx.sessionManager;
    const file = session.getSessionFile();
    const header = session.getHeader();
    if (
      ctx.mode !== 'tui' ||
      !file ||
      !header ||
      header.parentSession ||
      (event.reason !== 'startup' && event.reason !== 'new') ||
      session.getSessionName() ||
      session
        .getEntries()
        .some(
          entry =>
            entry.type !== 'model_change' &&
            entry.type !== 'thinking_level_change',
        )
    )
      return;
    available = await Effect.runPromise(
      Effect.tryPromise({
        try: () => lstat(file),
        catch: cause =>
          Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}))(cause),
      }).pipe(
        Effect.map(() => false),
        Effect.catch(missing => Effect.succeed(missing)),
      ),
    );
  });
  pi.on('input', event => {
    if (!available) return;
    if (opening !== undefined || event.source !== 'interactive') {
      available = false;
      return;
    }
    opening = event.text;
  });
  pi.on('session_info_changed', () => {
    available = false;
    invalidate();
  });
  pi.on('session_shutdown', () => {
    available = false;
    invalidate();
    lifetime++;
  });
  pi.registerCommand('autoname', {
    description: 'Generate a session name, optionally guided by a task hint',
    handler: async (hint, ctx) => {
      available = false;
      await generate(ctx, hint.trim() || dialogue(ctx), true);
    },
  });
  pi.on('agent_settled', (_event, ctx) => {
    if (!available || opening === undefined) return;
    available = false;
    const last = ctx.sessionManager
      .getBranch()
      .findLast(
        entry => entry.type === 'message' && entry.message.role === 'assistant',
      );
    if (
      last?.type !== 'message' ||
      last.message.role !== 'assistant' ||
      last.message.stopReason !== 'stop'
    )
      return;
    void generate(ctx, dialogue(ctx), false);
  });
}
