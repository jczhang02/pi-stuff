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

// Keep final-result cleanup stable across the Bun versions embedded in Pi.
// Pattern from chalk/ansi-regex at f338e1814144efb950276aac84135ff86b72dc8e,
// also used by Node v24.9.0's stripVTControlCharacters:
// https://github.com/chalk/ansi-regex/blob/f338e1814144efb950276aac84135ff86b72dc8e/index.js
/*
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
*/
const ANSI_SEQUENCE = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*' +
    '(?:(?:(?:(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]+)*' +
    '|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]*)*)?' +
    '(?:\\u0007|\\u001B\\u005C|\\u009C))' +
    '|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?' +
    '[\\dA-PR-TZcf-nq-uy=><~]))',
  'g',
);

function cleanResult(event: ToolResultEvent) {
  const content = event.content.map(block =>
    block.type === 'text'
      ? {...block, text: block.text.replace(ANSI_SEQUENCE, '')}
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
