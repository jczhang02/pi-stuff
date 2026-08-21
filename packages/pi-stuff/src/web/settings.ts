import { existsSync, readFileSync } from "node:fs";
import { link, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type JsonInputValue, parseJsonValue } from "../shared/json-value.js";
import { isRuntimeObject } from "../shared/runtime-type.js";
import {
	mergeNamespaceRecord,
	readSettingsFile,
	readSettingsFileSync,
	type SettingsRecord,
} from "../shared/settings-io/file.js";
import { mergedSettingsPath } from "../shared/settings-io/index.js";
import { withSettingsLock } from "../shared/settings-io/lock.js";

const WEB_NAMESPACE = "web";
const LEGACY_FILE = "web-search.json";
const LEGACY_MIGRATION_FILE = `${LEGACY_FILE}.migrating`;

function isRecord(value: JsonInputValue): value is SettingsRecord {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function isFileError(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function settingsRecord<Value extends object>(value: Value): SettingsRecord {
	const parsed = parseJsonValue(JSON.stringify(value));
	if (!isRecord(parsed)) throw new WebConfigError("Unable to update Web configuration: expected a JSON object");
	return parsed;
}

export class WebConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebConfigError";
	}
}

export function getWebConfigPath(agentDirectory = getAgentDir()): string {
	return mergedSettingsPath(agentDirectory);
}

export function getLegacyWebConfigPath(agentDirectory = getAgentDir()): string {
	return join(agentDirectory, LEGACY_FILE);
}

function getLegacyWebMigrationPath(agentDirectory = getAgentDir()): string {
	return join(agentDirectory, LEGACY_MIGRATION_FILE);
}

function readLegacy(path: string): SettingsRecord | undefined {
	if (!existsSync(path)) return undefined;
	let parsed: JsonInputValue;
	try {
		parsed = parseJsonValue(readFileSync(path, "utf8"));
	} catch {
		throw new WebConfigError(`Unable to read legacy Web configuration at ${path}: invalid JSON`);
	}
	if (!isRecord(parsed)) {
		throw new WebConfigError(`Unable to read legacy Web configuration at ${path}: expected a JSON object`);
	}
	return parsed;
}

/** Read-only. Canonical settings win; legacy data is lifted only by an explicit update. */
export function readWebConfig(agentDirectory = getAgentDir()): SettingsRecord | undefined {
	const path = getWebConfigPath(agentDirectory);
	let document: SettingsRecord;
	try {
		document = readSettingsFileSync(path);
	} catch {
		throw new WebConfigError(`Unable to read Web configuration at ${path}: invalid JSON`);
	}
	const canonical = document[WEB_NAMESPACE];
	if (canonical !== undefined) {
		if (!isRecord(canonical)) {
			throw new WebConfigError(`Unable to read Web configuration at ${path}: "web" must be a JSON object`);
		}
		return canonical;
	}
	return readLegacy(getLegacyWebConfigPath(agentDirectory)) ?? readLegacy(getLegacyWebMigrationPath(agentDirectory));
}

/** Compatibility adapter for the vendored provider parsers. */
export function readWebConfigText(agentDirectory = getAgentDir()): string {
	return JSON.stringify(readWebConfig(agentDirectory) ?? {});
}

export function webConfigExists(agentDirectory = getAgentDir()): boolean {
	return readWebConfig(agentDirectory) !== undefined;
}

/** Explicit user actions only: merge under the shared lock, then remove legacy state. */
export async function updateWebConfig<Updates extends object>(
	updates: Updates,
	agentDirectory = getAgentDir(),
): Promise<void> {
	const path = getWebConfigPath(agentDirectory);
	const legacyPath = getLegacyWebConfigPath(agentDirectory);
	const stagedLegacyPath = getLegacyWebMigrationPath(agentDirectory);
	try {
		await withSettingsLock(path, "Web", async () => {
			const document = await readSettingsFile(path);
			const canonical = document[WEB_NAMESPACE];
			let canonicalRecord: SettingsRecord | undefined;
			if (canonical !== undefined) {
				if (!isRecord(canonical)) {
					throw new WebConfigError(`Unable to update Web configuration at ${path}: "web" must be a JSON object`);
				}
				canonicalRecord = canonical;
			}
			if (existsSync(stagedLegacyPath) && existsSync(legacyPath)) {
				await rm(stagedLegacyPath, { force: true });
			}
			if (!existsSync(stagedLegacyPath)) {
				try {
					await rename(legacyPath, stagedLegacyPath);
				} catch (error) {
					if (!isFileError(error, "ENOENT")) throw error;
				}
			}
			const stagedLegacy = existsSync(stagedLegacyPath);
			try {
				const legacy = canonicalRecord === undefined && stagedLegacy ? readLegacy(stagedLegacyPath) : undefined;
				const current = canonicalRecord ?? legacy ?? {};
				await mergeNamespaceRecord(path, WEB_NAMESPACE, { ...current, ...settingsRecord(updates) });
				if (stagedLegacy) await rm(stagedLegacyPath, { force: true });
			} catch (error) {
				if (stagedLegacy) {
					try {
						await link(stagedLegacyPath, legacyPath);
						await rm(stagedLegacyPath, { force: true });
					} catch (restoreError) {
						if (isFileError(restoreError, "EEXIST")) {
							// A newly recreated legacy file is newer than the staged snapshot.
							await rm(stagedLegacyPath, { force: true });
						}
					}
				}
				throw error;
			}
		});
	} catch (error) {
		if (error instanceof WebConfigError) throw error;
		throw new WebConfigError(`Unable to update Web configuration at ${path}`);
	}
}
