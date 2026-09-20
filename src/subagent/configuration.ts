import {resolve} from 'node:path';
import {Effect, Schema} from 'effect';
import type {Assignment} from './protocol';
import {
  EffectiveConfiguration,
  type EffectiveConfiguration as EffectiveConfigurationValue,
} from './records';
import {
  ConfigError,
  discoverRolesWithProject,
  readProjectConfiguration,
  verifiedExtensions,
  type Role,
} from './roles';
import {
  type SubagentDefaults,
  type SubagentSettings as SubagentSettingsValue,
  type ThinkingLevel as ThinkingLevelValue,
  type Workspace as WorkspaceValue,
} from './settings';

export {ConfigError, discoverRoles} from './roles';
export type {Role, RoleSource} from './roles';

export interface ConfigurationContext {
  readonly cwd: string;
  readonly agentDir: string;
  readonly user: SubagentSettingsValue;
  readonly parent: EffectiveConfigurationValue;
  readonly availableTools: readonly string[];
}

const readOnlyTools = ['read', 'grep', 'find', 'ls', 'subagent'] as const;
const writableTools = [
  'read',
  'grep',
  'find',
  'ls',
  'bash',
  'edit',
  'write',
  'subagent',
] as const;
const writerTools = ['bash', 'edit', 'write'] as const;
const supportedBuiltinTools = new Set<string>([
  ...readOnlyTools,
  ...writerTools,
]);
const extensionTools = new Map([
  [
    'pi-stuff:web',
    new Set(['web_search', 'fetch_content', 'get_search_content']),
  ],
]);
const readOnlyToolSet = new Set<string>(readOnlyTools);
const writableToolSet = new Set<string>(writableTools);
const writerToolSet = new Set<string>(writerTools);

interface ConfigurationValues {
  readonly model: string | undefined;
  readonly thinking: ThinkingLevelValue | undefined;
  readonly tools: readonly string[] | undefined;
  readonly instructions: string | undefined;
  readonly executionTimeoutMs: number | null | undefined;
  readonly extensions: readonly string[] | undefined;
  readonly cwd: string | undefined;
  readonly workspace: WorkspaceValue | undefined;
  readonly copyHistory: boolean | undefined;
  readonly baseline: string | null | undefined;
  readonly include: readonly string[] | undefined;
}

interface CandidateConfiguration {
  readonly model: string;
  readonly thinking: ThinkingLevelValue;
  readonly tools: readonly string[];
  readonly ceiling: readonly string[];
  readonly cwd: string;
  readonly workspace: WorkspaceValue;
  readonly instructions: string;
  readonly role: string | null;
  readonly copyHistory: boolean;
  readonly executionTimeoutMs: number | null;
  readonly extensions: readonly string[];
  readonly baseline: string | null;
  readonly include: readonly string[];
}

function configError(message: string): ConfigError {
  return new ConfigError({message});
}

function firstDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  return values.find(value => value !== undefined);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

// Effective configuration and permission resolution.

function roleValues(role: Role | undefined): ConfigurationValues {
  return {
    model: role?.model,
    thinking: role?.thinking,
    tools: role?.tools,
    instructions: role?.instructions,
    executionTimeoutMs: role?.executionTimeoutMs,
    extensions: role?.extensions,
    cwd: role?.cwd,
    workspace: role?.workspace,
    copyHistory: role?.copyHistory,
    baseline: role?.baseline,
    include: role?.include,
  };
}

function defaultValues(
  settings: SubagentDefaults | undefined,
): ConfigurationValues {
  return {
    model: settings?.model,
    thinking: settings?.thinking,
    tools: settings?.tools,
    instructions: settings?.instructions,
    executionTimeoutMs: settings?.executionTimeoutMs,
    extensions: settings?.extensions,
    cwd: settings?.cwd,
    workspace: settings?.workspace,
    copyHistory: settings?.copyHistory,
    baseline: settings?.baseline,
    include: settings?.include,
  };
}

function assignmentValues(assignment: Assignment): ConfigurationValues {
  return {
    model: assignment.model,
    thinking: assignment.thinking,
    tools: assignment.tools,
    instructions: assignment.instructions,
    executionTimeoutMs: assignment.executionTimeoutMs,
    extensions: assignment.extensions,
    cwd: assignment.cwd,
    workspace: assignment.workspace,
    copyHistory: assignment.copyHistory,
    baseline: assignment.baseline,
    include: assignment.include,
  };
}

function applicableParentTools(
  parent: EffectiveConfigurationValue,
  availableTools: readonly string[],
): readonly string[] {
  const available = new Set(availableTools);
  const current = new Set(parent.tools);
  return uniqueStrings(
    parent.ceiling.filter(tool => current.has(tool) && available.has(tool)),
  );
}

function unsupportedTool(
  tool: string,
  extensions: readonly string[],
): string | undefined {
  if (supportedBuiltinTools.has(tool)) return undefined;
  const extension = extensions.find(id => extensionTools.get(id)?.has(tool));
  return extension === undefined ? tool : undefined;
}

function missingToolExtension(
  tool: string,
  extensions: readonly string[],
): string | undefined {
  for (const [extension, tools] of extensionTools) {
    if (tools.has(tool) && !extensions.includes(extension)) return extension;
  }
  return undefined;
}

function unsupportedExtension(
  extensions: readonly string[],
): string | undefined {
  return extensions.find(extension => !verifiedExtensions.has(extension));
}

function workspaceRank(workspace: WorkspaceValue): number {
  switch (workspace) {
    case 'snapshot':
      return 0;
    case 'live':
      return 1;
    case 'write':
      return 2;
    case 'direct':
      return 3;
  }
}

function workspaceAllowed(
  child: WorkspaceValue,
  parent: WorkspaceValue,
): boolean {
  // This is a conservative admission order, not a claim that the modes are
  // interchangeable. Live exposes the current source but never enables
  // writer tools here; write supplies an isolated writable worktree.
  return workspaceRank(child) <= workspaceRank(parent);
}

function finalConfiguration(
  candidate: CandidateConfiguration,
): Effect.Effect<EffectiveConfigurationValue, ConfigError> {
  return Schema.decodeUnknownEffect(EffectiveConfiguration)(candidate).pipe(
    Effect.mapError(error =>
      configError(`Invalid effective subagent configuration: ${String(error)}`),
    ),
  );
}

interface ResolutionSources {
  readonly role: Role | undefined;
  readonly projectDefaults: SubagentDefaults | undefined;
  readonly userDefaults: SubagentDefaults | undefined;
  readonly inheritParent?: boolean;
  readonly savedRole?: string | null;
}

function emptyConfigurationValues(): ConfigurationValues {
  return {
    model: undefined,
    thinking: undefined,
    tools: undefined,
    instructions: undefined,
    executionTimeoutMs: undefined,
    extensions: undefined,
    cwd: undefined,
    workspace: undefined,
    copyHistory: undefined,
    baseline: undefined,
    include: undefined,
  };
}

function resolveEffectiveConfiguration(
  assignment: Assignment,
  context: ConfigurationContext,
  sources: ResolutionSources,
): Effect.Effect<EffectiveConfigurationValue, ConfigError> {
  return Effect.gen(function* () {
    const call = assignmentValues(assignment);
    const selectedRole = roleValues(sources.role);
    const projectDefaults = defaultValues(sources.projectDefaults);
    const userDefaults = defaultValues(sources.userDefaults);
    const parent = context.parent;
    const parentValues =
      sources.inheritParent === false
        ? emptyConfigurationValues()
        : ({
            model: parent.model,
            thinking: parent.thinking,
            tools: undefined,
            instructions: parent.instructions,
            executionTimeoutMs: parent.executionTimeoutMs,
            extensions: undefined,
            cwd: parent.cwd,
            // A child starts read-only in an independent snapshot by default.
            // The parent's workspace remains an upper bound, rather than an
            // elevation.
            workspace: undefined,
            copyHistory: undefined,
            baseline: parent.baseline,
            include: parent.include,
          } satisfies ConfigurationValues);
    const layers = [
      call,
      selectedRole,
      projectDefaults,
      userDefaults,
      parentValues,
    ];
    const localLayers = layers.slice(0, -1);

    const model = firstDefined(layers.map(layer => layer.model));
    if (model === undefined || model.trim().length === 0) {
      return yield* Effect.fail(
        configError('A child model must be configured.'),
      );
    }
    const thinking = firstDefined(layers.map(layer => layer.thinking));
    if (thinking === undefined) {
      return yield* Effect.fail(
        configError('A child thinking level must be configured.'),
      );
    }
    const workspace =
      firstDefined(localLayers.map(layer => layer.workspace)) ?? 'snapshot';
    if (!workspaceAllowed(workspace, parent.workspace)) {
      return yield* Effect.fail(
        configError(
          `Workspace ${workspace} exceeds the parent workspace ceiling.`,
        ),
      );
    }

    const ceiling = applicableParentTools(parent, context.availableTools);
    const extensions = uniqueStrings(
      firstDefined(localLayers.map(layer => layer.extensions)) ?? [],
    );
    const invalidExtension = unsupportedExtension(extensions);
    if (invalidExtension !== undefined) {
      return yield* Effect.fail(
        configError(`Unsupported child extension ${invalidExtension}.`),
      );
    }
    const explicitTools = firstDefined(localLayers.map(layer => layer.tools));
    const tools =
      explicitTools === undefined
        ? ceiling.filter(tool =>
            (workspace === 'write' || workspace === 'direct'
              ? writableToolSet
              : readOnlyToolSet
            ).has(tool),
          )
        : uniqueStrings(explicitTools);
    const unavailableTool = tools.find(tool => !ceiling.includes(tool));
    if (unavailableTool !== undefined) {
      return yield* Effect.fail(
        configError(
          `Requested child tool ${unavailableTool} is unavailable to the parent.`,
        ),
      );
    }
    if (!tools.includes('subagent')) {
      return yield* Effect.fail(
        configError(
          'The child tool set must include the subagent control tool for finish and communication.',
        ),
      );
    }
    const invalidTool = tools.find(tool => unsupportedTool(tool, extensions));
    if (invalidTool !== undefined) {
      return yield* Effect.fail(
        configError(`Unsupported child tool ${invalidTool}.`),
      );
    }
    const requiredExtension = tools.find(tool =>
      missingToolExtension(tool, extensions),
    );
    if (requiredExtension !== undefined) {
      return yield* Effect.fail(
        configError(
          `Child tool ${requiredExtension} requires the pi-stuff:web extension.`,
        ),
      );
    }
    const writerTool = tools.find(tool => writerToolSet.has(tool));
    if (
      writerTool !== undefined &&
      workspace !== 'write' &&
      workspace !== 'direct'
    ) {
      return yield* Effect.fail(
        configError(
          `Writer tool ${writerTool} requires an explicit write or direct workspace.`,
        ),
      );
    }

    const cwdValue = firstDefined(layers.map(layer => layer.cwd));
    const childCwd =
      cwdValue === undefined ? context.cwd : resolve(context.cwd, cwdValue);
    const instructions =
      firstDefined(layers.map(layer => layer.instructions)) ?? '';
    const copyHistory =
      firstDefined(localLayers.map(layer => layer.copyHistory)) ?? false;
    const executionTimeoutMs =
      firstDefined(layers.map(layer => layer.executionTimeoutMs)) ?? null;
    const baseline = firstDefined(layers.map(layer => layer.baseline)) ?? null;
    const include = uniqueStrings(
      firstDefined(layers.map(layer => layer.include)) ?? [],
    );
    const roleName =
      sources.savedRole !== undefined
        ? sources.savedRole
        : (sources.role?.name ??
          (assignment.instructions === undefined ? null : assignment.name));

    return yield* finalConfiguration({
      model,
      thinking,
      tools,
      ceiling,
      cwd: childCwd,
      workspace,
      instructions,
      role: roleName,
      copyHistory,
      executionTimeoutMs,
      extensions,
      baseline,
      include,
    });
  });
}

export function resolveConfiguration(
  assignment: Assignment,
  context: ConfigurationContext,
): Effect.Effect<EffectiveConfigurationValue, ConfigError> {
  return Effect.gen(function* () {
    if (assignment.role !== undefined && assignment.role.length === 0) {
      return yield* Effect.fail(
        configError('A selected role name cannot be empty.'),
      );
    }
    const project = yield* readProjectConfiguration(context.cwd);
    const role =
      assignment.role === undefined
        ? undefined
        : yield* discoverRolesWithProject(
            context.cwd,
            context.agentDir,
            context.user,
            project,
          ).pipe(
            Effect.map(roles =>
              roles.find(candidate => candidate.name === assignment.role),
            ),
          );
    if (assignment.role !== undefined && role === undefined) {
      return yield* Effect.fail(
        configError(
          `No discovered role has the exact name ${assignment.role}.`,
        ),
      );
    }
    return yield* resolveEffectiveConfiguration(assignment, context, {
      role,
      projectDefaults: project.settings.defaults,
      userDefaults: context.user.defaults,
    });
  });
}

export function resolveFollowup(
  overrides: Assignment,
  saved: EffectiveConfigurationValue,
  context: ConfigurationContext,
): Effect.Effect<EffectiveConfigurationValue, ConfigError> {
  return Effect.gen(function* () {
    if (overrides.role !== undefined) {
      return yield* Effect.fail(
        configError('Follow-up assignments cannot select a new role.'),
      );
    }
    const baseline = overrides.baseline ?? saved.baseline;
    const executionTimeoutMs =
      overrides.executionTimeoutMs ?? saved.executionTimeoutMs;
    const assignment: Assignment = {
      name: overrides.name,
      prompt: overrides.prompt,
      instructions: overrides.instructions ?? saved.instructions,
      model: overrides.model ?? saved.model,
      thinking: overrides.thinking ?? saved.thinking,
      tools: overrides.tools ?? [...saved.tools],
      cwd: overrides.cwd ?? saved.cwd,
      workspace: overrides.workspace ?? saved.workspace,
      include: overrides.include ?? [...saved.include],
      copyHistory: overrides.copyHistory ?? saved.copyHistory,
      extensions: overrides.extensions ?? [...saved.extensions],
    };
    if (baseline !== null) assignment.baseline = baseline;
    if (executionTimeoutMs !== null)
      assignment.executionTimeoutMs = executionTimeoutMs;
    return yield* resolveEffectiveConfiguration(assignment, context, {
      role: undefined,
      projectDefaults: undefined,
      userDefaults: undefined,
      inheritParent: false,
      savedRole: saved.role,
    });
  });
}
