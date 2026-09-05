import { createHash } from "node:crypto";
import type {
	BeforeProviderRequestEvent,
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { JsonInputObject, JsonInputValue } from "../../../../shared/json-value.ts";
import { estimateProviderPayloadTokens, type ProviderPayloadModel } from "../../../../shared/provider-payload.ts";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.ts";
import { SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV } from "./pi-args.ts";

const CHILD_INPUT_RESERVE_RATIO = 0.25;
const CHILD_CONTEXT_GUARD_RATIO = 0.1;
const CHILD_CONTEXT_MAX_BUDGET_RATIO = 0.65;
const CHILD_CONTEXT_FALLBACK_FIXED_RATIO = 0.25;
const CHILD_CONTEXT_MIN_GUARD_TOKENS = 4_096;
const OLD_TOOL_RESULT_BYTES = 1_536;
const RECENT_TOOL_RESULTS_BYTES = 8_192;
const TASK_PREFIX = /(?:^|\s)Task:\s*/gu;
const TASK_FINGERPRINT = /^[a-f0-9]{64}$/u;

export type ChildProviderRequestPhase = "launch" | "continuation";
export type { ProviderPayloadModel } from "../../../../shared/provider-payload.ts";

type ChildMessage = ContextEvent["messages"][number];

function jsonRecord<Value extends object>(value: Value): JsonInputObject {
	return Object.fromEntries(Object.entries(value));
}

interface CompletedToolBatch {
	readonly assistantIndex: number;
	readonly callIds: string[];
	readonly resultIndices: number[];
}

export interface ChildContextProjection {
	readonly messages: ChildMessage[];
	readonly changed: boolean;
	readonly estimatedTokensBefore: number;
	readonly estimatedTokensAfter: number;
	readonly targetTokens?: number;
}

export function childProviderInputCapacity(model: ProviderPayloadModel | undefined): number | undefined {
	const contextWindow = model?.contextWindow;
	const maxTokens = model?.maxTokens;
	if (
		!isRuntimeNumber(contextWindow) ||
		!Number.isFinite(contextWindow) ||
		contextWindow <= 0 ||
		!isRuntimeNumber(maxTokens) ||
		!Number.isFinite(maxTokens) ||
		maxTokens <= 0
	)
		return undefined;
	return Math.max(0, Math.floor(contextWindow - maxTokens - contextWindow * CHILD_INPUT_RESERVE_RATIO));
}

export function estimateChildPayloadTokens(serialized: string, model: ProviderPayloadModel | undefined): number {
	return estimateProviderPayloadTokens(serialized, model);
}

function serializedTokens<Value>(value: Value, model: ProviderPayloadModel | undefined): number {
	try {
		const serialized = JSON.stringify(value);
		if (serialized !== undefined) return estimateChildPayloadTokens(serialized, model);
	} catch {
		// An unmeasurable value must consume the complete budget.
	}
	return Number.POSITIVE_INFINITY;
}

function activeToolSurface(pi: ExtensionAPI): unknown[] | undefined {
	try {
		const active = new Set(pi.getActiveTools());
		return pi
			.getAllTools()
			.filter((tool) => active.has(tool.name))
			.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}));
	} catch {
		return undefined;
	}
}

function fixedSurfaceTokens(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "getSystemPrompt">,
	model: ProviderPayloadModel | undefined,
): number | undefined {
	let systemPrompt: string;
	try {
		systemPrompt = ctx.getSystemPrompt();
	} catch {
		return undefined;
	}
	const tools = activeToolSurface(pi);
	if (!tools) return undefined;
	const tokens = serializedTokens({ instructions: systemPrompt, tools }, model);
	return Number.isFinite(tokens) ? tokens : undefined;
}

function childMessageTargetTokens(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "getSystemPrompt">,
	model: ProviderPayloadModel | undefined,
): number | undefined {
	const capacity = childProviderInputCapacity(model);
	if (capacity === undefined) return undefined;
	const measuredFixed = fixedSurfaceTokens(pi, ctx, model);
	const fixedReserve = measuredFixed ?? Math.floor(capacity * CHILD_CONTEXT_FALLBACK_FIXED_RATIO);
	const guard = Math.max(CHILD_CONTEXT_MIN_GUARD_TOKENS, Math.floor(capacity * CHILD_CONTEXT_GUARD_RATIO));
	return Math.max(0, Math.min(Math.floor(capacity * CHILD_CONTEXT_MAX_BUDGET_RATIO), capacity - fixedReserve - guard));
}

function promptVisibleMessage(message: ChildMessage): JsonInputObject {
	const source = jsonRecord(message);
	const projected: JsonInputObject = {};
	projected["role"] = source["role"];
	for (const key of [
		"content",
		"toolCallId",
		"toolName",
		"isError",
		"command",
		"output",
		"cancelled",
		"truncated",
		"excludeFromContext",
		"customType",
		"summary",
		"fromId",
		"tokensBefore",
	] as const) {
		if (source[key] !== undefined) projected[key] = source[key];
	}
	return projected;
}

function estimateMessages(messages: readonly ChildMessage[], model: ProviderPayloadModel | undefined): number {
	return serializedTokens(messages.map(promptVisibleMessage), model);
}

function utf8Prefix(value: string, maxBytes: number): string {
	if (maxBytes <= 0) return "";
	let bytes = 0;
	let result = "";
	for (const codePoint of value) {
		const next = Buffer.byteLength(codePoint, "utf8");
		if (bytes + next > maxBytes) break;
		result += codePoint;
		bytes += next;
	}
	return result;
}

function utf8Suffix(value: string, maxBytes: number): string {
	if (maxBytes <= 0) return "";
	const codePoints = [...value];
	let bytes = 0;
	let start = codePoints.length;
	while (start > 0) {
		const next = Buffer.byteLength(codePoints[start - 1] ?? "", "utf8");
		if (bytes + next > maxBytes) break;
		bytes += next;
		start -= 1;
	}
	return codePoints.slice(start).join("");
}

function boundedHeadTail(value: string, maxBytes: number, marker: string): string {
	const originalBytes = Buffer.byteLength(value, "utf8");
	if (originalBytes <= maxBytes) return value;
	const markerBytes = Buffer.byteLength(marker, "utf8");
	if (markerBytes >= maxBytes) return utf8Prefix(marker, maxBytes);
	const available = maxBytes - markerBytes;
	const headBytes = Math.ceil(available * 0.6);
	return `${utf8Prefix(value, headBytes).trimEnd()}${marker}${utf8Suffix(value, available - headBytes).trimStart()}`;
}

function textFromContent(content: JsonInputValue | undefined): string {
	if (isRuntimeString(content)) return content;
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const part of content) {
		if (!part || !isRuntimeObject(part)) continue;
		const record = jsonRecord(part);
		if (record["type"] === "text" && isRuntimeString(record["text"])) {
			texts.push(record["text"]);
			continue;
		}
		let serializedBytes = 0;
		try {
			serializedBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
		} catch {
			// Keep the omission marker useful even for malformed non-text parts.
		}
		const type = isRuntimeString(record["type"]) ? record["type"] : "non-text";
		texts.push(
			`[${type} Tool content omitted from projected child history: ${serializedBytes.toLocaleString("en-US")} serialized bytes]`,
		);
	}
	return texts.join("\n");
}

function projectedToolResult(message: ChildMessage, maxBytes: number): ChildMessage {
	const source = jsonRecord(message);
	const fullText = textFromContent(source["content"]);
	let serializedContentBytes = Number.POSITIVE_INFINITY;
	try {
		serializedContentBytes = Buffer.byteLength(JSON.stringify(source["content"]), "utf8");
	} catch {
		// Unmeasurable Tool content must be projected rather than retained.
	}
	const originalBytes = Math.max(Buffer.byteLength(fullText, "utf8"), serializedContentBytes);
	if (originalBytes <= maxBytes) return message;
	const toolName = isRuntimeString(source["toolName"]) ? source["toolName"] : "tool";
	const header = `[Pi Stuff compacted this earlier ${toolName} result for child continuation safety: ${originalBytes.toLocaleString(
		"en-US",
	)} serialized UTF-8 bytes. The exact result remains in the child transcript. Do not rerun completed verification already represented by retained child history; rerun only if other exact omitted content is required.]\n`;
	const marker = "\n[...compacted for child continuation safety...]\n";
	const bodyBudget = Math.max(0, maxBytes - Buffer.byteLength(header, "utf8"));
	const text = `${header}${boundedHeadTail(fullText, bodyBudget, marker)}`;
	const projected = {
		...jsonRecord(message),
		content: [{ type: "text", text }],
	};
	// SAFETY: projected copies a Pi child message and replaces only its content with a valid text content block.
	return projected as ChildMessage;
}

function toolCallIds(message: ChildMessage): string[] {
	const source = jsonRecord(message);
	if (source["role"] !== "assistant" || !Array.isArray(source["content"])) return [];
	return source["content"].flatMap((part) => {
		if (!part || !isRuntimeObject(part)) return [];
		const block = jsonRecord(part);
		return block["type"] === "toolCall" && isRuntimeString(block["id"]) ? [block["id"]] : [];
	});
}

function latestCompletedToolBatch(messages: readonly ChildMessage[]): CompletedToolBatch | undefined {
	for (let assistantIndex = messages.length - 1; assistantIndex >= 0; assistantIndex -= 1) {
		const assistant = messages[assistantIndex];
		if (!assistant) continue;
		const callIds = toolCallIds(assistant);
		if (callIds.length === 0 || new Set(callIds).size !== callIds.length) continue;
		const resultById = new Map<string, number>();
		for (let index = assistantIndex + 1; index < messages.length; index += 1) {
			const message = messages[index];
			const record = message ? jsonRecord(message) : undefined;
			if (record?.["role"] === "assistant") break;
			if (record?.["role"] !== "toolResult" || !isRuntimeString(record["toolCallId"])) continue;
			if (!callIds.includes(record["toolCallId"]) || resultById.has(record["toolCallId"])) continue;
			resultById.set(record["toolCallId"], index);
		}
		if (callIds.every((id) => resultById.has(id))) {
			const resultIndices = callIds.flatMap((id) => {
				const index = resultById.get(id);
				return index === undefined ? [] : [index];
			});
			return {
				assistantIndex,
				callIds,
				resultIndices: resultIndices.sort((left, right) => left - right),
			};
		}
	}
	return undefined;
}

function messageText(message: ChildMessage): string {
	const content = jsonRecord(message)["content"];
	if (isRuntimeString(content)) return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (!part || !isRuntimeObject(part)) return [];
			const text = jsonRecord(part)["text"];
			return isRuntimeString(text) ? [text] : [];
		})
		.join("\n");
}

function fingerprint(value: string): string {
	return createHash("sha256").update(value.trim()).digest("hex");
}

function taskCandidates(text: string): string[] {
	const candidates: string[] = [];
	for (const match of text.matchAll(TASK_PREFIX)) {
		const start = (match.index ?? 0) + match[0].length;
		const candidate = text.slice(start).trim();
		if (candidate) candidates.push(candidate);
	}
	return candidates;
}

function delegatedTaskIndex(messages: readonly ChildMessage[]): number | undefined {
	const expected = process.env[SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV]?.trim();
	if (!expected || !TASK_FINGERPRINT.test(expected)) return undefined;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		const record = message ? jsonRecord(message) : undefined;
		if (!message || record?.["role"] !== "user") continue;
		if (taskCandidates(messageText(message)).some((candidate) => fingerprint(candidate) === expected)) {
			return index;
		}
	}
	return undefined;
}

export function childContextHasOwnContinuation(messages: readonly ChildMessage[]): boolean {
	const taskIndex = delegatedTaskIndex(messages);
	if (taskIndex === undefined) return false;
	return messages.slice(taskIndex + 1).some((message) => {
		const role = jsonRecord(message)["role"];
		return role === "assistant" || role === "toolResult";
	});
}

function latestUserIndex(messages: readonly ChildMessage[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message && jsonRecord(message)["role"] === "user") return index;
	}
	return undefined;
}

function latestSteeringIndex(messages: readonly ChildMessage[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		const record = message ? jsonRecord(message) : undefined;
		if (message && record?.["role"] === "user" && messageText(message).includes("<pi-stuff-steer request=")) {
			return index;
		}
	}
	return undefined;
}

function toolProtocolIsValid(messages: readonly ChildMessage[]): boolean {
	let expected: Set<string> | undefined;
	for (const message of messages) {
		const record = jsonRecord(message);
		if (expected) {
			if (
				record["role"] !== "toolResult" ||
				!isRuntimeString(record["toolCallId"]) ||
				!expected.delete(record["toolCallId"])
			) {
				return false;
			}
			if (expected.size === 0) expected = undefined;
			continue;
		}
		if (record["role"] === "toolResult") return false;
		const ids = toolCallIds(message);
		if (ids.length > 0) {
			if (new Set(ids).size !== ids.length) return false;
			expected = new Set(ids);
		}
	}
	return expected === undefined;
}

function emergencyProjection(messages: readonly ChildMessage[]): ChildMessage[] | undefined {
	const taskIndex = delegatedTaskIndex(messages);
	const latestUser = latestUserIndex(messages);
	const latestSteering = latestSteeringIndex(messages);
	const authorityIndices = new Set<number>();
	if (taskIndex === undefined) {
		// Never guess which inherited user message owns the child task. Retain all
		// authority and let the final gate fail honestly if it is irreducible.
		for (let index = 0; index < messages.length; index += 1) {
			const message = messages[index];
			if (message && jsonRecord(message)["role"] === "user") authorityIndices.add(index);
		}
	} else {
		authorityIndices.add(taskIndex);
	}
	if (latestUser !== undefined) authorityIndices.add(latestUser);
	if (latestSteering !== undefined) authorityIndices.add(latestSteering);

	const batch = latestCompletedToolBatch(messages);
	const beforeBatch: ChildMessage[] = [];
	const afterBatch: ChildMessage[] = [];
	for (const index of [...authorityIndices].sort((left, right) => left - right)) {
		const message = messages[index];
		if (!message) continue;
		if (batch && index >= batch.assistantIndex) afterBatch.push(message);
		else beforeBatch.push(message);
	}

	const retained: ChildMessage[] = [];
	const retainedIndices = new Set(authorityIndices);
	if (batch) {
		retainedIndices.add(batch.assistantIndex);
		for (const index of batch.resultIndices) retainedIndices.add(index);
	}
	const omitted = messages.length - retainedIndices.size;
	if (omitted > 0) {
		retained.push({
			role: "user",
			content: [
				{
					type: "text",
					text: `[Pi Stuff omitted ${omitted.toLocaleString("en-US")} older child-history messages because bounded Tool-result projection alone could not fit the continuation budget. Preserve the delegated task, latest steering, and completed-verification authority retained below. Do not rerun completed verification solely because older evidence was omitted.]`,
				},
			],
			timestamp: Date.now(),
		});
	}
	retained.push(...beforeBatch);
	if (batch) {
		const assistant = messages[batch.assistantIndex];
		if (!assistant) return undefined;
		retained.push(assistant);
		for (const index of batch.resultIndices) {
			const result = messages[index];
			if (!result) return undefined;
			retained.push(result);
		}
	}
	retained.push(...afterBatch);
	return toolProtocolIsValid(retained) ? retained : undefined;
}

function withProjectedToolResults(
	messages: readonly ChildMessage[],
	predicate: (_message: JsonInputObject, index: number) => boolean,
	maxBytes: number,
): ChildMessage[] {
	return messages.map((message, index) => {
		const record = jsonRecord(message);
		return record["role"] === "toolResult" && predicate(record, index)
			? projectedToolResult(message, maxBytes)
			: message;
	});
}

export function projectChildContinuationContext(
	messages: readonly ChildMessage[],
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "getSystemPrompt"> & { model?: ProviderPayloadModel | undefined },
): ChildContextProjection {
	const model = ctx.model;
	const targetTokens = childMessageTargetTokens(pi, ctx, model);
	const estimatedTokensBefore = estimateMessages(messages, model);
	if (targetTokens === undefined || estimatedTokensBefore <= targetTokens) {
		// SAFETY: Pi supplies a mutable message array; this function accepts it as readonly only to prevent local mutation.
		const unchangedMessages = messages as ChildMessage[];
		if (targetTokens === undefined) {
			return {
				messages: unchangedMessages,
				changed: false,
				estimatedTokensBefore,
				estimatedTokensAfter: estimatedTokensBefore,
			};
		}
		return {
			messages: unchangedMessages,
			changed: false,
			estimatedTokensBefore,
			estimatedTokensAfter: estimatedTokensBefore,
			targetTokens,
		};
	}

	const recentBatch = latestCompletedToolBatch(messages);
	const recentResultIndices = new Set(recentBatch?.resultIndices ?? []);
	let projected = withProjectedToolResults(
		messages,
		(_message, index) => !recentResultIndices.has(index),
		OLD_TOOL_RESULT_BYTES,
	);
	let estimatedTokensAfter = estimateMessages(projected, model);
	if (estimatedTokensAfter > targetTokens && recentResultIndices.size > 0) {
		const perResultBytes = Math.max(
			OLD_TOOL_RESULT_BYTES,
			Math.floor(RECENT_TOOL_RESULTS_BYTES / recentResultIndices.size),
		);
		projected = withProjectedToolResults(
			projected,
			(_message, index) => recentResultIndices.has(index),
			perResultBytes,
		);
		estimatedTokensAfter = estimateMessages(projected, model);
	}
	if (estimatedTokensAfter > targetTokens) {
		const emergency = emergencyProjection(projected);
		if (emergency) {
			projected = emergency;
			estimatedTokensAfter = estimateMessages(projected, model);
		}
	}

	return {
		messages: projected,
		changed: projected !== messages,
		estimatedTokensBefore,
		estimatedTokensAfter,
		targetTokens,
	};
}

export function validateChildProviderPayload(
	payload: BeforeProviderRequestEvent["payload"],
	model: ProviderPayloadModel | undefined,
	phase: ChildProviderRequestPhase = "launch",
): { ok: true } | { ok: false; message: string } {
	const capacity = childProviderInputCapacity(model);
	if (capacity === undefined) return { ok: true };
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(payload);
	} catch {
		// A provider request that cannot be measured must not bypass the final gate.
	}
	const subject = phase === "continuation" ? "Agent continuation" : "Agent launch";
	if (serialized === undefined) {
		return {
			ok: false,
			message: `${subject} stopped before the provider request because the final child payload could not be measured safely.`,
		};
	}
	const estimatedTokens = estimateChildPayloadTokens(serialized, model);
	if (estimatedTokens <= capacity) return { ok: true };
	const bytes = Buffer.byteLength(serialized, "utf8");
	const recovery =
		phase === "continuation"
			? "The bounded child-history projection could not make this continuation fit. Reduce retained authority text or Tool schemas, or choose a model with a larger context window."
			: "Reduce the delegated context, Tools, or child extensions, or choose a model with a larger context window.";
	return {
		ok: false,
		message: `${subject} stopped before the provider request: the final child payload is estimated at ${estimatedTokens.toLocaleString(
			"en-US",
		)} input tokens (${bytes.toLocaleString("en-US")} UTF-8 bytes), above the safe ${capacity.toLocaleString(
			"en-US",
		)}-token input bound for this model. ${recovery}`,
	};
}
