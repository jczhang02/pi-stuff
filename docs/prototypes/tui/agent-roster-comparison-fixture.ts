/** Generate deterministic, model-free Pi sessions for Agent roster review. */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type RosterState = "completed" | "running";
type RosterVariant = "grouped" | "rail" | "vertical";

interface FixtureAgent {
	action: string;
	elapsed: string;
	group: string;
	id: string;
	name: string;
	result: string;
	status: "completed" | "queued" | "running";
	task: string;
	tokens: string;
	toolUses: number;
}

const SESSION_IDS: Record<`${RosterVariant}-${RosterState}`, string> = {
	"vertical-running": "55555555-5555-4555-8555-555555555551",
	"vertical-completed": "55555555-5555-4555-8555-555555555552",
	"grouped-running": "55555555-5555-4555-8555-555555555553",
	"grouped-completed": "55555555-5555-4555-8555-555555555554",
	"rail-running": "55555555-5555-4555-8555-555555555555",
	"rail-completed": "55555555-5555-4555-8555-555555555556",
};

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

function isRosterVariant(value: string | undefined): value is RosterVariant {
	return value === "vertical" || value === "grouped" || value === "rail";
}

function isRosterState(value: string | undefined): value is RosterState {
	return value === "running" || value === "completed";
}

const variantArgument = process.argv[2];
const stateArgument = process.argv[3];
const outputDirectoryArgument = process.argv[4];

if (!isRosterVariant(variantArgument) || !isRosterState(stateArgument) || !outputDirectoryArgument) {
	throw new Error(
		"Usage: bun agent-roster-comparison-fixture.ts <vertical|grouped|rail> <running|completed> <output-directory>",
	);
}

const variant = variantArgument;
const state = stateArgument;
const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const runningAgents: FixtureAgent[] = [
	{
		id: "claude-ui",
		name: "explorer",
		group: "UI references",
		task: "Inspect Claude activity UI",
		status: "running",
		action: "Reading foreground and background states",
		toolUses: 5,
		tokens: "18k",
		elapsed: "14s",
		result: "Transcript records and the live roster have different jobs.",
	},
	{
		id: "tintin-ui",
		name: "reviewer",
		group: "UI references",
		task: "Inspect tintin activity UI",
		status: "running",
		action: "Comparing FleetView density",
		toolUses: 4,
		tokens: "11k",
		elapsed: "11s",
		result: "One roster is enough; the statusline and overlay are unnecessary.",
	},
	{
		id: "pi-constraints",
		name: "pi-reviewer",
		group: "Pi validation",
		task: "Check Pi interaction constraints",
		status: "queued",
		action: "Waiting for a worker slot",
		toolUses: 0,
		tokens: "0",
		elapsed: "queued #1",
		result: "Use belowEditor and a non-floating detail surface.",
	},
	{
		id: "narrow-layout",
		name: "test-runner",
		group: "Pi validation",
		task: "Verify narrow terminal layout",
		status: "running",
		action: "Checking 64 × 28 truncation",
		toolUses: 3,
		tokens: "7k",
		elapsed: "6s",
		result: "Right-side state remains visible after task truncation.",
	},
];

const agents: FixtureAgent[] =
	state === "running"
		? runningAgents
		: runningAgents.map((agent, index) => ({
				...agent,
				status: "completed",
				elapsed: ["18s", "16s", "9s", "12s"][index] ?? agent.elapsed,
				tokens: ["24k", "17k", "8k", "12k"][index] ?? agent.tokens,
				toolUses: [7, 6, 2, 4][index] ?? agent.toolUses,
			}));

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: SESSION_IDS[`${variant}-${state}`],
});
const variantOffset = { vertical: 0, grouped: 20, rail: 40 }[variant];
const stateOffset = state === "running" ? 0 : 10;
const baseTimestamp = Date.UTC(2026, 7, 1, 10, 0, variantOffset + stateOffset);
const toolCallId = `${variant}-${state}-roster`;

session.appendMessage({
	role: "user",
	content: "让几个 Agent 并行检查 Agent UI，并继续主对话。",
	timestamp: baseTimestamp,
});

session.appendMessage({
	role: "assistant",
	content: [
		{
			type: "text",
			text: "我会在后台并行检查参考界面和 Pi 的限制。",
		},
		{
			type: "toolCall",
			id: toolCallId,
			name: "prototype_agent_roster",
			arguments: { variant, state, agents },
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "agent-roster-fixture",
	usage: ZERO_USAGE,
	stopReason: "toolUse",
	timestamp: baseTimestamp + 1_000,
});

session.appendMessage({
	role: "toolResult",
	toolCallId,
	toolName: "prototype_agent_roster",
	content: [
		{ type: "text", text: state === "running" ? "Four fixture agents started." : "Four fixture agents completed." },
	],
	details: { variant, state, agents },
	isError: false,
	timestamp: baseTimestamp + 2_000,
});

session.appendMessage({
	role: "assistant",
	content: [
		{
			type: "text",
			text: state === "running" ? "它们会继续工作；主对话现在仍然可以使用。" : "四份检查结果已经回到主对话。",
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "agent-roster-fixture",
	usage: ZERO_USAGE,
	stopReason: "stop",
	timestamp: baseTimestamp + 3_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Session fixture was not persisted");
process.stdout.write(`${sessionFile}\n`);
