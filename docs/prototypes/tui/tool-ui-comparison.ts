/**
 * PROTOTYPE — throwaway native-Pi comparison, not product code.
 *
 * Question: Which transcript projection should Pi Stuff use for the same
 * tool activity: A individual compact rows, B one exploration summary, or
 * C a bounded exploration summary with two representative child rows?
 *
 * The Tool Details surface is shared by all three variants. It uses only
 * certified Pi public APIs, replaces the editor region, and never opens an overlay.
 * All data is deterministic; the registered tool performs no I/O.
 *
 * Run from the repository root with a generated fixture session, then enter:
 * /prototype-tool-details
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isJsonInputObject } from "../../../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../../packages/pi-stuff/src/shared/runtime-type.js";
import { CERTIFIED_PI_VERSION } from "../../../scripts/pi-host-contract.js";

type TranscriptVariant = "individual" | "grouped" | "bounded";
type ToolAction = "read" | "search" | "test";

interface GroupChildSummary {
	action: ToolAction;
	summary: string;
	target: string;
}

interface PrototypeToolDetails {
	action: ToolAction;
	detailLines: string[];
	groupChildren?: GroupChildSummary[];
	groupId?: string;
	groupLabel?: string;
	groupPosition?: number;
	groupSize?: number;
	itemId: string;
	summary: string;
	target: string;
	variant: TranscriptVariant;
}

const TOOL_NAME = "prototype_tool_action";
const REPRESENTATIVE_CHILDREN = 2;

const ACTION_LABELS = {
	read: "Read",
	search: "Search",
	test: "Test",
} satisfies Record<ToolAction, string>;

const VARIANT_LABELS = {
	individual: "A · Individual rows",
	grouped: "B · Exploration summary",
	bounded: "C · Bounded group",
} satisfies Record<TranscriptVariant, string>;

const PARAMETERS = Type.Object({
	variant: Type.Union([Type.Literal("individual"), Type.Literal("grouped"), Type.Literal("bounded")]),
	action: Type.Union([Type.Literal("read"), Type.Literal("search"), Type.Literal("test")]),
	target: Type.String(),
});

const FALLBACK_ITEMS: PrototypeToolDetails[] = [
	{
		variant: "bounded",
		itemId: "read-package",
		action: "read",
		target: "packages/pi-stuff/package.json",
		summary: "84 lines",
		detailLines: ["name: @jczhang02/pi-stuff", `host: Pi ${CERTIFIED_PI_VERSION}`, "entry: src/index.ts"],
		groupId: "tool-ui-exploration",
		groupLabel: "Explored tool UI · 3 operations",
		groupChildren: [
			{ action: "read", target: "packages/pi-stuff/package.json", summary: "84 lines" },
			{ action: "search", target: "renderResult in packages/", summary: "7 matches" },
			{
				action: "read",
				target: "docs/research/pi-tidy-tools-ui-reference.md",
				summary: "126 lines",
			},
		],
		groupPosition: 0,
		groupSize: 3,
	},
	{
		variant: "bounded",
		itemId: "search-renderer",
		action: "search",
		target: "renderResult in packages/",
		summary: "7 matches",
		detailLines: ["packages/read/src/index.ts:91", "packages/search/src/index.ts:117"],
		groupId: "tool-ui-exploration",
		groupPosition: 1,
		groupSize: 3,
	},
	{
		variant: "bounded",
		itemId: "read-reference",
		action: "read",
		target: "docs/research/pi-tidy-tools-ui-reference.md",
		summary: "126 lines",
		detailLines: ["Compact result rows", "Bounded detail rendering", "Error context stays visible"],
		groupId: "tool-ui-exploration",
		groupPosition: 2,
		groupSize: 3,
	},
	{
		variant: "bounded",
		itemId: "test-baseline",
		action: "test",
		target: "bun test",
		summary: "38 passed · 1.84s",
		detailLines: Array.from({ length: 24 }, (_, index) => {
			const shard = String(index + 1).padStart(2, "0");
			return index === 23 ? "FULL TEST OUTPUT · shard 24/24 complete" : `PASS shard ${shard}/24`;
		}),
	},
];

export default function registerToolUiComparison(pi: ExtensionAPI): void {
	pi.registerProvider("fixture", {
		name: "Tool UI fixture",
		baseUrl: "http://127.0.0.1.invalid",
		apiKey: "fixture-only",
		api: "openai-completions",
		models: [
			{
				id: "tool-ui-fixture",
				name: "Tool UI fixture",
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
		label: "Prototype tool action",
		description: "Render deterministic tool UI fixture data without performing I/O.",
		parameters: PARAMETERS,
		renderShell: "self",

		async execute(_toolCallId, params) {
			const details: PrototypeToolDetails = {
				variant: params.variant,
				itemId: `${params.action}:${params.target}`,
				action: params.action,
				target: params.target,
				summary: "Fixture completed",
				detailLines: ["Deterministic prototype result"],
			};

			return {
				content: [{ type: "text" as const, text: "Deterministic prototype result" }],
				details,
			};
		},

		renderCall(_args, _theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText("");
			return text;
		},

		renderResult(result, { isPartial }, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = parsePrototypeDetails(result.details);

			if (!details) {
				text.setText(theme.fg("error", "✗ Invalid prototype fixture"));
				return text;
			}

			if (isPartial) {
				text.setText(renderWorkingRow(details, theme));
				return text;
			}

			if (context.isError) {
				text.setText(renderIndividualRow(details, theme, "error"));
				return text;
			}

			text.setText(renderTranscriptResult(details, theme));
			return text;
		},
	});

	pi.registerCommand("prototype-tool-details", {
		description: "Open the non-overlay Tool Details prototype",
		handler: async (args, ctx) => openToolDetails(args, ctx),
	});

	pi.registerShortcut(Key.ctrl("o"), {
		description: "Open Tool Details",
		handler: async (ctx) => openToolDetails("", ctx),
	});
}

async function openToolDetails(args: string, ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("Tool Details requires interactive mode", "error");
		return;
	}

	const sessionItems = readSessionItems(ctx);
	const items = sessionItems.length > 0 ? sessionItems : fallbackItemsFor(args);

	// This disposable prototype runs as the only Extension. A zero-line
	// public footer temporarily removes the normal statusline while the
	// editor-replacement surface owns keyboard focus.
	ctx.ui.setFooter(() => new Text("", 0, 0));
	try {
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new ToolDetailsSurface(items, theme, tui.terminal.rows, () => tui.requestRender(), done),
			{ overlay: false },
		);
	} finally {
		ctx.ui.setFooter(undefined);
	}
}

function renderTranscriptResult(details: PrototypeToolDetails, theme: Theme): string {
	if (!details.groupId || details.variant === "individual") {
		return renderIndividualRow(details, theme, "success");
	}

	const position = details.groupPosition;
	const size = details.groupSize;
	if (position === undefined || size === undefined) {
		return renderIndividualRow(details, theme, "success");
	}

	if (details.variant === "grouped") {
		if (position !== 0) return "";
		const label = details.groupLabel ?? `Explored ${size} operations`;
		return `${theme.fg("success", "✓")} ${theme.fg("text", label)}`;
	}

	if (position !== 0) return "";

	const label = details.groupLabel ?? `Explored ${size} operations`;
	const groupChildren = details.groupChildren ?? [
		{ action: details.action, target: details.target, summary: details.summary },
	];
	const visibleChildren = groupChildren.slice(0, REPRESENTATIVE_CHILDREN);
	const remaining = Math.max(0, size - visibleChildren.length);
	const lines = [`${theme.fg("success", "✓")} ${theme.fg("text", label)}`];

	for (let index = 0; index < visibleChildren.length; index += 1) {
		const child = visibleChildren[index];
		if (!child) continue;
		const isLastVisibleChild = index === visibleChildren.length - 1;
		const childPrefix = isLastVisibleChild && remaining === 0 ? "└" : "├";
		lines.push(
			`  ${theme.fg("borderMuted", childPrefix)} ${theme.fg("muted", ACTION_LABELS[child.action])} ${theme.fg("text", child.target)} ${theme.fg("dim", `· ${child.summary}`)}`,
		);
	}

	if (remaining > 0) {
		lines.push(`  ${theme.fg("borderMuted", "└")} ${theme.fg("muted", `+${remaining} more`)}`);
	}

	return lines.join("\n");
}

function renderIndividualRow(details: PrototypeToolDetails, theme: Theme, state: "success" | "error"): string {
	const marker = state === "success" ? theme.fg("success", "✓") : theme.fg("error", "✗");
	return `${marker} ${theme.fg("muted", ACTION_LABELS[details.action])} ${theme.fg("text", details.target)} ${theme.fg("dim", `· ${details.summary}`)}`;
}

function renderWorkingRow(details: PrototypeToolDetails, theme: Theme): string {
	const verb = details.action === "read" ? "Reading" : details.action === "search" ? "Searching" : "Testing";
	return `${theme.fg("warning", "·")} ${theme.fg("muted", verb)} ${theme.fg("text", details.target)}`;
}

function readSessionItems(ctx: ExtensionContext): PrototypeToolDetails[] {
	const items: PrototypeToolDetails[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
		const details = parsePrototypeDetails(message.details);
		if (details) items.push(details);
	}
	return items;
}

function fallbackItemsFor(args: string): PrototypeToolDetails[] {
	const requestedVariant = args.trim();
	const variant = isTranscriptVariant(requestedVariant) ? requestedVariant : "bounded";
	return FALLBACK_ITEMS.map((item) => ({ ...item, variant }));
}

function parsePrototypeDetails<Value>(value: Value): PrototypeToolDetails | undefined {
	if (!isJsonInputObject(value)) return undefined;
	if (!isTranscriptVariant(value["variant"])) return undefined;
	if (!isToolAction(value["action"])) return undefined;
	if (!isRuntimeString(value["itemId"]) || !isRuntimeString(value["target"]) || !isRuntimeString(value["summary"]))
		return;
	const detailLines = value["detailLines"];
	if (!Array.isArray(detailLines) || !detailLines.every(isRuntimeString)) return undefined;
	if (
		value["groupChildren"] !== undefined &&
		(!Array.isArray(value["groupChildren"]) || !value["groupChildren"].every(isGroupChildSummary))
	) {
		return undefined;
	}
	if (value["groupId"] !== undefined && !isRuntimeString(value["groupId"])) return undefined;
	if (value["groupLabel"] !== undefined && !isRuntimeString(value["groupLabel"])) return undefined;
	if (value["groupPosition"] !== undefined && !isRuntimeNumber(value["groupPosition"])) return undefined;
	if (value["groupSize"] !== undefined && !isRuntimeNumber(value["groupSize"])) return undefined;
	const details: PrototypeToolDetails = {
		action: value["action"],
		detailLines,
		itemId: value["itemId"],
		summary: value["summary"],
		target: value["target"],
		variant: value["variant"],
	};
	if (value["groupChildren"]) details.groupChildren = value["groupChildren"];
	if (value["groupId"]) details.groupId = value["groupId"];
	if (value["groupLabel"]) details.groupLabel = value["groupLabel"];
	if (value["groupPosition"] !== undefined) details.groupPosition = value["groupPosition"];
	if (value["groupSize"] !== undefined) details.groupSize = value["groupSize"];
	return details;
}

function isTranscriptVariant<Value>(value: Value): value is Value & TranscriptVariant {
	return value === "individual" || value === "grouped" || value === "bounded";
}

function isToolAction<Value>(value: Value): value is Value & ToolAction {
	return value === "read" || value === "search" || value === "test";
}

function isGroupChildSummary<Value>(value: Value): value is Value & GroupChildSummary {
	return (
		isJsonInputObject(value) &&
		isToolAction(value["action"]) &&
		isRuntimeString(value["target"]) &&
		isRuntimeString(value["summary"])
	);
}

class ToolDetailsSurface implements Component {
	private readonly items: PrototypeToolDetails[];
	private readonly theme: Theme;
	private readonly terminalRows: number;
	private readonly requestRender: () => void;
	private readonly done: () => void;
	private selectedItem: number;
	private scrollOffset = 0;

	constructor(
		items: PrototypeToolDetails[],
		theme: Theme,
		terminalRows: number,
		requestRender: () => void,
		done: () => void,
	) {
		this.items = items;
		this.theme = theme;
		this.terminalRows = terminalRows;
		this.requestRender = requestRender;
		this.done = done;
		this.selectedItem = Math.max(0, items.length - 1);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done();
			return;
		}

		if (matchesKey(data, "up")) {
			this.selectItem(this.selectedItem - 1);
			return;
		}

		if (matchesKey(data, "down")) {
			this.selectItem(this.selectedItem + 1);
			return;
		}

		if (matchesKey(data, "pageUp")) {
			this.scrollBy(-this.pageSize());
			return;
		}

		if (matchesKey(data, "pageDown")) {
			this.scrollBy(this.pageSize());
			return;
		}

		if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.requestRender();
			return;
		}

		if (matchesKey(data, "end")) {
			this.scrollOffset = this.maxScrollOffset();
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const selected = this.items[this.selectedItem];
		if (!selected) return [];

		this.scrollOffset = Math.min(this.scrollOffset, this.maxScrollOffset());
		const lines = [
			this.theme.fg("border", "─".repeat(renderWidth)),
			` ${this.theme.fg("text", this.theme.bold("Tool Details"))}  ${this.theme.fg("muted", VARIANT_LABELS[selected.variant])}`,
			"",
		];

		for (let index = 0; index < this.items.length; index += 1) {
			const item = this.items[index];
			if (!item) continue;
			lines.push(this.renderItem(item, index));
		}

		lines.push("", this.renderSelectedHeading(selected), `  ${this.theme.fg("muted", selected.summary)}`, "");
		lines.push(...this.renderDetailLines(selected));
		lines.push("", this.theme.fg("dim", " ↑/↓ item · PgUp/PgDn scroll · Home/End · Esc close"));

		return lines.map((line) => truncateToWidth(line, renderWidth));
	}

	invalidate(): void {}

	private selectItem(index: number): void {
		const nextIndex = Math.max(0, Math.min(this.items.length - 1, index));
		if (nextIndex === this.selectedItem) return;
		this.selectedItem = nextIndex;
		this.scrollOffset = 0;
		this.requestRender();
	}

	private scrollBy(lines: number): void {
		const nextOffset = Math.max(0, Math.min(this.maxScrollOffset(), this.scrollOffset + lines));
		if (nextOffset === this.scrollOffset) return;
		this.scrollOffset = nextOffset;
		this.requestRender();
	}

	private renderItem(item: PrototypeToolDetails, index: number): string {
		const selected = index === this.selectedItem;
		const prefix = selected ? this.theme.fg("accent", "❯") : " ";
		const number = this.theme.fg(selected ? "text" : "muted", `${index + 1}.`);
		const action = this.theme.fg(selected ? "text" : "muted", ACTION_LABELS[item.action]);
		const target = this.theme.fg(selected ? "text" : "dim", item.target);
		return ` ${prefix} ${number} ${action} ${target}`;
	}

	private renderSelectedHeading(item: PrototypeToolDetails): string {
		const action = this.theme.fg("muted", ACTION_LABELS[item.action]);
		return `  ${action} ${this.theme.fg("text", this.theme.bold(item.target))}`;
	}

	private renderDetailLines(item: PrototypeToolDetails): string[] {
		const viewportSize = this.viewportSize();
		const visibleLines = item.detailLines.slice(this.scrollOffset, this.scrollOffset + viewportSize);
		if (visibleLines.length === 0) return [`  ${this.theme.fg("dim", "No detailed output")}`];

		const lineNumberWidth = String(item.detailLines.length).length;
		const lines = visibleLines.map((line, index) => {
			const lineNumber = String(this.scrollOffset + index + 1).padStart(lineNumberWidth, " ");
			return `  ${this.theme.fg("dim", `${lineNumber} │`)} ${this.theme.fg("toolOutput", line)}`;
		});
		const first = this.scrollOffset + 1;
		const last = this.scrollOffset + visibleLines.length;
		lines.push(`  ${this.theme.fg("dim", `Lines ${first}–${last} of ${item.detailLines.length}`)}`);
		return lines;
	}

	private viewportSize(): number {
		return Math.max(5, Math.min(12, this.terminalRows - 16));
	}

	private pageSize(): number {
		return Math.max(1, this.viewportSize() - 1);
	}

	private maxScrollOffset(): number {
		const selected = this.items[this.selectedItem];
		return Math.max(0, (selected?.detailLines.length ?? 0) - this.viewportSize());
	}
}
