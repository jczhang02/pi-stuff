import {expect, test} from 'bun:test';
import {stripTerminalSequences, visibleWidth} from '@earendil-works/pi-tui';
import {getThemeByName} from '../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme';
import {icons, renderFleet, type FleetRow} from '../../src/subagent/ui/rows';

const rows: FleetRow[] = [
  {name: 'main', activity: 'bash', input: 0, output: 0, seconds: 0},
  {
    name: 'review_standards',
    activity: 'grep tests/system/pi-host.test.ts',
    input: 450700,
    output: 3500,
    seconds: 164,
  },
  {
    name: 'review_requirements',
    activity: 'read CONTRIBUTING.md',
    input: 476700,
    output: 3300,
    seconds: 164,
  },
  {
    name: 'review_tooling_docs',
    activity: 'read bun.lock',
    input: 1100000,
    output: 3400,
    seconds: 164,
  },
].map(row => ({...row, status: 'running'}));

for (const width of [50, 80, 140]) {
  test(`Fleet fields share terminal-cell columns at ${width} columns`, () => {
    const theme = getThemeByName('light');
    if (!theme) throw new Error('The pinned Pi light theme is unavailable');
    for (const sample of [
      rows,
      rows.map((row, index) => ({
        ...row,
        name: index === 2 ? '审查 e\u0301 源码' : row.name,
        input: index === 2 ? 999999 : row.input,
        output: index === 2 ? 476700 : row.output,
        seconds: index === 2 ? 90061 : row.seconds,
      })),
    ]) {
      const lines = renderFleet(sample, 2, width, theme)
        .slice(1)
        .map(stripTerminalSequences);
      for (const [index, line] of lines.entries()) {
        expect(visibleWidth(line)).toBe(width);
        const row = sample[index + 1]!;
        const nameStart = line.indexOf(row.name.slice(0, 2));
        expect(visibleWidth(line.slice(0, nameStart))).toBe(4);
        if (width >= 80) {
          const activityStart = line.indexOf(row.activity.split(' ')[0]!);
          expect(visibleWidth(line.slice(0, activityStart))).toBe(25);
        }
      }
      for (const icon of [icons.input, icons.output]) {
        const columns = lines.map(line => {
          expect(line).toContain(icon);
          return visibleWidth(line.slice(0, line.indexOf(icon)));
        });
        expect(new Set(columns).size).toBe(1);
      }
      const separators = lines.map(line =>
        [...line.matchAll(/ · /g)].map(match =>
          visibleWidth(line.slice(0, match.index)),
        ),
      );
      expect(separators[0]).toEqual(separators[1]);
      expect(separators[0]).toEqual(separators[2]);
    }
  });
}
