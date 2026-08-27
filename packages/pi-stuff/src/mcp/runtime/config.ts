// config.ts - Config loading with import support

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	isJsonInputObject,
	type JsonInputObject,
	type JsonInputValue,
	requireJsonInputValue,
} from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { xdgConfigHome } from "../../xdg/index.ts";
import {
	buildConfigWritePreview,
	type ConfigWritePreview,
	readProjectServerOverride,
	readRawConfigObject,
	type ServerDisabledOverrideResult,
	withConfigWriteLock,
	withProjectConfigWriteLock,
	writeProjectServerOverride,
	writeRawConfigObject,
} from "../config-persistence.ts";
import { getAgentPath } from "./agent-dir.ts";
import {
	extractServers,
	importKinds,
	isImportKind,
	loadImportedConfig,
	parseServerMap,
	readValidatedConfig,
	type ServerMap,
	setServer,
} from "./config-codecs.ts";
import {
	type HostConfigDiscovery,
	type ImportKind,
	isServerDisabled,
	type McpConfig,
	type ServerEntry,
} from "./types.ts";

export type { ConfigWritePreview, ServerDisabledOverrideResult } from "../config-persistence.ts";

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

interface ConfigSourceSpec {
	id: "shared-global" | "agents-global" | "agents-nested-global" | "pi-global" | "shared-project" | "pi-project";
	label: string;
	readPath: string;
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
		const imported = loadImportedConfig(
			importKind,
			cwd,
			`Failed to discover imported MCP config from ${importKind}:`,
		);
		if (imported) {
			discovered.push({ kind: importKind, path: imported.path });
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
	let config: McpConfig = hostConfigDiscovery === "on" ? loadDiscoveredHostConfigs(cwd) : { mcpServers: {} };

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
		const imported = loadImportedConfig(
			importKind,
			cwd,
			`Failed to discover imported MCP config from ${importKind}:`,
		);
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
				const imported = loadImportedConfig(
					importKind,
					cwd,
					`Failed to inspect imported MCP config from ${importKind}:`,
				);
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
		.map(([serverName, sources]) => ({ serverName, sources, winner: sources.reduce((_winner, source) => source) }))
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
			shared: true,
			scope: "global",
		});
	}

	sources.push({
		id: "pi-global",
		label: "Pi global override",
		readPath: userPath,
		shared: false,
		scope: "global",
	});

	if (projectPath !== userPath) {
		sources.push({
			id: "shared-project",
			label: "project standard MCP",
			readPath: projectPath,
			shared: true,
			scope: "project",
		});
	}

	if (projectPiPath !== userPath && projectPiPath !== projectPath) {
		sources.push({
			id: "pi-project",
			label: "project Pi override",
			readPath: projectPiPath,
			shared: false,
			scope: "project",
		});
	}

	return sources;
}

function mergeConfigs(base: McpConfig, next: McpConfig): McpConfig {
	const imports = mergeImports(base.imports, next.imports);
	const settings = next.settings ? { ...base.settings, ...next.settings } : base.settings;
	const merged: McpConfig = {
		mcpServers: mergeServerMaps(base.mcpServers, next.mcpServers),
	};
	if (imports !== undefined) merged.imports = imports;
	if (settings !== undefined) merged.settings = settings;
	return merged;
}

// Credential-bearing fields whose value is bound to a specific server `url`.
// When a higher-precedence config source repoints an existing server at a
// different url, these MUST NOT be inherited from the lower-precedence entry —
// otherwise the original endpoint's credentials would be shipped to the new
// url. See the SECURITY note in mergeServerMaps.
const URL_BOUND_AUTH_FIELDS = ["headers", "bearerToken", "bearerTokenEnv"] as const;

function mergeServerMaps(base: ServerMap, next: ServerMap): ServerMap {
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
				"command",
				"args",
				"env",
				"cwd",
				"url",
				"headers",
				"auth",
				"bearerToken",
				"bearerTokenEnv",
				"oauth",
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

	const expanded: McpConfig = {
		imports: config.imports,
		mcpServers: mergeServerMaps(importedServers, config.mcpServers),
	};
	if (config.settings !== undefined) expanded.settings = config.settings;
	return expanded;
}

function getServersObject(raw: JsonInputObject): ServerMap {
	const existing = raw["mcpServers"] ?? raw["mcp-servers"] ?? {};
	if (!isJsonInputObject(existing)) {
		throw new Error("MCP config mcpServers must be an object");
	}
	return parseServerMap(existing, "MCP config mcpServers");
}

function setServersObject(raw: JsonInputObject, servers: Record<string, ServerEntry>): void {
	delete raw["mcp-servers"];
	raw["mcpServers"] = requireJsonInputValue(servers, "MCP server configuration");
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
	return withProjectConfigWriteLock(getProjectPiConfigPath(cwd), cwd, (writePath) =>
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
				source.id === "pi-project" ||
				source.readPath === filePath ||
				(projectTarget !== null && existsSync(source.readPath) && realpathSync(source.readPath) === projectTarget)
			)
				continue;
			const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
			if (loaded) lowerConfig = mergeConfigs(lowerConfig, expandImports(loaded, cwd));
		}
		if (raw["imports"] !== undefined) {
			if (
				!Array.isArray(raw["imports"]) ||
				raw["imports"].some((kind) => !isRuntimeString(kind) || !isImportKind(kind))
			) {
				throw new Error(
					`Failed to update project MCP override at ${filePath}: imports contains an unsupported config kind`,
				);
			}
			const imports = raw["imports"].filter(
				(kind): kind is ImportKind => isRuntimeString(kind) && isImportKind(kind),
			);
			lowerConfig = mergeConfigs(lowerConfig, expandImports({ mcpServers: {}, imports }, cwd));
		}
		if (isServerDisabled(lowerConfig.mcpServers[serverName])) next["disabled"] = false;
	}
	return writeProjectServerOverride(override, serverName, next);
}

/** Persist only a server's connection policy in the project Pi layer. */
export function writeProjectServerLifecycleOverride(
	cwd: string,
	serverName: string,
	lifecycle: "keep-alive" | "lazy",
): Promise<ServerDisabledOverrideResult> {
	return withProjectConfigWriteLock(getProjectPiConfigPath(cwd), cwd, (writePath) => {
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
			existsSync(join(current, ".git")) ||
			existsSync(join(current, "package.json")) ||
			existsSync(join(current, PROJECT_CONFIG_NAME)) ||
			existsSync(join(current, ".pi"))
		) {
			return current;
		}

		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function detectRepoPrompt(
	summary: Omit<McpDiscoverySummary, "fingerprint" | "repoPrompt">,
	cwd = process.cwd(),
): RepoPromptDiscovery {
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
		entry: { command: executablePath, args: [], lifecycle: "lazy" },
	};
}

export function previewCompatibilityImports(importKinds: ImportKind[], overridePath?: string): ConfigWritePreview {
	const targetPath = getPiGlobalConfigPath(overridePath);
	const raw = readRawConfigObject(targetPath);
	const currentImports = Array.isArray(raw["imports"])
		? raw["imports"].filter((value): value is ImportKind => isRuntimeString(value))
		: [];
	const merged = [...new Set([...currentImports, ...importKinds])];
	const nextRaw = { ...raw, imports: merged };
	setServersObject(nextRaw, getServersObject(nextRaw));
	return buildConfigWritePreview(targetPath, nextRaw);
}

export function ensureCompatibilityImports(
	importKinds: ImportKind[],
	overridePath?: string,
): Promise<{ path: string; added: ImportKind[] }> {
	const targetPath = getPiGlobalConfigPath(overridePath);
	return withConfigWriteLock(targetPath, (writePath) => {
		const raw = readRawConfigObject(writePath);
		const currentImports = Array.isArray(raw["imports"])
			? raw["imports"].filter((value): value is ImportKind => isRuntimeString(value))
			: [];
		const merged = [...new Set([...currentImports, ...importKinds])];
		const added = merged.filter((kind) => !currentImports.includes(kind));
		if (added.length === 0) return { path: targetPath, added: [] };

		raw["imports"] = merged;
		setServersObject(raw, getServersObject(raw));
		writeRawConfigObject(writePath, raw);
		return { path: targetPath, added };
	});
}

export function buildStarterProjectConfig(): McpConfig {
	return { mcpServers: {} };
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
		setServer(servers, serverName, entry);
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
