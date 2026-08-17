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

function groupedRuntime(paths: readonly string[], errorIndex = -1, separate = false): ToolUiRuntime {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity("read", {
		categories: ["read-file"],
		classify: ({ args }) => [{ category: "read-file", countKeys: [String(args["path"])] }],
	});
	runtime.registerDetailPresentation("read", {
		detailLines: (args, result) => [
			`Path: ${String(args["path"] ?? "")}`,
			...result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])),
		],
		label: () => "Read",
		summary: (_args, _result, state) => (state === "success" ? "safe" : state),
		target: (args) => String(args["path"] ?? ""),
	});
	runtime.markRendererAttached("read");
	const calls = paths.map((path, index) => toolCall(`read-${String(index + 1)}`, path));
	const results = paths.map((_path, index) => toolResult(`read-${String(index + 1)}`, index === errorIndex));
	const content = separate
		? calls.flatMap((call, index) =>
				index === calls.length - 1 ? [call] : [call, { type: "text", text: `boundary ${String(index + 1)}` }],
			)
		: calls;
	runtime.indexMessages([{ role: "assistant", content }, ...results], true);
	for (const [index, path] of paths.entries()) {
		const id = `read-${String(index + 1)}`;
		runtime.activities.begin({ id, label: "Read", name: "read", target: path });
		runtime.activities.settle(id, {
			detailLines: [],
			durationMs: undefined,
			state: index === errorIndex ? "error" : "success",
			summary: index === errorIndex ? "missing" : "safe",
		});
	}
	return runtime;
}

test("/tools lists groups and formats only the selected member", () => {
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
	expect(detail).toContain("Path: 工具.txt");
	expect(detail).not.toContain("Path: src/config.ts");
	component.handleInput?.("\u001b[B");
	const second = component.render(42).join("\n");
	expect(second).toContain("Path: src/config.ts");
	expect(second).not.toContain("Path: 工具.txt");
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
	expect(detail).not.toContain("Path: a.ts");
	expect(detail).toContain("Path: b.ts");
	expect(detail).not.toContain("Path: c.ts");
	expect(detail).toContain("member 2/3");
	component.dispose?.();
});

test("/tools keeps a five-member selection window while arrows traverse the whole group", () => {
	const runtime = groupedRuntime(Array.from({ length: 8 }, (_, index) => `${String(index + 1)}.ts`));
	const harness = contextHarness(28);
	const component = createToolDialogView(runtime, "read-1").create(harness.context);
	expect(component.render(64).filter((line) => /\d+\. Read/u.test(line))).toHaveLength(5);
	for (let index = 0; index < 7; index += 1) component.handleInput?.("\u001b[B");
	const last = component.render(64);
	expect(last.filter((line) => /\d+\. Read/u.test(line))).toHaveLength(5);
	expect(last.join("\n")).toContain("Path: 8.ts");
	component.dispose?.();
});

test("/tools <member-id> opens an infrastructure-only group hidden from the compact transcript", () => {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity("ctx_reduce", { categories: [], classify: () => [], silentSuccess: true });
	runtime.registerDetailPresentation("ctx_reduce", {
		label: () => "Context reduction",
		summary: () => "done",
		target: () => "context",
	});
	runtime.markRendererAttached("ctx_reduce");
	runtime.indexMessages(
		[
			{ role: "assistant", content: [{ type: "toolCall", id: "internal-1", name: "ctx_reduce", arguments: {} }] },
			{ role: "toolResult", toolCallId: "internal-1", content: [{ type: "text", text: "done" }], details: {} },
		],
		true,
	);
	runtime.activities.begin({
		id: "internal-1",
		label: "Context reduction",
		name: "ctx_reduce",
		target: "context",
	});
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
	expect(detail).toContain("Context reduction");
	expect(detail).not.toContain("internal-1");
	expect(detail).not.toContain("Arguments");
	expect(detail).not.toContain("Result content");
	component.handleInput?.("r");
	const raw = component.render(60).join("\n");
	expect(raw).toContain("Raw protocol");
	expect(raw).toContain("Call ID: internal-1");
	expect(raw).toContain("Tool name: ctx_reduce");
	expect(raw).toContain("Arguments");
	expect(raw).toContain("Result content");
	expect(raw).toContain("Details");
	component.handleInput?.("\u001b");
	expect(component.render(60).join("\n")).not.toContain("Raw protocol");
	component.handleInput?.("\u001b");
	expect(component.render(60).join("\n")).toContain("Tools");
	component.handleInput?.("\u001b");
	expect(harness.closed()).toBe(1);
	component.dispose?.();
});

test("/tools wraps and paginates long member details without exceeding terminal width", () => {
	const runtime = groupedRuntime(["long.txt"]);
	const longDetail = ["输出内容".repeat(200), "TAIL-END"].join(" ");
	runtime.registerDetailPresentation("read", {
		detailLines: () => [longDetail],
		label: () => "Read",
		summary: () => "safe",
		target: () => "long.txt",
	});
	const harness = contextHarness(28);
	const component = createToolDialogView(runtime, "read-1").create(harness.context);
	const first = component.render(28);
	expect(first.every((line) => visibleWidth(line) <= 28)).toBe(true);
	expect(first.join("\n")).not.toContain("TAIL-END");
	component.handleInput?.("\u001b[F");
	const last = component.render(28);
	expect(last.every((line) => visibleWidth(line) <= 28)).toBe(true);
	expect(last.join("\n")).toContain("TAIL-END");
	component.handleInput?.("\u001b[H");
	expect(component.render(28).join("\n")).not.toContain("TAIL-END");
	component.handleInput?.("\u001b[6~");
	component.handleInput?.("\u001b[5~");
	expect(component.render(28).join("\n")).not.toContain("TAIL-END");
	component.dispose?.();
});

test("/tools caps formatted and Raw protocol content per selected call", () => {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity("read", {
		categories: ["read-file"],
		classify: ({ args }) => [{ category: "read-file", countKeys: [String(args["path"])] }],
	});
	runtime.markRendererAttached("read");
	runtime.indexMessages(
		[
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "large",
						name: "read",
						arguments: { path: "large.txt", payload: "参".repeat(30_000) },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "large",
				content: [
					{ type: "text", text: Array.from({ length: 400 }, (_, index) => `line ${String(index)}`).join("\n") },
				],
				details: { payload: "详".repeat(30_000) },
			},
		],
		true,
	);
	for (const mode of ["formatted", "raw"] as const) {
		const detail = runtime.toolActivityDetail("large", mode);
		expect(detail).toBeDefined();
		const lines = detail?.lines ?? [];
		expect(lines.length).toBeLessThanOrEqual(240);
		expect(Buffer.byteLength(lines.join("\n"))).toBeLessThanOrEqual(24 * 1_024);
		expect(lines.at(-1)).toContain("detail capped");
	}
});

test("/tools colors mixed groups amber and no-success failures red", () => {
	const colorCodes: Record<string, number> = { error: 31, muted: 90, success: 32, warning: 33 };
	const semanticTheme = {
		bold: (value: string) => value,
		fg: (color: string, value: string) => {
			const code = colorCodes[color];
			return code === undefined ? value : `\u001b[${String(code)}m${value}\u001b[0m`;
		},
	} as unknown as Theme;
	const mixed = createToolDialogView(groupedRuntime(["a.ts", "missing.ts"], 1)).create(
		contextHarness(28, semanticTheme).context,
	);
	const mixedOutput = mixed.render(100).join("\n");
	expect(Bun.stripANSI(mixedOutput)).toContain("Read 2 files · 1 failed");
	expect(mixedOutput).toContain("\u001b[33m●\u001b[0m");
	mixed.dispose?.();

	const failed = createToolDialogView(groupedRuntime(["missing.ts"], 0)).create(
		contextHarness(28, semanticTheme).context,
	);
	expect(failed.render(100).join("\n")).toContain("\u001b[31m●\u001b[0m");
	failed.dispose?.();
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

test("prototype split pane keeps list and detail visible on wide terminals", () => {
	const harness = contextHarness(32);
	const component = createToolDialogView(groupedRuntime(["a.ts", "b.ts"], -1, true)).create(harness.context);
	let lines = component.render(100);
	let output = lines.join("\n");
	expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
	expect(lines).toHaveLength(29);
	expect(lines[0]).toBe("─".repeat(100));
	expect(lines.slice(1).every((line) => line.slice(36, 39) === "   ")).toBe(true);
	expect(lines.find((line) => line.includes("Tools"))?.startsWith("│ ")).toBe(true);
	expect(
		lines
			.find((line) => line.includes("Tool activity details"))
			?.slice(39)
			.startsWith("│ "),
	).toBe(true);
	expect(output).toContain("Path: b.ts");

	component.handleInput?.("\u001b[B");
	lines = component.render(100);
	output = lines.join("\n");
	expect(lines).toHaveLength(29);
	expect(output).toContain("Path: a.ts");
	expect(output).not.toContain("Path: b.ts");

	component.handleInput?.("\r");
	lines = component.render(100);
	expect(lines).toHaveLength(29);
	expect(lines.find((line) => line.includes("Tool activity details"))?.[39]).toBe("│");
	expect(component.render(64).join("\n")).toContain("Tool activity details");
	lines = component.render(100);
	expect(lines).toHaveLength(29);
	expect(lines.find((line) => line.includes("Tool activity details"))?.[39]).toBe("│");

	component.handleInput?.("\u001b");
	expect(
		component
			.render(100)
			.find((line) => line.includes("Tool activity details"))
			?.slice(39)
			.startsWith("│ "),
	).toBe(true);
	component.handleInput?.("\u001b");
	expect(harness.closed()).toBe(1);
	component.dispose?.();
});

test("prototype split pane keeps narrow terminals single-column", () => {
	const component = createToolDialogView(groupedRuntime(["a.ts"])).create(contextHarness().context);
	const output = component.render(64).join("\n");
	expect(output).toContain("Tools");
	expect(output).not.toContain("Tool activity details");
	component.dispose?.();
});
