import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { xdgConfigHome } from "../../xdg/index.ts";
import { getAgentPath } from "./agent-dir.ts";
import { extractServers, importKinds, loadImportedConfig, readValidatedConfig } from "./config-codecs.ts";
import type { HostConfigDiscovery, ImportKind, ServerEntry } from "./types.ts";

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

export interface ConfigSourceSpec {
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
export function getConfiguredHostConfigDiscovery(overridePath?: string, cwd = process.cwd()): HostConfigDiscovery {
	let configured: HostConfigDiscovery = "off";
	for (const source of getConfigSources(overridePath, cwd)) {
		const loaded = readValidatedConfig(source.readPath, `MCP config from ${source.readPath}`);
		const value = loaded?.settings?.hostConfigDiscovery;
		if (value === "off" || value === "prompt" || value === "on") configured = value;
	}
	return configured;
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

export function getConfigSources(overridePath?: string, cwd = process.cwd()): ConfigSourceSpec[] {
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
