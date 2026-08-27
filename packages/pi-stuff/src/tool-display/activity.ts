import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isRuntimeString } from "../shared/runtime-type.js";
import {
	activityTarget,
	singleActivity,
	type ToolActivityCategory,
	type ToolActivityClassifierInput,
	type ToolActivityItem,
	type ToolArguments,
} from "./activity-model.js";
import { oneLine } from "./tool-text.js";

export {
	activityKey,
	activityTarget,
	singleActivity,
	type ToolActivityCategory,
	type ToolActivityClassifierInput,
	type ToolActivityItem,
	type ToolActivityMetadata,
	type ToolArguments,
} from "./activity-model.js";
export {
	type ActivityCategoryAggregate,
	type ActivitySummaryMember,
	effectiveToolActivityOutcome,
	summarizeRetrievalGroup,
	summarizeToolActivityAggregate,
	type ToolActivityAggregate,
	type ToolActivityOutcome,
	type ToolActivitySummary,
	toolActivityOutcome,
} from "./activity-summary-format.js";
export {
	classifyRetrievalGroupInvocation,
	type PlannedRetrievalGroup,
	type PlannedToolActivityMember,
	planRetrievalGroups,
	type RetrievalGroupClassifier,
	type RetrievalGroupDisposition,
} from "./retrieval-groups.js";

const BASH_EVIDENCE_TEXT_LIMIT = 64 * 1024;
// ponytail: Background Work emits its handoff marker at a result boundary;
// widen this head/tail window only if that protocol changes.
const BACKGROUND_MARKER_SCAN_LIMIT = 1024;
const BACKGROUND_MARKER = /\b(?:started|moved|manually moved) to background task\b/iu;

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

const BASH_RETRIEVAL_COMMANDS = new Map<string, ToolActivityCategory>([
	["cat", "read-file"],
	["head", "read-file"],
	["tail", "read-file"],
	["wc", "read-file"],
	["jq", "read-file"],
	["grep", "search-pattern"],
	["rg", "search-pattern"],
	["find", "search-pattern"],
	["ls", "list-directory"],
	["tree", "list-directory"],
	["du", "list-directory"],
]);
const BASH_RETRIEVAL_NEUTRAL_COMMANDS = new Set(["echo", "printf", "true", "false", ":"]);
const FIND_CONSEQUENTIAL_OPTIONS = /^(?:-delete|-exec(?:dir)?|-fprint0?|-fprintf|-fls|-ok(?:dir)?)$/u;

function splitBashRetrievalSegments(command: string): readonly string[] | undefined {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let trailingTerminator = false;
	const flush = () => {
		const segment = current.trim();
		if (!segment) return false;
		segments.push(segment);
		current = "";
		return true;
	};
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index] ?? "";
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\") {
			current += character;
			escaped = true;
			continue;
		}
		if (quote) {
			current += character;
			if (character === quote) quote = undefined;
			else if (character === "`" || (character === "$" && command[index + 1] === "(")) return undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			current += character;
			continue;
		}
		if (
			character === "`" ||
			(character === "$" && command[index + 1] === "(") ||
			character === "<" ||
			character === ">" ||
			character === "(" ||
			character === ")" ||
			character === "{" ||
			character === "}" ||
			character === "#"
		) {
			return undefined;
		}
		if (character === "&") {
			if (command[index + 1] !== "&" || !flush()) return undefined;
			index += 1;
			trailingTerminator = false;
			continue;
		}
		if (character === "|" || character === ";" || character === "\n") {
			const conditional = character === "|";
			if (conditional && command[index + 1] === "|") index += 1;
			if (!flush()) {
				if (character === "\n" && trailingTerminator) continue;
				return undefined;
			}
			trailingTerminator = !conditional;
			continue;
		}
		current += character;
		if (!/\s/u.test(character)) trailingTerminator = false;
	}
	if (escaped || quote) return undefined;
	if (!flush() && !trailingTerminator) return undefined;
	return segments;
}

function bashSegmentWords(segment: string): readonly string[] | undefined {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let started = false;
	const flush = () => {
		if (!started) return;
		words.push(current);
		current = "";
		started = false;
	};
	for (const character of segment) {
		if (escaped) {
			current += character;
			started = true;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			started = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			started = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			started = true;
			continue;
		}
		if (/\s/u.test(character)) flush();
		else {
			current += character;
			started = true;
		}
	}
	if (escaped || quote) return undefined;
	flush();
	return words;
}

/** Classify only clearly read-only shell retrieval; ambiguity stays standalone. */
export function classifyBashRetrievalActivity(args: ToolArguments): readonly ToolActivityItem[] {
	if (args["run_in_background"] === true) return [];
	const command = isRuntimeString(args["command"]) ? args["command"] : "";
	const segments = splitBashRetrievalSegments(command);
	if (!segments) return [];
	const categories = new Set<ToolActivityCategory>();
	for (const segment of segments) {
		const words = bashSegmentWords(segment);
		if (!words) return [];
		let commandIndex = 0;
		while (/^[A-Za-z_][A-Za-z\d_]*=/u.test(words[commandIndex] ?? "")) commandIndex += 1;
		const base = words[commandIndex];
		if (!base) return [];
		if (BASH_RETRIEVAL_NEUTRAL_COMMANDS.has(base)) continue;
		const category = BASH_RETRIEVAL_COMMANDS.get(base);
		if (!category) return [];
		if (base === "find" && words.slice(commandIndex + 1).some((word) => FIND_CONSEQUENTIAL_OPTIONS.test(word))) {
			return [];
		}
		categories.add(category);
	}
	if (categories.size === 0) return [];
	const description = isRuntimeString(args["description"]) ? oneLine(args["description"]) : "";
	const fallback = categories.has("search-pattern")
		? "Searching files"
		: categories.has("read-file")
			? "Reading files"
			: "Listing directories";
	const target = activityTarget(description || fallback);
	return [...categories].map((category) => ({ category, count: 1, target }));
}

/** Conservative Bash semantics shared by Host Bash and Background Work Bash. */
export function classifyBashActivity(
	input: ToolActivityClassifierInput<ToolArguments, unknown>,
): readonly ToolActivityItem[] {
	const command = isRuntimeString(input.args["command"]) ? input.args["command"] : "";
	const description = isRuntimeString(input.args["description"]) ? oneLine(input.args["description"]) : "";
	const target = activityTarget(description || "Running command");
	const background = input.args["run_in_background"] === true || bashResultMovedToBackground(input.result);
	const outcomeEligible = input.state === "running" || input.state === "success";
	if (background && outcomeEligible) return singleActivity("launch-background", { target });
	const retrieval = classifyBashRetrievalActivity(input.args);
	if (retrieval.length > 0) return retrieval;
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
		if (running || sha) {
			outcomes.push(
				sha ? { category: "commit", count: 1, detail: sha, target } : { category: "commit", count: 1, target },
			);
		}
	}
	if (pushCommand) {
		const branchFromCommand = command.match(/\bgit\s+push(?:\s+\S+)?\s+([^\s;&|]+)/iu)?.[1];
		const branchFromResult = text.match(/\s->\s([^\s]+)\s*$/mu)?.[1];
		const branch = oneLine(branchFromResult ?? (running ? branchFromCommand : "") ?? "").replace(
			/^refs\/heads\//u,
			"",
		);
		if (running || hasPushEvidence(text)) {
			const outcome: ToolActivityItem = {
				category: "push",
				count: 1,
				target,
			};
			outcomes.push(branch && !branch.startsWith("-") ? { ...outcome, detail: branch } : outcome);
		}
	}
	if (mergeBranch && (running || hasMergeEvidence(text))) {
		outcomes.push({
			category: "merge",
			count: 1,
			detail: mergeBranch,
			target,
		});
	}
	if (rebaseBranch && (running || hasRebaseEvidence(text))) {
		outcomes.push({
			category: "rebase",
			count: 1,
			detail: rebaseBranch,
			target,
		});
	}
	if (createPrCommand) {
		const number = text.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/u)?.[1];
		if (running || number) {
			outcomes.push(
				number
					? {
							category: "create-pr",
							count: 1,
							detail: `#${number}`,
							target,
						}
					: { category: "create-pr", count: 1, target },
			);
		}
	}
	return outcomes.length > 0 ? outcomes : singleActivity("run-command", { target });
}
