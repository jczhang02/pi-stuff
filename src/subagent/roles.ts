import {parseFrontmatter} from '@earendil-works/pi-coding-agent';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {Effect, Option, Schema} from 'effect';

const AGENT_DIRS = ['.agents/agents', '.claude/agents', '.pi/agents'] as const;
const MAX_BODY_CHARS = 64_000;
const MIN_SHARED_TERMS = 2;
const MIN_COVERAGE = 0.4;
const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'or',
  'to',
  'in',
  'on',
  'with',
  'by',
  'at',
  'during',
  'your',
  'you',
  'their',
  'its',
  'is',
  'are',
  'be',
  'as',
  'how',
  'what',
  'who',
  'from',
  'into',
  'this',
  'that',
  'it',
  'all',
  'any',
  'per',
  'via',
  'other',
]);

const RoleFrontmatterSchema = Schema.Struct({
  model: Schema.optional(Schema.Unknown),
  tools: Schema.optional(Schema.Unknown),
  description: Schema.optional(Schema.Unknown),
});

const missing = Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}));

export class RoleError extends Schema.TaggedError<RoleError>()('RoleError', {
  kind: Schema.Literals(['io', 'parse']),
  message: Schema.String,
}) {}

export interface Role {
  readonly path: string;
  readonly body: string;
  model?: string;
  tools?: string[];
  description?: string;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(token => !STOP.has(token) && token.length > 1)
    .map(token => {
      let stem = token;
      if (stem.endsWith('ing') && stem.length > 5) stem = stem.slice(0, -3);
      if (/(?:ch|sh|ss|x|z|s)es$/.test(stem) && stem.length > 4)
        stem = stem.slice(0, -2);
      else if (stem.endsWith('s') && !stem.endsWith('ss') && stem.length > 3)
        stem = stem.slice(0, -1);
      return stem;
    });
}

function score(query: string[], description: string[]): number {
  if (description.length === 0) return 0;
  const queryTerms = new Set(query);
  const shared = new Set(description.filter(term => queryTerms.has(term)));
  if (shared.size < MIN_SHARED_TERMS) return 0;
  const denominator = Math.min(new Set(description).size, queryTerms.size);
  if (denominator === 0 || shared.size / denominator < MIN_COVERAGE) return 0;
  return shared.size;
}

function directoriesFor(cwd: string, agentDir: string): string[] {
  const directories: string[] = [];
  let current = resolve(cwd);
  while (true) {
    for (const subdirectory of AGENT_DIRS)
      directories.push(join(current, subdirectory));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const home = dirname(dirname(resolve(agentDir)));
  for (const subdirectory of AGENT_DIRS)
    directories.push(join(home, subdirectory));
  return directories;
}

function parseTools(
  frontmatter: typeof RoleFrontmatterSchema.Type,
): string[] | undefined {
  const text = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.String)(frontmatter.tools),
  );
  if (text !== undefined) {
    const tools = text
      .split(',')
      .map(tool => tool.trim())
      .filter(tool => tool.length > 0);
    return tools.length > 0 ? tools : undefined;
  }
  const list = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Array(Schema.String))(frontmatter.tools),
  );
  if (list === undefined || list.length === 0) return undefined;
  return Array.from(list);
}

function readRolesFromDirectory(
  directory: string,
): Effect.Effect<Role[], RoleError> {
  return Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: () => readdir(directory),
      catch: error =>
        missing(error)
          ? ('missing' as const)
          : new RoleError({
              kind: 'io',
              message:
                error instanceof Error
                  ? `Could not read role directory ${directory}: ${error.message}`
                  : `Could not read role directory ${directory}.`,
            }),
    }).pipe(
      Effect.catch(error =>
        error === 'missing' ? Effect.succeed(undefined) : Effect.fail(error),
      ),
    );
    if (entries === undefined) return [];

    const roles: Role[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const path = join(directory, entry);
      const content = yield* Effect.tryPromise({
        try: () => readFile(path, 'utf8'),
        catch: error =>
          new RoleError({
            kind: 'io',
            message:
              error instanceof Error
                ? `Could not read role file ${path}: ${error.message}`
                : `Could not read role file ${path}.`,
          }),
      });
      const parsed = yield* Effect.try({
        try: () => parseFrontmatter(content),
        catch: error =>
          new RoleError({
            kind: 'parse',
            message:
              error instanceof Error
                ? `Could not parse role file ${path}: ${error.message}`
                : `Could not parse role file ${path}.`,
          }),
      });
      const frontmatter = yield* Schema.decodeUnknownEffect(
        RoleFrontmatterSchema,
      )(parsed.frontmatter).pipe(
        Effect.mapError(
          error =>
            new RoleError({
              kind: 'parse',
              message: `Could not decode role file ${path}: ${error.message}`,
            }),
        ),
      );
      const model = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.String)(frontmatter.model),
      );
      const description = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.String)(frontmatter.description),
      );
      const body =
        parsed.body.length > MAX_BODY_CHARS
          ? `${parsed.body.slice(0, MAX_BODY_CHARS)}\n\n[truncated: agent file exceeded 64000 chars — slim it down]`
          : parsed.body;
      const role: Role = {path, body};
      if (model !== undefined) role.model = model;
      const tools = parseTools(frontmatter);
      if (tools !== undefined) role.tools = tools;
      if (description !== undefined) role.description = description;
      roles.push(role);
    }
    return roles;
  });
}

export function resolveRole(
  agent: string,
  task: string,
  cwd: string,
  agentDir: string,
): Effect.Effect<Role | undefined, RoleError> {
  const query = tokens(`${agent} ${task}`);
  return Effect.gen(function* () {
    let best: Role | undefined;
    let bestScore = 0;
    for (const directory of directoriesFor(cwd, agentDir)) {
      const roles = yield* readRolesFromDirectory(directory);
      for (const role of roles) {
        const current = score(query, tokens(role.description ?? ''));
        if (current > bestScore) {
          best = role;
          bestScore = current;
        }
      }
    }
    return best;
  });
}
