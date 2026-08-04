import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MAX_DYNAMIC_TEXT_CODE_UNITS = 16 * 1024;
const NARROW_MIN_WIDTH = 48;
const WIDE_MIN_WIDTH = 92;

interface WelcomeHeaderToggle {
	get(): boolean;
}

export interface WelcomeHeaderInventory {
	readonly contextFiles: number | undefined;
	readonly extensions: number;
	readonly skills: number;
	readonly tools: number;
}

export interface WelcomeHeaderInventorySource {
	get(): WelcomeHeaderInventory;
	subscribe(listener: () => void): () => void;
}

export interface WelcomeHeaderControllerOptions {
	readonly enabled: WelcomeHeaderToggle;
	readonly inventory: WelcomeHeaderInventorySource;
}

/**
 * Registry-backed inventory available through Pi 0.83's public Extension API.
 * Context-file count is supplied later from `before_agent_start` because the
 * Host does not expose it on `ExtensionContext` during initial startup.
 */
export class WelcomeRegistrySource implements WelcomeHeaderInventorySource {
	private contextFiles: number | undefined;
	private inventory: WelcomeHeaderInventory;
	private readonly listeners = new Set<() => void>();
	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI, contextFiles?: number) {
		this.pi = pi;
		this.contextFiles = normalizeCount(contextFiles);
		this.inventory = readWelcomeRegistryInventory(pi, this.contextFiles);
	}

	get(): WelcomeHeaderInventory {
		return this.inventory;
	}

	refresh(): void {
		this.set(readWelcomeRegistryInventory(this.pi, this.contextFiles));
	}

	setContextFileCount(count: number | undefined): void {
		const normalized = normalizeCount(count);
		if (this.contextFiles === normalized) return;
		this.contextFiles = normalized;
		this.set({ ...this.inventory, contextFiles: normalized });
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(next: WelcomeHeaderInventory): void {
		if (sameInventory(this.inventory, next)) return;
		this.inventory = next;
		for (const listener of this.listeners) callObserver(listener);
	}
}

/** Read the exact public registries and count registry-visible extensions. */
export function readWelcomeRegistryInventory(
	pi: Pick<ExtensionAPI, "getAllTools" | "getCommands">,
	contextFiles?: number,
): WelcomeHeaderInventory {
	const commands = pi.getCommands();
	const tools = pi.getAllTools();
	const extensionPaths = new Set<string>();
	const skills = new Set<string>();
	for (const command of commands) {
		if (command.source === "skill") skills.add(command.name);
		if (command.source === "extension") extensionPaths.add(command.sourceInfo.path);
	}
	for (const tool of tools) {
		if (tool.sourceInfo.source === "builtin" || tool.sourceInfo.source === "sdk") continue;
		extensionPaths.add(tool.sourceInfo.path);
	}
	return {
		contextFiles: normalizeCount(contextFiles),
		extensions: extensionPaths.size,
		skills: skills.size,
		tools: tools.length,
	};
}

/**
 * Captures the Welcome setting once so changing it in `/ui` takes effect only
 * on the next launch, while live model and inventory data may still repaint.
 */
export class WelcomeHeaderController {
	readonly enabledAtLaunch: boolean;
	private readonly ctx: ExtensionContext;
	private readonly inventory: WelcomeHeaderInventorySource;

	constructor(ctx: ExtensionContext, options: WelcomeHeaderControllerOptions) {
		this.ctx = ctx;
		this.inventory = options.inventory;
		this.enabledAtLaunch = options.enabled.get();
	}

	createHeader(tui: TUI, theme: Theme): Component & { dispose(): void } {
		return new WelcomeHeaderComponent(this.ctx, tui, theme, this.inventory, this.enabledAtLaunch);
	}
}

class WelcomeHeaderComponent implements Component {
	private readonly ctx: ExtensionContext;
	private disposed = false;
	private readonly enabled: boolean;
	private readonly inventory: WelcomeHeaderInventorySource;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly unsubscribe: () => void;

	constructor(
		ctx: ExtensionContext,
		tui: TUI,
		theme: Theme,
		inventory: WelcomeHeaderInventorySource,
		enabled: boolean,
	) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.inventory = inventory;
		this.enabled = enabled;
		try {
			this.unsubscribe = inventory.subscribe(() => callObserver(() => this.tui.requestRender()));
		} catch {
			this.unsubscribe = () => {};
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		callObserver(this.unsubscribe);
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.disposed || !this.enabled) return [];
		const renderWidth = Math.max(0, Math.floor(width));
		if (renderWidth < 1) return [];
		const inventory = this.inventory.get();
		if (renderWidth >= WIDE_MIN_WIDTH) return wideLines(this.ctx, inventory, this.theme, renderWidth);
		if (renderWidth >= NARROW_MIN_WIDTH) return narrowLines(this.ctx, inventory, this.theme, renderWidth);
		return ultraNarrowLines(this.ctx, this.theme, renderWidth);
	}
}

function wideLines(ctx: ExtensionContext, inventory: WelcomeHeaderInventory, theme: Theme, width: number): string[] {
	const divider = theme.fg("borderMuted", "─".repeat(width));
	const rightColumn = 42;
	const title = `  ${theme.fg("accent", theme.bold("π"))}  ${theme.bold("Welcome back!")}`;
	const model = modelIdentity(ctx, theme, "     ");
	const path = `     ${theme.fg("muted", displayCwd(ctx))}`;
	const loaded = theme.fg("muted", theme.bold("Loaded"));
	const tips = theme.fg("muted", theme.bold("Tips"));
	return [
		divider,
		joinColumns(title, loaded, rightColumn, width),
		joinColumns(model, wideInventory(inventory, theme), rightColumn, width),
		joinColumns(path, tips, rightColumn, width),
		joinColumns("", tipLine(theme, Math.max(0, width - rightColumn)), rightColumn, width),
		divider,
	];
}

function narrowLines(ctx: ExtensionContext, inventory: WelcomeHeaderInventory, theme: Theme, width: number): string[] {
	const divider = theme.fg("borderMuted", "─".repeat(width));
	const separator = theme.fg("dim", " · ");
	const identity = [
		`  ${theme.fg("accent", theme.bold("π"))} ${theme.bold("Welcome back!")}`,
		modelIdentity(ctx, theme),
	]
		.filter(Boolean)
		.join(separator);
	const orientation = narrowOrientation(ctx, inventory, theme, width, separator);
	return [
		divider,
		clip(identity, width),
		clip(orientation, width),
		`  ${tipLine(theme, Math.max(0, width - 2))}`,
		divider,
	];
}

function narrowOrientation(
	ctx: ExtensionContext,
	inventory: WelcomeHeaderInventory,
	theme: Theme,
	width: number,
	separator: string,
): string {
	const gutter = "  ";
	const available = Math.max(1, width - visibleWidth(gutter));
	const path = abbreviatePath(displayCwd(ctx));
	const minimumPathWidth = Math.min(12, Math.max(1, available - visibleWidth(separator) - 1));
	const inventoryCandidates = [compactInventory(inventory, theme), terseInventory(inventory, theme)] as const;
	const inventoryText =
		inventoryCandidates.find(
			(candidate) => visibleWidth(candidate) <= available - visibleWidth(separator) - minimumPathWidth,
		) ?? inventoryCandidates[1];
	const inventoryWidth = Math.min(
		visibleWidth(inventoryText),
		Math.max(1, available - visibleWidth(separator) - minimumPathWidth),
	);
	const pathWidth = Math.max(1, available - visibleWidth(separator) - inventoryWidth);
	return `${gutter}${theme.fg("muted", truncateToWidth(path, pathWidth, "…"))}${separator}${truncateToWidth(
		inventoryText,
		inventoryWidth,
		"…",
	)}`;
}

function ultraNarrowLines(ctx: ExtensionContext, theme: Theme, width: number): string[] {
	const divider = theme.fg("borderMuted", "─".repeat(width));
	const model = sanitizeOneLine(ctx.model?.id ?? "");
	const identity =
		theme.fg("accent", theme.bold("π")) +
		` ${theme.bold("Welcome back!")}` +
		(model ? `${theme.fg("dim", " · ")}${theme.fg("accent", model)}` : "");
	return [divider, clip(identity, width), divider];
}

function modelIdentity(ctx: ExtensionContext, theme: Theme, prefix = ""): string {
	const model = sanitizeOneLine(ctx.model?.id ?? "");
	if (!model) return "";
	const provider = sanitizeOneLine(ctx.model?.provider ?? "");
	return `${prefix}${theme.fg("accent", model)}${provider ? theme.fg("dim", ` · ${provider}`) : ""}`;
}

function wideInventory(inventory: WelcomeHeaderInventory, theme: Theme): string {
	const segments: string[] = [];
	if (inventory.contextFiles !== undefined) {
		segments.push(`${theme.fg("text", "Context files")} ${theme.fg("accent", String(inventory.contextFiles))}`);
	}
	segments.push(`${theme.fg("text", "Extensions")} ${theme.fg("accent", String(inventory.extensions))}`);
	segments.push(`${theme.fg("text", "Tools")} ${theme.fg("accent", String(inventory.tools))}`);
	segments.push(`${theme.fg("text", "Skills")} ${theme.fg("accent", String(inventory.skills))}`);
	return segments.join(theme.fg("dim", " · "));
}

function compactInventory(inventory: WelcomeHeaderInventory, theme: Theme): string {
	const segments: string[] = [];
	if (inventory.contextFiles !== undefined) {
		segments.push(`${theme.fg("accent", String(inventory.contextFiles))} ${theme.fg("muted", "context")}`);
	}
	segments.push(`${theme.fg("accent", String(inventory.extensions))} ${theme.fg("muted", "ext")}`);
	segments.push(`${theme.fg("accent", String(inventory.tools))} ${theme.fg("muted", "tools")}`);
	segments.push(`${theme.fg("accent", String(inventory.skills))} ${theme.fg("muted", "skills")}`);
	return segments.join(theme.fg("dim", " · "));
}

function terseInventory(inventory: WelcomeHeaderInventory, theme: Theme): string {
	const segments: string[] = [];
	if (inventory.contextFiles !== undefined) segments.push(theme.fg("accent", `${String(inventory.contextFiles)}c`));
	segments.push(theme.fg("accent", `${String(inventory.extensions)}e`));
	segments.push(theme.fg("accent", `${String(inventory.tools)}t`));
	segments.push(theme.fg("accent", `${String(inventory.skills)}s`));
	return segments.join(theme.fg("dim", " · "));
}

function tipLine(theme: Theme, width: number): string {
	const actions = [
		`${theme.fg("accent", "/tools")} ${theme.fg("muted", "details")}`,
		`${theme.fg("accent", "/ui")} ${theme.fg("muted", "appearance")}`,
		`${theme.fg("accent", "Shift+Tab")} ${theme.fg("muted", "thinking")}`,
	];
	const separator = theme.fg("dim", " · ");
	const selected: string[] = [];
	for (const action of actions) {
		const candidate = [...selected, action].join(separator);
		if (visibleWidth(candidate) > width) break;
		selected.push(action);
	}
	return selected.join(separator);
}

function displayCwd(ctx: ExtensionContext): string {
	const cwd = sanitizeOneLine(ctx.sessionManager.getCwd()) || sanitizeOneLine(ctx.cwd) || ".";
	const home = sanitizeOneLine(homedir());
	return home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
}

function abbreviatePath(path: string): string {
	const pieces = path.split("/");
	if (pieces.length <= 3) return path;
	return pieces
		.map((piece, index) => (index > 0 && index < pieces.length - 1 ? abbreviatedPathPiece(piece) : piece))
		.join("/");
}

function abbreviatedPathPiece(value: string): string {
	if (value.startsWith(".") && value.length > 1) return `.${firstGrapheme(value.slice(1))}`;
	return firstGrapheme(value);
}

function firstGrapheme(value: string): string {
	return GRAPHEME_SEGMENTER.segment(value)[Symbol.iterator]().next().value?.segment ?? "";
}

function joinColumns(left: string, right: string, startColumn: number, width: number): string {
	if (!right) return clip(left, width);
	const normalizedWidth = Math.max(1, Math.floor(width));
	const rightStart = Math.min(Math.max(1, startColumn), Math.max(1, normalizedWidth - 1));
	const leftBudget = Math.max(0, rightStart - 2);
	const fittedLeft = truncateToWidth(left, leftBudget, "…");
	const gap = " ".repeat(Math.max(1, rightStart - visibleWidth(fittedLeft)));
	const rightBudget = Math.max(0, normalizedWidth - visibleWidth(fittedLeft) - visibleWidth(gap));
	return `${fittedLeft}${gap}${truncateToWidth(right, rightBudget, "…")}`;
}

function clip(line: string, width: number): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function normalizeCount(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.max(0, Math.floor(value));
}

function sameInventory(left: WelcomeHeaderInventory, right: WelcomeHeaderInventory): boolean {
	return (
		left.contextFiles === right.contextFiles &&
		left.extensions === right.extensions &&
		left.tools === right.tools &&
		left.skills === right.skills
	);
}

function callObserver(observer: () => void): void {
	try {
		observer();
	} catch {
		// Welcome presentation observers are recoverable and independent.
	}
}

function sanitizeOneLine(value: string): string {
	return stripTerminalControls(value.slice(0, MAX_DYNAMIC_TEXT_CODE_UNITS)).replace(/\s+/gu, " ").trim();
}

function stripTerminalControls(value: string): string {
	let text = "";
	let index = 0;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x1b) {
			const introducer = value.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index = skipControlSequence(value, index + 2);
				continue;
			}
			if (isStringControl(introducer)) {
				index = skipControlString(value, index + 2);
				continue;
			}
			index += 1;
			while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) index += 1;
			if (index < value.length) index += 1;
			continue;
		}
		if (code === 0x9b) {
			index = skipControlSequence(value, index + 1);
			continue;
		}
		if (isC1StringControl(code)) {
			index = skipControlString(value, index + 1);
			continue;
		}
		if (isBidiControl(code) || code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			text += " ";
			index += 1;
			continue;
		}
		const point = value.codePointAt(index);
		if (point === undefined) break;
		text += String.fromCodePoint(point);
		index += point > 0xffff ? 2 : 1;
	}
	return text;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });

function skipControlSequence(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index++);
		if (code >= 0x40 && code <= 0x7e) break;
	}
	return index;
}

function skipControlString(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x07 || code === 0x9c) return index + 1;
		if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
		index += 1;
	}
	return index;
}

function isStringControl(code: number): boolean {
	return code === 0x5d || code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f;
}

function isC1StringControl(code: number): boolean {
	return code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f;
}

function isBidiControl(code: number): boolean {
	return (
		code === 0x061c ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
}
