import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { isRuntimeObject } from "../../shared/runtime-type.js";
import { mergeNamespaceRecordSync, readNamespaceSync, readSettingsFileSync } from "../../shared/settings-io/file.js";
import { mergedSettingsPath } from "../../shared/settings-io/paths.js";

export const GOAL_SETTINGS_FILE = "pi-stuff.json";
const GOAL_NAMESPACE = "goal";
const LEGACY_GOAL_SETTINGS_FILE = "pi-goal.json";
const GOAL_TOOL_VISIBILITIES = ["always", "after-first-goal"] as const;
const CONTINUATION_LIMIT_SCHEMA = Type.Union([
	Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 1 }),
	Type.Null(),
]);
const GOAL_SETTINGS_INPUT_SCHEMA = Type.Object(
	{
		continuationLimits: Type.Optional(
			Type.Object(
				{
					automaticTurns: Type.Optional(CONTINUATION_LIMIT_SCHEMA),
					noProgressTurns: Type.Optional(CONTINUATION_LIMIT_SCHEMA),
				},
				{ additionalProperties: true },
			),
		),
		experimental: Type.Optional(
			Type.Object({ goals: Type.Optional(Type.Boolean()) }, { additionalProperties: true }),
		),
		rpc: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, { additionalProperties: true })),
		toolVisibility: Type.Optional(Type.Union(GOAL_TOOL_VISIBILITIES.map((value) => Type.Literal(value)))),
	},
	{ additionalProperties: true },
);

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

export function normalizeGoalSettings<Value>(value: Value): GoalSettings | undefined {
	if (!Check(GOAL_SETTINGS_INPUT_SCHEMA, value)) return undefined;
	if (Object.hasOwn(value, "toolVisibility") && value.toolVisibility === undefined) return undefined;
	return {
		toolVisibility: value.toolVisibility ?? DEFAULT_GOAL_SETTINGS.toolVisibility,
		experimental: { goals: value.experimental?.goals ?? DEFAULT_GOAL_SETTINGS.experimental.goals },
		rpc: { enabled: value.rpc?.enabled ?? DEFAULT_GOAL_SETTINGS.rpc.enabled },
		continuationLimits: {
			automaticTurns:
				value.continuationLimits?.automaticTurns ?? DEFAULT_GOAL_SETTINGS.continuationLimits.automaticTurns,
			noProgressTurns:
				value.continuationLimits?.noProgressTurns ?? DEFAULT_GOAL_SETTINGS.continuationLimits.noProgressTurns,
		},
	};
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
	return value && isRuntimeObject(value) && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
