import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CommandDialogViewContext } from "../../packages/pi-stuff/src/conversation-ui/index.js";
import { ToolUiRuntime } from "../../packages/pi-stuff/src/tool-display/contract.js";
import { createToolDialogView } from "../../packages/pi-stuff/src/tool-display/tool-dialog.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

function contextHarness(rows = 28, activeTheme = theme) {
	let closed = 0;
	let renders = 0;
	const terminal = { rows };
	return {
		closed: () => closed,
		context: {
			close: () => closed++,
			keybindings: {},
			requestRender: () => renders++,
			signal: new AbortController().signal,
			theme: activeTheme,
			tui: { terminal },
		} as unknown as CommandDialogViewContext<void>,
		renders: () => renders,
		terminal,
	};
}

function toolCall(id: string, path: string) {
	return { type: "toolCall", id, name: "read", arguments: { path } };
}

function toolResult(id: string, isError = false) {
	return {
		role: "toolResult",
		toolCallId: id,
		content: [{ type: "text", text: isError ? "missing" : "safe" }],
		details: {},
		...(isError ? { isError: true } : {}),
	};
}

function groupedRuntime(paths: readonly string[], errorIndex = -1): ToolUiRuntime {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity("read", {
		categories: ["read-file"],
		classify: ({ args }) => [{ category: "read-file", countKeys: [String(args["path"])] }],
	});
	runtime.markRendererAttached("read");
	const calls = paths.map((path, index) => toolCall(`read-${String(index + 1)}`, path));
	const results = paths.map((_path, index) => toolResult(`read-${String(index + 1)}`, index === errorIndex));
	runtime.indexMessages([{ role: "assistant", content: calls }, ...results], true);
	for (const [index, path] of paths.entries()) {
		const id = `read-${String(index + 1)}`;
		runtime.activities.begin({ id, label: "Read", name: "read", target: path });
		runtime.activities.settle(id, {
			detailLines: ["Call", `path: ${path}`, "", "Result", index === errorIndex ? "missing" : "safe"],
			durationMs: undefined,
			state: index === errorIndex ? "error" : "success",
			summary: index === errorIndex ? "missing" : "safe",
		});
	}
	return runtime;
}

test("/tools lists Activity Groups and one detail view restores every member", () => {
	const runtime = groupedRuntime(["工具.txt", "src/config.ts"]);
	const harness = contextHarness();
	const component = createToolDialogView(runtime).create(harness.context);

	const list = component.render(42).join("\n");
	expect(list).toContain("Read 2 files");
	expect(list).toContain("2 tools");
	expect(list).toContain("Enter details");
	component.handleInput?.("\r");
	const detail = component.render(42).join("\n");
	expect(detail).toContain("Tool activity details");
	expect(detail).toContain("path: 工具.txt");
	expect(detail).toContain("path: src/config.ts");
	component.handleInput?.("\u001b");
	expect(component.render(42).join("\n")).toContain("Tools");
	component.handleInput?.("\u001b");
	expect(harness.closed()).toBe(1);
	component.dispose?.();
});

test("/tools <member-id> focuses the requested member within its complete group", () => {
	const runtime = groupedRuntime(["a.ts", "b.ts", "c.ts"]);
	const harness = contextHarness(36);
	const component = createToolDialogView(runtime, "read-2").create(harness.context);
	const detail = component.render(60).join("\n");
	expect(detail).toContain("3 tools");
	expect(detail).not.toContain("path: a.ts");
	expect(detail).toContain("path: b.ts");
	expect(detail).toContain("path: c.ts");
	expect(detail).toContain("2–3/3 tools");
	component.dispose?.();
});

test("/tools <member-id> opens an infrastructure-only group hidden from the compact transcript", () => {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity("internal", { categories: [], classify: () => [], silentSuccess: true });
	runtime.indexMessages(
		[
			{ role: "assistant", content: [{ type: "toolCall", id: "internal-1", name: "internal", arguments: {} }] },
			{ role: "toolResult", toolCallId: "internal-1", content: [{ type: "text", text: "done" }], details: {} },
		],
		true,
	);
	runtime.activities.begin({ id: "internal-1", label: "Internal", name: "internal", target: "internal" });
	runtime.activities.settle("internal-1", {
		detailLines: ["Call", "internal", "", "Result", "done"],
		durationMs: undefined,
		state: "success",
		summary: "done",
	});
	const harness = contextHarness();
	const component = createToolDialogView(runtime, "internal-1").create(harness.context);
	const detail = component.render(60).join("\n");
	expect(detail).toContain("Tool activity details");
	expect(detail).toContain("internal-1");
	expect(detail).toContain("Result");
	component.dispose?.();
});

test("/tools wraps and paginates long member details without exceeding terminal width", () => {
	const runtime = groupedRuntime(["long.txt"]);
	const longDetail = ["输出内容".repeat(200), "TAIL-END"].join(" ");
	runtime.activities.settle("read-1", {
		detailLines: [longDetail],
		durationMs: undefined,
		state: "success",
		summary: "safe",
	});
	const harness = contextHarness(28);
	const component = createToolDialogView(runtime, "read-1").create(harness.context);
	const first = component.render(28);
	expect(first.every((line) => visibleWidth(line) <= 28)).toBe(true);
	expect(first.join("\n")).not.toContain("TAIL-END");
	for (let page = 0; page < 12; page++) component.handleInput?.("\u001b[6~");
	const last = component.render(28);
	expect(last.every((line) => visibleWidth(line) <= 28)).toBe(true);
	expect(last.join("\n")).toContain("TAIL-END");
	component.dispose?.();
});

test("/tools keeps error groups explicit and semantically colored", () => {
	const colorCodes: Record<string, number> = { error: 31, muted: 90, success: 32 };
	const semanticTheme = {
		bold: (value: string) => value,
		fg: (color: string, value: string) => {
			const code = colorCodes[color];
			return code === undefined ? value : `\u001b[${String(code)}m${value}\u001b[0m`;
		},
	} as unknown as Theme;
	const runtime = groupedRuntime(["a.ts", "missing.ts"], 1);
	const harness = contextHarness(28, semanticTheme);
	const component = createToolDialogView(runtime).create(harness.context);
	const output = component.render(100).join("\n");
	expect(Bun.stripANSI(output)).toContain("Read 2 files · 1 failed");
	expect(output).toContain("\u001b[31m●\u001b[0m");
	component.dispose?.();
});

test("/tools respects narrow widths and terminal row budgets", () => {
	const runtime = groupedRuntime(["中文目标.txt"]);
	const harness = contextHarness(28);
	const component = createToolDialogView(runtime).create(harness.context);
	const narrow = component.render(12);
	expect(narrow.every((line) => visibleWidth(line) <= 12)).toBe(true);
	expect(narrow.join("\n")).toContain("Esc close");
	harness.terminal.rows = 5;
	expect(component.render(64).length).toBeLessThanOrEqual(5);
	component.handleInput?.("\r");
	expect(component.render(64).length).toBeLessThanOrEqual(5);
	harness.terminal.rows = 0;
	expect(component.render(64)).toEqual([]);
	component.dispose?.();
});
