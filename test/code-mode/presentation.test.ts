import { expect, test } from "bun:test";
import type { AgentToolResult, ContextEvent } from "@earendil-works/pi-coding-agent";
import {
	captureCodeModeModelContent,
	decodeCodeModeMediaSegments,
	rehydrateCodeModeMessages,
	separateCodeModeMediaForUi,
} from "../../packages/pi-stuff-code-mode/presentation.js";
import type { PiStuffCodeModeDetails } from "../../packages/pi-stuff-code-mode/runtime.js";

type AgentMessage = ContextEvent["messages"][number];

const originalImage = {
	data: "original",
	mimeType: "image/webp",
	type: "image" as const,
};
const normalizedImage = {
	data: "normalized",
	mimeType: "image/png",
	type: "image" as const,
};

test("normalized nested media moves into persistent presentation details without changing model content", () => {
	const before = { text: "before", type: "text" as const };
	const after = { text: "after", type: "text" as const };
	const resizeHint = { text: "[Image: original 4000x3000, displayed at 2000x1500.]", type: "text" as const };
	const details: PiStuffCodeModeDetails = {
		kind: "pi-stuff-code-mode",
		operations: [
			{
				args: { path: "large.webp" },
				id: "nested-image",
				mediaPlacements: [{ afterContentIndex: 1, mediaIndex: 0 }],
				name: "view_image",
				result: { content: [before, after], details: {} },
				state: "success",
			},
		],
		status: "success",
	};
	captureCodeModeModelContent(details, [before, originalImage, after]);
	const normalized: AgentToolResult<PiStuffCodeModeDetails> = {
		content: [before, normalizedImage, resizeHint, after],
		details,
	};

	const uiResult = separateCodeModeMediaForUi(normalized);
	expect(uiResult).toBeDefined();
	expect(uiResult?.content).toEqual([before, after]);
	expect(uiResult?.details.modelContent).toEqual(normalized.content);
	expect(uiResult?.details.mediaContentIndexes).toEqual([[1, 2]]);
	expect(decodeCodeModeMediaSegments(uiResult?.details)).toEqual([[normalizedImage, resizeHint]]);

	const persisted = {
		content: uiResult?.content ?? [],
		details: uiResult?.details,
		isError: false,
		role: "toolResult" as const,
		timestamp: 1,
		toolCallId: "outer",
		toolName: "codemode",
	};
	const messages = rehydrateCodeModeMessages([persisted] as AgentMessage[]);
	expect(messages?.[0]).toMatchObject({ content: normalized.content });
	expect(persisted.content).toEqual([before, after]);
});

test("standalone Code Mode images remain Host-rendered while nested images stay in their original Tool rows", () => {
	const nestedImage = { ...originalImage, data: "nested" };
	const standaloneImage = { ...originalImage, data: "standalone" };
	const details: PiStuffCodeModeDetails = {
		kind: "pi-stuff-code-mode",
		operations: [
			{
				args: {},
				id: "nested-image",
				mediaPlacements: [{ afterContentIndex: 0, mediaIndex: 1 }],
				name: "view_image",
				result: { content: [], details: {} },
				state: "success",
			},
		],
		status: "success",
	};
	captureCodeModeModelContent(details, [standaloneImage, nestedImage]);
	const result = separateCodeModeMediaForUi({ content: [standaloneImage, nestedImage], details });

	expect(result?.content).toEqual([standaloneImage]);
	expect(decodeCodeModeMediaSegments(result?.details)).toEqual([[standaloneImage], [nestedImage]]);
});
