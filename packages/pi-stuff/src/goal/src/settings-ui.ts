import { join } from "node:path";
import { type ExtensionCommandContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { checkpointGoalActiveTime } from "./accounting.js";
import { abortCurrentTurn, EMERGENCY_AUTOMATIC_TURN_LIMIT, type GoalRuntime } from "./runtime.js";
import { GOAL_SETTINGS_FILE, type GoalSettings, saveGoalSettings } from "./settings.js";
import { defineMenu, runMenu } from "./suite-menu.js";

interface GoalSettingsUiOptions {
	settingsPath?: string;
	save?: (settings: GoalSettings, settingsPath: string) => void;
	onQueueUnfrozen?: (ctx: ExtensionCommandContext) => Promise<void>;
	withLock?: <Value>(settingsPath: string, operation: () => Value | Promise<Value>) => Promise<Value>;
}

interface GoalSettingsApplyOptions {
	save?: (settings: GoalSettings) => void;
}

type LimitField = "automaticTurns" | "noProgressTurns";
type LimitSelection = "unlimited" | "custom" | "off";
export async function showGoalSettings(
	runtime: GoalRuntime,
	ctx: ExtensionCommandContext,
	options: GoalSettingsUiOptions = {},
) {
	const settingsPath = options.settingsPath ?? join(getAgentDir(), GOAL_SETTINGS_FILE);
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`Edit pi-goal settings manually: ${safeTerminalText(settingsPath)}`, "info");
		return;
	}
	const generation = runtime.menuGeneration;
	const invalid = runtime.settingsLoadIssue?.kind === "invalid";
	const previewGoalIds = new Map<LimitField, string | null>();
	type Screen = "settings" | "automatic" | "no-progress" | "invalid";
	type Action =
		| "open-automatic"
		| "open-no-progress"
		| "choose-automatic"
		| "choose-no-progress"
		| "set-visibility"
		| "set-queue"
		| "set-rpc";
	const menu = defineMenu<undefined, Screen, Action, ExtensionCommandContext>({
		start: invalid ? "invalid" : "settings",
		screens: {
			settings: () => ({
				kind: "settings",
				title: "Pi Goal Settings",
				lines: [`User settings · ${safeTerminalText(settingsPath)}`],
				items: [
					{
						id: "automaticTurns",
						label: "Automatic work",
						description: "Choose whether Goal can continue without a response-count cap.",
						currentValue: formatAutomaticSettingValue(runtime.settings.continuationLimits.automaticTurns),
						action: "open-automatic",
					},
					{
						id: "noProgressTurns",
						label: "No-progress guard",
						description: "Pause after repeated or empty tool-free automatic runs.",
						currentValue: formatNoProgressSettingValue(runtime.settings.continuationLimits.noProgressTurns),
						action: "open-no-progress",
					},
					{
						id: "toolVisibility",
						label: "Goal tools",
						description: "Keep terminal Goal tools visible, or reveal them after the first goal.",
						currentValue: visibilityLabel(runtime.settings.toolVisibility),
						values: ["Always", "After first goal"],
						action: "set-visibility",
					},
					{
						id: "experimentalGoals",
						label: "Ordered goal queue",
						description: "Enable experimental add, prioritize, skip, and drop-last workflows.",
						currentValue: runtime.settings.experimental.goals ? "Experimental" : "Off",
						values: ["Off", "Experimental"],
						action: "set-queue",
					},
					{
						id: "rpcEnabled",
						label: "Managed run RPC",
						description:
							"Allow trusted installed extensions to start and cancel Goal runs; this is not an extension sandbox.",
						currentValue: runtime.settings.rpc.enabled ? "On" : "Off",
						values: ["Off", "On"],
						action: "set-rpc",
					},
				],
			}),
			automatic: () => limitChoiceScreen(runtime, "automaticTurns", "choose-automatic"),
			"no-progress": () => limitChoiceScreen(runtime, "noProgressTurns", "choose-no-progress"),
			invalid: () => ({
				kind: "detail",
				title: "Pi Goal Settings · Read only",
				lines: [
					`Invalid settings file. Pi-goal is using built-in defaults. Fix ${safeTerminalText(settingsPath)} and run /reload. The file will not be overwritten.`,
					`Automatic work: ${formatAutomaticWork(runtime.settings.continuationLimits.automaticTurns)}`,
					`No-progress guard: ${formatNoProgressProtection(runtime.settings.continuationLimits.noProgressTurns)}`,
					`Goal tools: ${visibilityLabel(runtime.settings.toolVisibility)}`,
					`Ordered goal queue: ${runtime.settings.experimental.goals ? "Experimental" : "Off"}`,
					`Managed run RPC: ${runtime.settings.rpc.enabled ? "On" : "Off"}`,
				],
				hint: "back",
			}),
		},
		actions: {
			"open-automatic": async () => {
				previewGoalIds.set("automaticTurns", runtime.activeGoal?.id ?? null);
				return { kind: "to", screen: "automatic" };
			},
			"open-no-progress": async () => {
				previewGoalIds.set("noProgressTurns", runtime.activeGoal?.id ?? null);
				return { kind: "to", screen: "no-progress" };
			},
			"choose-automatic": async ({ itemId }) =>
				applyLimitChoice(
					runtime,
					ctx,
					options,
					settingsPath,
					"automaticTurns",
					itemId,
					previewGoalIds.get("automaticTurns") ?? null,
				),
			"choose-no-progress": async ({ itemId }) =>
				applyLimitChoice(
					runtime,
					ctx,
					options,
					settingsPath,
					"noProgressTurns",
					itemId,
					previewGoalIds.get("noProgressTurns") ?? null,
				),
			"set-visibility": async ({ value }) => {
				const nextVisibility = value === "Always" ? "always" : "after-first-goal";
				if (nextVisibility === runtime.settings.toolVisibility) return { kind: "stay" };
				try {
					const next = {
						...structuredClone(runtime.settings),
						toolVisibility: nextVisibility,
					} satisfies GoalSettings;
					await applySavedGoalSettings(runtime, next, ctx, options, settingsPath);
					ctx.ui.notify(`Goal tools: ${value}.`, "info");
					return { kind: "stay" };
				} catch (error) {
					notifySettingsFailure(ctx, settingsPath, error);
					return { kind: "rejected" };
				}
			},
			"set-queue": async ({ value }) => {
				const enabled = value === "Experimental";
				if (enabled === runtime.settings.experimental.goals) return { kind: "stay" };
				const next = await nextQueueSettings(runtime, ctx, enabled);
				if (!next) return { kind: "rejected" };
				const wasFrozen = runtime.queueFrozen;
				try {
					await applySavedGoalSettings(runtime, next, ctx, options, settingsPath);
					if (wasFrozen && !runtime.queueFrozen) {
						try {
							await options.onQueueUnfrozen?.(ctx);
						} catch (error) {
							ctx.ui.notify(
								`Goal queue enabled, but automatic resume failed: ${safeTerminalText(formatError(error))}. Reopen /goal to retry.`,
								"warning",
							);
						}
					}
					ctx.ui.notify(`Ordered goal queue: ${enabled ? "Experimental" : "Off"}.`, "info");
					return { kind: "stay" };
				} catch (error) {
					notifySettingsFailure(ctx, settingsPath, error);
					return { kind: "rejected" };
				}
			},
			"set-rpc": async ({ value }) => {
				const enabled = value === "On";
				if (enabled === runtime.settings.rpc.enabled) return { kind: "stay" };
				try {
					const next = {
						...structuredClone(runtime.settings),
						rpc: { enabled },
					} satisfies GoalSettings;
					await applySavedGoalSettings(runtime, next, ctx, options, settingsPath);
					ctx.ui.notify(`Managed run RPC: ${enabled ? "On" : "Off"}.`, "info");
					return { kind: "stay" };
				} catch (error) {
					notifySettingsFailure(ctx, settingsPath, error);
					return { kind: "rejected" };
				}
			},
		},
	});
	await runMenu(ctx, menu, {
		getState: () => undefined,
		pi: runtime.pi,
		signal: runtime.menuController.signal,
		isCurrent: () => generation === runtime.menuGeneration && !runtime.menuController.signal.aborted,
	});
}

function limitChoiceScreen(runtime: GoalRuntime, field: LimitField, action: "choose-automatic" | "choose-no-progress") {
	const value = runtime.settings.continuationLimits[field];
	const goal = runtime.activeGoal;
	return {
		kind: "actions" as const,
		title: field === "automaticTurns" ? "Automatic work" : "No-progress guard",
		lines: [
			field === "automaticTurns"
				? `Current: ${formatAutomaticWork(value)}`
				: `Current: ${formatNoProgressProtection(value)}`,
			...(goal
				? [
						field === "automaticTurns"
							? `Active goal: ${goal.automaticModelTurns} automatic responses used`
							: `Active goal: ${goal.toolFreeRepeatCount} repeated or empty runs detected`,
					]
				: []),
		],
		items: limitChoices(field, value, goal?.automaticModelTurns).map((item) => ({
			id: item.value,
			label: item.label,
			description: item.description,
			action,
		})),
		hint: "back" as const,
	};
}

function limitChoices(
	field: LimitField,
	value: number | null,
	automaticTurnsUsed: number | undefined,
): Array<{ value: LimitSelection; label: string; description: string }> {
	if (field === "automaticTurns") {
		const unlimitedDescription =
			value === null
				? `No configurable cap; the non-disableable ${EMERGENCY_AUTOMATIC_TURN_LIMIT.toLocaleString()}-response emergency backstop still applies.`
				: automaticTurnsUsed === undefined
					? `Remove the current ${value}-response cap; the ${EMERGENCY_AUTOMATIC_TURN_LIMIT.toLocaleString()}-response emergency backstop remains.`
					: `Remove the current ${value}-response cap. The active goal has used ${automaticTurnsUsed} responses; the emergency backstop remains.`;
		return [
			{ value: "unlimited", label: "Unlimited (default)", description: unlimitedDescription },
			{
				value: "custom",
				label: "Set a maximum…",
				description: "Pause after a whole number of Goal-owned automatic responses.",
			},
		];
	}
	return [
		{
			value: "off",
			label: "Off (default)",
			description: "Do not stop a Goal because output is short, empty, or repeated.",
		},
		{
			value: "custom",
			label: "Set threshold…",
			description: "Choose a whole number of repeated or empty runs before pausing.",
		},
	];
}

async function applyLimitChoice(
	runtime: GoalRuntime,
	ctx: ExtensionCommandContext,
	options: GoalSettingsUiOptions,
	settingsPath: string,
	field: LimitField,
	itemId: string,
	activeGoalId: string | null,
) {
	if (!isLimitSelection(itemId)) return { kind: "rejected" as const };
	if ((runtime.activeGoal?.id ?? null) !== activeGoalId) {
		ctx.ui.notify("The active goal changed while the safety setting was open. No settings were changed.", "warning");
		return { kind: "rejected" as const };
	}
	const previous = runtime.settings.continuationLimits[field];
	const limit = await resolveLimitSelection(field, itemId, previous, ctx);
	if (limit === undefined || limit === previous) return { kind: "back" as const };
	if ((runtime.activeGoal?.id ?? null) !== activeGoalId) {
		ctx.ui.notify("The active goal changed while editing the safety setting. No settings were changed.", "warning");
		return { kind: "rejected" as const };
	}
	const confirmation = await confirmLowerActiveLimit(runtime, ctx, field, limit);
	if (!confirmation.apply) return { kind: "rejected" as const };
	if (confirmation.goalId !== undefined && runtime.activeGoal?.id !== confirmation.goalId) {
		ctx.ui.notify("The active goal changed while confirming the limit. No settings were changed.", "warning");
		return { kind: "rejected" as const };
	}
	try {
		await applySavedGoalSettings(runtime, withLimit(runtime.settings, field, limit), ctx, options, settingsPath);
		ctx.ui.notify(formatLimitSuccess(field, limit), "info");
		return { kind: "back" as const };
	} catch (error) {
		notifySettingsFailure(ctx, settingsPath, error);
		return { kind: "rejected" as const };
	}
}

async function applySavedGoalSettings(
	runtime: GoalRuntime,
	next: GoalSettings,
	ctx: ExtensionCommandContext,
	options: GoalSettingsUiOptions,
	settingsPath: string,
): Promise<void> {
	const apply = () =>
		applyGoalSettings(runtime, next, ctx, {
			save: (settings) => (options.save ?? saveGoalSettings)(settings, settingsPath),
		});
	if (options.withLock) await options.withLock(settingsPath, apply);
	else apply();
}

export function applyGoalSettings(
	runtime: GoalRuntime,
	next: GoalSettings,
	ctx: ExtensionCommandContext,
	options: GoalSettingsApplyOptions = {},
) {
	const snapshot = runtime.snapshotSettingsApplicationState();
	let fileSaved = false;
	try {
		runtime.settings = structuredClone(next);
		applyToolVisibility(runtime, snapshot.settings, next, ctx);
		options.save?.(next);
		fileSaved = options.save !== undefined;
		applyQueueSetting(runtime, ctx);
		const activeGoalId = runtime.activeGoal?.id;
		const abortOwnedRun = activeGoalId !== undefined && runtime.agentRunGoalId === activeGoalId;
		const pausedByAutomaticLimit = runtime.enforceAutomaticTurnLimit(ctx, abortOwnedRun);
		if (!pausedByAutomaticLimit) runtime.enforceNoProgressLimit(ctx, abortOwnedRun);
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		try {
			runtime.restoreSettingsApplicationState(snapshot);
		} catch (rollbackError) {
			rollbackErrors.push(rollbackError);
		}
		if (fileSaved) {
			try {
				options.save?.(snapshot.settings);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
			try {
				restorePersistedRuntime(runtime, ctx);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length > 0) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				`pi-goal settings application failed and rollback was incomplete: ${formatError(error)}`,
			);
		}
		throw error;
	}
}

export function parseGoalLimit(value: string): number | undefined {
	const normalized = value.trim();
	if (!/^\d+$/u.test(normalized)) return undefined;
	const parsed = Number(normalized);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function formatGoalLimit(value: number | null) {
	return value === null ? "Unlimited" : String(value);
}

async function resolveLimitSelection(
	field: LimitField,
	selection: LimitSelection,
	previous: number | null,
	ctx: ExtensionCommandContext,
): Promise<number | null | undefined> {
	if (selection === "unlimited" || selection === "off") return null;
	while (true) {
		const raw = await ctx.ui.input(
			field === "automaticTurns"
				? "Maximum automatic responses (whole number greater than 0)"
				: "Repeated-run threshold (whole number greater than 0)",
			previous === null ? "Positive whole number" : String(previous),
		);
		if (raw === undefined) return undefined;
		const parsed = parseGoalLimit(raw);
		if (parsed !== undefined) return parsed;
		ctx.ui.notify(
			`Enter a whole number greater than 0. Choose ${field === "automaticTurns" ? "Unlimited" : "Off"} from the previous screen if you do not want a limit.`,
			"warning",
		);
	}
}

async function nextQueueSettings(runtime: GoalRuntime, ctx: ExtensionCommandContext, enabled: boolean) {
	if (runtime.settings.experimental.goals === enabled) return undefined;
	if (enabled && !runtime.settings.experimental.goals) {
		const confirmed = await ctx.ui.confirm(
			"Enable experimental goal queue?",
			"Queue behavior and persisted state may change between releases. Existing single-goal behavior remains available.",
		);
		if (!confirmed) return undefined;
	}
	if (
		!enabled &&
		(runtime.queuedGoals.length > 0 || runtime.pendingQueueAction !== undefined) &&
		!(await ctx.ui.confirm(
			"Freeze ordered goal queue?",
			`Disabling the experiment preserves ${retainedGoalCount(runtime)} goal(s) but freezes automatic work until the setting is re-enabled. No goal data will be deleted.`,
		))
	) {
		return undefined;
	}
	return {
		...structuredClone(runtime.settings),
		experimental: { goals: enabled },
	} satisfies GoalSettings;
}

function applyToolVisibility(
	runtime: GoalRuntime,
	previous: GoalSettings,
	next: GoalSettings,
	ctx: ExtensionCommandContext,
) {
	if (previous.toolVisibility === next.toolVisibility) return;
	if (next.toolVisibility === "always") {
		if (runtime.goalToolsHiddenByPolicy.size > 0 && ctx.isIdle() !== true) {
			throw new Error("Wait for Pi to become idle before revealing Goal tools.");
		}
		runtime.restoreGoalToolsHiddenByPolicy();
		runtime.goalToolsUnlocked = true;
		return;
	}
	if (runtime.activeGoal) {
		runtime.goalToolsUnlocked = true;
		runtime.goalToolsHiddenByPolicy.clear();
		return;
	}
	if (ctx.isIdle() !== true) {
		throw new Error("Wait for Pi to become idle before hiding Goal tools.");
	}
	runtime.goalToolsUnlocked = false;
	runtime.hideGoalToolsIfLocked();
}

function applyQueueSetting(runtime: GoalRuntime, ctx: ExtensionCommandContext) {
	const hasQueueState = runtime.queuedGoals.length > 0 || runtime.pendingQueueAction !== undefined;
	const shouldFreeze = !runtime.settings.experimental.goals && hasQueueState;
	// Keep the freeze guard until the aborted Goal-owned run reaches agent_settled.
	// Releasing it earlier lets the old agent_end pause newly resumed work.
	if (runtime.queueFrozen && !shouldFreeze && runtime.queueFreezeAwaitingSettle) return;
	if (runtime.queueFrozen === shouldFreeze) return;
	const activeGoal = runtime.activeGoal?.status === "active" ? runtime.activeGoal : undefined;
	const goalOwnedRun = activeGoal && runtime.agentRunGoalId === activeGoal.id;
	if (shouldFreeze && activeGoal) {
		if (goalOwnedRun) runtime.recordGoalUsage(activeGoal, ctx, false);
		else {
			const now = Date.now();
			checkpointGoalActiveTime(activeGoal, now, false);
			activeGoal.updatedAt = now;
		}
	}
	runtime.queueFrozen = shouldFreeze;
	if (runtime.activeGoal) runtime.persistGoal(runtime.activeGoal);
	if (runtime.activeGoal) runtime.updateStatus(ctx, runtime.activeGoal);
	else runtime.clearPresentationStatus();
	if (!shouldFreeze) return;

	runtime.cancelContinuationWork();
	runtime.clearGoalRecovery();
	runtime.clearBudgetWrapUp();
	if (goalOwnedRun) {
		runtime.blockStaleGoalToolCalls();
		runtime.guardAbortGoalId = activeGoal.id;
		runtime.queueFreezeAwaitingSettle = true;
		runtime.clearAgentRun();
		abortCurrentTurn(ctx);
	}
}

function restorePersistedRuntime(runtime: GoalRuntime, ctx: ExtensionCommandContext) {
	if (runtime.activeGoal) {
		runtime.persistGoal(runtime.activeGoal);
		runtime.updateStatus(ctx, runtime.activeGoal);
		return;
	}
	runtime.clearPresentationStatus();
}

async function confirmLowerActiveLimit(
	runtime: GoalRuntime,
	ctx: ExtensionCommandContext,
	field: LimitField,
	limit: number | null,
) {
	const goal = runtime.activeGoal;
	if (goal?.status !== "active" || limit === null) return { apply: true };
	const used = field === "automaticTurns" ? goal.automaticModelTurns : goal.toolFreeRepeatCount;
	if (used < limit) return { apply: true };
	return {
		apply: await ctx.ui.confirm(
			"Apply limit and pause now?",
			`The active goal has already used ${used}. Setting this limit to ${limit} will pause it immediately without deleting progress.`,
		),
		goalId: goal.id,
	};
}

function withLimit(settings: GoalSettings, field: LimitField, value: number | null): GoalSettings {
	return {
		...structuredClone(settings),
		continuationLimits: { ...settings.continuationLimits, [field]: value },
	};
}

function formatAutomaticSettingValue(value: number | null) {
	return value === null ? "Unlimited" : `≤${value}`;
}

function formatNoProgressSettingValue(value: number | null) {
	if (value === null) return "Off";
	return `${value} ${value === 1 ? "run" : "runs"}`;
}

function formatAutomaticWork(value: number | null) {
	return value === null ? "Unlimited" : `Up to ${value} responses`;
}

function formatNoProgressProtection(value: number | null) {
	if (value === null) return "Off";
	return `After ${value} repeated ${value === 1 ? "run" : "runs"}`;
}

function formatLimitSuccess(field: LimitField, value: number | null) {
	return field === "automaticTurns"
		? `Automatic work: ${formatAutomaticWork(value)}.`
		: `No-progress guard: ${formatNoProgressProtection(value)}.`;
}

function isLimitSelection(value: string): value is LimitSelection {
	return value === "unlimited" || value === "custom" || value === "off";
}

function visibilityLabel(value: GoalSettings["toolVisibility"]) {
	return value === "always" ? "Always" : "After first goal";
}

function retainedGoalCount(runtime: GoalRuntime) {
	return (
		(runtime.activeGoal ? 1 : 0) +
		runtime.queuedGoals.length +
		(runtime.pendingQueueAction?.kind === "prioritize" ? 1 : 0)
	);
}

function notifySettingsFailure<Failure>(ctx: ExtensionCommandContext, settingsPath: string, error: Failure) {
	const path = safeTerminalText(settingsPath);
	const detail = safeTerminalText(formatError(error));
	ctx.ui.notify(
		error instanceof AggregateError
			? `Could not apply Goal settings, and rollback was incomplete. Check ${path}, run /reload, and verify the effective settings before retrying: ${detail}`
			: `Could not save Goal settings; the previous value remains. Check ${path} and retry: ${detail}`,
		"error",
	);
}

function safeTerminalText(value: string) {
	return [...value]
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
		})
		.join("")
		.trim();
}

function formatError<Failure>(error: Failure) {
	return error instanceof Error ? error.message : String(error);
}
