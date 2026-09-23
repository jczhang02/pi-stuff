import type {Theme} from '@earendil-works/pi-coding-agent';

// Local corrections for Pi 0.85's built-in light palette on light backgrounds.
// Exclude sourced themes. Pi cannot distinguish an anonymous in-memory theme
// named light from the built-in; only matching original sequences are corrected.
export function readablePanelLines(
  lines: string[],
  theme: Pick<Theme, 'name' | 'sourcePath' | 'sourceInfo' | 'getColorMode'>,
): string[] {
  if (theme.name !== 'light' || theme.sourcePath || theme.sourceInfo)
    return lines;
  const replacements =
    theme.getColorMode() === 'truecolor'
      ? [
          ['\x1b[38;2;90;128;128m', '\x1b[38;2;66;101;101m'],
          ['\x1b[38;2;88;132;88m', '\x1b[38;2;63;105;63m'],
          ['\x1b[38;2;154;115;38m', '\x1b[38;2;127;91;25m'],
          ['\x1b[38;2;118;118;118m', '\x1b[38;2;108;108;108m'],
        ]
      : [
          ['\x1b[38;5;66m', '\x1b[38;5;23m'],
          ['\x1b[38;5;65m', '\x1b[38;5;22m'],
          ['\x1b[38;5;243m', '\x1b[38;5;242m'],
        ];
  return lines.map(line => {
    for (const [before, after] of replacements)
      if (before !== undefined && after !== undefined)
        line = line.replaceAll(before, after);
    return line;
  });
}
