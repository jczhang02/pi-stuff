import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import {
	skillReadName,
	type ToolActivityCategory,
	type ToolActivityMetadata,
	type ToolArguments,
} from "./activity-model.js";
import { isToolArguments } from "./tool-value.js";

export interface PlannedToolActivityMember {
	readonly args: ToolArguments;
	readonly id: string;
	readonly name: string;
	readonly result?: AgentToolResult<unknown>;
	/** Display-only terminal state when Pi persisted a call that never executed. */
	readonly terminalState?: "cancelled" | "error";
}

export interface PlannedRetrievalGroup {
	readonly closed: boolean;
	readonly leaderId: string;
	readonly members: readonly PlannedToolActivityMember[];
	/** Standalone Tools remain visually independent while sharing detail reconstruction. */
	readonly standalone?: boolean;
}

export type RetrievalGroupDisposition = "boundary" | "retrieval" | "transparent";
export type RetrievalGroupClassifier = (name: string, args: ToolArguments) => RetrievalGroupDisposition;

const RETRIEVAL_ACTIVITY_CATEGORIES = new Set<ToolActivityCategory>(["read-file", "search-pattern", "list-directory"]);
const RETRIEVAL_ACTIVITY_TOOL_NAMES = new Set(["find", "grep", "ls", "read"]);
const TRANSPARENT_ACTIVITY_TOOL_NAMES = new Set(["ctx_reduce", "tool_search"]);

/** One invocation-level policy shared by streaming, replay, and envelope projection. */
export function classifyRetrievalGroupInvocation(
	name: string,
	args: ToolArguments,
	metadata: ToolActivityMetadata<ToolArguments, unknown> | undefined,
): RetrievalGroupDisposition {
	if (TRANSPARENT_ACTIVITY_TOOL_NAMES.has(name)) return "transparent";
	if (name === "read" && skillReadName("/", args)) return "boundary";
	if (!metadata || !RETRIEVAL_ACTIVITY_TOOL_NAMES.has(name)) return "boundary";
	return metadata.categories.length > 0 &&
		metadata.categories.every((category) => RETRIEVAL_ACTIVITY_CATEGORIES.has(category))
		? "retrieval"
		: "boundary";
}

export interface ToolTranscriptRecord {
	readonly arguments?: unknown;
	readonly content?: unknown;
	readonly details?: unknown;
	readonly display?: unknown;
	readonly id?: unknown;
	readonly isError?: unknown;
	readonly name?: unknown;
	readonly role?: unknown;
	readonly stopReason?: unknown;
	readonly text?: unknown;
	readonly toolCallId?: unknown;
	readonly type?: unknown;
}

function isRecord<Value>(value: Value): value is Value & ToolTranscriptRecord {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function toolCall<Value>(value: Value): Omit<PlannedToolActivityMember, "result"> | undefined {
	if (!isRecord(value) || !("type" in value) || value.type !== "toolCall") return undefined;
	const id = "id" in value ? value.id : undefined;
	const name = "name" in value ? value.name : undefined;
	const args = "arguments" in value ? value.arguments : undefined;
	if (!isRuntimeString(id) || !id || !isRuntimeString(name) || !name || !isToolArguments(args)) return undefined;
	return { args, id, name };
}

function toolResult<Value>(
	value: Value,
): { readonly id: string; readonly result: AgentToolResult<unknown> & { readonly isError?: true } } | undefined {
	if (!isRecord(value) || !("role" in value) || value.role !== "toolResult") return undefined;
	const id = "toolCallId" in value ? value.toolCallId : undefined;
	const content = "content" in value ? value.content : undefined;
	if (!isRuntimeString(id) || !id || !Array.isArray(content)) return undefined;
	const baseResult = {
		// SAFETY: Pi tool-result messages own this content array; the transcript planner preserves blocks without interpreting them.
		content: content as AgentToolResult<unknown>["content"],
		details: "details" in value ? value.details : undefined,
	};
	const result = "isError" in value && value.isError === true ? { ...baseResult, isError: true as const } : baseResult;
	return {
		id,
		result,
	};
}

function hasVisibleText<Value>(block: Value): boolean {
	return (
		isRecord(block) &&
		"type" in block &&
		block.type === "text" &&
		"text" in block &&
		isRuntimeString(block.text) &&
		block.text.trim().length > 0
	);
}

function hasVisibleThinking<Value>(block: Value): boolean {
	return (
		isRecord(block) &&
		"type" in block &&
		block.type === "thinking" &&
		"thinking" in block &&
		isRuntimeString(block.thinking) &&
		block.thinking.trim().length > 0
	);
}

function isVisibleMessageBoundary(message: ToolTranscriptRecord): boolean {
	const role = message.role;
	if (role === "custom") return message.display === true;
	return role === "user" || role === "bashExecution";
}

function assistantTerminalState(message: ToolTranscriptRecord): "cancelled" | "error" | undefined {
	const stopReason = message.stopReason;
	return stopReason === "aborted" ? "cancelled" : stopReason === "error" ? "error" : undefined;
}

/** Pi records a direct Tool cancellation as a later empty aborted assistant message. */
export function directBashCancelledByHostAbort(
	previous: ToolTranscriptRecord,
	current: ToolTranscriptRecord,
): Omit<PlannedToolActivityMember, "result"> | undefined {
	if (
		current.role !== "assistant" ||
		assistantTerminalState(current) !== "cancelled" ||
		!Array.isArray(current.content) ||
		current.content.length !== 0 ||
		previous.role !== "assistant" ||
		assistantTerminalState(previous) !== undefined ||
		!Array.isArray(previous.content)
	) {
		return undefined;
	}
	for (let index = previous.content.length - 1; index >= 0; index -= 1) {
		const call = toolCall(previous.content[index]);
		if (call) return call.name === "bash" ? call : undefined;
		if (hasVisibleText(previous.content[index]) || hasVisibleThinking(previous.content[index])) return undefined;
	}
	return undefined;
}

/**
 * Derive display-only Retrieval Groups from the current model-visible message order.
 * Tool results are transparent; visible Thinking runs, prose, user-visible context,
 * and unsupported Tool calls close the current group.
 */
export function planRetrievalGroups(
	messages: readonly unknown[],
	classifyInvocation: RetrievalGroupClassifier,
	closeTail: boolean,
): readonly PlannedRetrievalGroup[] {
	const results = new Map<string, AgentToolResult<unknown> & { readonly isError?: true }>();
	for (const message of messages) {
		const parsed = toolResult(message);
		if (parsed) results.set(parsed.id, parsed.result);
	}
	const hostCancelledBash = new Set<string>();
	for (let index = 1; index < messages.length; index += 1) {
		const previous = messages[index - 1];
		const current = messages[index];
		const call =
			isRecord(previous) && isRecord(current) ? directBashCancelledByHostAbort(previous, current) : undefined;
		if (call && !results.has(call.id)) hostCancelledBash.add(call.id);
	}

	const groups: PlannedRetrievalGroup[] = [];
	let members: PlannedToolActivityMember[] = [];
	const flush = (closed: boolean) => {
		const leader = members[0];
		if (leader) groups.push({ closed, leaderId: leader.id, members });
		members = [];
	};
	const append = (member: PlannedToolActivityMember) => {
		members.push(member);
	};
	const appendStandalone = (member: PlannedToolActivityMember) => {
		flush(true);
		groups.push({
			closed: true,
			leaderId: member.id,
			members: [member],
			standalone: true,
		});
	};
	const appendInfrastructureIssue = (member: PlannedToolActivityMember) => {
		flush(true);
		groups.push({ closed: true, leaderId: member.id, members: [member] });
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
			if (hasVisibleText(block) || hasVisibleThinking(block)) {
				flush(true);
				continue;
			}
			const call = toolCall(block);
			if (!call) continue;
			const result = results.get(call.id);
			const settledState = terminalState ?? (hostCancelledBash.has(call.id) ? "cancelled" : undefined);
			const member = {
				...call,
				...(result ? { result } : settledState ? { terminalState: settledState } : {}),
			};
			const disposition = classifyInvocation(call.name, call.args);
			if (disposition === "boundary") {
				appendStandalone(member);
				continue;
			}
			if (disposition === "transparent" && (result?.isError === true || terminalState !== undefined)) {
				appendInfrastructureIssue(member);
				continue;
			}
			append(member);
		}
	}
	flush(closeTail);
	return groups;
}
