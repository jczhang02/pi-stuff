/** PROTOTYPE ONLY — deterministic offline session for real Pi/TUI capture. */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const outputDirectoryArgument = process.argv[2];
if (!outputDirectoryArgument) throw new Error("Usage: bun statusline-fixture.ts <output-directory>");

const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: "58585858-5858-4858-8858-585858585858",
});
const timestamp = Date.UTC(2026, 7, 5, 8, 0, 0);

session.appendMessage({
	role: "user",
	content: "请按 pi-footer 的 icon 化样式完成 Statusline，并保持当前任务继续。",
	timestamp,
});
session.appendMessage({
	role: "assistant",
	content: [{ type: "text", text: "The deterministic Statusline fixture is ready for native PTY review." }],
	api: "openai-completions",
	provider: "statusline-fixture",
	model: "gpt-5.6-sol",
	usage: {
		input: 5_000,
		output: 1_200,
		cacheRead: 18_000,
		cacheWrite: 0,
		totalTokens: 24_200,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: timestamp + 1_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Statusline fixture session was not persisted");
process.stdout.write(`${sessionFile}\n`);
