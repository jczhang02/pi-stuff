/**
 * PROTOTYPE — throwaway native-Pi comparison, not product code.
 *
 * Question: where should live child-Agent activity and completed results live?
 *
 * A translates Claude Code's grouped transcript record.
 * B translates tintinweb/pi-subagents' live widget, FleetView list, and notices.
 * C combines a bounded live widget with one settled transcript summary.
 *
 * All states are deterministic fixtures. The registered tool performs no I/O,
 * and no variant opens a floating window.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isJsonInputObject } from "../../../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../../packages/pi-stuff/src/shared/runtime-type.js";

type ActivityState = "completed" | "running";
type ActivityVariant = "claude" | "hybrid" | "tintin";

interface ActivityAgent {
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

interface ActivityDetails {
	agents: ActivityAgent[];
	state: ActivityState;
	variant: ActivityVariant;
}

const TOOL_NAME = "prototype_agent_activity";
const AGENT_PARAMETERS = Type.Object({
	action: Type.String(),
	elapsed: Type.String(),
	id: Type.String(),
	maxTurns: Type.Number(),
	result: Type.String(),
	status: Type.Union([Type.Literal("completed"), Type.Literal("queued"), Type.Literal("running")]),
	task: Type.String(),
	tokens: Type.String(),
	toolUses: Type.Number(),
	turns: Type.Number(),
	type: Type.String(),
});
const PARAMETERS = Type.Object({
	variant: Type.Union([Type.Literal("claude"), Type.Literal("tintin"), Type.Literal("hybrid")]),
	state: Type.Union([Type.Literal("running"), Type.Literal("completed")]),
	agents: Type.Array(AGENT_PARAMETERS),
});

export default function registerAgentActivityComparison(pi: ExtensionAPI): void {
	pi.registerProvider("fixture", {
		name: "Agent activity fixture",
		baseUrl: "http://127.0.0.1.invalid",
		apiKey: "fixture-only",
		api: "openai-completions",
		models: [
			{
				id: "agent-activity-fixture",
				name: "Agent activity fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8_192,
				maxTokens: 1_024,
			},
		],
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Prototype Agent activity",
		description: "Render deterministic Agent activity UI without starting an Agent.",
		parameters: PARAMETERS,
		renderShell: "self",

		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text" as const, text: "Deterministic Agent activity fixture" }],
				details: {
					variant: params.variant,
					state: params.state,
					agents: params.agents,
				} satisfies ActivityDetails,
			};
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = parseActivityDetails(args);
			text.setText(
				details?.variant === "claude" && details.state === "running" ? renderClaudeTranscript(details, theme) : "",
			);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = parseActivityDetails(result.details);
			if (!details) {
				text.setText(theme.fg("error", "✗ Invalid Agent activity fixture"));
				return text;
			}

			text.setText(renderTranscript(details, theme));
			return text;
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const details = readActivityDetails(ctx);
		if (details?.state !== "running") {
			ctx.ui.setWidget("prototype-agent-activity", undefined);
			ctx.ui.setWidget("prototype-agent-fleet", undefined);
			return;
		}

		if (details.variant === "tintin" || details.variant === "hybrid") {
			ctx.ui.setWidget("prototype-agent-activity", (_tui, theme) => new AgentActivityWidget(details, theme), {
				placement: "aboveEditor",
			});
		}

		if (details.variant === "tintin") {
			ctx.ui.setWidget("prototype-agent-fleet", (_tui, theme) => new FleetListWidget(details, theme), {
				placement: "belowEditor",
			});
		}
	});
}

function renderTranscript(details: ActivityDetails, theme: Theme): string {
	switch (details.variant) {
		case "claude":
			return renderClaudeTranscript(details, theme);
		case "tintin":
			return renderTintinTranscript(details, theme);
		case "hybrid":
			return renderHybridTranscript(details, theme);
	}
}

function renderClaudeTranscript(details: ActivityDetails, theme: Theme): string {
	const running = details.state === "running";
	const header = running
		? `${theme.fg("accent", "●")} Running ${theme.bold(String(details.agents.length))} agents…`
		: `${theme.fg("success", "●")} ${theme.bold(String(details.agents.length))} agents finished`;
	const lines = [`${header} ${theme.fg("dim", "(ctrl+o to expand)")}`];

	for (const [index, agent] of details.agents.entries()) {
		const isLast = index === details.agents.length - 1;
		const branch = isLast ? "└─" : "├─";
		const continuation = isLast ? "  " : "│ ";
		const statusAction = agent.status === "queued" ? "Initializing…" : agent.action;
		const metrics = [
			agent.toolUses > 0 ? `${agent.toolUses} tool uses` : undefined,
			agent.tokens !== "0" ? `${agent.tokens} tokens` : undefined,
		].filter(Boolean);
		const metricsText = metrics.length > 0 ? ` · ${metrics.join(" · ")}` : "";
		lines.push(
			`   ${theme.fg("borderMuted", branch)} ${theme.fg("accent", theme.bold(agent.type))} ${theme.fg("text", agent.task)}${theme.fg("dim", metricsText)}`,
			`   ${theme.fg("borderMuted", `${continuation} ⎿`)} ${theme.fg("dim", statusAction)}`,
		);
	}

	return lines.join("\n");
}

function renderTintinTranscript(details: ActivityDetails, theme: Theme): string {
	if (details.state === "running") {
		return `${theme.fg("accent", "●")} ${theme.fg("text", `${details.agents.length} background agents launched`)} ${theme.fg("dim", "(↓ manage)")}`;
	}

	const lines: string[] = [];
	for (const agent of details.agents) {
		lines.push(
			`${theme.fg("success", "✓")} ${theme.bold(agent.task)} ${theme.fg("dim", "completed")}`,
			`  ${theme.fg("dim", formatAgentStats(agent))}`,
			`  ${theme.fg("dim", `⎿  ${agent.result}`)}`,
		);
	}
	return lines.join("\n");
}

function renderHybridTranscript(details: ActivityDetails, theme: Theme): string {
	if (details.state === "running") {
		const running = details.agents.filter((agent) => agent.status === "running").length;
		const queued = details.agents.filter((agent) => agent.status === "queued").length;
		const stateText = queued > 0 ? `${running} running · ${queued} queued` : `${running} running`;
		return `${theme.fg("accent", "●")} ${theme.fg("text", `Started ${details.agents.length} background agents`)} ${theme.fg("dim", `· ${stateText} · ↓ manage`)}`;
	}

	const totalTools = details.agents.reduce((sum, agent) => sum + agent.toolUses, 0);
	const lines = [
		`${theme.fg("success", "✓")} ${theme.fg("text", `${details.agents.length} research agents finished`)} ${theme.fg("dim", `· ${totalTools} tool uses · 18.2s`)}`,
	];
	for (const [index, agent] of details.agents.entries()) {
		const branch = index === details.agents.length - 1 ? "└─" : "├─";
		lines.push(
			`  ${theme.fg("borderMuted", branch)} ${theme.fg("text", agent.task.replace("Inspect ", ""))} ${theme.fg("dim", `· ${agent.result}`)}`,
		);
	}
	return lines.join("\n");
}

function formatAgentStats(agent: ActivityAgent): string {
	const turnLimit = agent.maxTurns > 0 ? `≤${agent.maxTurns}` : "";
	return `↻${agent.turns}${turnLimit} · ${agent.toolUses} tool uses · ${agent.tokens} tokens · ${agent.elapsed}`;
}

function renderFullActivityWidget(details: ActivityDetails, theme: Theme): string[] {
	const lines = [`${theme.fg("accent", "●")} ${theme.fg("accent", "Agents")}`];
	for (const [index, agent] of details.agents.entries()) {
		const isLast = index === details.agents.length - 1;
		const branch = isLast ? "└─" : "├─";
		if (agent.status === "queued") {
			lines.push(`${theme.fg("borderMuted", branch)} ${theme.fg("muted", "◦")} ${theme.fg("dim", "1 queued")}`);
			continue;
		}
		lines.push(
			`${theme.fg("borderMuted", branch)} ${theme.fg("accent", "⠹")} ${theme.bold(agent.type)}  ${theme.fg("muted", agent.task)} ${theme.fg("dim", `· ${formatAgentStats(agent)}`)}`,
			`${theme.fg("borderMuted", isLast ? "   " : "│  ")}  ${theme.fg("dim", `⎿  ${renderTintinActivity(agent)}`)}`,
		);
	}
	return lines;
}

function renderBoundedActivityWidget(details: ActivityDetails, theme: Theme): string[] {
	const runningAgents = details.agents.filter((agent) => agent.status === "running");
	const queued = details.agents.filter((agent) => agent.status === "queued").length;
	const lines = [
		`${theme.fg("accent", "●")} ${theme.fg("accent", "Agents")} ${theme.fg("dim", `· ${runningAgents.length} running · ${queued} queued · ↓ manage`)}`,
	];
	const visible = runningAgents.slice(0, 2);
	for (const [index, agent] of visible.entries()) {
		const hasMore = details.agents.length > visible.length;
		const isLast = index === visible.length - 1 && !hasMore;
		lines.push(
			`${theme.fg("borderMuted", isLast ? "└─" : "├─")} ${theme.fg("accent", "⠹")} ${theme.bold(agent.type)}  ${theme.fg("text", agent.task)}`,
			`${theme.fg("borderMuted", isLast ? "   " : "│  ")}  ${theme.fg("dim", "⎿  ")}${renderOwnedToolActivity(agent, theme)} ${theme.fg("dim", `· ${agent.toolUses} tools · ${agent.elapsed}`)}`,
		);
	}
	const hidden = details.agents.length - visible.length;
	if (hidden > 0) lines.push(`${theme.fg("borderMuted", "└─")} ${theme.fg("muted", `+${hidden} more`)}`);
	return lines;
}

function renderTintinActivity(agent: ActivityAgent): string {
	if (agent.id === "claude-ui") return "searching…";
	if (agent.id === "tintin-ui") return "reading…";
	return agent.action;
}

function renderOwnedToolActivity(agent: ActivityAgent, theme: Theme): string {
	if (agent.id === "claude-ui") {
		return `${theme.fg("muted", "Search")} ${theme.fg("text", "AgentTool UI")} ${theme.fg("dim", "· 6 matches")}`;
	}
	if (agent.id === "tintin-ui") {
		return `${theme.fg("muted", "Read")} ${theme.fg("text", "agent-widget.ts")} ${theme.fg("dim", "· 560 lines")}`;
	}
	return theme.fg("text", agent.action);
}

function renderFleetList(details: ActivityDetails, theme: Theme): string[] {
	const active = details.agents.filter((agent) => agent.status === "running");
	const lines = [
		theme.fg("dim", "  esc to interrupt · ← for agents · ↓ to manage"),
		`  ${theme.fg("accent", "●")} main`,
	];
	for (const agent of active.slice(0, 2)) {
		lines.push(
			`  ${theme.fg("muted", "○")} ${theme.fg("text", agent.type)}  ${theme.fg("muted", agent.task)} ${theme.fg("dim", `${agent.elapsed} · ↓ ${agent.tokens} tokens`)}`,
		);
	}
	const hidden = details.agents.length - active.slice(0, 2).length;
	if (hidden > 0) lines.push(theme.fg("dim", `  ↓ ${hidden} more`));
	return lines;
}

function readActivityDetails(ctx: ExtensionContext): ActivityDetails | undefined {
	let latest: ActivityDetails | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
		latest = parseActivityDetails(message.details) ?? latest;
	}
	return latest;
}

function parseActivityDetails<Value>(value: Value): ActivityDetails | undefined {
	if (!isJsonInputObject(value)) return undefined;
	if (!isActivityVariant(value["variant"]) || !isActivityState(value["state"])) return undefined;
	const agents = value["agents"];
	if (!Array.isArray(agents) || !agents.every(isActivityAgent)) return undefined;
	return { agents, state: value["state"], variant: value["variant"] };
}

function isActivityAgent<Value>(value: Value): value is Value & ActivityAgent {
	return (
		isJsonInputObject(value) &&
		isRuntimeString(value["action"]) &&
		isRuntimeString(value["elapsed"]) &&
		isRuntimeString(value["id"]) &&
		isRuntimeNumber(value["maxTurns"]) &&
		isRuntimeString(value["result"]) &&
		(value["status"] === "completed" || value["status"] === "queued" || value["status"] === "running") &&
		isRuntimeString(value["task"]) &&
		isRuntimeString(value["tokens"]) &&
		isRuntimeNumber(value["toolUses"]) &&
		isRuntimeNumber(value["turns"]) &&
		isRuntimeString(value["type"])
	);
}

function isActivityVariant<Value>(value: Value): value is Value & ActivityVariant {
	return value === "claude" || value === "tintin" || value === "hybrid";
}

function isActivityState<Value>(value: Value): value is Value & ActivityState {
	return value === "running" || value === "completed";
}

class AgentActivityWidget implements Component {
	private readonly details: ActivityDetails;
	private readonly theme: Theme;

	constructor(details: ActivityDetails, theme: Theme) {
		this.details = details;
		this.theme = theme;
	}

	render(width: number): string[] {
		const lines =
			this.details.variant === "tintin"
				? renderFullActivityWidget(this.details, this.theme)
				: renderBoundedActivityWidget(this.details, this.theme);
		return lines.map((line) => truncateToWidth(line, Math.max(1, width)));
	}

	invalidate(): void {}
}

class FleetListWidget implements Component {
	private readonly details: ActivityDetails;
	private readonly theme: Theme;

	constructor(details: ActivityDetails, theme: Theme) {
		this.details = details;
		this.theme = theme;
	}

	render(width: number): string[] {
		return renderFleetList(this.details, this.theme).map((line) => truncateToWidth(line, Math.max(1, width)));
	}

	invalidate(): void {}
}
