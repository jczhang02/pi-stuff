import { randomUUID } from "node:crypto";
import type { EntryRenderer, ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getCommandDialogCoordinator, requestUiRender } from "../conversation-ui/index.js";
import { isJsonInputObject, isJsonInputValue, type JsonInputValue } from "../shared/json-value.js";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import type { ToolArguments } from "../tool-display/activity.js";
import {
	activityKey,
	activityTarget,
	type SuiteToolPresentation,
	singleActivity,
	type ToolActivityMetadata,
} from "../tool-display/index.js";
import { boundTerminalLine, boundTerminalText } from "../tool-display/terminal.js";
import {
	type ContextDialogCommand,
	type ContextDialogSnapshot,
	createContextDialogView,
	type MagicStatusMessage,
	statusSnapshotFromMagic,
} from "./dialog.js";

export const CONTEXT_ACTIVITY_ENTRY_TYPE = "pi-stuff-context-activity";

export type ContextOperation = "flush" | "recomp" | "upgrade" | "wrapup";
export type ContextActivityState = "error" | "info" | "running" | "success" | "warning";

export const MAGIC_TOOL_LABELS = new Map<string, string>([
	["ctx_expand", "Context expand"],
	["ctx_memory", "Context memory"],
	["ctx_note", "Context note"],
	["ctx_reduce", "Context reduce"],
	["ctx_search", "Context search"],
]);
export const MAGIC_TOOL_NAMES = [...MAGIC_TOOL_LABELS.keys()];
export const MAGIC_TOOL_NAME_SET = new Set(MAGIC_TOOL_NAMES);
const MAGIC_TOOL_CATEGORIES = new Map<string, ToolActivityMetadata<ToolArguments, unknown>["categories"]>([
	["ctx_expand", ["review-history-range"]],
	["ctx_memory", ["read-memory", "save-memory", "update-memory"]],
	["ctx_note", ["read-note", "save-note", "update-note"]],
	["ctx_search", ["search-history"]],
]);

const CONTEXT_COMMAND_USAGE = "/ctx [status|flush|wrapup [N]|recomp [start-end]|upgrade]";

function subcommand<const Name extends string>(value: Name, description: string) {
	return { description, label: value, value };
}

const CONTEXT_SUBCOMMANDS = [
	subcommand("status", "Open Context status and actions"),
	subcommand("flush", "Apply queued drops on the next message"),
	subcommand("wrapup", "Compact older history; keep 20 messages by default"),
	subcommand("recomp", "Rebuild compartments from raw history"),
	subcommand("upgrade", "Upgrade legacy session history and memories"),
] as const;
const CONTEXT_COMMAND_NAMES = {
	flush: "ctx-flush",
	recomp: "ctx-recomp",
	status: "ctx-status",
	upgrade: "ctx-session-upgrade",
	wrapup: "ctx-wrapup",
} as const;
export const MAGIC_COMMAND_NAMES: ReadonlySet<string> = new Set(Object.values(CONTEXT_COMMAND_NAMES));
const BACKGROUND_OPERATIONS = new Set<ContextOperation>(["recomp", "upgrade"]);
const OPERATION_BY_MAGIC_TITLE = new Map<string, ContextOperation>([
	["/ctx-flush", "flush"],
	["/ctx-recomp", "recomp"],
	["/ctx-session-upgrade", "upgrade"],
	["/ctx-wrapup", "wrapup"],
]);

export interface MagicCommandDefinition {
	readonly handler?: (args: string, ctx: ExtensionContext) => Promise<void> | void;
}

interface ContextCommandRuntimeOptions {
	readonly activate: (ctx: ExtensionContext) => Promise<void>;
	readonly commands: ReadonlyMap<string, MagicCommandDefinition>;
	readonly currentContext: () => ExtensionContext | undefined;
	readonly error: () => string | undefined;
	readonly quietContext: (name: string, ctx: ExtensionContext) => ExtensionContext;
}

interface ContextActivityTarget {
	detached?: boolean;
	readonly id: string;
	readonly operation: ContextOperation;
	readonly sessionId: string;
}

export interface ContextActivityData {
	readonly detail: string;
	readonly id: string;
	readonly kind: "anchor" | "update";
	readonly operation: ContextOperation;
	readonly state: ContextActivityState;
	readonly summary: string;
	readonly version: 1;
}

const DETAIL_MAX_CELLS = 12 * 1024;
const DETAIL_MAX_LINES = 80;
const SUMMARY_MAX_CELLS = 240;

function isContextOperation(value: JsonInputValue): value is ContextOperation {
	return value === "flush" || value === "recomp" || value === "upgrade" || value === "wrapup";
}

function isContextActivityState(value: JsonInputValue): value is ContextActivityState {
	return value === "error" || value === "info" || value === "running" || value === "success" || value === "warning";
}

function activityEntryData<Value>(value: Value): JsonInputValue | undefined {
	if (!value || !isRuntimeObject(value) || !("data" in value) || !isJsonInputValue(value.data)) return undefined;
	return value.data;
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

function normalizeActivityData(value: JsonInputValue): ContextActivityData | undefined {
	if (!isJsonInputObject(value)) return undefined;
	const { detail, id, kind, operation, state, summary, version } = value;
	if (
		version !== 1 ||
		!isRuntimeString(id) ||
		!/^context-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(id) ||
		(kind !== "anchor" && kind !== "update") ||
		!isContextOperation(operation) ||
		!isContextActivityState(state) ||
		!isRuntimeString(summary) ||
		!isRuntimeString(detail)
	) {
		return undefined;
	}
	return {
		detail: cleanDetail(detail),
		id,
		kind,
		operation,
		state,
		summary: cleanSummary(summary),
		version,
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
	if (/(?:failed|invalid arguments|unavailable)/u.test(lower)) return "error";
	if (/(?:confirmation required|skipped)/u.test(lower)) return "warning";
	if (/(?:complete|already up to date|nothing to wrap up|no pending operations|flushed|wrapped up)/u.test(lower))
		return "success";
	if (/(?:started|rebuilding|re-organizing|eligible history|\bchunk\s+\d+)/u.test(lower)) return "running";
	if (lower.includes("partial")) return "warning";
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
	cause: unknown,
): Omit<ContextActivityData, "id" | "kind" | "operation" | "version"> {
	const detail = cleanDetail(cause instanceof Error ? cause.message : String(cause));
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

	render: EntryRenderer<unknown> = (entry, options, theme) => {
		const entryData = activityEntryData(entry);
		const data = entryData === undefined ? undefined : normalizeActivityData(entryData);
		if (!data) return undefined;
		if (data.kind === "update") {
			this.activities.set(data.id, data);
			return undefined;
		}
		if (!this.activities.has(data.id)) this.activities.set(data.id, data);
		return new ContextActivityComponent(data.id, this, options.expanded, theme);
	};
}

function isMagicStatusMessage(value: JsonInputValue): value is JsonInputValue & MagicStatusMessage {
	if (!isJsonInputObject(value)) return false;
	return [value["level"], value["text"], value["title"]].every(
		(property) => property === undefined || isRuntimeString(property),
	);
}

export class ContextCommandRuntime {
	private active: ContextActivityTarget | undefined;
	private readonly activities: ContextActivityRegistry;
	private readonly background = new Map<ContextOperation, ContextActivityTarget>();
	private capturedStatus: MagicStatusMessage | undefined;
	private readonly options: ContextCommandRuntimeOptions;
	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI, options: ContextCommandRuntimeOptions) {
		this.pi = pi;
		this.options = options;
		this.activities = new ContextActivityRegistry(() => requestUiRender(pi));
		pi.registerEntryRenderer(CONTEXT_ACTIVITY_ENTRY_TYPE, this.activities.render);
		pi.registerCommand("ctx", {
			description: "Inspect and maintain Context · status | flush | wrapup [N] | recomp [start-end] | upgrade",
			getArgumentCompletions: (prefix) => {
				const normalized = prefix.trimStart().toLowerCase();
				if (/\s/u.test(normalized)) return null;
				return CONTEXT_SUBCOMMANDS.filter((item) => item.value.startsWith(normalized)).map((item) => ({ ...item }));
			},
			handler: (args, ctx) => this.dispatch(args, ctx),
		});
		pi.on("session_before_switch", (_event, ctx) => this.detachBackground(ctx));
		pi.on("session_before_fork", (_event, ctx) => this.detachBackground(ctx));
	}

	async dispatch(raw: string, ctx: ExtensionContext): Promise<void> {
		const input = raw.trim();
		const separator = input.search(/\s/u);
		const requested = (separator < 0 ? input : input.slice(0, separator)).toLowerCase() || "status";
		const args = separator < 0 ? "" : input.slice(separator).trim();
		if (requested !== "status" && !isContextOperation(requested)) {
			ctx.ui.notify(`Usage: ${CONTEXT_COMMAND_USAGE}`, "warning");
			return;
		}
		await this.options.activate(ctx);
		if (requested === "status") await this.showStatusDialog(ctx);
		else await this.runMaintenance(requested, args, ctx);
	}

	clearActive(): void {
		this.active = undefined;
	}

	detachBackground(ctx: ExtensionContext): void {
		let sessionId: string;
		try {
			sessionId = ctx.sessionManager.getSessionId();
		} catch {
			return;
		}
		for (const target of this.background.values()) {
			if (target.sessionId !== sessionId || target.detached) continue;
			const current = this.activities.get(target.id);
			if (!current || isContextActivitySettled(current)) continue;
			target.detached = true;
			const update = this.activities.update(target.id, {
				detail:
					"The operation continues in the background, but Pi Stuff cannot attach later display updates after leaving this Session. Open /ctx when you return to inspect the current state.",
				state: "warning",
				summary: "continuing after Session switch",
			});
			this.pi.appendEntry(CONTEXT_ACTIVITY_ENTRY_TYPE, update);
		}
	}

	captureStatus(value: JsonInputValue): void {
		if (!isMagicStatusMessage(value)) return;
		if (value.title === "/ctx-status") {
			this.capturedStatus = value;
			return;
		}
		const operation = value.title ? OPERATION_BY_MAGIC_TITLE.get(value.title) : undefined;
		if (!operation) return;
		const activity = this.active?.operation === operation ? this.active : this.background.get(operation);
		if (!activity) return;
		const update = this.updateActivity(activity, contextActivityUpdateFromMagic(activity.operation, value));
		if (BACKGROUND_OPERATIONS.has(operation)) {
			if (!isContextActivitySettled(update)) this.background.set(operation, activity);
			else if (this.background.get(operation)?.id === activity.id) {
				this.background.delete(operation);
			}
		}
	}

	private async runMaintenance(
		operation: ContextOperation,
		args: string,
		ctx: ExtensionContext,
		options: { readonly confirmed?: boolean } = {},
	): Promise<void> {
		const name = CONTEXT_COMMAND_NAMES[operation];
		const target = this.startActivity(operation, args, ctx);
		const handler = this.options.commands.get(name)?.handler;
		if (!handler) {
			this.updateActivity(target, {
				detail: this.options.error() ?? "Magic Context is unavailable; Pi native context remains active.",
				state: "error",
				summary: "unavailable",
			});
			return;
		}
		const running = this.background.get(operation);
		if (running) {
			const elsewhere = running.sessionId === target.sessionId ? "" : " in another Session";
			this.updateActivity(target, {
				detail: `A Context ${operation} operation is already running${elsewhere}. Wait for it to finish before starting another.`,
				state: "warning",
				summary: `already running${elsewhere.toLowerCase()}`,
			});
			return;
		}
		this.active = target;
		if (BACKGROUND_OPERATIONS.has(operation)) this.background.set(operation, target);
		try {
			await handler(args, this.options.quietContext(name, ctx));
			const firstResult = this.activities.get(target.id);
			if (
				operation === "recomp" &&
				options.confirmed === true &&
				firstResult?.state === "warning" &&
				firstResult.summary === "confirmation required"
			) {
				await handler(args, this.options.quietContext(name, ctx));
			}
			const current = this.activities.get(target.id);
			if (current && isContextActivityRunning(current) && !BACKGROUND_OPERATIONS.has(operation)) {
				this.updateActivity(target, { detail: current.detail, state: "success", summary: "complete" });
			}
		} catch (error) {
			this.updateActivity(target, failedContextActivity(error));
			if (this.background.get(operation)?.id === target.id) this.background.delete(operation);
		} finally {
			if (this.active?.id === target.id) this.active = undefined;
			if (
				BACKGROUND_OPERATIONS.has(operation) &&
				isContextActivitySettled(this.activities.get(target.id)) &&
				!target.detached &&
				this.background.get(operation)?.id === target.id
			) {
				this.background.delete(operation);
			}
		}
	}

	private startActivity(operation: ContextOperation, args: string, ctx: ExtensionContext): ContextActivityTarget {
		const activity = this.activities.create(operation, initialContextActivitySummary(operation, args));
		const target = { id: activity.id, operation, sessionId: ctx.sessionManager.getSessionId() };
		this.appendActivity(target, activity);
		return target;
	}

	private updateActivity(
		target: ContextActivityTarget,
		patch: Parameters<ContextActivityRegistry["update"]>[1],
	): ContextActivityData {
		const update = this.activities.update(target.id, patch);
		this.appendActivity(target, update);
		return update;
	}

	private appendActivity(target: ContextActivityTarget, data: ContextActivityData): void {
		let currentSessionId: string | undefined;
		try {
			currentSessionId = this.options.currentContext()?.sessionManager.getSessionId();
		} catch {
			// A stale Host context must not route an Activity into an unknown Session.
		}
		if (currentSessionId === target.sessionId) this.pi.appendEntry(CONTEXT_ACTIVITY_ENTRY_TYPE, data);
	}

	private async showStatusDialog(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			ctx.ui.notify("The Context dialog is available in interactive TUI sessions.", "warning");
			return;
		}
		const snapshot = await this.readStatusSnapshot(ctx);
		const command = await getCommandDialogCoordinator(this.pi).show<ContextDialogCommand>(
			ctx,
			createContextDialogView(snapshot, { refresh: () => this.readStatusSnapshot(ctx) }),
			{ restoreDraft: false },
		);
		if (command) {
			await this.runMaintenance(command.operation, command.args, ctx, { confirmed: command.confirmed === true });
		}
	}

	private async readStatusSnapshot(ctx: ExtensionContext): Promise<ContextDialogSnapshot> {
		const handler = this.options.commands.get(CONTEXT_COMMAND_NAMES.status)?.handler;
		const usage = this.contextUsage(ctx);
		if (!handler) {
			return statusSnapshotFromMagic(
				undefined,
				usage,
				this.options.error() ?? "Magic Context is unavailable; Pi native context remains active.",
			);
		}
		this.capturedStatus = undefined;
		try {
			await handler("", this.options.quietContext(CONTEXT_COMMAND_NAMES.status, ctx));
			return statusSnapshotFromMagic(this.capturedStatus, usage);
		} catch (error) {
			return statusSnapshotFromMagic(
				this.capturedStatus,
				usage,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.capturedStatus = undefined;
		}
	}

	private contextUsage(ctx: ExtensionContext) {
		try {
			return ctx.getContextUsage?.();
		} catch {
			return undefined;
		}
	}
}

export function initialContextActivitySummary(operation: ContextOperation, args: string): string {
	const target = boundTerminalLine(args, 120);
	if (operation === "wrapup") return target ? `keeping ${target} recent messages` : "keeping 20 recent messages";
	if (operation === "recomp") return target ? `rebuilding range ${target}` : "preparing full rebuild";
	if (operation === "upgrade") return "checking legacy history";
	return "applying queued drops";
}

function firstPresentationTarget(args: ToolArguments): string {
	for (const key of ["query", "message", "note_id", "memory_id", "id", "range", "content", "note", "reason"]) {
		const value = args[key];
		if (isRuntimeString(value) && value.trim()) return value.trim();
	}
	const ids = args["ids"];
	if (Array.isArray(ids) && ids.length > 0) return ids.map(String).join(", ");
	const { end, start } = args;
	return isRuntimeNumber(start) && isRuntimeNumber(end) ? `${String(start)}-${String(end)}` : "";
}

function toolResultText(result: { readonly content?: readonly unknown[] } | undefined): string {
	if (!Array.isArray(result?.content)) return "";
	return result.content
		.map((item) =>
			item && isRuntimeObject(item) && "type" in item && item.type === "text" && "text" in item
				? String(item.text)
				: "",
		)
		.filter(Boolean)
		.join("\n");
}

function resultObjectIds(text: string, kind: "memory" | "note"): readonly string[] {
	const patterns = kind === "memory" ? [/\[ID:\s*(\d+)\]/giu, /(?:^|\s)#(\d+)\s*:/gmu] : [/(?:note\s+|\*\*)#(\d+)/giu];
	const ids = new Set<string>();
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			if (match[1]) ids.add(match[1]);
		}
	}
	return [...ids];
}

function objectActivity(
	category: "read-memory" | "read-note" | "save-memory" | "save-note" | "update-memory" | "update-note",
	ids: readonly string[],
	fallbackKey: string,
	target: string,
) {
	return [
		{
			category,
			countKeys: ids.length > 0 ? ids.map((id) => `${category}:${id}`) : [`${category}:${fallbackKey}`],
			target: activityTarget(target),
		},
	] as const;
}

export function magicToolPresentation(name: string): SuiteToolPresentation<ToolArguments, unknown> {
	const activity: ToolActivityMetadata<ToolArguments, unknown> = {
		categories: MAGIC_TOOL_CATEGORIES.get(name) ?? [],
		classify: ({ args, result }) => {
			const target = firstPresentationTarget(args);
			const text = toolResultText(result);
			if (name === "ctx_reduce") return [];
			if (name === "ctx_expand") {
				const key = activityKey(args["message"], args["start"], args["end"], args["verbose"]);
				return singleActivity("review-history-range", { key, target: target || String(args["message"] ?? "") });
			}
			if (name === "ctx_search") {
				return singleActivity("search-history", {
					key: activityKey(args["query"], args["sources"]),
					target,
				});
			}
			const kind = name === "ctx_memory" ? "memory" : "note";
			const action = String(
				args["action"] ?? (kind === "note" && isRuntimeString(args["content"]) ? "write" : "read"),
			);
			const reads = kind === "memory" ? action === "get" || action === "list" : action === "read";
			const verb = reads ? "read" : action === "write" ? "save" : "update";
			const idArgument = kind === "memory" ? args["ids"] : args["note_id"];
			const argumentIds = Array.isArray(idArgument)
				? idArgument.filter((item): item is number => isRuntimeNumber(item)).map(String)
				: isRuntimeNumber(idArgument)
					? [String(idArgument)]
					: [];
			const ids = [...new Set([...argumentIds, ...resultObjectIds(text, kind)])];
			return objectActivity(
				`${verb}-${kind}`,
				ids,
				activityKey(action, idArgument, args["content"]),
				target || action,
			);
		},
		summarizeIssue: (_args, result, state) => toolResultText(result).trim().split(/\r?\n/u)[0] || state,
	};
	return {
		activity: name === "ctx_reduce" ? { ...activity, silentSuccess: true } : activity,
		label: MAGIC_TOOL_LABELS.get(name) ?? name,
		runningSummary: name === "ctx_search" ? "searching" : "working",
		target: firstPresentationTarget,
	};
}
