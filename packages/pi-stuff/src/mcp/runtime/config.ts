// config.ts - Config loading with import support
import { isJsonInputObject, isJsonInputValue, parseJsonValue, requireJsonInputValue, type JsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeString } from "../../shared/runtime-type.js";
import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import stripJsonComments from "strip-json-comments";
import { withSettingsLock } from "../../shared/settings-io/lock.ts";
import { xdgConfigHome } from "../../xdg/index.ts";
import { getAgentPath } from "./agent-dir.ts";
import { logger } from "./logger.ts";
import { isServerDisabled, type HostConfigDiscovery, type McpConfig, type ServerEntry, type McpSettings, type ImportKind } from "./types.ts";
import { toStringRecord } from "./utils.ts";

const AGENTS_GLOBAL_CONFIG_PATHS = [
  join(homedir(), ".agents", "mcp.json"),
  join(homedir(), ".agents", "mcp", "mcp.json"),
] as const;
const PROJECT_CONFIG_NAME = ".mcp.json";
const PROJECT_PI_CONFIG_NAME = ".pi/mcp.json";
const REPOPROMPT_BINARY_CANDIDATES = [
  join(homedir(), "RepoPrompt", "repoprompt_cli"),
  "/Applications/Repo Prompt.app/Contents/MacOS/repoprompt-mcp",
];

export interface KnownServerPreset {
  id: string;
  name: string;
  summary: string;
  entry: ServerEntry;
}

export const KNOWN_SERVER_PRESETS: readonly KnownServerPreset[] = [
  {
    id: "deepwiki",
    name: "DeepWiki",
    summary: "Ask questions about public GitHub repositories.",
    entry: { url: "https://mcp.deepwiki.com/mcp" },
  },
  {
    id: "context7",
    name: "Context7",
    summary: "Look up current library documentation and examples.",
    entry: { url: "https://mcp.context7.com/mcp" },
  },
  {
    id: "notion",
    name: "Notion",
    summary: "Search and work with your Notion workspace.",
    entry: { url: "https://mcp.notion.com/mcp", auth: "oauth" },
  },
  {
    id: "github",
    name: "GitHub",
    summary: "Work with GitHub through your Copilot account.",
    entry: { url: "https://api.githubcopilot.com/mcp", auth: "oauth" },
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    summary: "Inspect and automate a local Chrome browser.",
    entry: { command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] },
  },
];

const IMPORT_PATHS = {
  cursor: [join(homedir(), ".cursor", "mcp.json")],
  "claude-code": [
    join(homedir(), ".claude", "mcp.json"),
    join(homedir(), ".claude.json"),
    join(homedir(), ".claude", "claude_desktop_config.json"),
  ],
  "claude-desktop": [join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")],
  codex: [
    join(homedir(), ".codex", "config.toml"),
    join(homedir(), ".codex", "config.json"),
  ],
  opencode: [
    join(xdgConfigHome(), "opencode", "opencode.json"),
    "./opencode.json",
  ],
  windsurf: [join(homedir(), ".windsurf", "mcp.json")],
  vscode: [".vscode/mcp.json"],
} satisfies Record<ImportKind, string[]>;

interface ServerMap {
  [serverName: string]: ServerEntry;
}

function isImportKind(value: string): value is ImportKind {
  return Object.hasOwn(IMPORT_PATHS, value);
}

function importKinds(): ImportKind[] {
  return Object.keys(IMPORT_PATHS).filter(isImportKind);
}

function validateOptionalString(record: JsonInputObject, key: string, label: string): void {
  const value = record[key];
  if (value !== undefined && !isRuntimeString(value)) throw new TypeError(`${label}.${key} must be a string`);
}

function validateOptionalBoolean(record: JsonInputObject, key: string, label: string): void {
  const value = record[key];
  if (value !== undefined && !isRuntimeBoolean(value)) throw new TypeError(`${label}.${key} must be a boolean`);
}

function validateOptionalNumber(record: JsonInputObject, key: string, label: string): void {
  const value = record[key];
  if (value !== undefined && (!isRuntimeNumber(value) || !Number.isFinite(value))) {
    throw new TypeError(`${label}.${key} must be a finite number`);
  }
}

function validateOptionalStringList(record: JsonInputObject, key: string, label: string): void {
  const value = record[key];
  if (value !== undefined && (!Array.isArray(value) || !value.every(isRuntimeString))) {
    throw new TypeError(`${label}.${key} must be an array of strings`);
  }
}

function validateOptionalStringRecord(record: JsonInputObject, key: string, label: string): void {
  const value = record[key];
  if (value === undefined) return;
  if (!isJsonInputObject(value) || !Object.values(value).every(isRuntimeString)) {
    throw new TypeError(`${label}.${key} must be an object of string values`);
  }
}

function parseServerEntry(value: JsonInputValue, label: string): ServerEntry {
  if (!isJsonInputObject(value)) throw new TypeError(`${label} must be an object`);
  for (const key of ["command", "socket", "cwd", "url", "bearerToken", "bearerTokenEnv"]) {
    validateOptionalString(value, key, label);
  }
  for (const key of ["exposeResources", "debug", "trace", "disabled"]) {
    validateOptionalBoolean(value, key, label);
  }
  for (const key of ["idleTimeout", "requestTimeoutMs"]) validateOptionalNumber(value, key, label);
  for (const key of ["args", "includeTools", "excludeTools"]) validateOptionalStringList(value, key, label);
  for (const key of ["env", "headers"]) validateOptionalStringRecord(value, key, label);

  if (value.auth !== undefined && value.auth !== false && value.auth !== "oauth" && value.auth !== "bearer") {
    throw new TypeError(`${label}.auth must be oauth, bearer, or false`);
  }
  if (value.lifecycle !== undefined && (!isRuntimeString(value.lifecycle) || !["keep-alive", "lazy", "lazy-keep-alive", "eager"].includes(value.lifecycle))) {
    throw new TypeError(`${label}.lifecycle is unsupported`);
  }
  if (value.toolPrefix !== undefined && (!isRuntimeString(value.toolPrefix) || !["server", "none", "short", "mcp"].includes(value.toolPrefix))) {
    throw new TypeError(`${label}.toolPrefix is unsupported`);
  }
  for (const key of ["directTools", "approveTools"]) {
    const setting = value[key];
    if (setting !== undefined && !isRuntimeBoolean(setting) && (!Array.isArray(setting) || !setting.every(isRuntimeString))) {
      throw new TypeError(`${label}.${key} must be a boolean or an array of strings`);
    }
  }
  if (value.oauth !== undefined && value.oauth !== false) {
    if (!isJsonInputObject(value.oauth)) throw new TypeError(`${label}.oauth must be an object or false`);
    for (const key of ["clientId", "clientSecret", "scope", "redirectUri", "clientName", "clientUri"]) {
      validateOptionalString(value.oauth, key, `${label}.oauth`);
    }
    if (value.oauth.grantType !== undefined && value.oauth.grantType !== "authorization_code" && value.oauth.grantType !== "client_credentials") {
      throw new TypeError(`${label}.oauth.grantType is unsupported`);
    }
    validateOptionalStringRecord(value.oauth, "authorizationParams", `${label}.oauth`);
  }

  // SAFETY: every typed ServerEntry field is validated above; extra JSON fields remain inert compatibility data.
  return value as ServerEntry;
}

function parseMcpSettings(value: JsonInputValue): McpSettings | undefined {
  if (value === undefined) return undefined;
  if (!isJsonInputObject(value)) throw new TypeError("MCP config settings must be an object");
  for (const key of [
    "showStatusIcon", "directTools", "scriptMode", "disableProxyTool", "freezeDirectTools", "autoAuth",
    "sampling", "samplingAutoApprove", "elicitation",
  ]) validateOptionalBoolean(value, key, "settings");
  for (const key of ["idleTimeout", "requestTimeoutMs"]) validateOptionalNumber(value, key, "settings");
  for (const key of ["authRequiredMessage", "oauthDir"]) validateOptionalString(value, key, "settings");
  if (value.toolPrefix !== undefined && (!isRuntimeString(value.toolPrefix) || !["server", "none", "short", "mcp"].includes(value.toolPrefix))) {
    throw new TypeError("settings.toolPrefix is unsupported");
  }
  if (value.mcpFooterStatus !== undefined && (!isRuntimeString(value.mcpFooterStatus) || !["full", "compact", "off"].includes(value.mcpFooterStatus))) {
    throw new TypeError("settings.mcpFooterStatus is unsupported");
  }
  if (value.hostConfigDiscovery !== undefined && (!isRuntimeString(value.hostConfigDiscovery) || !["off", "prompt", "on"].includes(value.hostConfigDiscovery))) {
    throw new TypeError("settings.hostConfigDiscovery is unsupported");
  }
  const approveTools = value.approveTools;
  if (approveTools !== undefined && !isRuntimeBoolean(approveTools) && (!Array.isArray(approveTools) || !approveTools.every(isRuntimeString))) {
    throw new TypeError("settings.approveTools must be a boolean or an array of strings");
  }
  const outputGuard = value.outputGuard;
  if (outputGuard !== undefined && !isRuntimeBoolean(outputGuard)) {
    if (!isJsonInputObject(outputGuard)) throw new TypeError("settings.outputGuard must be a boolean or an object");
    for (const key of ["maxBytes", "maxLines", "detailsMaxBytes"]) validateOptionalNumber(outputGuard, key, "settings.outputGuard");
  }
  const trace = value.trace;
  if (trace !== undefined) {
    if (!isJsonInputObject(trace)) throw new TypeError("settings.trace must be an object");
    validateOptionalBoolean(trace, "enabled", "settings.trace");
    validateOptionalString(trace, "file", "settings.trace");
    for (const key of ["maxBytes", "maxEvents"]) validateOptionalNumber(trace, key, "settings.trace");
  }

  // SAFETY: every McpSettings field and nested settings object is validated above.
  return value as McpSettings;
}

function parseServerMap(value: JsonInputValue, label: string): ServerMap {
  if (!isJsonInputObject(value)) throw new TypeError(`${label} must be an object`);
  const servers: ServerMap = {};
  for (const [name, entry] of Object.entries(value)) {
    Object.defineProperty(servers, name, {
      configurable: true,
      enumerable: true,
      value: parseServerEntry(entry, `${label}.${name}`),
      writable: true,
    });
  }
  return servers;
}

function setServer(map: ServerMap, name: string, entry: ServerEntry): void {
  Object.defineProperty(map, name, { configurable: true, enumerable: true, value: entry, writable: true });
}

function setJsonInputProperty(map: JsonInputObject, name: string, value: JsonInputValue): void {
  Object.defineProperty(map, name, { configurable: true, enumerable: true, value, writable: true });
}

function copyJsonInputObject(...sources: readonly JsonInputObject[]): JsonInputObject {
  const result: JsonInputObject = {};
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) setJsonInputProperty(result, name, value);
  }
  return result;
}

interface ConfigSourceSpec {
  id: "shared-global" | "agents-global" | "agents-nested-global" | "pi-global" | "shared-project" | "pi-project";
  label: string;
  readPath: string;
  writePath: string;
  kind: "user" | "project" | "import";
  importKind?: string;
  shared: boolean;
  scope: "global" | "project";
}

export interface ConfigDiscoveryPath {
  label: string;
  path: string;
  exists: boolean;
}

export interface DiscoveredImportConfig {
  kind: ImportKind;
  path: string;
}

export interface ConfigDiscoverySource extends ConfigDiscoveryPath {
  id: ConfigSourceSpec["id"];
  scope: ConfigSourceSpec["scope"];
  kind: "shared" | "pi";
  serverCount: number;
}

export interface ImportConfigSummary extends DiscoveredImportConfig {
  serverCount: number;
}

export interface HostConfigSummary extends ImportConfigSummary {
  active: boolean;
}

export interface McpConfigConflict {
  serverName: string;
  sources: Array<{ kind: "shared" | "pi" | "host"; path: string }>;
  winner: { kind: "shared" | "pi" | "host"; path: string };
}

export interface RepoPromptDiscovery {
  configured: boolean;
  configuredPath?: string;
  executablePath?: string;
  targetPath?: string;
  serverName?: string;
  entry?: ServerEntry;
}

export interface McpDiscoverySummary {
  sources: ConfigDiscoverySource[];
  imports: ImportConfigSummary[];
  hostConfigs: HostConfigSummary[];
  hostConfigDiscovery: HostConfigDiscovery;
  conflicts: McpConfigConflict[];
  hasAnyConfig: boolean;
  hasAnyDetectedPaths: boolean;
  hasSharedServers: boolean;
  hasPiOwnedServers: boolean;
  totalServerCount: number;
  fingerprint: string;
  repoPrompt: RepoPromptDiscovery;
}

export interface ConfigWritePreview {
  path: string;
  existed: boolean;
  changed: boolean;
  beforeText: string;
  afterText: string;
  diffText: string;
}

export function getPiGlobalConfigPath(overridePath?: string): string {
  return overridePath ? resolve(overridePath) : getAgentPath("mcp.json");
}

export function getGenericGlobalConfigPath(): string {
	return join(xdgConfigHome(), "mcp", "mcp.json");
}

export function getProjectConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, PROJECT_CONFIG_NAME);
}

export function getProjectPiConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, PROJECT_PI_CONFIG_NAME);
}

export function getConfigDiscoveryPaths(overridePath?: string, cwd = process.cwd()): ConfigDiscoveryPath[] {
  return getConfigSources(overridePath, cwd).map((source) => ({
    label: source.label,
    path: source.readPath,
    exists: existsSync(source.readPath),
  }));
}

export function findAvailableImportConfigs(cwd = process.cwd()): DiscoveredImportConfig[] {
  const discovered: DiscoveredImportConfig[] = [];

  for (const importKind of importKinds()) {
    const importPath = resolveImportPath(importKind, cwd);
    if (importPath) {
      discovered.push({ kind: importKind, path: importPath });
    }
  }

  return discovered;
}

export function getMcpDiscoverySummary(overridePath?: string, cwd = process.cwd()): McpDiscoverySummary {
  const sourceSpecs = getConfigSources(overridePath, cwd);
  const sources = sourceSpecs.map((source) => {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    return {
      id: source.id,
      label: source.label,
      path: source.readPath,
      exists: existsSync(source.readPath),
      scope: source.scope,
      kind: source.shared ? "shared" : "pi",
      serverCount: loaded ? Object.keys(loaded.mcpServers).length : 0,
    } satisfies ConfigDiscoverySource;
  });

  const imports = importKinds()
    .map((kind) => {
      const imported = loadImportedConfig(kind, cwd, `Failed to inspect imported MCP config from ${kind}:`);
      if (!imported) return null;
      return {
        kind,
        path: imported.path,
        serverCount: Object.keys(extractServers(imported.value, kind)).length,
      } satisfies ImportConfigSummary;
    })
    .filter((value): value is ImportConfigSummary => value !== null);
  const hostConfigDiscovery = getConfiguredHostConfigDiscovery(overridePath, cwd);
  const hostConfigs = imports.map((entry) => ({ ...entry, active: hostConfigDiscovery === "on" }));
  const totalServerCount = sources.reduce((sum, source) => sum + source.serverCount, 0);
  const hasSharedServers = sources.some((source) => source.kind === "shared" && source.serverCount > 0);
  const hasPiOwnedServers = sources.some((source) => source.kind === "pi" && source.serverCount > 0);
  const hasAnyDetectedPaths = sources.some((source) => source.exists) || imports.length > 0;
  const hasAnyConfig = totalServerCount > 0 || imports.some((entry) => entry.serverCount > 0) || hasAnyDetectedPaths;

  const summaryWithoutRepoPrompt = {
    sources,
    imports,
    hostConfigs,
    hostConfigDiscovery,
    conflicts: getConfigConflicts(sourceSpecs, imports, cwd),
    hasAnyConfig,
    hasAnyDetectedPaths,
    hasSharedServers,
    hasPiOwnedServers,
    totalServerCount,
  };

  const fingerprint = JSON.stringify({
    sources: sources.map((source) => [source.id, source.exists, source.serverCount]),
    imports: imports.map((entry) => [entry.kind, entry.path, entry.serverCount]),
    hostConfigDiscovery,
    conflicts: summaryWithoutRepoPrompt.conflicts,
  });

  return {
    ...summaryWithoutRepoPrompt,
    fingerprint,
    repoPrompt: detectRepoPrompt(summaryWithoutRepoPrompt, cwd),
  };
}

export function cloneMcpConfig(config: McpConfig): McpConfig {
  return structuredClone(config);
}

export function loadMcpConfig(overridePath?: string, cwd = process.cwd()): McpConfig {
  const sourceSpecs = getConfigSources(overridePath, cwd);
  const hostConfigDiscovery = getConfiguredHostConfigDiscovery(overridePath, cwd);
  // Host files are a lower-precedence fallback. This ordering means an opt-in
  // discovery cannot override a shared or Pi-owned definition, and all normal
  // URL-bound credential stripping remains in mergeServerMaps.
  let config: McpConfig = hostConfigDiscovery === "on"
    ? loadDiscoveredHostConfigs(cwd)
    : { mcpServers: {} };

  for (const source of sourceSpecs) {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    if (!loaded) continue;
    config = mergeConfigs(config, expandImports(loaded, cwd));
  }

  return config;
}

function getConfiguredHostConfigDiscovery(overridePath?: string, cwd = process.cwd()): HostConfigDiscovery {
  let configured: HostConfigDiscovery = "off";
  for (const source of getConfigSources(overridePath, cwd)) {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    const value = loaded?.settings?.hostConfigDiscovery;
    if (value === "off" || value === "prompt" || value === "on") configured = value;
  }
  return configured;
}

function loadDiscoveredHostConfigs(cwd: string): McpConfig {
  let config: McpConfig = { mcpServers: {} };
  for (const importKind of importKinds()) {
    const imported = loadImportedConfig(importKind, cwd, `Failed to discover imported MCP config from ${importKind}:`);
    if (!imported) continue;
    config = mergeConfigs(config, {
      mcpServers: extractServers(imported.value, importKind),
    });
  }
  return config;
}

function getConfigConflicts(
  sourceSpecs: ConfigSourceSpec[],
  imports: ImportConfigSummary[],
  cwd: string,
): McpConfigConflict[] {
  const seen = new Map<string, Array<{ kind: "shared" | "pi" | "host"; path: string }>>();
  const record = (name: string, source: { kind: "shared" | "pi" | "host"; path: string }): void => {
    const entries = seen.get(name) ?? [];
    if (!entries.some((entry) => entry.kind === source.kind && entry.path === source.path)) entries.push(source);
    seen.set(name, entries);
  };

  // Host candidates are listed first because, when enabled, they are the
  // lowest-precedence fallback. The fixed IMPORT_PATHS order is deterministic.
  for (const entry of imports) {
    const imported = loadImportedConfig(entry.kind, cwd, `Failed to inspect imported MCP config from ${entry.kind}:`);
    if (!imported) continue;
    for (const name of Object.keys(extractServers(imported.value, entry.kind))) {
      record(name, { kind: "host", path: imported.path });
    }
  }
  for (const source of sourceSpecs) {
    const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
    if (!loaded) continue;
    if (loaded.imports?.length) {
      for (const importKind of loaded.imports) {
        const imported = loadImportedConfig(importKind, cwd, `Failed to inspect imported MCP config from ${importKind}:`);
        if (!imported) continue;
        for (const name of Object.keys(extractServers(imported.value, importKind))) {
          record(name, { kind: "host", path: imported.path });
        }
      }
    }
    for (const name of Object.keys(loaded.mcpServers)) {
      record(name, {
        kind: source.shared ? "shared" : "pi",
        path: source.readPath,
      });
    }
  }

  return [...seen.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([serverName, sources]) => ({ serverName, sources, winner: sources[sources.length - 1]! }))
    .sort((left, right) => left.serverName.localeCompare(right.serverName));
}

function getConfigSources(overridePath?: string, cwd = process.cwd()): ConfigSourceSpec[] {
  const userPath = getPiGlobalConfigPath(overridePath);
  const genericGlobalConfigPath = getGenericGlobalConfigPath();
  const projectPath = getProjectConfigPath(cwd);
  const projectPiPath = getProjectPiConfigPath(cwd);
  const sources: ConfigSourceSpec[] = [];

  if (genericGlobalConfigPath !== userPath) {
    sources.push({
      id: "shared-global",
      label: "user-global standard MCP",
      readPath: genericGlobalConfigPath,
      writePath: userPath,
      kind: "import",
      importKind: "global MCP config",
      shared: true,
      scope: "global",
    });
  }

  for (const [index, agentsPath] of AGENTS_GLOBAL_CONFIG_PATHS.entries()) {
    if (agentsPath === userPath || agentsPath === genericGlobalConfigPath) continue;
    sources.push({
      id: index === 0 ? "agents-global" : "agents-nested-global",
      label: index === 0 ? "user-global .agents MCP" : "user-global .agents nested MCP",
      readPath: agentsPath,
      writePath: userPath,
      kind: "import",
      importKind: index === 0 ? ".agents MCP config" : ".agents/mcp MCP config",
      shared: true,
      scope: "global",
    });
  }

  sources.push({
    id: "pi-global",
    label: "Pi global override",
    readPath: userPath,
    writePath: userPath,
    kind: "user",
    shared: false,
    scope: "global",
  });

  if (projectPath !== userPath) {
    sources.push({
      id: "shared-project",
      label: "project standard MCP",
      readPath: projectPath,
      writePath: projectPath,
      kind: "project",
      shared: true,
      scope: "project",
    });
  }

  if (projectPiPath !== userPath && projectPiPath !== projectPath) {
    sources.push({
      id: "pi-project",
      label: "project Pi override",
      readPath: projectPiPath,
      writePath: projectPiPath,
      kind: "project",
      shared: false,
      scope: "project",
    });
  }

  return sources;
}

function mergeConfigs(base: McpConfig, next: McpConfig): McpConfig {
  return {
    mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
    imports: mergeImports(base.imports, next.imports),
    settings: next.settings ? { ...base.settings, ...next.settings } : base.settings,
  };
}

// Credential-bearing fields whose value is bound to a specific server `url`.
// When a higher-precedence config source repoints an existing server at a
// different url, these MUST NOT be inherited from the lower-precedence entry —
// otherwise the original endpoint's credentials would be shipped to the new
// url. See the SECURITY note in mergeServerMaps.
const URL_BOUND_AUTH_FIELDS = ["headers", "bearerToken", "bearerTokenEnv"] as const;

function mergeServerMaps(
  base: ServerMap,
  next: ServerMap,
): ServerMap {
  const merged = { ...base };
  for (const [name, definition] of Object.entries(next)) {
    const existing = Object.hasOwn(merged, name) ? merged[name] : undefined;
    // SECURITY (credential/url binding): the merge is per-field, so a
    // higher-precedence source that supplies only a new `url` for an existing
    // server would otherwise retain the lower-precedence entry's auth material
    // (Authorization header, bearer token, OAuth config) and send it to the new
    // url — a credential-exfiltration vector when the higher-precedence source
    // is less trusted than the one that first defined the server. Bind auth to
    // the url that supplied it: when the url changes, drop inherited auth
    // material before merging. Auth explicitly re-supplied by `definition` still
    // applies (it is spread last). Behaviour is unchanged when the url is
    // identical or the override omits `url` (partial overrides still inherit).
    let baseEntry: ServerEntry = existing ?? {};
    if (existing && isRuntimeString(definition.socket)) {
      baseEntry = { ...existing };
      for (const field of [
        "command", "args", "env", "cwd", "url", "headers", "auth",
        "bearerToken", "bearerTokenEnv", "oauth",
      ] as const) {
        delete baseEntry[field];
      }
    } else if (existing?.socket && (isRuntimeString(definition.command) || isRuntimeString(definition.url))) {
      baseEntry = { ...existing };
      delete baseEntry.socket;
    }
    if (existing && isRuntimeString(definition.url) && definition.url !== existing.url) {
      if (baseEntry === existing) baseEntry = { ...existing };
      for (const field of URL_BOUND_AUTH_FIELDS) {
        delete baseEntry[field];
      }
      if (baseEntry.oauth !== false) {
        delete baseEntry.oauth;
      }
    }
    setServer(merged, name, { ...baseEntry, ...definition });
  }
  return merged;
}

function mergeImports(left: ImportKind[] | undefined, right: ImportKind[] | undefined): ImportKind[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  if (merged.length === 0) return undefined;
  return [...new Set(merged)];
}

function expandImports(config: McpConfig, cwd = process.cwd()): McpConfig {
  if (!config.imports?.length) return config;

  const importedServers: Record<string, ServerEntry> = {};
  for (const importKind of config.imports) {
    const imported = loadImportedConfig(importKind, cwd, `Failed to import MCP config from ${importKind}:`);
    if (!imported) continue;

    const servers = extractServers(imported.value, importKind);
    for (const [name, definition] of Object.entries(servers)) {
      if (!Object.hasOwn(importedServers, name)) {
        setServer(importedServers, name, definition);
      }
    }
  }

  return {
    imports: config.imports,
    settings: config.settings,
    mcpServers: mergeServerMaps(importedServers, config.mcpServers),
  };
}

function resolveImportCandidates(importKind: ImportKind, cwd: string): string[] {
  return (IMPORT_PATHS[importKind] ?? []).map((candidate) => {
    if (importKind === "opencode" && candidate === "./opencode.json") {
      const start = resolve(cwd);
      let gitRoot: string | undefined;
      let current = start;
      while (true) {
        if (existsSync(join(current, ".git"))) {
          gitRoot = current;
          break;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }

      if (!gitRoot) return join(start, "opencode.json");
      current = start;
      while (true) {
        const projectConfig = join(current, "opencode.json");
        if (existsSync(projectConfig) || current === gitRoot) return projectConfig;
        current = dirname(current);
      }
    }
    return candidate.startsWith(".") ? resolve(cwd, candidate) : candidate;
  });
}

function parseJsonConfig(raw: string): JsonInputValue {
  return parseJsonValue(stripJsonComments(raw, { trailingCommas: true }));
}

function readImportedConfig(path: string): JsonInputValue {
  const raw = readFileSync(path, "utf-8");
  const value = path.endsWith(".toml") ? parseToml(raw) : parseJsonConfig(raw);
  if (!isJsonInputValue(value)) throw new TypeError(`Imported MCP config at ${path} is not JSON-compatible`);
  return value;
}

function loadImportedConfig(
  importKind: ImportKind,
  cwd: string,
  warningPrefix: string,
): { path: string; value: JsonInputValue } | null {
  if (importKind === "opencode") {
    let merged: JsonInputObject = {};
    let highestPrecedencePath: string | undefined;

    for (const path of resolveImportCandidates(importKind, cwd)) {
      if (!existsSync(path)) continue;

      try {
        const value = readImportedConfig(path);
        if (isJsonInputObject(value)) {
          merged = mergeOpenCodeConfigs(merged, value);
          highestPrecedencePath = path;
        }
      } catch (error) {
        logger.warn(warningPrefix, { error: error instanceof Error ? error.message : String(error), path });
      }
    }

    return highestPrecedencePath ? { path: highestPrecedencePath, value: merged } : null;
  }

  for (const path of resolveImportCandidates(importKind, cwd)) {
    if (!existsSync(path)) continue;

    try {
      return { path, value: readImportedConfig(path) };
    } catch (error) {
      logger.warn(warningPrefix, { error: error instanceof Error ? error.message : String(error), path });
    }
  }

  return null;
}

function resolveImportPath(importKind: ImportKind, cwd = process.cwd()): string | null {
  return loadImportedConfig(importKind, cwd, `Failed to discover imported MCP config from ${importKind}:`)?.path ?? null;
}

function readValidatedConfig(path: string, label: string): McpConfig | null {
  if (!existsSync(path)) return null;

  try {
    return validateConfig(parseJsonConfig(readFileSync(path, "utf-8")));
  } catch (error) {
    logger.warn(`Failed to load ${label}`, {
      error: error instanceof Error ? error.message : String(error),
      path,
    });
    return null;
  }
}

function validateConfig(raw: JsonInputValue): McpConfig {
  if (!isJsonInputObject(raw)) {
    return { mcpServers: {} };
  }

  const servers = raw.mcpServers ?? raw["mcp-servers"] ?? {};
	  const rawImports = raw.imports;
	  let imports: ImportKind[] | undefined;
	  if (rawImports !== undefined) {
	    if (!Array.isArray(rawImports) || !rawImports.every((kind) => isRuntimeString(kind) && isImportKind(kind))) {
	      throw new TypeError("MCP config imports contains an unsupported config kind");
	    }
	    imports = rawImports.filter((kind): kind is ImportKind => isRuntimeString(kind) && isImportKind(kind));
	  }
  return {
    mcpServers: parseServerMap(servers, "MCP config mcpServers"),
    imports,
    settings: parseMcpSettings(raw.settings),
  };
}

function mergeOpenCodeConfigs(base: JsonInputObject, next: JsonInputObject): JsonInputObject {
  const baseMcp = base.mcp;
  const nextMcp = next.mcp;
  const mergedMcp: JsonInputObject = isJsonInputObject(baseMcp) ? copyJsonInputObject(baseMcp) : {};

  if (isJsonInputObject(nextMcp)) {
    for (const [name, nextEntry] of Object.entries(nextMcp)) {
      const baseEntry = Object.hasOwn(mergedMcp, name) ? mergedMcp[name] : undefined;
      if (
        isJsonInputObject(baseEntry)
        && isJsonInputObject(nextEntry)
      ) {
	        const safeBase = copyJsonInputObject(baseEntry);
        const override = nextEntry;
        if (isRuntimeString(override.type) && override.type !== safeBase.type) {
          for (const field of ["command", "environment", "cwd", "url", "headers", "oauth"]) delete safeBase[field];
        }
        if (isRuntimeString(override.url) && override.url !== safeBase.url) {
          delete safeBase.headers;
          delete safeBase.oauth;
        }
        if (Array.isArray(override.command)) {
          const baseCommand = safeBase.command;
          const commandChanged = !Array.isArray(baseCommand)
            || override.command.length !== baseCommand.length
            || override.command.some((value, index) => value !== baseCommand[index]);
          if (commandChanged) {
            delete safeBase.environment;
            delete safeBase.cwd;
          }
        }

	        const mergedEntry = copyJsonInputObject(safeBase, override);
        for (const field of ["environment", "headers", "oauth"]) {
          const baseField = safeBase[field];
          const nextField = override[field];
          if (
            isJsonInputObject(baseField)
            && isJsonInputObject(nextField)
          ) {
	            mergedEntry[field] = copyJsonInputObject(baseField, nextField);
          }
        }
        setJsonInputProperty(mergedMcp, name, mergedEntry);
      } else {
        setJsonInputProperty(mergedMcp, name, nextEntry);
      }
    }
  }

  return { ...base, ...next, mcp: mergedMcp };
}

function extractServers(config: JsonInputValue, kind: ImportKind): ServerMap {
  if (!isJsonInputObject(config)) return {};

  let servers: JsonInputValue;
  switch (kind) {
    case "claude-desktop":
    case "claude-code":
      servers = config.mcpServers;
      break;
    case "codex":
      servers = config.mcp_servers ?? config.mcpServers;
      break;
    case "cursor":
    case "windsurf":
    case "vscode":
      servers = config.mcpServers ?? config["mcp-servers"];
      break;
    case "opencode":
      servers = config.mcp;
      break;
    default:
      return {};
  }

  if (!isJsonInputObject(servers)) {
    return {};
  }

  const mappedServers: ServerMap = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (kind === "opencode") {
      if (!isJsonInputObject(entry)) continue;
      const raw = entry;
      if (raw.enabled === false) continue;

      if (raw.type === "local" && Array.isArray(raw.command) && raw.command.length > 0 && raw.command.every((value): value is string => isRuntimeString(value))) {
        const env = toStringRecord(raw.environment);
        const mapped: ServerEntry = {
          command: raw.command[0],
          args: raw.command.slice(1),
        };
        if (env) mapped.env = env;
        if (isRuntimeString(raw.cwd)) mapped.cwd = raw.cwd;
        setServer(mappedServers, name, mapped);
        continue;
      }

      if (raw.type === "remote" && isRuntimeString(raw.url)) {
        const headers = toStringRecord(raw.headers);
        const mapped: ServerEntry = { url: raw.url };
        if (headers) mapped.headers = headers;
        if (raw.oauth === false) {
          mapped.oauth = false;
        } else if (isJsonInputObject(raw.oauth)) {
          const oauth = raw.oauth;
          mapped.auth = "oauth";
          const oauthConfig: NonNullable<Exclude<ServerEntry["oauth"], false>> = {};
          if (isRuntimeString(oauth.clientId)) oauthConfig.clientId = oauth.clientId;
          if (isRuntimeString(oauth.clientSecret)) oauthConfig.clientSecret = oauth.clientSecret;
          if (isRuntimeString(oauth.scope)) oauthConfig.scope = oauth.scope;
          mapped.oauth = oauthConfig;
        }
        setServer(mappedServers, name, mapped);
      }
      continue;
    }

    if (kind !== "codex" || !isJsonInputObject(entry)) {
      setServer(mappedServers, name, parseServerEntry(entry, `${kind} MCP server ${name}`));
      continue;
    }

	    const mapped = copyJsonInputObject(entry);
    const bearerTokenEnv = mapped.bearer_token_env_var;
    const httpHeaders = mapped.http_headers;
    const envHttpHeaders = mapped.env_http_headers;

    if (isRuntimeString(bearerTokenEnv)) {
      mapped.bearerTokenEnv = bearerTokenEnv;
      if (mapped.auth === undefined) mapped.auth = "bearer";
    }
    const parsedHttpHeaders = toStringRecord(httpHeaders);
    if (parsedHttpHeaders) {
      mapped.headers = { ...toStringRecord(mapped.headers), ...parsedHttpHeaders };
    }
    if (isJsonInputObject(envHttpHeaders)) {
      const headers = { ...toStringRecord(mapped.headers) };
      for (const [header, envVar] of Object.entries(envHttpHeaders)) {
        if (isRuntimeString(envVar) && !Object.hasOwn(headers, header)) {
          Object.defineProperty(headers, header, {
            configurable: true,
            enumerable: true,
            value: `$env:${envVar}`,
            writable: true,
          });
        }
      }
      mapped.headers = headers;
    }

    delete mapped.bearer_token_env_var;
    delete mapped.http_headers;
    delete mapped.env_http_headers;
    setServer(mappedServers, name, parseServerEntry(mapped, `codex MCP server ${name}`));
  }

  return mappedServers;
}

function serializeRawConfig(raw: JsonInputObject): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

function buildUnifiedDiff(beforeText: string, afterText: string): string {
  if (beforeText === afterText) return "(no changes)";

  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  const rows = before.length;
  const cols = after.length;
  const lcs = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: string[] = ["--- before", "+++ after"];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && before[i] === after[j]) {
      lines.push(`  ${before[i]}`);
      i++;
      j++;
      continue;
    }
    if (j < cols && (i === rows || lcs[i][j + 1] >= lcs[i + 1][j])) {
      lines.push(`+ ${after[j]}`);
      j++;
      continue;
    }
    if (i < rows) {
      lines.push(`- ${before[i]}`);
      i++;
    }
  }

  return lines.join("\n");
}

function buildConfigWritePreview(filePath: string, nextRaw: JsonInputObject): ConfigWritePreview {
  const existed = existsSync(filePath);
  const beforeRaw = readRawConfigObject(filePath);
  const beforeText = existed ? serializeRawConfig(beforeRaw) : "";
  const afterText = serializeRawConfig(nextRaw);
  return {
    path: filePath,
    existed,
    changed: beforeText !== afterText,
    beforeText,
    afterText,
    diffText: buildUnifiedDiff(beforeText, afterText),
  };
}

function readRawConfigObject(filePath: string): JsonInputObject {
  if (!existsSync(filePath)) return {};

  try {
    const raw = parseJsonConfig(readFileSync(filePath, "utf-8"));
		if (!isJsonInputObject(raw)) {
			throw new Error("root value must be an object");
		}
	    return raw;
  } catch (error) {
		throw new Error(
			`Failed to read MCP config at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
  }
}

function resolveConfigWritePath(filePath: string): string {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });
  return existsSync(filePath) ? realpathSync(filePath) : join(realpathSync(directory), basename(filePath));
}

function writeRawConfigObject(filePath: string, raw: JsonInputObject): void {
	const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(raw, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    renameSync(tmpPath, filePath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

function withConfigWriteLock<T>(filePath: string, write: (writePath: string) => T): Promise<T> {
  const writePath = resolveConfigWritePath(filePath);
  return withSettingsLock(writePath, "MCP config", () => write(writePath));
}

async function withProjectConfigWriteLock<T>(cwd: string, write: (writePath: string) => T | Promise<T>): Promise<T> {
  const filePath = getProjectPiConfigPath(cwd);
	for (const candidate of [dirname(filePath), filePath]) {
		if (lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) {
			throw new Error(`Refusing to write project MCP config through a symbolic link at ${candidate}`);
		}
  }
  const writePath = resolveConfigWritePath(filePath);
  const projectRoot = realpathSync(cwd);
  const projectRelative = relative(projectRoot, writePath);
  if (projectRelative === ".." || projectRelative.startsWith(`..${sep}`) || isAbsolute(projectRelative)) {
    throw new Error(`Project MCP config escapes the project root: ${filePath}`);
  }
	const directoryDescriptor = openSync(
		dirname(writePath),
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	const pinnedWritePath = join("/proc/self/fd", String(directoryDescriptor), basename(writePath));
	try {
		return await withSettingsLock(pinnedWritePath, "MCP project config", () => write(pinnedWritePath));
	} finally {
		closeSync(directoryDescriptor);
	}
}

function getServersObject(raw: JsonInputObject): ServerMap {
  const existing = raw.mcpServers ?? raw["mcp-servers"] ?? {};
	if (!isJsonInputObject(existing)) {
			throw new Error("MCP config mcpServers must be an object");
	  }
	  return parseServerMap(existing, "MCP config mcpServers");
}

function setServersObject(raw: JsonInputObject, servers: Record<string, ServerEntry>): void {
  delete raw["mcp-servers"];
	  raw.mcpServers = requireJsonInputValue(servers, "MCP server configuration");
}

export interface ServerDisabledOverrideResult {
  path: string;
  changed: boolean;
}

interface ProjectServerOverride {
  existing: JsonInputObject | undefined;
  filePath: string;
  writePath: string;
  raw: JsonInputObject;
  serverKey: "mcpServers" | "mcp-servers";
  servers: JsonInputObject;
}

function readProjectServerOverride(writePath: string, filePath: string, serverName: string): ProjectServerOverride {
  let raw: JsonInputObject = {};
  if (existsSync(writePath)) {
		let descriptor: number | undefined;
    try {
			descriptor = openSync(writePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const parsed = parseJsonConfig(readFileSync(descriptor, "utf-8"));
	      if (!isJsonInputObject(parsed)) {
	        throw new Error("root value must be an object");
	      }
	      raw = parsed;
    } catch (error) {
      throw new Error(`Failed to read project MCP override at ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		} finally {
			if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  const serverKey = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
  const rawServers = raw[serverKey];
	  if (rawServers !== undefined && !isJsonInputObject(rawServers)) {
	    throw new Error(`Failed to update project MCP override at ${filePath}: ${serverKey} must be an object`);
	  }
	  const servers: JsonInputObject = isJsonInputObject(rawServers) ? rawServers : {};
	  const previous = Object.hasOwn(servers, serverName) ? servers[serverName] : undefined;
	  if (previous !== undefined && !isJsonInputObject(previous)) {
	    throw new Error(`Failed to update project MCP override at ${filePath}: server "${serverName}" must be an object`);
	  }
	  return {
	    existing: isJsonInputObject(previous) ? previous : undefined,
	    filePath,
	    raw,
	    serverKey,
	    servers,
	    writePath,
	  };
}

function writeProjectServerOverride(
  override: ProjectServerOverride,
  serverName: string,
  next: JsonInputObject,
): ServerDisabledOverrideResult {
  const { existing, filePath, raw, serverKey, servers, writePath } = override;
  if ((!existing && Object.keys(next).length === 0) || JSON.stringify(existing) === JSON.stringify(next)) {
    return { path: filePath, changed: false };
  }
  if (Object.keys(next).length === 0) delete servers[serverName];
  else Object.defineProperty(servers, serverName, { configurable: true, enumerable: true, value: next, writable: true });
  raw[serverKey] = servers;
  writeRawConfigObject(writePath, raw);
  return { path: filePath, changed: true };
}

/**
 * Persist only the disabled field in the project Pi layer. Enabling writes an
 * explicit false only when a lower-precedence source is itself disabled; this
 * writer never copies a server definition or its credentials into the file.
 * A custom global config participates only in that lower-precedence lookup;
 * the mutation target remains the project Pi layer.
 */
export function writeProjectServerDisabledOverride(
	globalConfigPath: string | undefined,
	cwd: string,
  serverName: string,
  disabled: boolean,
): Promise<ServerDisabledOverrideResult> {
	return withProjectConfigWriteLock(cwd, (writePath) =>
		writeProjectServerDisabledOverrideUnlocked(globalConfigPath, cwd, writePath, serverName, disabled),
	);
}

function writeProjectServerDisabledOverrideUnlocked(
	globalConfigPath: string | undefined,
  cwd: string,
  writePath: string,
  serverName: string,
  disabled: boolean,
): ServerDisabledOverrideResult {
  const override = readProjectServerOverride(writePath, getProjectPiConfigPath(cwd), serverName);
  const { existing, filePath, raw } = override;

  let next: JsonInputObject;
  if (disabled) {
    next = { ...existing, disabled: true };
  } else {
    next = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => key !== "disabled"));
    let lowerConfig: McpConfig = { mcpServers: {} };
		const projectTarget = existsSync(writePath) ? realpathSync(writePath) : null;
		for (const source of getConfigSources(globalConfigPath, cwd)) {
			if (
				source.id === "pi-project"
				|| source.readPath === filePath
				|| (projectTarget !== null && existsSync(source.readPath) && realpathSync(source.readPath) === projectTarget)
			) continue;
      const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
      if (loaded) lowerConfig = mergeConfigs(lowerConfig, expandImports(loaded, cwd));
    }
    if (raw.imports !== undefined) {
      if (!Array.isArray(raw.imports) || raw.imports.some((kind) => !isRuntimeString(kind) || !Object.hasOwn(IMPORT_PATHS, kind))) {
        throw new Error(`Failed to update project MCP override at ${filePath}: imports contains an unsupported config kind`);
      }
	      const imports = raw.imports.filter((kind): kind is ImportKind => isRuntimeString(kind) && isImportKind(kind));
	      lowerConfig = mergeConfigs(lowerConfig, expandImports({ mcpServers: {}, imports }, cwd));
    }
    if (isServerDisabled(lowerConfig.mcpServers[serverName])) next.disabled = false;
  }
  return writeProjectServerOverride(override, serverName, next);
}

/** Persist only a server's connection policy in the project Pi layer. */
export function writeProjectServerLifecycleOverride(
  cwd: string,
  serverName: string,
  lifecycle: "keep-alive" | "lazy",
): Promise<ServerDisabledOverrideResult> {
  return withProjectConfigWriteLock(cwd, (writePath) => {
    const override = readProjectServerOverride(writePath, getProjectPiConfigPath(cwd), serverName);
    return writeProjectServerOverride(override, serverName, { ...override.existing, lifecycle });
  });
}

function isRepoPromptServer(name: string, entry: ServerEntry): boolean {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes("repoprompt") || normalizedName === "rp") {
    return true;
  }

  const command = entry.command?.toLowerCase() ?? "";
  if (command.includes("repoprompt") || command.includes("rp-mcp") || command.endsWith("repoprompt_cli")) {
    return true;
  }

  return (entry.args ?? []).some((arg) => isRuntimeString(arg) && arg.toLowerCase().includes("repoprompt"));
}

function findProjectRoot(cwd = process.cwd()): string | null {
  let current = resolve(cwd);
  while (true) {
    if (
      existsSync(join(current, ".git"))
      || existsSync(join(current, "package.json"))
      || existsSync(join(current, PROJECT_CONFIG_NAME))
      || existsSync(join(current, ".pi"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function buildRepoPromptEntry(executablePath: string): ServerEntry {
  return {
    command: executablePath,
    args: [],
    lifecycle: "lazy",
  };
}

function detectRepoPrompt(summary: Omit<McpDiscoverySummary, "fingerprint" | "repoPrompt">, cwd = process.cwd()): RepoPromptDiscovery {
  for (const source of summary.sources) {
    if (source.kind !== "shared" || source.serverCount === 0) continue;
    const config = readValidatedConfig(source.path, `MCP config from ${source.path}`);
    if (!config) continue;
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      if (isRepoPromptServer(name, entry)) {
        return { configured: true, configuredPath: source.path };
      }
    }
  }

  const executablePath = REPOPROMPT_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    return { configured: false };
  }

  const projectRoot = findProjectRoot(cwd);
  const targetPath = projectRoot ? join(projectRoot, PROJECT_CONFIG_NAME) : getGenericGlobalConfigPath();
  return {
    configured: false,
    executablePath,
    targetPath,
    serverName: "repoprompt",
    entry: buildRepoPromptEntry(executablePath),
  };
}

export function previewCompatibilityImports(importKinds: ImportKind[], overridePath?: string): ConfigWritePreview {
  const targetPath = getPiGlobalConfigPath(overridePath);
  const raw = readRawConfigObject(targetPath);
  const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value): value is ImportKind => isRuntimeString(value)) : [];
  const merged = [...new Set([...currentImports, ...importKinds])];
  const nextRaw = { ...raw, imports: merged };
  setServersObject(nextRaw, getServersObject(nextRaw));
  return buildConfigWritePreview(targetPath, nextRaw);
}

export function ensureCompatibilityImports(importKinds: ImportKind[], overridePath?: string): Promise<{ path: string; added: ImportKind[] }> {
  const targetPath = getPiGlobalConfigPath(overridePath);
  return withConfigWriteLock(targetPath, (writePath) => {
    const raw = readRawConfigObject(writePath);
    const currentImports = Array.isArray(raw.imports) ? raw.imports.filter((value): value is ImportKind => isRuntimeString(value)) : [];
    const merged = [...new Set([...currentImports, ...importKinds])];
    const added = merged.filter((kind) => !currentImports.includes(kind));
    if (added.length === 0) return { path: targetPath, added: [] };

    raw.imports = merged;
    setServersObject(raw, getServersObject(raw));
    writeRawConfigObject(writePath, raw);
    return { path: targetPath, added };
  });
}

export function buildStarterProjectConfig(): McpConfig {
  return {
    mcpServers: {},
  };
}

export function previewStarterProjectConfig(cwd = process.cwd()): ConfigWritePreview {
  const targetPath = getProjectConfigPath(cwd);
	  const nextRaw: JsonInputObject = { mcpServers: {} };
  return buildConfigWritePreview(targetPath, nextRaw);
}

export function writeStarterProjectConfig(cwd = process.cwd()): Promise<string> {
  const targetPath = getProjectConfigPath(cwd);
  return withConfigWriteLock(targetPath, (writePath) => {
    if (existsSync(targetPath)) throw new Error(`Refusing to replace existing MCP config at ${targetPath}`);
	    writeRawConfigObject(writePath, { mcpServers: {} });
    return targetPath;
  });
}

export function previewSharedServerEntry(filePath: string, serverName: string, entry: ServerEntry): ConfigWritePreview {
  const raw = readRawConfigObject(filePath);
  const nextRaw = { ...raw };
  const servers = getServersObject(nextRaw);
  setServer(servers, serverName, entry);
  setServersObject(nextRaw, servers);
  return buildConfigWritePreview(filePath, nextRaw);
}

export function writeSharedServerEntry(filePath: string, serverName: string, entry: ServerEntry): Promise<string> {
  return withConfigWriteLock(filePath, (writePath) => {
    const raw = readRawConfigObject(writePath);
    const servers = getServersObject(raw);
    Object.defineProperty(servers, serverName, { configurable: true, enumerable: true, value: entry, writable: true });
    setServersObject(raw, servers);
    writeRawConfigObject(writePath, raw);
    return filePath;
  });
}

export function resolveConfiguredOAuthDir(raw: JsonInputValue, cwd = process.cwd()): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRuntimeString(raw)) {
    throw new Error("settings.oauthDir must be a string");
  }

  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return resolve(cwd, trimmed);
}
