/**
 * PROTOTYPE — throwaway native-Pi comparison, not product code.
 *
 * Question: how much normal-screen space should session Todo occupy beside
 * the already-selected Claude-like Agent roster?
 *
 * Every state is a deterministic fixture. The extension performs no I/O and
 * uses only certified Pi public inline UI APIs; it never opens a floating window.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isJsonInputObject } from "../../../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../../packages/pi-stuff/src/shared/runtime-type.js";

type WorkState = "blocked" | "running";
type WorkVariant = "checklist" | "ondemand" | "strip";

interface WorkTask {
	activeForm: string;
	id: number;
	/** Fixture-only presentation state; rpiv-todo does not add this to its state machine. */
	status: "completed" | "in_progress" | "needs_input" | "pending";
	subject: string;
}

interface WorkAgent {
	name: string;
	state: string;
	status: "completed" | "running" | "waiting";
	task: string;
}

interface WorkDetails {
	agents: WorkAgent[];
	state: WorkState;
	tasks: WorkTask[];
	variant: WorkVariant;
}

const TOOL_NAME = "prototype_work_todo";
const TODO_WIDGET_KEY = "prototype-work-todo";
const AGENT_WIDGET_KEY = "prototype-work-agents";

const TASK_PARAMETERS = Type.Object({
	id: Type.Number(),
	subject: Type.String(),
	activeForm: Type.String(),
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("in_progress"),
		Type.Literal("completed"),
		Type.Literal("needs_input"),
	]),
});

const AGENT_PARAMETERS = Type.Object({
	name: Type.String(),
	task: Type.String(),
	state: Type.String(),
	status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("waiting")]),
});

const PARAMETERS = Type.Object({
	variant: Type.Union([Type.Literal("checklist"), Type.Literal("strip"), Type.Literal("ondemand")]),
	state: Type.Union([Type.Literal("running"), Type.Literal("blocked")]),
	tasks: Type.Array(TASK_PARAMETERS),
	agents: Type.Array(AGENT_PARAMETERS),
});

export default function registerWorkTodoComparison(pi: ExtensionAPI): void {
	pi.registerProvider("fixture", {
		name: "Work Todo fixture",
		baseUrl: "http://127.0.0.1.invalid",
		apiKey: "fixture-only",
		api: "openai-completions",
		models: [
			{
				id: "work-todo-fixture",
				name: "Work Todo fixture",
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
		label: "Prototype Work Todo",
		description: "Render deterministic Todo and Agent layout fixtures.",
		parameters: PARAMETERS,
		renderShell: "self",

		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text" as const, text: "Deterministic Work Todo fixture" }],
				details: params satisfies WorkDetails,
			};
		},

		renderCall(_args, _theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText("");
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = parseWorkDetails(result.details);
			text.setText(details ? renderReferenceSummary(theme) : theme.fg("error", "✗ Invalid Work Todo fixture"));
			return text;
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const details = readWorkDetails(ctx);
		if (!details) return;
		installTodoSurface(details, ctx);
		installAgentRoster(details, ctx);
	});
}

function renderReferenceSummary(theme: Theme): string {
	return [
		`${theme.fg("accent", "●")} ${theme.fg("text", "Compared Todo UI references")}`,
		`  ${theme.fg("borderMuted", "├")} ${theme.fg("text", "Claude Code 2.1.220")} ${theme.fg("dim", "· bounded task list")}`,
		`  ${theme.fg("borderMuted", "├")} ${theme.fg("text", "rpiv-todo 2.3.1")} ${theme.fg("dim", "· larger inline panel")}`,
		`  ${theme.fg("borderMuted", "└")} ${theme.fg("muted", "+2 layout checks")}`,
	].join("\n");
}

function readWorkDetails(ctx: ExtensionContext): WorkDetails | undefined {
	let latest: WorkDetails | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
		latest = parseWorkDetails(message.details) ?? latest;
	}
	return latest;
}

function parseWorkDetails<Value>(value: Value): WorkDetails | undefined {
	if (!isJsonInputObject(value) || !isWorkVariant(value["variant"]) || !isWorkState(value["state"])) {
		return undefined;
	}
	const tasks = value["tasks"];
	const agents = value["agents"];
	if (!Array.isArray(tasks) || !tasks.every(isWorkTask)) return undefined;
	if (!Array.isArray(agents) || !agents.every(isWorkAgent)) return undefined;
	return { agents, state: value["state"], tasks, variant: value["variant"] };
}

function isWorkVariant<Value>(value: Value): value is Value & WorkVariant {
	return value === "checklist" || value === "strip" || value === "ondemand";
}

function isWorkState<Value>(value: Value): value is Value & WorkState {
	return value === "running" || value === "blocked";
}

function isWorkTask<Value>(value: Value): value is Value & WorkTask {
	return (
		isJsonInputObject(value) &&
		isRuntimeNumber(value["id"]) &&
		isRuntimeString(value["subject"]) &&
		isRuntimeString(value["activeForm"]) &&
		(value["status"] === "pending" ||
			value["status"] === "in_progress" ||
			value["status"] === "completed" ||
			value["status"] === "needs_input")
	);
}

function isWorkAgent<Value>(value: Value): value is Value & WorkAgent {
	return (
		isJsonInputObject(value) &&
		isRuntimeString(value["name"]) &&
		isRuntimeString(value["task"]) &&
		isRuntimeString(value["state"]) &&
		(value["status"] === "running" || value["status"] === "completed" || value["status"] === "waiting")
	);
}

function installTodoSurface(details: WorkDetails, ctx: ExtensionContext): void {
	if (details.variant === "ondemand" && details.state === "running") {
		ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
		return;
	}

	ctx.ui.setWidget(
		TODO_WIDGET_KEY,
		(_tui, theme) =>
			new RenderComponent((width) =>
				details.variant === "checklist"
					? renderChecklist(details, theme, width)
					: [
							renderWorkStrip(
								details,
								theme,
								width,
								details.variant === "ondemand" ? "Work needs your input" : undefined,
							),
						],
			),
		{ placement: "aboveEditor" },
	);
}

function installAgentRoster(details: WorkDetails, ctx: ExtensionContext): void {
	ctx.ui.setWidget(
		AGENT_WIDGET_KEY,
		(_tui, theme) => new RenderComponent((width) => renderAgentRoster(details, theme, width)),
		{ placement: "belowEditor" },
	);
}

function renderChecklist(details: WorkDetails, theme: Theme, width: number): string[] {
	const visible = selectChecklistTasks(details.tasks);
	const lines = visible.map((task) => renderTask(task, theme, width));
	const visibleIds = new Set(visible.map((task) => task.id));
	const hidden = details.tasks.filter((task) => !visibleIds.has(task.id));
	if (hidden.length > 0) {
		const pending = hidden.filter((task) => task.status === "pending").length;
		const suffix = pending === hidden.length ? `${pending} pending` : `${hidden.length} more`;
		lines.push(truncateToWidth(`  ${theme.fg("dim", `… +${suffix}`)}`, width, ""));
	}
	return lines;
}

function selectChecklistTasks(tasks: WorkTask[]): WorkTask[] {
	const attention = tasks.filter((task) => task.status === "needs_input");
	const current = tasks.filter((task) => task.status === "in_progress");
	const pending = tasks.filter((task) => task.status === "pending");
	const recentCompleted = tasks.filter((task) => task.status === "completed").slice(-1);
	return [...recentCompleted, ...attention, ...current, ...pending].slice(0, 5);
}

function renderTask(task: WorkTask, theme: Theme, width: number): string {
	let icon: string;
	let color: "accent" | "dim" | "success" | "warning";
	switch (task.status) {
		case "completed":
			icon = "✓";
			color = "success";
			break;
		case "in_progress":
			icon = "■";
			color = "accent";
			break;
		case "needs_input":
			icon = "!";
			color = "warning";
			break;
		case "pending":
			icon = "□";
			color = "dim";
			break;
	}
	const taskText = task.status === "needs_input" ? `${task.subject} · waiting for you` : task.subject;
	return truncateToWidth(
		`  ${theme.fg(color, icon)} ${theme.fg(task.status === "completed" ? "dim" : "text", taskText)}`,
		width,
		"…",
	);
}

function renderWorkStrip(details: WorkDetails, theme: Theme, width: number, labelOverride?: string): string {
	const current = details.tasks.find((task) => task.status === "needs_input" || task.status === "in_progress");
	const completed = details.tasks.filter((task) => task.status === "completed").length;
	const pending = details.tasks.filter((task) => task.status === "pending").length;
	const blocked = current?.status === "needs_input";
	const icon = blocked ? theme.fg("warning", "!") : theme.fg("accent", "■");
	const label =
		labelOverride ??
		(blocked ? `Waiting for you: ${current?.subject ?? "Todo is blocked"}` : current?.activeForm || "Working");
	const left = `${icon} ${theme.fg("text", label)}`;
	const right = theme.fg(blocked ? "warning" : "dim", `${completed}/${details.tasks.length} · ${pending} pending`);
	return joinColumns(left, right, width);
}

function renderAgentRoster(details: WorkDetails, theme: Theme, width: number): string[] {
	const lines = [theme.fg("dim", "  ↓ to manage")];
	for (const [index, agent] of details.agents.entries()) {
		const selected = index === 0;
		const icon = selected ? theme.fg("accent", "●") : theme.fg("dim", "○");
		const left = `${icon} ${theme.fg(selected ? "text" : "muted", `${agent.name}  ${agent.task}`)}`;
		const statusColor = agent.status === "completed" ? "success" : agent.status === "waiting" ? "warning" : "dim";
		lines.push(joinColumns(left, theme.fg(statusColor, agent.state), width));
	}
	return lines;
}

function joinColumns(left: string, right: string, width: number): string {
	const renderWidth = Math.max(1, width);
	const boundedRight = truncateToWidth(right, Math.max(1, Math.min(28, renderWidth)), "");
	const rightWidth = visibleWidth(boundedRight);
	const availableLeft = Math.max(1, renderWidth - rightWidth - 1);
	const boundedLeft = truncateToWidth(left, availableLeft, "");
	const gap = Math.max(1, renderWidth - visibleWidth(boundedLeft) - rightWidth);
	return `${boundedLeft}${" ".repeat(gap)}${boundedRight}`;
}

class RenderComponent implements Component {
	private readonly renderLines: (width: number) => string[];

	constructor(renderLines: (width: number) => string[]) {
		this.renderLines = renderLines;
	}

	render(width: number): string[] {
		return this.renderLines(width);
	}

	invalidate(): void {}
}
