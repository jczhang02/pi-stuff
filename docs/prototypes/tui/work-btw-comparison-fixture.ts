/** Generate deterministic, model-free Pi sessions for the throwaway BTW comparison. */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type BtwVariant = "claude" | "ephemeral" | "mailbox";

const variantArgument = process.argv[2];
const outputDirectoryArgument = process.argv[3];

if (!isBtwVariant(variantArgument) || !outputDirectoryArgument) {
	throw new Error("Usage: bun work-btw-comparison-fixture.ts <claude|ephemeral|mailbox> <output-directory>");
}

const variant = variantArgument;
const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const SESSION_IDS: Record<BtwVariant, string> = {
	claude: "77777777-7777-4777-8777-777777777771",
	ephemeral: "77777777-7777-4777-8777-777777777772",
	mailbox: "77777777-7777-4777-8777-777777777773",
};

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: SESSION_IDS[variant],
});
const baseTimestamp = Date.UTC(2026, 7, 1, 14, 0, 0);
const toolCallId = `${variant}-work-btw`;

session.appendMessage({
	role: "user",
	content: "继续实现 package boundary，并完成 native capture。",
	timestamp: baseTimestamp,
});

session.appendMessage({
	role: "assistant",
	content: [
		{ type: "text", text: "我会保持主线连续：先实现布局，再验证固定工具链。" },
		{
			type: "toolCall",
			id: toolCallId,
			name: "prototype_work_btw",
			arguments: { variant },
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "work-btw-fixture",
	usage: ZERO_USAGE,
	stopReason: "toolUse",
	timestamp: baseTimestamp + 1_000,
});

session.appendMessage({
	role: "toolResult",
	toolCallId,
	toolName: "prototype_work_btw",
	content: [{ type: "text", text: "Deterministic main-task fixture" }],
	details: { variant },
	isError: false,
	timestamp: baseTimestamp + 2_000,
});

session.appendMessage({
	role: "assistant",
	content: [{ type: "text", text: "主线仍在执行；输入框中的草稿不会被临时界面改写。" }],
	api: "anthropic-messages",
	provider: "fixture",
	model: "work-btw-fixture",
	usage: ZERO_USAGE,
	stopReason: "stop",
	timestamp: baseTimestamp + 3_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Session fixture was not persisted");
process.stdout.write(`${sessionFile}\n`);

function isBtwVariant(value: string | undefined): value is BtwVariant {
	return value === "claude" || value === "ephemeral" || value === "mailbox";
}
