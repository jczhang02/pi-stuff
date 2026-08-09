/**
 * PROTOTYPE — throwaway certified-Pi interaction spike; not product code.
 *
 * Question: can one non-floating Command Dialog coordinator suspend BTW for a
 * high-priority destructive-operation tripwire, offer only an exact one-time
 * approval or denial, restore BTW after Enter/Esc, then restore the original
 * editor draft, Todo, and roster? Can ordinary needs-input remain non-modal,
 * and can an explicitly selected Agent stop with x and no confirmation while
 * mixed outcomes stay readable at 100×32 and 64×28?
 *
 * This extension is deterministic and model-free. It performs no network,
 * model, real Agent, subprocess, or persistent product work. Ctrl+B, Ctrl+N,
 * and P are capture-only harness controls, never proposed product keybindings.
 * The spike models one attention request; a product coordinator must queue
 * multiple requests instead of overwriting them. Here, "needs input" means the
 * main Agent has already decided a human answer is required. An internal
 * contact_supervisor/reply exchange may mark a child waiting in the roster but
 * must not automatically raise this user-facing attention line.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	createWorkAgentLifecycleState,
	type LifecycleAgent,
	reduceWorkAgentLifecycle,
	selectedLifecycleAgent,
	type WorkAgentLifecycleAction,
	type WorkAgentLifecycleState,
} from "./work-agent-lifecycle-machine.ts";

interface LifecycleFixtureDetails {
	fixture: "agent-lifecycle";
}

interface TodoTask {
	status: "completed" | "in_progress" | "pending";
	subject: string;
}

const TOOL_NAME = "prototype_work_agent_lifecycle";
const WORK_WIDGET_KEY = "prototype-work-agent-lifecycle-work";
const ROSTER_WIDGET_KEY = "prototype-work-agent-lifecycle-roster";
const BTW_CAPTURE_SHORTCUT = Key.ctrl("b");
const NEEDS_INPUT_CAPTURE_SHORTCUT = Key.ctrl("n");
const STOP_SETTLE_DELAY_MS = 1_500;

const PARAMETERS = Type.Object({});

const TODO_TASKS: readonly TodoTask[] = [
	{ status: "completed", subject: "Map Claude lifecycle behavior" },
	{ status: "in_progress", subject: "Verify one work-surface coordinator" },
	{ status: "pending", subject: "Check non-modal Agent attention" },
	{ status: "pending", subject: "Check selected-Agent stop" },
	{ status: "pending", subject: "Review narrow terminal" },
	{ status: "pending", subject: "Record the decision" },
];

export default function registerWorkAgentLifecycleSpike(pi: ExtensionAPI): void {
	let runtime: WorkAgentLifecycleRuntime | undefined;

	pi.registerProvider("fixture", {
		name: "Work Agent lifecycle fixture",
		baseUrl: "http://127.0.0.1.invalid",
		apiKey: "fixture-only",
		api: "openai-completions",
		models: [
			{
				id: "work-agent-lifecycle-fixture",
				name: "Work Agent lifecycle fixture",
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
		label: "Prototype Work Agent Lifecycle",
		description: "Render the deterministic lifecycle spike fixture.",
		parameters: PARAMETERS,
		renderShell: "self",

		async execute() {
			return {
				content: [{ type: "text" as const, text: "Deterministic Agent lifecycle fixture" }],
				details: { fixture: "agent-lifecycle" } satisfies LifecycleFixtureDetails,
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
				parseLifecycleFixtureDetails(result.details)
					? renderTranscriptRecord(theme)
					: theme.fg("error", "Invalid lifecycle fixture"),
			);
			return text;
		},
	});

	pi.registerCommand("prototype-work-agent-lifecycle", {
		description: "Open the throwaway Work Agent lifecycle spike",
		handler: async (_args, ctx) => {
			await runtime?.openBtw(ctx);
		},
	});

	// Capture-only: the harness frees Ctrl+B from editor cursor-left. This is
	// not a proposal for the product BTW keybinding.
	pi.registerShortcut(BTW_CAPTURE_SHORTCUT, {
		description: "[capture only] Open the lifecycle spike BTW surface",
		handler: async (ctx) => {
			await runtime?.openBtw(ctx);
		},
	});

	// Capture-only: injects a user-input-required event after the main Agent has
	// decided a human answer is necessary. It must not open a dialog, alter the
	// editor draft, or consume later typing.
	pi.registerShortcut(NEEDS_INPUT_CAPTURE_SHORTCUT, {
		description: "[capture only] Inject Agent user-input-required",
		handler: (ctx) => {
			runtime?.injectNeedsInput(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!readLifecycleFixtureDetails(ctx)) return;
		runtime = new WorkAgentLifecycleRuntime();
		runtime.install(ctx);
	});
}

function renderTranscriptRecord(theme: Theme): string {
	return [
		`${theme.fg("accent", "●")} ${theme.fg("text", "Background Agents")}`,
		`  ${theme.fg("borderMuted", "├")} ${theme.fg("success", "explorer done · 18s")} ${theme.fg("muted", "Claude states mapped")}`,
		`  ${theme.fg("borderMuted", "├")} ${theme.fg("error", "verifier failed · 9s")} ${theme.fg("muted", "reference API unavailable")}`,
		`  ${theme.fg("borderMuted", "│")} ${theme.fg("warning", "partial result available")}`,
		`  ${theme.fg("borderMuted", "└")} ${theme.fg("muted", "reviewer + planner launched in background")}`,
	].join("\n");
}

function readLifecycleFixtureDetails(ctx: ExtensionContext): LifecycleFixtureDetails | undefined {
	let latest: LifecycleFixtureDetails | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
		latest = parseLifecycleFixtureDetails(message.details) ?? latest;
	}
	return latest;
}

function parseLifecycleFixtureDetails(value: unknown): LifecycleFixtureDetails | undefined {
	if (!hasFixtureProperty(value) || value.fixture !== "agent-lifecycle") return undefined;
	return { fixture: "agent-lifecycle" };
}

function hasFixtureProperty(value: unknown): value is { fixture: unknown } {
	return typeof value === "object" && value !== null && "fixture" in value;
}

class WorkAgentLifecycleRuntime {
	private commandOpen = false;
	private requestRender: () => void = () => {};
	private state = createWorkAgentLifecycleState();

	install(ctx: ExtensionContext): void {
		this.installChrome(ctx);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new LifecycleEditor(tui, theme, keybindings, this));
	}

	getState(): WorkAgentLifecycleState {
		return this.state;
	}

	dispatch(action: WorkAgentLifecycleAction): void {
		this.state = reduceWorkAgentLifecycle(this.state, action);
		this.requestRender();
	}

	injectNeedsInput(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || this.commandOpen || this.state.surface.kind !== "main") return;
		this.dispatch({
			type: "needs-input-arrived",
			request: { agentId: "planner", question: "Which migration target?" },
		});
	}

	async openBtw(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui" || this.commandOpen || this.state.surface.kind !== "main") return;

		this.commandOpen = true;
		const mainDraft = ctx.ui.getEditorText();
		this.dispatch({ type: "open-btw" });
		this.removeChrome(ctx);
		ctx.ui.setEditorText("");
		ctx.ui.setFooter(() => new Text("", 0, 0));

		try {
			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					this.requestRender = () => tui.requestRender();
					return new WorkCommandSurface(this, theme, done);
				},
				{ overlay: false },
			);
		} finally {
			if (this.getState().surface.kind === "permission") {
				this.dispatch({ type: "permission-resolved", decision: "deny" });
			}
			if (this.getState().surface.kind === "btw") this.dispatch({ type: "close-btw" });
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorText(mainDraft);
			this.installChrome(ctx);
			this.commandOpen = false;
		}
	}

	private installChrome(ctx: ExtensionContext): void {
		ctx.ui.setWidget(
			WORK_WIDGET_KEY,
			(tui, theme) => {
				this.requestRender = () => tui.requestRender();
				return new WorkChromeWidget(this, theme);
			},
			{ placement: "aboveEditor" },
		);
		ctx.ui.setWidget(
			ROSTER_WIDGET_KEY,
			(tui, theme) => {
				this.requestRender = () => tui.requestRender();
				return new AgentRosterWidget(this, theme);
			},
			{ placement: "belowEditor" },
		);
	}

	private removeChrome(ctx: ExtensionContext): void {
		ctx.ui.setWidget(WORK_WIDGET_KEY, undefined);
		ctx.ui.setWidget(ROSTER_WIDGET_KEY, undefined);
	}

	handleEditorInput(data: string, editorText: string): boolean {
		if (this.commandOpen) return false;

		if (editorText.length > 0) {
			if (this.state.roster.active) this.dispatch({ type: "roster-leave" });
			return false;
		}

		if (!this.state.roster.active && matchesKey(data, "down")) {
			this.dispatch({ type: "roster-enter" });
			return true;
		}
		if (!this.state.roster.active) return false;

		if (matchesKey(data, "escape")) {
			this.dispatch({ type: "roster-leave" });
			return true;
		}
		if (matchesKey(data, "up") || matchesKey(data, "down")) {
			this.dispatch({ type: "roster-move", delta: matchesKey(data, "up") ? -1 : 1 });
			return true;
		}

		if (data.toLowerCase() === "x") {
			const selected = selectedLifecycleAgent(this.state);
			this.dispatch({ type: "stop-requested" });
			const stopping = selected ? this.state.agents.find((agent) => agent.id === selected.id) : undefined;
			if (selected && stopping?.status === "stopping") {
				setTimeout(() => this.dispatch({ type: "stop-settled", agentId: selected.id }), STOP_SETTLE_DELAY_MS);
			}
			return true;
		}

		// The roster is passive. Any unrelated key returns ownership to Pi's
		// editor and is deliberately not consumed.
		this.dispatch({ type: "roster-leave" });
		return false;
	}
}

class LifecycleEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly runtime: WorkAgentLifecycleRuntime,
	) {
		super(tui, theme, keybindings);
	}

	override handleInput(data: string): void {
		if (this.runtime.handleEditorInput(data, this.getText())) return;
		super.handleInput(data);
	}
}

class WorkChromeWidget implements Component {
	constructor(
		private readonly runtime: WorkAgentLifecycleRuntime,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		const lines: string[] = [];
		const attention = this.runtime.getState().attention;
		if (attention) {
			const agent = findAgent(this.runtime.getState(), attention.agentId);
			const name = agent?.name ?? attention.agentId;
			lines.push(
				`${this.theme.fg("warning", "  !")} ${this.theme.fg("text", `${name} needs input`)} ${this.theme.fg("dim", `· ${attention.question} · ↓ manage`)}`,
			);
		}
		lines.push(...renderTodo(this.theme));
		return boundedLines(lines, width);
	}

	invalidate(): void {}
}

class AgentRosterWidget implements Component {
	constructor(
		private readonly runtime: WorkAgentLifecycleRuntime,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		const state = this.runtime.getState();
		const lines = [
			state.roster.active
				? this.theme.fg("dim", "  ↑/↓ to select · x stop selected · Esc return")
				: this.theme.fg("dim", "  ↓ to manage"),
			`  ${this.marker(state, 0)} ${this.theme.fg("text", "main")}`,
		];

		for (const [index, agent] of state.agents.entries()) {
			const left = `  ${this.marker(state, index + 1)} ${this.theme.fg("text", agent.name)}  ${this.theme.fg("muted", agent.task)}`;
			lines.push(joinColumns(left, renderStatus(agent, this.theme), width));
		}

		return boundedLines(lines, width);
	}

	invalidate(): void {}

	private marker(state: WorkAgentLifecycleState, index: number): string {
		const selected = state.roster.active ? state.roster.selectedIndex === index : index === 0;
		return selected ? this.theme.fg("accent", "●") : this.theme.fg("muted", "○");
	}
}

class WorkCommandSurface implements Component {
	constructor(
		private readonly runtime: WorkAgentLifecycleRuntime,
		private readonly theme: Theme,
		private readonly done: () => void,
	) {}

	handleInput(data: string): void {
		const surface = this.runtime.getState().surface;
		if (surface.kind === "permission") {
			if (matchesKey(data, "escape")) {
				this.runtime.dispatch({ type: "permission-resolved", decision: "deny" });
				return;
			}
			if (matchesKey(data, "return")) {
				this.runtime.dispatch({ type: "permission-resolved", decision: "allow-once" });
			}
			return;
		}

		if (surface.kind !== "btw") return;
		if (matchesKey(data, "escape")) {
			this.runtime.dispatch({ type: "close-btw" });
			this.done();
			return;
		}

		// Capture-only: P simulates an IPC permission event while BTW owns the
		// one Command Dialog. A product event would dispatch the same action.
		if (data.toLowerCase() === "p") {
			this.runtime.dispatch({
				type: "permission-arrived",
				request: {
					action: "Delete one statically named file outside session cwd",
					agentId: "reviewer",
					command: "rm -- /tmp/pi-stuff-tripwire-prototype/obsolete.txt",
					reason: "Destructive target is explicit and outside session cwd",
				},
			});
		}
	}

	render(width: number): string[] {
		const state = this.runtime.getState();
		if (state.surface.kind === "permission") return renderPermissionSurface(state, this.theme, width);
		return renderBtwSurface(state, this.theme, width);
	}

	invalidate(): void {}
}

function renderTodo(theme: Theme): string[] {
	const visibleTasks = TODO_TASKS.slice(0, 5);
	const lines = visibleTasks.map((task) => {
		const icon = task.status === "completed" ? "✓" : task.status === "in_progress" ? "■" : "□";
		const color = task.status === "completed" ? "success" : task.status === "in_progress" ? "accent" : "dim";
		return `  ${theme.fg(color, icon)} ${theme.fg(task.status === "completed" ? "dim" : "text", task.subject)}`;
	});
	const hidden = TODO_TASKS.length - visibleTasks.length;
	if (hidden > 0) lines.push(`  ${theme.fg("dim", `… +${hidden} pending`)}`);
	return lines;
}

function renderStatus(agent: LifecycleAgent, theme: Theme): string {
	switch (agent.status) {
		case "done":
			return theme.fg("success", `done · ${agent.elapsed}`);
		case "failed":
			return theme.fg("error", `failed · ${agent.elapsed}`);
		case "stopped":
			return theme.fg("muted", `stopped · ${agent.elapsed}`);
		case "stopping":
			return theme.fg("warning", "stopping");
		case "waiting":
			return theme.fg("warning", "waiting");
		case "running":
			return theme.fg("dim", agent.elapsed);
	}
}

function renderBtwSurface(state: WorkAgentLifecycleState, theme: Theme, width: number): string[] {
	const decision = state.lastPermissionDecision;
	const resolution = decision
		? decision === "allow-once"
			? "Allowed this exact reviewer operation once · BTW restored"
			: "Denied reviewer operation · BTW restored"
		: "No pending interruption";

	return boundedLines(
		[
			divider(theme, width),
			`  ${theme.fg("text", theme.bold("BTW"))} ${theme.fg("dim", "· single exchange · main task continues")}`,
			"",
			`  ${theme.fg("muted", "Question")}`,
			`  ${theme.fg("text", "Can one owner coordinate every work surface?")}`,
			"",
			`  ${theme.fg("muted", "Answer")}`,
			`  ${theme.fg("text", "Yes. BTW stays suspended in the same Command Dialog state machine.")}`,
			`  ${theme.fg("text", "A tripwire event changes the active surface, then resumes BTW in place.")}`,
			"",
			`  ${theme.fg(decision === "deny" ? "warning" : "success", resolution)}`,
			`  ${theme.fg("dim", "Capture-only P injects tripwire · not a product key · Esc return")}`,
			`  ${theme.fg("dim", "PROTOTYPE state · surface BTW · coordinator owns focus")}`,
		],
		width,
	);
}

function renderPermissionSurface(state: WorkAgentLifecycleState, theme: Theme, width: number): string[] {
	if (state.surface.kind !== "permission") return [];
	const request = state.surface.request;
	const agent = findAgent(state, request.agentId);
	const name = agent?.name ?? request.agentId;

	return boundedLines(
		[
			divider(theme, width),
			`  ${theme.fg("warning", theme.bold("Tripwire confirmation"))} ${theme.fg("dim", `· Agent ${name}`)}`,
			"",
			`  ${theme.fg("text", `${name} wants to run a destructive operation:`)}`,
			`  ${theme.fg("muted", request.action)}`,
			`  ${theme.fg("warning", "Why this stopped:")} ${theme.fg("muted", request.reason)}`,
			"",
			`  ${theme.fg("dim", "$ ")}${theme.fg("text", request.command)}`,
			"",
			`  ${theme.fg("accent", "›")} ${theme.fg("text", "Allow this exact operation once")}`,
			`    ${theme.fg("muted", "Deny")}`,
			"",
			`  ${theme.fg("dim", "Enter allow once · Esc deny · decision is not remembered")}`,
			`  ${theme.fg("dim", `PROTOTYPE fixture only · command is never executed · resume ${state.surface.resume.kind.toUpperCase()}`)}`,
		],
		width,
	);
}

function findAgent(state: WorkAgentLifecycleState, agentId: string): LifecycleAgent | undefined {
	return state.agents.find((agent) => agent.id === agentId);
}

function joinColumns(left: string, right: string, width: number): string {
	const renderWidth = Math.max(1, width);
	const boundedRight = truncateToWidth(right, Math.max(1, Math.min(22, renderWidth)), "");
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
