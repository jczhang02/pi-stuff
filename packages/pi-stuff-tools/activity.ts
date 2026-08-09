import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { ToolActivityState } from "./activity-store.js";
import { oneLine } from "./render.js";

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
	const safe = oneLine(value);
	const pathLike =
		/^(?:~?[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/u.test(safe) ||
		(!/^[a-z][a-z\d+.-]*:\/\//iu.test(safe) && /[\\/]/u.test(safe));
	if (!pathLike) return safe;
	const segments = safe.split(/[\\/]+/u).filter(Boolean);
	if (segments.length <= 2) return safe;
	return `…/${segments.slice(-2).join("/")}`;
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
	return result.content
		.filter((item): item is { readonly type: "text"; readonly text: string } => item.type === "text")
		.map((item) => item.text)
		.join("\n");
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
	const text = resultText(input.result);
	const target = activityTarget(description || "Running command");
	const background =
		input.args["run_in_background"] === true ||
		/\b(?:started|moved|manually moved) to background task\b/iu.test(text);
	const outcomeEligible = input.state === "running" || input.state === "success";
	if (background && outcomeEligible) return singleActivity("launch-background", { target });
	if (!outcomeEligible) return singleActivity("run-command", { target });

	const outcomes: ToolActivityItem[] = [];
	const running = input.state === "running";
	const dryRun = /(?:^|\s)--dry-run(?:\s|$)/u.test(command);
	const conservative = conservativeGitCommand(command);
	if (!dryRun && conservative && /(?:^|&&\s*)git\s+commit\b/iu.test(command)) {
		const sha = text.match(/\[[^\]\r\n]+\s([0-9a-f]{7,40})\]/iu)?.[1];
		if (running || sha) outcomes.push({ category: "commit", count: 1, ...(sha ? { detail: sha } : {}), target });
	}
	if (!dryRun && conservative && /(?:^|&&\s*)git\s+push\b/iu.test(command)) {
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
	const mergeBranch = !dryRun ? gitOperand(command, "merge") : undefined;
	if (mergeBranch && (running || hasMergeEvidence(text))) {
		outcomes.push({ category: "merge", count: 1, detail: mergeBranch, target });
	}
	const rebaseBranch = !dryRun ? gitOperand(command, "rebase") : undefined;
	if (rebaseBranch && (running || hasRebaseEvidence(text))) {
		outcomes.push({ category: "rebase", count: 1, detail: rebaseBranch, target });
	}
	if (!dryRun && conservative && /(?:^|&&\s*)gh\s+pr\s+create\b/iu.test(command)) {
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
	readonly state: ToolActivityState;
}

export interface ToolActivitySummary {
	readonly active: boolean;
	readonly issueState: "cancelled" | "error" | "rejected" | undefined;
	readonly issueText: string;
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
			members.push({ ...call, ...(result ? { result } : terminalState ? { terminalState } : {}) });
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
			stateCounts,
			target,
		},
		closed,
	);
}
