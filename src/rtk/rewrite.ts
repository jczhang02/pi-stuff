import {isRtkCancellation, type RtkRuntime} from './runtime';

interface WordToken {
  kind: 'word';
  start: number;
  end: number;
  plain: boolean;
  value: string;
}

interface OperatorToken {
  kind: 'operator';
  start: number;
  end: number;
  boundary: boolean;
  redirection: boolean;
  unsafe: boolean;
}

type ShellToken = WordToken | OperatorToken;

interface ScanResult {
  safe: boolean;
  tokens: ShellToken[];
}

interface BindingResult {
  safe: boolean;
  invocation: boolean;
  spans: Array<{start: number; end: number}>;
}

const COMMAND_WRAPPERS = new Set([
  'case',
  'coproc',
  'do',
  'elif',
  'else',
  'esac',
  'fi',
  'for',
  'function',
  'if',
  'select',
  'then',
  'time',
  'until',
  'while',
  '[[',
  ']]',
]);

function operatorAt(command: string, index: number): OperatorToken | undefined {
  const rest = command.slice(index);
  if (rest.startsWith('<<<'))
    return {
      kind: 'operator',
      start: index,
      end: index + 3,
      boundary: false,
      redirection: true,
      unsafe: true,
    };
  if (rest.startsWith('<<'))
    return {
      kind: 'operator',
      start: index,
      end: index + 2,
      boundary: false,
      redirection: true,
      unsafe: true,
    };
  if (rest.startsWith('&&') || rest.startsWith('||') || rest.startsWith('|&'))
    return {
      kind: 'operator',
      start: index,
      end: index + 2,
      boundary: true,
      redirection: false,
      unsafe: false,
    };
  if (rest.startsWith('>&') || rest.startsWith('<&') || rest.startsWith('&>'))
    return {
      kind: 'operator',
      start: index,
      end: index + 2,
      boundary: false,
      redirection: true,
      unsafe: false,
    };
  if (';|&><'.includes(command[index] ?? ''))
    return {
      kind: 'operator',
      start: index,
      end: index + 1,
      boundary: ';|&'.includes(command[index] ?? ''),
      redirection: '><'.includes(command[index] ?? ''),
      unsafe: false,
    };
  if (command[index] === '\n')
    return {
      kind: 'operator',
      start: index,
      end: index + 1,
      boundary: true,
      redirection: false,
      unsafe: false,
    };
  if ('(){}'.includes(command[index] ?? ''))
    return {
      kind: 'operator',
      start: index,
      end: index + 1,
      boundary: false,
      redirection: false,
      unsafe: true,
    };
  return undefined;
}

function scan(command: string): ScanResult {
  const tokens: ShellToken[] = [];
  let safe = true;
  let index = 0;
  let atTokenStart = true;
  while (index < command.length) {
    const character = command[index];
    if (character === ' ' || character === '\t' || character === '\r') {
      index++;
      atTokenStart = true;
      continue;
    }
    if (character === '\n') {
      tokens.push({
        kind: 'operator',
        start: index,
        end: index + 1,
        boundary: true,
        redirection: false,
        unsafe: false,
      });
      index++;
      atTokenStart = true;
      continue;
    }
    if (character === '#' && atTokenStart) {
      index++;
      while (index < command.length && command[index] !== '\n') index++;
      continue;
    }
    const operator = operatorAt(command, index);
    if (operator) {
      tokens.push(operator);
      safe = safe && !operator.unsafe;
      index = operator.end;
      atTokenStart = true;
      continue;
    }

    const start = index;
    const value: string[] = [];
    let plain = true;
    while (index < command.length) {
      const current = command[index];
      if (
        current === ' ' ||
        current === '\t' ||
        current === '\r' ||
        current === '\n' ||
        operatorAt(command, index)
      )
        break;
      if (current === "'") {
        plain = false;
        index++;
        while (index < command.length && command[index] !== "'") {
          value.push(command[index] ?? '');
          index++;
        }
        if (index >= command.length) {
          safe = false;
          break;
        }
        index++;
        continue;
      }
      if (current === '"') {
        plain = false;
        index++;
        while (index < command.length && command[index] !== '"') {
          if (command[index] === '\\') {
            const escaped = command[index + 1];
            if (escaped !== undefined && '$`"\\\n'.includes(escaped)) {
              if (escaped !== '\n') value.push(escaped);
              index += 2;
            } else {
              value.push('\\');
              index++;
            }
            continue;
          }
          if (command[index] === '$' || command[index] === '`') safe = false;
          value.push(command[index] ?? '');
          index++;
        }
        if (index >= command.length) {
          safe = false;
          break;
        }
        index++;
        continue;
      }
      if (current === '\\') {
        plain = false;
        if (command[index + 1] !== '\n') value.push(command[index + 1] ?? '');
        index += 2;
        if (index > command.length) safe = false;
        continue;
      }
      if (current === '$' || current === '`') {
        plain = false;
        safe = false;
      }
      value.push(current ?? '');
      index++;
    }
    tokens.push({
      kind: 'word',
      start,
      end: index,
      plain,
      value: value.join(''),
    });
    atTokenStart = false;
  }
  return {safe, tokens};
}

function isAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function isFileDescriptor(value: string): boolean {
  return /^\d+$/u.test(value);
}

function bindings(command: string): BindingResult {
  const result = scan(command);
  const spans: Array<{start: number; end: number}> = [];
  let invocation = false;
  let commandStart = true;
  let directRtk = false;
  let redirectionTarget = false;
  for (let index = 0; index < result.tokens.length; index++) {
    const token = result.tokens[index];
    if (token === undefined) continue;
    if (token.kind === 'operator') {
      if (token.unsafe) return {safe: false, invocation, spans};
      if (token.boundary) {
        commandStart = true;
        directRtk = false;
        redirectionTarget = false;
      } else if (token.redirection) {
        redirectionTarget = true;
      }
      continue;
    }
    if (redirectionTarget) {
      redirectionTarget = false;
      continue;
    }
    const rtk =
      token.value === 'rtk' ||
      (isAbsolute(token.value) && basename(token.value) === 'rtk');
    if (!commandStart) {
      // An unknown wrapper may execute this token. Never accept a partial
      // binding, but keep literal RTK arguments of a known RTK invocation.
      if (rtk && !directRtk) return {safe: false, invocation, spans: []};
      continue;
    }
    const next = result.tokens[index + 1];
    if (
      token.plain &&
      isFileDescriptor(token.value) &&
      next?.kind === 'operator' &&
      next.redirection
    )
      continue;
    if (token.plain && isAssignment(token.value)) continue;
    if (token.plain && COMMAND_WRAPPERS.has(token.value))
      return {safe: false, invocation, spans: []};
    if (token.plain && token.value === '!') continue;
    if (rtk) {
      invocation = true;
      spans.push({start: token.start, end: token.end});
    }
    directRtk = rtk;
    commandStart = false;
  }
  return {safe: result.safe, invocation, spans};
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/');
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

function shellQuote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

export function hasRtkInvocation(command: string): boolean {
  return bindings(command).invocation;
}

export function isSafeShellCommand(command: string): boolean {
  return bindings(command).safe;
}

export function bindRtkExecutable(
  command: string,
  executable: string,
): string | undefined {
  const result = bindings(command);
  if (!result.safe || result.spans.length === 0) return undefined;
  const quoted = shellQuote(executable);
  let output = '';
  let position = 0;
  for (const span of result.spans) {
    output += command.slice(position, span.start);
    output += quoted;
    position = span.end;
  }
  return output + command.slice(position);
}

export async function rewriteCommand(
  runtime: RtkRuntime,
  command: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (hasRtkInvocation(command)) return undefined;
  if (!isSafeShellCommand(command)) return undefined;
  try {
    const result = await runtime.execute(['rewrite', command], cwd, signal);
    if (result.code === 1 || result.code === 2) return undefined;
    if (result.code !== 0 && result.code !== 3) {
      const detail = result.stderr.trim();
      runtime.recordFailure(
        detail
          ? `RTK exited with code ${result.code}: ${detail}`
          : `RTK exited with code ${result.code}.`,
      );
      return undefined;
    }
    const rewritten = result.stdout;
    if (!rewritten) {
      runtime.recordFailure('RTK rewrite returned no command.');
      return undefined;
    }
    if (rewritten === command) return undefined;
    const bound = bindRtkExecutable(rewritten, result.path);
    if (!bound) {
      runtime.recordFailure('RTK rewrite returned an unsafe command.');
      return undefined;
    }
    return bound;
  } catch (error) {
    const caught =
      error instanceof Error ? error : new Error('RTK rewrite failed.');
    if (!isRtkCancellation(caught))
      runtime.recordFailure(
        caught.message || 'RTK rewrite preparation failed.',
      );
    throw caught;
  }
}
