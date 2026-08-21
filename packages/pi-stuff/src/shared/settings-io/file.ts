/**
 * Atomic reader/writer for the single merged settings file.
 *
 * Reads and writes use plain JSON (`JSON.parse` / `JSON.stringify`). The file is
 * a plain `pi-stuff.json` — comments are not supported. Writes always emit
 * comment-free, tab-indented JSON because machine output must be deterministic.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type JsonInputObject, type JsonValue, parseJsonValue } from "../json-value.js";
import { isRuntimeObject } from "../runtime-type.js";

export interface SettingsRecord extends JsonInputObject {}

function isRecord(value: unknown): value is SettingsRecord {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

/** Missing file returns `{}`; a malformed file throws so callers can fall back. */
export async function readSettingsFile(path: string): Promise<SettingsRecord> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (isRecord(error) && error["code"] === "ENOENT") return {};
		throw error;
	}
	return parseSettingsContent(content, path);
}

export async function writeSettingsFile(path: string, record: SettingsRecord): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${String(process.pid)}-${randomUUID()}`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(record, null, "\t")}\n`, { mode: 0o600 });
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

/**
 * Merge a namespace record into the whole file without clobbering siblings.
 *
 * The file is read, the named top-level namespace is replaced with `next`, and
 * the result is written atomically. Unknown sibling namespaces are preserved
 * so a Capability never edits another Capability's section.
 */
export async function mergeNamespaceRecord(
	path: string,
	namespace: string,
	next: SettingsRecord,
): Promise<SettingsRecord> {
	const current = await readSettingsFile(path);
	const merged = { ...current, [namespace]: next } satisfies SettingsRecord;
	await writeSettingsFile(path, merged);
	return merged;
}

/** Read one namespace; a missing file or namespace returns `undefined`. */
export async function readNamespace(path: string, namespace: string): Promise<SettingsRecord | undefined> {
	const file = await readSettingsFile(path);
	const value = file[namespace];
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error(`Settings namespace "${namespace}" at ${path} is not a JSON object`);
	return value;
}

/** Synchronous variants for lifecycle modules (e.g. Goal) that load on the hot path. */

function parseSettingsContent(content: string, path: string): SettingsRecord {
	const trimmed = content.trim();
	if (trimmed === "") return {};
	let parsed: JsonValue;
	try {
		parsed = parseJsonValue(trimmed);
	} catch {
		throw new Error(`Settings file at ${path} contains invalid JSON`);
	}
	if (!isRecord(parsed)) throw new Error(`Settings file at ${path} is not a JSON object`);
	return parsed;
}

export function readSettingsFileSync(path: string): SettingsRecord {
	let content: string;
	try {
		content = readFileSync(path, "utf8");
	} catch (error) {
		if (isRecord(error) && error["code"] === "ENOENT") return {};
		throw error;
	}
	return parseSettingsContent(content, path);
}

export function writeSettingsFileSync(path: string, record: SettingsRecord): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${String(process.pid)}-${randomUUID()}`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(record, null, "\t")}\n`, { mode: 0o600 });
		renameSync(temporaryPath, path);
	} catch (error) {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// Best-effort cleanup.
		}
		throw error;
	}
}

export function mergeNamespaceRecordSync(path: string, namespace: string, next: SettingsRecord): SettingsRecord {
	const current = readSettingsFileSync(path);
	const merged = { ...current, [namespace]: next } satisfies SettingsRecord;
	writeSettingsFileSync(path, merged);
	return merged;
}

export function readNamespaceSync(path: string, namespace: string): SettingsRecord | undefined {
	const file = readSettingsFileSync(path);
	const value = file[namespace];
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error(`Settings namespace "${namespace}" at ${path} is not a JSON object`);
	return value;
}
