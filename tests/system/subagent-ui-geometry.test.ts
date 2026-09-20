import {expect, test} from 'bun:test';
import {stripVTControlCharacters} from 'node:util';
import {visibleWidth} from '@earendil-works/pi-tui';
import {Schema} from 'effect';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const AdmissionJson = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('accepted'),
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);
const InspectionJson = Schema.fromJsonString(
  Schema.Struct({
    agents: Schema.Array(
      Schema.Struct({id: Schema.String, name: Schema.String}),
    ),
  }),
);

type GeometryHost = Awaited<ReturnType<typeof launchPi>>;
type Frame = Awaited<ReturnType<GeometryHost['terminal']['screen']['frame']>>;
type Row = {readonly y: number; readonly text: string};

const fastNames = [
  'fast-01-短 🧪',
  `fast-02-${'long-name-'.repeat(8)}`,
  'fast-03-line\nbreak\tname',
  'fast-04-中文界面',
  'fast-05-usage',
  'fast-06-宽度',
  'fast-07-plain',
  'fast-08-plain',
  'fast-09-plain',
  'fast-10-plain',
  'fast-11-plain',
  'fast-12-plain',
  'fast-13-plain',
  'fast-14-plain',
  'fast-15-plain',
  'fast-16-plain',
  'fast-17-plain',
  'fast-18-plain',
  'fast-19-last',
] as const;

const usageOutputs = [
  9, 10, 99, 100, 999, 1000, 9999, 10000, 18, 19, 20, 101, 102, 1001, 1002,
  10001, 10002, 200, 2000, 20000,
] as const;

function screenLines(text: string): readonly string[] {
  return stripVTControlCharacters(text)
    .split(/\r?\n/u)
    .map(line => line.replace(/\s+$/u, ''))
    .filter(line => line.length > 0);
}

function rowsFromFrame(frame: Frame): readonly Row[] {
  const byY = new Map<number, string>();
  for (const cell of frame.cells) {
    byY.set(cell.y, `${byY.get(cell.y) ?? ''}${cell.text}`);
  }
  return [...byY.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([y, text]) => ({y, text: text.replace(/\s+$/u, '')}));
}

function rowHasAgentName(row: Row, names: readonly string[]): boolean {
  if (!/^[○●] /u.test(row.text.trimStart())) return false;
  return names.some(name => {
    const firstLine = name.replace(/[\r\n\t].*$/u, '');
    return row.text.includes(firstLine.slice(0, 12));
  });
}

function agentNamePrefix(row: Row, names: readonly string[]): string {
  const prefix = names
    .map(name => name.replace(/[\r\n\t].*$/u, '').slice(0, 12))
    .find(candidate => row.text.includes(candidate));
  if (prefix === undefined)
    throw new Error(`Agent name missing from row: ${row.text}`);
  return prefix;
}

function fieldStart(line: string, field: string): number {
  const index = line.indexOf(field);
  if (index < 0)
    throw new Error(`Field ${JSON.stringify(field)} missing: ${line}`);
  return visibleWidth(line.slice(0, index));
}

function modelFor(
  started: PromiseWithResolvers<void>,
  release: PromiseWithResolvers<void>,
): (request: ModelRequest) => Promise<FixtureReply | undefined> {
  return async request => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
    const marker = /UI_GEOMETRY_(?:ACTIVE|FAST_(\d+))/u.exec(history);
    if (marker === null) throw new Error('Geometry assignment marker missing.');
    const active = history.includes('UI_GEOMETRY_ACTIVE');
    const lastWasTool = request.messages.at(-1)?.role === 'tool';
    if (active && !lastWasTool) {
      started.resolve();
      await release.promise;
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: 'Active geometry assignment complete.',
        }),
        usage: {input: 10, output: 10000},
      };
    }
    if (lastWasTool)
      return {
        text: 'Delivered.',
        usage: {input: 0, output: 0},
      };
    const output =
      marker[1] === undefined
        ? 10000
        : (usageOutputs[Number(marker[1])] ?? 100 + Number(marker[1]));
    return {
      tool: 'subagent',
      arguments: JSON.stringify({
        command: 'finish',
        outcome: 'fulfilled',
        text: 'Fast geometry assignment complete.',
      }),
      usage: {input: 10 + output, output},
    };
  };
}

test('FleetView keeps twenty retained agents reachable with aligned compact rows', async () => {
  let host: GeometryHost | undefined;
  const geometryStarted = Promise.withResolvers<void>();
  const geometryRelease = Promise.withResolvers<void>();
  try {
    host = await launchPi(
      '{}',
      undefined,
      'subagent',
      'fullscreen',
      modelFor(geometryStarted, geometryRelease),
    );
    const activeAdmission = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'active-root',
              prompt: 'UI_GEOMETRY_ACTIVE',
              workspace: 'live',
            },
          ],
        }),
      ),
    );
    const active = activeAdmission.tasks[0];
    if (active === undefined)
      throw new Error('Active geometry task was not admitted.');
    await geometryStarted.promise;

    const queued = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId: active.agentId,
        text: 'UI_GEOMETRY_QUEUED_FOLLOWUP',
      }),
    );
    expect(queued).toContain('"status":"accepted"');

    const bulkAdmission = Schema.decodeUnknownSync(AdmissionJson)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: fastNames.map((name, index) => ({
            name,
            prompt: `UI_GEOMETRY_FAST_${index}`,
            workspace: 'live' as const,
          })),
        }),
      ),
    );
    expect(bulkAdmission.tasks).toHaveLength(19);
    const inspection = Schema.decodeUnknownSync(InspectionJson)(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(inspection.agents).toHaveLength(20);
    await host.terminal.screen.waitForIdle({
      timeoutMs: 15000,
      quietForMs: 300,
    });

    const compact = screenLines(await host.terminal.screen.text());
    const compactAgentRows = compact.filter(
      line =>
        /[○●] /.test(line) &&
        (line.includes('active-root') ||
          fastNames.some(name =>
            line.includes(name.replace(/[\r\n\t].*$/u, '').slice(0, 12)),
          )),
    );
    expect(compactAgentRows.length).toBeLessThanOrEqual(6);
    expect(compact.join('\n')).toContain('fast-03-line break name');
    expect(compact.join('\n')).not.toContain('UI_GEOMETRY_QUEUED_FOLLOWUP');

    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitUntil(
      screen => screen.text.includes('● main'),
      {timeoutMs: 5000},
    );
    let fleet = await host.terminal.screen.text();
    expect(fleet).toContain('● main');
    expect(fleet).toContain('active-root');
    expect(fleet).toContain('1-6 of 20 agents');
    expect(fleet).toContain('1 queued');
    const visibleFleetRows = screenLines(fleet).filter(
      line =>
        /^[○●] /u.test(line.trimStart()) &&
        (fastNames.some(name =>
          line.includes(name.replace(/[\r\n\t].*$/u, '').slice(0, 12)),
        ) ||
          line.includes('active-root')),
    );
    expect(visibleFleetRows.length).toBeLessThanOrEqual(6);

    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitUntil(
      screen => screen.text.includes('● fast-19-last'),
      {timeoutMs: 5000},
    );
    fleet = await host.terminal.screen.text();
    expect(fleet).toContain('● fast-19-last');
    expect(fleet).not.toContain('● main');
    expect(fleet).toContain('○ main');
    expect(fleet).toContain('15-20 of 20 agents');
    await host.terminal.keyboard.type('u');
    await host.terminal.screen.waitForText('● fast-16-plain', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('d');
    await host.terminal.screen.waitForText('● fast-19-last', {timeoutMs: 5000});

    await host.terminal.keyboard.type('k');
    await host.terminal.screen.waitUntil(
      screen => screen.text.includes('● fast-18-plain'),
      {timeoutMs: 5000},
    );
    fleet = await host.terminal.screen.text();
    expect(fleet).toContain('● fast-18-plain');
    await host.terminal.keyboard.type('j');
    await host.terminal.screen.waitUntil(
      screen => screen.text.includes('● fast-19-last'),
      {timeoutMs: 5000},
    );

    const frame = await host.terminal.screen.frame({
      settleMs: 100,
      deadlineMs: 5000,
    });
    const visibleAgentRows = rowsFromFrame(frame).filter(
      row =>
        rowHasAgentName(row, fastNames) || row.text.includes('active-root'),
    );
    expect(visibleAgentRows.length).toBeGreaterThan(1);
    const completedRows = visibleAgentRows.filter(row =>
      row.text.includes('Done'),
    );
    expect(completedRows.length).toBeGreaterThan(1);
    const markerPositions = visibleAgentRows.map(row => {
      const hollow = row.text.indexOf('○');
      const filled = row.text.indexOf('●');
      return hollow < 0
        ? filled
        : filled < 0
          ? hollow
          : Math.min(hollow, filled);
    });
    const namePositions = visibleAgentRows.map(row =>
      fieldStart(row.text, agentNamePrefix(row, fastNames)),
    );
    expect(new Set(markerPositions).size).toBe(1);
    expect(markerPositions.every(position => position >= 0)).toBe(true);
    expect(new Set(namePositions).size).toBe(1);
    const statePositions = completedRows.map(row =>
      fieldStart(row.text, 'Done'),
    );
    const durationPositions = completedRows.map(row => {
      const arrow = row.text.indexOf('↓');
      const prefix = row.text.slice(0, arrow);
      const matches = [...prefix.matchAll(/(?:—|\d+s|\d+m \d+s)/gu)];
      const duration = matches.at(-1);
      if (duration?.index === undefined)
        throw new Error(`Duration missing from row: ${row.text}`);
      return visibleWidth(prefix.slice(0, duration.index));
    });
    const arrowPositions = completedRows.map(row => fieldStart(row.text, '↓'));
    const suffixPositions = completedRows.map(row =>
      fieldStart(row.text, 'tokens'),
    );
    expect(new Set(statePositions).size).toBe(1);
    expect(new Set(durationPositions).size).toBe(1);
    expect(new Set(arrowPositions).size).toBe(1);
    expect(new Set(suffixPositions).size).toBe(1);
    const tokenFields = completedRows.map(row => {
      const arrow = row.text.indexOf('↓');
      const suffix = row.text.indexOf('tokens', arrow);
      return row.text.slice(arrow, suffix);
    });
    expect(new Set(tokenFields.map(field => field.length)).size).toBe(1);
    expect(new Set(tokenFields).size).toBeGreaterThan(1);
  } finally {
    geometryRelease.resolve();
    await host?.close();
  }
}, 60000);
