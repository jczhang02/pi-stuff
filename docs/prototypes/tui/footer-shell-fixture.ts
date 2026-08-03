/**
 * ACCEPTANCE FIXTURE — generate a deterministic, offline Pi session for the
 * compact footer and Command Dialog lifecycle capture.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const outputDirectoryArgument = process.argv[2];
if (!outputDirectoryArgument) {
	throw new Error("Usage: bun footer-shell-fixture.ts <output-directory>");
}

const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: "77777777-7777-4777-8777-777777777772",
});
const timestamp = Date.UTC(2026, 7, 2, 16, 0, 0);

session.appendMessage({
	role: "user",
	content: "验证普通页脚、Command Dialog 与中文输入恢复。",
	timestamp,
});
session.appendMessage({
	role: "assistant",
	content: [{ type: "text", text: "页脚验收：主对话保持可读，临时界面关闭后回到同一份草稿。" }],
	api: "openai-completions",
	provider: "footer-fixture",
	model: "compact-footer-fixture",
	usage: {
		input: 40_000,
		output: 2_000,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 42_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: timestamp + 1_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Footer fixture session was not persisted");
process.stdout.write(`${sessionFile}\n`);
