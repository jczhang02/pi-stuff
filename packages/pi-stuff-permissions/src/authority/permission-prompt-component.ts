import type { ExtensionContext, ExtensionUIContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CommandDialogCoordinator, CommandDialogView } from "@jczhang02/pi-stuff-ui";
import {
	createDeniedPermissionDecision,
	type PermissionPromptDecision,
	type RequestPermissionOptions,
	requestPermissionDecisionFromUi,
} from "#src/authority/permission-dialog";
import {
	initialPromptState,
	type PromptEvent,
	type PromptKey,
	type PromptModelConfig,
	type PromptViewState,
	reducePrompt,
} from "#src/authority/permission-prompt-decision";

/** The UI methods used by the non-TUI fallback and Ctrl+O forwarding. */
export type PermissionPromptUi = Pick<ExtensionUIContext, "select" | "input" | "getToolsExpanded" | "setToolsExpanded">;

type PromptKeybindings = Pick<KeybindingsManager, "matches">;
type ExactCallEvidence = NonNullable<RequestPermissionOptions["exactCallEvidence"]>;

/** Presentation context selected once per active Pi session. */
export interface PermissionPromptView {
	ctx: ExtensionContext;
	coordinator: CommandDialogCoordinator;
	doublePressToConfirm: boolean;
}

export interface PromptPreferences {
	doublePressToConfirm: boolean;
}

/**
 * Route every TUI request through Pi Stuff's single non-floating dialog host.
 * Permission requests own a FIFO in front of that host so the active prompt can
 * show `1 of N pending` while retaining blocking preemption over BTW/Agents.
 */
export function requestPermissionDecision(
	view: PermissionPromptView,
	title: string,
	message: string,
	options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
	if (view.ctx.mode !== "tui") {
		return requestPermissionDecisionFromUi(view.ctx.ui, title, message, options);
	}
	return promptQueue(view.coordinator).request(view, title, message, options);
}

interface PromptRequest {
	readonly view: PermissionPromptView;
	readonly title: string;
	readonly message: string;
	readonly options: RequestPermissionOptions | undefined;
	resolve(decision: PermissionPromptDecision): void;
}

const QUEUES = new WeakMap<CommandDialogCoordinator, PermissionPromptQueue>();

function promptQueue(coordinator: CommandDialogCoordinator): PermissionPromptQueue {
	const existing = QUEUES.get(coordinator);
	if (existing) return existing;
	const queue = new PermissionPromptQueue(coordinator);
	QUEUES.set(coordinator, queue);
	return queue;
}

class PermissionPromptQueue {
	private readonly pending: PromptRequest[] = [];
	private activeComponent: PermissionPromptComponent | undefined;
	private draining = false;

	constructor(private readonly coordinator: CommandDialogCoordinator) {}

	request(
		view: PermissionPromptView,
		title: string,
		message: string,
		options: RequestPermissionOptions | undefined,
	): Promise<PermissionPromptDecision> {
		const promise = new Promise<PermissionPromptDecision>((resolve) => {
			this.pending.push({ view, title, message, options, resolve });
		});
		this.updatePendingCount();
		void this.drain();
		return promise;
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.pending.length > 0) {
				const request = this.pending.shift();
				if (!request) continue;
				const pendingCount = this.pending.length + 1;
				const decision = await this.present(request, pendingCount);
				request.resolve(decision);
			}
		} finally {
			this.activeComponent = undefined;
			this.draining = false;
		}
	}

	private async present(request: PromptRequest, pendingCount: number): Promise<PermissionPromptDecision> {
		const config: PromptModelConfig = {
			doublePressToConfirm: request.view.doublePressToConfirm,
			exactCallOnly: request.options?.exactCallOnly === true,
			sessionLabel: request.options?.sessionLabel ?? DEFAULT_SESSION_LABEL,
			...(request.options?.sessionScope ? { sessionScope: request.options.sessionScope } : {}),
		};
		const dialog: CommandDialogView<PermissionPromptDecision> = {
			priority: "blocking",
			create: ({ tui, theme, keybindings, close, requestRender }) => {
				const component = new PermissionPromptComponent(
					theme,
					config,
					request.title,
					request.message,
					pendingCount,
					request.options?.exactCallEvidence,
					() => (tui.terminal as { rows?: number }).rows ?? 24,
					(data) => handleToolsExpandAction(data, keybindings, request.view.ctx.ui),
					() => requestRender(),
					close,
				);
				this.activeComponent = component;
				return component;
			},
		};
		try {
			return (await this.coordinator.show(request.view.ctx, dialog)) ?? createDeniedPermissionDecision();
		} catch {
			return createDeniedPermissionDecision("The permission dialog became unavailable before a decision was made.");
		} finally {
			this.activeComponent = undefined;
		}
	}

	private updatePendingCount(): void {
		if (!this.activeComponent) return;
		this.activeComponent.setPendingCount(this.pending.length + 1);
	}
}

function handleToolsExpandAction(data: string, keybindings: PromptKeybindings, ui: PermissionPromptUi): boolean {
	if (!keybindings.matches(data, "app.tools.expand")) return false;
	ui.setToolsExpanded(!ui.getToolsExpanded());
	return true;
}

interface PromptTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

const GUTTER = "  ";
const DEFAULT_SESSION_LABEL = "Yes, for this session";
const OPTION_LABELS: Record<PromptKey, string> = {
	y: "Allow this exact call once",
	s: DEFAULT_SESSION_LABEL,
	n: "Deny",
	r: "Deny with a reason",
};
const FULL_OPTION_ORDER: readonly PromptKey[] = ["y", "s", "n", "r"];
const EXACT_OPTION_ORDER: readonly PromptKey[] = ["y", "n"];

export class PermissionPromptComponent implements Component {
	private state: PromptViewState;
	private reasonBuffer = "";
	private pendingCount: number;
	private bodyOffset = 0;
	private lastBodyRows = 1;
	private lastDocumentRows = 1;
	private reviewEnabled = false;

	constructor(
		private readonly theme: PromptTheme,
		private readonly config: PromptModelConfig,
		private readonly title: string,
		private readonly message: string,
		pendingCount: number,
		private readonly exactEvidence: ExactCallEvidence | undefined,
		private readonly getTerminalRows: () => number,
		private readonly handleAppAction: (data: string) => boolean,
		private readonly requestRender: () => void,
		private readonly done: (decision: PermissionPromptDecision) => void,
	) {
		this.state = initialPromptState(config);
		this.pendingCount = pendingCount;
	}

	setPendingCount(count: number): void {
		const normalized = Math.max(1, count);
		if (normalized === this.pendingCount) return;
		this.pendingCount = normalized;
		this.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const terminalRows = this.terminalRows();
		const panelRows = Math.min(MAX_PANEL_ROWS, terminalRows);
		const minimumRows = this.minimumReviewRows(width);
		const canReview = width >= MIN_REVIEW_WIDTH && panelRows >= minimumRows;
		if (!canReview) {
			this.reviewEnabled = false;
			return this.renderResizeRequired(width, panelRows, minimumRows);
		}

		if (!this.reviewEnabled) this.bodyOffset = 0;
		this.reviewEnabled = true;
		return this.renderStep(width, panelRows).slice(0, panelRows);
	}

	handleInput(data: string): void {
		if (!this.reviewEnabled) {
			if (matchesKey(data, "escape")) {
				this.done(createDeniedPermissionDecision());
			}
			return;
		}
		if (this.handleViewportInput(data)) return;
		if (this.state.step === "reason") {
			this.handleReasonInput(data);
			return;
		}
		if (this.handleAppAction(data)) return;
		const event = this.toEvent(data);
		if (event) this.apply(event);
	}

	private renderStep(width: number, panelRows: number): string[] {
		switch (this.state.step) {
			case "decision":
				return this.renderDecision(width, panelRows);
			case "reason":
				return this.renderReason(width, panelRows);
			case "scope":
				return this.renderScope(width, panelRows);
		}
	}

	private minimumReviewRows(width: number): number {
		const baseline = this.config.exactCallOnly ? 8 : 10;
		if (this.state.step !== "decision") return baseline;
		const feedbackRows = this.state.hint ? packHintLines(width, [this.state.hint]).length : 0;
		const actionRows = packHintLines(width, ["↑/↓ choose", "Enter confirm", "Esc deny"]).length;
		return Math.max(baseline, 4 + this.optionOrder().length + feedbackRows + actionRows);
	}

	private handleViewportInput(data: string): boolean {
		const page = Math.max(1, this.lastBodyRows - 1);
		const maximum = Math.max(0, this.lastDocumentRows - this.lastBodyRows);
		let next: number | undefined;
		if (matchesKey(data, "pageUp")) next = this.bodyOffset - page;
		if (matchesKey(data, "pageDown")) next = this.bodyOffset + page;
		if (matchesKey(data, "home")) next = 0;
		if (matchesKey(data, "end")) next = maximum;
		if (next === undefined) return false;
		this.bodyOffset = Math.max(0, Math.min(maximum, next));
		this.requestRender();
		return true;
	}

	private handleReasonInput(data: string): void {
		if (matchesKey(data, "enter")) {
			this.apply({ type: "submitReason", draft: this.reasonBuffer });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.reasonBuffer = "";
			this.apply({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.reasonBuffer = this.reasonBuffer.slice(0, -1);
			this.requestRender();
			return;
		}
		if (isPrintable(data)) {
			this.reasonBuffer += data;
			this.requestRender();
		}
	}

	private toEvent(data: string): PromptEvent | undefined {
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			return { type: "nav", direction: "up" };
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			return { type: "nav", direction: "down" };
		}
		if (matchesKey(data, "enter")) return { type: "confirm" };
		if (matchesKey(data, "escape")) return { type: "cancel" };
		if (this.state.step !== "decision") return undefined;
		const key = this.optionOrder().find((option) => matchesKey(data, option));
		return key ? { type: "hotkey", key } : undefined;
	}

	private apply(event: PromptEvent): void {
		const previousStep = this.state.step;
		const outcome = reducePrompt(this.config, this.state, event);
		if (outcome.kind === "decision") {
			this.done(outcome.decision);
			return;
		}
		if (outcome.state.step === "reason" && this.state.step !== "reason") {
			this.reasonBuffer = "";
		}
		this.state = outcome.state;
		if (this.state.step !== previousStep) this.bodyOffset = 0;
		this.requestRender();
	}

	private renderDecision(width: number, panelRows: number): string[] {
		const optionOrder = this.optionOrder();
		const roomy = panelRows >= 12;
		const spacerCount = roomy ? 3 : 0;
		const footer = [
			...(this.state.hint ? hintLines(this.theme, width, [this.state.hint], "warning") : []),
			...hintLines(this.theme, width, ["↑/↓ choose", "Enter confirm", "Esc deny"]),
		];
		const bodyRows = Math.max(1, panelRows - (optionOrder.length + 3 + spacerCount + footer.length));
		const viewport = this.renderEvidenceViewport(width, bodyRows);
		const suffix = this.pendingCount > 1 ? ` · 1 of ${this.pendingCount} pending` : "";
		const lines = [
			this.theme.fg("border", "─".repeat(width)),
			`${GUTTER}${this.theme.fg("text", this.theme.bold(sanitizeTerminalInline(this.title)))}${this.theme.fg("dim", suffix)}`,
		];
		if (roomy) lines.push("");
		lines.push(...viewport.lines);
		lines.push(`${GUTTER}${this.theme.fg("dim", viewport.indicator)}`);
		if (roomy) lines.push("");
		for (const key of optionOrder) {
			const label = key === "s" ? this.config.sessionLabel : OPTION_LABELS[key];
			const selected = this.state.highlightedKey === key;
			const row = `${GUTTER}${selected ? "›" : " "} (${key}) ${sanitizeTerminalInline(label)}`;
			lines.push(selected ? this.theme.fg("accent", row) : row);
		}
		if (roomy) lines.push("");
		lines.push(...footer);
		return fitScreen(lines, width);
	}

	private renderReason(width: number, panelRows: number): string[] {
		const roomy = panelRows >= 12;
		const errorRows = this.state.reasonError ? 1 : 0;
		const spacerCount = roomy ? 3 : 0;
		const footer = hintLines(this.theme, width, ["Enter submit", "Esc back"]);
		const bodyRows = Math.max(1, panelRows - (4 + errorRows + spacerCount + footer.length));
		const viewport = this.renderEvidenceViewport(width, bodyRows);
		const lines = [
			this.theme.fg("border", "─".repeat(width)),
			`${GUTTER}${this.theme.fg("text", this.theme.bold(sanitizeTerminalInline(this.title)))}`,
		];
		if (roomy) lines.push("");
		lines.push(...viewport.lines);
		lines.push(`${GUTTER}${this.theme.fg("dim", viewport.indicator)}`);
		if (roomy) lines.push("");
		lines.push(`${GUTTER}Reason (required): ${sanitizeTerminalInline(this.reasonBuffer)}\u2588`);
		if (this.state.reasonError) {
			lines.push(`${GUTTER}${this.theme.fg("error", this.state.reasonError)}`);
		}
		if (roomy) lines.push("");
		lines.push(...footer);
		return fitScreen(lines, width);
	}

	private renderScope(width: number, panelRows: number): string[] {
		const scope = this.config.sessionScope;
		const rows: Array<{ label: string; serving: boolean }> = [
			{ label: scope?.subagentLabel ?? "This subagent only", serving: false },
			{ label: scope?.servingSessionLabel ?? "The whole session", serving: true },
		];
		const lines = [
			this.theme.fg("border", "─".repeat(width)),
			`${GUTTER}${this.theme.fg("text", this.theme.bold(sanitizeTerminalInline(this.title)))}`,
			`${GUTTER}Apply this session grant to:`,
			"",
		];
		for (const row of rows) {
			const selected = this.state.scopeServing === row.serving;
			const text = `${GUTTER}${selected ? "›" : " "} ${sanitizeTerminalInline(row.label)}`;
			lines.push(selected ? this.theme.fg("accent", text) : text);
		}
		lines.push("", ...hintLines(this.theme, width, ["↑/↓ navigate", "Enter confirm", "Esc back"]));
		return fitScreen(lines, width).slice(0, panelRows);
	}

	private optionOrder(): readonly PromptKey[] {
		return this.config.exactCallOnly ? EXACT_OPTION_ORDER : FULL_OPTION_ORDER;
	}

	private renderEvidenceViewport(width: number, bodyRows: number): { lines: string[]; indicator: string } {
		const contentWidth = Math.max(1, width - GUTTER.length);
		const wrapped = this.evidenceDocument().flatMap((line) => {
			const lineParts = wrapTextWithAnsi(line, contentWidth);
			const visibleParts = lineParts.length > 0 ? lineParts : [""];
			return visibleParts.map((part) => `${GUTTER}${part}`);
		});
		const documentLines = wrapped.length > 0 ? wrapped : [GUTTER];
		this.lastBodyRows = bodyRows;
		this.lastDocumentRows = documentLines.length;
		const maximum = Math.max(0, documentLines.length - bodyRows);
		this.bodyOffset = Math.max(0, Math.min(maximum, this.bodyOffset));
		const visible = documentLines.slice(this.bodyOffset, this.bodyOffset + bodyRows);
		while (visible.length < bodyRows) visible.push("");
		const start = this.bodyOffset + 1;
		const end = Math.min(documentLines.length, this.bodyOffset + bodyRows);
		return {
			lines: visible,
			indicator: `Evidence ${start}–${end} of ${documentLines.length} · PgUp/PgDn`,
		};
	}

	private evidenceDocument(): string[] {
		if (!this.exactEvidence) {
			return sanitizeTerminalText(this.message).split("\n");
		}
		const evidence = this.exactEvidence;
		const command = sanitizeTerminalText(evidence.command).split("\n");
		const targets =
			evidence.targets.length > 0
				? evidence.targets.map((target) => `  - ${sanitizeTerminalText(target)}`)
				: ["  - none"];
		return [
			`Requester: ${sanitizeTerminalText(evidence.requester)}`,
			"Exact call:",
			...command.map((line, index) => `${index === 0 ? "$ " : "  "}${line}`),
			`Why stopped: ${sanitizeTerminalText(evidence.reason)}`,
			`Operation: ${sanitizeTerminalText(evidence.operation)}`,
			`Working directory: ${sanitizeTerminalText(evidence.cwd)}`,
			"Targets:",
			...targets,
		];
	}

	private renderResizeRequired(width: number, panelRows: number, minimumRows: number): string[] {
		if (width <= 0 || panelRows <= 0) return [];
		const lines = [
			this.theme.fg("border", "─".repeat(width)),
			`${GUTTER}${this.theme.bold("Permission review paused")}`,
			`${GUTTER}Terminal too small to review safely.`,
			`${GUTTER}Resize to at least ${MIN_REVIEW_WIDTH} columns × ${minimumRows} rows.`,
			...hintLines(this.theme, width, ["Esc deny"]),
		];
		return fitScreen(lines, width).slice(0, panelRows);
	}

	private terminalRows(): number {
		try {
			const rows = Math.floor(this.getTerminalRows());
			return Number.isFinite(rows) ? Math.max(0, rows) : 24;
		} catch {
			return 24;
		}
	}
}

function fitScreen(lines: string[], width: number): string[] {
	return lines.map((line) => truncateToWidth(line, Math.max(1, width)));
}

function hintLines(theme: PromptTheme, width: number, hints: readonly string[], color = "dim"): string[] {
	return packHintLines(width, hints).map((line) => `${GUTTER}${theme.fg(color, line)}`);
}

function packHintLines(width: number, hints: readonly string[]): string[] {
	const available = Math.max(1, width - GUTTER.length);
	const lines: string[] = [];
	let current = "";
	for (const hint of hints) {
		const safeHint = sanitizeTerminalInline(hint).trim();
		if (!safeHint) continue;
		const candidate = current ? `${current} · ${safeHint}` : safeHint;
		if (current && visibleWidth(candidate) > available) {
			lines.push(current);
			current = "";
		}
		if (visibleWidth(safeHint) <= available) {
			current = current ? `${current} · ${safeHint}` : safeHint;
			continue;
		}
		const wrapped = wrapTextWithAnsi(safeHint, available);
		lines.push(...wrapped.slice(0, -1));
		current = wrapped.at(-1) ?? "";
	}
	if (current) lines.push(current);
	return lines;
}

/** Make terminal control and direction-changing characters visible as text. */
export function sanitizeTerminalText(value: string): string {
	let result = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint === 0x0a) {
			result += "\n";
		} else if (codePoint === 0x09) {
			result += "  ";
		} else if (
			codePoint < 0x20 ||
			(codePoint >= 0x7f && codePoint <= 0x9f) ||
			codePoint === 0x061c ||
			(codePoint >= 0x200b && codePoint <= 0x200f) ||
			(codePoint >= 0x202a && codePoint <= 0x202e) ||
			(codePoint >= 0x2066 && codePoint <= 0x2069)
		) {
			result +=
				codePoint <= 0xff
					? `\\x${codePoint.toString(16).toUpperCase().padStart(2, "0")}`
					: `\\u{${codePoint.toString(16).toUpperCase()}}`;
		} else {
			result += character;
		}
	}
	return result;
}

function sanitizeTerminalInline(value: string): string {
	return sanitizeTerminalText(value).replaceAll("\n", "\\n");
}

const MIN_REVIEW_WIDTH = 32;
const MAX_PANEL_ROWS = 24;

function isPrintable(data: string): boolean {
	if (data.length !== 1) return false;
	const code = data.charCodeAt(0);
	return code >= 0x20 && code !== 0x7f;
}
