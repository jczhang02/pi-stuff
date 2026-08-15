import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { ToolActivityState } from "./activity-store.js";
import { oneLine } from "./render.js";
import { boundTerminalLine, compactTerminalPath } from "./terminal.js";

const ACTIVITY_TARGET_MAX_WIDTH = 160;
const BASH_EVIDENCE_TEXT_LIMIT = 64 * 1024;
// ponytail: Background Work emits its handoff marker at a result boundary;
// widen this head/tail window only if that protocol changes.
const BACKGROUND_MARKER_SCAN_LIMIT = 1024;
const BACKGROUND_MARKER = /\b(?:started|moved|manually moved) to background task\b/iu;

export type ToolActivityCategory =
	| "block-goal"
	| "change-file"
	| "check-task"
	| "commit"
	| "complete-goal"
	| "connect-mcp"
	| "create-pr"
	| "fetch-page"
	| "generate-image"
	| "inspect-background"
	| "invoke-mcp"
	| "launch-agent"
	| "launch-background"
	| "list-directory"
	| "check-agent"
	| "message-agent"
	| "merge"
	| "read-background"
	| "read-file"
	| "read-memory"
	| "read-note"
	| "push"
	| "rebase"
	| "record-result"
	| "retrieve-passage"
	| "review-history-range"
	| "resume-agent"
	| "run-agent"
	| "run-command"
	| "save-memory"
	| "save-note"
	| "search-history"
	| "search-mcp"
	| "search-pattern"
	| "search-tool"
	| "search-web"
	| "start-monitor"
	| "steer-agent"
	| "stop-background"
	| "stop-agent"
	| "update-memory"
	| "update-note"
	| "update-task"
	| "view-image";

export interface ToolActivityItem {
	readonly category: ToolActivityCategory;
	/** Stable identities are deduplicated within one Activity Group. */
	readonly countKeys?: readonly string[];
	/** Invocation-like work adds this quantity instead of deduplicating. */
	readonly count?: number;
	/** Conservative structured outcome, such as a commit SHA or pushed branch. */
	readonly detail?: string;
	/** Short active target. Never pass an unbounded command or result body. */
	readonly target?: string;
}

export interface ToolActivityClassifierInput<TArgs extends Record<string, unknown>, TDetails> {
	readonly args: Readonly<TArgs>;
	/** Host working directory for canonicalizing relative Activity identities. */
	readonly cwd?: string;
	readonly result?: AgentToolResult<TDetails>;
	readonly state: ToolActivityState;
}

export interface ToolActivityMetadata<TArgs extends Record<string, unknown>, TDetails> {
	/** Every semantic category this Tool may contribute. Empty is valid only for declared infrastructure. */
	readonly categories: readonly ToolActivityCategory[];
	readonly classify: (input: ToolActivityClassifierInput<TArgs, TDetails>) => readonly ToolActivityItem[];
	/** Successful calls intentionally contribute no compact clause. */
	readonly silentSuccess?: boolean;
	/** Optional semantic description for an exceptional result. */
	readonly summarizeIssue?: (
		args: Readonly<TArgs>,
		result: AgentToolResult<TDetails>,
		state: Exclude<ToolActivityState, "running" | "success">,
	) => string;
}

export function activityKey(...parts: readonly unknown[]): string {
	return parts
		.map((part) => oneLine(typeof part === "string" ? part : (JSON.stringify(part) ?? "")))
		.filter(Boolean)
		.join("\u0000");
}

/** Keep live targets glanceable without exposing a complete deep path. */
export function activityTarget(value: string): string {
	const safe = boundTerminalLine(value, ACTIVITY_TARGET_MAX_WIDTH);
	const pathLike =
		/^(?:~?[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/u.test(safe) ||
		(!/^[a-z][a-z\d+.-]*:\/\//iu.test(safe) && /[\\/]/u.test(safe));
	if (!pathLike) return safe;
	return compactTerminalPath(safe, ACTIVITY_TARGET_MAX_WIDTH, true);
}

export function singleActivity(
	category: ToolActivityCategory,
	options: { readonly key?: string; readonly target?: string; readonly count?: number } = {},
): readonly ToolActivityItem[] {
	return [
		{
			category,
			...(options.key ? { countKeys: [options.key] } : { count: options.count ?? 1 }),
			...(options.target ? { target: activityTarget(options.target) } : {}),
		},
	];
}

function resultText(result: AgentToolResult<unknown> | undefined): string {
	if (!result) return "";
	const text = result.content
		.filter((item): item is { readonly type: "text"; readonly text: string } => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	if (text.length <= BASH_EVIDENCE_TEXT_LIMIT) return text;
	const half = Math.floor(BASH_EVIDENCE_TEXT_LIMIT / 2);
	return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

export function bashResultMovedToBackground(result: AgentToolResult<unknown> | undefined): boolean {
	for (const item of result?.content ?? []) {
		if (item.type !== "text") continue;
		const head = item.text.slice(0, BACKGROUND_MARKER_SCAN_LIMIT);
		if (BACKGROUND_MARKER.test(head)) return true;
		if (
			item.text.length > BACKGROUND_MARKER_SCAN_LIMIT &&
			BACKGROUND_MARKER.test(item.text.slice(-BACKGROUND_MARKER_SCAN_LIMIT))
		) {
			return true;
		}
	}
	return false;
}

function conservativeGitCommand(command: string): boolean {
	return !/(?:\|\||(?<!\|)\|(?!\|)|;|`|\$\()/u.test(command);
}

function gitOperand(command: string, operation: "merge" | "rebase"): string | undefined {
	if (!conservativeGitCommand(command)) return undefined;
	const tail = command.match(new RegExp(`(?:^|&&\\s*)git\\s+${operation}\\b([^;&|]*)`, "iu"))?.[1] ?? "";
	const tokens = tail.match(/[^\s]+/gu) ?? [];
	const operand = tokens
		.map((token) => token.replace(/^["']|["']$/gu, ""))
		.filter((token) => token && !token.startsWith("-"))
		.at(-1);
	if (!operand || !/^[\w./:@+~-]+$/u.test(operand)) return undefined;
	return oneLine(operand);
}

function hasPushEvidence(text: string): boolean {
	return /(?:^|\n)(?:To\s+\S+|Everything up-to-date\s*$|\s*[+*! =-]*\[[^\]]+\].*->|\s*[0-9a-f]+\.\.[0-9a-f]+\s+\S+\s+->)/imu.test(
		text,
	);
}

function hasMergeEvidence(text: string): boolean {
	return /(?:Already up[ -]to[ -]date|Fast-forward|Merge made by|Automatic merge went well)/iu.test(text);
}

function hasRebaseEvidence(text: string): boolean {
	return /(?:Successfully rebased|Current branch .* is up to date|Current branch .* is up-to-date)/iu.test(text);
}

/** Conservative Bash semantics shared by Host Bash and Background Work Bash. */
export function classifyBashActivity(
	input: ToolActivityClassifierInput<Record<string, unknown>, unknown>,
): readonly ToolActivityItem[] {
	const command = typeof input.args["command"] === "string" ? input.args["command"] : "";
	const description = typeof input.args["description"] === "string" ? oneLine(input.args["description"]) : "";
	const target = activityTarget(description || "Running command");
	const background = input.args["run_in_background"] === true || bashResultMovedToBackground(input.result);
	const outcomeEligible = input.state === "running" || input.state === "success";
	if (background && outcomeEligible) return singleActivity("launch-background", { target });
	if (!outcomeEligible) return singleActivity("run-command", { target });

	const running = input.state === "running";
	const dryRun = /(?:^|\s)--dry-run(?:\s|$)/u.test(command);
	const conservative = conservativeGitCommand(command);
	const commitCommand = !dryRun && conservative && /(?:^|&&\s*)git\s+commit\b/iu.test(command);
	const pushCommand = !dryRun && conservative && /(?:^|&&\s*)git\s+push\b/iu.test(command);
	const mergeBranch = !dryRun ? gitOperand(command, "merge") : undefined;
	const rebaseBranch = !dryRun ? gitOperand(command, "rebase") : undefined;
	const createPrCommand = !dryRun && conservative && /(?:^|&&\s*)gh\s+pr\s+create\b/iu.test(command);
	if (!commitCommand && !pushCommand && !mergeBranch && !rebaseBranch && !createPrCommand) {
		return singleActivity("run-command", { target });
	}
	const text = resultText(input.result);
	const outcomes: ToolActivityItem[] = [];
	if (commitCommand) {
		const sha = text.match(/\[[^\]\r\n]+\s([0-9a-f]{7,40})\]/iu)?.[1];
		if (running || sha) outcomes.push({ category: "commit", count: 1, ...(sha ? { detail: sha } : {}), target });
	}
	if (pushCommand) {
		const branchFromCommand = command.match(/\bgit\s+push(?:\s+\S+)?\s+([^\s;&|]+)/iu)?.[1];
		const branchFromResult = text.match(/\s->\s([^\s]+)\s*$/mu)?.[1];
		const branch = oneLine(branchFromResult ?? (running ? branchFromCommand : "") ?? "").replace(
			/^refs\/heads\//u,
			"",
		);
		if (running || hasPushEvidence(text)) {
			outcomes.push({
				category: "push",
				count: 1,
				...(branch && !branch.startsWith("-") ? { detail: branch } : {}),
				target,
			});
		}
	}
	if (mergeBranch && (running || hasMergeEvidence(text))) {
		outcomes.push({ category: "merge", count: 1, detail: mergeBranch, target });
	}
	if (rebaseBranch && (running || hasRebaseEvidence(text))) {
		outcomes.push({ category: "rebase", count: 1, detail: rebaseBranch, target });
	}
	if (createPrCommand) {
		const number = text.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/u)?.[1];
		if (running || number) {
			outcomes.push({ category: "create-pr", count: 1, ...(number ? { detail: `#${number}` } : {}), target });
		}
	}
	return outcomes.length > 0 ? outcomes : singleActivity("run-command", { target });
}

export interface PlannedToolActivityMember {
	readonly args: Readonly<Record<string, unknown>>;
	readonly id: string;
	readonly name: string;
	readonly result?: AgentToolResult<unknown>;
	/** Display-only terminal state when Pi persisted a call that never executed. */
	readonly terminalState?: "cancelled" | "error";
}

export interface PlannedToolActivityGroup {
	readonly closed: boolean;
	readonly leaderId: string;
	readonly members: readonly PlannedToolActivityMember[];
}

export interface ActivitySummaryMember {
	/** Stable semantic subject used by an issue-only group summary. */
	readonly issueLabel?: string;
	/** Bounded root-cause detail shown on the indented issue row. */
	readonly issueDetail?: string;
	readonly items: readonly ToolActivityItem[];
	/** Exact display-only identities that a later successful member may recover. */
	readonly recoveryKeys?: readonly string[];
	readonly state: ToolActivityState;
}

export type ToolActivityOutcome = "error" | "running" | "success" | "warning";

export function toolActivityOutcome(state: ToolActivityState): ToolActivityOutcome {
	return state === "rejected" || state === "cancelled" ? "warning" : state;
}

export interface ToolActivitySummary {
	readonly active: boolean;
	readonly issueState: "cancelled" | "error" | "rejected" | undefined;
	readonly issueText: string;
	readonly outcome: ToolActivityOutcome;
	readonly summary: string;
	readonly target: string;
}

interface PhraseSpec {
	readonly past: string;
	readonly present: string;
	readonly singular: string;
	readonly plural: string;
	readonly priority: number;
}

const PHRASES: Readonly<Record<ToolActivityCategory, PhraseSpec>> = {
	"complete-goal": { past: "Completed", present: "Completing", singular: "goal", plural: "goals", priority: 10 },
	"block-goal": {
		past: "Reported",
		present: "Reporting",
		singular: "goal blocker",
		plural: "goal blockers",
		priority: 11,
	},
	commit: { past: "Committed", present: "Committing", singular: "change", plural: "changes", priority: 12 },
	push: { past: "Pushed", present: "Pushing", singular: "branch", plural: "branches", priority: 13 },
	merge: { past: "Merged", present: "Merging", singular: "branch", plural: "branches", priority: 13 },
	rebase: { past: "Rebased", present: "Rebasing", singular: "branch", plural: "branches", priority: 13 },
	"create-pr": {
		past: "Created",
		present: "Creating",
		singular: "pull request",
		plural: "pull requests",
		priority: 14,
	},
	"record-result": { past: "Recorded", present: "Recording", singular: "result", plural: "results", priority: 15 },
	"generate-image": { past: "Generated", present: "Generating", singular: "image", plural: "images", priority: 16 },
	"change-file": { past: "Changed", present: "Changing", singular: "file", plural: "files", priority: 20 },
	"update-task": { past: "Updated", present: "Updating", singular: "task", plural: "tasks", priority: 21 },
	"update-memory": { past: "Updated", present: "Updating", singular: "memory", plural: "memories", priority: 22 },
	"save-memory": { past: "Saved", present: "Saving", singular: "memory", plural: "memories", priority: 23 },
	"save-note": { past: "Saved", present: "Saving", singular: "note", plural: "notes", priority: 24 },
	"update-note": { past: "Updated", present: "Updating", singular: "note", plural: "notes", priority: 25 },
	"run-agent": { past: "Ran", present: "Running", singular: "agent", plural: "agents", priority: 30 },
	"launch-agent": {
		past: "Launched",
		present: "Launching",
		singular: "background agent",
		plural: "background agents",
		priority: 31,
	},
	"check-agent": { past: "Checked", present: "Checking", singular: "agent", plural: "agents", priority: 32 },
	"message-agent": { past: "Messaged", present: "Messaging", singular: "agent", plural: "agents", priority: 32 },
	"resume-agent": { past: "Resumed", present: "Resuming", singular: "agent", plural: "agents", priority: 32 },
	"steer-agent": { past: "Steered", present: "Steering", singular: "agent", plural: "agents", priority: 32 },
	"stop-agent": { past: "Stopped", present: "Stopping", singular: "agent", plural: "agents", priority: 32 },
	"launch-background": {
		past: "Launched",
		present: "Launching",
		singular: "background task",
		plural: "background tasks",
		priority: 33,
	},
	"start-monitor": { past: "Started", present: "Starting", singular: "monitor", plural: "monitors", priority: 34 },
	"stop-background": {
		past: "Stopped",
		present: "Stopping",
		singular: "background task",
		plural: "background tasks",
		priority: 35,
	},
	"run-command": { past: "Ran", present: "Running", singular: "command", plural: "commands", priority: 40 },
	"invoke-mcp": { past: "Invoked", present: "Invoking", singular: "MCP tool", plural: "MCP tools", priority: 41 },
	"connect-mcp": {
		past: "Connected to",
		present: "Connecting to",
		singular: "MCP server",
		plural: "MCP servers",
		priority: 42,
	},
	"search-mcp": {
		past: "Searched",
		present: "Searching",
		singular: "MCP catalog",
		plural: "MCP catalogs",
		priority: 43,
	},
	"search-pattern": { past: "Searched", present: "Searching", singular: "pattern", plural: "patterns", priority: 50 },
	"search-tool": {
		past: "Searched",
		present: "Searching",
		singular: "Tool catalog",
		plural: "Tool catalogs",
		priority: 50,
	},
	"search-web": { past: "Searched", present: "Searching", singular: "web query", plural: "web queries", priority: 51 },
	"fetch-page": { past: "Fetched", present: "Fetching", singular: "page", plural: "pages", priority: 52 },
	"retrieve-passage": {
		past: "Retrieved",
		present: "Retrieving",
		singular: "passage",
		plural: "passages",
		priority: 53,
	},
	"read-file": { past: "Read", present: "Reading", singular: "file", plural: "files", priority: 54 },
	"list-directory": { past: "Listed", present: "Listing", singular: "directory", plural: "directories", priority: 55 },
	"view-image": { past: "Viewed", present: "Viewing", singular: "image", plural: "images", priority: 56 },
	"search-history": {
		past: "Searched",
		present: "Searching",
		singular: "history query",
		plural: "history queries",
		priority: 57,
	},
	"review-history-range": {
		past: "Reviewed",
		present: "Reviewing",
		singular: "history range",
		plural: "history ranges",
		priority: 58,
	},
	"check-task": { past: "Checked", present: "Checking", singular: "task", plural: "tasks", priority: 59 },
	"read-memory": { past: "Read", present: "Reading", singular: "memory", plural: "memories", priority: 60 },
	"read-note": { past: "Read", present: "Reading", singular: "note", plural: "notes", priority: 61 },
	"inspect-background": {
		past: "Inspected",
		present: "Inspecting",
		singular: "background task",
		plural: "background tasks",
		priority: 62,
	},
	"read-background": {
		past: "Read",
		present: "Reading",
		singular: "background output",
		plural: "background outputs",
		priority: 63,
	},
};

interface CategoryAccumulator {
	count: number;
	readonly details: Set<string>;
	readonly keys: Set<string>;
}

export interface ActivityCategoryAggregate {
	readonly category: ToolActivityCategory;
	readonly count: number;
	readonly details?: readonly string[];
}

export interface ToolActivityAggregate {
	readonly categories: readonly ActivityCategoryAggregate[];
	readonly firstIssueLabel?: string;
	readonly outcome: ToolActivityOutcome;
	readonly stateCounts: Readonly<Partial<Record<ToolActivityState, number>>>;
	readonly target?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolCall(value: unknown): Omit<PlannedToolActivityMember, "result"> | undefined {
	if (!isRecord(value) || value["type"] !== "toolCall") return undefined;
	const id = value["id"];
	const name = value["name"];
	const args = value["arguments"];
	if (typeof id !== "string" || !id || typeof name !== "string" || !name || !isRecord(args)) return undefined;
	return { args, id, name };
}

function toolResult(value: unknown): { readonly id: string; readonly result: AgentToolResult<unknown> } | undefined {
	if (!isRecord(value) || value["role"] !== "toolResult") return undefined;
	const id = value["toolCallId"];
	const content = value["content"];
	if (typeof id !== "string" || !id || !Array.isArray(content)) return undefined;
	return {
		id,
		result: {
			content: content as AgentToolResult<unknown>["content"],
			...(value["details"] !== undefined ? { details: value["details"] } : { details: undefined }),
			...(value["isError"] === true ? { isError: true } : {}),
		},
	};
}

function hasVisibleText(block: unknown): boolean {
	return (
		isRecord(block) &&
		block["type"] === "text" &&
		typeof block["text"] === "string" &&
		block["text"].trim().length > 0
	);
}

function isVisibleMessageBoundary(message: Record<string, unknown>): boolean {
	const role = message["role"];
	if (role === "custom") return message["display"] === true;
	return role === "user" || role === "bashExecution";
}

function assistantTerminalState(message: Record<string, unknown>): "cancelled" | "error" | undefined {
	return message["stopReason"] === "aborted" ? "cancelled" : message["stopReason"] === "error" ? "error" : undefined;
}

/**
 * Derive display-only Activity Groups from the current model-visible message order.
 * Tool results and Thinking are transparent; prose, user-visible context, and
 * unsupported Tool calls close the current group.
 */
export function planToolActivityGroups(
	messages: readonly unknown[],
	ownedToolNames: ReadonlySet<string>,
	closeTail: boolean,
): readonly PlannedToolActivityGroup[] {
	const results = new Map<string, AgentToolResult<unknown>>();
	for (const message of messages) {
		const parsed = toolResult(message);
		if (parsed) results.set(parsed.id, parsed.result);
	}

	const groups: PlannedToolActivityGroup[] = [];
	let members: PlannedToolActivityMember[] = [];
	const flush = (closed: boolean) => {
		const leader = members[0];
		if (leader) groups.push({ closed, leaderId: leader.id, members });
		members = [];
	};
	const append = (
		member: PlannedToolActivityMember,
		options: { readonly closeAfter?: boolean; readonly closeBefore?: boolean } = {},
	) => {
		if (options.closeBefore) flush(true);
		members.push(member);
		if (options.closeAfter) flush(true);
	};

	for (const candidate of messages) {
		if (!isRecord(candidate)) continue;
		if (isVisibleMessageBoundary(candidate)) {
			flush(true);
			continue;
		}
		if (candidate["role"] !== "assistant" || !Array.isArray(candidate["content"])) continue;
		const terminalState = assistantTerminalState(candidate);
		for (const block of candidate["content"]) {
			if (hasVisibleText(block)) {
				flush(true);
				continue;
			}
			const call = toolCall(block);
			if (!call) continue;
			if (!ownedToolNames.has(call.name)) {
				flush(true);
				continue;
			}
			const result = results.get(call.id);
			append(
				{ ...call, ...(result ? { result } : terminalState ? { terminalState } : {}) },
				call.name === "bash" ? { closeAfter: true, closeBefore: true } : {},
			);
		}
	}
	flush(closeTail);
	return groups;
}

function normalizedCount(item: ToolActivityItem): number {
	if (item.countKeys && item.countKeys.length > 0) return 0;
	const count = item.count ?? 1;
	return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function phrase(category: ToolActivityCategory, accumulator: CategoryAccumulator, active: boolean): string {
	const spec = PHRASES[category];
	const count = accumulator.keys.size + accumulator.count;
	const details = [...accumulator.details];
	if (!active && details.length > 0) {
		if (category === "commit") return `${spec.past} ${details.join(", ")}`;
		if (category === "push") return `${spec.past} to ${details.join(", ")}`;
		if (category === "merge" || category === "rebase") return `${spec.past} ${details.join(", ")}`;
		if (category === "create-pr") return `${spec.past} ${details.join(", ")}`;
	}
	const safeCount = Math.max(0, count);
	if (safeCount === 1 && (category === "complete-goal" || category === "block-goal")) {
		return `${active ? spec.present : spec.past} ${spec.singular}`;
	}
	return `${active ? spec.present : spec.past} ${String(safeCount)} ${safeCount === 1 ? spec.singular : spec.plural}`;
}

function issueSummaryFromCounts(
	counts: Readonly<Partial<Record<ToolActivityState, number>>>,
	firstIssueLabel = "",
): {
	readonly issueLabel: string;
	readonly issueState: "cancelled" | "error" | "rejected" | undefined;
	readonly text: string;
} {
	const failed = counts.error ?? 0;
	const rejected = counts.rejected ?? 0;
	const cancelled = counts.cancelled ?? 0;
	const parts = [
		...(failed > 0 ? [`${String(failed)} failed`] : []),
		...(rejected > 0 ? [`${String(rejected)} rejected`] : []),
		...(cancelled > 0 ? [`${String(cancelled)} cancelled`] : []),
	];
	return {
		issueLabel: oneLine(firstIssueLabel),
		issueState: failed > 0 ? "error" : rejected > 0 ? "rejected" : cancelled > 0 ? "cancelled" : undefined,
		text: parts.join(", "),
	};
}

function meaningfulActivity(items: readonly ToolActivityItem[]): boolean {
	return items.some(
		(item) =>
			(item.countKeys?.some((key) => oneLine(key).length > 0) ?? false) ||
			(Number.isFinite(item.count ?? 1) && Math.floor(item.count ?? 1) > 0),
	);
}

function recoveredByLaterSuccess(member: ActivitySummaryMember, laterSuccessKeys: ReadonlySet<string>): boolean {
	const keys = member.recoveryKeys ?? [];
	if (keys.some((key) => key.startsWith("retry\u0000") && laterSuccessKeys.has(key))) return true;
	const effects = keys.filter((key) => key.startsWith("effect\u0000"));
	return effects.length > 0 && effects.every((key) => laterSuccessKeys.has(key));
}

/** Resolve settled group color semantics without guessing whether two operations are equivalent. */
export function effectiveToolActivityOutcome(members: readonly ActivitySummaryMember[]): ToolActivityOutcome {
	if (members.some((member) => member.state === "running")) return "running";

	const laterSuccessKeys = new Set<string>();
	let meaningfulSuccess = false;
	let recoveredErrors = 0;
	let unresolvedErrors = 0;
	let warnings = 0;
	for (let index = members.length - 1; index >= 0; index -= 1) {
		const member = members[index];
		if (!member) continue;
		if (member.state === "success") {
			meaningfulSuccess ||= meaningfulActivity(member.items);
			for (const key of member.recoveryKeys ?? []) laterSuccessKeys.add(key);
			continue;
		}
		if (member.state === "error") {
			if (recoveredByLaterSuccess(member, laterSuccessKeys)) recoveredErrors += 1;
			else unresolvedErrors += 1;
			continue;
		}
		if (member.state === "rejected" || member.state === "cancelled") warnings += 1;
	}

	if (unresolvedErrors > 0) return meaningfulSuccess || recoveredErrors > 0 ? "warning" : "error";
	if (warnings > 0) return "warning";
	return "success";
}

/** Format a pre-aggregated Activity Group without rescanning every member. */
export function summarizeToolActivityAggregate(aggregate: ToolActivityAggregate, closed: boolean): ToolActivitySummary {
	const active = !closed || (aggregate.stateCounts.running ?? 0) > 0;
	const clauses = [...aggregate.categories]
		.sort((left, right) => PHRASES[left.category].priority - PHRASES[right.category].priority)
		.map((entry, index) => {
			const accumulator: CategoryAccumulator = {
				count: Math.max(0, entry.count),
				details: new Set(entry.details ?? []),
				keys: new Set(),
			};
			const value = phrase(entry.category, accumulator, active);
			return index === 0 ? value : `${value.slice(0, 1).toLocaleLowerCase()}${value.slice(1)}`;
		});
	const issues = issueSummaryFromCounts(aggregate.stateCounts, aggregate.firstIssueLabel);
	const base = clauses.join(", ");
	const issueOnly =
		issues.text === "1 failed"
			? `${issues.issueLabel || "Internal operation"} failed`
			: `${issues.issueLabel || "Internal operation"} · ${issues.text}`;
	const summary = issues.text ? (base ? `${base} · ${issues.text}` : issueOnly) : base;
	return {
		active,
		issueState: issues.issueState,
		issueText: issues.text,
		outcome: active ? "running" : aggregate.outcome,
		summary,
		target: active ? activityTarget(aggregate.target ?? "") : "",
	};
}

/** Build a deterministic Claude-style semantic clause for one Activity Group. */
export function summarizeToolActivityGroup(
	members: readonly ActivitySummaryMember[],
	closed: boolean,
): ToolActivitySummary {
	const categories = new Map<ToolActivityCategory, CategoryAccumulator>();
	let target = "";
	const stateCounts: Partial<Record<ToolActivityState, number>> = {};
	let firstIssueLabel = "";
	for (const member of members) {
		stateCounts[member.state] = (stateCounts[member.state] ?? 0) + 1;
		if (
			!firstIssueLabel &&
			(member.state === "error" || member.state === "rejected" || member.state === "cancelled")
		) {
			firstIssueLabel = member.issueLabel ?? "";
		}
		for (const item of member.items) {
			let accumulator = categories.get(item.category);
			if (!accumulator) {
				accumulator = { count: 0, details: new Set(), keys: new Set() };
				categories.set(item.category, accumulator);
			}
			for (const key of item.countKeys ?? []) {
				const safe = oneLine(key);
				if (safe) accumulator.keys.add(safe);
			}
			accumulator.count += normalizedCount(item);
			const detail = oneLine(item.detail ?? "");
			if (detail) accumulator.details.add(detail);
			const nextTarget = activityTarget(item.target ?? "");
			if (nextTarget) target = nextTarget;
		}
	}
	return summarizeToolActivityAggregate(
		{
			categories: [...categories.entries()].map(([category, accumulator]) => ({
				category,
				count: accumulator.keys.size + accumulator.count,
				details: [...accumulator.details],
			})),
			firstIssueLabel,
			outcome: effectiveToolActivityOutcome(members),
			stateCounts,
			target,
		},
		closed,
	);
}
