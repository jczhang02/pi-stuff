import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	isKeyRelease,
	Key,
	matchesKey,
	parseKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type {
	CommandDialogComponent,
	CommandDialogCoordinator,
	CommandDialogView,
	CommandDialogViewContext,
} from "@jczhang02/pi-stuff-ui";
import type {
	AgentControlAction,
	AgentControlResult,
	AgentRow,
	AgentSessionSnapshot,
	AgentStatus,
	CurrentAgents,
} from "../session/current-agents.js";

const GUTTER = "  ";
const NARROW_WIDTH = 64;
const DEFAULT_TRANSCRIPT_CHARS = 24_000;
const MAX_TRANSCRIPT_CHARS = 64_000;
const INPUT_CHAR_LIMIT = 4_000;
const LIST_ROWS = 8;
const NARROW_LIST_ROWS = 6;
const DETAIL_ROWS = 10;
const NARROW_DETAIL_ROWS = 6;

const TERMINAL_STATUSES = new Set<AgentStatus>(["agent_stopped", "completed", "crashed", "failed", "user_cancelled"]);
const RESUMABLE_STATUSES = new Set<AgentStatus>(["agent_stopped", "completed", "crashed", "failed"]);

export interface AgentTranscriptRequest {
	readonly maxChars: number;
	readonly row: AgentRow;
	readonly signal: AbortSignal;
}

/** The reader should use maxChars to bound file I/O before returning text. */
export type AgentTranscriptReader = (request: AgentTranscriptRequest) => Promise<string | null> | string | null;

export interface AgentDialogOptions {
	readonly initialKey?: string;
	readonly maxTranscriptChars?: number;
	readonly readTranscript: AgentTranscriptReader;
}

type DialogMode = "detail" | "list" | "resume-input" | "steer-input";
type FeedbackKind = "error" | "pending" | "success";
type TranscriptState = "error" | "loading" | "ready" | "unavailable";

interface Feedback {
	readonly kind: FeedbackKind;
	readonly message: string;
}

interface Transcript {
	readonly state: TranscriptState;
	readonly text: string;
}

/** Create the normal-priority, non-overlay view used by `/agents` and roster Enter. */
export function createAgentDialogView(current: CurrentAgents, options: AgentDialogOptions): CommandDialogView<void> {
	const maxTranscriptChars = normalizeTranscriptLimit(options.maxTranscriptChars);
	return {
		priority: "normal",
		create: (context) =>
			new AgentDialogComponent(current, context, {
				initialKey: options.initialKey,
				maxTranscriptChars,
				readTranscript: options.readTranscript,
			}),
	};
}

/** Open the shared full-width surface; the coordinator owns editor/chrome restoration. */
export function openAgentDialog(
	ctx: ExtensionContext,
	coordinator: CommandDialogCoordinator,
	current: CurrentAgents,
	options: AgentDialogOptions,
): Promise<void> {
	return coordinator.show(ctx, createAgentDialogView(current, options)).then(() => undefined);
}

interface NormalizedOptions {
	readonly initialKey: string | undefined;
	readonly maxTranscriptChars: number;
	readonly readTranscript: AgentTranscriptReader;
}

class AgentDialogComponent implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private readonly current: CurrentAgents;
	private disposed = false;
	private feedback: Feedback | undefined;
	private input = "";
	private listSelectedKey: string | undefined;
	private mode: DialogMode = "list";
	private operationGeneration = 0;
	private operationPending = false;
	private scrollOffset = 0;
	private selectedKey: string | undefined;
	private snapshotValue: AgentSessionSnapshot;
	private transcript: Transcript = { state: "unavailable", text: "" };
	private transcriptGeneration = 0;
	private readonly options: NormalizedOptions;
	private readonly unsubscribe: () => void;

	constructor(current: CurrentAgents, context: CommandDialogViewContext<void>, options: NormalizedOptions) {
		this.context = context;
		this.current = current;
		this.options = options;
		this.snapshotValue = current.snapshot();
		this.listSelectedKey = this.snapshotValue.rows[0]?.key;
		const initial = options.initialKey
			? this.snapshotValue.rows.find((row) => row.key === options.initialKey)
			: undefined;
		if (initial) {
			this.mode = "detail";
			this.selectedKey = initial.key;
			this.listSelectedKey = initial.key;
		}

		this.unsubscribe = current.subscribe((snapshot) => this.updateSnapshot(snapshot));
		if (initial) this.loadTranscript(initial);
	}

	handleInput(data: string): void {
		if (this.disposed || isKeyRelease(data)) return;
		if (this.mode === "resume-input" || this.mode === "steer-input") {
			this.handleComposerInput(data);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			if (this.mode === "detail") this.showList();
			else this.context.close();
			return;
		}

		if (this.mode === "list") this.handleListInput(data);
		else this.handleDetailInput(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const lines =
			this.mode === "list"
				? this.renderList(renderWidth)
				: this.mode === "detail"
					? this.renderDetail(renderWidth)
					: this.renderComposer(renderWidth);
		return lines.map((line) => truncateToWidth(line, renderWidth, ""));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.operationGeneration += 1;
		this.transcriptGeneration += 1;
		this.unsubscribe();
	}

	private updateSnapshot(snapshot: AgentSessionSnapshot): void {
		if (this.disposed) return;
		this.snapshotValue = snapshot;
		this.reconcileListSelection();
		if (this.selectedKey && !snapshot.rows.some((row) => row.key === this.selectedKey)) {
			this.mode = "list";
			this.selectedKey = undefined;
			this.input = "";
			this.scrollOffset = 0;
			this.transcriptGeneration += 1;
			this.transcript = { state: "unavailable", text: "" };
			if (!this.operationPending) {
				this.feedback = { kind: "success", message: "Agent left the current-session list." };
			}
		}
		this.requestRender();
	}

	private reconcileListSelection(): void {
		const rows = this.snapshotValue.rows;
		if (this.listSelectedKey && rows.some((row) => row.key === this.listSelectedKey)) return;
		this.listSelectedKey = rows[0]?.key;
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
			const rows = this.snapshotValue.rows;
			if (rows.length === 0) return;
			const currentIndex = Math.max(
				0,
				rows.findIndex((row) => row.key === this.listSelectedKey),
			);
			const delta = matchesKey(data, Key.up) ? -1 : 1;
			const nextIndex = Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
			this.listSelectedKey = rows[nextIndex]?.key;
			if (!this.operationPending) this.feedback = undefined;
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const row = this.listRow();
			if (row) this.showDetail(row);
			return;
		}
		if (decodePrintable(data)?.toLowerCase() === "x") {
			const row = this.listRow();
			if (row) this.stopOrDismiss(row);
		}
	}

	private handleDetailInput(data: string): void {
		if (
			matchesKey(data, Key.up) ||
			matchesKey(data, Key.down) ||
			matchesKey(data, "pageUp") ||
			matchesKey(data, "pageDown")
		) {
			const page = this.detailViewportRows();
			const delta = matchesKey(data, Key.up)
				? -1
				: matchesKey(data, Key.down)
					? 1
					: matchesKey(data, "pageUp")
						? -page
						: page;
			this.scrollOffset = Math.max(0, this.scrollOffset + delta);
			this.requestRender();
			return;
		}

		const row = this.detailRow();
		if (!row) {
			this.showList();
			return;
		}
		const printable = decodePrintable(data)?.toLowerCase();
		if (this.operationPending) return;
		if (printable === "x") {
			this.stopOrDismiss(row);
			return;
		}
		if (printable === "s" && !TERMINAL_STATUSES.has(row.status) && row.status !== "stopping") {
			this.mode = "steer-input";
			this.input = "";
			this.feedback = undefined;
			this.requestRender();
			return;
		}
		if (printable === "r" && RESUMABLE_STATUSES.has(row.status)) {
			this.mode = "resume-input";
			this.input = "";
			this.feedback = undefined;
			this.requestRender();
		}
	}

	private handleComposerInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.mode = "detail";
			this.input = "";
			this.feedback = undefined;
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const row = this.detailRow();
			if (!row) {
				this.showList();
				return;
			}
			const message = this.input.trim();
			if (this.mode === "steer-input" && message.length === 0) {
				this.feedback = { kind: "error", message: "Enter a steering message." };
				this.requestRender();
				return;
			}
			const action: AgentControlAction =
				this.mode === "steer-input"
					? { type: "steer", key: row.key, message }
					: message
						? { type: "resume", key: row.key, message }
						: { type: "resume", key: row.key };
			this.mode = "detail";
			this.input = "";
			this.runControl(action);
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.input = Array.from(this.input).slice(0, -1).join("");
			this.feedback = undefined;
			this.requestRender();
			return;
		}
		const printable = decodePrintable(data);
		if (printable === undefined || this.input.length >= INPUT_CHAR_LIMIT) return;
		const safeInput = stripTerminalControls(printable);
		if (!safeInput) return;
		this.input = `${this.input}${safeInput}`.slice(0, INPUT_CHAR_LIMIT);
		this.feedback = undefined;
		this.requestRender();
	}

	private stopOrDismiss(row: AgentRow): void {
		const type = TERMINAL_STATUSES.has(row.status) ? "dismiss-terminal" : "stop";
		this.runControl({ type, key: row.key });
	}

	private runControl(action: Exclude<AgentControlAction, { type: "inspect" }>): void {
		if (this.operationPending || this.disposed) return;
		this.operationPending = true;
		const generation = ++this.operationGeneration;
		this.feedback = { kind: "pending", message: pendingMessage(action.type) };
		this.requestRender();

		void Promise.resolve()
			.then(() => this.current.control(action))
			.then((result) => this.finishControl(generation, result))
			.catch((error) => {
				if (!this.canFinishOperation(generation)) return;
				this.operationPending = false;
				this.feedback = {
					kind: "error",
					message: `Request failed: ${oneLine(errorMessage(error)) || "unknown error"}`,
				};
				this.requestRender();
			});
	}

	private finishControl(generation: number, result: AgentControlResult): void {
		if (!this.canFinishOperation(generation)) return;
		this.operationPending = false;
		this.feedback = {
			kind: result.acknowledged ? "success" : "error",
			message: result.acknowledged
				? `Acknowledged: ${oneLine(result.message) || "request accepted"}`
				: `Not acknowledged: ${oneLine(result.message) || "request rejected"}`,
		};
		this.requestRender();
	}

	private canFinishOperation(generation: number): boolean {
		return !this.disposed && generation === this.operationGeneration;
	}

	private showList(): void {
		if (this.selectedKey) this.listSelectedKey = this.selectedKey;
		this.mode = "list";
		this.selectedKey = undefined;
		this.input = "";
		this.scrollOffset = 0;
		this.transcriptGeneration += 1;
		this.transcript = { state: "unavailable", text: "" };
		if (!this.operationPending) this.feedback = undefined;
		this.reconcileListSelection();
		this.requestRender();
	}

	private showDetail(row: AgentRow): void {
		this.mode = "detail";
		this.selectedKey = row.key;
		this.listSelectedKey = row.key;
		this.scrollOffset = 0;
		if (!this.operationPending) this.feedback = undefined;
		this.loadTranscript(row);
		this.requestRender();
	}

	private loadTranscript(row: AgentRow): void {
		const generation = ++this.transcriptGeneration;
		this.transcript = { state: "loading", text: "" };
		void Promise.resolve()
			.then(() =>
				this.options.readTranscript({
					maxChars: this.options.maxTranscriptChars,
					row,
					signal: this.context.signal,
				}),
			)
			.then((value) => {
				if (!this.canFinishTranscript(generation, row.key)) return;
				const text = typeof value === "string" ? boundedTerminalText(value, this.options.maxTranscriptChars) : "";
				const partial = row.partialResult
					? boundedTerminalText(row.partialResult, Math.min(this.options.maxTranscriptChars, 4_000))
					: "";
				this.transcript =
					text && text.trim() !== partial.trim() ? { state: "ready", text } : { state: "unavailable", text: "" };
				this.scrollOffset = 0;
				this.requestRender();
			})
			.catch((error) => {
				if (!this.canFinishTranscript(generation, row.key)) return;
				this.transcript = {
					state: "error",
					text: `Unable to read transcript: ${oneLine(errorMessage(error))}`,
				};
				this.scrollOffset = 0;
				this.requestRender();
			});
	}

	private canFinishTranscript(generation: number, key: string): boolean {
		return !this.disposed && generation === this.transcriptGeneration && this.selectedKey === key;
	}

	private listRow(): AgentRow | undefined {
		return this.snapshotValue.rows.find((row) => row.key === this.listSelectedKey);
	}

	private detailRow(): AgentRow | undefined {
		return this.snapshotValue.rows.find((row) => row.key === this.selectedKey);
	}

	private renderList(width: number): string[] {
		const rows = this.snapshotValue.rows;
		const limit = width <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		const window = selectedWindow(rows, this.listSelectedKey, limit);
		const lines = [divider(this.context.theme, width), title(this.context.theme, "Agents")];
		if (this.feedback) lines.push(renderFeedback(this.context.theme, this.feedback, width));
		lines.push("");
		if (rows.length === 0) {
			lines.push(`${GUTTER}${this.context.theme.fg("muted", "No Agents in the current session.")}`);
		} else {
			if (window.start > 0) lines.push(`${GUTTER}${this.context.theme.fg("dim", `… ${window.start} earlier`)}`);
			for (const row of window.rows) lines.push(this.renderListRow(row, width));
			const later = rows.length - window.start - window.rows.length;
			if (later > 0) lines.push(`${GUTTER}${this.context.theme.fg("dim", `… ${later} later`)}`);
		}
		const hints = ["↑/↓ navigate", "Enter inspect"];
		const selected = this.listRow();
		if (selected) hints.push(TERMINAL_STATUSES.has(selected.status) ? "x dismiss" : "x stop");
		hints.push("Esc close");
		lines.push("", ...hintLines(this.context.theme, width, hints));
		return lines;
	}

	private renderListRow(row: AgentRow, width: number): string {
		const theme = this.context.theme;
		const selected = row.key === this.listSelectedKey;
		const prefix = `${GUTTER}${selected ? theme.fg("accent", "› ") : "  "}`;
		const name = oneLine(row.name) || "agent";
		const task = oneLine(row.task);
		const state = styledStatus(row, theme);
		const rightWidth = visibleWidth(state);
		const contentWidth = Math.max(1, width - visibleWidth(prefix) - rightWidth - 3);
		const nameBudget = Math.min(Math.max(8, Math.floor(contentWidth * 0.38)), contentWidth);
		const renderedName = truncateToWidth(name, nameBudget, "…");
		const remaining = Math.max(0, contentWidth - visibleWidth(renderedName) - 2);
		const renderedTask = remaining > 0 ? truncateToWidth(task, remaining, "…") : "";
		const left = `${prefix}${selected ? theme.fg("text", renderedName) : theme.fg("muted", renderedName)}${
			renderedTask ? `  ${theme.fg("dim", renderedTask)}` : ""
		}`;
		const gap = Math.max(1, width - visibleWidth(left) - rightWidth);
		return `${left}${" ".repeat(gap)}${state}`;
	}

	private renderDetail(width: number): string[] {
		const row = this.detailRow();
		if (!row) return this.renderList(width);
		const theme = this.context.theme;
		const lines = [divider(theme, width), title(theme, `Agents / ${oneLine(row.name) || "agent"}`), ""];
		lines.push(`${GUTTER}${theme.fg("muted", "Task")}`);
		lines.push(
			`${GUTTER}${truncateToWidth(oneLine(row.task) || "(no task)", Math.max(1, width - GUTTER.length), "…")}`,
		);
		lines.push(
			`${GUTTER}${theme.fg("muted", "State")}  ${styledStatus(row, theme, true)}${theme.fg(
				"dim",
				` · ${row.nestedCount} nested`,
			)}`,
		);
		if (this.feedback) lines.push(renderFeedback(theme, this.feedback, width));
		lines.push("", `${GUTTER}${theme.fg("muted", "Transcript")}`);
		lines.push(...this.renderScrollableContent(row, width));
		lines.push("", ...this.renderDetailFooter(row, width));
		return lines;
	}

	private renderScrollableContent(row: AgentRow, width: number): string[] {
		const theme = this.context.theme;
		const contentWidth = Math.max(1, width - GUTTER.length);
		const allLines: string[] = [];
		switch (this.transcript.state) {
			case "loading":
				allLines.push(theme.fg("dim", "Loading transcript…"));
				break;
			case "unavailable":
				allLines.push(theme.fg("dim", "Transcript unavailable."));
				break;
			case "error":
				allLines.push(theme.fg("error", truncateToWidth(this.transcript.text, contentWidth, "…")));
				break;
			case "ready":
				allLines.push(...transcriptLines(this.transcript.text, contentWidth));
				break;
		}
		if (row.partialResult) {
			const partial = boundedTerminalText(row.partialResult, Math.min(this.options.maxTranscriptChars, 4_000));
			allLines.push("", theme.fg("muted", "Partial result"), ...transcriptLines(partial, contentWidth));
		}
		const viewport = width <= NARROW_WIDTH ? NARROW_DETAIL_ROWS : DETAIL_ROWS;
		const maxOffset = Math.max(0, allLines.length - viewport);
		this.scrollOffset = Math.min(maxOffset, Math.max(0, this.scrollOffset));
		const visible = allLines.slice(this.scrollOffset, this.scrollOffset + viewport);
		const result = visible.map((line) => `${GUTTER}${line || " "}`);
		if (this.scrollOffset > 0) result[0] = `${GUTTER}${theme.fg("dim", `… ${this.scrollOffset} earlier lines`)}`;
		const later = allLines.length - this.scrollOffset - visible.length;
		if (later > 0 && result.length > 0)
			result[result.length - 1] = `${GUTTER}${theme.fg("dim", `… ${later} later lines`)}`;
		return result;
	}

	private renderDetailFooter(row: AgentRow, width: number): string[] {
		const actions = ["↑/↓ scroll"];
		if (!TERMINAL_STATUSES.has(row.status) && row.status !== "stopping") actions.push("s steer");
		if (RESUMABLE_STATUSES.has(row.status)) actions.push("r resume");
		actions.push(TERMINAL_STATUSES.has(row.status) ? "x dismiss" : "x stop", "Esc back");
		return hintLines(this.context.theme, width, actions);
	}

	private renderComposer(width: number): string[] {
		const row = this.detailRow();
		if (!row) return this.renderList(width);
		const theme = this.context.theme;
		const resume = this.mode === "resume-input";
		const lines = [
			divider(theme, width),
			title(theme, `Agents / ${oneLine(row.name) || "agent"}`),
			"",
			`${GUTTER}${theme.fg("muted", resume ? "Resume message (optional)" : "Steer Agent")}`,
			`${GUTTER}${theme.fg("accent", "›")} ${this.input || theme.fg("dim", resume ? "Continue the task…" : "Send new guidance…")}`,
		];
		if (this.feedback) lines.push(renderFeedback(theme, this.feedback, width));
		lines.push("", ...hintLines(theme, width, [`Enter ${resume ? "resume" : "send"}`, "Esc cancel"]));
		return lines;
	}

	private detailViewportRows(): number {
		const columns = (this.context.tui.terminal as { columns?: number }).columns;
		return typeof columns === "number" && columns <= NARROW_WIDTH ? NARROW_DETAIL_ROWS : DETAIL_ROWS;
	}

	private requestRender(): void {
		if (!this.disposed) this.context.requestRender();
	}
}

function normalizeTranscriptLimit(value: number | undefined): number {
	if (value === undefined) return DEFAULT_TRANSCRIPT_CHARS;
	if (!Number.isFinite(value) || value <= 0) throw new Error("maxTranscriptChars must be a positive finite number");
	return Math.min(MAX_TRANSCRIPT_CHARS, Math.max(1, Math.floor(value)));
}

function selectedWindow(
	rows: readonly AgentRow[],
	selectedKey: string | undefined,
	limit: number,
): { readonly rows: readonly AgentRow[]; readonly start: number } {
	if (rows.length <= limit) return { rows, start: 0 };
	const selectedIndex = Math.max(
		0,
		rows.findIndex((row) => row.key === selectedKey),
	);
	const start = Math.min(rows.length - limit, Math.max(0, selectedIndex - Math.floor(limit / 2)));
	return { rows: rows.slice(start, start + limit), start };
}

function divider(theme: Theme, width: number): string {
	return theme.fg("border", "─".repeat(width));
}

function title(theme: Theme, value: string): string {
	return `${GUTTER}${theme.fg("text", theme.bold(value))}`;
}

function renderFeedback(theme: Theme, feedback: Feedback, width: number): string {
	const color = feedback.kind === "error" ? "error" : feedback.kind === "success" ? "success" : "warning";
	return truncateToWidth(`${GUTTER}${theme.fg(color, feedback.message)}`, width, "…");
}

function hintLines(theme: Theme, width: number, hints: readonly string[]): string[] {
	const available = Math.max(1, width - visibleWidth(GUTTER));
	const lines: string[] = [];
	let current = "";
	for (const hint of hints) {
		const safeHint = oneLine(hint);
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
	if (lines.length === 0) lines.push("Esc close");
	return lines.map((line) => `${GUTTER}${theme.fg("dim", line)}`);
}

function styledStatus(row: AgentRow, theme: Theme, detailed = false): string {
	const elapsed = elapsedText(row);
	const suffix = elapsed ? ` · ${elapsed}` : "";
	switch (row.status) {
		case "queued":
			return theme.fg("warning", `queued${suffix}`);
		case "waiting_permission":
			return theme.fg("warning", `permission${suffix}`);
		case "waiting_supervisor":
			return theme.fg("warning", `waiting${suffix}`);
		case "stopping":
			return theme.fg("warning", `stopping${suffix}`);
		case "resuming":
			return theme.fg("warning", `resuming${suffix}`);
		case "completed":
			return theme.fg("success", `done${suffix}`);
		case "failed":
			return theme.fg("error", `failed${suffix}`);
		case "crashed":
			return theme.fg("error", `crashed${suffix}`);
		case "agent_stopped":
			return theme.fg("muted", `stopped${suffix}`);
		case "user_cancelled":
			return theme.fg("muted", `cancelled${suffix}`);
		case "running":
			return theme.fg("dim", detailed ? `running${suffix}` : elapsed || "running");
	}
}

function elapsedText(row: AgentRow): string {
	const value = row.elapsedMs;
	if (typeof value !== "number" || !Number.isFinite(value)) return "";
	const seconds = Math.max(0, Math.floor(value / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function pendingMessage(type: Exclude<AgentControlAction, { type: "inspect" }>["type"]): string {
	switch (type) {
		case "dismiss-terminal":
			return "Dismissing… waiting for acknowledgement.";
		case "resume":
			return "Resuming… waiting for acknowledgement.";
		case "steer":
			return "Sending guidance… waiting for acknowledgement.";
		case "stop":
			return "Stopping… waiting for acknowledgement.";
	}
}

function transcriptLines(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => (line ? wrapTextWithAnsi(line, width) : [""]));
}

function oneLine(value: string): string {
	return boundedTerminalText(value, Math.max(1, value.length)).replace(/\s+/g, " ").trim();
}

function boundedTerminalText(value: string, limit: number): string {
	const scanLimit = Math.min(value.length, Math.max(limit, limit * 4));
	const sanitized = stripTerminalControls(value.slice(0, scanLimit));
	if (sanitized.length <= limit && scanLimit >= value.length) return sanitized;
	return `${sanitized.slice(0, Math.max(0, limit - 1))}…`;
}

function stripTerminalControls(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 27) {
			const next = value.charCodeAt(index + 1);
			if (next === 91) {
				index += 2;
				while (index < value.length && !isAnsiFinal(value.charCodeAt(index))) index += 1;
				continue;
			}
			if (next === 93 || next === 80 || next === 88 || next === 94 || next === 95) {
				index = skipStringControl(value, index + 2, next === 93);
				continue;
			}
			index += 1;
			continue;
		}
		if (code === 155) {
			index += 1;
			while (index < value.length && !isAnsiFinal(value.charCodeAt(index))) index += 1;
			continue;
		}
		if (code === 157 || code === 144 || code === 152 || code === 158 || code === 159) {
			index = skipC1StringControl(value, index + 1, code === 157);
			continue;
		}
		if (code === 13) {
			if (value.charCodeAt(index + 1) !== 10) result += "\n";
			continue;
		}
		if (code === 10) {
			result += "\n";
			continue;
		}
		if (code === 9) {
			result += "    ";
			continue;
		}
		if (code < 32 || (code >= 127 && code <= 159) || isBidiControl(code)) continue;
		result += value[index] ?? "";
	}
	return result;
}

function skipStringControl(value: string, start: number, allowBell: boolean): number {
	for (let index = start; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (allowBell && code === 7) return index;
		if (code === 27 && value.charCodeAt(index + 1) === 92) return index + 1;
	}
	return value.length;
}

function skipC1StringControl(value: string, start: number, allowBell: boolean): number {
	for (let index = start; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if ((allowBell && code === 7) || code === 156) return index;
		if (code === 27 && value.charCodeAt(index + 1) === 92) return index + 1;
	}
	return value.length;
}

function isAnsiFinal(code: number): boolean {
	return code >= 64 && code <= 126;
}

function isBidiControl(code: number): boolean {
	return (
		code === 1564 ||
		code === 8206 ||
		code === 8207 ||
		(code >= 8234 && code <= 8238) ||
		(code >= 8294 && code <= 8297)
	);
}

function decodePrintable(data: string): string | undefined {
	const kittyPrintable = decodeKittyPrintable(data);
	if (kittyPrintable !== undefined) return kittyPrintable;
	const parsed = parseKey(data);
	if (parsed !== undefined && [...parsed].length === 1) return parsed;
	if ([...data].length !== 1) return undefined;
	const codePoint = data.codePointAt(0);
	return codePoint !== undefined && codePoint >= 32 && codePoint !== 127 ? data : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
