/**
 * PROTOTYPE ONLY — compare three Fleetview affordance structures inside the
 * real Pi Host. Disposable visual evidence; never ship this as product code.
 *
 * Three variants, selected with PI_STUFF_FLEETVIEW_VARIANT, show complete idle
 * and active states selected with PI_STUFF_FLEETVIEW_STATE.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PROVIDER = "fleetview-affordance-fixture";
const MODEL = "gpt-5.6-sol";
const MODEL_IDENTITY = "openai-codex/gpt-5.6-sol";
const PROMPT = "继续主任务，同时让两个 Agent 做独立复核。";
const NARROW_WIDTH = 64;

type FleetviewState = "active" | "idle";
type Variant = "a" | "b" | "c";

interface AgentFixture {
	readonly description: string;
	readonly elapsed: string;
	readonly name: string;
}

interface Segment {
	readonly priority: number;
	readonly text: string;
}

const AGENTS: readonly AgentFixture[] = [
	{ name: "explorer", description: "Inspect Fleetview affordance", elapsed: "14s" },
	{ name: "reviewer", description: "Check narrow-width behavior", elapsed: "11s" },
];

function configuredVariant(): Variant {
	// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket access.
	const value = process.env["PI_STUFF_FLEETVIEW_VARIANT"]?.toLowerCase();
	return value === "b" || value === "c" ? value : "a";
}

function configuredState(): FleetviewState {
	// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket access.
	return process.env["PI_STUFF_FLEETVIEW_STATE"] === "active" ? "active" : "idle";
}

class EmptyComponent implements Component {
	invalidate(): void {}
	render(): string[] {
		return [];
	}
}

class FleetviewPrototype implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly variant: Variant,
		private readonly state: FleetviewState,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const boundedWidth = Math.max(1, Math.floor(width));
		return [
			packStatus(boundedWidth, this.theme),
			promptRow(PROMPT, boundedWidth, this.theme),
			...fleetRows(this.variant, this.state, boundedWidth, this.theme),
		];
	}
}

function statusSegments(theme: Theme): readonly Segment[] {
	return [
		{ priority: 100, text: `${theme.fg("accent", "󰚩")} ${theme.fg("accent", MODEL_IDENTITY)}` },
		{ priority: 65, text: `${theme.fg("accent", "")} ${theme.fg("muted", "high")}` },
		{ priority: 55, text: theme.fg("warning", " Fast") },
		{ priority: 95, text: `${theme.fg("accent", "󰉋")} ${theme.fg("text", "pi-stuff")}` },
		{ priority: 90, text: `${theme.fg("muted", "")} ${theme.fg("text", "main")}` },
		{
			priority: 50,
			text: `${theme.fg("muted", "")} ${theme.fg("success", "(+6,")}${theme.fg("error", "-0")}${theme.fg("success", ")")}`,
		},
		{ priority: 85, text: `${theme.fg("muted", "󰍛")} ${theme.fg("text", "42%")}` },
		{ priority: 45, text: `${theme.fg("muted", "󰆼")} ${theme.fg("text", "78%")}` },
		{ priority: 80, text: `${theme.fg("warning", "󰃭")} ${theme.fg("text", "52%")}` },
	];
}

function packStatus(width: number, theme: Theme): string {
	const selected = [...statusSegments(theme)];
	const separator = theme.fg("dim", " · ");
	const render = (): string => selected.map((segment) => segment.text).join(separator);
	while (selected.length > 1 && visibleWidth(render()) > width) {
		let removalIndex = 0;
		for (let index = 1; index < selected.length; index += 1) {
			if ((selected[index]?.priority ?? Infinity) < (selected[removalIndex]?.priority ?? 0)) removalIndex = index;
		}
		selected.splice(removalIndex, 1);
	}
	return truncateToWidth(render(), width, theme.fg("dim", "…"));
}

function promptRow(prompt: string, width: number, theme: Theme): string {
	const marker = theme.fg("accent", " ");
	return `${marker}${theme.fg("dim", truncateToWidth(prompt, Math.max(1, width - visibleWidth(marker)), "…"))}`;
}

function fleetRows(variant: Variant, state: FleetviewState, width: number, theme: Theme): string[] {
	if (variant === "b") return stableHeaderRows(state, width, theme);
	if (variant === "c") return inlineRows(state, width, theme);
	return contextualRows(state, width, theme);
}

function contextualRows(state: FleetviewState, width: number, theme: Theme): string[] {
	const help =
		state === "idle"
			? ""
			: width <= NARROW_WIDTH
				? "↑/↓ select · Enter · x stop · Esc"
				: "↑/↓ select · Enter view · x stop · Esc return";
	const rows: string[] = [help ? indent(theme.fg("dim", help), width) : ""];
	rows.push(mainRow(state === "idle", "", width, theme));
	for (const agent of AGENTS) {
		rows.push(agentRow(agent, state === "active" && agent.name === "explorer", agent.elapsed, width, theme));
	}
	return rows;
}

function stableHeaderRows(state: FleetviewState, width: number, theme: Theme): string[] {
	const header =
		state === "idle"
			? theme.fg("dim", "Agents · 2 active")
			: theme.fg(
					"dim",
					width <= NARROW_WIDTH
						? "Managing · ↑/↓ · Enter · x stop · Esc"
						: "Managing agents · ↑/↓ select · Enter view · x stop · Esc return",
				);
	return [
		indent(header, width),
		mainRow(state === "idle", "", width, theme),
		...AGENTS.map((agent) =>
			agentRow(agent, state === "active" && agent.name === "explorer", agent.elapsed, width, theme),
		),
	];
}

function inlineRows(state: FleetviewState, width: number, theme: Theme): string[] {
	const mainRight =
		state === "idle" ? theme.fg("dim", "/agents") : theme.fg("dim", width <= NARROW_WIDTH ? "Esc" : "Esc return");
	return [
		mainRow(state === "idle", mainRight, width, theme),
		...AGENTS.map((agent) => {
			const selected = state === "active" && agent.name === "explorer";
			const right = selected
				? theme.fg("dim", width <= NARROW_WIDTH ? "Enter · x stop" : "Enter view · x stop")
				: agent.elapsed;
			return agentRow(agent, selected, right, width, theme);
		}),
	];
}

function indent(content: string, width: number): string {
	return truncateToWidth(`  ${content}`, width, "");
}

function mainRow(selected: boolean, right: string, width: number, theme: Theme): string {
	const marker = selected ? theme.fg("accent", "●") : theme.fg("muted", "○");
	return joinColumns(`  ${marker} ${theme.fg("text", "main")}`, right, width);
}

function agentRow(agent: AgentFixture, selected: boolean, right: string, width: number, theme: Theme): string {
	const marker = selected ? theme.fg("accent", "●") : theme.fg("muted", "○");
	const prefix = `  ${marker} `;
	const styledRight = right.includes("\u001b[") ? right : theme.fg("dim", right);
	const rightWidth = visibleWidth(styledRight);
	const leftBudget = Math.max(1, width - (rightWidth > 0 ? rightWidth + 2 : 0));
	const name = theme.fg("text", truncateToWidth(agent.name, Math.max(1, leftBudget - visibleWidth(prefix)), "…"));
	const descriptionBudget = Math.max(0, leftBudget - visibleWidth(prefix) - visibleWidth(name) - 2);
	const description = visibleWidth(agent.description) <= descriptionBudget ? agent.description : "";
	const left = truncateToWidth(
		`${prefix}${name}${description ? `  ${theme.fg("muted", description)}` : ""}`,
		leftBudget,
		"",
	);
	return joinColumns(left, styledRight, width);
}

function joinColumns(left: string, right: string, width: number): string {
	if (visibleWidth(right) === 0) return truncateToWidth(left, width, "");
	const boundedRight = truncateToWidth(right, Math.max(1, width - 1), "");
	const rightWidth = visibleWidth(boundedRight);
	const boundedLeft = truncateToWidth(left, Math.max(1, width - rightWidth - 2), "");
	const gap = Math.max(2, width - visibleWidth(boundedLeft) - rightWidth);
	return truncateToWidth(`${boundedLeft}${" ".repeat(gap)}${boundedRight}`, width, "");
}

export default function registerFleetviewAffordancePrototype(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Fleetview affordance visual fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "GPT-5.6 Sol fixture",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 272_000,
				maxTokens: 8_192,
			},
		],
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		ctx.ui.setHeader(() => new EmptyComponent());
		ctx.ui.setFooter((_tui, theme) => new FleetviewPrototype(theme, configuredVariant(), configuredState()));
	});
}
