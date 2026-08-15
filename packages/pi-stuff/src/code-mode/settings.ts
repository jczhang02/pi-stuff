import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PROJECT_SETTINGS_DIRECTORY = ".pi";
const PROJECT_SETTINGS_FILE = "code-mode.json";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error["code"] === "ENOENT";
}

export function codeModeProjectSettingsPath(cwd: string): string {
	return join(cwd, PROJECT_SETTINGS_DIRECTORY, PROJECT_SETTINGS_FILE);
}

async function readRawSettings(path: string): Promise<Record<string, unknown> | undefined> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(path, "utf8")) as unknown;
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
	if (typeof value["enabled"] !== "boolean") {
		throw new Error(`Invalid Code Mode project settings at ${path}: "enabled" must be a boolean`);
	}
	return value["enabled"];
}

/** Explicit user actions only: preserve unknown fields and replace the file atomically. */
export async function writeCodeModeProjectEnabled(cwd: string, enabled: boolean): Promise<void> {
	const path = codeModeProjectSettingsPath(cwd);
	const current = (await readRawSettings(path)) ?? {};
	if (current["enabled"] !== undefined && typeof current["enabled"] !== "boolean") {
		throw new Error(`Invalid Code Mode project settings at ${path}: "enabled" must be a boolean`);
	}
	await mkdir(dirname(path), { mode: 0o700, recursive: true });
	const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify({ ...current, enabled }, null, "\t")}\n`, {
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
}
