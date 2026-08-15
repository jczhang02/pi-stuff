import { createHash } from "node:crypto";
import type {
	ContextEvent,
	InputEvent,
	ToolCallEvent,
	ToolResultEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

export const WORK_CONTINUITY_TASK_ANCHOR_TYPE = "pi-stuff:task-anchor";
const MAX_PENDING_INPUTS = 64;
const MAX_REQUEST_BYTES = 6_000;
const MAX_CORRECTION_BYTES = 3_000;
const MAX_FIELD_BYTES = 1_600;
const MAX_RESULT_FINGERPRINT_BYTES = 64 * 1024;
const MAX_COMPLETED_VERIFICATIONS = 4;
const MAX_COMPLETED_VERIFICATION_BYTES = 256;
const MAX_COMPLETED_VERIFICATION_COMMAND_BYTES = 160;
const SYNTHESIS_REASON =
	"The aggregate work boundary was reached. Stop expanding the investigation and return the best supported result now. If the requested deliverable cannot be completed from current evidence, return an actionable incompleteness report that states what is verified, what remains, and why.";

export interface WorkContinuityLimits {
	readonly softTurns: number;
	readonly softTools: number;
	readonly softDelegations: number;
	readonly softCompactions: number;
	readonly noProgressTurns: number;
	readonly repeatedFailureLimit: number;
	readonly hardTurns: number;
	readonly hardTools: number;
	readonly hardDelegations: number;
	readonly hardCompactions: number;
	readonly evidenceProgressCredits: number;
}

export const DEFAULT_WORK_CONTINUITY_LIMITS: WorkContinuityLimits = {
	softTurns: 96,
	softTools: 512,
	softDelegations: 16,
	softCompactions: 8,
	noProgressTurns: 20,
	repeatedFailureLimit: 3,
	hardTurns: 120,
	hardTools: 640,
	hardDelegations: 20,
	hardCompactions: 10,
	evidenceProgressCredits: 12,
};

interface PendingInput {
	readonly behavior: "idle" | "steer" | "followUp";
	readonly text: string;
}

interface SessionEntryLike {
	readonly id?: unknown;
	readonly type?: unknown;
}

interface TaskAnchor {
	readonly rootRequest: string;
	latestCorrection?: string;
	readonly startedAt: number;
}

type SynthesisCause = "compactions" | "delegations" | "no-progress" | "repeated-failure" | "tools" | "turns";

interface ActiveWork {
	anchor: TaskAnchor;
	turns: number;
	tools: number;
	delegations: number;
	compactions: number;
	noProgressTurns: number;
	evidenceCreditsThisTurn: number;
	materialProgressThisTurn: boolean;
	seenEvidence: Set<string>;
	completedVerifications: string[];
	failureCounts: Map<string, number>;
	synthesisCause?: SynthesisCause;
	synthesisPromptDelivered: boolean;
	blockedToolAttempts: number;
}

export interface WorkContinuitySnapshot {
	readonly active: boolean;
	readonly turns: number;
	readonly tools: number;
	readonly delegations: number;
	readonly compactions: number;
	readonly noProgressTurns: number;
	readonly synthesisCause?: SynthesisCause;
	readonly synthesisPromptDelivered: boolean;
	readonly blockedToolAttempts: number;
}

export interface WorkToolDecision {
	readonly block: true;
	readonly reason: string;
	readonly terminate: boolean;
}

function positiveInteger(value: number, fallback: number): number {
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizedLimits(overrides: Partial<WorkContinuityLimits>): WorkContinuityLimits {
	const merged = { ...DEFAULT_WORK_CONTINUITY_LIMITS, ...overrides };
	return {
		softTurns: positiveInteger(merged.softTurns, DEFAULT_WORK_CONTINUITY_LIMITS.softTurns),
		softTools: positiveInteger(merged.softTools, DEFAULT_WORK_CONTINUITY_LIMITS.softTools),
		softDelegations: positiveInteger(merged.softDelegations, DEFAULT_WORK_CONTINUITY_LIMITS.softDelegations),
		softCompactions: positiveInteger(merged.softCompactions, DEFAULT_WORK_CONTINUITY_LIMITS.softCompactions),
		noProgressTurns: positiveInteger(merged.noProgressTurns, DEFAULT_WORK_CONTINUITY_LIMITS.noProgressTurns),
		repeatedFailureLimit: positiveInteger(
			merged.repeatedFailureLimit,
			DEFAULT_WORK_CONTINUITY_LIMITS.repeatedFailureLimit,
		),
		hardTurns: Math.max(
			positiveInteger(merged.hardTurns, DEFAULT_WORK_CONTINUITY_LIMITS.hardTurns),
			positiveInteger(merged.softTurns, DEFAULT_WORK_CONTINUITY_LIMITS.softTurns),
		),
		hardTools: Math.max(
			positiveInteger(merged.hardTools, DEFAULT_WORK_CONTINUITY_LIMITS.hardTools),
			positiveInteger(merged.softTools, DEFAULT_WORK_CONTINUITY_LIMITS.softTools),
		),
		hardDelegations: Math.max(
			positiveInteger(merged.hardDelegations, DEFAULT_WORK_CONTINUITY_LIMITS.hardDelegations),
			positiveInteger(merged.softDelegations, DEFAULT_WORK_CONTINUITY_LIMITS.softDelegations),
		),
		hardCompactions: Math.max(
			positiveInteger(merged.hardCompactions, DEFAULT_WORK_CONTINUITY_LIMITS.hardCompactions),
			positiveInteger(merged.softCompactions, DEFAULT_WORK_CONTINUITY_LIMITS.softCompactions),
		),
		evidenceProgressCredits: positiveInteger(
			merged.evidenceProgressCredits,
			DEFAULT_WORK_CONTINUITY_LIMITS.evidenceProgressCredits,
		),
	};
}

function boundUtf8(value: string, maximumBytes: number): string {
	const normalized = [...value]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return (
				codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || (codePoint >= 0x20 && codePoint !== 0x7f)
			);
		})
		.join("")
		.trim();
	const bytes = Buffer.from(normalized, "utf8");
	if (bytes.byteLength <= maximumBytes) return normalized;
	const marker = "\n…[bounded]";
	const markerBytes = Buffer.byteLength(marker, "utf8");
	let end = Math.max(0, maximumBytes - markerBytes);
	while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
	return `${bytes.subarray(0, end).toString("utf8")}${marker}`;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is object => Boolean(part) && typeof part === "object")
		.filter((part) => Reflect.get(part, "type") === "text")
		.map((part) => Reflect.get(part, "text"))
		.filter((text): text is string => typeof text === "string")
		.join("\n");
}

function selectedLines(text: string, pattern: RegExp): string {
	const lines = text
		.split(/\r?\n|(?<=[.!?。！？])\s+/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => pattern.test(line));
	return boundUtf8([...new Set(lines)].join("\n"), MAX_FIELD_BYTES);
}

function anchorText(anchor: TaskAnchor, work: ActiveWork): string {
	const authoritative = anchor.latestCorrection || anchor.rootRequest;
	const deliverable =
		selectedLines(
			authoritative,
			/\b(?:deliverable|output|report|review|implement|implementation|produce|return|write|create|fix|build)\b|(?:交付|输出|报告|审查|实现|产出|返回|编写|创建|修复|构建)/iu,
		) || "Complete the current request and return the result it explicitly asks for.";
	const constraints =
		selectedLines(
			authoritative,
			/\b(?:must|must not|do not|never|only|without|read-only|require|constraint|preserve|avoid)\b|(?:必须|不得|不要|只能|只读|要求|约束|保留|避免|禁止)/iu,
		) || "Honor every explicit constraint in the current request and the latest user correction.";
	const doneWhen =
		selectedLines(
			authoritative,
			/\b(?:done when|complete when|acceptance|success criteria|final(?:ly)?|before (?:finishing|completion)|must include|verify|verified)\b|(?:完成条件|验收|成功标准|最终|完成前|必须包含|验证|确认)/iu,
		) ||
		"Done when the requested deliverable is returned and every explicit constraint is addressed with available evidence.";
	const synthesis = work.synthesisCause
		? [
				"",
				"Convergence state: SYNTHESIS REQUIRED",
				`Boundary cause: ${work.synthesisCause}`,
				`Observed aggregate: ${work.turns} provider turns, ${work.tools} Tool calls, ${work.delegations} delegations, ${work.compactions} managed compactions, ${work.noProgressTurns} no-progress turns.`,
				SYNTHESIS_REASON,
			].join("\n")
		: "";
	const completedVerification = work.completedVerifications.length
		? [
				"",
				"Completed verification (do not rerun unless later work changed):",
				...work.completedVerifications.map((summary) => `- Bash: ${summary}`),
			].join("\n")
		: "";
	return [
		'<pi-stuff-task-anchor version="1" authority="latest-user-request">',
		"Current request:",
		boundUtf8(anchor.rootRequest, MAX_REQUEST_BYTES),
		...(anchor.latestCorrection
			? [
					"",
					"Latest user correction (authoritative; replaces prior corrections and supersedes conflicting request text):",
					boundUtf8(anchor.latestCorrection, MAX_CORRECTION_BYTES),
				]
			: []),
		"",
		"Required deliverable:",
		deliverable,
		"",
		"Material constraints:",
		constraints,
		"",
		"Done when:",
		doneWhen,
		completedVerification,
		synthesis,
		"</pi-stuff-task-anchor>",
	].join("\n");
}

function isTaskAnchor(message: ContextEvent["messages"][number]): boolean {
	return message.role === "custom" && message.customType === WORK_CONTINUITY_TASK_ANCHOR_TYPE;
}

function projectedTaskAnchorIndex(messages: ContextEvent["messages"]): number {
	const first = messages[0];
	if (first && isTaskAnchor(first)) return 0;
	const tail = messages.at(-1);
	return tail && isTaskAnchor(tail) ? messages.length - 1 : -1;
}

function fingerprint(toolName: string, content: string): string {
	return createHash("sha256")
		.update(boundUtf8(`${toolName}:${content}`, MAX_RESULT_FINGERPRINT_BYTES), "utf8")
		.digest("hex");
}

function completedVerification(toolName: string, text: string, input: Record<string, unknown>): string | undefined {
	if (toolName !== "bash") return undefined;
	const lines = text.split(/\r?\n/u).map((line) => line.trim());
	const passed = lines.find((line) => /^\d+\s+pass\b/iu.test(line));
	const failed = lines.find((line) => /^0\s+fail\b/iu.test(line));
	if (!passed || !failed) return undefined;
	const ran = lines.find((line) => /^Ran\s+\d+\s+tests?\b/iu.test(line))?.replace(/\s*\[[^\]]+\]\s*$/u, "");
	const command =
		typeof input["command"] === "string"
			? boundUtf8(input["command"].replace(/\s+/gu, " "), MAX_COMPLETED_VERIFICATION_COMMAND_BYTES)
			: undefined;
	return boundUtf8(
		[command ? `command: ${command}` : undefined, passed, failed, ran].filter(Boolean).join("; "),
		MAX_COMPLETED_VERIFICATION_BYTES,
	);
}

function failureCategory(text: string): string {
	if (/payload input bound|context(?:[_\s-]*(?:length|window|overflow))|too many tokens/iu.test(text))
		return "context";
	if (/protocol[_\s-]|message(?:\.|_).*invalid|malformed event/iu.test(text)) return "protocol";
	if (/timed?\s*out|deadline/iu.test(text)) return "timeout";
	if (/\b(?:401|403|429|5\d\d)\b|auth(?:entication|orization)?|quota|rate limit|provider/iu.test(text)) {
		return "provider";
	}
	if (/turn budget|tool budget|budget/iu.test(text)) return "budget";
	if (/signal|exit(?:ed| code)|process|crash|disappear/iu.test(text)) return "process";
	return "unknown";
}

function isMutationTool(name: string): boolean {
	return new Set(["write", "edit", "apply_patch", "goal_complete"]).has(name);
}

function isConvergenceExitTool(name: string): boolean {
	return name === "goal_complete" || name === "goal_blocked";
}

function isDelegationLaunch(event: { readonly toolName: string; readonly input?: Record<string, unknown> }): boolean {
	return event.toolName === "subagent" && typeof event.input?.["action"] !== "string";
}

function actionableBlockReason(work: ActiveWork): string {
	return [
		"The aggregate user-work convergence boundary is active; this Tool call was not executed.",
		SYNTHESIS_REASON,
		`Boundary cause: ${work.synthesisCause ?? "aggregate-hard-limit"}.`,
	].join(" ");
}

export class WorkContinuityGovernor {
	private readonly limits: WorkContinuityLimits;
	private readonly pendingInputs: PendingInput[] = [];
	private readonly observedCompactionIds = new Set<string>();
	private active: ActiveWork | undefined;

	constructor(limits: Partial<WorkContinuityLimits> = {}) {
		this.limits = normalizedLimits(limits);
	}

	noteInput(event: Pick<InputEvent, "source" | "streamingBehavior" | "text">): void {
		if (event.source === "extension") return;
		const behavior = event.streamingBehavior ?? "idle";
		if (behavior === "idle") this.pendingInputs.length = 0;
		this.pendingInputs.push({ behavior, text: event.text });
		if (this.pendingInputs.length > MAX_PENDING_INPUTS)
			this.pendingInputs.splice(0, this.pendingInputs.length - MAX_PENDING_INPUTS);
	}

	noteMessageStart(message: { readonly role?: unknown; readonly content?: unknown }, userAttributed: boolean): void {
		if ((message.role !== "user" && message.role !== "custom") || !userAttributed) return;
		const text = messageText(message.content).trim();
		if (!text) return;
		const exact = this.pendingInputs.findIndex((pending) => pending.text === text);
		const pending =
			this.pendingInputs.length > 0 ? this.pendingInputs.splice(exact >= 0 ? exact : 0, 1)[0] : undefined;
		const behavior = pending?.behavior ?? (this.active ? "followUp" : "idle");
		if (behavior === "idle" || !this.active) {
			this.active = {
				anchor: { rootRequest: text, startedAt: Date.now() },
				turns: 0,
				tools: 0,
				delegations: 0,
				compactions: 0,
				noProgressTurns: 0,
				evidenceCreditsThisTurn: 0,
				materialProgressThisTurn: false,
				seenEvidence: new Set(),
				completedVerifications: [],
				failureCounts: new Map(),
				synthesisPromptDelivered: false,
				blockedToolAttempts: 0,
			};
			return;
		}
		this.active.anchor.latestCorrection = text;
		this.active.completedVerifications.length = 0;
	}

	noteToolCall(
		event: Pick<ToolCallEvent, "toolName"> & { readonly input?: Record<string, unknown> },
	): WorkToolDecision | undefined {
		const work = this.active;
		if (!work || isConvergenceExitTool(event.toolName)) return undefined;
		if (work.synthesisPromptDelivered) return this.blockTool(work);
		const nextTools = work.tools + 1;
		const nextDelegations = work.delegations + (isDelegationLaunch(event) ? 1 : 0);
		const hardCause =
			nextDelegations > this.limits.hardDelegations
				? "delegations"
				: work.compactions >= this.limits.hardCompactions
					? "compactions"
					: nextTools > this.limits.hardTools
						? "tools"
						: work.turns >= this.limits.hardTurns
							? "turns"
							: undefined;
		if (hardCause) {
			this.requireSynthesis(work, hardCause);
			work.synthesisPromptDelivered = true;
			return this.blockTool(work);
		}
		work.tools = nextTools;
		work.delegations = nextDelegations;
		this.evaluateSoftLimits(work);
		return undefined;
	}

	noteToolResult(event: Pick<ToolResultEvent, "content" | "input" | "isError" | "toolName">): void {
		const work = this.active;
		if (!work) return;
		const text = messageText(event.content);
		if (
			event.toolName === "subagent" &&
			(event.isError || /(?:^|\s)(?:failed|failure)(?:\s|$)|Failure\s*\[/iu.test(text))
		) {
			const category = failureCategory(text);
			const count = (work.failureCounts.get(category) ?? 0) + 1;
			work.failureCounts.set(category, count);
			if (count >= this.limits.repeatedFailureLimit) this.requireSynthesis(work, "repeated-failure");
			return;
		}
		if (event.isError) return;
		if (isMutationTool(event.toolName)) {
			work.completedVerifications.length = 0;
			work.materialProgressThisTurn = true;
			return;
		}
		const evidenceText = messageText(event.content).trim();
		if (!evidenceText) return;
		const verification = completedVerification(event.toolName, evidenceText, event.input);
		if (verification && !work.completedVerifications.includes(verification)) {
			work.completedVerifications.push(verification);
			if (work.completedVerifications.length > MAX_COMPLETED_VERIFICATIONS) work.completedVerifications.shift();
		}
		const evidence = fingerprint(event.toolName, verification ?? evidenceText);
		if (work.seenEvidence.has(evidence)) return;
		work.seenEvidence.add(evidence);
		if (work.evidenceCreditsThisTurn < this.limits.evidenceProgressCredits) {
			work.evidenceCreditsThisTurn += 1;
			work.materialProgressThisTurn = true;
		}
	}

	noteTurnEnd(_event: Pick<TurnEndEvent, "turnIndex">): void {
		const work = this.active;
		if (!work) return;
		work.turns += 1;
		work.noProgressTurns = work.materialProgressThisTurn ? 0 : work.noProgressTurns + 1;
		work.materialProgressThisTurn = false;
		work.evidenceCreditsThisTurn = 0;
		this.evaluateSoftLimits(work);
	}

	noteCompaction(): void {
		const work = this.active;
		if (!work) return;
		work.compactions += 1;
		this.evaluateSoftLimits(work);
	}

	resetForSession(entries: readonly SessionEntryLike[]): void {
		this.settle();
		this.observedCompactionIds.clear();
		for (const entry of entries) {
			if (entry.type !== "compaction" || typeof entry.id !== "string" || !entry.id) continue;
			this.observedCompactionIds.add(entry.id);
		}
	}

	observeCompactions(entries: readonly SessionEntryLike[], fromIndex = 0): void {
		for (let index = Math.max(0, fromIndex); index < entries.length; index += 1) {
			const entry = entries[index];
			if (!entry) continue;
			if (entry.type !== "compaction" || typeof entry.id !== "string" || !entry.id) continue;
			if (this.observedCompactionIds.has(entry.id)) continue;
			this.observedCompactionIds.add(entry.id);
			this.noteCompaction();
		}
	}

	project(event: ContextEvent): { readonly messages: ContextEvent["messages"] } | undefined {
		const messages = event.messages;
		const previousAnchorIndex = projectedTaskAnchorIndex(messages);
		const work = this.active;
		if (!work) {
			if (previousAnchorIndex < 0) return undefined;
			messages.splice(previousAnchorIndex, 1);
			return { messages };
		}
		const anchor = {
			role: "custom" as const,
			customType: WORK_CONTINUITY_TASK_ANCHOR_TYPE,
			content: anchorText(work.anchor, work),
			display: false,
			details: {
				version: 1,
				startedAt: work.anchor.startedAt,
				synthesisRequired: Boolean(work.synthesisCause),
			},
			timestamp: Date.now(),
		} satisfies ContextEvent["messages"][number];
		if (work.synthesisCause) work.synthesisPromptDelivered = true;
		const trailsConversation = work.completedVerifications.length > 0;
		const expectedIndex = trailsConversation ? messages.length - 1 : 0;
		if (previousAnchorIndex === expectedIndex) {
			messages[previousAnchorIndex] = anchor;
		} else {
			if (previousAnchorIndex >= 0) messages.splice(previousAnchorIndex, 1);
			if (trailsConversation) messages.push(anchor);
			else messages.unshift(anchor);
		}
		return { messages };
	}

	hasActiveWork(): boolean {
		return Boolean(this.active);
	}

	automaticContinuationBlockReason(): string | undefined {
		const work = this.active;
		if (!work) return undefined;
		const hardCause =
			work.compactions >= this.limits.hardCompactions
				? "compactions"
				: work.turns >= this.limits.hardTurns
					? "turns"
					: undefined;
		if (!hardCause) return undefined;
		this.requireSynthesis(work, hardCause);
		work.synthesisPromptDelivered = true;
		return actionableBlockReason(work);
	}

	settle(): void {
		this.active = undefined;
		this.pendingInputs.length = 0;
	}

	settleIfQuiet(isIdle: boolean, hasPendingMessages: boolean, hasActiveDependentWork = false): void {
		if (isIdle && !hasPendingMessages && !hasActiveDependentWork) this.settle();
	}

	reset(): void {
		this.resetForSession([]);
	}

	snapshot(): WorkContinuitySnapshot {
		const work = this.active;
		return {
			active: Boolean(work),
			turns: work?.turns ?? 0,
			tools: work?.tools ?? 0,
			delegations: work?.delegations ?? 0,
			compactions: work?.compactions ?? 0,
			noProgressTurns: work?.noProgressTurns ?? 0,
			...(work?.synthesisCause ? { synthesisCause: work.synthesisCause } : {}),
			synthesisPromptDelivered: work?.synthesisPromptDelivered ?? false,
			blockedToolAttempts: work?.blockedToolAttempts ?? 0,
		};
	}

	private blockTool(work: ActiveWork): WorkToolDecision {
		work.blockedToolAttempts += 1;
		return {
			block: true,
			reason: actionableBlockReason(work),
			terminate: work.blockedToolAttempts > 1,
		};
	}

	private requireSynthesis(work: ActiveWork, cause: SynthesisCause): void {
		work.synthesisCause ??= cause;
	}

	private evaluateSoftLimits(work: ActiveWork): void {
		if (work.synthesisCause) return;
		if (work.noProgressTurns >= this.limits.noProgressTurns) this.requireSynthesis(work, "no-progress");
		else if (work.turns >= this.limits.softTurns) this.requireSynthesis(work, "turns");
		else if (work.tools >= this.limits.softTools) this.requireSynthesis(work, "tools");
		else if (work.delegations >= this.limits.softDelegations) this.requireSynthesis(work, "delegations");
		else if (work.compactions >= this.limits.softCompactions) this.requireSynthesis(work, "compactions");
	}
}

export const __workContinuityTest = { TASK_ANCHOR_TYPE: WORK_CONTINUITY_TASK_ANCHOR_TYPE, messageText };
