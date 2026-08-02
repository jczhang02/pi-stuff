/** Generate deterministic, model-free Pi sessions for Work Todo review. */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type WorkState = "blocked" | "running";
type WorkVariant = "checklist" | "ondemand" | "strip";

interface FixtureTask {
	activeForm: string;
	id: number;
	status: "completed" | "in_progress" | "needs_input" | "pending";
	subject: string;
}

const variantArgument = process.argv[2];
const stateArgument = process.argv[3];
const outputDirectoryArgument = process.argv[4];

if (!isWorkVariant(variantArgument) || !isWorkState(stateArgument) || !outputDirectoryArgument) {
	throw new Error(
		"Usage: bun work-todo-comparison-fixture.ts <checklist|strip|ondemand> <running|blocked> <output-directory>",
	);
}

const variant = variantArgument;
const state = stateArgument;
const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const SESSION_IDS: Record<`${WorkVariant}-${WorkState}`, string> = {
	"checklist-running": "66666666-6666-4666-8666-666666666661",
	"checklist-blocked": "66666666-6666-4666-8666-666666666662",
	"strip-running": "66666666-6666-4666-8666-666666666663",
	"strip-blocked": "66666666-6666-4666-8666-666666666664",
	"ondemand-running": "66666666-6666-4666-8666-666666666665",
	"ondemand-blocked": "66666666-6666-4666-8666-666666666666",
};

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const baseTasks: FixtureTask[] = [
	{
		id: 1,
		subject: "Inspect current Todo behavior",
		activeForm: "Inspecting current Todo behavior",
		status: "completed",
	},
	{
		id: 2,
		subject: "Build the native Pi Todo preview",
		activeForm: "Building the native Pi Todo preview",
		status: "in_progress",
	},
	{
		id: 3,
		subject: "Compare normal-screen density",
		activeForm: "Comparing normal-screen density",
		status: "pending",
	},
	{ id: 4, subject: "Check the narrow terminal", activeForm: "Checking the narrow terminal", status: "pending" },
	{
		id: 5,
		subject: "Confirm needs-input treatment",
		activeForm: "Confirming needs-input treatment",
		status: "pending",
	},
	{ id: 6, subject: "Review the full Work view", activeForm: "Reviewing the full Work view", status: "pending" },
	{ id: 7, subject: "Record the product decision", activeForm: "Recording the product decision", status: "pending" },
	{ id: 8, subject: "Run final verification", activeForm: "Running final verification", status: "pending" },
];

const tasks =
	state === "running"
		? baseTasks
		: baseTasks.map((task) =>
				task.id === 2
					? {
							...task,
							subject: "Choose how much space Todo should occupy",
							activeForm: "Waiting for your Todo UI choice",
							status: "needs_input" as const,
						}
					: task,
			);

const agents = [
	{
		name: "main",
		task: state === "blocked" ? "Waiting for the Todo UI choice" : "Compare Todo UI structures",
		state: state === "blocked" ? "waiting" : "active",
		status: state === "blocked" ? ("waiting" as const) : ("running" as const),
	},
	{
		name: "claude",
		task: "Verify Claude task-list behavior",
		state: "done · 18s",
		status: "completed" as const,
	},
	{
		name: "reviewer",
		task: "Check Todo and Agent spacing",
		state: "9s",
		status: "running" as const,
	},
];

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: SESSION_IDS[`${variant}-${state}`],
});
const variantOffset = { checklist: 0, strip: 20, ondemand: 40 }[variant];
const stateOffset = state === "running" ? 0 : 10;
const baseTimestamp = Date.UTC(2026, 7, 1, 11, 0, variantOffset + stateOffset);
const toolCallId = `${variant}-${state}-work-todo`;

session.appendMessage({
	role: "user",
	content: "先比较 Todo 的正常屏幕占位；不要进入快捷键和设置细节。",
	timestamp: baseTimestamp,
});

session.appendMessage({
	role: "assistant",
	content: [
		{ type: "text", text: "我先核验两个成熟参考，再把 Todo 和已确定的 Agent roster 放在同一屏里比较。" },
		{ type: "toolCall", id: toolCallId, name: "prototype_work_todo", arguments: { variant, state, tasks, agents } },
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "work-todo-fixture",
	usage: ZERO_USAGE,
	stopReason: "toolUse",
	timestamp: baseTimestamp + 1_000,
});

session.appendMessage({
	role: "toolResult",
	toolCallId,
	toolName: "prototype_work_todo",
	content: [{ type: "text", text: "Deterministic Work Todo fixture" }],
	details: { variant, state, tasks, agents },
	isError: false,
	timestamp: baseTimestamp + 2_000,
});

session.appendMessage({
	role: "assistant",
	content: [
		{
			type: "text",
			text:
				state === "blocked"
					? "当前工作在等你的选择；其他检查仍可继续。"
					: "两名 Agent 仍在后台检查；主对话现在可以继续使用。",
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "work-todo-fixture",
	usage: ZERO_USAGE,
	stopReason: "stop",
	timestamp: baseTimestamp + 3_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Session fixture was not persisted");
process.stdout.write(`${sessionFile}\n`);

function isWorkVariant(value: string | undefined): value is WorkVariant {
	return value === "checklist" || value === "strip" || value === "ondemand";
}

function isWorkState(value: string | undefined): value is WorkState {
	return value === "running" || value === "blocked";
}
