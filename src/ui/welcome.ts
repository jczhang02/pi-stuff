// Presentation adapted from pi-stuff-old 21b636ea, conversation-ui/welcome-header.ts.
// Copyright (c) 2026 JC Zhang. MIT License; see ../../LICENSE.
import type {ExtensionAPI, Theme} from '@earendil-works/pi-coding-agent';
import {homedir} from 'node:os';
import {stripVTControlCharacters} from 'node:util';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';

interface WelcomeInfo {
  model: string;
  provider: string;
  cwd: string;
  tools: number;
  skills: number;
  commands: number;
}

function welcomeLines(
  theme: Theme,
  width: number,
  rows: number,
  info: WelcomeInfo,
): string[] {
  if (width < 13) return [truncateToWidth('Pi Stuff', width)];
  const wide = width >= 82;
  const border = (text: string) => theme.fg('borderMuted', text);
  const center = (text: string, columns: number) => {
    const clipped = truncateToWidth(
      text,
      Math.max(0, columns - (wide ? 6 : 0)),
    );
    const padding = Math.max(0, columns - visibleWidth(clipped));
    return (
      ' '.repeat(Math.floor(padding / 2)) +
      clipped +
      ' '.repeat(Math.ceil(padding / 2))
    );
  };
  const row = (left: string, right = '') => {
    if (!wide) return border('│') + center(left, width - 2) + border('│');
    const rightWidth = width - 55;
    const text = ' ' + truncateToWidth(right, rightWidth - 2);
    return (
      border('│') +
      center(left, 52) +
      border('│') +
      text +
      ' '.repeat(rightWidth - visibleWidth(text)) +
      border('│')
    );
  };
  const logo = (
    !wide && (width < 48 || rows <= 18)
      ? ['█▀█ ', '█▀ █']
      : ['██████  ', '██  ██  ', '████  ██', '██    ██']
  ).map(text => theme.fg('accent', text));
  const leading = wide ? '───' : '─';
  const top =
    border('┌' + leading) +
    theme.bold(' Pi Stuff ') +
    border('─'.repeat(width - leading.length - 12) + '┐');
  const bottom = border('└' + '─'.repeat(width - 2) + '┘');
  const model = theme.fg('accent', info.model);
  if (!wide)
    return [
      top,
      row(theme.bold('Welcome back!')),
      row(''),
      ...logo.map(line => row(line)),
      row(''),
      row(model),
      row(theme.fg('muted', info.provider)),
      row(theme.fg('muted', info.cwd)),
      bottom,
    ];
  const loaded = [
    theme.bold('Loaded'),
    theme.fg('muted', `${info.commands} extension commands`),
    theme.fg('muted', `${info.tools} tools · ${info.skills} skills`),
  ];
  return [
    top,
    row('', theme.bold('Tips for getting started')),
    row(theme.bold('Welcome back!'), 'Type / to browse commands'),
    row('', border('─'.repeat(width - 57))),
    ...logo.map((line, index) => row(line, loaded[index] ?? '')),
    row(''),
    row(model + theme.fg('dim', ` · ${info.provider}`)),
    row(theme.fg('muted', info.cwd)),
    bottom,
  ];
}

export function registerWelcome(pi: ExtensionAPI): void {
  let visible = false;
  pi.on('message_start', () => {
    visible = false;
  });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    visible = !ctx.sessionManager
      .getBranch()
      .some(
        entry =>
          entry.type === 'message' ||
          entry.type === 'compaction' ||
          entry.type === 'branch_summary' ||
          (entry.type === 'custom_message' && entry.display),
      );
    const home = homedir();
    const cwd =
      ctx.cwd === home
        ? '~'
        : ctx.cwd.startsWith(`${home}/`)
          ? `~${ctx.cwd.slice(home.length)}`
          : ctx.cwd;
    ctx.ui.setHeader(tui => ({
      invalidate() {},
      render(width) {
        if (!visible) return [];
        const commands = pi.getCommands();
        return welcomeLines(ctx.ui.theme, width, tui.terminal.rows, {
          model: stripVTControlCharacters(
            ctx.model?.name || ctx.model?.id || 'No model selected',
          ).replace(/[\r\n\t]/gu, ' '),
          provider: stripVTControlCharacters(ctx.model?.provider ?? '').replace(
            /[\r\n\t]/gu,
            ' ',
          ),
          cwd: stripVTControlCharacters(cwd).replace(/[\r\n\t]/gu, ' '),
          tools: pi.getActiveTools().length,
          skills: commands.filter(command => command.source === 'skill').length,
          commands: commands.filter(command => command.source === 'extension')
            .length,
        });
      },
    }));
  });
}
