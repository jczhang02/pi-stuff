import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
	AgentRow,
	AgentSessionSnapshot,
	AgentStatus,
	CurrentAgents,
} from "../../packages/pi-stuff-agents/src/session/current-agents.js";
import { AgentRoster, type AgentRosterContext } from "../../packages/pi-stuff-agents/src/ui/agent-roster.js";

type InputResult = { consume?: boolean; data?: string } | undefined;
type InputHandler = (data: string) => InputResult;

interface RosterComponent {
	invalidate(): void;
	render(width: number): string[];
}

type RosterFactory = (tui: TUI, theme: Theme) => RosterComponent;

const theme = {
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	fg: (_color: string, text: string) => text,
	italic: (text: string) => text,
	strikethrough: (text: string) => text,
	underline: (text: string) => text,
} as unknown as Theme;

const editor = {
	getText: () => "",
	handleInput: () => {},
	invalidate: () => {},
	render: () => [],
	setText: () => {},
};

class CurrentAgentsHarness {
	readonly actions: Array<{ key: string; type: string }> = [];
	private readonly listeners = new Set<(snapshot: AgentSessionSnapshot) => void>();
	private value: AgentSessionSnapshot;

	constructor(rows: readonly AgentRow[]) {
		this.value = { rows } as AgentSessionSnapshot;
	}

	asCurrentAgents(): CurrentAgents {
		return this as unknown as CurrentAgents;
	}

	control(action: { key: string; type: string }): Promise<undefined> {
		this.actions.push(action);
		return Promise.resolve(undefined);
	}

	snapshot(): AgentSessionSnapshot {
		return this.value;
	}

	subscribe(listener: (snapshot: AgentSessionSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	update(rows: readonly AgentRow[]): void {
		this.value = { rows } as AgentSessionSnapshot;
		for (const listener of this.listeners) listener(this.value);
	}
}

class UiHarness {
	editorText = "";
	focusedComponent: unknown = editor;
	readonly notifications: Array<{ message: string; level: string }> = [];
	readonly placements: Array<string | undefined> = [];
	readonly renderRequests: number[] = [];
	readonly widgetWrites: Array<RosterFactory | undefined> = [];
	private component: RosterComponent | undefined;
	private inputHandler: InputHandler | undefined;

	readonly tui = {
		get focusedComponent() {
			return undefined;
		},
		requestRender: () => {
			this.renderRequests.push(this.renderRequests.length + 1);
		},
	} as unknown as TUI;

	constructor() {
		Object.defineProperty(this.tui, "focusedComponent", {
			configurable: true,
			get: () => this.focusedComponent,
		});
	}

	context(): AgentRosterContext {
		return { hasUI: true, ui: this as unknown as AgentRosterContext["ui"] };
	}

	emit(data: string): InputResult {
		return this.inputHandler?.(data);
	}

	getEditorText(): string {
		return this.editorText;
	}

	hasInputListener(): boolean {
		return this.inputHandler !== undefined;
	}

	notify(message: string, level: string): void {
		this.notifications.push({ level, message });
	}

	onTerminalInput(handler: InputHandler): () => void {
		this.inputHandler = handler;
		return () => {
			if (this.inputHandler === handler) this.inputHandler = undefined;
		};
	}

	render(width: number): string[] {
		return this.component?.render(width) ?? [];
	}

	setWidget(_key: string, factory: RosterFactory | undefined, options?: { placement?: string }): void {
		this.component = factory?.(this.tui, theme);
		this.widgetWrites.push(factory);
		this.placements.push(options?.placement);
	}
}

function row(
	key: string,
	status: AgentStatus,
	overrides: { elapsedMs?: number; name?: string; startedAt?: number; task?: string } = {},
): AgentRow {
	return {
		key,
		name: overrides.name ?? key,
		status,
		task: overrides.task ?? `work assigned to ${key}`,
		...(overrides.elapsedMs === undefined ? {} : { elapsedMs: overrides.elapsedMs }),
		...(overrides.startedAt === undefined ? {} : { startedAt: overrides.startedAt }),
	} as AgentRow;
}

function setup(rows: readonly AgentRow[]) {
	const current = new CurrentAgentsHarness(rows);
	const ui = new UiHarness();
	const opened: string[] = [];
	const roster = new AgentRoster(current.asCurrentAgents(), {
		onOpen: (key) => {
			opened.push(key);
		},
	});
	roster.setContext(ui.context());
	return { current, opened, roster, ui };
}

function lineFor(lines: readonly string[], name: string): string {
	const line = lines.find((candidate) => candidate.includes(name));
	if (!line) throw new Error(`Expected a line containing ${name}`);
	return line;
}

function containsTerminalControl(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 0x20 || (code >= 0x7f && code <= 0x9f);
	});
}

function containsBidiFormatControl(value: string): boolean {
	return /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

describe("AgentRoster", () => {
	test("mounts below the editor only while direct children exist", () => {
		const result = setup([]);
		expect(result.ui.render(80)).toEqual([]);
		expect(result.ui.hasInputListener()).toBe(false);

		result.current.update([row("research", "running")]);
		expect(result.ui.placements.at(-1)).toBe("belowEditor");
		expect(result.ui.hasInputListener()).toBe(true);
		expect(result.ui.render(80).join("\n")).toContain("research");

		result.current.update([]);
		expect(result.ui.widgetWrites.at(-1)).toBeUndefined();
		expect(result.ui.hasInputListener()).toBe(false);
		expect(result.ui.render(80)).toEqual([]);
		result.roster.dispose();
	});

	test("orders live work before terminal work and caps the passive viewport", () => {
		const rows = [
			row("done", "completed"),
			row("run", "running", { elapsedMs: 5_000 }),
			row("fail", "failed"),
			row("wait", "waiting_supervisor"),
			row("queue", "queued"),
			row("stop", "agent_stopped"),
			row("active", "running"),
		];
		const result = setup(rows);
		const normal = result.ui.render(100);
		const normalText = normal.join("\n");

		expect(normalText).toContain("… +2 more");
		expect(normalText.indexOf("run")).toBeLessThan(normalText.indexOf("done"));
		expect(normalText.indexOf("wait")).toBeLessThan(normalText.indexOf("done"));
		expect(normalText.indexOf("queue")).toBeLessThan(normalText.indexOf("done"));
		expect(normal.filter((line) => rows.some((item) => line.includes(item.name)))).toHaveLength(5);

		const narrow = result.ui.render(64);
		expect(narrow.join("\n")).toContain("… +3 more");
		expect(narrow.filter((line) => rows.some((item) => line.includes(item.name)))).toHaveLength(4);
		expect(narrow.every((line) => visibleWidth(line) <= 64 && !line.includes("\n"))).toBe(true);
		result.roster.dispose();
	});

	test("keeps the short state at the right and truncates task content first", () => {
		const result = setup([
			row("queued-child", "queued", {
				name: "researcher",
				task: "a deliberately long task description that cannot fit into a narrow terminal row",
			}),
		]);
		const rendered = result.ui.render(42);
		const agentLine = lineFor(rendered, "researcher");

		expect(agentLine.trimEnd().endsWith("queued")).toBe(true);
		expect(agentLine).toContain("researcher");
		expect(agentLine).not.toContain("cannot fit");
		expect(visibleWidth(agentLine)).toBeLessThanOrEqual(42);
		expect(rendered.join("\n")).not.toMatch(/tokens?|tool|latest action|statusline/i);
		result.roster.dispose();
	});

	test("removes terminal controls while preserving CJK names, tasks, and the right state", () => {
		const result = setup([
			row("unsafe", "failed", {
				name: "审\u202e查\u001b]0;伪造标题\u0007员",
				task: "检查\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u001b[31m失败\u001b[0m\u009b32m输出\u009b0m\u001b7 保留很长的中文说明",
			}),
		]);
		const rendered = result.ui.render(64);
		const agentLine = lineFor(rendered, "审查员");

		expect(agentLine.trimEnd().endsWith("failed")).toBe(true);
		expect(agentLine).toContain("检查失败输出 保留");
		expect(agentLine).not.toContain("伪造标题");
		expect(containsTerminalControl(agentLine)).toBe(false);
		expect(containsBidiFormatControl(agentLine)).toBe(false);
		expect(visibleWidth(agentLine)).toBeLessThanOrEqual(64);
		result.roster.dispose();
	});

	test("only enters keyboard navigation from an empty, truly focused editor", () => {
		const result = setup([row("child", "running")]);
		result.ui.editorText = "draft";
		expect(result.ui.emit("\u001b[B")).toBeUndefined();
		expect(result.ui.render(80)[0]).toContain("↓ to manage");

		result.ui.editorText = "";
		result.ui.focusedComponent = { render: () => [] };
		expect(result.ui.emit("\u001b[B")).toBeUndefined();
		expect(result.ui.render(80)[0]).toContain("↓ to manage");

		result.ui.focusedComponent = editor;
		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(result.ui.render(80)[0]).toContain("↑/↓ to select");
		result.roster.dispose();
	});

	test("navigates without wrapping, opens children, and returns from main", () => {
		const result = setup([row("first", "running"), row("second", "waiting_supervisor")]);
		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(result.ui.emit("\u001b[A")).toEqual({ consume: true });
		expect(lineFor(result.ui.render(80), "main")).toContain("●");

		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(result.ui.emit("\r")).toEqual({ consume: true });
		expect(result.opened).toEqual(["first"]);

		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(lineFor(result.ui.render(80), "second")).toContain("●");
		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(lineFor(result.ui.render(80), "second")).toContain("●");

		expect(result.ui.emit("\u001b")).toEqual({ consume: true });
		expect(result.ui.render(80)[0]).toContain("↓ to manage");
		expect(result.ui.emit("\u001b[B")).toEqual({ consume: true });
		expect(result.ui.emit("\r")).toEqual({ consume: true });
		expect(result.ui.render(80)[0]).toContain("↓ to manage");
		result.roster.dispose();
	});

	test("only advertises the action available for the selected row", () => {
		const live = setup([row("live", "running")]);
		live.ui.emit("\u001b[B");
		expect(live.ui.render(80)[0]).not.toContain("x ");
		live.ui.emit("\u001b[B");
		expect(live.ui.render(80)[0]).toContain("x stop");
		expect(live.ui.render(80)[0]).not.toContain("dismiss");
		expect(live.ui.render(64)[0]).toContain("x stop · Esc return");
		live.roster.dispose();

		const terminal = setup([row("done", "completed")]);
		terminal.ui.emit("\u001b[B");
		terminal.ui.emit("\u001b[B");
		expect(terminal.ui.render(80)[0]).toContain("x dismiss");
		expect(terminal.ui.render(80)[0]).not.toContain("x stop");
		expect(terminal.ui.render(64)[0]).toContain("x dismiss · Esc return");
		terminal.roster.dispose();
	});

	test("stops live rows, dismisses terminal rows, and lets unrelated printable input through", () => {
		const live = setup([row("live", "running")]);
		live.ui.emit("\u001b[B");
		live.ui.emit("\u001b[B");
		expect(live.ui.emit("x")).toEqual({ consume: true });
		expect(live.current.actions).toEqual([{ key: "live", type: "stop" }]);
		expect(live.ui.emit("q")).toBeUndefined();
		expect(live.ui.render(80)[0]).toContain("↓ to manage");
		live.roster.dispose();

		const terminal = setup([row("finished", "completed")]);
		terminal.ui.emit("\u001b[B");
		terminal.ui.emit("\u001b[B");
		expect(terminal.ui.emit("x")).toEqual({ consume: true });
		expect(terminal.current.actions).toEqual([{ key: "finished", type: "dismiss-terminal" }]);
		terminal.roster.dispose();
	});

	test("keeps an offscreen selection visible and unregisters all chrome while suppressed", () => {
		const result = setup(Array.from({ length: 7 }, (_, index) => row(`child-${index + 1}`, "running")));
		result.ui.emit("\u001b[B");
		for (let index = 0; index < 7; index++) result.ui.emit("\u001b[B");

		const selectedView = result.ui.render(64);
		expect(lineFor(selectedView, "child-7")).toContain("●");
		expect(selectedView.join("\n")).toContain("… +3 more");

		result.roster.setSuppressed(true);
		expect(result.ui.widgetWrites.at(-1)).toBeUndefined();
		expect(result.ui.hasInputListener()).toBe(false);
		expect(result.ui.render(64)).toEqual([]);

		result.roster.setSuppressed(false);
		expect(result.ui.hasInputListener()).toBe(true);
		expect(result.ui.placements.at(-1)).toBe("belowEditor");
		result.roster.dispose();
	});
});
