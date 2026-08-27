/**
 * PROTOTYPE — throwaway native-Pi comparison, not product code.
 *
 * Question: what should the chosen Claude-style below-editor Agent roster
 * show by default: A vertical sessions, B grouped batches, or C a session rail?
 *
 * All states are deterministic fixtures. The tool performs no I/O. The roster
 * uses Pi's public belowEditor API and never opens a floating window.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isJsonInputObject } from "../../../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../../packages/pi-stuff/src/shared/runtime-type.js";

type RosterState = "completed" | "running";
type RosterVariant = "grouped" | "rail" | "vertical";

interface RosterAgent {
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

interface RosterDetails {
	agents: RosterAgent[];
	state: RosterState;
	variant: RosterVariant;
}

const TOOL_NAME = "prototype_agent_roster";
const WIDGET_KEY = "prototype-agent-roster";

const AGENT_PARAMETERS = Type.Object({
	action: Type.String(),
	elapsed: Type.String(),
	group: Type.String(),
	id: Type.String(),
	name: Type.String(),
	result: Type.String(),
	status: Type.Union([Type.Literal("completed"), Type.Literal("queued"), Type.Literal("running")]),
	task: Type.String(),
	tokens: Type.String(),
	toolUses: Type.Number(),
});

const PARAMETERS = Type.Object({
	variant: Type.Union([Type.Literal("vertical"), Type.Literal("grouped"), Type.Literal("rail")]),
	state: Type.Union([Type.Literal("running"), Type.Literal("completed")]),
	agents: Type.Array(AGENT_PARAMETERS),
});

export default function registerAgentRosterComparison(pi: ExtensionAPI): void {
	pi.registerProvider("fixture", {
		name: "Agent roster fixture",
		baseUrl: "http://127.0.0.1.invalid",
		apiKey: "fixture-only",
		api: "openai-completions",
		models: [
			{
				id: "agent-roster-fixture",
				name: "Agent roster fixture",
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
		label: "Prototype Agent roster",
		description: "Render deterministic Agent roster UI without starting an Agent.",
		parameters: PARAMETERS,
		renderShell: "self",

		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text" as const, text: "Deterministic Agent roster fixture" }],
				details: {
					variant: params.variant,
					state: params.state,
					agents: params.agents,
				} satisfies RosterDetails,
			};
		},

		renderCall(_args, _theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText("");
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = parseRosterDetails(result.details);
			text.setText(details ? renderTranscript(details, theme) : theme.fg("error", "✗ Invalid Agent roster fixture"));
			return text;
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const details = readRosterDetails(ctx);
		if (!details) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}

		const runtime = new AgentRosterRuntime(details);
		runtime.install(ctx);
	});
}

function renderTranscript(details: RosterDetails, theme: Theme): string {
	if (details.state === "running") {
		const running = details.agents.filter((agent) => agent.status === "running").length;
		const queued = details.agents.filter((agent) => agent.status === "queued").length;
		return `${theme.fg("accent", "●")} ${theme.fg("text", `Started ${details.agents.length} background agents`)} ${theme.fg("dim", `· ${running} running · ${queued} queued · ↓ manage`)}`;
	}

	const totalTools = details.agents.reduce((sum, agent) => sum + agent.toolUses, 0);
	const lines = [
		`${theme.fg("success", "✓")} ${theme.fg("text", `${details.agents.length} agents finished`)} ${theme.fg("dim", `· ${totalTools} tool uses · 18s`)}`,
	];
	const visibleAgents = details.agents.slice(0, 2);
	const hasMoreAgents = details.agents.length > visibleAgents.length;
	for (const [index, agent] of visibleAgents.entries()) {
		const isLastVisible = index === visibleAgents.length - 1;
		const connector = isLastVisible && !hasMoreAgents ? "└" : "├";
		lines.push(
			`  ${theme.fg("borderMuted", connector)} ${theme.fg("text", agent.task)} ${theme.fg("dim", `· ${agent.result}`)}`,
		);
	}
	if (hasMoreAgents) {
		lines.push(`  ${theme.fg("borderMuted", "└")} ${theme.fg("muted", `+${details.agents.length - 2} more`)}`);
	}
	return lines.join("\n");
}

function readRosterDetails(ctx: ExtensionContext): RosterDetails | undefined {
	let latest: RosterDetails | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
		latest = parseRosterDetails(message.details) ?? latest;
	}
	return latest;
}

function parseRosterDetails<Value>(value: Value): RosterDetails | undefined {
	if (!isJsonInputObject(value)) return undefined;
	if (!isRosterVariant(value["variant"]) || !isRosterState(value["state"])) return undefined;
	const agents = value["agents"];
	if (!Array.isArray(agents) || !agents.every(isRosterAgent)) return undefined;
	return { agents, state: value["state"], variant: value["variant"] };
}

function isRosterAgent<Value>(value: Value): value is Value & RosterAgent {
	return (
		isJsonInputObject(value) &&
		isRuntimeString(value["action"]) &&
		isRuntimeString(value["elapsed"]) &&
		isRuntimeString(value["group"]) &&
		isRuntimeString(value["id"]) &&
		isRuntimeString(value["name"]) &&
		isRuntimeString(value["result"]) &&
		(value["status"] === "completed" || value["status"] === "queued" || value["status"] === "running") &&
		isRuntimeString(value["task"]) &&
		isRuntimeString(value["tokens"]) &&
		isRuntimeNumber(value["toolUses"])
	);
}

function isRosterVariant<Value>(value: Value): value is Value & RosterVariant {
	return value === "vertical" || value === "grouped" || value === "rail";
}

function isRosterState<Value>(value: Value): value is Value & RosterState {
	return value === "running" || value === "completed";
}

function joinColumns(left: string, right: string, width: number): string {
	const renderWidth = Math.max(1, width);
	const boundedRight = truncateToWidth(right, Math.max(1, Math.min(24, renderWidth)), "");
	const rightWidth = visibleWidth(boundedRight);
	const availableLeft = Math.max(1, renderWidth - rightWidth - 1);
	const boundedLeft = truncateToWidth(left, availableLeft, "");
	const gap = Math.max(1, renderWidth - visibleWidth(boundedLeft) - rightWidth);
	return `${boundedLeft}${" ".repeat(gap)}${boundedRight}`;
}

function statusText(agent: RosterAgent, theme: Theme): string {
	if (agent.status === "queued") return theme.fg("warning", agent.elapsed);
	if (agent.status === "completed") {
		return theme.fg("success", `done · ${agent.elapsed} · ${agent.tokens}`);
	}
	return theme.fg("dim", agent.elapsed);
}

function detailStateText(agent: RosterAgent, theme: Theme): string {
	if (agent.status === "queued") return theme.fg("warning", agent.elapsed);
	if (agent.status === "completed") return theme.fg("success", `completed · ${agent.elapsed}`);
	return `${theme.fg("accent", "running")} ${theme.fg("dim", `· ${agent.elapsed}`)}`;
}

class AgentRosterRuntime {
	private readonly details: RosterDetails;
	private detailOpen = false;
	private navigationMode = false;
	private requestRender: () => void = () => {};
	private selectedIndex = 0;

	constructor(details: RosterDetails) {
		this.details = details;
	}

	install(ctx: ExtensionContext): void {
		this.installWidget(ctx);
		ctx.ui.onTerminalInput((data) => this.handleTerminalInput(data, ctx));
	}

	private installWidget(ctx: ExtensionContext): void {
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				this.requestRender = () => tui.requestRender();
				return new AgentRosterWidget(this.details, this, theme);
			},
			{ placement: "belowEditor" },
		);
	}

	private handleTerminalInput(data: string, ctx: ExtensionContext): { consume?: boolean } | undefined {
		if (this.detailOpen) return undefined;
		if (ctx.ui.getEditorText().length > 0) {
			this.leaveNavigation();
			return undefined;
		}

		if (!this.navigationMode && matchesKey(data, "down")) {
			this.navigationMode = true;
			this.selectedIndex = 0;
			this.requestRender();
			return { consume: true };
		}
		if (!this.navigationMode) return undefined;

		if (matchesKey(data, "escape")) {
			this.leaveNavigation();
			return { consume: true };
		}

		const previous = this.details.variant === "rail" && matchesKey(data, "left");
		const next =
			(this.details.variant === "rail" && matchesKey(data, "right")) ||
			(this.details.variant !== "rail" && matchesKey(data, "down"));
		if (previous || (this.details.variant !== "rail" && matchesKey(data, "up"))) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.requestRender();
			return { consume: true };
		}
		if (next) {
			this.selectedIndex = Math.min(this.details.agents.length, this.selectedIndex + 1);
			this.requestRender();
			return { consume: true };
		}

		if (matchesKey(data, "return")) {
			if (this.selectedIndex === 0) {
				this.leaveNavigation();
			} else {
				const agent = this.details.agents[this.selectedIndex - 1];
				if (agent) void this.openAgentDetail(agent, ctx);
			}
			return { consume: true };
		}

		// The roster is a passive below-editor widget, not a modal surface. Any
		// unrelated key leaves navigation and continues to Pi unchanged.
		this.leaveNavigation();
		return undefined;
	}

	private leaveNavigation(): void {
		if (!this.navigationMode && this.selectedIndex === 0) return;
		this.navigationMode = false;
		this.selectedIndex = 0;
		this.requestRender();
	}

	private async openAgentDetail(agent: RosterAgent, ctx: ExtensionContext): Promise<void> {
		this.detailOpen = true;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.setFooter(() => new Text("", 0, 0));
		try {
			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => new AgentDetailSurface(agent, theme, () => tui.requestRender(), done),
				{ overlay: false },
			);
		} finally {
			ctx.ui.setFooter(undefined);
			this.detailOpen = false;
			this.installWidget(ctx);
			this.requestRender();
		}
	}

	isNavigationMode(): boolean {
		return this.navigationMode;
	}

	selected(): number {
		return this.selectedIndex;
	}
}

class AgentRosterWidget implements Component {
	private readonly details: RosterDetails;
	private readonly runtime: AgentRosterRuntime;
	private readonly theme: Theme;

	constructor(details: RosterDetails, runtime: AgentRosterRuntime, theme: Theme) {
		this.details = details;
		this.runtime = runtime;
		this.theme = theme;
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const lines =
			this.details.variant === "vertical"
				? this.renderVertical(renderWidth)
				: this.details.variant === "grouped"
					? this.renderGrouped(renderWidth)
					: this.renderRail(renderWidth);
		return lines.map((line) => truncateToWidth(line, renderWidth, ""));
	}

	invalidate(): void {}

	private hint(): string {
		if (!this.runtime.isNavigationMode()) {
			const text = this.details.state === "completed" ? "  completed just now · ↓ to review" : "  ↓ to manage";
			return this.theme.fg("dim", text);
		}
		const movement = this.details.variant === "rail" ? "←/→" : "↑/↓";
		return this.theme.fg("dim", `  ${movement} to select · Enter to view · Esc to return`);
	}

	private sessionMarker(index: number): string {
		const selected = this.runtime.isNavigationMode() ? this.runtime.selected() === index : index === 0;
		return selected ? this.theme.fg("accent", "●") : this.theme.fg("muted", "○");
	}

	private renderSession(agent: RosterAgent, index: number, width: number, indent = "  "): string {
		const left = `${indent}${this.sessionMarker(index)} ${this.theme.fg("text", agent.name)}  ${this.theme.fg("muted", agent.task)}`;
		return joinColumns(left, statusText(agent, this.theme), width);
	}

	private renderVertical(width: number): string[] {
		const lines = [this.hint(), `  ${this.sessionMarker(0)} ${this.theme.fg("text", "main")}`];
		for (const [index, agent] of this.details.agents.entries()) {
			lines.push(this.renderSession(agent, index + 1, width));
		}
		return lines;
	}

	private renderGrouped(width: number): string[] {
		const groups = [...new Set(this.details.agents.map((agent) => agent.group))];
		const lines = [
			this.hint(),
			joinColumns(`  ${this.sessionMarker(0)} ${this.theme.fg("text", "main")}`, `${groups.length} groups`, width),
		];
		for (const [groupIndex, group] of groups.entries()) {
			const agents = this.details.agents.filter((agent) => agent.group === group);
			const running = agents.filter((agent) => agent.status === "running").length;
			const queued = agents.filter((agent) => agent.status === "queued").length;
			const groupState =
				this.details.state === "completed" ? `${agents.length} done` : `${running} running · ${queued} queued`;
			lines.push(
				joinColumns(
					`  ${this.theme.fg("borderMuted", groupIndex === groups.length - 1 ? "└" : "├")} ${this.theme.fg("text", group)}`,
					this.theme.fg("dim", groupState),
					width,
				),
			);
			for (const agent of agents) {
				const index = this.details.agents.indexOf(agent) + 1;
				lines.push(this.renderSession(agent, index, width, "    "));
			}
		}
		return lines;
	}

	private renderRail(width: number): string[] {
		const labels = [
			`${this.sessionMarker(0)} main`,
			...this.details.agents.map((agent, index) => `${this.sessionMarker(index + 1)} ${agent.name}`),
		];
		const rail = `  ${labels.join("  ")}`;
		const selected = this.runtime.selected();
		const selectedAgent = selected > 0 ? this.details.agents[selected - 1] : undefined;
		const detail = selectedAgent
			? joinColumns(`  ${this.theme.fg("text", selectedAgent.task)}`, statusText(selectedAgent, this.theme), width)
			: `  ${this.theme.fg(
					"muted",
					this.details.state === "completed"
						? "main conversation · Agent results received"
						: "main conversation · waiting for Agent results",
				)}`;
		return [truncateToWidth(rail, width, ` ${this.theme.fg("dim", "+more")}`), detail, this.hint()];
	}
}

class AgentDetailSurface implements Component {
	private readonly agent: RosterAgent;
	private readonly theme: Theme;
	private readonly requestRender: () => void;
	private readonly done: () => void;

	constructor(agent: RosterAgent, theme: Theme, requestRender: () => void, done: () => void) {
		this.agent = agent;
		this.theme = theme;
		this.requestRender = requestRender;
		this.done = done;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done();
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const lines = [
			this.theme.fg("border", "─".repeat(renderWidth)),
			`  ${this.theme.fg("text", this.theme.bold("Agents"))} ${this.theme.fg("dim", "/")} ${this.theme.fg("accent", this.agent.name)}`,
			"",
			`  ${this.theme.fg("muted", "Task")}      ${this.theme.fg("text", this.agent.task)}`,
			`  ${this.theme.fg("muted", "State")}     ${detailStateText(this.agent, this.theme)}`,
			`  ${this.theme.fg("muted", "Activity")}  ${this.theme.fg("text", this.agent.action)}`,
			`  ${this.theme.fg("muted", "Usage")}     ${this.theme.fg("dim", `${this.agent.toolUses} tools · ${this.agent.tokens} tokens`)}`,
			"",
			`  ${this.theme.fg("dim", "Full child conversation would appear here.")}`,
			"",
			`  ${this.theme.fg("dim", "Esc back")}`,
		];
		return lines.map((line) => truncateToWidth(line, renderWidth, ""));
	}

	invalidate(): void {}
}
