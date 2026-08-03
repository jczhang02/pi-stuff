import {
	type AppKeybinding,
	CustomEditor,
	type ExtensionContext,
	type KeybindingsManager,
	type SlashCommandInfo,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	type EditorComponent,
	type EditorTheme,
	type SelectItem,
	SelectList,
	type SelectListTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u;
const MAX_COMMANDS = 256;
const MAX_DESCRIPTION_CODE_UNITS = 320;

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

interface InstalledFactoryRecord {
	readonly previous: EditorFactory | undefined;
	supersede(): void;
}

const installedFactories = new WeakMap<EditorFactory, InstalledFactoryRecord>();
const INSTALLED_FACTORY_RECORD = Symbol.for("@jczhang02/pi-stuff-ui/input-enhancement-factory");

function installedFactoryRecord(factory: EditorFactory): InstalledFactoryRecord | undefined {
	const local = installedFactories.get(factory);
	if (local) return local;
	const shared = (factory as unknown as Record<symbol, unknown>)[INSTALLED_FACTORY_RECORD];
	return typeof shared === "object" && shared !== null && "supersede" in shared
		? (shared as InstalledFactoryRecord)
		: undefined;
}

function registerInstalledFactory(factory: EditorFactory, record: InstalledFactoryRecord): void {
	installedFactories.set(factory, record);
	Object.defineProperty(factory, INSTALLED_FACTORY_RECORD, {
		configurable: true,
		value: record,
	});
}

function unregisterInstalledFactory(factory: EditorFactory, record: InstalledFactoryRecord): void {
	installedFactories.delete(factory);
	if (installedFactoryRecord(factory) === record) Reflect.deleteProperty(factory, INSTALLED_FACTORY_RECORD);
}

export interface InputEnhancementSettings {
	readonly inlineSlashAutocomplete: boolean;
	readonly inputHighlighting: boolean;
}

export interface InputEnhancementOptions {
	/** Read on every render/input so `/ui` changes apply without recreating the editor. */
	getSettings(): InputEnhancementSettings;
	/** Pi's live registry for Extension, Prompt Template, and Skill commands. */
	getCommands(): readonly SlashCommandInfo[];
	/** Read lazily so a Host theme change is reflected immediately. */
	getTheme(): Theme;
}

export interface InputEnhancementController {
	/** Backward-compatible cleanup call. */
	(): void;
	dispose(): void;
	isShowingAutocomplete(): boolean;
	subscribe(listener: (visible: boolean) => void): () => void;
}

interface CursorAwareEditor extends EditorComponent {
	readonly actionHandlers?: Map<AppKeybinding, () => void>;
	dispose?(): void;
	focused?: boolean;
	getAutocompleteMaxVisible?(): number;
	getCursor(): { readonly col: number; readonly line: number };
	getLines(): string[];
	getPaddingX?(): number;
	isShowingAutocomplete(): boolean;
	onCtrlD?: () => void;
	onEscape?: () => void;
	onExtensionShortcut?: (data: string) => boolean;
	onPasteImage?: () => void;
	requestRender?(force?: boolean): void;
}

interface InlineSlashContext {
	readonly cursorCol: number;
	readonly cursorLine: number;
	readonly query: string;
	readonly signature: string;
}

interface InlineAutocompleteState {
	readonly context: InlineSlashContext;
	readonly items: SelectItem[];
	readonly list: SelectList;
	selectedIndex: number;
}

function isCursorAwareEditor(editor: EditorComponent): editor is CursorAwareEditor {
	const candidate = editor as Partial<CursorAwareEditor>;
	return (
		typeof candidate.getCursor === "function" &&
		typeof candidate.getLines === "function" &&
		typeof candidate.isShowingAutocomplete === "function"
	);
}

function safeSettings(options: InputEnhancementOptions): InputEnhancementSettings {
	try {
		const settings = options.getSettings();
		return {
			inlineSlashAutocomplete: settings.inlineSlashAutocomplete === true,
			inputHighlighting: settings.inputHighlighting === true,
		};
	} catch {
		return { inlineSlashAutocomplete: false, inputHighlighting: false };
	}
}

function safeCommandName(value: string): string | undefined {
	return COMMAND_NAME_PATTERN.test(value) ? value : undefined;
}

function commandNames(options: InputEnhancementOptions, providerNames: ReadonlySet<string>): Set<string> {
	const names = new Set(providerNames);
	try {
		for (const command of options.getCommands()) {
			const name = safeCommandName(command.name);
			if (name) names.add(name);
			if (names.size >= MAX_COMMANDS) break;
		}
	} catch {
		// A transient registry failure must not make the editor unusable.
	}
	return names;
}

function sanitizeTerminalText(value: string): string {
	let output = "";
	const bounded = value.slice(0, MAX_DESCRIPTION_CODE_UNITS);
	for (let index = 0; index < bounded.length; index += 1) {
		const code = bounded.charCodeAt(index);
		if (code === 0x90 || code === 0x98 || code === 0x9b || code === 0x9d || code === 0x9e || code === 0x9f) {
			index = terminalControlEnd(bounded, index) - 1;
			continue;
		}
		if (code === 0x1b) {
			const introducer = bounded.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index += 2;
				while (index < bounded.length) {
					const candidate = bounded.charCodeAt(index);
					if (candidate >= 0x40 && candidate <= 0x7e) break;
					index += 1;
				}
				continue;
			}
			if (
				introducer === 0x5d ||
				introducer === 0x50 ||
				introducer === 0x58 ||
				introducer === 0x5e ||
				introducer === 0x5f
			) {
				index += 2;
				while (index < bounded.length) {
					const candidate = bounded.charCodeAt(index);
					if (candidate === 0x07) break;
					if (candidate === 0x1b && bounded.charCodeAt(index + 1) === 0x5c) {
						index += 1;
						break;
					}
					index += 1;
				}
				continue;
			}
			if (!Number.isNaN(introducer)) index += 1;
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			output += " ";
			continue;
		}
		if (
			code === 0x061c ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		) {
			output += " ";
			continue;
		}
		output += bounded[index];
	}
	return output.replace(/\s+/gu, " ").trim();
}

function safeAutocompleteItems(items: readonly AutocompleteItem[], query: string): SelectItem[] {
	const result: SelectItem[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const name = safeCommandName(item.value);
		if (!name?.startsWith(query) || seen.has(name)) continue;
		seen.add(name);
		const description = item.description ? sanitizeTerminalText(item.description) : "";
		result.push({
			value: name,
			label: `/${name}`,
			...(description ? { description } : {}),
		});
		if (result.length >= MAX_COMMANDS) break;
	}
	return result;
}

function isInlineBoundary(value: string | undefined): boolean {
	if (value === undefined) return true;
	return !/[A-Za-z0-9_./:@-]/u.test(value);
}

function findInlineSlashContext(editor: CursorAwareEditor): InlineSlashContext | undefined {
	const lines = editor.getLines();
	const cursor = editor.getCursor();
	const currentLine = lines[cursor.line] ?? "";
	const beforeCursor = currentLine.slice(0, cursor.col);
	const slashIndex = beforeCursor.lastIndexOf("/");
	if (slashIndex < 0) return undefined;
	if (cursor.line === 0 && slashIndex === 0) return undefined;
	if (!isInlineBoundary(slashIndex === 0 ? undefined : beforeCursor[slashIndex - 1])) return undefined;

	const query = beforeCursor.slice(slashIndex + 1);
	if (query.length > 128 || !/^[A-Za-z0-9:._-]*$/u.test(query)) return undefined;
	return {
		cursorCol: cursor.col,
		cursorLine: cursor.line,
		query,
		signature: `${editor.getText()}\u0000${String(cursor.line)}:${String(cursor.col)}`,
	};
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface TerminalToken {
	readonly control: boolean;
	readonly value: string;
}

interface HighlightRange {
	readonly end: number;
	readonly start: number;
}

function terminalControlEnd(value: string, start: number): number {
	const code = value.charCodeAt(start);
	const escapeIntroducer = code === 0x1b ? value.charCodeAt(start + 1) : code;
	const payloadStart = code === 0x1b ? start + 2 : start + 1;
	if (escapeIntroducer === 0x5b || escapeIntroducer === 0x9b) {
		let index = payloadStart;
		while (index < value.length) {
			const candidate = value.charCodeAt(index);
			index += 1;
			if (candidate >= 0x40 && candidate <= 0x7e) break;
		}
		return index;
	}
	if (
		escapeIntroducer === 0x5d ||
		escapeIntroducer === 0x50 ||
		escapeIntroducer === 0x58 ||
		escapeIntroducer === 0x5e ||
		escapeIntroducer === 0x5f ||
		escapeIntroducer === 0x90 ||
		escapeIntroducer === 0x98 ||
		escapeIntroducer === 0x9d ||
		escapeIntroducer === 0x9e ||
		escapeIntroducer === 0x9f
	) {
		let index = payloadStart;
		while (index < value.length) {
			const candidate = value.charCodeAt(index);
			if (candidate === 0x07 || candidate === 0x9c) return index + 1;
			if (candidate === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
			index += 1;
		}
		return index;
	}
	return Math.min(value.length, start + (code === 0x1b ? 2 : 1));
}

function terminalTokens(value: string): TerminalToken[] {
	const tokens: TerminalToken[] = [];
	for (let index = 0; index < value.length; ) {
		const code = value.charCodeAt(index);
		if (code === 0x1b || (code >= 0x80 && code <= 0x9f) || code < 0x20 || code === 0x7f) {
			const end = terminalControlEnd(value, index);
			tokens.push({ control: true, value: value.slice(index, end) });
			index = end;
			continue;
		}
		const codePoint = value.codePointAt(index) ?? code;
		const length = codePoint > 0xffff ? 2 : 1;
		tokens.push({ control: false, value: value.slice(index, index + length) });
		index += length;
	}
	return tokens;
}

function invocationRanges(plain: string, names: ReadonlySet<string>): HighlightRange[] {
	const alternatives = [...names].sort((left, right) => right.length - left.length).map(escapeRegExp);
	if (alternatives.length === 0) return [];
	const pattern = new RegExp(`(^|[^A-Za-z0-9_./:@-])/(${alternatives.join("|")})(?![A-Za-z0-9:._/-])`, "gu");
	const ranges: HighlightRange[] = [];
	for (const match of plain.matchAll(pattern)) {
		const boundary = match[1] ?? "";
		const name = match[2];
		if (!name || match.index === undefined) continue;
		const start = match.index + boundary.length;
		ranges.push({ start, end: start + name.length + 1 });
	}
	return ranges;
}

function styleKnownInvocations(line: string, names: ReadonlySet<string>, theme: Theme): string {
	if (names.size === 0 || !line.includes("/")) return line;
	const tokens = terminalTokens(line);
	const plain = tokens
		.filter((token) => !token.control)
		.map((token) => token.value)
		.join("");
	const ranges = invocationRanges(plain, names);
	if (ranges.length === 0) return line;

	let output = "";
	let plainOffset = 0;
	let buffered = "";
	let bufferedHighlight = false;
	const flush = (): void => {
		if (!buffered) return;
		output += bufferedHighlight ? theme.fg("accent", buffered) : buffered;
		buffered = "";
	};
	for (const token of tokens) {
		if (token.control) {
			flush();
			output += token.value;
			continue;
		}
		const highlighted = ranges.some((range) => plainOffset >= range.start && plainOffset < range.end);
		if (buffered && highlighted !== bufferedHighlight) flush();
		bufferedHighlight = highlighted;
		buffered += token.value;
		plainOffset += token.value.length;
	}
	flush();
	return output;
}

class InputEnhancementEditor implements EditorComponent {
	private autocompleteProvider: AutocompleteProvider | undefined;
	private readonly editor: CursorAwareEditor;
	private inline: InlineAutocompleteState | undefined;
	private inlineAbort: AbortController | undefined;
	private lastInlineSignature: string | undefined;
	private readonly onAutocompleteVisibilityChange: (() => void) | undefined;
	private readonly options: InputEnhancementOptions;
	private readonly providerCommandNames = new Set<string>();
	private seedAbort: AbortController | undefined;
	private readonly keybindings: KeybindingsManager;
	private readonly selectListTheme: SelectListTheme;
	private readonly tui: TUI;

	constructor(
		editor: CursorAwareEditor,
		tui: TUI,
		keybindings: KeybindingsManager,
		selectListTheme: SelectListTheme,
		options: InputEnhancementOptions,
		onAutocompleteVisibilityChange?: () => void,
	) {
		this.editor = editor;
		this.tui = tui;
		this.keybindings = keybindings;
		this.selectListTheme = selectListTheme;
		this.options = options;
		this.onAutocompleteVisibilityChange = onAutocompleteVisibilityChange;
	}

	get actionHandlers(): Map<AppKeybinding, () => void> | undefined {
		return this.editor.actionHandlers;
	}

	get borderColor(): (text: string) => string {
		return this.editor.borderColor ?? ((text) => text);
	}

	set borderColor(value: (text: string) => string) {
		this.editor.borderColor = value;
	}

	get focused(): boolean {
		return this.editor.focused === true;
	}

	set focused(value: boolean) {
		this.editor.focused = value;
	}

	get onChange(): (text: string) => void {
		return this.editor.onChange ?? (() => {});
	}

	set onChange(value: (text: string) => void) {
		this.editor.onChange = value;
	}

	get onCtrlD(): (() => void) | undefined {
		return this.editor.onCtrlD;
	}

	set onCtrlD(value: () => void) {
		this.editor.onCtrlD = value;
	}

	get onEscape(): (() => void) | undefined {
		return this.editor.onEscape;
	}

	set onEscape(value: () => void) {
		this.editor.onEscape = value;
	}

	get onExtensionShortcut(): ((data: string) => boolean) | undefined {
		return this.editor.onExtensionShortcut;
	}

	set onExtensionShortcut(value: (data: string) => boolean) {
		this.editor.onExtensionShortcut = value;
	}

	get onPasteImage(): (() => void) | undefined {
		return this.editor.onPasteImage;
	}

	set onPasteImage(value: () => void) {
		this.editor.onPasteImage = value;
	}

	get onSubmit(): (text: string) => void {
		return this.editor.onSubmit ?? (() => {});
	}

	set onSubmit(value: (text: string) => void) {
		this.editor.onSubmit = value;
	}

	get wantsKeyRelease(): boolean {
		return this.editor.wantsKeyRelease === true;
	}

	addToHistory(text: string): void {
		this.editor.addToHistory?.(text);
	}

	dispose(): void {
		this.shutdown();
		this.editor.dispose?.();
	}

	getExpandedText(): string {
		return this.editor.getExpandedText?.() ?? this.editor.getText();
	}

	getText(): string {
		return this.editor.getText();
	}

	handleInput(data: string): void {
		this.syncSettings();
		if (this.inline && this.handleInlineSelectionInput(data)) return;
		this.editor.handleInput(data);
		this.refreshInlineAutocomplete();
		this.reportAutocompleteVisibility();
	}

	insertTextAtCursor(text: string): void {
		if (this.editor.insertTextAtCursor) {
			this.editor.insertTextAtCursor(text);
		} else {
			this.editor.handleInput(text);
		}
		this.refreshInlineAutocomplete();
	}

	invalidate(): void {
		this.editor.invalidate();
		this.inline?.list.invalidate();
	}

	isShowingAutocomplete(): boolean {
		this.syncSettings();
		return this.nativeAutocompleteVisible() || this.inline !== undefined;
	}

	render(width: number): string[] {
		const settings = this.syncSettings();
		this.refreshInlineAutocomplete();
		const rendered = this.editor.render(width);
		this.reportAutocompleteVisibility();
		const names = settings.inputHighlighting ? commandNames(this.options, this.providerCommandNames) : undefined;
		const currentTheme = names ? this.options.getTheme() : undefined;
		const lines =
			names && currentTheme ? rendered.map((line) => styleKnownInvocations(line, names, currentTheme)) : rendered;
		if (!this.inline || !settings.inlineSlashAutocomplete || this.nativeAutocompleteVisible()) return lines;
		return [...lines, ...this.renderInlineList(width)];
	}

	requestRender(force?: boolean): void {
		this.editor.requestRender?.(force);
		this.tui.requestRender(force);
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.editor.setAutocompleteMaxVisible?.(maxVisible);
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.autocompleteProvider = provider;
		this.editor.setAutocompleteProvider?.(provider);
		this.seedCommandNames(provider);
		this.refreshInlineAutocomplete();
		this.reportAutocompleteVisibility();
	}

	setPaddingX(padding: number): void {
		this.editor.setPaddingX?.(padding);
	}

	setText(text: string): void {
		this.editor.setText(text);
		this.refreshInlineAutocomplete();
	}

	shutdown(): void {
		this.inlineAbort?.abort();
		this.inlineAbort = undefined;
		this.seedAbort?.abort();
		this.seedAbort = undefined;
		this.inline = undefined;
		this.reportAutocompleteVisibility();
	}

	private acceptInlineSelection(): void {
		const inline = this.inline;
		if (!inline) return;
		const current = findInlineSlashContext(this.editor);
		const selected = inline.items[inline.selectedIndex];
		if (!current || current.signature !== inline.context.signature || !selected) {
			this.clearInlineAutocomplete();
			return;
		}
		if (!selected.value.startsWith(current.query)) {
			this.clearInlineAutocomplete();
			return;
		}
		const insertion = `${selected.value.slice(current.query.length)} `;
		this.clearInlineAutocomplete();
		if (this.editor.insertTextAtCursor) {
			this.editor.insertTextAtCursor(insertion);
		} else {
			this.editor.handleInput(insertion);
		}
		this.reportAutocompleteVisibility();
		this.tui.requestRender();
	}

	private clearInlineAutocomplete(requestRender = true): void {
		this.inlineAbort?.abort();
		this.inlineAbort = undefined;
		const changed = this.inline !== undefined;
		this.inline = undefined;
		if (changed) this.reportAutocompleteVisibility();
		if (changed && requestRender) this.tui.requestRender();
	}

	private handleInlineSelectionInput(data: string): boolean {
		const inline = this.inline;
		if (!inline) return false;
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.clearInlineAutocomplete();
			return true;
		}
		if (this.keybindings.matches(data, "tui.select.confirm") || this.keybindings.matches(data, "tui.input.tab")) {
			this.acceptInlineSelection();
			return true;
		}
		if (this.keybindings.matches(data, "tui.select.up")) {
			inline.selectedIndex = inline.selectedIndex === 0 ? inline.items.length - 1 : inline.selectedIndex - 1;
			inline.list.setSelectedIndex(inline.selectedIndex);
			this.tui.requestRender();
			return true;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			inline.selectedIndex = (inline.selectedIndex + 1) % inline.items.length;
			inline.list.setSelectedIndex(inline.selectedIndex);
			this.tui.requestRender();
			return true;
		}
		return false;
	}

	private nativeAutocompleteVisible(): boolean {
		return this.editor.isShowingAutocomplete();
	}

	private reportAutocompleteVisibility(): void {
		this.onAutocompleteVisibilityChange?.();
	}

	private refreshInlineAutocomplete(): void {
		const settings = safeSettings(this.options);
		const provider = this.autocompleteProvider;
		const context = findInlineSlashContext(this.editor);
		if (!settings.inlineSlashAutocomplete || !provider || !context || this.nativeAutocompleteVisible()) {
			this.lastInlineSignature = undefined;
			this.clearInlineAutocomplete(false);
			return;
		}
		if (context.signature === this.lastInlineSignature) return;
		this.lastInlineSignature = context.signature;
		this.clearInlineAutocomplete(false);
		const controller = new AbortController();
		this.inlineAbort = controller;
		void provider
			.getSuggestions([`/${context.query}`], 0, context.query.length + 1, {
				force: false,
				signal: controller.signal,
			})
			.then((suggestions) => {
				if (controller.signal.aborted || this.inlineAbort !== controller) return;
				this.inlineAbort = undefined;
				const current = findInlineSlashContext(this.editor);
				if (!current || current.signature !== context.signature || !suggestions) return;
				const items = safeAutocompleteItems(suggestions.items, context.query);
				for (const item of suggestions.items) {
					const name = safeCommandName(item.value);
					if (name && this.providerCommandNames.size < MAX_COMMANDS) this.providerCommandNames.add(name);
				}
				if (items.length === 0) {
					this.tui.requestRender();
					return;
				}
				const list = new SelectList(items, this.editor.getAutocompleteMaxVisible?.() ?? 5, this.selectListTheme);
				this.inline = { context, items, list, selectedIndex: 0 };
				this.reportAutocompleteVisibility();
				this.tui.requestRender();
			})
			.catch(() => {
				if (this.inlineAbort === controller) this.inlineAbort = undefined;
			});
	}

	private renderInlineList(width: number): string[] {
		const inline = this.inline;
		if (!inline) return [];
		const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
		const paddingX = Math.min(this.editor.getPaddingX?.() ?? 0, maxPadding);
		const contentWidth = Math.max(1, width - paddingX * 2);
		const leftPadding = " ".repeat(paddingX);
		const rightPadding = leftPadding;
		return inline.list.render(contentWidth).map((line) => {
			const fitted = truncateToWidth(line, contentWidth, "");
			const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(fitted)));
			return `${leftPadding}${fitted}${padding}${rightPadding}`;
		});
	}

	private seedCommandNames(provider: AutocompleteProvider): void {
		this.seedAbort?.abort();
		const controller = new AbortController();
		this.seedAbort = controller;
		void provider
			.getSuggestions(["/"], 0, 1, { force: false, signal: controller.signal })
			.then((suggestions) => {
				if (controller.signal.aborted || this.seedAbort !== controller) return;
				this.seedAbort = undefined;
				for (const item of suggestions?.items ?? []) {
					const name = safeCommandName(item.value);
					if (name && this.providerCommandNames.size < MAX_COMMANDS) this.providerCommandNames.add(name);
				}
				this.tui.requestRender();
			})
			.catch(() => {
				if (this.seedAbort === controller) this.seedAbort = undefined;
			});
	}

	private syncSettings(): InputEnhancementSettings {
		const settings = safeSettings(this.options);
		if (!settings.inlineSlashAutocomplete) {
			this.lastInlineSignature = undefined;
			this.clearInlineAutocomplete(false);
		}
		return settings;
	}
}

function createFactory(
	previous: EditorFactory | undefined,
	options: InputEnhancementOptions,
	onEditor?: (editor: InputEnhancementEditor) => void,
	onAutocompleteVisibilityChange?: () => void,
): EditorFactory {
	return (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager): EditorComponent => {
		const editor = previous
			? previous(tui, editorTheme, keybindings)
			: new CustomEditor(tui, editorTheme, keybindings);
		if (!isCursorAwareEditor(editor)) return editor;
		const enhanced = new InputEnhancementEditor(
			editor,
			tui,
			keybindings,
			editorTheme.selectList,
			options,
			onAutocompleteVisibilityChange,
		);
		onEditor?.(enhanced);
		return enhanced;
	};
}

/** Decorate the current Host editor factory without replacing its editing behavior. */
export function createInputEnhancementEditorFactory(
	previous: EditorFactory | undefined,
	options: InputEnhancementOptions,
): EditorFactory {
	return createFactory(previous, options);
}

/**
 * Install the editor decorator for one TUI session. The returned cleanup restores
 * the prior factory only when this installation still owns the editor slot.
 */
export function installInputEnhancementEditor(
	ctx: ExtensionContext,
	options: InputEnhancementOptions,
): InputEnhancementController {
	const occupied = ctx.ui.getEditorComponent();
	const priorInstallation = occupied ? installedFactoryRecord(occupied) : undefined;
	priorInstallation?.supersede();
	const previous = priorInstallation ? priorInstallation.previous : occupied;
	const editors = new Set<InputEnhancementEditor>();
	const listeners = new Set<(visible: boolean) => void>();
	let currentEditor: InputEnhancementEditor | undefined;
	let lastVisibility = false;
	const publishVisibility = (): void => {
		const visible = currentEditor?.isShowingAutocomplete() === true;
		if (visible === lastVisibility) return;
		lastVisibility = visible;
		for (const listener of listeners) {
			try {
				listener(visible);
			} catch {
				// Statusline repaint failures must not break input handling.
			}
		}
	};
	const factory = createFactory(
		previous,
		options,
		(editor) => {
			editors.add(editor);
			currentEditor = editor;
			publishVisibility();
		},
		publishVisibility,
	);
	let disposed = false;
	let record: InstalledFactoryRecord;
	const settle = (): boolean => {
		if (disposed) return false;
		disposed = true;
		for (const editor of editors) editor.shutdown();
		editors.clear();
		currentEditor = undefined;
		publishVisibility();
		listeners.clear();
		unregisterInstalledFactory(factory, record);
		return true;
	};
	const supersede = (): void => {
		settle();
	};
	const dispose = (): void => {
		if (!settle()) return;
		if (ctx.ui.getEditorComponent() === factory) ctx.ui.setEditorComponent(previous);
	};
	record = { previous, supersede };
	registerInstalledFactory(factory, record);
	try {
		ctx.ui.setEditorComponent(factory);
	} catch (error) {
		supersede();
		throw error;
	}
	const controller = dispose as InputEnhancementController;
	controller.dispose = dispose;
	controller.isShowingAutocomplete = () => currentEditor?.isShowingAutocomplete() === true;
	controller.subscribe = (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	return controller;
}
