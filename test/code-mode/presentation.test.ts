import { expect, test } from "bun:test";
import type { AgentToolResult, ContextEvent } from "@earendil-works/pi-coding-agent";
import { INVALID_CODE_MODE_IMAGE_MESSAGE } from "../../packages/pi-stuff/src/code-mode/image-content.js";
import {
	captureCodeModeModelContent,
	decodeCodeModeMediaSegments,
	rehydrateCodeModeMessages,
	separateCodeModeMediaForUi,
} from "../../packages/pi-stuff/src/code-mode/presentation.js";
import type { PiStuffCodeModeDetails } from "../../packages/pi-stuff/src/code-mode/runtime.js";

type AgentMessage = ContextEvent["messages"][number];

const originalImage = {
	data: "original",
	mimeType: "image/webp",
	type: "image" as const,
};
const normalizedImage = {
	data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
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
	// SAFETY: this test controls the value and supplies every AgentMessage member exercised by this case.
	const messages = rehydrateCodeModeMessages([persisted] as AgentMessage[]);
	expect(messages?.[0]).toMatchObject({ content: normalized.content });
	expect(persisted.content).toEqual([before, after]);
});

test("historical malformed Code Mode images are replaced only in provider context", () => {
	const badImage = {
		data: `${Buffer.alloc(384, 1).toString("base64")}\n[Output truncated]\n<system-reminder>retry</system-reminder>`,
		mimeType: "image/jpeg",
		type: "image" as const,
	};
	const direct = {
		content: [badImage],
		details: { kind: "pi-stuff-code-mode", operations: [], status: "success" },
		isError: false,
		role: "toolResult" as const,
		timestamp: 1,
		toolCallId: "direct-bad-image",
		toolName: "codemode",
	};
	const projected = rehydrateCodeModeMessages([direct] as AgentMessage[]);

	expect(projected?.[0]).toMatchObject({
		content: [{ type: "text", text: INVALID_CODE_MODE_IMAGE_MESSAGE }],
	});
	expect(direct.content).toEqual([badImage]);
});

test("historical malformed normalized media is quarantined during rehydration", () => {
	const badImage = { type: "image" as const, data: Buffer.alloc(96, 1).toString("base64"), mimeType: "image/jpeg" };
	const persisted = {
		content: [],
		details: {
			kind: "pi-stuff-code-mode",
			modelContent: [badImage],
			operations: [],
			status: "success",
		},
		isError: false,
		role: "toolResult" as const,
		timestamp: 1,
		toolCallId: "normalized-bad-image",
		toolName: "codemode",
	};
	const projected = rehydrateCodeModeMessages([persisted] as AgentMessage[]);

	expect(projected?.[0]).toMatchObject({
		content: [{ type: "text", text: INVALID_CODE_MODE_IMAGE_MESSAGE }],
	});
	expect(persisted.details.modelContent).toEqual([badImage]);
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

test("malformed Host details are ignored at the media projection boundary", () => {
	expect(separateCodeModeMediaForUi({ content: [], details: null })).toBeUndefined();
	expect(
		separateCodeModeMediaForUi({
			content: [],
			details: { kind: "pi-stuff-code-mode", operations: [null] },
		}),
	).toBeUndefined();
});
