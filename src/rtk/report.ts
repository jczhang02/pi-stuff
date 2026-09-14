import {Effect, Schema} from 'effect';
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

export type PeriodStats = {
  commands: number;
  input_tokens: number;
  output_tokens: number;
  saved_tokens: number;
  savings_pct: number;
  total_time_ms: number;
  avg_time_ms: number;
};

export type DayStats = PeriodStats & {date: string};
export type WeekStats = PeriodStats & {week_start: string; week_end: string};
export type MonthStats = PeriodStats & {month: string};

const PeriodStatsSchema = Schema.Struct({
  commands: Schema.Int,
  input_tokens: Schema.Int,
  output_tokens: Schema.Int,
  saved_tokens: Schema.Int,
  savings_pct: Schema.Number,
  total_time_ms: Schema.Int,
  avg_time_ms: Schema.Int,
});

const SummarySchema = Schema.Struct({
  total_commands: Schema.Int,
  total_input: Schema.Int,
  total_output: Schema.Int,
  total_saved: Schema.Int,
  avg_savings_pct: Schema.Number,
  total_time_ms: Schema.Int,
  avg_time_ms: Schema.Int,
});

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

const GainReportSchema = Schema.Struct({
  summary: SummarySchema,
  daily: Schema.optional(Schema.Array(DayStatsSchema)),
  weekly: Schema.optional(Schema.Array(WeekStatsSchema)),
  monthly: Schema.optional(Schema.Array(MonthStatsSchema)),
});

export type Summary = typeof SummarySchema.Type;
export type GainReport = typeof GainReportSchema.Type;

export interface HistoryEntry {
  time: string;
  command: string;
  rate: number;
  saved: string;
}

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

const MAX_REPORT_LINES = 120;
const MAX_REPORT_LINE_LENGTH = 240;

export function clean(text: string): string {
  return stripVTControlCharacters(text);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function validPeriod(stats: PeriodStats): boolean {
  return (
    finiteNonNegative(stats.commands) &&
    finiteNonNegative(stats.input_tokens) &&
    finiteNonNegative(stats.output_tokens) &&
    finiteNonNegative(stats.saved_tokens) &&
    finiteNonNegative(stats.savings_pct) &&
    stats.savings_pct <= 100 &&
    finiteNonNegative(stats.total_time_ms) &&
    finiteNonNegative(stats.avg_time_ms)
  );
}

export function validSummary(summary: Summary): boolean {
  return (
    finiteNonNegative(summary.total_commands) &&
    finiteNonNegative(summary.total_input) &&
    finiteNonNegative(summary.total_output) &&
    finiteNonNegative(summary.total_saved) &&
    finiteNonNegative(summary.avg_savings_pct) &&
    summary.avg_savings_pct <= 100 &&
    finiteNonNegative(summary.total_time_ms) &&
    finiteNonNegative(summary.avg_time_ms)
  );
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

export function periodLabel(
  view: PeriodView,
  value: DayStats | WeekStats | MonthStats,
): string {
  if (view === 'Daily' && 'date' in value) return clean(value.date);
  if (view === 'Weekly' && 'week_start' in value)
    return `${clean(value.week_start)} - ${clean(value.week_end)}`;
  if ('month' in value) return clean(value.month);
  return 'Unknown period';
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

export function parseFailures(text: string): 'empty' | string | undefined {
  if (/No parse failures recorded\./u.test(text)) return 'empty';
  if (!/RTK Parse Failures/u.test(text)) return undefined;
  return text.trim();
}

export function boundedReportLines(text: string): string[] {
  const lines = text.split(/\r?\n/u).slice(0, MAX_REPORT_LINES);
  const bounded = lines.map(line => line.slice(0, MAX_REPORT_LINE_LENGTH));
  if (text.split(/\r?\n/u).length > MAX_REPORT_LINES)
    bounded.push('[report truncated]');
  return bounded;
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
    Schema.decodeUnknownEffect(Schema.fromJsonString(GainReportSchema))(text),
  ).catch(() => undefined);
}
