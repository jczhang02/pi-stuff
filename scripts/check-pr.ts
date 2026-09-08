import {Effect} from 'effect';
import {PREvent} from './contracts';
import {decodeEventJson, readText} from './parse';
import {FENCE, splitLines, trimWhitespace, WHITESPACE} from './text';

// Validate declarations only. Never execute or fetch PR-supplied text.
export const HEADINGS = [
  'Behavior and impact',
  'Approach and decisions',
  'Verification and reproduction',
  'Risk and review',
  'Related work',
] as const;
const REVIEW_FIELDS = [
  'Risk level',
  'Independent review',
  'Review evidence',
] as const;
const FIELD_PATTERN = `(${REVIEW_FIELDS.join('|')})`;
const BOLD_LABEL_WITH_COLON = new RegExp(`^\\*\\*${FIELD_PATTERN}:\\*\\*`);
const BOLD_LABEL = new RegExp(`^\\*\\*${FIELD_PATTERN}\\*\\*:`);
const DECLARATION = new RegExp(`^${FIELD_PATTERN}:[ \\t]*([^\\n]*)$`, 'gm');
const LIST_PREFIX = new RegExp(
  `^[${WHITESPACE}]*(?:[-*+][${WHITESPACE}]+(?:\\[[ xX]\\][${WHITESPACE}]*)?)?`,
);

function* linesWithFences(text: string): Generator<[string, boolean]> {
  let fence: string | undefined;
  for (const line of splitLines(text)) {
    const marker = FENCE.exec(line);
    if (marker) {
      const run = marker[1]!;
      if (!fence) fence = run;
      else if (
        run[0] === fence[0] &&
        run.length >= fence.length &&
        !trimWhitespace(marker[2]!)
      )
        fence = undefined;
      yield [line, true];
    } else yield [line, fence !== undefined];
  }
}

function substantive(text: string): boolean {
  for (let line of splitLines(text)) {
    if (FENCE.test(line) || /^#{1,6}[ \t]+/.test(line)) continue;
    line = trimWhitespace(line.replace(LIST_PREFIX, ''));
    // Peel balanced markup and one terminal punctuation mark, even between wrappers.
    let start = 0;
    let end = line.length;
    let punctuation = '';
    while (start < end) {
      const last = line[end - 1]!;
      if (!punctuation && '.!:：'.includes(last)) {
        punctuation = last;
        end--;
      }
      if (
        start + 1 >= end ||
        !'*_`'.includes(line[start]!) ||
        line[start] !== line[end - 1]
      )
        break;
      start++;
      end--;
    }
    if (start) line = trimWhitespace(line.slice(start, end)) + punctuation;
    if (!line || /^[^\p{L}\p{N}]+$/u.test(line)) continue;
    if (/^[\p{L}\p{N}_ /-]+[:：]$/u.test(line)) continue;
    // Python's ignore-case matching also treats dotted/dotless I as ASCII i.
    if (/^(?:N\/?A|none|TODO|TBD|not appl[iİı]cable)[.!]?$/i.test(line))
      continue;
    return true;
  }
  return false;
}

export function checkBody(input: string | null | undefined): string[] {
  if (input == null) return ['PR body must be text'];
  // Template comments are guidance, not submitted evidence.
  const body = input.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const sections = new Map<string, string[]>();
  const errors: string[] = [];
  let current: string | undefined;
  for (const [line, fenced] of linesWithFences(body)) {
    const heading = fenced ? null : /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading && heading[1]!.length <= 3) {
      current = heading[1]!.length === 3 ? heading[2]! : undefined;
      if (current !== undefined) {
        if (sections.has(current)) errors.push('duplicate PR section');
        sections.set(current, []);
      }
    } else if (current !== undefined) sections.get(current)!.push(line);
  }
  for (const heading of HEADINGS) {
    if (!substantive((sections.get(heading) ?? []).join('\n'))) {
      errors.push(`missing or empty section: ${heading}`);
    }
  }
  const review = [
    ...linesWithFences((sections.get('Risk and review') ?? []).join('\n')),
  ]
    .filter(([, fenced]) => !fenced)
    .map(([line]) =>
      line
        .replace(/^[-*+][ \t]+/, '')
        .replace(BOLD_LABEL_WITH_COLON, '$1:')
        .replace(BOLD_LABEL, '$1:'),
    )
    .join('\n');
  const declarations = [...review.matchAll(DECLARATION)];
  const values = new Map<string, string>();
  for (const field of REVIEW_FIELDS) {
    const matches = declarations
      .map((match, index) => ({match, index}))
      .filter(({match}) => match[1] === field);
    if (matches.length !== 1) errors.push(`include exactly one ${field} field`);
    else {
      const {match, index} = matches[0]!;
      const end = declarations[index + 1]?.index ?? review.length;
      const start = match.index + match[0].length - match[2]!.length;
      values.set(
        field,
        trimWhitespace(
          field === 'Review evidence' ? review.slice(start, end) : match[2]!,
        ),
      );
    }
  }
  const risk = values.get('Risk level') ?? '';
  const status = values.get('Independent review') ?? '';
  if (!['low', 'high'].includes(risk))
    errors.push('Risk level must be low or high');
  if (!['completed', 'not-required', 'waived'].includes(status)) {
    errors.push(
      'ready PRs need completed, not-required, or waived independent review',
    );
  }
  if (risk === 'high' && !['completed', 'waived'].includes(status)) {
    errors.push(
      'high-risk PRs need completed review or an explicitly authorized waiver',
    );
  }
  if (!substantive(values.get('Review evidence') ?? '')) {
    errors.push(
      'Review evidence must explain the review, exemption, or authorized waiver',
    );
  }
  return errors;
}

export function checkEvent(event: typeof PREvent.Type): string[] {
  if (!event?.pull_request) return ['event must contain a pull_request object'];
  const pr = event.pull_request;
  if (pr.draft == null) return ['pull_request.draft must be a boolean'];
  return pr.draft ? [] : checkBody(pr.body);
}

export function main(args = process.argv.slice(2)): number {
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    console.log('Usage: bun scripts/check-pr.ts [--body-file <path>]');
    return 0;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--body-file')) {
    console.error('Usage: bun scripts/check-pr.ts [--body-file <path>]');
    return 2;
  }
  let errors: string[];
  try {
    if (args[0] === '--body-file')
      errors = Effect.runSync(Effect.map(readText(args[1]!), checkBody));
    else if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      const eventPath = process.env.GITHUB_EVENT_PATH;
      if (!eventPath) throw new Error('missing event path');
      errors = Effect.runSync(
        Effect.map(
          Effect.flatMap(readText(eventPath), text =>
            decodeEventJson(text, PREvent),
          ),
          checkEvent,
        ),
      );
    } else {
      console.log('PR evidence: not applicable to this event.');
      return 0;
    }
  } catch (error) {
    // Do not echo arbitrary payloads or credential-bearing paths.
    console.error(
      `Cannot read PR evidence input (${error instanceof SyntaxError ? 'SyntaxError' : 'InputError'}).`,
    );
    return 1;
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    return 1;
  }
  console.log(
    'PR evidence structure passed (or PR is draft); claims still require review.',
  );
  return 0;
}

if (import.meta.main) process.exitCode = main();
