import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MAX_DYNAMIC_TEXT_CODE_UNITS = 16 * 1024;
const MIN_BOX_WIDTH = 13;
const WIDE_LEFT_COLUMN_WIDTH = 52;
const WIDE_MIN_WIDTH = 70;

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
		return narrowLines(this.ctx, this.theme, renderWidth, terminalRows(this.tui));
	}
}

function wideLines(ctx: ExtensionContext, inventory: WelcomeHeaderInventory, theme: Theme, width: number): string[] {
	const rightWidth = Math.max(1, width - WIDE_LEFT_COLUMN_WIDTH - 3);
	const logo = piLogo(theme);
	const rightDivider = theme.fg("borderMuted", "─".repeat(Math.max(0, rightWidth - 2)));
	const counts = welcomeInventoryLines(inventory, theme);
	return [
		boxTop(theme, width, "Pi Stuff", true),
		wideBoxRow(theme, width, "", theme.bold("Tips for getting started")),
		wideBoxRow(theme, width, theme.bold("Welcome back!"), "Type / to browse commands"),
		wideBoxRow(theme, width, "", rightDivider),
		wideBoxRow(theme, width, logo[0] ?? "", theme.bold("Loaded")),
		wideBoxRow(theme, width, logo[1] ?? "", counts[0] ?? ""),
		wideBoxRow(theme, width, logo[2] ?? "", counts[1] ?? ""),
		wideBoxRow(theme, width, "", ""),
		wideBoxRow(theme, width, modelIdentity(ctx, theme, true), ""),
		wideBoxRow(theme, width, theme.fg("muted", displayCwd(ctx)), ""),
		boxBottom(theme, width),
	];
}

function narrowLines(ctx: ExtensionContext, theme: Theme, width: number, rows: number | undefined): string[] {
	if (width < MIN_BOX_WIDTH) return [clip(theme.bold("Pi Stuff"), width)];
	const logo = piLogo(theme);
	const provider = sanitizeOneLine(ctx.model?.provider ?? "");
	if (rows !== undefined && rows <= 16) {
		return [
			boxTop(theme, width, "Pi Stuff", false),
			boxRow(theme, width, theme.bold("Welcome back!")),
			boxRow(theme, width, ""),
			boxRow(theme, width, logo[0] ?? ""),
			boxRow(theme, width, logo[1] ?? ""),
			boxRow(theme, width, logo[2] ?? ""),
			boxRow(theme, width, modelIdentity(ctx, theme, false)),
			boxRow(theme, width, theme.fg("muted", abbreviatePath(displayCwd(ctx)))),
			boxRow(theme, width, ""),
			boxBottom(theme, width),
		];
	}
	if (rows !== undefined && rows <= 18) {
		return [
			boxTop(theme, width, "Pi Stuff", false),
			boxRow(theme, width, theme.bold("Welcome back!")),
			boxRow(theme, width, ""),
			boxRow(theme, width, logo[0] ?? ""),
			boxRow(theme, width, logo[1] ?? ""),
			boxRow(theme, width, logo[2] ?? ""),
			boxRow(theme, width, ""),
			boxRow(theme, width, modelIdentity(ctx, theme, false)),
			boxRow(theme, width, provider ? theme.fg("muted", provider) : ""),
			boxRow(theme, width, theme.fg("muted", abbreviatePath(displayCwd(ctx)))),
			boxRow(theme, width, ""),
			boxBottom(theme, width),
		];
	}
	return [
		boxTop(theme, width, "Pi Stuff", false),
		boxRow(theme, width, ""),
		boxRow(theme, width, theme.bold("Welcome back!")),
		boxRow(theme, width, ""),
		boxRow(theme, width, logo[0] ?? ""),
		boxRow(theme, width, logo[1] ?? ""),
		boxRow(theme, width, logo[2] ?? ""),
		boxRow(theme, width, ""),
		boxRow(theme, width, modelIdentity(ctx, theme, false)),
		boxRow(theme, width, provider ? theme.fg("muted", provider) : ""),
		boxRow(theme, width, theme.fg("muted", abbreviatePath(displayCwd(ctx)))),
		boxRow(theme, width, ""),
		boxBottom(theme, width),
	];
}

function terminalRows(tui: TUI): number | undefined {
	const rows = (tui as unknown as { terminal?: { rows?: unknown } }).terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : undefined;
}

function boxTop(theme: Theme, width: number, title: string, wide: boolean): string {
	const leading = wide ? "───" : "─";
	const titleText = ` ${title} `;
	const remaining = Math.max(0, width - visibleWidth(leading) - visibleWidth(titleText) - 2);
	return `${theme.fg("borderMuted", `╭${leading}`)}${theme.bold(titleText)}${theme.fg(
		"borderMuted",
		`${"─".repeat(remaining)}╮`,
	)}`;
}

function boxBottom(theme: Theme, width: number): string {
	return theme.fg("borderMuted", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
}

function boxRow(theme: Theme, width: number, content: string): string {
	const interiorWidth = Math.max(0, width - 2);
	return `${theme.fg("borderMuted", "│")}${centerCell(content, interiorWidth)}${theme.fg("borderMuted", "│")}`;
}

function wideBoxRow(theme: Theme, width: number, left: string, right: string): string {
	const rightWidth = Math.max(0, width - WIDE_LEFT_COLUMN_WIDTH - 3);
	return `${theme.fg("borderMuted", "│")}${centerCell(left, WIDE_LEFT_COLUMN_WIDTH, 3)}${theme.fg(
		"borderMuted",
		"│",
	)}${startCell(right, rightWidth)}${theme.fg("borderMuted", "│")}`;
}

function centerCell(content: string, width: number, minimumInset = 0): string {
	const inset = Math.min(Math.max(0, minimumInset), Math.floor(Math.max(0, width) / 2));
	const fitted = truncateToWidth(content, Math.max(0, width - inset * 2), "…");
	const padding = Math.max(0, width - visibleWidth(fitted));
	const left = Math.floor(padding / 2);
	return `${" ".repeat(left)}${fitted}${" ".repeat(padding - left)}`;
}

function startCell(content: string, width: number): string {
	if (width < 1) return "";
	const fitted = truncateToWidth(content, Math.max(0, width - 2), "…");
	const line = ` ${fitted}`;
	return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

function piLogo(theme: Theme): readonly [string, string, string] {
	return [
		theme.fg("accent", theme.bold("▐███████▌")),
		theme.fg("accent", theme.bold("  ██ ██  ")),
		theme.fg("accent", theme.bold("  ▀▀ ▀▀  ")),
	];
}

function welcomeInventoryLines(inventory: WelcomeHeaderInventory, theme: Theme): readonly [string, string] {
	const context = inventory.contextFiles === undefined ? undefined : `${String(inventory.contextFiles)} context`;
	const first = [context, `${String(inventory.extensions)} extensions`].filter(Boolean).join(" · ");
	const second = `${String(inventory.tools)} tools · ${String(inventory.skills)} skills`;
	return [theme.fg("muted", first), theme.fg("muted", second)];
}

function modelIdentity(ctx: ExtensionContext, theme: Theme, includeProvider: boolean): string {
	const model = sanitizeOneLine(ctx.model?.name ?? ctx.model?.id ?? "").replace(/^Claude\s+/u, "");
	if (!model) return "";
	const provider = sanitizeOneLine(ctx.model?.provider ?? "");
	return `${theme.fg("accent", model)}${includeProvider && provider ? theme.fg("dim", ` · ${provider}`) : ""}`;
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

const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", {
	granularity: "grapheme",
});

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
