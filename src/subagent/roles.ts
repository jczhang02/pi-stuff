import {readFile, readdir, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {parseFrontmatter} from '@earendil-works/pi-coding-agent';
import {Effect, Schema} from 'effect';
import {
  SubagentSettings,
  ThinkingLevel,
  Workspace,
  type SubagentSettings as SubagentSettingsValue,
  type ThinkingLevel as ThinkingLevelValue,
  type Workspace as WorkspaceValue,
} from './settings';

export class ConfigError extends Schema.TaggedError<ConfigError>()(
  'ConfigError',
  {message: Schema.String},
) {}

export type RoleSource = 'user' | 'project' | 'configured';

export interface Role {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly source: RoleSource;
  readonly filePath: string;
  readonly model: string | undefined;
  readonly thinking: ThinkingLevelValue | undefined;
  readonly tools: readonly string[] | undefined;
  readonly cwd: string | undefined;
  readonly workspace: WorkspaceValue | undefined;
  readonly copyHistory: boolean | undefined;
  readonly executionTimeoutMs: number | undefined;
  readonly extensions: readonly string[] | undefined;
  readonly baseline: string | undefined;
  readonly include: readonly string[] | undefined;
}

type RawRoleFrontmatter = {
  name?: unknown;
  description?: unknown;
  model?: unknown;
  thinking?: unknown;
  tools?: unknown;
  cwd?: unknown;
  workspace?: unknown;
  copyHistory?: unknown;
  executionTimeoutMs?: unknown;
  extensions?: unknown;
  instructions?: unknown;
  baseline?: unknown;
  include?: unknown;
};

const StringList = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const RoleFrontmatter = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  thinking: Schema.optional(ThinkingLevel),
  tools: Schema.optional(StringList),
  cwd: Schema.optional(Schema.String),
  workspace: Schema.optional(Workspace),
  copyHistory: Schema.optional(Schema.Boolean),
  executionTimeoutMs: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
  extensions: Schema.optional(StringList),
  instructions: Schema.optional(Schema.String),
  baseline: Schema.optional(Schema.String),
  include: Schema.optional(StringList),
});

const ProjectConfiguration = Schema.Struct({
  subagent: Schema.optional(SubagentSettings),
});

const missing = Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}));
export const verifiedExtensions = new Set(['pi-stuff:web']);

interface RoleRoot {
  readonly path: string;
  readonly source: RoleSource;
}

export interface ProjectConfigurationValue {
  readonly root: string | null;
  readonly settings: SubagentSettingsValue;
}

function configError(message: string): ConfigError {
  return new ConfigError({message});
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function isStringList(
  value: string | readonly string[],
): value is readonly string[] {
  return Array.isArray(value);
}

function listValue(
  value: string | readonly string[] | undefined,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const values = isStringList(value) ? value : value.split(',');
  return uniqueStrings(values);
}

function expandConfiguredPath(path: string, base: string): string {
  const expanded =
    path === '~'
      ? homedir()
      : path.startsWith('~/')
        ? join(homedir(), path.slice(2))
        : path;
  return isAbsolute(expanded) ? expanded : resolve(base, expanded);
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function findProjectRoot(cwd: string): Promise<string | null> {
  let current = resolve(cwd);
  while (true) {
    const projectDirectory = join(current, '.pi');
    if (
      (await pathExists(join(projectDirectory, 'pi-stuff.json'))) ||
      (await pathIsDirectory(join(projectDirectory, 'agents')))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function readProjectConfiguration(
  cwd: string,
): Effect.Effect<ProjectConfigurationValue, ConfigError> {
  return Effect.gen(function* () {
    const root = yield* Effect.tryPromise({
      try: () => findProjectRoot(cwd),
      catch: error =>
        configError(
          `Cannot discover the project configuration: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    });
    if (root === null) return {root: null, settings: {}};

    const path = join(root, '.pi', 'pi-stuff.json');
    const exists = yield* Effect.tryPromise({
      try: () => pathExists(path),
      catch: error =>
        configError(
          `Cannot inspect project configuration ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    });
    if (!exists) return {root, settings: {}};

    const text = yield* Effect.tryPromise({
      try: () => readFile(path, 'utf8'),
      catch: error =>
        configError(
          `Cannot read project configuration ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    });
    const configuration = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(ProjectConfiguration),
    )(text).pipe(
      Effect.mapError(error =>
        configError(
          `Invalid project subagent configuration ${path}: ${String(error)}`,
        ),
      ),
    );
    return {root, settings: configuration.subagent ?? {}};
  });
}

function listRoleFiles(
  path: string,
): Effect.Effect<readonly string[], ConfigError> {
  return Effect.tryPromise({
    try: async () => {
      let entry;
      try {
        entry = await stat(path);
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
      if (entry.isFile()) return path.endsWith('.md') ? [path] : [];
      if (!entry.isDirectory()) return [];
      const entries = await readdir(path, {withFileTypes: true});
      return entries
        .filter(
          entry =>
            entry.name.endsWith('.md') &&
            (entry.isFile() || entry.isSymbolicLink()),
        )
        .map(entry => join(path, entry.name))
        .sort((left, right) => left.localeCompare(right));
    },
    catch: error =>
      configError(
        `Cannot discover roles in ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
  });
}

function parseRole(
  filePath: string,
  source: RoleSource,
): Effect.Effect<Role, ConfigError> {
  return Effect.gen(function* () {
    const content = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: error =>
        configError(
          `Cannot read role ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    });
    const parsed = yield* Effect.try({
      try: () => parseFrontmatter<RawRoleFrontmatter>(content),
      catch: error =>
        configError(
          `Invalid frontmatter in role ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    });
    const frontmatter = yield* Schema.decodeUnknownEffect(RoleFrontmatter)(
      parsed.frontmatter,
    ).pipe(
      Effect.mapError(error =>
        configError(
          `Invalid frontmatter in role ${filePath}: ${String(error)}`,
        ),
      ),
    );
    const name = frontmatter.name?.trim();
    const description = frontmatter.description?.trim();
    if (!name || !description) {
      return yield* Effect.fail(
        configError(
          `Role ${filePath} requires non-empty name and description.`,
        ),
      );
    }
    const extensions = listValue(frontmatter.extensions);
    const unsupportedExtension = extensions?.find(
      extension => !verifiedExtensions.has(extension),
    );
    if (unsupportedExtension !== undefined) {
      return yield* Effect.fail(
        configError(
          `Role ${name} selects unsupported child extension ${unsupportedExtension}.`,
        ),
      );
    }
    const instructions = frontmatter.instructions ?? parsed.body.trim();
    return {
      name,
      description,
      instructions,
      source,
      filePath,
      model: frontmatter.model,
      thinking: frontmatter.thinking,
      tools: listValue(frontmatter.tools),
      cwd: frontmatter.cwd,
      workspace: frontmatter.workspace,
      copyHistory: frontmatter.copyHistory,
      executionTimeoutMs: frontmatter.executionTimeoutMs,
      extensions,
      baseline: frontmatter.baseline,
      include: listValue(frontmatter.include),
    };
  });
}

function loadRolesFromRoot(
  root: RoleRoot,
): Effect.Effect<readonly Role[], ConfigError> {
  return Effect.gen(function* () {
    const files = yield* listRoleFiles(root.path);
    return yield* Effect.forEach(files, filePath =>
      parseRole(filePath, root.source),
    );
  });
}

export function discoverRolesWithProject(
  cwd: string,
  agentDir: string,
  user: SubagentSettingsValue,
  project: ProjectConfigurationValue,
): Effect.Effect<readonly Role[], ConfigError> {
  const roots: RoleRoot[] = [];
  const userBase = resolve(agentDir);
  const projectBase = project.root === null ? resolve(cwd) : project.root;
  for (const path of user.rolePaths ?? []) {
    roots.push({
      path: expandConfiguredPath(path, userBase),
      source: 'configured',
    });
  }
  roots.push({path: join(userBase, 'agents'), source: 'user'});
  for (const path of project.settings.rolePaths ?? []) {
    roots.push({
      path: expandConfiguredPath(path, projectBase),
      source: 'configured',
    });
  }
  if (project.root !== null) {
    roots.push({path: join(project.root, '.pi', 'agents'), source: 'project'});
  }

  const uniqueRoots = roots.filter(
    (root, index) =>
      roots.findIndex(candidate => candidate.path === root.path) === index,
  );
  return Effect.gen(function* () {
    const roleGroups = yield* Effect.forEach(uniqueRoots, loadRolesFromRoot);
    const byName = new Map<string, Role>();
    for (const group of roleGroups) {
      for (const role of group) byName.set(role.name, role);
    }
    return [...byName.values()];
  });
}

export function discoverRoles(
  cwd: string,
  agentDir: string,
  user: SubagentSettingsValue,
): Effect.Effect<readonly Role[], ConfigError> {
  return Effect.gen(function* () {
    const project = yield* readProjectConfiguration(cwd);
    return yield* discoverRolesWithProject(cwd, agentDir, user, project);
  });
}
