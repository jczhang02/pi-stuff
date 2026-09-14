import type {Theme} from '@earendil-works/pi-coding-agent';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';

export function dataRow(
  theme: Theme,
  label: string,
  value: string,
  width: number,
) {
  const size = Math.min(width, 72);
  const left = `  ${theme.fg('muted', label)}`;
  const gap = Math.max(2, size - visibleWidth(left) - visibleWidth(value));
  return truncateToWidth(
    `${left}${theme.fg('dim', gap >= 5 ? ` ${'.'.repeat(gap - 2)} ` : ' '.repeat(gap))}${value}`,
    width,
    '...',
  );
}
