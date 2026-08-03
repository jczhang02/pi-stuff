import { describe, expect, test } from "bun:test";
import type {
	KeybindingsManager as AgentKeybindingsManager,
	ExtensionContext,
	SlashCommandInfo,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	type EditorComponent,
	type EditorTheme,
	KeybindingsManager,
	type TUI,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	createInputEnhancementEditorFactory,
	type InputEnhancementSettings,
	installInputEnhancementEditor,
} from "../../packages/pi-stuff-ui/input-enhancement.js";

const ACCENT_OPEN = "\u001b[35m";
const ACCENT_CLOSE = "\u001b[39m";

const editorTheme: EditorTheme = {
	borderColor: (text) => text,
	selectList: {
		description: (text) => text,
		noMatch: (text) => text,
		scrollInfo: (text) => text,
		selectedPrefix: (text) => text,
		selectedText: (text) => text,
	},
};

const theme = {
	fg: (color: string, text: string) => (color === "accent" ? `${ACCENT_OPEN}${text}${ACCENT_CLOSE}` : text),
} as unknown as Theme;

class TestTui {
	readonly terminal = { rows: 32 };
	renderRequests = 0;

	requestRender(): void {
		this.renderRequests += 1;
	}
}

class CommandProvider implements AutocompleteProvider {
	private readonly items: readonly AutocompleteItem[];
	readonly requests: string[] = [];

	constructor(items: readonly AutocompleteItem[]) {
		this.items = items;
	}

	async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		_options: { readonly force?: boolean; readonly signal: AbortSignal },
	): Promise<{ readonly items: AutocompleteItem[]; readonly prefix: string } | null> {
		const prefix = (lines[cursorLine] ?? "").slice(0, cursorCol);
		this.requests.push(prefix);
		if (!prefix.startsWith("/")) return null;
		return { items: [...this.items], prefix };
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number } {
		const next = [...lines];
		const line = next[cursorLine] ?? "";
		next[cursorLine] = `${line.slice(0, cursorCol - prefix.length)}/${item.value} ${line.slice(cursorCol)}`;
		return {
			lines: next,
			cursorLine,
			cursorCol: cursorCol - prefix.length + item.value.length + 2,
		};
	}
}

interface ObservableEditor extends EditorComponent {
	isShowingAutocomplete(): boolean;
}

function commands(...names: string[]): SlashCommandInfo[] {
	return names.map((name) => ({ name }) as SlashCommandInfo);
}

function createEditor(
	settings: InputEnhancementSettings,
	providerItems: readonly AutocompleteItem[],
	registeredCommands: readonly SlashCommandInfo[] = commands("review", "skill:inspect"),
): {
	readonly editor: ObservableEditor;
	readonly provider: CommandProvider;
	readonly settings: InputEnhancementSettings;
	readonly tui: TestTui;
} {
	const tui = new TestTui();
	const mutableSettings = settings as {
		inlineSlashAutocomplete: boolean;
		inputHighlighting: boolean;
	};
	const factory = createInputEnhancementEditorFactory(undefined, {
		getCommands: () => registeredCommands,
		getSettings: () => mutableSettings,
		getTheme: () => theme,
	});
	const keybindings = new KeybindingsManager(TUI_KEYBINDINGS) as unknown as AgentKeybindingsManager;
	const editor = factory(tui as unknown as TUI, editorTheme, keybindings) as ObservableEditor;
	const provider = new CommandProvider(providerItems);
	editor.setAutocompleteProvider?.(provider);
	return { editor, provider, settings: mutableSettings, tui };
}

async function settleAutocomplete(): Promise<void> {
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("Pi Stuff input highlighting", () => {
	test("styles only recognized current commands and skills without changing width or CJK", async () => {
		const { editor } = createEditor({ inlineSlashAutocomplete: false, inputHighlighting: true }, [
			{ value: "review", label: "review" },
			{ value: "skill:inspect", label: "skill:inspect" },
		]);
		editor.setText("中文/review 与 /skill:inspect；/missing https://x/review /review/file");
		await settleAutocomplete();

		const lines = editor.render(80);
		const output = lines.join("\n");
		expect(output).toContain(`${ACCENT_OPEN}/review${ACCENT_CLOSE}`);
		expect(output).toContain(`${ACCENT_OPEN}/skill:inspect${ACCENT_CLOSE}`);
		expect(output).not.toContain(`${ACCENT_OPEN}/missing${ACCENT_CLOSE}`);
		expect(output).not.toContain(`${ACCENT_OPEN}/review${ACCENT_CLOSE}/file`);
		expect(editor.getText()).toBe("中文/review 与 /skill:inspect；/missing https://x/review /review/file");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
	});

	test("returns the native editor rendering with zero added rows when both settings are disabled", () => {
		const { editor } = createEditor({ inlineSlashAutocomplete: false, inputHighlighting: false }, [
			{ value: "review", label: "review" },
		]);
		editor.setText("plain /review");

		const lines = editor.render(64);
		expect(lines).toHaveLength(3);
		expect(lines.join("\n")).not.toContain(ACCENT_OPEN);
		expect(editor.isShowingAutocomplete()).toBeFalse();
	});

	test("keeps a recognized command highlighted when the native cursor splits its ANSI text", async () => {
		const { editor } = createEditor({ inlineSlashAutocomplete: false, inputHighlighting: true }, [
			{ value: "review", label: "review" },
		]);
		editor.setText("/review");
		editor.handleInput("\u001b[D");
		editor.handleInput("\u001b[D");
		await settleAutocomplete();

		const output = editor.render(64).join("\n");
		expect(output).toContain("\u001b[7m");
		expect(output.split(ACCENT_OPEN).length - 1).toBeGreaterThan(1);
		expect(editor.getText()).toBe("/review");
	});
});

describe("Pi Stuff inline slash autocomplete", () => {
	test("uses the Host provider inside a CJK sentence and preserves text after the cursor", async () => {
		const { editor, provider } = createEditor({ inlineSlashAutocomplete: true, inputHighlighting: true }, [
			{ value: "review", label: "review", description: "Review changes" },
			{ value: "reload", label: "reload", description: "Reload resources" },
		]);
		let submitted = false;
		editor.onSubmit = () => {
			submitted = true;
		};
		editor.setText("请执行 /re尾");
		editor.handleInput("\u001b[D");
		await settleAutocomplete();

		expect(provider.requests).toContain("/re");
		expect(editor.isShowingAutocomplete()).toBeTrue();
		const suggestions = editor.render(64).join("\n");
		expect(suggestions).toContain("/review");
		expect(suggestions).toContain("/reload");

		editor.handleInput("\u001b[B");
		editor.handleInput("\t");
		expect(editor.getText()).toBe("请执行 /reload 尾");
		expect(submitted).toBeFalse();
		expect(editor.isShowingAutocomplete()).toBeFalse();
		expect(editor.render(64).join("\n")).toContain(`${ACCENT_OPEN}/reload${ACCENT_CLOSE}`);
	});

	test("works at the start of later lines while leaving first-line native completion to Pi", async () => {
		const { editor, provider } = createEditor({ inlineSlashAutocomplete: true, inputHighlighting: false }, [
			{ value: "review", label: "review" },
		]);
		editor.setText("first line\n/re");
		await settleAutocomplete();

		expect(provider.requests).toContain("/re");
		expect(editor.isShowingAutocomplete()).toBeTrue();
		editor.handleInput("\t");
		expect(editor.getText()).toBe("first line\n/review ");
	});

	test("removes the list immediately when `/ui` disables it and emits no blank row", async () => {
		const created = createEditor({ inlineSlashAutocomplete: true, inputHighlighting: false }, [
			{ value: "review", label: "review" },
		]);
		created.editor.setText("ask /re");
		await settleAutocomplete();
		expect(created.editor.render(64).length).toBeGreaterThan(3);

		(created.settings as { inlineSlashAutocomplete: boolean }).inlineSlashAutocomplete = false;
		const disabled = created.editor.render(64);
		expect(disabled).toHaveLength(3);
		expect(created.editor.isShowingAutocomplete()).toBeFalse();
	});

	test("filters unsafe registry data before it reaches the terminal", async () => {
		const { editor } = createEditor({ inlineSlashAutocomplete: true, inputHighlighting: false }, [
			{
				value: "review",
				label: "review",
				description: "安全\u001b]0;OWNED\u0007说明\u009dC1_TITLE\u009c结束",
			},
			{ value: "bad\u001b[31m", label: "bad" },
		]);
		editor.setText("请 /r");
		await settleAutocomplete();

		const output = editor.render(64).join("\n");
		expect(output).toContain("/review");
		expect(output).not.toContain("OWNED");
		expect(output).not.toContain("C1_TITLE");
		expect(output).not.toContain("bad");
	});
});

describe("editor composition", () => {
	test("exposes native and inline autocomplete visibility through a cleanup-compatible controller", async () => {
		type Factory = (tui: TUI, theme: EditorTheme, keybindings: AgentKeybindingsManager) => EditorComponent;
		let installedFactory: Factory | undefined;
		const context = {
			ui: {
				getEditorComponent: () => installedFactory,
				setEditorComponent: (factory: Factory | undefined) => {
					installedFactory = factory;
				},
			},
		} as unknown as ExtensionContext;
		const settings = { inlineSlashAutocomplete: true, inputHighlighting: false };
		const controller = installInputEnhancementEditor(context, {
			getCommands: () => commands("review"),
			getSettings: () => settings,
			getTheme: () => theme,
		});
		const visibility: boolean[] = [];
		const unsubscribe = controller.subscribe((visible) => visibility.push(visible));
		const tui = new TestTui();
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS) as unknown as AgentKeybindingsManager;
		const editor = installedFactory?.(tui as unknown as TUI, editorTheme, keybindings) as ObservableEditor;
		editor.setAutocompleteProvider?.(new CommandProvider([{ value: "review", label: "review" }]));
		editor.setText("ask /re");
		await settleAutocomplete();

		expect(controller.isShowingAutocomplete()).toBeTrue();
		expect(visibility).toEqual([true]);
		settings.inlineSlashAutocomplete = false;
		editor.render(64);
		expect(controller.isShowingAutocomplete()).toBeFalse();
		expect(visibility).toEqual([true, false]);

		settings.inlineSlashAutocomplete = true;
		editor.setText("");
		editor.handleInput("/");
		await settleAutocomplete();
		editor.render(64);
		expect(controller.isShowingAutocomplete()).toBeTrue();
		expect(visibility).toEqual([true, false, true]);
		editor.handleInput("\u001b");
		expect(controller.isShowingAutocomplete()).toBeFalse();
		expect(visibility).toEqual([true, false, true, false]);

		unsubscribe();
		const firstFactory = installedFactory;
		const replacement = installInputEnhancementEditor(context, {
			getCommands: () => commands("review"),
			getSettings: () => settings,
			getTheme: () => theme,
		});
		expect(installedFactory).not.toBe(firstFactory);
		controller();
		expect(installedFactory).not.toBeUndefined();
		replacement.dispose();
		expect(installedFactory).toBeUndefined();
		expect(controller.isShowingAutocomplete()).toBeFalse();
		controller.dispose();
	});

	test("preserves an existing opaque editor instead of replacing unsupported behavior", () => {
		class OpaqueEditor implements EditorComponent {
			text = "";
			onSubmit?: (text: string) => void;
			onChange?: (text: string) => void;

			getText(): string {
				return this.text;
			}

			handleInput(data: string): void {
				this.text += data;
			}

			invalidate(): void {}

			render(): string[] {
				return [this.text];
			}

			setText(text: string): void {
				this.text = text;
			}
		}

		const opaque = new OpaqueEditor();
		const previous = () => opaque;
		const factory = createInputEnhancementEditorFactory(previous, {
			getCommands: () => commands("review"),
			getSettings: () => ({ inlineSlashAutocomplete: true, inputHighlighting: true }),
			getTheme: () => theme,
		});
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS) as unknown as AgentKeybindingsManager;
		const result = factory(new TestTui() as unknown as TUI, editorTheme, keybindings);

		expect(result).toBe(opaque);
		result.handleInput("保留");
		expect(result.getText()).toBe("保留");
	});

	test("retains ordinary submit behavior when no inline list owns Enter", () => {
		const { editor } = createEditor({ inlineSlashAutocomplete: true, inputHighlighting: true }, [
			{ value: "review", label: "review" },
		]);
		const submissions: string[] = [];
		editor.onSubmit = (text) => submissions.push(text);
		editor.setText("普通输入");
		editor.handleInput("\r");
		expect(submissions).toEqual(["普通输入"]);
	});
});
