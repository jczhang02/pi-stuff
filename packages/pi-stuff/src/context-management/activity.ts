import { randomUUID } from "node:crypto";
import type { CustomEntry, EntryRenderer, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { boundTerminalLine, boundTerminalText } from "../tool-display/terminal.js";

export const CONTEXT_ACTIVITY_ENTRY_TYPE = "pi-stuff-context-activity";

export type ContextOperation = "flush" | "recomp" | "upgrade" | "wrapup";
export type ContextActivityState = "error" | "info" | "running" | "success" | "warning";

export interface ContextActivityData {
	readonly detail: string;
	readonly id: string;
	readonly kind: "anchor" | "update";
	readonly operation: ContextOperation;
	readonly state: ContextActivityState;
	readonly summary: string;
	readonly version: 1;
}

interface MagicStatusMessage {
	readonly level?: string;
	readonly text?: string;
	readonly title?: string;
}

const DETAIL_MAX_CELLS = 12 * 1024;
const DETAIL_MAX_LINES = 80;
const SUMMARY_MAX_CELLS = 240;
const CONTEXT_OPERATIONS = new Set<ContextOperation>(["flush", "recomp", "upgrade", "wrapup"]);
const CONTEXT_STATES = new Set<ContextActivityState>(["error", "info", "running", "success", "warning"]);

function isActivityData(value: unknown): value is ContextActivityData {
	if (!value || typeof value !== "object") return false;
	const data = value as Partial<ContextActivityData>;
	return (
		data.version === 1 &&
		typeof data.id === "string" &&
		/^context-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(data.id) &&
		(data.kind === "anchor" || data.kind === "update") &&
		CONTEXT_OPERATIONS.has(data.operation as ContextOperation) &&
		CONTEXT_STATES.has(data.state as ContextActivityState) &&
		typeof data.summary === "string" &&
		typeof data.detail === "string"
	);
}

function asEntry(value: unknown): CustomEntry | undefined {
	if (!value || typeof value !== "object") return undefined;
	return value as CustomEntry;
}

function replaceLegacyCommands(text: string): string {
	return text
		.replaceAll("/ctx-session-upgrade", "/ctx upgrade")
		.replaceAll("/ctx-wrapup", "/ctx wrapup")
		.replaceAll("/ctx-recomp", "/ctx recomp")
		.replaceAll("/ctx-flush", "/ctx flush")
		.replaceAll("/ctx-status", "/ctx");
}

function cleanDetail(text: string): string {
	const cleaned = boundTerminalText(replaceLegacyCommands(text), DETAIL_MAX_CELLS)
		.replace(/^#{1,6}\s+/gmu, "")
		.replace(/^[-*]\s+/gmu, "")
		.replace(/\*\*/gu, "")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
	const lines = cleaned.split("\n");
	if (lines.length <= DETAIL_MAX_LINES) return cleaned;
	return `${lines.slice(0, DETAIL_MAX_LINES).join("\n").trimEnd()}\n…`;
}

function cleanSummary(text: string): string {
	return boundTerminalLine(replaceLegacyCommands(text), SUMMARY_MAX_CELLS) || "updated";
}

function normalizeActivityData(value: unknown): ContextActivityData | undefined {
	if (!isActivityData(value)) return undefined;
	return {
		...value,
		detail: cleanDetail(value.detail),
		summary: cleanSummary(value.summary),
	};
}

function firstMeaningfulLine(text: string): string {
	return (
		cleanDetail(text)
			.split("\n")
			.map((line) => line.trim())
			.find(
				(line) =>
					line.length > 0 &&
					!/^magic\s+(?:wrapup|recomp|recomp upgrade)$/iu.test(line) &&
					!/^session upgrade(?:\s*[—-].*)?$/iu.test(line) &&
					!/^\/ctx(?:\s+(?:flush|recomp|upgrade|wrapup))?$/iu.test(line),
			) ?? "updated"
	);
}

function summaryFor(operation: ContextOperation, message: MagicStatusMessage): string {
	const detail = cleanDetail(message.text ?? "");
	const lower = detail.toLowerCase();
	if (lower.includes("confirmation required")) return "confirmation required";
	if (lower.includes("invalid arguments")) return "invalid arguments";
	if (lower.includes("no active pi session")) return "no active session";
	if (lower.includes("unavailable")) return "unavailable";
	if (lower.includes("no pending operations")) return "nothing queued";
	if (lower.includes("already up to date")) return "already up to date";
	if (lower.includes("nothing to wrap up")) return "nothing to wrap up";
	const partialStart = /partial recomp started for range\s+([\d]+\s*-\s*[\d]+)/iu.exec(detail);
	if (partialStart) return `rebuilding range ${partialStart[1]?.replaceAll(/\s/gu, "")}`;
	if (lower.includes("historian recomp started")) return "rebuilding compartments";
	if (lower.includes("rebuilding compartments into the v2 format")) return "upgrading session history";
	if (lower.includes("re-organizing project memories")) return "reorganizing memories";
	if (lower.includes("eligible history is about")) return "planning history compaction";
	const chunk = /chunk\s+(\d+)\s*:\s*(.+?)(?:\.|$)/iu.exec(detail);
	if (chunk) return `chunk ${chunk[1]} · ${chunk[2]?.toLowerCase()}`;
	const wrapped = /wrapped up\s+([\d,]+)\s+messages?\s+into\s+([\d,]+)\s+compartments?/iu.exec(detail);
	if (wrapped) return `wrapped up ${wrapped[1]} messages into ${wrapped[2]} compartments`;
	const flushedCount = /flushed\s+([\d,]+)\s+pending ops?/iu.exec(detail);
	if (flushedCount) return `flushed ${flushedCount[1]} pending operations`;
	const flushed = /flushed:\s*(.+?)(?:\.|$)/iu.exec(detail);
	if (flushed) return `flushed ${flushed[1]?.toLowerCase()}`;
	const rebuilt = /persisted\s+([\d,]+)\s+compartments?/iu.exec(detail);
	if (rebuilt) return `rebuilt ${rebuilt[1]} compartments`;
	const upgraded = /rebuilt\s+([\d,]+)\s+legacy compartments?/iu.exec(detail);
	if (upgraded) return `upgraded ${upgraded[1]} compartments`;
	if (lower.includes("failed")) return "failed";
	if (lower.includes("partial")) return "partially complete";
	if (lower.includes("skipped")) return "skipped";
	const line = firstMeaningfulLine(detail).trim();
	return line.length > 0 ? line.charAt(0).toLowerCase() + line.slice(1) : `${operation} updated`;
}

function stateFor(message: MagicStatusMessage): ContextActivityState {
	if (message.level === "error") return "error";
	if (message.level === "warning") return "warning";
	if (message.level === "success") return "success";
	const lower = cleanDetail(message.text ?? message.title ?? "").toLowerCase();
	if (lower.includes("failed") || lower.includes("invalid arguments") || lower.includes("unavailable")) return "error";
	if (lower.includes("confirmation required") || lower.includes("skipped") || lower.includes("partial"))
		return "warning";
	if (
		lower.includes("complete") ||
		lower.includes("already up to date") ||
		lower.includes("nothing to wrap up") ||
		lower.includes("no pending operations") ||
		lower.includes("flushed") ||
		lower.includes("wrapped up")
	)
		return "success";
	if (
		lower.includes("started") ||
		lower.includes("rebuilding") ||
		lower.includes("re-organizing") ||
		lower.includes("eligible history") ||
		/\bchunk\s+\d+/u.test(lower)
	)
		return "running";
	return "info";
}

export function contextActivityUpdateFromMagic(
	operation: ContextOperation,
	message: MagicStatusMessage,
): Omit<ContextActivityData, "id" | "kind" | "operation" | "version"> {
	return {
		detail: cleanDetail(message.text ?? message.title ?? ""),
		state: stateFor(message),
		summary: summaryFor(operation, message),
	};
}

export function failedContextActivity(
	error: unknown,
): Omit<ContextActivityData, "id" | "kind" | "operation" | "version"> {
	const detail = cleanDetail(error instanceof Error ? error.message : String(error));
	return { detail, state: "error", summary: "failed" };
}

function stateColor(theme: Theme, state: ContextActivityState, text: string): string {
	if (state === "error") return theme.fg("error", text);
	if (state === "warning") return theme.fg("warning", text);
	if (state === "success") return theme.fg("success", text);
	return theme.fg(state === "running" ? "muted" : "accent", text);
}

function wrapIndented(text: string, width: number, indent: string, theme: Theme): string[] {
	const contentWidth = Math.max(8, width - visibleWidth(indent));
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (paragraph.trim() === "") {
			lines.push("");
			continue;
		}
		for (const line of wrapTextWithAnsi(paragraph, contentWidth)) {
			lines.push(`${indent}${theme.fg("muted", line)}`);
		}
	}
	return lines;
}

class ContextActivityComponent extends Text {
	private readonly expanded: boolean;
	private readonly id: string;
	private readonly registry: ContextActivityRegistry;
	private readonly theme: Theme;

	constructor(id: string, registry: ContextActivityRegistry, expanded: boolean, theme: Theme) {
		super("", 0, 0);
		this.expanded = expanded;
		this.id = id;
		this.registry = registry;
		this.theme = theme;
	}

	override render(width: number): string[] {
		const activity = this.registry.get(this.id);
		if (!activity) return [];
		const bullet = stateColor(this.theme, activity.state, "•");
		const title = this.theme.fg("toolTitle", this.theme.bold(`Context ${activity.operation}`));
		const summaryText = ` · ${activity.summary}`;
		const summary =
			activity.state === "error" || activity.state === "warning"
				? stateColor(this.theme, activity.state, summaryText)
				: this.theme.fg("muted", summaryText);
		const progress = activity.state === "running" ? this.theme.fg("dim", "…") : "";
		const first = truncateToWidth(` ${bullet} ${title}${summary}${progress}`, Math.max(1, width), "…");
		if (!this.expanded || activity.detail.length === 0) return [first];
		return [first, ...wrapIndented(activity.detail, width, "   ", this.theme)];
	}
}

export function isContextActivityRunning(activity: ContextActivityData | undefined): boolean {
	return activity?.state === "running";
}

export function isContextActivitySettled(activity: ContextActivityData | undefined): boolean {
	return activity?.state === "error" || activity?.state === "success" || activity?.state === "warning";
}

export class ContextActivityRegistry {
	private readonly activities = new Map<string, ContextActivityData>();
	private readonly requestRender: () => void;

	constructor(requestRender: () => void) {
		this.requestRender = requestRender;
	}

	create(operation: ContextOperation, summary = "starting"): ContextActivityData {
		const activity: ContextActivityData = {
			detail: "",
			id: `context-${randomUUID()}`,
			kind: "anchor",
			operation,
			state: "running",
			summary: cleanSummary(summary),
			version: 1,
		};
		this.activities.set(activity.id, activity);
		return activity;
	}

	get(id: string): ContextActivityData | undefined {
		return this.activities.get(id);
	}

	update(id: string, patch: Omit<ContextActivityData, "id" | "kind" | "operation" | "version">): ContextActivityData {
		const current = this.activities.get(id);
		if (!current) throw new Error(`Unknown Context activity: ${id}`);
		const next: ContextActivityData = {
			...current,
			...patch,
			detail: cleanDetail(patch.detail),
			kind: "update",
			summary: cleanSummary(patch.summary),
		};
		this.activities.set(id, next);
		this.requestRender();
		return next;
	}

	render: EntryRenderer<ContextActivityData> = (entry, options, theme) => {
		const custom = asEntry(entry);
		const data = custom ? normalizeActivityData(custom.data) : undefined;
		if (!data) return undefined;
		if (data.kind === "update") {
			this.activities.set(data.id, data);
			return undefined;
		}
		if (!this.activities.has(data.id)) this.activities.set(data.id, data);
		return new ContextActivityComponent(data.id, this, options.expanded, theme);
	};
}

export function initialContextActivitySummary(operation: ContextOperation, args: string): string {
	const target = boundTerminalLine(args, 120);
	if (operation === "wrapup") return target ? `keeping ${target} recent messages` : "keeping 20 recent messages";
	if (operation === "recomp") return target ? `rebuilding range ${target}` : "preparing full rebuild";
	if (operation === "upgrade") return "checking legacy history";
	return "applying queued drops";
}
