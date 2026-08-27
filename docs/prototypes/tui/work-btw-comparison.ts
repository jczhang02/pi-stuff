/**
 * PROTOTYPE — throwaway native-Pi comparison, not product code.
 *
 * Question: which divider-led Command Dialog structure should BTW use while
 * the main task, Todo, editor draft, and vertical Agent roster remain intact?
 *
 * All content is deterministic and model-free. This prototype performs no real
 * concurrency or persistence; it proves only certified Pi layout, focus, and draft
 * restoration. BTW never renders a normal-screen widget or transcript entry.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isJsonInputObject } from "../../../packages/pi-stuff/src/shared/json-value.js";
import { CERTIFIED_PI_VERSION } from "../../../scripts/pi-host-contract.js";

type BtwVariant = "claude" | "ephemeral" | "mailbox";

interface BtwDetails {
	variant: BtwVariant;
}

interface TodoTask {
	status: "completed" | "in_progress" | "pending";
	subject: string;
}

interface AgentRow {
	name: string;
	state: string;
	status: "completed" | "running";
	task: string;
}

type DialogOutcome = { kind: "bring"; answer: string } | { kind: "close" } | { kind: "submit"; question: string };

const TOOL_NAME = "prototype_work_btw";
const TODO_WIDGET_KEY = "prototype-work-btw-todo";
const AGENT_WIDGET_KEY = "prototype-work-btw-agents";
const CAPTURE_SHORTCUT = Key.ctrl("b");

const PARAMETERS = Type.Object({
	variant: Type.Union([Type.Literal("claude"), Type.Literal("ephemeral"), Type.Literal("mailbox")]),
});

const TODO_TASKS: TodoTask[] = [
	{ subject: "Inspect the current interaction", status: "completed" },
	{ subject: "Compare three dialog structures", status: "in_progress" },
	{ subject: "Validate draft restoration", status: "pending" },
	{ subject: "Check the narrow terminal", status: "pending" },
	{ subject: "Review conversation continuity", status: "pending" },
	{ subject: "Record the product decision", status: "pending" },
	{ subject: "Run final verification", status: "pending" },
];

const AGENTS: AgentRow[] = [
	{
		name: "claude",
		task: "Check the current TUI reference",
		state: "done · 18s",
		status: "completed",
	},
	{
		name: "reviewer",
		task: "Review dialog and editor spacing",
		state: "12s",
		status: "running",
	},
];

export default function registerWorkBtwComparison(pi: ExtensionAPI): void {
	let runtime: BtwPrototypeRuntime | undefined;

	pi.registerProvider("fixture", {
		name: "Work BTW fixture",
		baseUrl: "http://127.0.0.1.invalid",
		apiKey: "fixture-only",
		api: "openai-completions",
		models: [
			{
				id: "work-btw-fixture",
				name: "Work BTW fixture",
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
		label: "Prototype Work BTW",
		description: "Render a deterministic main-task fixture for BTW layout review.",
		parameters: PARAMETERS,
		renderShell: "self",

		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text" as const, text: "Deterministic main-task fixture" }],
				details: { variant: params.variant } satisfies BtwDetails,
			};
		},

		renderCall(_args, _theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText("");
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(
				parseBtwDetails(result.details) ? renderMainTaskResult(theme) : theme.fg("error", "Invalid fixture"),
			);
			return text;
		},
	});

	pi.registerCommand("prototype-btw", {
		description: "Open the current throwaway BTW comparison surface",
		handler: async (_args, ctx) => {
			await runtime?.open(ctx);
		},
	});

	// Capture-only shortcut: the isolated harness releases Ctrl+B from editor
	// cursor-left. This does not propose a product keybinding.
	pi.registerShortcut(CAPTURE_SHORTCUT, {
		description: "Open the throwaway BTW comparison surface",
		handler: async (ctx) => {
			await runtime?.open(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const details = readBtwDetails(ctx);
		if (!details) return;
		runtime = new BtwPrototypeRuntime(details.variant);
		runtime.installChrome(ctx);
	});
}

function renderMainTaskResult(theme: Theme): string {
	return [
		`${theme.fg("accent", "●")} ${theme.fg("text", "Main task continues")}`,
		`  ${theme.fg("borderMuted", "├")} ${theme.fg("muted", "package boundaries inspected")}`,
		`  ${theme.fg("borderMuted", "└")} ${theme.fg("muted", "native capture harness in progress")}`,
	].join("\n");
}

function readBtwDetails(ctx: ExtensionContext): BtwDetails | undefined {
	let latest: BtwDetails | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
		latest = parseBtwDetails(message.details) ?? latest;
	}
	return latest;
}

function parseBtwDetails<Value>(value: Value): BtwDetails | undefined {
	if (!isJsonInputObject(value) || !isBtwVariant(value["variant"])) return undefined;
	return { variant: value["variant"] };
}

function isBtwVariant<Value>(value: Value): value is Value & BtwVariant {
	return value === "claude" || value === "ephemeral" || value === "mailbox";
}

class BtwPrototypeRuntime {
	private dialogOpen = false;
	private mailboxQuestion: string | undefined;
	private readonly variant: BtwVariant;

	constructor(variant: BtwVariant) {
		this.variant = variant;
	}

	installChrome(ctx: ExtensionContext): void {
		ctx.ui.setWidget(
			TODO_WIDGET_KEY,
			(_tui, theme) => new StaticLinesComponent((width) => renderTodo(theme, width)),
			{ placement: "aboveEditor" },
		);
		ctx.ui.setWidget(
			AGENT_WIDGET_KEY,
			(_tui, theme) => new StaticLinesComponent((width) => renderAgentRoster(theme, width)),
			{ placement: "belowEditor" },
		);
	}

	async open(ctx: ExtensionContext): Promise<void> {
		if (this.dialogOpen || ctx.mode !== "tui") return;

		this.dialogOpen = true;
		const mainDraft = ctx.ui.getEditorText();
		let restoredDraft = mainDraft;
		this.removeChrome(ctx);
		ctx.ui.setEditorText("");
		ctx.ui.setFooter(() => new Text("", 0, 0));

		try {
			const outcome = await this.openVariantSurface(ctx);
			if (outcome.kind === "submit") {
				this.mailboxQuestion = outcome.question;
			}
			if (outcome.kind === "bring") {
				restoredDraft = appendToMainDraft(mainDraft, outcome.answer);
			}
		} finally {
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorText(restoredDraft);
			this.installChrome(ctx);
			this.dialogOpen = false;
		}
	}

	private removeChrome(ctx: ExtensionContext): void {
		ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
		ctx.ui.setWidget(AGENT_WIDGET_KEY, undefined);
	}

	private async openVariantSurface(ctx: ExtensionContext): Promise<DialogOutcome> {
		if (this.variant === "claude") {
			return ctx.ui.custom<DialogOutcome>(
				(tui, theme, _keybindings, done) => new ClaudeExchangeSurface(theme, () => tui.requestRender(), done),
				{ overlay: false },
			);
		}

		if (this.variant === "ephemeral") {
			return ctx.ui.custom<DialogOutcome>(
				(tui, theme, _keybindings, done) => new EphemeralThreadSurface(theme, () => tui.requestRender(), done),
				{ overlay: false },
			);
		}

		if (!this.mailboxQuestion) {
			return ctx.ui.custom<DialogOutcome>(
				(tui, theme, _keybindings, done) => new MailboxComposeSurface(theme, () => tui.requestRender(), done),
				{ overlay: false },
			);
		}

		return ctx.ui.custom<DialogOutcome>(
			(_tui, theme, _keybindings, done) =>
				new DetachedMailboxSurface(this.mailboxQuestion ?? "Question unavailable", theme, done),
			{ overlay: false },
		);
	}
}

function appendToMainDraft(mainDraft: string, answer: string): string {
	const prefix = mainDraft.trim().length > 0 ? `${mainDraft}\n\n` : "";
	return `${prefix}Reference from detached answer: ${answer}`;
}

function renderTodo(theme: Theme, width: number): string[] {
	const visibleTasks = TODO_TASKS.slice(0, 5);
	const lines = visibleTasks.map((task) => {
		const icon = task.status === "completed" ? "✓" : task.status === "in_progress" ? "■" : "□";
		const color = task.status === "completed" ? "success" : task.status === "in_progress" ? "accent" : "dim";
		return `  ${theme.fg(color, icon)} ${theme.fg(task.status === "completed" ? "dim" : "text", task.subject)}`;
	});
	const hidden = TODO_TASKS.length - visibleTasks.length;
	if (hidden > 0) lines.push(`  ${theme.fg("dim", `… +${hidden} pending`)}`);
	return lines.map((line) => truncateToWidth(line, width, ""));
}

function renderAgentRoster(theme: Theme, width: number): string[] {
	const lines = [theme.fg("dim", "  ↓ to manage"), `  ${theme.fg("accent", "●")} ${theme.fg("text", "main")}`];
	for (const agent of AGENTS) {
		const left = `  ${theme.fg("dim", "○")} ${theme.fg("muted", `${agent.name}  ${agent.task}`)}`;
		const state = theme.fg(agent.status === "completed" ? "success" : "dim", agent.state);
		lines.push(joinColumns(left, state, width));
	}
	return lines.map((line) => truncateToWidth(line, width, ""));
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

function boundedLines(lines: string[], width: number): string[] {
	const renderWidth = Math.max(1, width);
	return lines.map((line) => truncateToWidth(line, renderWidth, ""));
}

function divider(theme: Theme, width: number): string {
	return theme.fg("border", "─".repeat(Math.max(1, width)));
}

class StaticLinesComponent implements Component {
	private readonly renderLines: (width: number) => string[];

	constructor(renderLines: (width: number) => string[]) {
		this.renderLines = renderLines;
	}

	render(width: number): string[] {
		return this.renderLines(width);
	}

	invalidate(): void {}
}

class ClaudeExchangeSurface implements Component {
	private historyVisible = false;
	private readonly theme: Theme;
	private readonly requestRender: () => void;
	private readonly done: (outcome: DialogOutcome) => void;

	constructor(theme: Theme, requestRender: () => void, done: (outcome: DialogOutcome) => void) {
		this.theme = theme;
		this.requestRender = requestRender;
		this.done = done;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done({ kind: "close" });
			return;
		}
		if (data.toLowerCase() === "h") {
			this.historyVisible = !this.historyVisible;
			this.requestRender();
		}
	}

	render(width: number): string[] {
		return this.historyVisible ? this.renderHistory(width) : this.renderCurrent(width);
	}

	invalidate(): void {}

	private renderCurrent(width: number): string[] {
		return boundedLines(
			[
				divider(this.theme, width),
				`  ${this.theme.fg("text", this.theme.bold("BTW"))} ${this.theme.fg("dim", "· single exchange · main task continues")}`,
				"",
				`  ${this.theme.fg("muted", "Question")}`,
				`  ${this.theme.fg("text", "Why must this package keep the host boundary shallow?")}`,
				"",
				`  ${this.theme.fg("muted", "Answer")}`,
				`  ${this.theme.fg("text", "The package owns orchestration; Pi remains the stable host.")}`,
				`  ${this.theme.fg("text", "That keeps upgrades possible without forking Pi core.")}`,
				"",
				`  ${this.theme.fg("dim", "2 earlier exchanges · H history · Esc return")}`,
			],
			width,
		);
	}

	private renderHistory(width: number): string[] {
		return boundedLines(
			[
				divider(this.theme, width),
				`  ${this.theme.fg("text", this.theme.bold("BTW"))} ${this.theme.fg("dim", "/ session-local history")}`,
				"",
				`  ${this.theme.fg("accent", "●")} ${this.theme.fg("text", "Why keep the host boundary shallow?")} ${this.theme.fg("dim", "· now")}`,
				`  ${this.theme.fg("dim", "○")} ${this.theme.fg("muted", "Which Pi version is pinned?")} ${this.theme.fg("dim", "· 4m")}`,
				`  ${this.theme.fg("dim", "○")} ${this.theme.fg("muted", "Does the fixture call a model?")} ${this.theme.fg("dim", "· 11m")}`,
				"",
				`  ${this.theme.fg("muted", "Selected answer")}`,
				`  ${this.theme.fg("text", "Pi stays the stable host; the package owns orchestration and UI.")}`,
				"",
				`  ${this.theme.fg("dim", "H current exchange · Esc return")}`,
			],
			width,
		);
	}
}

class EphemeralThreadSurface implements Component {
	private actionFocused = false;
	private composer = "";
	private readonly theme: Theme;
	private readonly requestRender: () => void;
	private readonly done: (outcome: DialogOutcome) => void;
	private readonly messages = [
		{ role: "You", text: "Why keep these captures model-free?" },
		{ role: "BTW", text: "So every frame is deterministic and reviewable." },
		{ role: "You", text: "Does the main task stop while this thread is open?" },
		{ role: "BTW", text: "No. The main draft is preserved and restored." },
	];

	constructor(theme: Theme, requestRender: () => void, done: (outcome: DialogOutcome) => void) {
		this.theme = theme;
		this.requestRender = requestRender;
		this.done = done;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done({ kind: "close" });
			return;
		}
		if (matchesKey(data, "tab")) {
			this.actionFocused = !this.actionFocused;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "return")) {
			if (this.actionFocused) {
				this.done({
					kind: "bring",
					answer: `The fixture uses only public Pi ${CERTIFIED_PI_VERSION} extension UI APIs.`,
				});
				return;
			}
			if (this.composer.trim().length > 0) {
				this.messages.push({ role: "You", text: this.composer.trim() });
				this.messages.push({ role: "BTW", text: "Static fixture reply: the main thread remains unchanged." });
				this.composer = "";
				this.requestRender();
			}
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.composer = this.composer.slice(0, -1);
			this.requestRender();
			return;
		}
		if (/^[\x20-\x7e]+$/.test(data)) {
			this.actionFocused = false;
			this.composer = `${this.composer}${data}`.slice(0, 80);
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const lines = [
			divider(this.theme, width),
			`  ${this.theme.fg("text", this.theme.bold("BTW side thread"))} ${this.theme.fg("dim", "· ephemeral · main task continues")}`,
			"",
		];
		for (const message of this.messages) {
			const label = message.role === "You" ? this.theme.fg("muted", "You") : this.theme.fg("accent", "BTW");
			lines.push(`  ${label}  ${this.theme.fg("text", message.text)}`);
		}
		lines.push(
			"",
			divider(this.theme, width),
			`  ${this.theme.fg("muted", "Follow-up")}`,
			`  ${this.theme.fg("accent", "›")} ${this.theme.fg("text", this.composer)}${this.theme.fg("accent", "█")}`,
			"",
			this.actionFocused
				? `  ${this.theme.fg("accent", "› Bring answer into main draft")}`
				: `    ${this.theme.fg("muted", "Bring answer into main draft")}`,
			`  ${this.theme.fg("dim", "Enter reply · Tab action · Esc discard thread")}`,
		);
		return boundedLines(lines, width);
	}

	invalidate(): void {}
}

class MailboxComposeSurface implements Component {
	private question = "";
	private readonly theme: Theme;
	private readonly requestRender: () => void;
	private readonly done: (outcome: DialogOutcome) => void;

	constructor(theme: Theme, requestRender: () => void, done: (outcome: DialogOutcome) => void) {
		this.theme = theme;
		this.requestRender = requestRender;
		this.done = done;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done({ kind: "close" });
			return;
		}
		if (matchesKey(data, "return")) {
			const question = this.question.trim();
			if (question.length > 0) this.done({ kind: "submit", question });
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.question = this.question.slice(0, -1);
			this.requestRender();
			return;
		}
		if (/^[\x20-\x7e]+$/.test(data)) {
			this.question = `${this.question}${data}`.slice(0, 96);
			this.requestRender();
		}
	}

	render(width: number): string[] {
		return boundedLines(
			[
				divider(this.theme, width),
				`  ${this.theme.fg("text", this.theme.bold("BTW detached mailbox"))}`,
				`  ${this.theme.fg("dim", "Submit, return to the main editor immediately, and check the mailbox later.")}`,
				"",
				`  ${this.theme.fg("muted", "Question")}`,
				`  ${this.theme.fg("accent", "›")} ${this.theme.fg("text", this.question)}${this.theme.fg("accent", "█")}`,
				"",
				`  ${this.theme.fg("dim", "Enter send and return · Esc cancel")}`,
			],
			width,
		);
	}

	invalidate(): void {}
}

class DetachedMailboxSurface implements Component {
	private readonly question: string;
	private readonly theme: Theme;
	private readonly done: (outcome: DialogOutcome) => void;

	constructor(question: string, theme: Theme, done: (outcome: DialogOutcome) => void) {
		this.question = question;
		this.theme = theme;
		this.done = done;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) this.done({ kind: "close" });
	}

	render(width: number): string[] {
		return boundedLines(
			[
				divider(this.theme, width),
				`  ${this.theme.fg("text", this.theme.bold("BTW mailbox"))} ${this.theme.fg("dim", "· local history")}`,
				"",
				`  ${this.theme.fg("accent", "●")} ${this.theme.fg("text", this.question)} ${this.theme.fg("success", "answered")}`,
				`  ${this.theme.fg("dim", "○")} ${this.theme.fg("muted", "Which Pi version is pinned?")} ${this.theme.fg("dim", "· earlier")}`,
				`  ${this.theme.fg("dim", "○")} ${this.theme.fg("muted", "Does this fixture call a model?")} ${this.theme.fg("dim", "· earlier")}`,
				"",
				`  ${this.theme.fg("muted", "Answer")}`,
				`  ${this.theme.fg("text", `The layout uses only public Pi ${CERTIFIED_PI_VERSION} extension APIs.`)}`,
				`  ${this.theme.fg("text", "No fork, model call, normal row, or transcript entry.")}`,
				"",
				`  ${this.theme.fg("dim", "Esc return to the unchanged main draft")}`,
			],
			width,
		);
	}

	invalidate(): void {}
}
