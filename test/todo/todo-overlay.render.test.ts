import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	__resetState,
	getRenderState,
	replaceState,
	setActiveRenderSession,
} from "../../packages/pi-stuff-todo/state/store.js";
import { TodoOverlay } from "../../packages/pi-stuff-todo/todo-overlay.js";
import type { Task, TaskStatus } from "../../packages/pi-stuff-todo/tool/types.js";

const SESSION_ID = "test-session";
const identityTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	strikethrough: (text: string) => text,
};

function task(id: string, subject: string, status: TaskStatus = "pending", blockedBy?: readonly string[]): Task {
	const result: Task = { id, subject, description: `${subject} description`, status };
	if (blockedBy && blockedBy.length > 0) result.blockedBy = [...blockedBy];
	return result;
}

function setup(tasks: readonly Task[], options: { lingerCompleted?: boolean } = {}) {
	__resetState();
	setActiveRenderSession(SESSION_ID);
	replaceState(SESSION_ID, { tasks: [...tasks], nextId: tasks.length + 1 });

	const setWidgetCalls: unknown[][] = [];
	const setWidget = (...args: unknown[]): void => {
		setWidgetCalls.push(args);
	};
	const ui = { setWidget, theme: identityTheme } as unknown as ExtensionUIContext;
	const overlay = new TodoOverlay();
	overlay.setUICtx(ui);
	overlay.refresh(options);
	const factory = setWidgetCalls[0]?.[1] as
		| ((
				tui: { requestRender: (...args: unknown[]) => void },
				theme: typeof identityTheme,
		  ) => { render: (width: number) => string[]; invalidate: () => void })
		| undefined;
	const requestRenderCalls: unknown[][] = [];
	const requestRender = (...args: unknown[]): void => {
		requestRenderCalls.push(args);
	};
	const widget = factory?.({ requestRender }, identityTheme);
	return { overlay, requestRenderCalls, setWidgetCalls, widget };
}

beforeEach(() => {
	__resetState();
});

afterEach(() => {
	__resetState();
});

describe("TodoOverlay rendering", () => {
	test("renders zero rows and registers nothing when the list is empty", () => {
		const { setWidgetCalls, widget } = setup([]);
		expect(setWidgetCalls).toHaveLength(0);
		expect(widget).toBeUndefined();
	});

	test("registers only an above-editor widget and renders no heading, frame, or trailing blank", () => {
		const { setWidgetCalls, widget } = setup([task("1", "write tests")]);
		expect(setWidgetCalls).toHaveLength(1);
		expect(setWidgetCalls[0]?.[0]).toBe("rpiv-todos");
		expect(setWidgetCalls[0]?.[2]).toEqual({ placement: "aboveEditor" });
		expect(widget?.render(200)).toEqual(["□ write tests"]);
	});

	test("shows at most five ordered task rows plus one overflow row", () => {
		const finalTasks = [
			task("1", "runnable 1"),
			task("2", "active", "in_progress"),
			task("3", "recent 3", "completed"),
			task("4", "blocked 4", "pending", ["1"]),
			task("5", "runnable 5"),
			task("6", "runnable 6"),
			task("7", "recent 7", "completed"),
		];
		const initialTasks = finalTasks.map((item) =>
			item.status === "completed" ? { ...item, status: "pending" as const } : item,
		);
		const { overlay, widget } = setup(initialTasks);
		replaceState(SESSION_ID, { tasks: finalTasks, nextId: 8 });
		overlay.refresh({ forceExpanded: true });
		expect(widget?.render(200)).toEqual([
			"✓ recent 3",
			"✓ recent 7",
			"■ active",
			"□ runnable 1",
			"□ runnable 5",
			"… +2 pending",
		]);
	});

	test("only reports blockers that are still unresolved", () => {
		const { widget } = setup([
			task("1", "finished dependency", "completed"),
			task("2", "now runnable", "pending", ["1"]),
			task("3", "still blocked", "pending", ["2"]),
		]);
		const output = widget?.render(200).join("\n") ?? "";
		expect(output).toContain("□ now runnable");
		expect(output).toContain("□ still blocked blocked by #2");
		expect(output).not.toContain("blocked by #1");
	});

	test("collapses to exactly one Next line and prefers active work", () => {
		const { overlay, widget } = setup([task("1", "pending"), task("2", "doing now", "in_progress")]);
		overlay.toggle();
		expect(widget?.render(200)).toEqual(["Next: doing now"]);
	});

	test("forceExpanded restores task rows after a collapse", () => {
		const { overlay, widget } = setup([task("1", "one"), task("2", "two")]);
		overlay.toggle();
		expect(widget?.render(200)).toHaveLength(1);
		overlay.refresh({ forceExpanded: true });
		expect(widget?.render(200)).toEqual(["□ one", "□ two"]);
	});

	test("normalizes and truncates a long subject to one terminal row", () => {
		const { widget } = setup([task("1", "a long\nsubject that cannot fit")]);
		const lines = widget?.render(18) ?? [];
		expect(lines).toHaveLength(1);
		expect(lines[0]).not.toContain("\n");
		expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(18);
	});

	test("refreshes a registered widget without creating a second one", () => {
		const { overlay, requestRenderCalls, setWidgetCalls } = setup([task("1", "one")]);
		overlay.refresh();
		expect(setWidgetCalls).toHaveLength(1);
		expect(requestRenderCalls).toHaveLength(1);
	});
});

describe("TodoOverlay all-complete linger", () => {
	test("keeps an already-completed replay hidden when no linger is requested", () => {
		const { overlay, setWidgetCalls } = setup([task("1", "already finished", "completed")]);
		expect(overlay.isRegistered()).toBe(false);
		expect(setWidgetCalls).toHaveLength(0);
	});

	test("keeps completed rows for five seconds, then hides only the widget", () => {
		const originalSetTimeout = globalThis.setTimeout;
		let scheduledCallback: (() => void) | undefined;
		let scheduledDelay: number | undefined;
		const timerHandle = { unref: () => {} };
		globalThis.setTimeout = ((callback: () => void, delay?: number) => {
			scheduledCallback = callback;
			scheduledDelay = delay;
			return timerHandle;
		}) as unknown as typeof setTimeout;
		try {
			const { overlay, setWidgetCalls, widget } = setup([task("1", "finished", "completed")], {
				lingerCompleted: true,
			});
			expect(scheduledDelay).toBe(5_000);
			expect(widget?.render(200)).toEqual(["✓ finished"]);
			expect(overlay.isRegistered()).toBe(true);

			scheduledCallback?.();
			expect(overlay.isRegistered()).toBe(false);
			expect(setWidgetCalls.at(-1)).toEqual(["rpiv-todos", undefined]);
			expect(getRenderState().tasks).toHaveLength(1);
			expect(getRenderState().tasks[0]?.status).toBe("completed");
		} finally {
			globalThis.setTimeout = originalSetTimeout;
		}
	});

	test("does not schedule hiding while any unfinished task remains", () => {
		const { overlay, setWidgetCalls } = setup([task("1", "finished", "completed"), task("2", "remaining")]);
		expect(overlay.isRegistered()).toBe(true);
		expect(setWidgetCalls).toHaveLength(1);
	});
});
