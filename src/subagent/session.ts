import {
  createAgentSession,
  createBashToolDefinition,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionContext,
  type SessionEntry,
  type SessionHeader,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, open, readFile, rename, rm, stat} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {Effect, Schema} from 'effect';
import type {EffectiveConfiguration} from './records';
import {
  createSessionHeader,
  decodeParentHistory,
  prepareHistoryEntries,
  type ParentHistorySnapshot,
} from './session-history';
import {registerWeb} from '../web/register';
import {trackedBashOperations} from './processes';
import {decodeSessionRecord} from './session-records';
import type {ChildActivity} from './activity';

export {
  captureParentHistory,
  FORK_CONTROL_CUSTOM_TYPE,
} from './session-history';
export type {
  ForkControlDetails,
  ParentHistorySnapshot,
} from './session-history';

export class ChildSessionError extends Schema.TaggedError<ChildSessionError>()(
  'ChildSessionError',
  {message: Schema.String},
) {}

export interface ChildSessionOptions {
  configuration: EffectiveConfiguration;
  directory: string;
  sessionFile: string | null;
  parent: ExtensionContext;
  tool: ToolDefinition;
  onEvent: (event: ChildActivity) => void | Promise<void>;
  onEventError: (error: Error) => void;
  allowed: (tool: string) => boolean;
  /** A serialized parent snapshot. It is valid only when opening a new child. */
  parentHistory?: ParentHistorySnapshot;
}

const VERIFIED_EXTENSIONS = new Set(['pi-stuff:web']);
const SUBAGENT_ASSIGNMENT =
  'SUBAGENT_ASSIGNMENT. You are a delegated agent. Use the subagent tool to communicate or delegate. Before finishing, call subagent with command finish, outcome fulfilled or unable, a complete report in text, and intended changed files/checks. A normal final answer alone does not declare fulfillment. Never apply changes to the main workspace. Tool permissions are an exposure policy, not an OS sandbox.';

const SessionHeaderContract = Schema.Struct({
  type: Schema.Literal('session'),
  version: Schema.optional(Schema.Number),
  id: Schema.String,
  timestamp: Schema.String,
  cwd: Schema.String,
  parentSession: Schema.optional(Schema.String),
});

type PersistedSessionHeader = typeof SessionHeaderContract.Type;

interface ModelReference {
  provider: string;
  modelId: string;
}

function isWithin(path: string, root: string): boolean {
  const target = resolve(path);
  const boundary = resolve(root);
  return target === boundary || target.startsWith(`${boundary}${sep}`);
}

function nearestGitRoot(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) return undefined;
    current = parent;
  }
}

function isAllowedResourcePath(
  path: string,
  cwd: string,
  agentDir: string,
): boolean {
  const globalRoot = resolve(agentDir);
  if (isWithin(path, globalRoot)) return true;
  return isWithin(path, nearestGitRoot(cwd) ?? cwd);
}

function modelReference(reference: string): ModelReference {
  const slash = reference.indexOf('/');
  if (slash <= 0 || slash === reference.length - 1)
    throw new Error(`Model must use provider/model syntax: ${reference}`);
  return {
    provider: reference.slice(0, slash),
    modelId: reference.slice(slash + 1),
  };
}

function isAgentCoreEvent(event: AgentSessionEvent): boolean {
  switch (event.type) {
    case 'agent_start':
    case 'agent_end':
    case 'turn_start':
    case 'turn_end':
    case 'message_start':
    case 'message_update':
    case 'message_end':
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end':
      return true;
    default:
      return false;
  }
}

async function requireDirectory(directory: string): Promise<void> {
  try {
    const info = await stat(directory);
    if (!info.isDirectory())
      throw new Error(
        `Child session directory is not a directory: ${directory}`,
      );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      await mkdir(directory, {recursive: true});
      return;
    }
    throw error;
  }
}

function copyProviderConfig(
  config: Parameters<ModelRuntime['registerProvider']>[1],
): Parameters<ModelRuntime['registerProvider']>[1] {
  const copied = {...config};
  if (config.headers !== undefined) copied.headers = {...config.headers};
  if (config.models !== undefined) {
    copied.models = config.models.map(model => {
      const copiedModel = {...model};
      if (model.headers !== undefined) copiedModel.headers = {...model.headers};
      return copiedModel;
    });
  }
  return copied;
}

async function createIsolatedModelRuntime(
  parent: ExtensionContext,
  agentDir: string,
): Promise<ModelRuntime> {
  // The child reads the host credential/model snapshots, but its registrations stay
  // in this runtime. Native providers are added later only if the requested model
  // cannot be resolved from copied configuration or built-in model data.
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  for (const providerId of parent.modelRegistry.getRegisteredProviderIds()) {
    const config = parent.modelRegistry.getRegisteredProviderConfig(providerId);
    if (config !== undefined)
      runtime.registerProvider(providerId, copyProviderConfig(config));
  }
  return runtime;
}

function resolveChildModel(
  runtime: ModelRuntime,
  parent: ExtensionContext,
  provider: string,
  modelId: string,
) {
  let model = runtime.getModel(provider, modelId);
  if (model !== undefined) return model;

  const native = parent.modelRegistry.getRegisteredNativeProvider(provider);
  if (native !== undefined) {
    runtime.registerNativeProvider(native);
    model = runtime.getModel(provider, modelId);
  }
  if (model === undefined)
    throw new Error(`Model unavailable: ${provider}/${modelId}`);
  return model;
}

function findChildModel(
  runtime: ModelRuntime,
  parent: ExtensionContext,
  provider: string,
  modelId: string,
) {
  let model = runtime.getModel(provider, modelId);
  if (model !== undefined) return model;
  const native = parent.modelRegistry.getRegisteredNativeProvider(provider);
  if (native !== undefined) {
    runtime.registerNativeProvider(native);
    model = runtime.getModel(provider, modelId);
  }
  return model;
}

function decodeSessionHeader(
  line: string,
  path: string,
): PersistedSessionHeader {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    throw new Error(`Required child session header is invalid: ${path}`, {
      cause: error,
    });
  }
  try {
    return Schema.decodeUnknownSync(SessionHeaderContract)(raw);
  } catch (error) {
    throw new Error(`Required child session header is invalid: ${path}`, {
      cause: error,
    });
  }
}

function decodeSessionEntry(
  line: string,
  path: string,
  lineNumber: number,
): SessionEntry {
  try {
    return decodeSessionRecord(line);
  } catch (error) {
    throw new Error(
      `Required child session entry ${lineNumber} is corrupt: ${path}`,
      {cause: error},
    );
  }
}

async function validateExistingSession(path: string): Promise<void> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error(`Required child session file is missing: ${path}`);
    throw error;
  }
  if (!info.isFile())
    throw new Error(`Required child session path is not a file: ${path}`);
  const content = await readFile(path, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (!lines.length)
    throw new Error(`Required child session file is empty: ${path}`);

  const firstLine = lines[0];
  if (firstLine === undefined)
    throw new Error(`Required child session file is empty: ${path}`);
  decodeSessionHeader(firstLine, path);

  const knownIds = new Set<string>();
  for (const [index, line] of lines.slice(1).entries()) {
    const entry = decodeSessionEntry(line, path, index + 2);
    if (entry.parentId !== null && !knownIds.has(entry.parentId))
      throw new Error(
        `Required child session entry ${index + 2} is orphaned: ${path}`,
      );
    if (entry.parentId === null && knownIds.size > 0)
      throw new Error(`Required child session has multiple roots: ${path}`);
    if (knownIds.has(entry.id))
      throw new Error(
        `Required child session entry ${index + 2} is duplicated: ${path}`,
      );
    knownIds.add(entry.id);
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function persistSessionState(
  path: string,
  header: SessionHeader,
  entries: readonly SessionEntry[],
): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  const temporary = `${path}.${randomUUID()}.tmp`;
  let committed = false;
  try {
    const content =
      [header, ...entries].map(entry => JSON.stringify(entry)).join('\n') +
      '\n';
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await validateExistingSession(temporary);
    await rename(temporary, path);
    committed = true;
    await syncDirectory(dirname(path));
  } finally {
    if (!committed) await rm(temporary, {force: true});
  }
}

async function writeHistorySession(
  path: string,
  cwd: string,
  directory: string,
  parentSession: string,
  snapshot: ParentHistorySnapshot,
): Promise<void> {
  const entries = prepareHistoryEntries(snapshot);
  const header = createSessionHeader(cwd, parentSession);
  const content =
    [header, ...entries].map(entry => JSON.stringify(entry)).join('\n') + '\n';
  await mkdir(dirname(path), {recursive: true});
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(content, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await requireDirectory(directory);
}

async function openRetainedSession(
  path: string,
  directory: string,
  cwd: string,
): Promise<SessionManager> {
  await validateExistingSession(path);
  const manager = SessionManager.open(path, directory, cwd);
  if (manager.getHeader() === null || manager.getCwd() !== resolve(cwd))
    throw new Error(
      `Required child session could not be rebound to ${cwd}: ${path}`,
    );
  return manager;
}

async function closeChildSessionRaw(session: AgentSession): Promise<void> {
  let failure: unknown;
  try {
    await session.abort();
  } catch (error) {
    failure = error;
  }
  try {
    await session.extensionRunner.emit({
      type: 'session_shutdown',
      reason: 'quit',
    });
  } catch (error) {
    failure ??= error;
  }
  try {
    session.dispose();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

export function closeChildSession(session: AgentSession) {
  return Effect.tryPromise({
    try: () => closeChildSessionRaw(session),
    catch: error =>
      new ChildSessionError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}

export function writeParentHistory(
  snapshot: ParentHistorySnapshot,
  path: string,
) {
  return Effect.tryPromise({
    try: async () => {
      decodeParentHistory(JSON.stringify(snapshot));
      await mkdir(dirname(path), {recursive: true});
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
    },
    catch: error =>
      new ChildSessionError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}

export function readParentHistory(path: string) {
  return Effect.tryPromise({
    try: async () => {
      const content = await readFile(path, 'utf8');
      return decodeParentHistory(content);
    },
    catch: error =>
      new ChildSessionError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}

export function verifyChildSession(session: AgentSession) {
  return Effect.tryPromise({
    try: async () => {
      if (!session.isIdle)
        throw new Error('Child session must be idle before it is verified.');
      const path = session.sessionManager.getSessionFile();
      if (path === undefined)
        throw new Error('Child session is not backed by a persistent file.');
      const header = session.sessionManager.getHeader();
      if (header === null)
        throw new Error('Child session has no persistent session header.');
      await persistSessionState(
        path,
        header,
        session.sessionManager.getEntries(),
      );
      await validateExistingSession(path);
    },
    catch: error =>
      new ChildSessionError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}

export function createChildSession(options: ChildSessionOptions) {
  return Effect.tryPromise({
    try: async () => {
      const {configuration, parent} = options;
      for (const extension of configuration.extensions) {
        if (!VERIFIED_EXTENSIONS.has(extension))
          throw new Error(`Unsupported child extension: ${extension}`);
      }
      const requested = modelReference(configuration.model);
      if (options.sessionFile !== null && options.parentHistory !== undefined)
        throw new Error(
          'Parent history can only be supplied when creating a new child session.',
        );

      await requireDirectory(options.directory);
      const agentDir = getAgentDir();
      const modelRuntime = await createIsolatedModelRuntime(parent, agentDir);
      const model = resolveChildModel(
        modelRuntime,
        parent,
        requested.provider,
        requested.modelId,
      );

      let sessionManager: SessionManager;
      if (options.sessionFile !== null) {
        sessionManager = await openRetainedSession(
          options.sessionFile,
          options.directory,
          configuration.cwd,
        );
      } else if (options.parentHistory !== undefined) {
        const planned = SessionManager.create(
          configuration.cwd,
          options.directory,
        );
        const sessionFile = planned.getSessionFile();
        if (sessionFile === undefined)
          throw new Error(
            'Could not allocate a persistent child session file.',
          );
        await writeHistorySession(
          sessionFile,
          configuration.cwd,
          options.directory,
          parent.sessionManager.getSessionFile() ??
            parent.sessionManager.getSessionId(),
          options.parentHistory,
        );
        sessionManager = await openRetainedSession(
          sessionFile,
          options.directory,
          configuration.cwd,
        );
      } else {
        sessionManager = SessionManager.create(
          configuration.cwd,
          options.directory,
        );
      }

      const settingsManager = SettingsManager.create(
        configuration.cwd,
        agentDir,
      );
      const resourceLoader = new DefaultResourceLoader({
        cwd: configuration.cwd,
        agentDir,
        settingsManager,
        noExtensions: true,
        noThemes: true,
        agentsFilesOverride: base => ({
          agentsFiles: base.agentsFiles.filter(file =>
            isAllowedResourcePath(file.path, configuration.cwd, agentDir),
          ),
        }),
        skillsOverride: base => ({
          ...base,
          skills: base.skills.filter(skill =>
            isAllowedResourcePath(skill.filePath, configuration.cwd, agentDir),
          ),
        }),
        appendSystemPrompt: [
          configuration.instructions,
          SUBAGENT_ASSIGNMENT,
        ].filter((prompt): prompt is string => prompt.length > 0),
        extensionFactories: [
          pi => {
            pi.on('tool_call', event =>
              options.allowed(event.toolName)
                ? undefined
                : {
                    block: true,
                    terminate: true,
                    reason: 'Tool permission was withdrawn.',
                  },
            );
            if (configuration.extensions.includes('pi-stuff:web'))
              registerWeb(pi, {}, undefined);
          },
        ],
      });
      await resourceLoader.reload();
      const extensionErrors = resourceLoader.getExtensions().errors;
      if (extensionErrors.length)
        throw new Error(extensionErrors.map(error => error.error).join('\n'));

      const restoredContext = sessionManager.buildSessionContext();
      const restoredModel =
        restoredContext.model === null
          ? undefined
          : findChildModel(
              modelRuntime,
              parent,
              restoredContext.model.provider,
              restoredContext.model.modelId,
            );
      const customTools: ToolDefinition[] = [options.tool];
      if (configuration.tools.includes('bash')) {
        const trackedBash = createBashToolDefinition(configuration.cwd, {
          operations: trackedBashOperations(
            join(options.directory, 'processes'),
          ),
        });
        // SAFETY: createBashToolDefinition returns a valid SDK tool; only its
        // parameter/detail generics are widened for createAgentSession's registry.
        customTools.push(trackedBash as ToolDefinition);
      }
      let session: AgentSession | undefined;
      try {
        const created = await createAgentSession({
          cwd: configuration.cwd,
          agentDir,
          modelRuntime,
          model: restoredModel ?? model,
          thinkingLevel: configuration.thinking,
          // The tracked definition has the same public name and replaces the
          // SDK base definition in the tool registry when bash is allowed.
          tools: [...configuration.tools],
          customTools,
          resourceLoader,
          settingsManager,
          sessionManager,
        });
        session = created.session;
        if (created.modelFallbackMessage)
          throw new Error(created.modelFallbackMessage);

        if (
          restoredModel !== undefined &&
          (restoredModel.provider !== model.provider ||
            restoredModel.id !== model.id)
        ) {
          await session.setModel(model, {persist: false});
        }
        if (session.thinkingLevel !== configuration.thinking)
          session.setThinkingLevel(configuration.thinking, {persist: false});

        session.agent.subscribe(async event => {
          const sessionEvent =
            event.type === 'agent_end' ? {...event, willRetry: false} : event;
          await options.onEvent(sessionEvent);
        });
        session.subscribe(event => {
          if (!isAgentCoreEvent(event))
            void Promise.resolve()
              .then(() => options.onEvent(event))
              .catch(error => {
                try {
                  options.onEventError(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                } catch {
                  // Failure reporting cannot create an unhandled SDK event.
                }
              });
        });
        await session.bindExtensions({mode: 'json'});
        await options.onEvent({
          type: 'resources_loaded',
          rules: resourceLoader
            .getAgentsFiles()
            .agentsFiles.map(file => file.path),
          skills: resourceLoader
            .getSkills()
            .skills.map(skill => skill.filePath),
        });
        return session;
      } catch (error) {
        if (session !== undefined) await closeChildSessionRaw(session);
        throw error;
      }
    },
    catch: error =>
      new ChildSessionError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}
