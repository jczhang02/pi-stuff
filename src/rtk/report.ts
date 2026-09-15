import {Effect, Option, Schema} from 'effect';
import {stripVTControlCharacters} from 'node:util';

export type UsageScope = 'Global' | 'Project';
export type UsageViewKind =
  | 'Overview'
  | 'Daily'
  | 'Weekly'
  | 'Monthly'
  | 'History'
  | 'Failures';
export type PeriodView = 'Daily' | 'Weekly' | 'Monthly';

const NonNegativeNumberSchema = Schema.Finite.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);
const PercentageSchema = NonNegativeNumberSchema.pipe(
  Schema.check(Schema.isLessThanOrEqualTo(100)),
);

const PeriodStatsSchema = Schema.Struct({
  commands: Schema.Natural,
  input_tokens: Schema.Natural,
  output_tokens: Schema.Natural,
  saved_tokens: Schema.Natural,
  savings_pct: PercentageSchema,
  total_time_ms: Schema.Natural,
  avg_time_ms: Schema.Natural,
});

export type PeriodStats = typeof PeriodStatsSchema.Type;

const SummarySchema = Schema.Struct({
  total_commands: Schema.Natural,
  total_input: Schema.Natural,
  total_output: Schema.Natural,
  total_saved: Schema.Natural,
  avg_savings_pct: PercentageSchema,
  total_time_ms: Schema.Natural,
  avg_time_ms: Schema.Natural,
});

export type Summary = typeof SummarySchema.Type;

const DayStatsSchema = Schema.Struct({
  date: Schema.String,
  ...PeriodStatsSchema.fields,
});

const WeekStatsSchema = Schema.Struct({
  week_start: Schema.String,
  week_end: Schema.String,
  ...PeriodStatsSchema.fields,
});

const MonthStatsSchema = Schema.Struct({
  month: Schema.String,
  ...PeriodStatsSchema.fields,
});

export type DayStats = typeof DayStatsSchema.Type;
export type WeekStats = typeof WeekStatsSchema.Type;
export type MonthStats = typeof MonthStatsSchema.Type;

const PeriodRowSchema = Schema.Struct({
  label: Schema.String,
  ...PeriodStatsSchema.fields,
});

export type PeriodRow = typeof PeriodRowSchema.Type;

const GainReportSchema = Schema.Struct({
  summary: SummarySchema,
  daily: Schema.optional(Schema.Array(DayStatsSchema)),
  weekly: Schema.optional(Schema.Array(WeekStatsSchema)),
  monthly: Schema.optional(Schema.Array(MonthStatsSchema)),
});

export type GainReport = typeof GainReportSchema.Type;

export interface HistoryEntry {
  time: string;
  command: string;
  rate: number;
  saved: string;
}

const FailureEntrySchema = Schema.Struct({
  time: Schema.String,
  command: Schema.String,
  recovered: Schema.Boolean,
});

const FailureCommandSchema = Schema.Struct({
  command: Schema.String,
  count: Schema.Natural,
});

const FailureReportSchema = Schema.Struct({
  total: Schema.Natural,
  recoveryRate: PercentageSchema,
  recent: Schema.Array(FailureEntrySchema),
  topCommands: Schema.Array(FailureCommandSchema),
});

export type FailureReport = typeof FailureReportSchema.Type;

export const GAIN_VIEWS: readonly UsageViewKind[] = [
  'Overview',
  'Daily',
  'Weekly',
  'Monthly',
  'History',
  'Failures',
];

export const PERIOD_FIELDS: Readonly<
  Record<PeriodView, 'daily' | 'weekly' | 'monthly'>
> = {
  Daily: 'daily',
  Weekly: 'weekly',
  Monthly: 'monthly',
};

const EMPTY_FAILURE_REPORT = 'No parse failures recorded.';
const EMPTY_FAILURE_DETAIL =
  "This means all commands parsed successfully (or fallback hasn't triggered yet).";

export type UsageSnapshot =
  | {readonly kind: 'summary'; readonly summary: Summary}
  | {
      readonly kind: 'period';
      readonly view: PeriodView;
      readonly summary: Summary;
      readonly periods: readonly PeriodRow[];
    }
  | {readonly kind: 'history'; readonly history: readonly HistoryEntry[]}
  | {readonly kind: 'failures'; readonly failures: FailureReport};

export type UsageLoadOutcome =
  | {readonly state: 'ready'; readonly snapshot: UsageSnapshot}
  | {readonly state: 'empty'}
  | {readonly state: 'unsupported'; readonly message: string}
  | {readonly state: 'failure'; readonly message: string};

export function clean(text: string): string {
  return stripVTControlCharacters(text);
}

export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function compactDecimal(value: number, digits: number): string {
  return value
    .toFixed(digits)
    .replace(/\.0+$/u, '')
    .replace(/(\.\d*?)0+$/u, '$1');
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000)
    return `${compactDecimal(value / 1_000_000_000, 2)}B`;
  if (value >= 1_000_000) return `${compactDecimal(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `${compactDecimal(value / 1_000, 1)}k`;
  return formatCount(value);
}

export function formatPercent(value: number): string {
  return `${compactDecimal(value, 1)}%`;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function periodName(view: UsageViewKind): PeriodView | undefined {
  return view === 'Daily' || view === 'Weekly' || view === 'Monthly'
    ? view
    : undefined;
}

export function parseHistory(
  text: string,
): readonly HistoryEntry[] | 'empty' | undefined {
  const entries: HistoryEntry[] = [];
  const linePattern =
    /^\s*((?:\d{2,4}-)?\d{2}-\d{2}\s+\d{2}:\d{2})\s+(?:[▲■•]\s+)?(.+?)\s+-?(\d+(?:\.\d+)?)%\s+\(([^)]*)\)\s*$/u;
  for (const line of text.split(/\r?\n/u)) {
    const match = linePattern.exec(line);
    if (!match) continue;
    const time = match[1];
    const command = match[2];
    const rateText = match[3];
    const saved = match[4];
    if (
      time === undefined ||
      command === undefined ||
      rateText === undefined ||
      saved === undefined
    )
      return undefined;
    const rate = Number(rateText);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return undefined;
    entries.push({
      time: clean(time),
      command: clean(command),
      rate,
      saved: clean(saved),
    });
  }
  if (entries.length > 0) return entries.slice(0, 10);
  if (/No tracking data yet\./u.test(text)) return 'empty';
  return undefined;
}

export function parseFailures(
  text: string,
): 'empty' | FailureReport | undefined {
  const cleaned = clean(text);
  const lines = cleaned.split(/\r?\n/u);
  const nonEmptyLines = lines
    .map(line => line.trim())
    .filter(line => line !== '');
  if (
    (nonEmptyLines.length === 1 && nonEmptyLines[0] === EMPTY_FAILURE_REPORT) ||
    (nonEmptyLines.length === 2 &&
      nonEmptyLines[0] === EMPTY_FAILURE_REPORT &&
      nonEmptyLines[1] === EMPTY_FAILURE_DETAIL)
  )
    return 'empty';
  if (nonEmptyLines[0] !== 'RTK Parse Failures') return undefined;
  let total: number | undefined;
  let recoveryRate: number | undefined;
  let section: 'summary' | 'top' | 'recent' = 'summary';
  let separatorExpected = true;
  let blankLines: string[] = [];
  const topCommands: Array<typeof FailureCommandSchema.Type> = [];
  const recent: Array<typeof FailureEntrySchema.Type> = [];
  // RTK 0.45 prints two optional sections, each limited to ten records.
  // Commands may contain newlines; continuation lines belong to the last record.
  const titleIndex = lines.findIndex(
    line => line.trim() === 'RTK Parse Failures',
  );
  for (let index = titleIndex + 1; index < lines.length; index++) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.trim();
    if (line === '') {
      if (section !== 'summary') blankLines.push(rawLine);
      continue;
    }
    if (separatorExpected && /^[═─]+$/u.test(line)) {
      separatorExpected = false;
      continue;
    }
    separatorExpected = false;
    const sectionDivider = /^─+$/u.test(lines[index + 1]?.trim() ?? '');
    if (line === 'Top Commands (by frequency)' && sectionDivider) {
      if (section !== 'summary') return undefined;
      section = 'top';
      separatorExpected = true;
      blankLines = [];
      continue;
    }
    if (line === 'Recent Failures (last 10)' && sectionDivider) {
      if (section === 'recent') return undefined;
      section = 'recent';
      separatorExpected = true;
      blankLines = [];
      continue;
    }
    if (section === 'summary') {
      const count = /^Total failures:\s+(\d+)$/u.exec(line);
      const rate = /^Recovery rate:\s+(\d+(?:\.\d+)?)%$/u.exec(line);
      if (count && total === undefined) total = Number(count[1]);
      else if (rate && recoveryRate === undefined)
        recoveryRate = Number(rate[1]);
      else return undefined;
    } else if (section === 'top') {
      const match = /^\s*(\d+)x  (.+)$/u.exec(rawLine);
      if (match && match[2] !== undefined) {
        topCommands.push({count: Number(match[1]), command: match[2]});
        blankLines = [];
      } else {
        const previous = topCommands.at(-1);
        if (!previous || /^\d+x(?:\s|$)/u.test(line)) return undefined;
        topCommands[topCommands.length - 1] = {
          ...previous,
          command: [previous.command, ...blankLines, rawLine].join('\n'),
        };
        blankLines = [];
      }
    } else {
      const match =
        /^\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}) \[(ok|FAIL)\] (.+)$/u.exec(
          rawLine,
        );
      if (match && match[1] !== undefined && match[3] !== undefined) {
        recent.push({
          time: match[1],
          recovered: match[2] === 'ok',
          command: match[3],
        });
        blankLines = [];
      } else {
        const previous = recent.at(-1);
        if (!previous || /^\d{4}-\d{2}-\d{2}/u.test(line)) return undefined;
        recent[recent.length - 1] = {
          ...previous,
          command: [previous.command, ...blankLines, rawLine].join('\n'),
        };
        blankLines = [];
      }
    }
  }
  const report = Option.getOrUndefined(
    Schema.decodeUnknownOption(FailureReportSchema)({
      total,
      recoveryRate,
      topCommands,
      recent,
    }),
  );
  if (
    report === undefined ||
    report.total === 0 ||
    !Number.isSafeInteger(report.total) ||
    report.recent.length > Math.min(10, report.total) ||
    report.topCommands.length > 10 ||
    report.recent.length + report.topCommands.length === 0 ||
    report.topCommands.some(
      item =>
        !Number.isSafeInteger(item.count) ||
        item.count < 1 ||
        item.count > report.total,
    )
  )
    return undefined;
  return report;
}

export function reportArgs(view: UsageViewKind, scope: UsageScope): string[] {
  const scopeArgs =
    view === 'Failures' || scope === 'Global' ? [] : ['--project'];
  const period = periodName(view);
  const args =
    view === 'History'
      ? ['--history']
      : view === 'Failures'
        ? ['--failures']
        : period === undefined
          ? ['--format', 'json']
          : [`--${PERIOD_FIELDS[period]}`, '--format', 'json'];
  return ['gain', ...scopeArgs, ...args];
}

export async function decodeGainReport(
  text: string,
): Promise<GainReport | undefined> {
  return Effect.runPromise(
    Schema.decodeUnknownEffect(Schema.fromJsonString(GainReportSchema))(
      clean(text),
    ),
  ).catch(() => undefined);
}

function normalizedPeriodRows(
  report: GainReport,
  view: PeriodView,
): readonly PeriodRow[] | undefined {
  switch (view) {
    case 'Daily':
      return report.daily?.map(({date, ...stats}) => ({
        label: clean(date),
        ...stats,
      }));
    case 'Weekly':
      return report.weekly?.map(({week_start, week_end, ...stats}) => ({
        label: `${clean(week_start)} - ${clean(week_end)}`,
        ...stats,
      }));
    case 'Monthly':
      return report.monthly?.map(({month, ...stats}) => ({
        label: clean(month),
        ...stats,
      }));
  }
}

function reportFailure(view: UsageViewKind, stderr: string): UsageLoadOutcome {
  const detail = stderr.trim();
  return {
    state: 'failure',
    message: `RTK ${view.toLowerCase()} read failed${detail === '' ? '.' : `: ${detail.replace(/\s+/gu, ' ').slice(0, 200)}`}`,
  };
}

export async function decodeUsageReport(
  view: UsageViewKind,
  stdout: string,
  stderr: string,
  code: number,
): Promise<UsageLoadOutcome> {
  const output = clean(stdout);
  const error = clean(stderr);
  if (code !== 0) return reportFailure(view, error);

  if (view === 'History') {
    const history = parseHistory(output);
    if (history === 'empty') return {state: 'empty'};
    if (history === undefined)
      return {
        state: 'unsupported',
        message: 'RTK returned an unsupported history report.',
      };
    return {state: 'ready', snapshot: {kind: 'history', history}};
  }

  if (view === 'Failures') {
    const failures = parseFailures(output);
    if (failures === 'empty') return {state: 'empty'};
    if (failures === undefined)
      return {
        state: 'unsupported',
        message: 'RTK returned an unsupported parse-failure report.',
      };
    return {
      state: 'ready',
      snapshot: {kind: 'failures', failures},
    };
  }

  const report = await decodeGainReport(output);
  if (report === undefined)
    return {
      state: 'unsupported',
      message: 'RTK returned an unsupported JSON usage report.',
    };

  const period = periodName(view);
  if (period === undefined) {
    return report.summary.total_commands === 0
      ? {state: 'empty'}
      : {state: 'ready', snapshot: {kind: 'summary', summary: report.summary}};
  }

  const periods = normalizedPeriodRows(report, period);
  if (periods === undefined)
    return {
      state: 'unsupported',
      message: `RTK did not provide a native ${view.toLowerCase()} JSON report.`,
    };
  if (periods.length === 0) return {state: 'empty'};
  return {
    state: 'ready',
    snapshot: {
      kind: 'period',
      view: period,
      summary: report.summary,
      periods,
    },
  };
}
