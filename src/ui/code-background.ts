import {fileURLToPath} from 'node:url';
import type {Theme} from '@earendil-works/pi-coding-agent';

// Correct the faint stock fills only in the palettes we own or have verified.
// Sourced custom themes and indexed-color terminals retain their colors.
// Like native panel corrections, anonymous stock-name copies are indistinguishable.
const fills = new Map([
  ['\x1b[48;2;40;50;40m', '\x1b[48;2;32;60;42m'],
  ['\x1b[48;2;60;40;40m', '\x1b[48;2;76;36;42m'],
  ['\x1b[48;2;232;240;232m', '\x1b[48;2;212;245;208m'],
  ['\x1b[48;2;240;232;232m', '\x1b[48;2;255;214;220m'],
  ['\x1b[48;2;218;231;221m', '\x1b[48;2;212;245;208m'],
  ['\x1b[48;2;236;214;222m', '\x1b[48;2;255;214;220m'],
]);
const lattePath = fileURLToPath(
  new URL('../../themes/catppuccin-latte.json', import.meta.url),
);

export function codeBackground(theme: Theme, added: boolean, text: string) {
  const color = added ? 'toolSuccessBg' : 'toolErrorBg';
  const stock =
    (!theme.sourcePath &&
      !theme.sourceInfo &&
      (theme.name === 'dark' || theme.name === 'light')) ||
    theme.sourcePath === lattePath;
  const ansi = theme.getBgAnsi(color);
  const replacement = stock ? fills.get(ansi) : undefined;
  const painted = theme.bg(color, text);
  return replacement ? painted.replaceAll(ansi, replacement) : painted;
}
