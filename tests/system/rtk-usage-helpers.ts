import {expect} from 'bun:test';
import type {Frame} from '@kitlangton/terminal-control';
import type {launchPi} from './fixtures/pi-terminal';

type Terminal = Awaited<ReturnType<typeof launchPi>>['terminal'];

function isUsageControlLine(value: string): boolean {
  return (
    value === '' ||
    /^(?:→\s*)?(?:Scope|View)\s+/u.test(value) ||
    value === 'Global statistics or this working directory.' ||
    value === 'Native RTK gain report.' ||
    value.includes('Navigate · Enter Change · r Refresh · Esc Back')
  );
}

export function reportBody(screen: string): string {
  const lines = screen.split(/\r?\n/u);
  const title = lines.findIndex(line => line.includes('RTK / Usage'));
  const report = lines.findIndex(
    (line, index) =>
      index > title && !isUsageControlLine(line.trim()) && line.trim() !== '',
  );
  const page = lines.findIndex(
    (line, index) => index > report && /Page \d+\/\d+/u.test(line),
  );
  return report < 0 || page < 0 ? '' : lines.slice(report, page).join('\n');
}

export function pageNumber(screen: string) {
  const match = /Page (\d+)\/(\d+)/u.exec(screen);
  if (match === null || match[1] === undefined || match[2] === undefined)
    throw new Error('The Usage report did not render a page marker.');
  return {current: Number(match[1]), total: Number(match[2])};
}

export async function collectReportPages(
  terminal: Terminal,
): Promise<string[]> {
  const pages: string[] = [];
  for (;;) {
    const screen = await terminal.screen.text();
    pages.push(reportBody(screen));
    const page = pageNumber(screen);
    if (page.current >= page.total) return pages;
    await terminal.keyboard.type(']');
    await terminal.screen.waitForText(
      new RegExp(`Page ${page.current + 1}\\/\\d+`, 'u'),
      {timeoutMs: 5000},
    );
  }
}

export async function goToFirstReportPage(terminal: Terminal): Promise<void> {
  const page = pageNumber(await terminal.screen.text());
  if (page.current === 1) return;
  await terminal.keyboard.type('['.repeat(page.current - 1));
  await terminal.screen.waitForText(/Page 1\/\d+/u, {timeoutMs: 5000});
}

export function reportContent(pages: readonly string[]): string {
  return pages
    .map(page =>
      page
        .split(/\r?\n/u)
        .filter(line => {
          const value = line.trim();
          return (
            !isUsageControlLine(value) &&
            value !== 'Recent commands' &&
            !/^Time\s+Command\s+Saved\s+Rate$/u.test(value) &&
            !value.startsWith('Parse failures · ') &&
            !/^Global · \d+ failures · /u.test(value) &&
            !/^Time\s+Fallback\s+Command$/u.test(value) &&
            !/^Command\s+Count$/u.test(value)
          );
        })
        .join('\n'),
    )
    .join('\n');
}

export function panelHeight(frame: Frame): number {
  const rows = new Map<number, string>();
  for (const cell of frame.cells)
    rows.set(cell.y, `${rows.get(cell.y) ?? ''}${cell.text}`);
  const titleRow = [...rows.entries()].find(([, text]) =>
    text.includes('RTK / Usage'),
  )?.[0];
  if (titleRow === undefined) throw new Error('The Usage title is missing.');
  const borderRows = [...rows.entries()]
    .filter(
      ([row, text]) =>
        row !== titleRow &&
        /^─+$/u.test(text.trim()) &&
        text.trim().length >= Math.min(frame.cols, 20),
    )
    .map(([row]) => row);
  const top = borderRows.filter(row => row < titleRow).at(-1);
  const bottom = borderRows.find(row => row > titleRow);
  if (top === undefined || bottom === undefined)
    throw new Error('The Usage panel borders are missing.');
  return bottom - top + 1;
}

export function foregroundFor(frame: Frame, value: string): string {
  const rows = new Map<number, Frame['cells']>();
  for (const cell of frame.cells)
    rows.set(cell.y, [...(rows.get(cell.y) ?? []), cell]);
  for (const cells of rows.values()) {
    cells.sort((left, right) => left.x - right.x);
    const text = cells.map(cell => cell.text).join('');
    const start = text.indexOf(value);
    if (start < 0) continue;
    let offset = 0;
    for (const cell of cells) {
      if (start >= offset && start < offset + cell.text.length)
        return JSON.stringify(cell.foreground);
      offset += cell.text.length;
    }
  }
  throw new Error(`The Usage report does not contain ${value}.`);
}

export function expectUsageLayout(
  screen: string,
  reportHeader: string,
  description: string,
): void {
  const lines = screen.split(/\r?\n/u);
  const title = lines.findIndex(line => line.includes('RTK / Usage'));
  const scope = lines.findIndex(
    (line, index) => index > title && /\bScope\b/u.test(line),
  );
  const view = lines.findIndex(
    (line, index) => index > scope && /\bView\b/u.test(line),
  );
  const descriptionLine = lines.findIndex(
    (line, index) => index > view && line.includes(description),
  );
  const report = lines.findIndex(
    (line, index) => index > descriptionLine && line.includes(reportHeader),
  );
  const page = lines.findIndex(
    (line, index) => index > report && /Page \d+\/\d+/u.test(line),
  );
  const hint = lines.findIndex(
    (line, index) =>
      index > page && line.includes('r Refresh') && line.includes('Esc Back'),
  );

  expect(title).toBeGreaterThanOrEqual(0);
  expect(scope).toBeGreaterThan(title);
  expect(view).toBeGreaterThan(scope);
  expect(descriptionLine).toBeGreaterThan(view);
  expect(report).toBeGreaterThan(descriptionLine);
  expect(page).toBeGreaterThan(report);
  expect(hint).toBeGreaterThan(page);
  expect(screen).not.toContain('Display');
}
