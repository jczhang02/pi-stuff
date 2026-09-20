import {truncateToWidth} from '@earendil-works/pi-tui';
import type {InspectSurface} from './types';
import {END_SCROLL_OFFSET} from './types';

export interface InspectionViewport {
  /** Total rows available to the inspection component after its outer frame. */
  readonly frameRows: number;
  /** Rows passed to a window, including its overflow indicator when needed. */
  readonly contentRows: number;
  /** Rows available for selected content when the window needs an indicator. */
  readonly revealRows: number;
}

/**
 * A targeted editor needs one row for the location, target identity, and
 * submit footer in addition to every row returned by the native editor.
 */
export function targetedMinimumRows(editorRows: number): number {
  return Math.max(1, editorRows) + 3;
}

/**
 * Keep the render window and selection reveal calculations on one geometry
 * budget. A window that overflows spends one row on its scroll indicator.
 */
export function inspectionViewport(
  terminalRows: number,
  surface: InspectSurface,
): InspectionViewport {
  const frameRows =
    surface === 'fleet'
      ? Math.min(11, Math.max(6, terminalRows - 5))
      : Math.max(6, terminalRows - 5);
  const contentRows = Math.max(1, frameRows - 3);
  return {
    frameRows,
    contentRows,
    revealRows: Math.max(1, contentRows - 1),
  };
}

export function windowLines(
  lines: readonly string[],
  offset: number,
  available: number,
  width: number,
  label: string,
): string[] {
  const normalized = lines.map(line => truncateToWidth(line, width, ''));
  if (normalized.length <= available) return normalized;
  const count = Math.max(1, available - 1);
  const maxStart = Math.max(0, normalized.length - count);
  const start = Math.max(
    0,
    offset >= END_SCROLL_OFFSET / 2
      ? maxStart - (END_SCROLL_OFFSET - offset)
      : Math.min(offset, maxStart),
  );
  const result = normalized.slice(start, start + count);
  if (available > 1)
    result.push(
      truncateToWidth(
        `${label} ${start + 1}-${start + result.length}/${normalized.length} · u/d scroll`,
        width,
        '',
      ),
    );
  return result;
}

export function revealOffset(
  range: readonly [number, number],
  currentOffset: number,
  available: number,
): number {
  if (range[0] < currentOffset) return Math.max(0, range[0]);
  if (range[1] >= currentOffset + available)
    return Math.max(0, range[1] - available + 1);
  return currentOffset;
}
