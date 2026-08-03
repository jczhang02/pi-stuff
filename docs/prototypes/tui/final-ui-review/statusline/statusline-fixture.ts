/**
 * PROTOTYPE FIXTURE — create deterministic, offline sessions for the final
 * Statusline visual review. Delete this directory after the decision is folded
 * into production code.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const outputDirectoryArgument = process.argv[2];
const fixtureKind = process.argv[3] ?? "short";

if (!outputDirectoryArgument || !["short", "overflow"].includes(fixtureKind)) {
	throw new Error("Usage: bun statusline-fixture.ts <output-directory> <short|overflow>");
}

const prompts = {
	short: "Implement the accepted Pi Stuff statusline and keep the current task moving.",
	overflow:
		"请按照已经确认的 Claude Code 风格完成状态栏，并验证狭窄终端、中文宽字符、较长提示以及临时界面关闭后的恢复行为；所有字段都应遵循 Pi 主题，不能使用浮动窗口，也不能因为内容溢出而破坏输入区域。",
} as const;

const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: fixtureKind === "short" ? "48484848-4848-4848-8848-484848484841" : "48484848-4848-4848-8848-484848484842",
});
const timestamp = Date.UTC(2026, 7, 3, 8, 0, 0);

session.appendMessage({
	role: "user",
	content: prompts[fixtureKind as keyof typeof prompts],
	timestamp,
});
session.appendMessage({
	role: "assistant",
	content: [{ type: "text", text: "The deterministic Statusline fixture is ready for native PTY review." }],
	api: "openai-completions",
	provider: "statusline-fixture",
	model: "sonnet-4.5-metered",
	usage: {
		input: 64_000,
		output: 2_000,
		cacheRead: 18_000,
		cacheWrite: 0,
		totalTokens: 84_000,
		cost: { input: 0.3, output: 0.12, cacheRead: 0, cacheWrite: 0, total: 0.42 },
	},
	stopReason: "stop",
	timestamp: timestamp + 1_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Statusline fixture session was not persisted");
process.stdout.write(`${sessionFile}\n`);
