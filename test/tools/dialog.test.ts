import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogViewContext } from "@jczhang02/pi-stuff-ui";
import { ToolUiRuntime } from "../../packages/pi-stuff-tools/contract.js";
import { createToolDialogView } from "../../packages/pi-stuff-tools/tool-dialog.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

function contextHarness(rows = 28): {
	readonly context: CommandDialogViewContext<void>;
	readonly terminal: { rows: number };
	readonly closed: () => number;
	readonly renders: () => number;
} {
	let closed = 0;
	let renders = 0;
	const terminal = { rows };
	return {
		closed: () => closed,
		context: {
			close: () => {
				closed += 1;
			},
			keybindings: {},
			requestRender: () => {
				renders += 1;
			},
			signal: new AbortController().signal,
			theme,
			tui: { terminal },
		} as unknown as CommandDialogViewContext<void>,
		renders: () => renders,
		terminal,
	};
}

test("/tools moves from a focused list to bounded details and back", () => {
	const runtime = new ToolUiRuntime();
	runtime.activities.begin({
		id: "read-1",
		label: "Read",
		name: "read",
		target: "工具.txt",
	});
	runtime.activities.settle("read-1", {
		detailLines: ["Call", "path: 工具.txt", "", "Result", "safe"],
		durationMs: 25,
		state: "success",
		summary: "1 line",
	});
	const harness = contextHarness();
	const component = createToolDialogView(runtime).create(harness.context);

	const list = component.render(28).join("\n");
	expect(list).toContain("  › ⊛ Read 工具.txt");
	expect(list).not.toContain("current-session operations");
	expect(list).toContain("Enter details");
	expect(list).toContain("Esc close");
	component.handleInput?.("\r");
	const detail = component.render(28).join("\n");
	expect(detail).toContain("Tool details");
	expect(detail).toContain("path: 工具.txt");
	expect(detail).toContain("Esc back");
	component.handleInput?.("\u001b");
	expect(component.render(28).join("\n")).toContain("Tools");
	component.handleInput?.("\u001b");
	expect(harness.closed()).toBe(1);
	expect(harness.renders()).toBeGreaterThanOrEqual(2);
	component.dispose?.();
	runtime.clear();
});

test("/tools bounds long lists while keeping every operation reachable", () => {
	const runtime = new ToolUiRuntime();
	for (let index = 1; index <= 11; index += 1) {
		runtime.activities.begin({
			id: `tool-${String(index)}`,
			label: `Tool ${String(index)}`,
			name: "fixture",
			target: `target-${String(index)}`,
		});
	}
	const harness = contextHarness(32);
	const component = createToolDialogView(runtime).create(harness.context);

	const newestWindow = component.render(100);
	expect(newestWindow.join("\n")).toContain("› ⦿ Tool 11");
	expect(newestWindow.join("\n")).toContain("… 3 older");
	expect(newestWindow.join("\n")).not.toContain("Tool 3 target-3");
	expect(newestWindow.at(-1)).toContain("Esc close");

	for (let index = 0; index < 10; index += 1) component.handleInput?.("\u001b[B");
	const oldestWindow = component.render(100).join("\n");
	expect(oldestWindow).toContain("› ⦿ Tool 1");
	expect(oldestWindow).toContain("… 3 newer");
	expect(oldestWindow).not.toContain("… 3 older");

	component.dispose?.();
	runtime.clear();
});

test("/tools wraps visual detail lines before pagination and preserves unknown duration", () => {
	const runtime = new ToolUiRuntime();
	const longDetail = ["输出内容".repeat(200), "TAIL-END"].join(" ");
	runtime.activities.begin({ id: "read-wrap", label: "Read", name: "read", target: "很长的结果.txt" });
	runtime.activities.settle("read-wrap", {
		detailLines: [longDetail],
		durationMs: undefined,
		state: "success",
		summary: "long line",
	});
	const harness = contextHarness(28);
	const component = createToolDialogView(runtime, "read-wrap").create(harness.context);

	const first = component.render(28);
	expect(first.every((line) => visibleWidth(line) <= 28)).toBe(true);
	expect(first.join("\n")).toContain("· —");
	expect(first.join("\n")).not.toContain("TAIL-END");
	for (let page = 0; page < 5; page += 1) component.handleInput?.("\u001b[6~");
	const last = component.render(28);
	expect(last.every((line) => visibleWidth(line) <= 28)).toBe(true);
	expect(last.join("\n")).toContain("TAIL-END");
	expect(last.join("\n")).toContain("Esc back");

	component.dispose?.();
	runtime.clear();
});

test("/tools caches wrapped detail at one width and rewraps exactly once after resize", () => {
	const runtime = new ToolUiRuntime();
	let detailReads = 0;
	const detailLines = new Proxy(["缓存详情".repeat(120)], {
		get: (target, property, receiver) => {
			if (typeof property === "string" && /^\d+$/u.test(property)) detailReads += 1;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
	runtime.activities.begin({ id: "read-cache", label: "Read", name: "read", target: "cache.txt" });
	runtime.activities.settle("read-cache", {
		detailLines,
		durationMs: 10,
		state: "success",
		summary: "cached",
	});
	const harness = contextHarness();
	const component = createToolDialogView(runtime, "read-cache").create(harness.context);

	component.render(28);
	const firstPassReads = detailReads;
	expect(firstPassReads).toBeGreaterThan(0);
	component.handleInput?.("\u001b[6~");
	component.render(28);
	expect(detailReads).toBe(firstPassReads);
	component.render(64);
	const resizeReads = detailReads;
	expect(resizeReads).toBeGreaterThan(firstPassReads);
	component.render(64);
	expect(detailReads).toBe(resizeReads);

	component.dispose?.();
	runtime.clear();
});

test("/tools wraps hints by visible width and never budgets rows the terminal does not have", () => {
	const runtime = new ToolUiRuntime();
	runtime.activities.begin({ id: "read-small", label: "Read", name: "read", target: "中文目标.txt" });
	const harness = contextHarness(28);
	const component = createToolDialogView(runtime).create(harness.context);

	const narrow = component.render(12);
	expect(narrow.every((line) => visibleWidth(line) <= 12)).toBe(true);
	expect(narrow.join("\n")).toContain("Esc close");

	harness.terminal.rows = 5;
	const compactList = component.render(64);
	expect(compactList.length).toBeLessThanOrEqual(5);
	expect(compactList.join("\n")).toContain("Esc close");
	component.handleInput?.("\r");
	const compactDetail = component.render(64);
	expect(compactDetail.length).toBeLessThanOrEqual(5);
	expect(compactDetail.join("\n")).toContain("Esc back");
	harness.terminal.rows = 0;
	expect(component.render(64)).toEqual([]);

	component.dispose?.();
	runtime.clear();
});
