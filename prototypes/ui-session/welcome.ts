// Presentation adapted from pi-stuff-old 21b636ea, conversation-ui/welcome-header.ts.
// Copyright (c) 2026 JC Zhang. MIT License; see ../../LICENSE.
import type {Theme} from '@earendil-works/pi-coding-agent';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';

export function welcomeLines(
  theme: Theme,
  width: number,
  rows: number,
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
    border('╭' + leading) +
    theme.bold(' Pi Stuff ') +
    border('─'.repeat(width - leading.length - 12) + '╮');
  const bottom = border('╰' + '─'.repeat(width - 2) + '╯');
  const model = theme.fg('accent', 'gpt-5.4');
  if (!wide)
    return [
      top,
      row(theme.bold('Welcome back!')),
      row(''),
      ...logo.map(line => row(line)),
      row(''),
      row(model),
      row(theme.fg('muted', 'openai')),
      row(theme.fg('muted', '~/dev/pi-stuff')),
      bottom,
    ];
  const loaded = [
    theme.bold('Loaded'),
    theme.fg('muted', '4 extensions'),
    theme.fg('muted', '18 tools · 6 skills'),
  ];
  return [
    top,
    row('', theme.bold('Tips for getting started')),
    row(theme.bold('Welcome back!'), 'Type / to browse commands'),
    row('', border('─'.repeat(width - 57))),
    ...logo.map((line, index) => row(line, loaded[index] ?? '')),
    row(''),
    row(model + theme.fg('dim', ' · openai')),
    row(theme.fg('muted', '~/dev/pi-stuff')),
    bottom,
  ];
}
