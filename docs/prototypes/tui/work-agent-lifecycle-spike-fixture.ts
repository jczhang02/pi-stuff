/**
 * PROTOTYPE — generate one deterministic, model-free Pi 0.83 lifecycle session.
 *
 * Question: can the native extension prove work-surface preemption, editor
 * ownership, selected-Agent stop, and mixed outcomes without a model or real
 * Agent transport? This file only writes a scratch capture fixture supplied by
 * the caller; it is not product persistence.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const outputDirectoryArgument = process.argv[2];
if (!outputDirectoryArgument) {
	throw new Error("Usage: bun work-agent-lifecycle-spike-fixture.ts <output-directory>");
}

const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: "88888888-8888-4888-8888-888888888881",
});
const baseTimestamp = Date.UTC(2026, 7, 1, 15, 0, 0);
const toolCallId = "work-agent-lifecycle-spike";

session.appendMessage({
	role: "user",
	content: "继续主任务，同时让我能查看和管理后台 Agent。",
	timestamp: baseTimestamp,
});

session.appendMessage({
	role: "assistant",
	content: [
		{ type: "text", text: "我会让后台检查继续，同时保留主对话的输入位置。" },
		{
			type: "toolCall",
			id: toolCallId,
			name: "prototype_work_agent_lifecycle",
			arguments: {},
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "work-agent-lifecycle-fixture",
	usage: ZERO_USAGE,
	stopReason: "toolUse",
	timestamp: baseTimestamp + 1_000,
});

session.appendMessage({
	role: "toolResult",
	toolCallId,
	toolName: "prototype_work_agent_lifecycle",
	content: [{ type: "text", text: "Deterministic Agent lifecycle fixture" }],
	details: { fixture: "agent-lifecycle" },
	isError: false,
	timestamp: baseTimestamp + 2_000,
});

session.appendMessage({
	role: "assistant",
	content: [{ type: "text", text: "主任务可继续输入；需用户处理时会在 editor 附近提示。" }],
	api: "anthropic-messages",
	provider: "fixture",
	model: "work-agent-lifecycle-fixture",
	usage: ZERO_USAGE,
	stopReason: "stop",
	timestamp: baseTimestamp + 3_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Lifecycle fixture session was not persisted");
process.stdout.write(`${sessionFile}\n`);
