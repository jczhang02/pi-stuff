import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mergeNamespaceRecordSync, readNamespaceSync, readSettingsFileSync } from "../../shared/settings-io/file.js";
import { mergedSettingsPath } from "../../shared/settings-io/paths.js";

export const GOAL_SETTINGS_FILE = "pi-stuff.json";
const GOAL_NAMESPACE = "goal";
const LEGACY_GOAL_SETTINGS_FILE = "pi-goal.json";
const GOAL_TOOL_VISIBILITIES = ["always", "after-first-goal"] as const;

type GoalToolVisibility = (typeof GOAL_TOOL_VISIBILITIES)[number];
type ContinuationLimit = number | null;

export interface GoalSettings {
	toolVisibility: GoalToolVisibility;
	experimental: {
		goals: boolean;
	};
	rpc: {
		enabled: boolean;
	};
	continuationLimits: {
		automaticTurns: ContinuationLimit;
		noProgressTurns: ContinuationLimit;
	};
}

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
	toolVisibility: "always",
	experimental: { goals: false },
	rpc: { enabled: false },
	continuationLimits: { automaticTurns: null, noProgressTurns: null },
};

export type GoalSettingsLoadResult =
	| { kind: "missing" }
	| { kind: "invalid"; reason: string }
	| { kind: "loaded"; settings: GoalSettings };

export type GoalSettingsLoadIssue = Extract<GoalSettingsLoadResult, { kind: "invalid" }>;

interface GoalSettingsSaveFileSystem {
	mkdirSync: typeof mkdirSync;
	writeFileSync: typeof writeFileSync;
	renameSync: typeof renameSync;
	rmSync: typeof rmSync;
}

export function normalizeGoalSettings(value: unknown): GoalSettings | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const toolVisibility = Object.hasOwn(value, "toolVisibility")
		? Reflect.get(value, "toolVisibility")
		: DEFAULT_GOAL_SETTINGS.toolVisibility;
	if (!GOAL_TOOL_VISIBILITIES.includes(toolVisibility as GoalToolVisibility)) return undefined;

	const experimentalValue = Object.hasOwn(value, "experimental") ? Reflect.get(value, "experimental") : undefined;
	if (
		experimentalValue !== undefined &&
		(typeof experimentalValue !== "object" || experimentalValue === null || Array.isArray(experimentalValue))
	) {
		return undefined;
	}
	const goals =
		experimentalValue && Object.hasOwn(experimentalValue, "goals")
			? Reflect.get(experimentalValue, "goals")
			: DEFAULT_GOAL_SETTINGS.experimental.goals;
	if (typeof goals !== "boolean") return undefined;

	const rpcValue = Object.hasOwn(value, "rpc") ? Reflect.get(value, "rpc") : undefined;
	if (rpcValue !== undefined && (typeof rpcValue !== "object" || rpcValue === null || Array.isArray(rpcValue))) {
		return undefined;
	}
	const rpcEnabled =
		rpcValue && Object.hasOwn(rpcValue, "enabled")
			? Reflect.get(rpcValue, "enabled")
			: DEFAULT_GOAL_SETTINGS.rpc.enabled;
	if (typeof rpcEnabled !== "boolean") return undefined;

	const continuationLimitsValue = Object.hasOwn(value, "continuationLimits")
		? Reflect.get(value, "continuationLimits")
		: undefined;
	if (
		continuationLimitsValue !== undefined &&
		(typeof continuationLimitsValue !== "object" ||
			continuationLimitsValue === null ||
			Array.isArray(continuationLimitsValue))
	) {
		return undefined;
	}
	const automaticTurns = continuationLimitsValue
		? normalizeContinuationLimit(
				Reflect.get(continuationLimitsValue, "automaticTurns"),
				DEFAULT_GOAL_SETTINGS.continuationLimits.automaticTurns,
			)
		: DEFAULT_GOAL_SETTINGS.continuationLimits.automaticTurns;
	const noProgressTurns = continuationLimitsValue
		? normalizeContinuationLimit(
				Reflect.get(continuationLimitsValue, "noProgressTurns"),
				DEFAULT_GOAL_SETTINGS.continuationLimits.noProgressTurns,
			)
		: DEFAULT_GOAL_SETTINGS.continuationLimits.noProgressTurns;
	if (automaticTurns === undefined || noProgressTurns === undefined) return undefined;

	return {
		toolVisibility: toolVisibility as GoalToolVisibility,
		experimental: { goals },
		rpc: { enabled: rpcEnabled },
		continuationLimits: { automaticTurns, noProgressTurns },
	};
}

function normalizeContinuationLimit(value: unknown, fallback: ContinuationLimit): ContinuationLimit | undefined {
	if (value === undefined) return fallback;
	if (value === null) return null;
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function saveGoalSettings(
	settings: GoalSettings,
	settingsPath = mergedSettingsPath(getAgentDir()),
	overrides: Partial<GoalSettingsSaveFileSystem> = {},
) {
	const normalized = normalizeGoalSettings(settings);
	if (!normalized) throw new Error("Refusing to save invalid pi-goal settings.");

	let existingNamespace: Record<string, unknown> = {};
	let existingDocument: Record<string, unknown> = {};
	try {
		existingDocument = readSettingsFileSync(settingsPath);
		const file = ownRecord(existingDocument[GOAL_NAMESPACE]);
		if (file !== undefined) {
			const validated = normalizeGoalSettings(file);
			if (!validated) throw new Error(`${settingsPath}: invalid settings shape`);
			existingNamespace = ownRecord(file) ?? {};
		}
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ENOENT") {
			throw new Error(`Cannot save invalid settings file: ${formatError(error)}`);
		}
	}

	const experimental = ownRecord(existingNamespace.experimental) ?? {};
	const rpc = ownRecord(existingNamespace.rpc) ?? {};
	const continuationLimits = ownRecord(existingNamespace.continuationLimits) ?? {};
	const document = {
		...existingNamespace,
		toolVisibility: normalized.toolVisibility,
		experimental: { ...experimental, goals: normalized.experimental.goals },
		rpc: { ...rpc, enabled: normalized.rpc.enabled },
		continuationLimits: {
			...continuationLimits,
			automaticTurns: normalized.continuationLimits.automaticTurns,
			noProgressTurns: normalized.continuationLimits.noProgressTurns,
		},
	};
	const temporaryPath = join(dirname(settingsPath), `.${basename(settingsPath)}.${randomUUID()}.tmp`);
	const fs = { mkdirSync, writeFileSync, renameSync, rmSync, ...overrides };
	try {
		fs.mkdirSync(dirname(settingsPath), { recursive: true });
		fs.writeFileSync(
			temporaryPath,
			`${JSON.stringify({ ...existingDocument, [GOAL_NAMESPACE]: document }, null, "\t")}\n`,
			{
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			},
		);
		fs.renameSync(temporaryPath, settingsPath);
	} finally {
		try {
			fs.rmSync(temporaryPath, { force: true });
		} catch {
			// Best-effort cleanup must not replace the save result.
		}
	}
}

export async function withGoalSettingsLock<Value>(
	settingsPath: string,
	operation: () => Value | Promise<Value>,
): Promise<Value> {
	const { withSettingsLock } = await import("../../shared/settings-io/lock.js");
	return withSettingsLock(settingsPath, "Goal", operation);
}

export function readGoalSettingsLocked(
	settingsPath = mergedSettingsPath(getAgentDir()),
): Promise<GoalSettingsLoadResult> {
	return withGoalSettingsLock(settingsPath, () => {
		if (settingsPath === mergedSettingsPath(getAgentDir())) migrateLegacyGoalSettings(settingsPath);
		return readGoalSettings(settingsPath);
	});
}

export function readGoalSettings(settingsPath = mergedSettingsPath(getAgentDir())): GoalSettingsLoadResult {
	let namespace: unknown;
	try {
		const file = readNamespaceSync(settingsPath, GOAL_NAMESPACE);
		if (file === undefined) return { kind: "missing" };
		namespace = file;
	} catch (error: unknown) {
		if (isNodeError(error) && error.code === "ENOENT") return { kind: "missing" };
		return { kind: "invalid", reason: `${settingsPath}: ${formatError(error)}` };
	}

	try {
		const settings = normalizeGoalSettings(namespace);
		return settings
			? { kind: "loaded", settings }
			: { kind: "invalid", reason: `${settingsPath}: invalid settings shape` };
	} catch (error: unknown) {
		return { kind: "invalid", reason: `${settingsPath}: ${formatError(error)}` };
	}
}

function migrateLegacyGoalSettings(settingsPath: string): void {
	if (readNamespaceSync(settingsPath, GOAL_NAMESPACE) !== undefined) return;
	const legacyPath = join(dirname(settingsPath), LEGACY_GOAL_SETTINGS_FILE);
	if (!existsSync(legacyPath)) return;
	const contents = readFileSync(legacyPath, "utf8");
	const parsed = JSON.parse(contents) as unknown;
	const normalized = normalizeGoalSettings(parsed);
	if (normalized) {
		mergeNamespaceRecordSync(settingsPath, GOAL_NAMESPACE, { ...normalized });
		// The legacy file has been lifted into the merged namespace; remove it
		// so the user is left with a single settings file (no .bak retained).
		try {
			unlinkSync(legacyPath);
		} catch {
			// Best-effort cleanup; the merged record is already authoritative.
		}
	}
}

function ownRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
