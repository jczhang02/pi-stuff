/** Generate a disposable, model-free Pi session for transcript UI capture. */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CERTIFIED_PI_VERSION } from "../../../scripts/pi-host-contract.js";

type FixtureState = "error" | "success";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

// SAFETY: the guard below accepts exactly the two FixtureState values before use.
const state = process.argv[2] as FixtureState | undefined;
const outputDirectoryArgument = process.argv[3];

if ((state !== "success" && state !== "error") || !outputDirectoryArgument) {
	throw new Error("Usage: bun transcript-content-fixture.ts <success|error> <output-directory>");
}

const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: state === "success" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",
});
const baseTimestamp = Date.UTC(2026, 7, 1, 4, 0, state === "success" ? 0 : 10);

session.appendMessage({
	role: "user",
	content: state === "success" ? "检查兼容性。" : "读取不存在的能力配置。",
	timestamp: baseTimestamp,
});

const toolCallId = state === "success" ? "fixture-success" : "fixture-error";
const path = state === "success" ? "docs/compatibility.md" : "packages/missing.json";

session.appendMessage({
	role: "assistant",
	content: [
		...(state === "error" ? [{ type: "text" as const, text: "我先检查配置文件。" }] : []),
		{
			type: "toolCall",
			id: toolCallId,
			name: "prototype_inspect",
			arguments: { path },
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "transcript-fixture",
	usage: ZERO_USAGE,
	stopReason: "toolUse",
	timestamp: baseTimestamp + 1_000,
});

session.appendMessage({
	role: "toolResult",
	toolCallId,
	toolName: "prototype_inspect",
	content: [
		{
			type: "text",
			text:
				state === "success"
					? `Pi standalone host: ${CERTIFIED_PI_VERSION}\nBun toolchain: 1.4.0\nTypeScript: 5.9.3`
					: "File not found: packages/missing.json",
		},
	],
	details:
		state === "success"
			? {
					summary: "3 项兼容性约束已确认",
					detailLines: [`Pi host       ${CERTIFIED_PI_VERSION}`, "Bun           1.4.0", "TypeScript    5.9.3"],
				}
			: {
					summary: "File not found",
					hint: "检查路径后重试；未执行后续操作。",
					detailLines: [],
				},
	isError: state === "error",
	timestamp: baseTimestamp + 2_000,
});

session.appendMessage({
	role: "assistant",
	content: [
		{
			type: "text",
			text:
				state === "success"
					? `已确认：Pi ${CERTIFIED_PI_VERSION}、Bun 1.4.0、TypeScript 5.9.3。`
					: "没有继续执行。请确认配置路径。",
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "transcript-fixture",
	usage: ZERO_USAGE,
	stopReason: "stop",
	timestamp: baseTimestamp + 3_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Session fixture was not persisted");
process.stdout.write(`${sessionFile}\n`);
