import { describe, expect, test } from "bun:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type KeybindingsManager, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogViewContext } from "../../packages/pi-stuff/src/conversation-ui/index.js";
import type { FastResumeSnapshot } from "../../packages/pi-stuff/src/fast-resume/controller.js";
import {
	createFastResumeDialogView,
	type FastResumeDialogController,
} from "../../packages/pi-stuff/src/fast-resume/dialog.js";
import type { SessionHeader } from "../../packages/pi-stuff/src/fast-resume/session.js";

initTheme("dark", false);

const themeStub: Partial<Theme> = {
	bg: (_color: string, value: string) => value,
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
};
// SAFETY: the dialog calls only bg, bold, and fg from this test Theme.
const theme = themeStub as Theme;

function matches(data: string, action: string): boolean {
	switch (action) {
		case "app.session.delete":
			return data === "\u0004";
		case "app.session.deleteNoninvasive":
			return data === "\u007f";
		case "app.session.rename":
			return data === "\u0012";
		case "app.session.toggleNamedFilter":
			return data === "\u000e";
		case "app.session.togglePath":
			return data === "\u0010";
		case "app.session.toggleSort":
			return data === "\u0013";
		case "tui.input.tab":
			return data === "\t";
		case "tui.select.cancel":
			return data === "\u001b";
		case "tui.select.confirm":
			return data === "\r";
		case "tui.select.down":
			return data === "\u001b[B";
		case "tui.select.pageDown":
			return data === "\u001b[6~";
		case "tui.select.pageUp":
			return data === "\u001b[5~";
		case "tui.select.up":
			return data === "\u001b[A";
		default:
			return false;
	}
}

function session(id: string, name?: string): SessionHeader {
	const value: SessionHeader = {
		canonicalPath: `/sessions/${id}`,
		created: new Date("2026-01-01T00:00:00Z"),
		cwd: id === "other" ? "/other" : "/repo",
		firstMessage: `message ${id}`,
		id,
		messageCount: 1,
		modified: new Date("2026-01-01T00:00:00Z"),
		path: `/sessions/${id}`,
	};
	if (name) value.name = name;
	return value;
}

function harness(rows = 24) {
	let closed: string | undefined;
	let closeCalls = 0;
	const keybindingStub: Partial<KeybindingsManager> = { matches };
	// SAFETY: the dialog calls only matches on the fixture KeybindingsManager.
	const keybindings = keybindingStub as KeybindingsManager;
	const terminalStub: Partial<TUI["terminal"]> = { rows };
	// SAFETY: the dialog reads only rows from this fixture Terminal.
	const terminal = terminalStub as TUI["terminal"];
	const tuiStub: Partial<TUI> = { terminal };
	// SAFETY: the dialog reads only tui.terminal.rows from this fixture.
	const tui = tuiStub as TUI;
	const context: CommandDialogViewContext<string> = {
		close: (result?: string) => {
			closeCalls += 1;
			closed = result;
		},
		keybindings,
		requestRender: () => undefined,
		signal: new AbortController().signal,
		theme,
		tui,
	};
	return { context, getClosed: () => closed, getCloseCalls: () => closeCalls };
}

function controller() {
	const current = [session("active", "Active"), session("second")];
	const all = [...current, session("other", "Other")];
	let subscriber: ((value: FastResumeSnapshot) => void) | undefined;
	let snapshot: FastResumeSnapshot = {
		allLoading: false,
		allSessions: all,
		currentLoading: false,
		currentSessionPath: "/sessions/active",
		currentSessions: current,
	};
	const deleted: string[] = [];
	const renamed: Array<[string, string]> = [];
	const refreshed: string[] = [];
	let disposed = 0;
	const value: FastResumeDialogController = {
		delete: async (path: string) => {
			deleted.push(path);
			return { method: "unlink" as const, ok: true as const };
		},
		dispose: () => {
			disposed += 1;
		},
		refresh: (scope) => {
			refreshed.push(scope);
		},
		rename: async (path: string, name: string) => {
			renamed.push([path, name]);
		},
		snapshot: () => snapshot,
		start: () => undefined,
		subscribe: (listener: (value: FastResumeSnapshot) => void) => {
			subscriber = listener;
			listener(snapshot);
			return () => {
				subscriber = undefined;
			};
		},
	};
	return {
		value,
		deleted,
		renamed,
		refreshed,
		getDisposed: () => disposed,
		setSnapshot: (value: FastResumeSnapshot) => {
			snapshot = value;
			subscriber?.(snapshot);
		},
	};
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("Fast Resume Command Dialog", () => {
	test("renders one responsive Pi Stuff dialog with progressive controls", () => {
		const source = controller();
		const { context } = harness(12);
		const component = createFastResumeDialogView(source.value).create(context);
		const lines = component.render(64);
		const text = lines.join("\n");
		expect(text).toContain("Fast Resume (Current Folder)");
		expect(text).toContain("Active");
		expect(text).toContain("active");
		expect(text).toContain("≈1");
		expect(text).toContain("Tab scope");
		expect(lines.filter((line) => line.includes("━")).length).toBe(1);
		expect(lines.length).toBeLessThanOrEqual(12);
		expect(lines.every((line) => visibleWidth(line) <= 64)).toBeTrue();
	});

	test("searches, switches scope, and selects a Session", () => {
		const source = controller();
		const { context, getClosed } = harness();
		const component = createFastResumeDialogView(source.value, "Other").create(context);
		component.handleInput?.("\u001b[Z");
		expect(component.render(80).join("\n")).toContain("Other");
		component.handleInput?.("\r");
		expect(getClosed()).toBe("/sessions/other");
		expect(source.getDisposed()).toBe(1);
	});

	test("keeps selection by Session path while progressive rows arrive", () => {
		const source = controller();
		const { context, getClosed } = harness();
		const component = createFastResumeDialogView(source.value).create(context);
		component.handleInput?.("\u001b[B");
		source.setSnapshot({
			...source.value.snapshot(),
			currentSessions: [session("new"), ...source.value.snapshot().currentSessions],
		});
		component.handleInput?.("\r");
		expect(getClosed()).toBe("/sessions/second");
	});

	test("reports invalid regex and keeps refresh and boundary navigation usable", () => {
		const source = controller();
		const first = harness();
		const invalid = createFastResumeDialogView(source.value, "re:[").create(first.context);
		expect(invalid.render(80).join("\n")).toContain("Invalid regex");
		invalid.handleInput?.("\f");
		expect(source.refreshed).toEqual(["current"]);
		invalid.handleInput?.("\u001b");

		const second = harness();
		const boundaries = createFastResumeDialogView(source.value).create(second.context);
		boundaries.handleInput?.("\u001b[F");
		boundaries.handleInput?.("\r");
		expect(second.getClosed()).toBe("/sessions/second");
	});

	test("protects the active Session and confirms deletion of another", async () => {
		const source = controller();
		const { context } = harness();
		const component = createFastResumeDialogView(source.value).create(context);
		component.handleInput?.("\u0004");
		expect(component.render(80).join("\n")).toContain("Cannot delete the currently active Session");
		component.handleInput?.("\u001b[B");
		component.handleInput?.("\u0004");
		expect(component.render(80).join("\n")).toContain("Delete Session?");
		component.handleInput?.("\r");
		await settle();
		expect(source.deleted).toEqual(["/sessions/second"]);
	});

	test("renames in place and Escape restores the editor", async () => {
		const source = controller();
		const first = harness();
		const component = createFastResumeDialogView(source.value).create(first.context);
		component.handleInput?.("\u001b[B");
		component.handleInput?.("\u0012");
		component.handleInput?.("New name");
		component.handleInput?.("\r");
		await settle();
		expect(source.renamed).toEqual([["/sessions/second", "New name"]]);
		component.handleInput?.("\u001b");
		expect(first.getCloseCalls()).toBe(1);
	});
});
