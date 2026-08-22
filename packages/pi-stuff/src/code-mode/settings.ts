import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type JsonInputObject, type JsonInputValue, parseJsonValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeObject } from "../shared/runtime-type.js";
import { mergedSettingsPath, readNamespace } from "../shared/settings-io/index.js";
import { mergeNamespaceRecordLocked, withSettingsLock } from "../shared/settings-io/lock.js";

const PROJECT_SETTINGS_DIRECTORY = ".pi";
const PROJECT_SETTINGS_FILE = "code-mode.json";
const CODE_MODE_NAMESPACE = "codeMode";

function isRecord<Value>(value: Value): value is Value & JsonInputObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function isMissingFile<Cause>(cause: Cause): boolean {
	return isRecord(cause) && cause["code"] === "ENOENT";
}

export function codeModeProjectSettingsPath(cwd: string): string {
	return join(cwd, PROJECT_SETTINGS_DIRECTORY, PROJECT_SETTINGS_FILE);
}

async function readRawSettings(path: string): Promise<JsonInputObject | undefined> {
	let value: JsonInputValue;
	try {
		value = parseJsonValue(await readFile(path, "utf8"));
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw new Error(
			`Unable to read Code Mode project settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(value)) throw new Error(`Invalid Code Mode project settings at ${path}: expected a JSON object`);
	return value;
}

/** Read-only: a missing file or omitted value falls back to the process default. */
export async function readCodeModeProjectEnabled(cwd: string): Promise<boolean | undefined> {
	const path = codeModeProjectSettingsPath(cwd);
	const value = await readRawSettings(path);
	if (!value || value["enabled"] === undefined) return undefined;
	if (!isRuntimeBoolean(value["enabled"])) {
		throw new Error(`Invalid Code Mode project settings at ${path}: "enabled" must be a boolean`);
	}
	return value["enabled"];
}

/** Explicit user actions only: preserve unknown fields and replace the file atomically. */
export async function writeCodeModeProjectEnabled(cwd: string, enabled: boolean | undefined): Promise<void> {
	const path = codeModeProjectSettingsPath(cwd);
	try {
		await withSettingsLock(path, "Code Mode project", async () => {
			const current = (await readRawSettings(path)) ?? {};
			if (current["enabled"] !== undefined && !isRuntimeBoolean(current["enabled"])) {
				throw new Error(`Invalid Code Mode project settings at ${path}: "enabled" must be a boolean`);
			}
			const next = { ...current };
			if (enabled === undefined) delete next["enabled"];
			else next["enabled"] = enabled;
			if (Object.keys(next).length === 0) {
				await rm(path, { force: true });
				return;
			}
			await mkdir(dirname(path), { mode: 0o700, recursive: true });
			const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporaryPath, `${JSON.stringify(next, null, "\t")}\n`, {
					encoding: "utf8",
					flag: "wx",
					mode: 0o600,
				});
				await rename(temporaryPath, path);
			} catch (error) {
				await rm(temporaryPath, { force: true }).catch(() => undefined);
				throw new Error(
					`Unable to save Code Mode project settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
	} catch (error) {
		if (error instanceof Error && /^(Invalid|Unable to)/u.test(error.message)) throw error;
		throw new Error(
			`Unable to save Code Mode project settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Global Code Mode default, stored as the `codeMode.enabled` namespace in the
 * single merged settings file (`<agentDir>/pi-stuff.json`). Read-only until an
 * explicit `/codemode global on|off` writes it. A missing namespace returns
 * `undefined` so the caller can fall back to the process default.
 */
export async function readCodeModeGlobalEnabled(agentDirectory = getAgentDir()): Promise<boolean | undefined> {
	const namespace = await readNamespace(mergedSettingsPath(agentDirectory), CODE_MODE_NAMESPACE);
	if (namespace === undefined || namespace["enabled"] === undefined) return undefined;
	if (!isRuntimeBoolean(namespace["enabled"])) {
		throw new Error(`Invalid Code Mode global settings: "enabled" must be a boolean`);
	}
	return namespace["enabled"];
}

/** Explicit user action only: writes `codeMode.enabled` into the merged file. */
export async function writeCodeModeGlobalEnabled(enabled: boolean, agentDirectory = getAgentDir()): Promise<void> {
	await mergeNamespaceRecordLocked(mergedSettingsPath(agentDirectory), CODE_MODE_NAMESPACE, { enabled }, "Code Mode");
}
