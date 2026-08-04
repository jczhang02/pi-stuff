import { createHash } from "node:crypto";
import type { ActiveGoal, GoalBlockerAudit } from "./persistence.js";

export interface GoalCompletionEvidence {
	requirement: string;
	proof: string;
}

const MIN_COMPLETION_SUMMARY_LENGTH = 20;
const MIN_COMPLETION_EVIDENCE_LENGTH = 24;
const MIN_BLOCKER_REASON_LENGTH = 12;
const MIN_BLOCKER_ATTEMPT_LENGTH = 16;
const MIN_BLOCKER_EVIDENCE_LENGTH = 24;
const CONCRETE_EVIDENCE_RE =
	/(?:\b(?:test|check|build|lint|typecheck|command|file|line|output|response|status|exit|hash|url|request|query|inspection|observed|confirmed|verified|passed|failed|denied|unavailable)\b|(?:^|\s)(?:\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)(?:\s|$))/iu;
const BLOCKER_ATTEMPT_RE = /\b(?:attempted|tried|checked|queried|requested|contacted|inspected|ran|tested|used)\b/iu;
const BLOCKER_RESULT_RE =
	/\b(?:returned|responded|failed|denied|unavailable|missing|not configured|not found|exit|status|error|rejected|refused|timed out)\b/iu;

export interface ToolFreeRepeatState {
	toolFreeRepeatCount: number;
	lastToolFreeOutputFingerprint?: string;
}

export function queueGoalSafetyReset(goal: ActiveGoal): ActiveGoal {
	return { ...goal, safetyResetPending: true };
}

export function resetGoalSafetyEpoch(goal: ActiveGoal): ActiveGoal {
	return {
		...goal,
		automaticModelTurns: 0,
		toolFreeRepeatCount: 0,
		lastToolFreeOutputFingerprint: undefined,
		blockerAudit: undefined,
		safetyPauseCause: undefined,
		safetyResetPending: undefined,
	};
}

export function recordGoalBlockerAttempt(
	goal: ActiveGoal,
	reason: string,
	attemptedAction: string,
	evidence: string,
): GoalBlockerAudit {
	const reasonFingerprint = createHash("sha256").update(normalizeBlockerReason(reason), "utf8").digest("hex");
	const attemptFingerprint = createHash("sha256")
		.update(normalizeBlockerAttempt(attemptedAction), "utf8")
		.digest("hex");
	const attempt = {
		iteration: goal.iteration,
		attempt: attemptedAction.trim(),
		attemptFingerprint,
		evidence: evidence.trim(),
	};
	const previous = goal.blockerAudit;
	if (previous?.reasonFingerprint === reasonFingerprint) {
		if (previous.lastIteration === goal.iteration) return previous;
		if (
			previous.lastIteration + 1 === goal.iteration &&
			!previous.attempts.some((candidate) => candidate.attemptFingerprint === attemptFingerprint)
		) {
			const attempts = [...previous.attempts, attempt].slice(-3);
			return {
				reasonFingerprint,
				lastIteration: goal.iteration,
				consecutiveTurns: attempts.length,
				attempts,
			};
		}
	}
	return { reasonFingerprint, lastIteration: goal.iteration, consecutiveTurns: 1, attempts: [attempt] };
}

export function completionEvidenceRejectionReason(
	summary: string,
	evidence: readonly GoalCompletionEvidence[],
): string | undefined {
	if (!isSubstantiveText(summary, MIN_COMPLETION_SUMMARY_LENGTH, 4)) {
		return "summary must substantively describe the completed result";
	}
	if (evidence.length === 0) return "requirement-by-requirement evidence is required";
	const requirements = new Set<string>();
	for (const [index, item] of evidence.entries()) {
		const requirement = normalizeAuditText(item.requirement);
		const proof = normalizeAuditText(item.proof);
		if (!isSubstantiveText(requirement, 8, 2)) {
			return `evidence ${index + 1} has no substantive requirement`;
		}
		if (!isSubstantiveText(proof, MIN_COMPLETION_EVIDENCE_LENGTH, 4) || !CONCRETE_EVIDENCE_RE.test(proof)) {
			return `evidence ${index + 1} has no concrete verification result`;
		}
		if (requirements.has(requirement)) return `evidence ${index + 1} repeats a requirement`;
		requirements.add(requirement);
	}
	return undefined;
}

export function blockerReportRejectionReason(
	goal: ActiveGoal,
	reason: string,
	attemptedAction: string,
	evidence: string,
): string | undefined {
	const normalizedReason = normalizeBlockerReason(reason);
	const normalizedAttempt = normalizeBlockerAttempt(attemptedAction);
	const normalizedEvidence = normalizeAuditText(evidence);
	if (!isSubstantiveText(normalizedReason, MIN_BLOCKER_REASON_LENGTH, 3)) {
		return "reason must identify a substantive external action needed to unblock the goal";
	}
	if (
		!isSubstantiveText(normalizedAttempt, MIN_BLOCKER_ATTEMPT_LENGTH, 3) ||
		!BLOCKER_ATTEMPT_RE.test(normalizedAttempt)
	) {
		return "attempt must describe the concrete action tried during this Goal turn";
	}
	if (
		!isSubstantiveText(normalizedEvidence, MIN_BLOCKER_EVIDENCE_LENGTH, 5) ||
		!BLOCKER_RESULT_RE.test(normalizedEvidence)
	) {
		return "evidence must describe the concrete observed failure from that attempt";
	}
	const attemptFingerprint = createHash("sha256").update(normalizedAttempt, "utf8").digest("hex");
	if (goal.blockerAudit?.attempts.some((attempt) => attempt.attemptFingerprint === attemptFingerprint)) {
		return "attempt repeats an earlier blocker action";
	}
	return undefined;
}

function normalizeBlockerReason(reason: string) {
	return normalizeAuditText(reason)
		.replace(/[\p{P}\p{S}]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}

function normalizeBlockerAttempt(value: string) {
	return normalizeAuditText(value)
		.replace(/^\s*(?:attempt|try|turn)\s*(?:number|no\.?|#)?\s*\d+\s*[:.)-]?\s*/iu, "")
		.replace(/[\p{P}\p{S}]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}

function normalizeAuditText(value: string) {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\p{Cc}\p{Cf}]/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

function isSubstantiveText(value: string, minimumLength: number, minimumWords: number) {
	if (value.length < minimumLength) return false;
	const words = value.match(/[\p{L}\p{N}][\p{L}\p{N}_./:-]*/gu) ?? [];
	return new Set(words).size >= minimumWords;
}

export function nextToolFreeRepeatState(
	current: ToolFreeRepeatState,
	messages: readonly unknown[],
	toolAttempted: boolean,
): ToolFreeRepeatState {
	if (toolAttempted) return { toolFreeRepeatCount: 0 };
	const fingerprint = fingerprintVisibleAssistantOutput(messages);
	return {
		toolFreeRepeatCount:
			fingerprint === current.lastToolFreeOutputFingerprint
				? Math.min(Number.MAX_SAFE_INTEGER, current.toolFreeRepeatCount + 1)
				: 1,
		lastToolFreeOutputFingerprint: fingerprint,
	};
}

export function hasAssistantToolCall(messages: readonly unknown[]) {
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
			continue;
		}
		if (message.content.some((block) => isRecord(block) && block.type === "toolCall")) return true;
	}
	return false;
}

export function fingerprintVisibleAssistantOutput(messages: readonly unknown[]) {
	const normalized = normalizeVisibleAssistantOutput(messages);
	return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function normalizeVisibleAssistantOutput(messages: readonly unknown[]) {
	const text: string[] = [];
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") continue;
			text.push(block.text);
		}
	}
	const normalized = text
		.join("\n")
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\s+/gu, " ")
		.replace(/[\p{Cc}\p{Cf}]/gu, "")
		.trim();
	return normalized === "" || /^[\p{P}\s]+$/u.test(normalized) ? "" : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
