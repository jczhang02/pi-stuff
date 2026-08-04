import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { isNonNegativeFiniteNumber, nonNegativeFiniteNumber, normalizeTokenBudget } from "./accounting.js";
import type { GoalStatus } from "./prompts.js";

const GOAL_STATE_ENTRY_TYPE = "goal-state";
const LEGACY_GOALS_STATE_ENTRY_TYPE = "goals-state";
const STATE_FILE = join(
	process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? ".", ".pi", "agent"),
	"pi-goal-state.json",
);

export type SafetyPauseCause = "continuation_limit" | "no_progress" | "runaway_backstop";

interface GoalBlockerAttempt {
	iteration: number;
	attempt: string;
	attemptFingerprint: string;
	evidence: string;
}

export interface GoalBlockerAudit {
	reasonFingerprint: string;
	lastIteration: number;
	consecutiveTurns: number;
	attempts: GoalBlockerAttempt[];
}

export interface ActiveGoal {
	id: string;
	text: string;
	status: GoalStatus;
	startedAt: number;
	updatedAt: number;
	iteration: number;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	baselineTokens: number;
	activeStartedAt?: number;
	automaticModelTurns: number;
	toolFreeRepeatCount: number;
	lastToolFreeOutputFingerprint?: string;
	blockerAudit?: GoalBlockerAudit;
	safetyPauseCause?: SafetyPauseCause;
	safetyResetPending?: boolean;
}

export type PendingQueueAction =
	| {
			kind: "prioritize";
			objective: string;
			tokenBudget?: number;
			displacedUsageFinalized?: boolean;
	  }
	| {
			kind: "advance";
			goalId: string;
			reason: "complete" | "skip";
			completedText: string;
	  };

export interface GoalStateEntryData {
	goal: ActiveGoal | null;
	queue?: ActiveGoal[];
	pendingAction?: PendingQueueAction;
}

export interface LoadedGoalState {
	goal: ActiveGoal | undefined;
	queue: ActiveGoal[];
	pendingAction: PendingQueueAction | undefined;
	hasExperimentalQueueState: boolean;
	source: "none" | "canonical" | "legacy-goals";
}

interface SessionEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

interface SessionContext {
	sessionManager?: {
		getBranch?: () => SessionEntry[];
		getEntries?: () => SessionEntry[];
	};
}

export function serializeGoalState(
	goal: ActiveGoal | undefined,
	queue: readonly ActiveGoal[],
	pendingAction: PendingQueueAction | undefined,
): GoalStateEntryData {
	return {
		goal: goal ?? null,
		...(queue.length > 0 ? { queue: [...queue] } : {}),
		...(pendingAction ? { pendingAction } : {}),
	};
}

export function loadGoalStateFromSession(ctx: SessionContext): LoadedGoalState {
	const entries = ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [];
	const canonicalEntry = entries
		.filter((entry) => entry.type === "custom" && entry.customType === GOAL_STATE_ENTRY_TYPE)
		.pop();
	if (canonicalEntry) return loadCanonicalGoalState(canonicalEntry.data);

	const legacyEntry = entries
		.filter((entry) => entry.type === "custom" && entry.customType === LEGACY_GOALS_STATE_ENTRY_TYPE)
		.pop();
	return legacyEntry ? loadLegacyGoalsState(legacyEntry.data) : emptyGoalState("none");
}

function loadCanonicalGoalState(data: unknown): LoadedGoalState {
	if (!isRecord(data)) return emptyGoalState("canonical");
	const rawGoal = data.goal;
	if (rawGoal !== null && !isGoal(rawGoal)) return emptyGoalState("canonical");
	const rawQueue = Object.hasOwn(data, "queue") ? data.queue : [];
	if (!Array.isArray(rawQueue) || !rawQueue.every(isQueueGoal)) {
		return emptyGoalState("canonical");
	}
	const pendingAction = normalizePendingQueueAction(data.pendingAction);
	if (Object.hasOwn(data, "pendingAction") && !pendingAction) {
		return emptyGoalState("canonical");
	}

	const queue = rawQueue.map(normalizeQueuedGoal);
	let goal = rawGoal === null ? undefined : normalizeLoadedGoal(rawGoal);
	if (goal?.status === "complete" && !pendingAction) goal = undefined;
	if (!goal && (queue.length > 0 || pendingAction)) return emptyGoalState("canonical");
	return {
		goal,
		queue,
		pendingAction,
		hasExperimentalQueueState: goal?.status === "queued" || queue.length > 0 || pendingAction !== undefined,
		source: "canonical",
	};
}

function loadLegacyGoalsState(data: unknown): LoadedGoalState {
	if (!isRecord(data)) return emptyGoalState("legacy-goals");
	let rawGoals: ActiveGoal[];
	if (Array.isArray(data.goals)) {
		if (!data.goals.every(isGoal)) return emptyGoalState("legacy-goals");
		rawGoals = data.goals.filter((goal) => goal.status !== "complete");
	} else if (isGoal(data.goal) && data.goal.status !== "complete") {
		rawGoals = [data.goal];
	} else {
		rawGoals = [];
	}
	const goals = rawGoals.map((goal, index) => (index === 0 ? normalizeLoadedGoal(goal) : normalizeQueuedGoal(goal)));
	const pendingAction = normalizeLegacyPendingPrioritize(data.pendingUnshift);
	if (goals.length === 0) return emptyGoalState("legacy-goals");
	return {
		goal: goals[0],
		queue: goals.slice(1),
		pendingAction,
		hasExperimentalQueueState: goals[0]?.status === "queued" || goals.length > 1 || pendingAction !== undefined,
		source: "legacy-goals",
	};
}

function normalizePendingQueueAction(value: unknown): PendingQueueAction | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind === "prioritize") {
		if (
			!validObjective(value.objective) ||
			(Object.hasOwn(value, "displacedUsageFinalized") && typeof value.displacedUsageFinalized !== "boolean")
		) {
			return undefined;
		}
		return {
			kind: "prioritize",
			objective: value.objective,
			tokenBudget: normalizeTokenBudget(value.tokenBudget),
			...(value.displacedUsageFinalized === true ? { displacedUsageFinalized: true } : {}),
		};
	}
	if (value.kind === "advance") {
		if (
			typeof value.goalId !== "string" ||
			!value.goalId ||
			value.goalId !== value.goalId.trim() ||
			(value.reason !== "complete" && value.reason !== "skip") ||
			!validObjective(value.completedText)
		) {
			return undefined;
		}
		return {
			kind: "advance",
			goalId: value.goalId,
			reason: value.reason,
			completedText: value.completedText,
		};
	}
	return undefined;
}

function normalizeLegacyPendingPrioritize(value: unknown): PendingQueueAction | undefined {
	if (!isRecord(value) || !validObjective(value.objective)) return undefined;
	return {
		kind: "prioritize",
		objective: value.objective,
		tokenBudget: normalizeTokenBudget(value.tokenBudget),
	};
}

function validObjective(value: unknown): value is string {
	return typeof value === "string" && Boolean(value.trim()) && value.length <= 4_000;
}

function normalizeQueuedGoal(goal: ActiveGoal): ActiveGoal {
	const normalized = normalizeLoadedGoal(goal);
	return normalized.status === "active"
		? { ...normalized, status: "queued", activeStartedAt: undefined }
		: { ...normalized, activeStartedAt: undefined };
}

function normalizeLoadedGoal(goal: ActiveGoal): ActiveGoal {
	const now = Date.now();
	const iteration = Math.max(0, Math.floor(nonNegativeFiniteNumber(goal.iteration)));
	return {
		...goal,
		startedAt: isNonNegativeFiniteNumber(goal.startedAt) ? goal.startedAt : now,
		updatedAt: isNonNegativeFiniteNumber(goal.updatedAt) ? goal.updatedAt : now,
		iteration,
		tokenBudget: normalizeTokenBudget(goal.tokenBudget),
		tokensUsed: nonNegativeFiniteNumber(goal.tokensUsed),
		timeUsedSeconds: nonNegativeFiniteNumber(goal.timeUsedSeconds),
		baselineTokens: nonNegativeFiniteNumber(goal.baselineTokens),
		activeStartedAt: goal.status === "active" ? now : undefined,
		automaticModelTurns: normalizeSafetyCounter(goal.automaticModelTurns),
		toolFreeRepeatCount: normalizeSafetyCounter(goal.toolFreeRepeatCount),
		lastToolFreeOutputFingerprint: normalizeOutputFingerprint(goal.lastToolFreeOutputFingerprint),
		blockerAudit: normalizeBlockerAudit(goal.blockerAudit, iteration),
		safetyPauseCause: normalizeSafetyPauseCause(goal.safetyPauseCause),
		safetyResetPending: goal.safetyResetPending === true ? true : undefined,
	};
}

function normalizeBlockerAudit(value: unknown, iteration: number): GoalBlockerAudit | undefined {
	if (!isRecord(value)) return undefined;
	const reasonFingerprint = normalizeOutputFingerprint(value.reasonFingerprint);
	const lastIteration = normalizeSafetyCounter(value.lastIteration);
	const consecutiveTurns = normalizeSafetyCounter(value.consecutiveTurns);
	const attempts = normalizeBlockerAttempts(value.attempts);
	if (
		!reasonFingerprint ||
		consecutiveTurns < 1 ||
		lastIteration > iteration ||
		consecutiveTurns > lastIteration + 1 ||
		attempts.length !== consecutiveTurns ||
		attempts.at(-1)?.iteration !== lastIteration
	) {
		return undefined;
	}
	return { reasonFingerprint, lastIteration, consecutiveTurns, attempts };
}

function normalizeBlockerAttempts(value: unknown): GoalBlockerAttempt[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 3) return [];
	const attempts: GoalBlockerAttempt[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) return [];
		const iteration = normalizeSafetyCounter(candidate.iteration);
		const attemptFingerprint = normalizeOutputFingerprint(candidate.attemptFingerprint);
		if (
			typeof candidate.attempt !== "string" ||
			!candidate.attempt.trim() ||
			candidate.attempt.length > 4_000 ||
			typeof candidate.evidence !== "string" ||
			!candidate.evidence.trim() ||
			candidate.evidence.length > 4_000 ||
			!attemptFingerprint ||
			(attempts.at(-1)?.iteration ?? -1) >= iteration ||
			attempts.some((attempt) => attempt.attemptFingerprint === attemptFingerprint)
		) {
			return [];
		}
		attempts.push({
			iteration,
			attempt: candidate.attempt,
			attemptFingerprint,
			evidence: candidate.evidence,
		});
	}
	return attempts;
}

function normalizeSafetyCounter(value: unknown) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeOutputFingerprint(value: unknown) {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

function normalizeSafetyPauseCause(value: unknown): SafetyPauseCause | undefined {
	return value === "continuation_limit" || value === "no_progress" || value === "runaway_backstop" ? value : undefined;
}

export function clearLegacyPersistedGoal(cwd: string) {
	if (!existsSync(STATE_FILE)) return;
	const goals = readState();
	delete goals[cwd];
	mkdirSync(dirname(STATE_FILE), { recursive: true });
	writeFileSync(STATE_FILE, `${JSON.stringify(goals, null, 2)}\n`);
}

function readState(): Record<string, unknown> {
	if (!existsSync(STATE_FILE)) return {};
	try {
		const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function isGoal(value: unknown): value is ActiveGoal {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		Boolean(value.id) &&
		value.id === value.id.trim() &&
		validObjective(value.text) &&
		["active", "queued", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(
			String(value.status),
		) &&
		typeof value.startedAt === "number" &&
		typeof value.updatedAt === "number" &&
		typeof value.iteration === "number" &&
		typeof value.tokensUsed === "number" &&
		typeof value.timeUsedSeconds === "number" &&
		typeof value.baselineTokens === "number" &&
		(value.activeStartedAt === undefined || typeof value.activeStartedAt === "number") &&
		(value.safetyResetPending === undefined || typeof value.safetyResetPending === "boolean")
	);
}

function isQueueGoal(value: unknown): value is ActiveGoal {
	return isGoal(value) && value.status !== "complete";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyGoalState(source: LoadedGoalState["source"]): LoadedGoalState {
	return {
		goal: undefined,
		queue: [],
		pendingAction: undefined,
		hasExperimentalQueueState: false,
		source,
	};
}
