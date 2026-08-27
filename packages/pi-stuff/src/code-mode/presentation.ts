import type { AgentToolResult, ContextEvent } from "@earendil-works/pi-coding-agent";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { sanitizeCodeModeContent } from "./image-content.js";

type ToolContent = AgentToolResult<unknown>["content"];
type ToolContentItem = ToolContent[number];
type AgentMessage = ContextEvent["messages"][number];

const RAW_MODEL_CONTENT = Symbol("pi-stuff-code-mode-raw-model-content");

export interface CodeModeModelContentOwner {
	readonly kind: "pi-stuff-code-mode";
}

interface CodeModeMediaProjectionDetails {
	readonly mediaContentIndexes: readonly (readonly number[])[];
	readonly modelContent: ToolContent;
}

export function isCodeModeModelContentOwner<Value>(value: Value): value is Value & CodeModeModelContentOwner {
	return isRuntimeObject(value) && value !== null && "kind" in value && value.kind === "pi-stuff-code-mode";
}

function isToolContentItem<Value>(value: Value): value is Value & ToolContentItem {
	if (!isRuntimeObject(value) || value === null || !("type" in value)) return false;
	if (value.type === "text") return "text" in value && isRuntimeString(value.text);
	return (
		value.type === "image" &&
		"data" in value &&
		isRuntimeString(value.data) &&
		"mimeType" in value &&
		isRuntimeString(value.mimeType)
	);
}

export function isCodeModeToolContent<Value>(value: Value): value is Value & ToolContent {
	return Array.isArray(value) && Array.from(value).every(isToolContentItem);
}

function isMediaContentIndexes<Value>(value: Value): value is Value & readonly (readonly number[])[] {
	return (
		Array.isArray(value) &&
		value.every(
			(indexes) =>
				Array.isArray(indexes) &&
				indexes.every((index) => isRuntimeNumber(index) && Number.isSafeInteger(index) && index >= 0),
		)
	);
}

/**
 * Retain the exact pre-normalization content by identity until Pi's
 * tool_execution_end event. The symbol is deliberately non-enumerable, so it
 * can never leak into session JSON.
 */
export function captureCodeModeModelContent(details: CodeModeModelContentOwner, content: ToolContent): void {
	Object.defineProperty(details, RAW_MODEL_CONTENT, {
		configurable: true,
		enumerable: false,
		value: content,
	});
}

function normalizedMediaContentIndexes(
	raw: ToolContent,
	normalized: ToolContent,
): readonly (readonly number[])[] | undefined {
	const segments: number[][] = [];
	let normalizedIndex = 0;
	for (let rawIndex = 0; rawIndex < raw.length; rawIndex += 1) {
		const rawItem = raw[rawIndex];
		if (!rawItem) continue;
		if (rawItem.type === "text") {
			// Pi retains original text block objects while normalizing image blocks.
			if (normalized[normalizedIndex] !== rawItem) return undefined;
			normalizedIndex += 1;
			continue;
		}

		if (normalized[normalizedIndex]?.type !== "image") return undefined;
		const segment = [normalizedIndex];
		normalizedIndex += 1;
		const nextRaw = raw[rawIndex + 1];
		if (!nextRaw) {
			while (normalizedIndex < normalized.length) {
				if (normalized[normalizedIndex]?.type !== "text") return undefined;
				segment.push(normalizedIndex);
				normalizedIndex += 1;
			}
		} else if (nextRaw.type === "image") {
			while (normalized[normalizedIndex]?.type !== "image") {
				if (normalized[normalizedIndex]?.type !== "text") return undefined;
				segment.push(normalizedIndex);
				normalizedIndex += 1;
			}
		} else {
			while (normalized[normalizedIndex] !== nextRaw) {
				if (normalized[normalizedIndex]?.type !== "text") return undefined;
				segment.push(normalizedIndex);
				normalizedIndex += 1;
			}
		}
		segments.push(segment);
	}
	return normalizedIndex === normalized.length ? segments : undefined;
}

/**
 * Move normalized nested media out of the outer Host result used by the TUI.
 * The full provider-facing content remains in details and is restored by the
 * context hook. This lets each original renderer own its image position and
 * prevents Pi from appending every nested image below the Code Mode envelope.
 */
export function separateCodeModeMediaForUi<Details>(
	result: AgentToolResult<Details>,
): AgentToolResult<Details & CodeModeMediaProjectionDetails> | undefined {
	const details = result.details;
	if (!isCodeModeModelContentOwner(details) || !("operations" in details) || !Array.isArray(details.operations)) {
		return undefined;
	}
	const referencedMedia = new Set<number>();
	for (const operation of details.operations) {
		if (
			!isRuntimeObject(operation) ||
			operation === null ||
			!("mediaPlacements" in operation) ||
			!Array.isArray(operation.mediaPlacements)
		) {
			continue;
		}
		for (const placement of operation.mediaPlacements) {
			if (
				isRuntimeObject(placement) &&
				placement !== null &&
				"mediaIndex" in placement &&
				isRuntimeNumber(placement.mediaIndex) &&
				Number.isSafeInteger(placement.mediaIndex) &&
				placement.mediaIndex >= 0
			) {
				referencedMedia.add(placement.mediaIndex);
			}
		}
	}
	if (referencedMedia.size === 0) return undefined;
	const raw = Object.getOwnPropertyDescriptor(details, RAW_MODEL_CONTENT)?.value;
	if (!isCodeModeToolContent(raw)) return undefined;
	const mediaContentIndexes = normalizedMediaContentIndexes(raw, result.content);
	if (!mediaContentIndexes) return undefined;
	if ([...referencedMedia].some((index) => !mediaContentIndexes[index])) return undefined;

	const nestedContentIndexes = new Set(
		[...referencedMedia].flatMap((mediaIndex) => [...(mediaContentIndexes[mediaIndex] ?? [])]),
	);
	return {
		...result,
		content: result.content.filter((_item, index) => !nestedContentIndexes.has(index)),
		details: {
			...details,
			mediaContentIndexes,
			modelContent: [...result.content],
		},
	};
}

/** Resolve normalized media plus Pi-generated image hints for nested renderers. */
export function decodeCodeModeMediaSegments<Value>(detailsValue: Value): readonly (readonly ToolContentItem[])[] {
	if (
		!isRuntimeObject(detailsValue) ||
		detailsValue === null ||
		!("modelContent" in detailsValue) ||
		!("mediaContentIndexes" in detailsValue)
	) {
		return [];
	}
	const modelContent = detailsValue.modelContent;
	const mediaContentIndexes = detailsValue.mediaContentIndexes;
	if (!isCodeModeToolContent(modelContent) || !isMediaContentIndexes(mediaContentIndexes)) return [];
	return mediaContentIndexes.map((indexes) =>
		indexes.flatMap((index) => {
			const item = modelContent[index];
			return item ? [item] : [];
		}),
	);
}

/** Restore normalized Tool results and quarantine invalid historical images only in provider context. */
export function rehydrateCodeModeMessages(messages: readonly AgentMessage[]): AgentMessage[] | undefined {
	let changed = false;
	const hydrated = messages.map((message) => {
		if (message.role !== "toolResult" || message.toolName !== "codemode") return message;
		const details = message.details;
		if (!isCodeModeModelContentOwner(details)) return message;
		const hasModelContent = "modelContent" in details && isCodeModeToolContent(details.modelContent);
		if (hasModelContent) {
			changed = true;
			return { ...message, content: details.modelContent };
		}
		const sanitized = sanitizeCodeModeContent(message.content);
		if (sanitized.rejected === 0) return message;
		changed = true;
		return { ...message, content: sanitized.content };
	});
	return changed ? hydrated : undefined;
}
