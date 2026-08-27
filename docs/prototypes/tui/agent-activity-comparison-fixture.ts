/** Generate deterministic, model-free Pi sessions for Agent activity UI review. */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type ActivityState = "completed" | "running";
type ActivityVariant = "claude" | "hybrid" | "tintin";

interface FixtureAgent {
	action: string;
	elapsed: string;
	id: string;
	maxTurns: number;
	result: string;
	status: "completed" | "queued" | "running";
	task: string;
	tokens: string;
	toolUses: number;
	turns: number;
	type: string;
}

interface FixtureDetails {
	agents: FixtureAgent[];
	state: ActivityState;
	variant: ActivityVariant;
}

const SESSION_IDS = {
	"claude-running": "44444444-4444-4444-8444-444444444441",
	"claude-completed": "44444444-4444-4444-8444-444444444442",
	"tintin-running": "44444444-4444-4444-8444-444444444443",
	"tintin-completed": "44444444-4444-4444-8444-444444444444",
	"hybrid-running": "44444444-4444-4444-8444-444444444445",
	"hybrid-completed": "44444444-4444-4444-8444-444444444446",
} satisfies Record<`${ActivityVariant}-${ActivityState}`, string>;

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

function isActivityVariant(value: string | undefined): value is ActivityVariant {
	return value === "claude" || value === "tintin" || value === "hybrid";
}

function isActivityState(value: string | undefined): value is ActivityState {
	return value === "running" || value === "completed";
}

const variantArgument = process.argv[2];
const stateArgument = process.argv[3];
const outputDirectoryArgument = process.argv[4];

if (!isActivityVariant(variantArgument) || !isActivityState(stateArgument) || !outputDirectoryArgument) {
	throw new Error(
		"Usage: bun agent-activity-comparison-fixture.ts <claude|tintin|hybrid> <running|completed> <output-directory>",
	);
}

const variant = variantArgument;
const state = stateArgument;
const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const runningAgents: FixtureAgent[] = [
	{
		id: "claude-ui",
		type: "Explore",
		task: "Claude Code activity UI",
		status: "running",
		action: "Search AgentTool UI · 6 matches",
		turns: 4,
		maxTurns: 30,
		toolUses: 4,
		tokens: "12.4k",
		elapsed: "12s",
		result: "Parallel siblings share one transcript record.",
	},
	{
		id: "tintin-ui",
		type: "Explore",
		task: "tintinweb activity UI",
		status: "running",
		action: "Read agent-widget.ts · 560 lines",
		turns: 3,
		maxTurns: 30,
		toolUses: 3,
		tokens: "8.2k",
		elapsed: "8s",
		result: "Live background state stays above the editor.",
	},
	{
		id: "pi-constraints",
		type: "Reviewer",
		task: "Pi Stuff UI constraints",
		status: "queued",
		action: "Waiting for a worker slot…",
		turns: 0,
		maxTurns: 20,
		toolUses: 0,
		tokens: "0",
		elapsed: "queued",
		result: "Full detail uses an in-flow Command Dialog.",
	},
];

const foregroundRunningAgents: FixtureAgent[] = runningAgents.map((agent, index) =>
	index === 2
		? {
				...agent,
				status: "running",
				action: "Review no-overlay interaction rules",
				turns: 2,
				toolUses: 2,
				tokens: "5.1k",
				elapsed: "6s",
			}
		: agent,
);

const completedAgents: FixtureAgent[] = runningAgents.map((agent, index) => ({
	...agent,
	status: "completed",
	action: "Done",
	turns: [6, 5, 3][index] ?? agent.turns,
	toolUses: [5, 4, 3][index] ?? agent.toolUses,
	tokens: ["18.4k", "11.2k", "7.1k"][index] ?? agent.tokens,
	elapsed: ["18.2s", "15.4s", "9.8s"][index] ?? agent.elapsed,
}));

const fixtureAgents =
	state === "completed" ? completedAgents : variant === "claude" ? foregroundRunningAgents : runningAgents;
const details: FixtureDetails = {
	variant,
	state,
	agents: fixtureAgents,
};

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: SESSION_IDS[`${variant}-${state}`],
});
const variantOffset = { claude: 0, tintin: 20, hybrid: 40 }[variant];
const stateOffset = state === "running" ? 0 : 10;
const baseTimestamp = Date.UTC(2026, 7, 1, 8, 0, variantOffset + stateOffset);
const toolCallId = `${variant}-${state}-activity`;

session.appendMessage({
	role: "user",
	content: "并行检查 Claude Code、tintinweb 与 Pi 的 Agent UI。",
	timestamp: baseTimestamp,
});

session.appendMessage({
	role: "assistant",
	content: [
		{
			type: "text",
			text: "我会让三个 Agent 分别查看两套参考和 Pi 的实现约束。",
		},
		{
			type: "toolCall",
			id: toolCallId,
			name: "prototype_agent_activity",
			arguments: { variant, state, agents: fixtureAgents },
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "agent-activity-fixture",
	usage: ZERO_USAGE,
	stopReason: "toolUse",
	timestamp: baseTimestamp + 1_000,
});

if (variant !== "claude" || state !== "running") {
	session.appendMessage({
		role: "toolResult",
		toolCallId,
		toolName: "prototype_agent_activity",
		content: [
			{
				type: "text",
				text: state === "running" ? "Three fixture agents are active." : "Three fixture agents completed.",
			},
		],
		details,
		isError: false,
		timestamp: baseTimestamp + 2_000,
	});
}

if (state === "running") {
	if (variant !== "claude") {
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "它们会继续工作；主对话现在仍然可以使用。" }],
			api: "anthropic-messages",
			provider: "fixture",
			model: "agent-activity-fixture",
			usage: ZERO_USAGE,
			stopReason: "stop",
			timestamp: baseTimestamp + 3_000,
		});
	}
} else {
	session.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "三份结果已经回到主对话，可以继续做 UI 取舍。" }],
		api: "anthropic-messages",
		provider: "fixture",
		model: "agent-activity-fixture",
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: baseTimestamp + 3_000,
	});
}

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Session fixture was not persisted");
process.stdout.write(`${sessionFile}\n`);
