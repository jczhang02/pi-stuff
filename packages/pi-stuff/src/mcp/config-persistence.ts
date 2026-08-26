import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import stripJsonComments from "strip-json-comments";
import { isJsonInputObject, type JsonInputObject, parseJsonValue } from "../shared/json-value.js";
import { withSettingsLock } from "../shared/settings-io/lock.ts";

const MAX_EXACT_DIFF_LINE_PAIRS = 250_000;

export interface ConfigWritePreview {
	path: string;
	existed: boolean;
	changed: boolean;
	beforeText: string;
	afterText: string;
	diffText: string;
}

export interface ServerDisabledOverrideResult {
	path: string;
	changed: boolean;
}

export interface ProjectServerOverride {
	existing: JsonInputObject | undefined;
	filePath: string;
	writePath: string;
	raw: JsonInputObject;
	serverKey: "mcpServers" | "mcp-servers";
	servers: JsonInputObject;
}

function serializeRawConfig(raw: JsonInputObject): string {
	return `${JSON.stringify(raw, null, 2)}\n`;
}

export function buildUnifiedDiff(beforeText: string, afterText: string): string {
	if (beforeText === afterText) return "(no changes)";

	const before = beforeText.split("\n");
	const after = afterText.split("\n");
	const rows = before.length;
	const cols = after.length;
	// ponytail: exact LCS stops here; use Myers if very large previews must remain minimal.
	if (rows > Math.floor(MAX_EXACT_DIFF_LINE_PAIRS / cols)) {
		return buildLinearDiff(before, after);
	}
	const lcs = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

	for (let i = rows - 1; i >= 0; i--) {
		const row = lcs[i];
		const nextRow = lcs[i + 1];
		if (!row || !nextRow) throw new Error("MCP diff matrix bounds were invalid");
		for (let j = cols - 1; j >= 0; j--) {
			row[j] = before[i] === after[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
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
		if (j < cols && (i === rows || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
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

function buildLinearDiff(before: string[], after: string[]): string {
	let prefix = 0;
	while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - suffix - 1] === after[after.length - suffix - 1]
	) {
		suffix++;
	}
	const lines = ["--- before", "+++ after"];
	for (const line of before.slice(0, prefix)) lines.push(`  ${line}`);
	for (const line of before.slice(prefix, before.length - suffix)) lines.push(`- ${line}`);
	for (const line of after.slice(prefix, after.length - suffix)) lines.push(`+ ${line}`);
	for (const line of before.slice(before.length - suffix)) lines.push(`  ${line}`);
	return lines.join("\n");
}

export function buildConfigWritePreview(filePath: string, nextRaw: JsonInputObject): ConfigWritePreview {
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

export function readRawConfigObject(filePath: string): JsonInputObject {
	if (!existsSync(filePath)) return {};

	try {
		const raw = parseJsonValue(stripJsonComments(readFileSync(filePath, "utf-8"), { trailingCommas: true }));
		if (!isJsonInputObject(raw)) throw new Error("root value must be an object");
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

export function writeRawConfigObject(filePath: string, raw: JsonInputObject): void {
	const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmpPath, serializeRawConfig(raw), { encoding: "utf-8", mode: 0o600 });
		renameSync(tmpPath, filePath);
	} catch (error) {
		rmSync(tmpPath, { force: true });
		throw error;
	}
}

export function withConfigWriteLock<T>(filePath: string, write: (writePath: string) => T): Promise<T> {
	const writePath = resolveConfigWritePath(filePath);
	return withSettingsLock(writePath, "MCP config", () => write(writePath));
}

export async function withProjectConfigWriteLock<T>(
	filePath: string,
	cwd: string,
	write: (writePath: string) => T | Promise<T>,
): Promise<T> {
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

export function readProjectServerOverride(
	writePath: string,
	filePath: string,
	serverName: string,
): ProjectServerOverride {
	let raw: JsonInputObject = {};
	if (existsSync(writePath)) {
		let descriptor: number | undefined;
		try {
			descriptor = openSync(writePath, constants.O_RDONLY | constants.O_NOFOLLOW);
			const parsed = parseJsonValue(stripJsonComments(readFileSync(descriptor, "utf-8"), { trailingCommas: true }));
			if (!isJsonInputObject(parsed)) throw new Error("root value must be an object");
			raw = parsed;
		} catch (error) {
			throw new Error(
				`Failed to read project MCP override at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		} finally {
			if (descriptor !== undefined) closeSync(descriptor);
		}
	}

	const serverKey =
		raw["mcpServers"] !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
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

export function writeProjectServerOverride(
	override: ProjectServerOverride,
	serverName: string,
	next: JsonInputObject,
): ServerDisabledOverrideResult {
	const { existing, filePath, raw, serverKey, servers, writePath } = override;
	if ((!existing && Object.keys(next).length === 0) || JSON.stringify(existing) === JSON.stringify(next)) {
		return { path: filePath, changed: false };
	}
	if (Object.keys(next).length === 0) delete servers[serverName];
	else {
		Object.defineProperty(servers, serverName, {
			configurable: true,
			enumerable: true,
			value: next,
			writable: true,
		});
	}
	raw[serverKey] = servers;
	writeRawConfigObject(writePath, raw);
	return { path: filePath, changed: true };
}
