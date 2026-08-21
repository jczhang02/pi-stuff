import type { AgentToolResult, ContextEvent } from "@earendil-works/pi-coding-agent";
import { isRuntimeObject } from "../shared/runtime-type.js";
import type { PiStuffCodeModeDetails } from "./runtime.js";

type ToolContent = AgentToolResult<unknown>["content"];
type ToolContentItem = ToolContent[number];
type AgentMessage = ContextEvent["messages"][number];

const RAW_MODEL_CONTENT = Symbol("pi-stuff-code-mode-raw-model-content");

type DetailsWithRawContent = PiStuffCodeModeDetails & {
	[RAW_MODEL_CONTENT]?: ToolContent;
};

function codeModeDetails(value: unknown): PiStuffCodeModeDetails | undefined {
	if (!isRuntimeObject(value) || value === null) return undefined;
	if (!("kind" in value) || value.kind !== "pi-stuff-code-mode") return undefined;
	if (!("operations" in value) || !Array.isArray(value.operations)) return undefined;
	return value as PiStuffCodeModeDetails;
}

/**
 * Retain the exact pre-normalization content by identity until Pi's
 * tool_execution_end event. The symbol is deliberately non-enumerable, so it
 * can never leak into session JSON.
 */
export function captureCodeModeModelContent(details: PiStuffCodeModeDetails, content: ToolContent): void {
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
export function separateCodeModeMediaForUi(
	result: AgentToolResult<PiStuffCodeModeDetails>,
): AgentToolResult<PiStuffCodeModeDetails> | undefined {
	const details = codeModeDetails(result.details);
	if (!details) return undefined;
	const referencedMedia = new Set(
		details.operations.flatMap((operation) =>
			(operation.mediaPlacements ?? []).map((placement) => placement.mediaIndex),
		),
	);
	if (referencedMedia.size === 0) return undefined;
	const raw = (details as DetailsWithRawContent)[RAW_MODEL_CONTENT];
	if (!raw) return undefined;
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
export function decodeCodeModeMediaSegments(detailsValue: unknown): readonly (readonly ToolContentItem[])[] {
	const details = codeModeDetails(detailsValue);
	if (!details?.modelContent || !details.mediaContentIndexes) return [];
	return details.mediaContentIndexes.map((indexes) =>
		indexes.flatMap((index) => {
			const item = details.modelContent?.[index];
			return item ? [item] : [];
		}),
	);
}

/** Restore the exact normalized Tool result only in the provider context. */
export function rehydrateCodeModeMessages(messages: readonly AgentMessage[]): AgentMessage[] | undefined {
	let changed = false;
	const hydrated = messages.map((message) => {
		if (message.role !== "toolResult" || message.toolName !== "codemode") return message;
		const details = codeModeDetails(message.details);
		if (!details?.modelContent) return message;
		changed = true;
		return { ...message, content: [...details.modelContent] };
	});
	return changed ? hydrated : undefined;
}
