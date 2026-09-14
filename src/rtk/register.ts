import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import {stripVTControlCharacters} from 'node:util';
import {isRtkCancellation, RtkRuntime} from './runtime';
import {rewriteCommand} from './rewrite';
import type {RtkSettings} from './settings';

const MAX_FAILURE_NOTICE_CHARS = 240;

function cleanResult(event: ToolResultEvent) {
  const content = event.content.map(block =>
    block.type === 'text'
      ? {...block, text: stripVTControlCharacters(block.text)}
      : block,
  );
  if (event.usage !== undefined)
    return {
      content,
      details: event.details,
      isError: event.isError,
      usage: event.usage,
    };
  return {content, details: event.details, isError: event.isError};
}

function failureNotice(message: string): string {
  const detail = stripVTControlCharacters(message).replace(/\s+/gu, ' ').trim();
  const bounded =
    detail.length > MAX_FAILURE_NOTICE_CHARS
      ? `${detail.slice(0, MAX_FAILURE_NOTICE_CHARS - 3)}...`
      : detail;
  return `RTK rewrite failed; leaving the original Bash command unchanged. ${
    bounded || 'RTK preparation failed.'
  } Run /rtk diagnostics for details.`;
}

export function registerRtk(
  pi: ExtensionAPI,
  settings: RtkSettings = {},
): RtkRuntime {
  const runtime = new RtkRuntime(settings);
  let notifiedFailure: string | undefined;

  const notifyFailure = (ctx: Pick<ExtensionContext, 'ui'>) => {
    const failure = runtime.lastFailure;
    if (failure === undefined || failure === notifiedFailure) return;
    notifiedFailure = failure;
    ctx.ui.notify(failureNotice(failure), 'error');
  };

  pi.on('session_start', () => {
    runtime.invalidate();
    notifiedFailure = undefined;
  });
  pi.on('tool_call', async (event, ctx) => {
    if (!isToolCallEventType('bash', event)) return;
    if (runtime.settings.rewrite === false) return;
    if (runtime.lastFailure === undefined) notifiedFailure = undefined;
    if (ctx.signal?.aborted)
      return {
        block: true,
        terminate: true,
        reason: 'RTK rewrite was cancelled.',
      };
    try {
      const rewritten = await rewriteCommand(
        runtime,
        event.input.command,
        ctx.cwd,
        ctx.signal,
      );
      if (ctx.signal?.aborted) {
        return {
          block: true,
          terminate: true,
          reason: 'RTK rewrite was cancelled.',
        };
      }
      notifyFailure(ctx);
      if (rewritten !== undefined) event.input.command = rewritten;
    } catch (error) {
      const caught =
        error instanceof Error ? error : new Error('RTK rewrite failed.');
      if (isRtkCancellation(caught) || ctx.signal?.aborted)
        return {
          block: true,
          terminate: true,
          reason: 'RTK rewrite was cancelled.',
        };
      notifyFailure(ctx);
      // Rewrite preparation is optional. The original Bash command remains
      // available when discovery or RTK itself fails.
    }
  });
  pi.on('tool_result', event =>
    runtime.settings.ansi === false ? undefined : cleanResult(event),
  );
  return runtime;
}
