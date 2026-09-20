// Throwaway custom-message UI inside real Pi, with isolated simulated execution.
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {Box, Text, truncateToWidth, type TUI} from '@earendil-works/pi-tui';
import {getEntries, replayResult} from './fixtures';
import {welcomeLines} from '../ui-direction/welcome';
import {entryComponent, expansionFor, expandAll} from './render';
import {LiveSession} from './live-session';

export default function sessionPrototype(pi: ExtensionAPI): void {
  const scene = process.env.PI_SESSION_SCENE ?? 'session';
  const entries = getEntries(scene);
  const states = entries.map(expansionFor);
  let host: TUI | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let removeInput: (() => void) | undefined;
  let globalExpanded = false;
  let replayDone = false;
  const live =
    scene === 'live' || scene === 'live-error'
      ? new LiveSession(() => host?.requestRender(), scene === 'live-error')
      : undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    removeInput?.();
    removeInput = undefined;
    live?.stop();
  };
  if (live)
    pi.registerMessageRenderer('session-live', (_message, options, theme) => {
      live.setExpanded(options.expanded);
      let content = live.component(theme);
      return {
        render(width) {
          content = live.component(theme);
          return content.render(width);
        },
        invalidate() {
          content.invalidate();
        },
        handleMouse: event => content.handleMouse(event),
      };
    });
  entries.forEach((entry, index) => {
    pi.registerMessageRenderer(
      `session-preview-${index}`,
      (_message, options, theme) => {
        if (options.expanded !== globalExpanded) {
          globalExpanded = options.expanded;
          states.forEach(state => expandAll(state, globalExpanded));
        }
        const state = states[index];
        if (!state) throw new Error('Missing expansion state');
        const box = new Box(1, 0);
        box.addChild(
          entryComponent(entry, state, theme, () => host?.requestRender()),
        );
        return box;
      },
    );
  });
  const status = (text: string) => {
    pi.registerMessageRenderer(
      'session-preview-status',
      (_m, _o, theme) => new Text(theme.fg('muted', text), 1, 0),
    );
    pi.sendMessage({
      customType: 'session-preview-status',
      content: text,
      display: true,
    });
  };
  function replay(ctx: ExtensionContext) {
    const thought = entries[1];
    const tool = entries[2];
    if (thought?.kind !== 'thoughts' || tool?.kind !== 'tool')
      throw new Error('Invalid replay scene');
    const started = Date.now();
    let toolShown = false;
    let lastSecond = -1;
    const cancel = () => {
      thought.running = false;
      tool.state = 'cancelled';
      tool.summary = 'Cancelled · no completion result';
      replayDone = true;
      stop();
      status('Response interrupted.');
      host?.requestRender();
    };
    removeInput = ctx.ui.onTerminalInput(data => {
      if (!replayDone && (data === '\u001b' || data === '\u0003')) {
        cancel();
        return {consume: true};
      }
      return undefined;
    });
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      if (seconds === lastSecond) return;
      lastSecond = seconds;
      thought.seconds = Math.min(seconds, 4);
      if (seconds >= 4) {
        thought.running = false;
        if (!toolShown) {
          toolShown = true;
          pi.sendMessage({
            customType: 'session-preview-2',
            content: '',
            display: true,
          });
        }
        tool.summary = `Running · ${seconds - 4}s`;
        tool.body = {
          kind: 'text',
          text: '[pass] preserves the cursor\nChecking pagination boundaries...',
        };
      }
      if (seconds >= 8) {
        Object.assign(tool, replayResult);
        replayDone = true;
        stop();
        status('8 tests passed. The cursor is preserved.');
      }
      host?.requestRender();
    }, 200);
  }
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setHeader((tui, theme) => {
      host = tui;
      return scene === 'welcome' || live
        ? {
            render: width =>
              live && !live.empty
                ? []
                : welcomeLines(theme, width, tui.terminal.rows),
            invalidate() {},
          }
        : new Text('', 0, 0);
    });
    if (live) {
      pi.sendMessage({customType: 'session-live', content: '', display: true});
      ctx.ui.setEditorText(
        '分页边界会出现重复结果. 请保留第一次出现的记录, 不要改变下一页游标, 并补测试.',
      );
      removeInput = ctx.ui.onTerminalInput(data => {
        if ((data === '\u001b' || data === '\u0003') && live.cancel())
          return {consume: true};
        return undefined;
      });
    }
    ctx.ui.setFooter((_tui, theme) => ({
      render: width => [
        truncateToWidth(
          theme.fg('muted', ' pi-stuff · fix/pagination-boundary'),
          width,
        ),
        truncateToWidth(
          theme.fg(
            'dim',
            ' gpt-5.4 · high                    ctrl+o expand/collapse',
          ),
          width,
        ),
      ],
      invalidate() {},
    }));
    entries.forEach((_entry, index) => {
      if (scene === 'replay' && index === 2) return;
      pi.sendMessage({
        customType: `session-preview-${index}`,
        content: '',
        display: true,
      });
    });
    if (scene === 'replay') replay(ctx);
  });
  // No provider request: live submissions drive the script; static scenes retain drafts.
  pi.on('input', (event, ctx) => {
    if (live) {
      live.submit(event.text);
      return {action: 'handled'};
    }
    ctx.ui.setEditorText(event.text);
    return {action: 'handled'};
  });
  pi.on('session_shutdown', () => stop());
}
