import type { Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
} from "../../conversation-ui/index.js";
import type { CurrentWorkProjectionItem, CurrentWorkSources } from "./current-work.js";
import type { BackgroundWorkRuntime, BackgroundWorkSnapshot } from "./runtime.js";

type TaskDialogMode = "detail" | "list";

interface TaskRow {
	readonly command?: string;
	readonly description?: string;
	readonly id: string;
	readonly kind: "agent" | "monitor" | "shell";
	readonly output?: string;
	readonly owned: boolean;
	readonly startedAt?: number;
	readonly status: string;
	readonly title: string;
}

const GUTTER = "  ";
const LIST_ROWS = 9;
const NARROW_LIST_ROWS = 6;
const NARROW_WIDTH = 64;

function oneLine(value: string): string {
	return value
		.replace(/[\r\n\t]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}

function bounded(width: number, line: string): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function elapsed(startedAt: number | undefined): string {
	if (startedAt === undefined) return "—";
	const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1_000));
	if (seconds < 60) return `${String(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
	return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

function kindLabel(kind: TaskRow["kind"]): string {
	switch (kind) {
		case "agent":
			return "Agent";
		case "monitor":
			return "Monitor";
		case "shell":
			return "Shell";
	}
}

function statusText(theme: Theme, status: string, value: string): string {
	if (status === "stopping") return theme.fg("error", value);
	if (status === "waiting" || status === "queued") return theme.fg("accent", value);
	return theme.fg("muted", value);
}

function fromOwned(snapshot: BackgroundWorkSnapshot): TaskRow {
	return {
		...(snapshot.command ? { command: snapshot.command } : {}),
		...(snapshot.description ? { description: snapshot.description } : {}),
		id: snapshot.id,
		kind: snapshot.kind,
		...(snapshot.recentOutput ? { output: snapshot.recentOutput } : {}),
		owned: true,
		startedAt: snapshot.startedAt,
		status: snapshot.status,
		title: snapshot.title,
	};
}

function fromProjection(item: CurrentWorkProjectionItem): TaskRow {
	return {
		...(item.description ? { description: item.description } : {}),
		id: item.id,
		kind: item.kind,
		owned: false,
		...(item.startedAt !== undefined ? { startedAt: item.startedAt } : {}),
		status: item.status,
		title: item.title,
	};
}

function fitRow(theme: Theme, row: TaskRow, selected: boolean, width: number): string {
	const cursor = selected ? theme.fg("accent", "›") : " ";
	const glyph = statusText(theme, row.status, "●");
	const label = selected ? theme.bold(kindLabel(row.kind)) : kindLabel(row.kind);
	const suffix = statusText(theme, row.status, `${row.status} · ${elapsed(row.startedAt)}`);
	const prefix = `${cursor} ${glyph} ${label}`;
	const title = theme.fg("muted", oneLine(row.title));
	const available = Math.max(1, width - visibleWidth(GUTTER));
	const identity = truncateToWidth(`${prefix}  ${title}`, available, "…");
	const separator = " · ";
	if (visibleWidth(identity) + visibleWidth(separator) + visibleWidth(suffix) <= available) {
		return `${GUTTER}${identity}${theme.fg("dim", separator)}${suffix}`;
	}
	if (available >= 38) {
		const identityWidth = Math.max(14, available - visibleWidth(separator) - visibleWidth(suffix));
		return `${GUTTER}${truncateToWidth(`${prefix}  ${title}`, identityWidth, "…")}${theme.fg("dim", separator)}${suffix}`;
	}
	return `${GUTTER}${truncateToWidth(`${prefix}  ${title}`, available, "…")}`;
}

function hint(theme: Theme, width: number, values: readonly string[]): string[] {
	const text = values.join(" · ");
	const contentWidth = Math.max(1, width - visibleWidth(GUTTER));
	return wrapTextWithAnsi(text, contentWidth).map((line) => `${GUTTER}${theme.fg("dim", line)}`);
}

class TasksDialogComponent implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private disposed = false;
	private lastWidth = 80;
	private mode: TaskDialogMode = "list";
	private note = "";
	private rows: readonly TaskRow[] = [];
	private scrollOffset = 0;
	private selectedId: string | undefined;
	private stopping = false;
	private readonly timer: ReturnType<typeof setInterval>;
	private readonly runtime: BackgroundWorkRuntime;
	private readonly sources: CurrentWorkSources;
	private readonly unsubscribes: readonly (() => void)[];

	constructor(runtime: BackgroundWorkRuntime, sources: CurrentWorkSources, context: CommandDialogViewContext<void>) {
		this.context = context;
		this.runtime = runtime;
		this.sources = sources;
		this.refresh();
		this.unsubscribes = [runtime.subscribe(() => this.refresh()), sources.subscribe(() => this.refresh())];
		this.timer = setInterval(() => context.requestRender(), 1_000);
		this.timer.unref?.();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		clearInterval(this.timer);
		for (const unsubscribe of this.unsubscribes) unsubscribe();
	}

	handleInput(data: string): void {
		if (this.disposed || isKeyRelease(data)) return;
		if (matchesKey(data, Key.escape)) {
			if (this.mode === "detail") {
				this.mode = "list";
				this.scrollOffset = 0;
				this.context.requestRender();
			} else {
				this.context.close();
			}
			return;
		}
		if (this.stopping) return;
		if (matchesKey(data, "x")) {
			void this.stopSelected();
			return;
		}
		if (this.mode === "list") this.handleListInput(data);
		else this.handleDetailInput(data);
	}

	invalidate(): void {}

	render(width: number): string[] {
		this.lastWidth = Math.max(1, Math.floor(width));
		const lines = this.mode === "list" ? this.renderList() : this.renderDetail();
		return lines.map((line) => bounded(this.lastWidth, line));
	}

	private refresh(): void {
		this.rows = [...this.runtime.snapshot().map(fromOwned), ...this.sources.snapshot().map(fromProjection)].sort(
			(left, right) => (left.startedAt ?? Number.POSITIVE_INFINITY) - (right.startedAt ?? Number.POSITIVE_INFINITY),
		);
		if (!this.selectedId || !this.rows.some((row) => row.id === this.selectedId)) {
			this.selectedId = this.rows[0]?.id;
			this.scrollOffset = 0;
			if (!this.selectedId) this.mode = "list";
		}
		this.context.requestRender();
	}

	private selected(): TaskRow | undefined {
		return this.rows.find((row) => row.id === this.selectedId);
	}

	private handleListInput(data: string): void {
		if (matchesKey(data, Key.enter)) {
			if (!this.selected()) return;
			this.mode = "detail";
			this.scrollOffset = 0;
			this.context.requestRender();
			return;
		}
		if (!matchesKey(data, Key.up) && !matchesKey(data, Key.down)) return;
		const current = Math.max(
			0,
			this.rows.findIndex((row) => row.id === this.selectedId),
		);
		const next = Math.max(0, Math.min(this.rows.length - 1, current + (matchesKey(data, Key.up) ? -1 : 1)));
		this.selectedId = this.rows[next]?.id;
		this.note = "";
		this.context.requestRender();
	}

	private handleDetailInput(data: string): void {
		if (
			!matchesKey(data, Key.up) &&
			!matchesKey(data, Key.down) &&
			!matchesKey(data, "pageUp") &&
			!matchesKey(data, "pageDown")
		)
			return;
		const document = this.detailDocument(this.selected());
		const page = Math.max(1, commandDialogRows(this.context) - 10);
		const delta = matchesKey(data, Key.up)
			? -1
			: matchesKey(data, Key.down)
				? 1
				: matchesKey(data, "pageUp")
					? -page
					: page;
		this.scrollOffset = Math.max(0, Math.min(Math.max(0, document.length - page), this.scrollOffset + delta));
		this.context.requestRender();
	}

	private async stopSelected(): Promise<void> {
		const row = this.selected();
		if (!row) return;
		if (!row.owned) {
			this.note = "Open /agents to control an Agent.";
			this.context.requestRender();
			return;
		}
		this.stopping = true;
		this.note = `Stopping ${row.id}…`;
		this.context.requestRender();
		try {
			const outcome = await this.runtime.stop(row.id);
			this.note = outcome.summary;
		} catch (error) {
			this.note = error instanceof Error ? error.message : String(error);
		} finally {
			this.stopping = false;
			this.context.requestRender();
		}
	}

	private renderList(): string[] {
		const theme = this.context.theme;
		const selected = this.selected();
		const footer = hint(theme, this.lastWidth, [
			"↑/↓ select",
			"Enter view",
			...(selected?.owned ? ["x stop"] : []),
			"Esc return",
		]);
		const maximum = commandDialogRows(this.context);
		const preferred = this.lastWidth <= NARROW_WIDTH ? NARROW_LIST_ROWS : LIST_ROWS;
		const viewport = Math.min(preferred, Math.max(0, maximum - footer.length - 4));
		const selectedIndex = Math.max(
			0,
			this.rows.findIndex((row) => row.id === this.selectedId),
		);
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(viewport / 2), this.rows.length - viewport));
		const visible = viewport > 0 ? this.rows.slice(start, start + viewport) : [];
		const header = [
			theme.fg("border", "─".repeat(this.lastWidth)),
			`${GUTTER}${theme.bold("Tasks")}${theme.fg("dim", ` · ${String(this.rows.length)} current`)}`,
		];
		const emptyLine = `${GUTTER}${theme.fg("dim", "No background work in this session.")}`;
		const rowLines = visible.map((row) => fitRow(theme, row, row.id === this.selectedId, this.lastWidth));
		const noteLine = this.note ? `${GUTTER}${theme.fg("dim", oneLine(this.note))}` : undefined;
		const body = ["", ...(rowLines.length === 0 ? [emptyLine] : rowLines), ...(noteLine ? [noteLine] : [])];
		while (header.length + body.length + footer.length < maximum && body.length < preferred + 1) body.push("");
		const selectedLine = selected ? fitRow(theme, selected, true, this.lastWidth) : undefined;
		return fitCommandDialogRows({ header, body, footer, priority: [noteLine ?? selectedLine ?? emptyLine] }, maximum);
	}

	private renderDetail(): string[] {
		const row = this.selected();
		if (!row) {
			this.mode = "list";
			return this.renderList();
		}
		const theme = this.context.theme;
		const footer = hint(theme, this.lastWidth, ["↑/↓ scroll", ...(row.owned ? ["x stop"] : []), "Esc back"]);
		const maximum = commandDialogRows(this.context);
		const document = this.detailDocument(row);
		const fixedRows = 9 + footer.length + (this.note ? 1 : 0);
		const viewport = Math.max(0, maximum - fixedRows);
		const maxOffset = Math.max(0, document.length - viewport);
		this.scrollOffset = Math.min(maxOffset, this.scrollOffset);
		const visible = document.slice(this.scrollOffset, this.scrollOffset + viewport);
		const stateLine = `${GUTTER}${theme.fg("dim", "State")}  ${statusText(theme, row.status, row.status)} ${theme.fg("dim", `· ${elapsed(row.startedAt)}`)}`;
		const noteLine = this.note ? `${GUTTER}${theme.fg("dim", oneLine(this.note))}` : undefined;
		const header = [
			theme.fg("border", "─".repeat(this.lastWidth)),
			`${GUTTER}${theme.bold("Task details")} ${theme.fg("dim", `· ${kindLabel(row.kind)}`)}`,
		];
		const body = [
			"",
			stateLine,
			`${GUTTER}${theme.fg("dim", "Task")}   ${oneLine(row.title)}`,
			`${GUTTER}${theme.fg("dim", "ID")}     ${oneLine(row.id)}`,
			"",
			...visible.map((line) => `${GUTTER}${line}`),
			...(noteLine ? [noteLine] : []),
			"",
		];
		return fitCommandDialogRows({ header, body, footer, priority: [noteLine ?? stateLine] }, maximum);
	}

	private detailDocument(row: TaskRow | undefined): readonly string[] {
		if (!row) return [];
		const width = Math.max(1, this.lastWidth - visibleWidth(GUTTER));
		const sections = [
			...(row.description ? [row.description] : []),
			...(row.command ? [`$ ${row.command}`] : []),
			...(row.output
				? [row.output]
				: [row.kind === "agent" ? "Use /agents for the live transcript and controls." : "No output yet."]),
		];
		return sections.flatMap((section, index) => [
			...(index > 0 ? [""] : []),
			...section.split(/\r?\n/gu).flatMap((line) => wrapTextWithAnsi(line || " ", width)),
		]);
	}
}

export function createTasksDialogView(
	runtime: BackgroundWorkRuntime,
	sources: CurrentWorkSources,
): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new TasksDialogComponent(runtime, sources, context),
	};
}
