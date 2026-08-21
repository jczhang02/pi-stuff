import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	isKeyRelease,
	Key,
	type Markdown,
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
} from "../../../conversation-ui/index.js";
import {
	commandDialogListIndex,
	commandDialogListKeyHelp,
	commandDialogNavigation,
	commandDialogPrimaryKey,
	commandDialogReadKeyHelp,
	commandDialogRows,
	commandDialogScrollOffset,
	createMarkdownRenderer,
	fitCommandDialogRows,
	fitFixedCommandDialogRows,
	matchesCommandDialogCancel,
	matchesCommandDialogConfirm,
	matchesCommandDialogHelp,
	renderCommandDialogKeyHelp,
} from "../../../conversation-ui/index.js";
import { isRuntimeNumber, isRuntimeString } from "../../../shared/runtime-type.js";
import { boundTerminalText as boundTerminalPreview } from "../../../tool-display/index.js";
import type {
	AgentControlAction,
	AgentControlResult,
	AgentNestedDetail,
	AgentRow,
	AgentSessionSnapshot,
	AgentStatus,
	AgentTranscriptTarget,
	CurrentAgentsView,
} from "../session/current-agents.js";
import { boundedTerminalLine, isTaskOnlyAgentText } from "../shared/display-description.js";
import { fitAgentDescription } from "./agent-roster.js";

const GUTTER = "  ";
const NARROW_WIDTH = 64;
const DEFAULT_TRANSCRIPT_CHARS = 24_000;
const MAX_TRANSCRIPT_CHARS = 64_000;
const INPUT_CHAR_LIMIT = 4_000;
const LIST_ROWS = 8;
const NARROW_LIST_ROWS = 6;
const AGENT_DIALOG_ROWS = 20;
const TOOL_RESULT_PREVIEW_CHARS = 4_000;
const TOOL_RESULT_PREVIEW_LINES = 8;

const TERMINAL_STATUSES = new Set<AgentStatus>(["agent_stopped", "completed", "crashed", "failed", "user_cancelled"]);
const RESUMABLE_STATUSES = new Set<AgentStatus>(["agent_stopped", "completed", "crashed", "failed"]);

export interface AgentTranscriptRequest {
	readonly maxChars: number;
	readonly row: AgentTranscriptTarget;
	readonly signal: AbortSignal;
}

export type AgentToolOutcome = "cancelled" | "completed" | "failed" | "rejected" | "running";

export type AgentTranscriptItem =
	| { readonly kind: "message"; readonly speaker: string | null; readonly text: string }
	| {
			readonly kind: "tool";
			readonly name: string;
			readonly outcome: AgentToolOutcome;
			readonly result: string;
			readonly target: string;
	  }
	| { readonly kind: "notice"; readonly text: string };

export interface AgentTranscriptDocument {
	readonly items: readonly AgentTranscriptItem[];
}

/** The reader should use maxChars to bound file I/O before returning Activity. */
export type AgentTranscriptReader = (
	request: AgentTranscriptRequest,
) => Promise<AgentTranscriptDocument | string | null> | AgentTranscriptDocument | string | null;

export interface AgentDialogOptions {
	readonly initialKey?: string;
	readonly maxTranscriptChars?: number;
	readonly readTranscript: AgentTranscriptReader;
}

type DialogMode = "detail" | "list" | "nested-detail" | "nested-list" | "resume-input" | "steer-input";
type FeedbackKind = "error" | "pending" | "success";
type TranscriptState = "error" | "loading" | "ready" | "unavailable";

interface Feedback {
	readonly kind: FeedbackKind;
	readonly message: string;
}

interface Transcript {
	readonly items: readonly AgentTranscriptItem[];
	readonly state: TranscriptState;
	readonly text: string;
}

/** Create the normal-priority, non-overlay view used by `/agents` and roster Enter. */
export function createAgentDialogView(
	current: CurrentAgentsView,
	options: AgentDialogOptions,
): CommandDialogView<void> {
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
	current: CurrentAgentsView,
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
	private readonly current: CurrentAgentsView;
	private disposed = false;
	private feedback: Feedback | undefined;
	private input = "";
	private lastDetailMaxOffset = 0;
	private lastDetailViewportRows = 1;
	private listPageRows = LIST_ROWS;
	private listSelectedKey: string | undefined;
	private readonly markdown: Markdown;
	private mode: DialogMode = "list";
	private nestedListPageRows = LIST_ROWS;
	private nestedSelectedKey: string | undefined;
	private operationGeneration = 0;
	private operationPending = false;
	private followActivity = true;
	private scrollOffset = 0;
	private selectedKey: string | undefined;
	private showKeyHelp = false;
	private showToolDetails = false;
	private snapshotValue: AgentSessionSnapshot;
	private transcript: Transcript = { items: [], state: "unavailable", text: "" };
	private transcriptGeneration = 0;
	private readonly options: NormalizedOptions;
	private readonly unsubscribe: () => void;

	constructor(current: CurrentAgentsView, context: CommandDialogViewContext<void>, options: NormalizedOptions) {
		this.context = context;
		this.current = current;
		this.markdown = createMarkdownRenderer(context.theme);
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
		if (initial) this.loadTranscript(initial, initial.key);
	}

	handleInput(data: string): void {
		if (this.disposed || isKeyRelease(data)) return;
		if (this.mode === "resume-input" || this.mode === "steer-input") {
			this.handleComposerInput(data);
			return;
		}
		if (this.showKeyHelp) {
			if (matchesCommandDialogCancel(data, this.context.keybindings)) {
				this.showKeyHelp = false;
				this.requestRender();
			}
			return;
		}
		if (matchesCommandDialogHelp(data)) {
			this.showKeyHelp = true;
			this.requestRender();
			return;
		}
		if (matchesCommandDialogCancel(data, this.context.keybindings)) {
			if (this.mode === "nested-detail") this.showNestedList();
			else if (this.mode === "nested-list") this.returnToDetail();
			else if (this.mode === "detail") this.showList();
			else this.context.close();
			return;
		}

		if (this.mode === "list") this.handleListInput(data);
		else if (this.mode === "nested-list") this.handleNestedListInput(data);
		else if (this.mode === "nested-detail") this.handleNestedDetailInput(data);
		else this.handleDetailInput(data);
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		if (this.showKeyHelp) {
			const row = this.detailRow();
			const listRow = this.listRow();
			const canStop =
				(this.mode === "list" && listRow !== undefined && !TERMINAL_STATUSES.has(listRow.status)) ||
				(this.mode === "detail" && row !== undefined && !TERMINAL_STATUSES.has(row.status));
			const extras = [
				...(this.mode === "detail" && row?.nestedAgents.length
					? [{ keys: "n", description: "Inspect nested Agents" }]
					: []),
				...(this.mode === "detail" && row && !TERMINAL_STATUSES.has(row.status) && row.status !== "stopping"
					? [{ keys: "s", description: "Steer Agent" }]
					: []),
				...(this.mode === "detail" && row && RESUMABLE_STATUSES.has(row.status)
					? [{ keys: "r", description: "Resume Agent" }]
					: []),
				...(canStop ? [{ keys: "x", description: "Stop Agent" }] : []),
				...((this.mode === "detail" || this.mode === "nested-detail") && this.hasToolActivity()
					? [{ keys: "t", description: this.showToolDetails ? "Hide Tool results" : "Show Tool results" }]
					: []),
			];
			const list = this.mode === "list" || this.mode === "nested-list";
			return renderCommandDialogKeyHelp(
				this.context,
				renderWidth,
				"Agents",
				list
					? commandDialogListKeyHelp(this.context.keybindings, "Agent", extras)
					: commandDialogReadKeyHelp(this.context.keybindings, "line", extras),
			);
		}
		const lines =
			this.mode === "list"
				? this.renderList(renderWidth)
				: this.mode === "nested-list"
					? this.renderNestedList(renderWidth)
					: this.mode === "nested-detail"
						? this.renderNestedDetail(renderWidth)
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
			this.transcript = { items: [], state: "unavailable", text: "" };
			this.nestedSelectedKey = undefined;
			if (!this.operationPending) {
				this.feedback = { kind: "success", message: "Agent left the current-session list." };
			}
		}
		if (this.selectedKey && (this.mode === "nested-list" || this.mode === "nested-detail")) {
			const nested = this.detailRow()?.nestedAgents ?? [];
			if (!nested.some((row) => row.key === this.nestedSelectedKey)) {
				this.nestedSelectedKey = nested[0]?.key;
				if (this.mode === "nested-detail") this.showNestedList();
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
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (navigation) {
			const rows = this.snapshotValue.rows;
			if (rows.length === 0) return;
			const currentIndex = Math.max(
				0,
				rows.findIndex((row) => row.key === this.listSelectedKey),
			);
			const nextIndex = commandDialogListIndex(currentIndex, rows.length, this.listPageRows, navigation);
			this.listSelectedKey = rows[nextIndex]?.key;
			if (!this.operationPending) this.feedback = undefined;
			this.requestRender();
			return;
		}
		if (matchesCommandDialogConfirm(data, this.context.keybindings)) {
			const row = this.listRow();
			if (row) this.showDetail(row);
			return;
		}
		if (decodePrintable(data)?.toLowerCase() === "x") {
			const row = this.listRow();
			if (row && !TERMINAL_STATUSES.has(row.status)) this.stop(row);
		}
	}

	private handleNestedListInput(data: string): void {
		const rows = this.detailRow()?.nestedAgents ?? [];
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (navigation) {
			if (rows.length === 0) return;
			const currentIndex = Math.max(
				0,
				rows.findIndex((row) => row.key === this.nestedSelectedKey),
			);
			const nextIndex = commandDialogListIndex(currentIndex, rows.length, this.nestedListPageRows, navigation);
			this.nestedSelectedKey = rows[nextIndex]?.key;
			this.requestRender();
			return;
		}
		if (matchesCommandDialogConfirm(data, this.context.keybindings)) {
			const row = this.nestedDetailRow();
			if (row) this.showNestedDetail(row);
		}
	}

	private handleNestedDetailInput(data: string): void {
		if (decodePrintable(data)?.toLowerCase() === "t" && this.hasToolActivity()) {
			this.showToolDetails = !this.showToolDetails;
			this.requestRender();
			return;
		}
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (!navigation) return;
		const page = this.detailViewportRows();
		this.scrollOffset = commandDialogScrollOffset(this.scrollOffset, this.lastDetailMaxOffset, page, navigation);
		this.followActivity = navigation === "end" || this.scrollOffset >= this.lastDetailMaxOffset;
		this.requestRender();
	}

	private handleDetailInput(data: string): void {
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (navigation) {
			const page = this.detailViewportRows();
			this.scrollOffset = commandDialogScrollOffset(this.scrollOffset, this.lastDetailMaxOffset, page, navigation);
			this.followActivity = navigation === "end" || this.scrollOffset >= this.lastDetailMaxOffset;
			this.requestRender();
			return;
		}

		const row = this.detailRow();
		if (!row) {
			this.showList();
			return;
		}
		const printable = decodePrintable(data)?.toLowerCase();
		if (printable === "t" && this.hasToolActivity()) {
			this.showToolDetails = !this.showToolDetails;
			this.requestRender();
			return;
		}
		if (this.operationPending) return;
		if (printable === "x" && !TERMINAL_STATUSES.has(row.status)) {
			this.stop(row);
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
			return;
		}
		if (printable === "n" && row.nestedAgents.length > 0) this.showNestedList();
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

	private stop(row: AgentRow): void {
		this.runControl({ type: "stop", key: row.key });
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
		this.nestedSelectedKey = undefined;
		this.input = "";
		this.scrollOffset = 0;
		this.followActivity = true;
		this.lastDetailMaxOffset = 0;
		this.lastDetailViewportRows = 1;
		this.transcriptGeneration += 1;
		this.transcript = { items: [], state: "unavailable", text: "" };
		this.showToolDetails = false;
		if (!this.operationPending) this.feedback = undefined;
		this.reconcileListSelection();
		this.requestRender();
	}

	private showDetail(row: AgentRow): void {
		this.mode = "detail";
		this.selectedKey = row.key;
		this.nestedSelectedKey = row.nestedAgents[0]?.key;
		this.listSelectedKey = row.key;
		this.scrollOffset = 0;
		this.followActivity = true;
		this.lastDetailMaxOffset = 0;
		this.lastDetailViewportRows = 1;
		this.showToolDetails = false;
		if (!this.operationPending) this.feedback = undefined;
		this.loadTranscript(row, row.key);
		this.requestRender();
	}

	private returnToDetail(): void {
		const row = this.detailRow();
		if (!row) {
			this.showList();
			return;
		}
		this.mode = "detail";
		this.scrollOffset = 0;
		this.followActivity = true;
		this.lastDetailMaxOffset = 0;
		this.lastDetailViewportRows = 1;
		this.showToolDetails = false;
		this.loadTranscript(row, row.key);
		this.requestRender();
	}

	private showNestedList(): void {
		const row = this.detailRow();
		if (!row?.nestedAgents.length) {
			this.returnToDetail();
			return;
		}
		this.mode = "nested-list";
		if (!row.nestedAgents.some((nested) => nested.key === this.nestedSelectedKey)) {
			this.nestedSelectedKey = row.nestedAgents[0]?.key;
		}
		this.scrollOffset = 0;
		this.followActivity = true;
		this.lastDetailMaxOffset = 0;
		this.lastDetailViewportRows = 1;
		this.transcriptGeneration += 1;
		this.transcript = { items: [], state: "unavailable", text: "" };
		this.showToolDetails = false;
		this.requestRender();
	}

	private showNestedDetail(row: AgentNestedDetail): void {
		this.mode = "nested-detail";
		this.nestedSelectedKey = row.key;
		this.scrollOffset = 0;
		this.followActivity = true;
		this.lastDetailMaxOffset = 0;
		this.lastDetailViewportRows = 1;
		this.showToolDetails = false;
		this.loadTranscript(row, row.key);
		this.requestRender();
	}

	private loadTranscript(row: AgentTranscriptTarget, selectionKey: string): void {
		const generation = ++this.transcriptGeneration;
		this.transcript = { items: [], state: "loading", text: "" };
		void Promise.resolve()
			.then(() =>
				this.options.readTranscript({
					maxChars: this.options.maxTranscriptChars,
					row,
					signal: this.context.signal,
				}),
			)
			.then((value) => {
				if (!this.canFinishTranscript(generation, selectionKey)) return;
				const rawText = isRuntimeString(value) ? boundedTerminalText(value, this.options.maxTranscriptChars) : "";
				const text = isTaskOnlyAgentText(rawText, row.task) ? "" : rawText;
				const partial = row.partialResult
					? isTaskOnlyAgentText(row.partialResult, row.task)
						? ""
						: boundedTerminalText(row.partialResult, Math.min(this.options.maxTranscriptChars, 4_000))
					: "";
				const items = isRuntimeString(value)
					? text
						? [{ kind: "message", speaker: null, text } satisfies AgentTranscriptItem]
						: []
					: (value?.items ?? []);
				const onlyPartial =
					items.length === 1 && items[0]?.kind === "message" && items[0].text.trim() === partial.trim();
				this.transcript =
					items.length > 0 && !onlyPartial
						? { items, state: "ready", text: "" }
						: { items: [], state: "unavailable", text: "" };
				this.scrollOffset = 0;
				this.requestRender();
			})
			.catch((error) => {
				if (!this.canFinishTranscript(generation, selectionKey)) return;
				this.transcript = {
					items: [],
					state: "error",
					text: `Unable to read Activity: ${oneLine(errorMessage(error))}`,
				};
				this.scrollOffset = 0;
				this.requestRender();
			});
	}

	private canFinishTranscript(generation: number, key: string): boolean {
		const selected = this.mode === "nested-detail" ? this.nestedSelectedKey : this.selectedKey;
		return !this.disposed && generation === this.transcriptGeneration && selected === key;
	}

	private listRow(): AgentRow | undefined {
		return this.snapshotValue.rows.find((row) => row.key === this.listSelectedKey);
	}

	private detailRow(): AgentRow | undefined {
		return this.snapshotValue.rows.find((row) => row.key === this.selectedKey);
	}

	private nestedDetailRow(): AgentNestedDetail | undefined {
		return this.detailRow()?.nestedAgents.find((row) => row.key === this.nestedSelectedKey);
	}

	private hasToolActivity(): boolean {
		return this.transcript.items.some((item) => item.kind === "tool");
	}

	private renderList(width: number): string[] {
		const rows = this.snapshotValue.rows;
		const limit = width <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const confirm = commandDialogPrimaryKey(this.context.keybindings, "tui.select.confirm", "Enter");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		this.listPageRows = limit;
		const window = selectedWindow(rows, this.listSelectedKey, limit);
		const header = [divider(this.context.theme, width), title(this.context.theme, "Agents")];
		const feedbackLine = this.feedback ? renderFeedback(this.context.theme, this.feedback, width) : undefined;
		const body = [...(feedbackLine ? [feedbackLine] : []), ""];
		const emptyLine = `${GUTTER}${this.context.theme.fg("muted", "No Agents in the current session.")}`;
		const rowLines: string[] = [];
		if (rows.length === 0) {
			body.push(emptyLine);
		} else {
			if (window.start > 0) body.push(`${GUTTER}${this.context.theme.fg("dim", `… ${window.start} earlier`)}`);
			for (const row of window.rows) {
				const line = this.renderListRow(row, width);
				rowLines.push(line);
				body.push(line);
			}
			const later = rows.length - window.start - window.rows.length;
			if (later > 0) body.push(`${GUTTER}${this.context.theme.fg("dim", `… ${later} later`)}`);
		}
		const hints = [`${up}/${down} select`, `${confirm} details`];
		const selected = this.listRow();
		if (selected && !TERMINAL_STATUSES.has(selected.status)) hints.push("x stop");
		hints.push("? keys", `${cancel} close`);
		body.push("");
		const footer = hintLines(this.context.theme, width, hints);
		const selectedIndex = window.rows.findIndex((row) => row.key === this.listSelectedKey);
		return fitCommandDialogRows(
			{
				header,
				body,
				footer,
				priority: [feedbackLine ?? rowLines[selectedIndex] ?? emptyLine],
			},
			commandDialogRows(this.context),
		);
	}

	private renderListRow(row: AgentRow, width: number): string {
		const theme = this.context.theme;
		const selected = row.key === this.listSelectedKey;
		const prefix = `${GUTTER}${selected ? theme.fg("accent", "› ") : "  "}`;
		const name = oneLine(row.name) || "agent";
		const description = oneLine(row.description ?? row.task);
		const state = styledStatus(row, theme);
		const rightWidth = visibleWidth(state);
		const contentWidth = Math.max(1, width - visibleWidth(prefix) - rightWidth - 3);
		const renderedName = truncateToWidth(name, contentWidth, "…");
		const remaining = Math.max(0, contentWidth - visibleWidth(renderedName) - 2);
		const renderedDescription =
			visibleWidth(name) <= contentWidth && remaining >= 10 ? fitAgentDescription(description, remaining) : "";
		const left = `${prefix}${selected ? theme.fg("text", renderedName) : theme.fg("muted", renderedName)}${
			renderedDescription ? `  ${theme.fg("dim", renderedDescription)}` : ""
		}`;
		const gap = Math.max(1, width - visibleWidth(left) - rightWidth);
		return `${left}${" ".repeat(gap)}${state}`;
	}

	private renderNestedList(width: number): string[] {
		const parent = this.detailRow();
		if (!parent) return this.renderList(width);
		const rows = parent.nestedAgents;
		const limit = width <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		this.nestedListPageRows = limit;
		const window = selectedWindow(rows, this.nestedSelectedKey, limit);
		const theme = this.context.theme;
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const confirm = commandDialogPrimaryKey(this.context.keybindings, "tui.select.confirm", "Enter");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		const header = [divider(theme, width), title(theme, `Agents / ${oneLine(parent.name) || "agent"} / nested`)];
		const body = ["", `${GUTTER}${theme.fg("muted", `${rows.length} nested Agent${rows.length === 1 ? "" : "s"}`)}`];
		const rowLines: string[] = [];
		if (window.start > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${window.start} earlier`)}`);
		for (const row of window.rows) {
			const line = this.renderNestedListRow(row, width);
			rowLines.push(line);
			body.push(line);
		}
		const later = rows.length - window.start - window.rows.length;
		if (later > 0) body.push(`${GUTTER}${theme.fg("dim", `… ${later} later`)}`);
		body.push("");
		const selectedIndex = window.rows.findIndex((row) => row.key === this.nestedSelectedKey);
		return fitCommandDialogRows(
			{
				header,
				body,
				footer: hintLines(theme, width, [`${up}/${down} select`, `${confirm} details`, "? keys", `${cancel} back`]),
				priority: [rowLines[selectedIndex] ?? body[1] ?? ""],
			},
			commandDialogRows(this.context),
		);
	}

	private renderNestedListRow(row: AgentNestedDetail, width: number): string {
		const theme = this.context.theme;
		const selected = row.key === this.nestedSelectedKey;
		const prefix = `${GUTTER}${selected ? theme.fg("accent", "› ") : "  "}`;
		const state = `${theme.fg("dim", `d${row.depth}`)} · ${styledNestedStatus(row.status, theme)}`;
		const contentWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(state) - 3);
		const fullName = oneLine(row.name) || "agent";
		const name = truncateToWidth(fullName, contentWidth, "…");
		const remaining = Math.max(0, contentWidth - visibleWidth(name) - 2);
		const description =
			visibleWidth(fullName) <= contentWidth && remaining >= 10
				? fitAgentDescription(oneLine(row.description), remaining)
				: "";
		const left = `${prefix}${selected ? theme.fg("text", name) : theme.fg("muted", name)}${
			description ? `  ${theme.fg("dim", description)}` : ""
		}`;
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(state));
		return `${left}${" ".repeat(gap)}${state}`;
	}

	private renderDetail(width: number): string[] {
		const row = this.detailRow();
		if (!row) return this.renderList(width);
		const theme = this.context.theme;
		const stateLine = `${GUTTER}${styledStatus(row, theme, true)}${
			row.nestedCount > 0 ? theme.fg("dim", ` · ${row.nestedCount} nested`) : ""
		}`;
		const header = [divider(theme, width), title(theme, `Agents / ${oneLine(row.name) || "agent"}`), stateLine];
		const feedbackLine = this.feedback ? renderFeedback(theme, this.feedback, width) : undefined;
		const taskLines = sectionBody(row.task || "(no task)", width);
		const outcome = agentOutcome(row, width, theme, this.markdown);
		const activity = this.activityLines(width);
		const document = [
			sectionHeading(theme, "Task"),
			...taskLines,
			...(outcome ? ["", sectionHeading(theme, outcome.label), ...outcome.lines] : []),
			"",
			sectionHeading(theme, "Activity"),
			...activity,
		];
		const activityError = this.transcript.state === "error" ? activity.find((line) => line.trim()) : undefined;
		return this.renderDetailSurface(
			header,
			document,
			(scrollable) => this.renderDetailFooter(row, width, scrollable),
			!TERMINAL_STATUSES.has(row.status),
			[feedbackLine ?? outcome?.lines[0] ?? activityError ?? stateLine, ...taskLines.slice(0, 1)],
			feedbackLine,
		);
	}

	private renderNestedDetail(width: number): string[] {
		const parent = this.detailRow();
		const row = this.nestedDetailRow();
		if (!parent || !row) return this.renderNestedList(width);
		const theme = this.context.theme;
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const pageUp = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageUp", "PgUp");
		const pageDown = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageDown", "PgDn");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		const header = [
			divider(theme, width),
			title(theme, `Agents / ${oneLine(parent.name) || "agent"} / ${oneLine(row.name) || "nested"}`),
		];
		const stateLine = `${GUTTER}${styledNestedStatus(row.status, theme, true)}${theme.fg(
			"dim",
			` · depth ${row.depth}${row.nestedCount > 0 ? ` · ${row.nestedCount} nested` : ""}`,
		)}`;
		header.push(stateLine);
		const taskLines = sectionBody(row.task || "(no task)", width);
		const outcome = agentOutcome(row, width, theme, this.markdown);
		const activity = this.activityLines(width);
		const document = [
			sectionHeading(theme, "Task"),
			...taskLines,
			...(outcome ? ["", sectionHeading(theme, outcome.label), ...outcome.lines] : []),
			"",
			sectionHeading(theme, "Activity"),
			...activity,
		];
		const activityError = this.transcript.state === "error" ? activity.find((line) => line.trim()) : undefined;
		return this.renderDetailSurface(
			header,
			document,
			(scrollable) =>
				hintLines(theme, width, [
					...(scrollable ? [`${up}/${down} scroll`, `${pageUp}/${pageDown} page`] : []),
					...(this.hasToolActivity() ? ["t tool details"] : []),
					"? keys",
					`${cancel} back`,
				]),
			!TERMINAL_STATUSES.has(row.status),
			[outcome?.lines[0] ?? activityError ?? stateLine, ...taskLines.slice(0, 1)],
		);
	}

	private renderDetailSurface(
		header: readonly string[],
		document: readonly string[],
		footerFor: (scrollable: boolean) => string[],
		live: boolean,
		priority: readonly string[],
		feedbackLine?: string,
	): string[] {
		const maximum = Math.min(AGENT_DIALOG_ROWS, commandDialogRows(this.context));
		const fixedRows = header.length + 2 + (feedbackLine ? 2 : 0);
		let footer = footerFor(false);
		let viewport = Math.max(0, maximum - fixedRows - footer.length);
		if (document.length > viewport) {
			footer = footerFor(true);
			viewport = Math.max(0, maximum - fixedRows - footer.length);
		}
		const content = viewport <= 3 ? document.filter((line) => line.trim().length > 0) : document;
		const maxOffset = Math.max(0, content.length - viewport);
		this.lastDetailMaxOffset = maxOffset;
		this.lastDetailViewportRows = Math.max(1, viewport);
		this.scrollOffset = this.followActivity && live ? maxOffset : Math.min(maxOffset, Math.max(0, this.scrollOffset));
		const visible = [...content.slice(this.scrollOffset, this.scrollOffset + viewport)];
		if (this.scrollOffset > 0 && visible.length > 0) {
			visible[0] = `${GUTTER}${this.context.theme.fg("dim", `… ${this.scrollOffset} earlier lines`)}`;
		}
		const later = content.length - this.scrollOffset - visible.length;
		if (later > 0 && visible.length > 0) {
			visible[visible.length - 1] = `${GUTTER}${this.context.theme.fg("dim", `… ${later} later lines`)}`;
		}
		return fitFixedCommandDialogRows(
			{
				header,
				body: ["", ...(feedbackLine ? [feedbackLine, ""] : []), ...visible, ""],
				footer,
				overflowTitle: header[1],
				priority,
			},
			maximum,
		);
	}

	private activityLines(width: number): string[] {
		const theme = this.context.theme;
		const contentWidth = Math.max(1, width - GUTTER.length);
		const allLines: string[] = [];
		switch (this.transcript.state) {
			case "loading":
				allLines.push(theme.fg("muted", "Loading Activity…"));
				break;
			case "unavailable":
				allLines.push(theme.fg("muted", "No Activity yet."));
				break;
			case "error":
				allLines.push(theme.fg("error", truncateToWidth(this.transcript.text, contentWidth, "…")));
				break;
			case "ready":
				for (const item of this.transcript.items) {
					if (allLines.length > 0) allLines.push("");
					if (item.kind === "notice") {
						allLines.push(theme.fg("dim", oneLine(item.text)));
						continue;
					}
					if (item.kind === "tool") {
						allLines.push(...renderAgentTool(item, contentWidth, theme, this.showToolDetails));
						continue;
					}
					const speaker = item.speaker ? oneLine(item.speaker) : "";
					if (speaker) allLines.push(theme.fg("text", theme.bold(speaker)));
					const body = boundedTerminalText(item.text, this.options.maxTranscriptChars);
					this.markdown.setText(body);
					allLines.push(...this.markdown.render(contentWidth));
				}
				break;
		}
		return allLines.map((line) => `${GUTTER}${line || " "}`);
	}

	private renderDetailFooter(row: AgentRow, width: number, scrollable: boolean): string[] {
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const pageUp = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageUp", "PgUp");
		const pageDown = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageDown", "PgDn");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		const actions = scrollable ? [`${up}/${down} scroll`, `${pageUp}/${pageDown} page`] : [];
		if (row.nestedAgents.length > 0) actions.push("n nested");
		if (!TERMINAL_STATUSES.has(row.status) && row.status !== "stopping") actions.push("s steer");
		if (RESUMABLE_STATUSES.has(row.status)) actions.push("r resume");
		if (!TERMINAL_STATUSES.has(row.status)) actions.push("x stop");
		if (this.hasToolActivity()) actions.push("t tool details");
		actions.push("? keys", `${cancel} back`);
		return hintLines(this.context.theme, width, actions);
	}

	private renderComposer(width: number): string[] {
		const row = this.detailRow();
		if (!row) return this.renderList(width);
		const theme = this.context.theme;
		const resume = this.mode === "resume-input";
		const inputLine = `${GUTTER}${theme.fg("accent", "›")} ${this.input || theme.fg("dim", resume ? "Continue the task…" : "Send new guidance…")}`;
		const feedbackLine = this.feedback ? renderFeedback(theme, this.feedback, width) : undefined;
		const body = [
			"",
			`${GUTTER}${theme.fg("muted", resume ? "Resume message (optional)" : "Steer Agent")}`,
			inputLine,
			...(feedbackLine ? [feedbackLine] : []),
			"",
		];
		return fitCommandDialogRows(
			{
				header: [divider(theme, width), title(theme, `Agents / ${oneLine(row.name) || "agent"}`)],
				body,
				footer: hintLines(theme, width, [`Enter ${resume ? "resume" : "send"}`, "Esc cancel"]),
				priority: [feedbackLine ?? inputLine],
			},
			commandDialogRows(this.context),
		);
	}

	private detailViewportRows(): number {
		return this.lastDetailViewportRows;
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

function selectedWindow<T extends { readonly key: string }>(
	rows: readonly T[],
	selectedKey: string | undefined,
	limit: number,
): { readonly rows: readonly T[]; readonly start: number } {
	if (rows.length <= limit) return { rows, start: 0 };
	const selectedIndex = Math.max(
		0,
		rows.findIndex((row) => row.key === selectedKey),
	);
	const start = Math.min(rows.length - limit, Math.max(0, selectedIndex - Math.floor(limit / 2)));
	return { rows: rows.slice(start, start + limit), start };
}

function divider(theme: Theme, width: number): string {
	return theme.fg("border", "━".repeat(width));
}

function title(theme: Theme, value: string): string {
	return `${GUTTER}${theme.fg("text", theme.bold(value))}`;
}

function sectionHeading(theme: Theme, value: string): string {
	return `${GUTTER}${theme.fg("accent", "◆")} ${theme.bold(value)}`;
}

function sectionBody(value: string, width: number): string[] {
	const contentWidth = Math.max(1, width - visibleWidth(GUTTER));
	const safe = boundedTerminalText(value, 4_000) || "—";
	return transcriptLines(safe, contentWidth).map((line) => `${GUTTER}${line || " "}`);
}

function markdownSectionBody(value: string, width: number, markdown: Markdown): string[] {
	const contentWidth = Math.max(1, width - visibleWidth(GUTTER));
	const safe = boundedTerminalText(value, 4_000) || "—";
	markdown.setText(safe);
	return markdown.render(contentWidth).map((line) => `${GUTTER}${line || " "}`);
}

function agentOutcome(
	row: AgentRow | AgentNestedDetail,
	width: number,
	theme: Theme,
	markdown: Markdown,
): { readonly label: "Error" | "Partial result" | "Result"; readonly lines: readonly string[] } | undefined {
	const partial = row.partialResult && !isTaskOnlyAgentText(row.partialResult, row.task) ? row.partialResult : "";
	if (row.error) {
		const errorLines = sectionBody(row.error, width).map((line) => theme.fg("error", line));
		return {
			label: "Error",
			lines: [
				...errorLines,
				...(partial
					? [
							"",
							`${GUTTER}${theme.fg("muted", "Partial result")}`,
							...markdownSectionBody(partial, width, markdown),
						]
					: []),
			],
		};
	}
	if (!partial) return undefined;
	return {
		label: row.status === "completed" ? "Result" : "Partial result",
		lines: markdownSectionBody(partial, width, markdown),
	};
}

function renderAgentTool(
	item: Extract<AgentTranscriptItem, { readonly kind: "tool" }>,
	width: number,
	theme: Theme,
	showDetails: boolean,
): string[] {
	const target = oneLine(item.target);
	const glyph = styleToolOutcome(theme, item.outcome, toolOutcomeGlyph(item.outcome));
	const header = `${glyph} ${theme.fg("text", toolLabel(item.name))}${target ? ` · ${theme.fg("muted", target)}` : ""}${theme.fg("dim", ` · ${item.outcome}`)}`;
	const result = boundedTerminalText(item.result, TOOL_RESULT_PREVIEW_CHARS).trim();
	if (!result || (!showDetails && item.outcome === "completed")) return [header];

	const logicalLines = result.split("\n");
	const lines = logicalLines
		.slice(0, TOOL_RESULT_PREVIEW_LINES)
		.flatMap((line, index) => transcriptLines(`${index === 0 ? "⎿ " : ""}${line}`, width));
	const omitted = logicalLines.length - Math.min(logicalLines.length, TOOL_RESULT_PREVIEW_LINES);
	if (omitted > 0) lines.push(`⎿ … ${String(omitted)} lines omitted`);
	return [header, ...lines];
}

function toolLabel(value: string): string {
	const safe = oneLine(value) || "Tool";
	return `${safe.charAt(0).toUpperCase()}${safe.slice(1)}`;
}

function toolOutcomeGlyph(outcome: AgentToolOutcome): string {
	if (outcome === "running") return "●";
	if (outcome === "completed") return "✓";
	if (outcome === "rejected") return "!";
	if (outcome === "cancelled") return "■";
	return "×";
}

function styleToolOutcome(theme: Theme, outcome: AgentToolOutcome, value: string): string {
	if (outcome === "running") return theme.fg("accent", value);
	if (outcome === "completed") return theme.fg("success", value);
	if (outcome === "failed") return theme.fg("error", value);
	return theme.fg("warning", value);
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

function agentStatusGlyph(status: AgentStatus): string {
	switch (status) {
		case "queued":
		case "waiting_supervisor":
			return "○";
		case "running":
			return "●";
		case "stopping":
			return "◐";
		case "resuming":
			return "↻";
		case "completed":
			return "✓";
		case "failed":
		case "crashed":
			return "×";
		case "agent_stopped":
		case "user_cancelled":
			return "■";
	}
}

function agentStatusLabel(status: AgentStatus): string {
	if (status === "waiting_supervisor") return "waiting";
	if (status === "agent_stopped") return "stopped";
	if (status === "user_cancelled") return "cancelled";
	return status;
}

function styleAgentStatus(theme: Theme, status: AgentStatus, value: string): string {
	switch (status) {
		case "running":
		case "resuming":
			return theme.fg("accent", value);
		case "completed":
			return theme.fg("success", value);
		case "failed":
		case "crashed":
			return theme.fg("error", value);
		case "agent_stopped":
		case "user_cancelled":
			return theme.fg("muted", value);
		case "queued":
		case "waiting_supervisor":
		case "stopping":
			return theme.fg("warning", value);
	}
}

function styledStatus(row: AgentRow, theme: Theme, detailed = false): string {
	const elapsed = elapsedText(row);
	const glyph = agentStatusGlyph(row.status);
	const value = detailed
		? `${glyph} ${agentStatusLabel(row.status)}${elapsed ? ` · ${elapsed}` : ""}`
		: `${glyph}${elapsed ? ` ${elapsed}` : row.status === "queued" ? ` #${String(row.childIndex + 1)}` : ""}`;
	return styleAgentStatus(theme, row.status, value);
}

function styledNestedStatus(status: AgentStatus, theme: Theme, detailed = false): string {
	const glyph = agentStatusGlyph(status);
	return styleAgentStatus(theme, status, detailed ? `${glyph} ${agentStatusLabel(status)}` : glyph);
}

function elapsedText(row: AgentRow): string {
	const value = row.elapsedMs;
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return "";
	const seconds = Math.max(0, Math.floor(value / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function pendingMessage(type: Exclude<AgentControlAction, { type: "inspect" }>["type"]): string {
	switch (type) {
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
	return boundedTerminalLine(value);
}

function boundedTerminalText(value: string, limit: number): string {
	return boundTerminalPreview(value, limit);
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
