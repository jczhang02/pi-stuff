// Throwaway custom-message UI inside real Pi, with isolated simulated execution.
import {watchFile, unwatchFile} from 'node:fs';
import {join} from 'node:path';
import {SettingsManager, getAgentDir} from '@earendil-works/pi-coding-agent';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {Box, Text, matchesKey, Key, type TUI} from '@earendil-works/pi-tui';
import {getEntries, replayResult} from './fixtures';
import {welcomeLines} from './welcome';
import {entryComponent, expansionFor, expandAll} from './render';
import {LiveSession} from './live-session';

export default function sessionPrototype(pi: ExtensionAPI): void {
  const scene = process.env.PI_SESSION_SCENE ?? 'session';
  const entries = getEntries(scene);
  const states = entries.map(expansionFor);
  let host: TUI | undefined;
  let hideThinking = true;
  let stopSettings: (() => void) | undefined;
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
        const content = entryComponent(entry, state, theme, () =>
          host?.requestRender(),
        );
        if (entry.kind === 'user' || entry.kind === 'aborted') return content;
        const box = new Box(1, 0);
        box.addChild(content);
        return box;
      },
    );
  });
  pi.registerMessageRenderer('session-preview-aborted', (_m, _o, theme) =>
    entryComponent(
      {kind: 'aborted'},
      expansionFor({kind: 'aborted'}),
      theme,
      () => host?.requestRender(),
    ),
  );
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
      pi.sendMessage({
        customType: 'session-preview-aborted',
        content: '',
        display: true,
      });
      host?.requestRender();
    };
    removeInput = ctx.ui.onTerminalInput(data => {
      if (
        !replayDone &&
        (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c')))
      ) {
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
    const settingsPath = join(getAgentDir(), 'settings.json');
    const readThinkingSetting = () => {
      const hidden = SettingsManager.create(ctx.cwd).getHideThinkingBlock();
      if (hidden === hideThinking) return;
      hideThinking = hidden;
      states.forEach(state => {
        if (state.thinking) state.open = !hidden;
      });
      live?.setThinkingHidden(hidden);
      host?.requestRender();
    };
    readThinkingSetting();
    // Observe Pi's own settings writes, including Ctrl+T and /settings, without intercepting keys.
    watchFile(settingsPath, {interval: 100}, readThinkingSetting);
    stopSettings = () => unwatchFile(settingsPath, readThinkingSetting);
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
        if (
          (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) &&
          live.cancel()
        )
          return {consume: true};
        return undefined;
      });
    }
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
  pi.on('session_shutdown', () => {
    stop();
    stopSettings?.();
  });
}
