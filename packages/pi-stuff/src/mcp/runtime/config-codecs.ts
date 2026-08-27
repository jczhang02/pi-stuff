import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import stripJsonComments from "strip-json-comments";
import {
	isJsonInputObject,
	isJsonInputValue,
	type JsonInputObject,
	type JsonInputValue,
	parseJsonValue,
} from "../../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeString } from "../../shared/runtime-type.js";
import { xdgConfigHome } from "../../xdg/index.ts";
import { logger } from "./logger.ts";
import type { ImportKind, McpConfig, McpSettings, ServerEntry } from "./types.ts";
import { toStringRecord } from "./utils.ts";

const IMPORT_PATHS = {
	cursor: [join(homedir(), ".cursor", "mcp.json")],
	"claude-code": [
		join(homedir(), ".claude", "mcp.json"),
		join(homedir(), ".claude.json"),
		join(homedir(), ".claude", "claude_desktop_config.json"),
	],
	"claude-desktop": [join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")],
	codex: [join(homedir(), ".codex", "config.toml"), join(homedir(), ".codex", "config.json")],
	opencode: [join(xdgConfigHome(), "opencode", "opencode.json"), "./opencode.json"],
	windsurf: [join(homedir(), ".windsurf", "mcp.json")],
	vscode: [".vscode/mcp.json"],
} satisfies Record<ImportKind, string[]>;

export interface ServerMap {
	[serverName: string]: ServerEntry;
}

export function isImportKind(value: string): value is ImportKind {
	return Object.hasOwn(IMPORT_PATHS, value);
}

export function importKinds(): ImportKind[] {
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

	if (
		value["auth"] !== undefined &&
		value["auth"] !== false &&
		value["auth"] !== "oauth" &&
		value["auth"] !== "bearer"
	) {
		throw new TypeError(`${label}.auth must be oauth, bearer, or false`);
	}
	if (
		value["lifecycle"] !== undefined &&
		(!isRuntimeString(value["lifecycle"]) ||
			!["keep-alive", "lazy", "lazy-keep-alive", "eager"].includes(value["lifecycle"]))
	) {
		throw new TypeError(`${label}.lifecycle is unsupported`);
	}
	if (
		value["toolPrefix"] !== undefined &&
		(!isRuntimeString(value["toolPrefix"]) || !["server", "none", "short", "mcp"].includes(value["toolPrefix"]))
	) {
		throw new TypeError(`${label}.toolPrefix is unsupported`);
	}
	const approveTools = value["approveTools"];
	if (
		approveTools !== undefined &&
		!isRuntimeBoolean(approveTools) &&
		(!Array.isArray(approveTools) || !approveTools.every(isRuntimeString))
	) {
		throw new TypeError(`${label}.approveTools must be a boolean or an array of strings`);
	}
	if (value["oauth"] !== undefined && value["oauth"] !== false) {
		if (!isJsonInputObject(value["oauth"])) throw new TypeError(`${label}.oauth must be an object or false`);
		for (const key of ["clientId", "clientSecret", "scope", "redirectUri", "clientName", "clientUri"]) {
			validateOptionalString(value["oauth"], key, `${label}.oauth`);
		}
		if (
			value["oauth"]["grantType"] !== undefined &&
			value["oauth"]["grantType"] !== "authorization_code" &&
			value["oauth"]["grantType"] !== "client_credentials"
		) {
			throw new TypeError(`${label}.oauth.grantType is unsupported`);
		}
		validateOptionalStringRecord(value["oauth"], "authorizationParams", `${label}.oauth`);
	}

	// SAFETY: every typed ServerEntry field is validated above; extra JSON fields remain inert compatibility data.
	return value as ServerEntry;
}

function parseMcpSettings(value: JsonInputValue): McpSettings | undefined {
	if (value === undefined) return undefined;
	if (!isJsonInputObject(value)) throw new TypeError("MCP config settings must be an object");
	for (const key of ["showStatusIcon", "autoAuth"]) validateOptionalBoolean(value, key, "settings");
	for (const key of ["idleTimeout", "requestTimeoutMs"]) validateOptionalNumber(value, key, "settings");
	for (const key of ["authRequiredMessage", "oauthDir"]) validateOptionalString(value, key, "settings");
	if (
		value["toolPrefix"] !== undefined &&
		(!isRuntimeString(value["toolPrefix"]) || !["server", "none", "short", "mcp"].includes(value["toolPrefix"]))
	) {
		throw new TypeError("settings.toolPrefix is unsupported");
	}
	if (
		value["mcpFooterStatus"] !== undefined &&
		(!isRuntimeString(value["mcpFooterStatus"]) || !["full", "compact", "off"].includes(value["mcpFooterStatus"]))
	) {
		throw new TypeError("settings.mcpFooterStatus is unsupported");
	}
	if (
		value["hostConfigDiscovery"] !== undefined &&
		(!isRuntimeString(value["hostConfigDiscovery"]) ||
			!["off", "prompt", "on"].includes(value["hostConfigDiscovery"]))
	) {
		throw new TypeError("settings.hostConfigDiscovery is unsupported");
	}
	const approveTools = value["approveTools"];
	if (
		approveTools !== undefined &&
		!isRuntimeBoolean(approveTools) &&
		(!Array.isArray(approveTools) || !approveTools.every(isRuntimeString))
	) {
		throw new TypeError("settings.approveTools must be a boolean or an array of strings");
	}
	const outputGuard = value["outputGuard"];
	if (outputGuard !== undefined && !isRuntimeBoolean(outputGuard)) {
		if (!isJsonInputObject(outputGuard)) throw new TypeError("settings.outputGuard must be a boolean or an object");
		for (const key of ["maxBytes", "maxLines", "detailsMaxBytes"])
			validateOptionalNumber(outputGuard, key, "settings.outputGuard");
	}
	const trace = value["trace"];
	if (trace !== undefined) {
		if (!isJsonInputObject(trace)) throw new TypeError("settings.trace must be an object");
		validateOptionalBoolean(trace, "enabled", "settings.trace");
		validateOptionalString(trace, "file", "settings.trace");
		for (const key of ["maxBytes", "maxEvents"]) validateOptionalNumber(trace, key, "settings.trace");
	}

	// SAFETY: every McpSettings field and nested settings object is validated above.
	return value as McpSettings;
}

export function parseServerMap(value: JsonInputValue, label: string): ServerMap {
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

export function setServer(map: ServerMap, name: string, entry: ServerEntry): void {
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

export function loadImportedConfig(
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

export function readValidatedConfig(path: string, label: string): McpConfig | null {
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

	const servers = raw["mcpServers"] ?? raw["mcp-servers"] ?? {};
	const rawImports = raw["imports"];
	let imports: ImportKind[] | undefined;
	if (rawImports !== undefined) {
		if (!Array.isArray(rawImports) || !rawImports.every((kind) => isRuntimeString(kind) && isImportKind(kind))) {
			throw new TypeError("MCP config imports contains an unsupported config kind");
		}
		imports = rawImports.filter((kind): kind is ImportKind => isRuntimeString(kind) && isImportKind(kind));
	}
	const settings = parseMcpSettings(raw["settings"]);
	const config: McpConfig = {
		mcpServers: parseServerMap(servers, "MCP config mcpServers"),
	};
	if (imports !== undefined) config.imports = imports;
	if (settings !== undefined) config.settings = settings;
	return config;
}

function mergeOpenCodeConfigs(base: JsonInputObject, next: JsonInputObject): JsonInputObject {
	const baseMcp = base["mcp"];
	const nextMcp = next["mcp"];
	const mergedMcp: JsonInputObject = isJsonInputObject(baseMcp) ? copyJsonInputObject(baseMcp) : {};

	if (isJsonInputObject(nextMcp)) {
		for (const [name, nextEntry] of Object.entries(nextMcp)) {
			const baseEntry = Object.hasOwn(mergedMcp, name) ? mergedMcp[name] : undefined;
			if (isJsonInputObject(baseEntry) && isJsonInputObject(nextEntry)) {
				const safeBase = copyJsonInputObject(baseEntry);
				const override = nextEntry;
				if (isRuntimeString(override["type"]) && override["type"] !== safeBase["type"]) {
					for (const field of ["command", "environment", "cwd", "url", "headers", "oauth"]) delete safeBase[field];
				}
				if (isRuntimeString(override["url"]) && override["url"] !== safeBase["url"]) {
					delete safeBase["headers"];
					delete safeBase["oauth"];
				}
				if (Array.isArray(override["command"])) {
					const baseCommand = safeBase["command"];
					const commandChanged =
						!Array.isArray(baseCommand) ||
						override["command"].length !== baseCommand.length ||
						override["command"].some((value, index) => value !== baseCommand[index]);
					if (commandChanged) {
						delete safeBase["environment"];
						delete safeBase["cwd"];
					}
				}

				const mergedEntry = copyJsonInputObject(safeBase, override);
				for (const field of ["environment", "headers", "oauth"]) {
					const baseField = safeBase[field];
					const nextField = override[field];
					if (isJsonInputObject(baseField) && isJsonInputObject(nextField)) {
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

export function extractServers(config: JsonInputValue, kind: ImportKind): ServerMap {
	if (!isJsonInputObject(config)) return {};

	let servers: JsonInputValue;
	switch (kind) {
		case "claude-desktop":
		case "claude-code":
			servers = config["mcpServers"];
			break;
		case "codex":
			servers = config["mcp_servers"] ?? config["mcpServers"];
			break;
		case "cursor":
		case "windsurf":
		case "vscode":
			servers = config["mcpServers"] ?? config["mcp-servers"];
			break;
		case "opencode":
			servers = config["mcp"];
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
			if (raw["enabled"] === false) continue;

			if (
				raw["type"] === "local" &&
				Array.isArray(raw["command"]) &&
				raw["command"].length > 0 &&
				raw["command"].every((value): value is string => isRuntimeString(value))
			) {
				const [command, ...args] = raw["command"];
				if (!command) continue;
				const env = toStringRecord(raw["environment"]);
				const mapped: ServerEntry = {
					command,
					args,
				};
				if (env) mapped.env = env;
				if (isRuntimeString(raw["cwd"])) mapped.cwd = raw["cwd"];
				setServer(mappedServers, name, mapped);
				continue;
			}

			if (raw["type"] === "remote" && isRuntimeString(raw["url"])) {
				const headers = toStringRecord(raw["headers"]);
				const mapped: ServerEntry = { url: raw["url"] };
				if (headers) mapped.headers = headers;
				if (raw["oauth"] === false) {
					mapped.oauth = false;
				} else if (isJsonInputObject(raw["oauth"])) {
					const oauth = raw["oauth"];
					mapped.auth = "oauth";
					const oauthConfig: NonNullable<Exclude<ServerEntry["oauth"], false>> = {};
					if (isRuntimeString(oauth["clientId"])) oauthConfig.clientId = oauth["clientId"];
					if (isRuntimeString(oauth["clientSecret"])) oauthConfig.clientSecret = oauth["clientSecret"];
					if (isRuntimeString(oauth["scope"])) oauthConfig.scope = oauth["scope"];
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
		const bearerTokenEnv = mapped["bearer_token_env_var"];
		const httpHeaders = mapped["http_headers"];
		const envHttpHeaders = mapped["env_http_headers"];

		if (isRuntimeString(bearerTokenEnv)) {
			mapped["bearerTokenEnv"] = bearerTokenEnv;
			if (mapped["auth"] === undefined) mapped["auth"] = "bearer";
		}
		const parsedHttpHeaders = toStringRecord(httpHeaders);
		if (parsedHttpHeaders) {
			mapped["headers"] = { ...toStringRecord(mapped["headers"]), ...parsedHttpHeaders };
		}
		if (isJsonInputObject(envHttpHeaders)) {
			const headers = { ...toStringRecord(mapped["headers"]) };
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
			mapped["headers"] = headers;
		}

		delete mapped["bearer_token_env_var"];
		delete mapped["http_headers"];
		delete mapped["env_http_headers"];
		setServer(mappedServers, name, parseServerEntry(mapped, `codex MCP server ${name}`));
	}

	return mappedServers;
}
