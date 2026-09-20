// Throwaway future tool presentation for the static catalog prototype.
// It deliberately renders fixture data only; no tool or provider is executed.
import {
  getLanguageFromPath,
  getMarkdownTheme,
  highlightCode,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  type Component,
  Markdown,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type {CatalogToolArgs, CatalogToolFixture} from './catalog-fixtures';

const PREVIEW_LINES = 3;
const BODY_INDENT = '    ';
const RESULT_INDENT = '  ⎿  ';
const LOCATION_WIDTH = 28;

type StatusColor = 'accent' | 'error' | 'success' | 'warning';

type GrepMatch = {
  readonly location: string;
  readonly path: string;
  readonly code: string;
};

type DiffLine = {
  readonly sign: '+' | '-';
  readonly line: string;
  readonly number?: number;
};

type WebSections = {
  readonly metadata: string[];
  readonly body: string[];
};

type ToolDetails = {
  readonly metadata: string[];
  readonly body: string[];
};

function addDiffLine(
  result: DiffLine[],
  sign: '+' | '-',
  line: string,
  number: number | undefined,
): void {
  if (number === undefined) result.push({sign, line});
  else result.push({sign, line, number});
}

function linesComponent(render: (width: number) => string[]): Component {
  return {
    render,
    invalidate() {
      // Fixture data is immutable and the layout is recalculated per width.
    },
  };
}

function textResult(fixture: CatalogToolFixture): string {
  return (
    fixture.result
      ?.filter(content => content.type === 'text')
      .map(content => content.text)
      .join('\n') ?? ''
  );
}

function imageMimes(fixture: CatalogToolFixture): readonly string[] {
  return (
    fixture.result
      ?.filter(content => content.type === 'image')
      .map(content => content.mimeType) ?? []
  );
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split(/\r?\n/u)
    .find(line => line.trim().length > 0)
    ?.trim();
}

function pathArg(args: CatalogToolArgs): string | undefined {
  return 'path' in args ? args.path : undefined;
}

function targetText(fixture: CatalogToolFixture): string {
  const args = fixture.args;
  switch (fixture.definition) {
    case 'read': {
      const path = pathArg(args) ?? '';
      if (
        !('offset' in args) ||
        (args.offset === undefined && args.limit === undefined)
      )
        return path;
      const start = args.offset ?? 1;
      const end = args.limit === undefined ? undefined : start + args.limit - 1;
      return `${path}:${start}${end === undefined ? '' : `-${end}`}`;
    }
    case 'write':
    case 'edit':
      return pathArg(args) ?? '';
    case 'bash':
      return 'command' in args ? args.command : '';
    case 'grep': {
      const pattern = 'pattern' in args ? args.pattern : '';
      const path = pathArg(args) ?? '.';
      const glob = 'glob' in args ? args.glob : undefined;
      return `/${pattern}/ in ${path}${glob === undefined ? '' : ` (${glob})`}`;
    }
    case 'find': {
      const pattern = 'pattern' in args ? args.pattern : '';
      return `${pattern} in ${pathArg(args) ?? '.'}`;
    }
    case 'ls':
      return pathArg(args) ?? '.';
    case 'generic':
      if (fixture.name === 'web_search' && 'queries' in args)
        return args.queries.join(' · ');
      if (fixture.name === 'fetch_content' && 'urls' in args)
        return args.urls.join(' · ');
      if (fixture.name === 'get_search_content' && 'contentId' in args) {
        const parts = [`contentId=${args.contentId}`];
        if (args.find !== undefined) parts.push(`find=${args.find}`);
        if (args.offset !== undefined) parts.push(`offset=${args.offset}`);
        if (args.limit !== undefined) parts.push(`limit=${args.limit}`);
        return parts.join(' · ');
      }
      return JSON.stringify(args);
  }
}

function statusColor(fixture: CatalogToolFixture): StatusColor {
  if (fixture.isError === true) return 'error';
  if (fixture.isPartial === true) return 'accent';
  if (isWebItemError(fixture)) return 'warning';
  return 'success';
}

function isWebFixture(fixture: CatalogToolFixture): boolean {
  return (
    fixture.definition === 'generic' &&
    (fixture.name === 'web_search' ||
      fixture.name === 'fetch_content' ||
      fixture.name === 'get_search_content')
  );
}

function webMetadata(text: string): WebSections {
  const metadata: string[] = [];
  const body: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (
      /^(?:item|contentId|offset|nextOffset|totalLength|truncated|moreMatches|position|provider|selection|fallback|source):/u.test(
        line,
      )
    ) {
      const separator = line.indexOf(':');
      metadata.push(
        separator < 0
          ? line
          : `${line.slice(0, separator)}=${line.slice(separator + 1).trim()}`,
      );
    } else {
      body.push(line);
    }
  }
  return {metadata, body};
}

function searchBody(lines: readonly string[]): string[] {
  const withoutQuery = lines.filter(line => !/^query:\s/u.test(line.trim()));
  const isPromoted = (line: string) =>
    /^(?:\d+\.\s|url:\s|snippet:\s|error:\s)/u.test(line.trim());
  const promoted = withoutQuery.filter(isPromoted);
  const hasUnknown = withoutQuery.some(
    line => line.trim().length > 0 && !isPromoted(line),
  );
  return promoted.length > 0 && !hasUnknown ? promoted : withoutQuery;
}

function metadataValue(
  metadata: readonly string[],
  key: string,
): string | undefined {
  return metadata
    .find(value => value.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

function isWebItemError(fixture: CatalogToolFixture): boolean {
  if (!isWebFixture(fixture)) return false;
  return webMetadata(textResult(fixture)).body.some(line =>
    line.trimStart().startsWith('error:'),
  );
}

function wrapIndented(text: string, width: number, indent: string): string[] {
  const available = Math.max(1, width - visibleWidth(indent));
  return wrapTextWithAnsi(text, available).map(line => `${indent}${line}`);
}

function plainLines(
  lines: readonly string[],
  theme: Theme,
  width: number,
  color: 'error' | 'toolOutput' = 'toolOutput',
): string[] {
  return lines.flatMap(line =>
    wrapIndented(theme.fg(color, line), width, BODY_INDENT),
  );
}

function markdownLines(
  markdown: string,
  theme: Theme,
  width: number,
): string[] {
  try {
    return new Markdown(markdown, 0, 0, getMarkdownTheme())
      .render(Math.max(1, width - visibleWidth(BODY_INDENT)))
      .map(line => `${BODY_INDENT}${line}`);
  } catch {
    return plainLines(markdown.split(/\r?\n/u), theme, width);
  }
}

function highlightedLines(
  source: string,
  path: string | undefined,
  theme: Theme,
): string[] {
  const normalized = source.replace(/\t/gu, '   ');
  const sourceLines = normalized.split(/\r?\n/u);
  const language = path === undefined ? undefined : getLanguageFromPath(path);
  if (language === undefined)
    return sourceLines.map(line => theme.fg('toolOutput', line));
  try {
    const highlighted = highlightCode(normalized, language);
    return sourceLines.map(
      (line, index) => highlighted[index] ?? theme.fg('toolOutput', line),
    );
  } catch {
    return sourceLines.map(line => theme.fg('toolOutput', line));
  }
}

function codeLines(
  source: string,
  path: string | undefined,
  startLine: number,
  theme: Theme,
  width: number,
): string[] {
  const lines = highlightedLines(source, path, theme);
  const lastLine = Math.max(startLine, startLine + lines.length - 1);
  const numberWidth = String(lastLine).length;
  const gutterWidth = numberWidth + 3;
  const contentWidth = Math.max(
    1,
    width - visibleWidth(BODY_INDENT) - gutterWidth,
  );
  return lines.flatMap((line, index) => {
    const wrapped = wrapTextWithAnsi(line, contentWidth);
    return wrapped.map((part, wrappedIndex) => {
      const lineNumber =
        wrappedIndex === 0
          ? String(startLine + index).padStart(numberWidth, ' ')
          : ' '.repeat(numberWidth);
      const gutter = theme.fg('muted', `${lineNumber} │ `);
      return `${BODY_INDENT}${gutter}${part}`;
    });
  });
}

function parseGrepLine(line: string): GrepMatch | undefined {
  const match = /^(.*?):(\d+)(?::(\d+))?:\s?(.*)$/u.exec(line);
  if (match === null || match[1] === undefined || match[2] === undefined)
    return undefined;
  const column = match[3] === undefined ? '' : `:${match[3]}`;
  return {
    location: `${match[1]}:${match[2]}${column}`,
    path: match[1],
    code: match[4] ?? '',
  };
}

function columnLines(
  matches: readonly GrepMatch[],
  theme: Theme,
  width: number,
): string[] {
  const locationWidth = Math.min(
    LOCATION_WIDTH,
    Math.max(12, width - visibleWidth(BODY_INDENT) - 8),
  );
  const contentWidth = Math.max(
    1,
    width - visibleWidth(BODY_INDENT) - locationWidth - 3,
  );
  return matches.flatMap(match => {
    const location = wrapTextWithAnsi(
      theme.fg('muted', match.location),
      locationWidth,
    );
    const language = getLanguageFromPath(match.path);
    const code =
      language === undefined
        ? theme.fg('toolOutput', match.code)
        : (highlightCode(match.code, language)[0] ??
          theme.fg('toolOutput', match.code));
    const codeLines = wrapTextWithAnsi(code, contentWidth);
    const rowCount = Math.max(location.length, codeLines.length);
    return Array.from({length: rowCount}, (_, index) => {
      const left = location[index] ?? '';
      const right = codeLines[index] ?? '';
      const paddedLeft = `${left}${' '.repeat(
        Math.max(0, locationWidth - visibleWidth(left)),
      )}`;
      return `${BODY_INDENT}${paddedLeft}${theme.fg('dim', ' │ ')}${right}`;
    });
  });
}

function editDiffLines(fixture: CatalogToolFixture): DiffLine[] {
  const args = fixture.args;
  if (!('edits' in args)) return [];
  let nextLine = fixture.details?.firstChangedLine;
  let firstBlock = true;
  const result: DiffLine[] = [];
  for (const edit of args.edits) {
    const oldLines = edit.oldText.split(/\r?\n/u);
    const newLines = edit.newText.split(/\r?\n/u);
    const baseLine = firstBlock ? nextLine : undefined;
    oldLines.forEach((line, index) => {
      addDiffLine(
        result,
        '-',
        line,
        baseLine === undefined ? undefined : baseLine + index,
      );
    });
    newLines.forEach((line, index) => {
      addDiffLine(
        result,
        '+',
        line,
        baseLine === undefined ? undefined : baseLine + index,
      );
    });
    nextLine = undefined;
    firstBlock = false;
  }
  return result;
}

function editLines(
  fixture: CatalogToolFixture,
  theme: Theme,
  width: number,
): string[] {
  const lines = editDiffLines(fixture);
  if (lines.length === 0 && fixture.details?.diff !== undefined)
    return plainLines(fixture.details.diff.split(/\r?\n/u), theme, width);
  const path = pathArg(fixture.args);
  const before = lines
    .filter(line => line.sign === '-')
    .map(line => line.line)
    .join('\n');
  const after = lines
    .filter(line => line.sign === '+')
    .map(line => line.line)
    .join('\n');
  const beforeCode = highlightedLines(before, path, theme);
  const afterCode = highlightedLines(after, path, theme);
  const numberWidth = lines.some(line => line.number !== undefined)
    ? Math.max(...lines.map(line => String(line.number ?? '').length))
    : 0;
  const prefixWidth = 2 + numberWidth + 1;
  const contentWidth = Math.max(
    1,
    width - visibleWidth(BODY_INDENT) - prefixWidth,
  );
  let beforeIndex = 0;
  let afterIndex = 0;
  return lines.flatMap(line => {
    const code =
      line.sign === '-' ? beforeCode[beforeIndex++] : afterCode[afterIndex++];
    const styledCode = code ?? theme.fg('toolOutput', line.line);
    const wrapped = wrapTextWithAnsi(styledCode, contentWidth);
    return wrapped.map((part, index) => {
      const number =
        line.number === undefined || index > 0
          ? ' '.repeat(numberWidth)
          : String(line.number).padStart(numberWidth, ' ');
      const sign = theme.fg(
        line.sign === '+' ? 'toolDiffAdded' : 'toolDiffRemoved',
        line.sign,
      );
      return `${BODY_INDENT}${sign} ${number} ${part}`;
    });
  });
}

function warningText(fixture: CatalogToolFixture): string[] {
  const details = fixture.details;
  if (details === undefined) return [];
  const warnings: string[] = [];
  if (details.fullOutputPath !== undefined)
    warnings.push(`Full output: ${details.fullOutputPath}`);
  if (details.matchLimitReached !== undefined)
    warnings.push(`Truncated: ${details.matchLimitReached} matches limit`);
  if (details.resultLimitReached !== undefined)
    warnings.push(`Truncated: ${details.resultLimitReached} results limit`);
  if (details.entryLimitReached !== undefined)
    warnings.push(`Truncated: ${details.entryLimitReached} entries limit`);
  if (details.linesTruncated === true)
    warnings.push('Truncated: some lines truncated');
  const truncation = details.truncation;
  if (truncation?.truncated === true) {
    if (
      truncation.truncatedBy === 'lines' &&
      truncation.outputLines !== undefined &&
      truncation.totalLines !== undefined
    ) {
      warnings.push(
        `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`,
      );
    } else if (truncation.outputLines !== undefined) {
      warnings.push(`Truncated: ${truncation.outputLines} lines shown`);
    } else {
      warnings.push('Truncated');
    }
  }
  return warnings;
}

function detailLines(
  fixture: CatalogToolFixture,
  theme: Theme,
  width: number,
): ToolDetails {
  const raw = textResult(fixture);
  const args = fixture.args;
  const imageLines = imageMimes(fixture).flatMap(mimeType =>
    wrapIndented(theme.fg('muted', `image: ${mimeType}`), width, BODY_INDENT),
  );
  if (fixture.isError === true) {
    return {
      metadata: [],
      body: [
        ...plainLines(raw.split(/\r?\n/u), theme, width, 'error'),
        ...imageLines,
      ],
    };
  }
  let metadata: string[] = [];
  let body: string[];
  switch (fixture.definition) {
    case 'read': {
      const path = pathArg(args);
      body =
        imageMimes(fixture).length > 0
          ? plainLines(raw.split(/\r?\n/u), theme, width)
          : codeLines(
              raw,
              path,
              'offset' in args ? (args.offset ?? 1) : 1,
              theme,
              width,
            );
      break;
    }
    case 'write':
      body = codeLines(
        'content' in args ? args.content : '',
        pathArg(args),
        1,
        theme,
        width,
      );
      break;
    case 'edit':
      body = editLines(fixture, theme, width);
      break;
    case 'grep': {
      const matches = raw
        .split(/\r?\n/u)
        .map(parseGrepLine)
        .filter((match): match is GrepMatch => match !== undefined);
      body =
        matches.length ===
        raw.split(/\r?\n/u).filter(line => line.length > 0).length
          ? columnLines(matches, theme, width)
          : plainLines(raw.split(/\r?\n/u), theme, width);
      break;
    }
    case 'find':
    case 'ls':
    case 'bash':
      body = plainLines(raw.split(/\r?\n/u), theme, width);
      break;
    case 'generic': {
      const parsed = webMetadata(raw);
      if (isWebFixture(fixture)) {
        metadata = parsed.metadata;
        const webBody =
          fixture.name === 'web_search' ? searchBody(parsed.body) : parsed.body;
        const webText = webBody.join('\n');
        body =
          fixture.name === 'fetch_content'
            ? markdownLines(webText.length > 0 ? webText : raw, theme, width)
            : plainLines(
                (webText.length > 0 ? webText : raw).split(/\r?\n/u),
                theme,
                width,
              );
      } else {
        body = plainLines(raw.split(/\r?\n/u), theme, width);
      }
      break;
    }
  }
  body.push(...imageLines);
  return {metadata, body};
}

function webSummary(fixture: CatalogToolFixture, raw: string): string {
  const sections = webMetadata(raw);
  const first = firstNonEmptyLine(sections.body.join('\n'));
  if (first?.startsWith('error:') === true) return `Item failed · ${first}`;
  if (fixture.name === 'web_search') {
    const count = sections.body.filter(line =>
      /^\d+\.\s/u.test(line.trim()),
    ).length;
    const provider = metadataValue(sections.metadata, 'provider');
    if (count > 0)
      return `${count} result${count === 1 ? '' : 's'}${provider === undefined ? '' : ` · ${provider}`}`;
  }
  if (fixture.name === 'fetch_content' || fixture.name === 'get_search_content')
    return 'Content retrieved';
  return first ?? 'Result';
}

function resultSummary(
  fixture: CatalogToolFixture,
  raw: string,
  body: readonly string[],
): string {
  const first = firstNonEmptyLine(raw);
  if (fixture.isError === true)
    return first === undefined ? 'Error' : `Error: ${first}`;
  if (fixture.isPartial === true)
    return first === undefined ? 'Running' : `Running · ${first}`;
  switch (fixture.definition) {
    case 'read':
      return imageMimes(fixture).length > 0
        ? (first ?? 'Image result')
        : `${raw.split(/\r?\n/u).length} lines`;
    case 'grep': {
      const count = raw.split(/\r?\n/u).filter(line => line.length > 0).length;
      return count === 0 ? 'No matches' : `${count} matches`;
    }
    case 'find':
      return `${raw.split(/\r?\n/u).filter(line => line.length > 0).length} paths`;
    case 'ls':
      return `${raw.split(/\r?\n/u).filter(line => line.length > 0).length} entries`;
    case 'bash':
      return first === undefined ? 'Success' : `Success · ${first}`;
    case 'write':
    case 'edit':
      return first ?? 'Completed';
    case 'generic':
      return isWebFixture(fixture)
        ? webSummary(fixture, raw)
        : (first ?? (body.length === 0 ? 'No result' : 'Result'));
  }
}

function metadataLines(
  metadata: readonly string[],
  theme: Theme,
  width: number,
): string[] {
  if (metadata.length === 0) return [];
  return wrapIndented(
    theme.fg('muted', metadata.join(' · ')),
    width,
    BODY_INDENT,
  );
}

export function renderFutureTool(
  fixture: CatalogToolFixture,
  theme: Theme,
  expanded: boolean,
): Component {
  return linesComponent(width => {
    const raw = textResult(fixture);
    const details = detailLines(fixture, theme, width);
    const body = expanded ? details.body : details.body.slice(0, PREVIEW_LINES);
    const remaining = details.body.length - body.length;
    const color = statusColor(fixture);
    const label =
      fixture.definition === 'generic'
        ? fixture.name
        : `${fixture.name.slice(0, 1).toUpperCase()}${fixture.name.slice(1)}`;
    const title = `${theme.fg(color, '•')} ${theme.bold(theme.fg('toolTitle', label))}(${theme.fg('text', targetText(fixture))})`;
    const lines = wrapTextWithAnsi(title, Math.max(1, width - 2)).map(
      (line, index) => `${index === 0 ? '' : '  '}${line}`,
    );
    const summary = theme.fg(color, resultSummary(fixture, raw, details.body));
    lines.push(...wrapIndented(summary, width, RESULT_INDENT));
    lines.push(...body);
    lines.push(...metadataLines(details.metadata, theme, width));
    if (!expanded && remaining > 0) {
      lines.push(
        ...wrapIndented(
          theme.fg('dim', `… ${remaining} more lines · Ctrl+O expand`),
          width,
          BODY_INDENT,
        ),
      );
    }
    for (const warning of warningText(fixture))
      lines.push(
        ...wrapIndented(
          theme.fg('warning', `[${warning}]`),
          width,
          BODY_INDENT,
        ),
      );
    return lines;
  });
}
