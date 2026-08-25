import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { ToolUiRuntime } from "../../packages/pi-stuff/src/tool-display/contract.js";
import { createToolDialogView } from "../../packages/pi-stuff/src/tool-display/tool-dialog.js";
import { TestTui } from "../fixtures/test-tui.js";

// SAFETY: this test fixture implements the exact Host surface exercised by this case.
const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as Theme;

interface ReadActivityArguments {
	readonly path?: unknown;
}

function contextHarness(rows = 28, activeTheme = theme, keybindings = new KeybindingsManager(TUI_KEYBINDINGS)) {
	let closed = 0;
	let renders = 0;
	const terminal = new TestTui(rows);
	return {
		closed: () => closed,
		context: {
			close: () => closed++,
			keybindings,
			requestRender: () => renders++,
			signal: new AbortController().signal,
			theme: activeTheme,
			tui: terminal,
		},
		renders: () => renders,
		terminal,
	};
}

function toolCall(id: string, path: string) {
	return { type: "toolCall", id, name: "read", arguments: { path } };
}

function toolResult(id: string, isError = false) {
	return Object.assign(
		{
			role: "toolResult",
			toolCallId: id,
			content: [{ type: "text", text: isError ? "missing" : "safe" }],
			details: {},
		},
		isError ? { isError: true } : undefined,
	);
}

function groupedRuntime(paths: readonly string[], errorIndex = -1, separate = false): ToolUiRuntime {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity<ReadActivityArguments, unknown>("read", {
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
	expect(list).toContain("2 calls");
	expect(list).toContain("Enter details");
	component.handleInput?.("\r");
	let detail = component.render(42).join("\n");
	expect(detail).toContain("Tools / Read 2 files");
	expect(detail).toContain("◆ Result");
	expect(detail).not.toContain("formatted");
	expect(detail).not.toContain("Target:");
	expect(detail).not.toContain("Summary:");
	component.handleInput?.("\u001b[F");
	detail = component.render(42).join("\n");
	expect(detail).toContain("Path: 工具.txt");
	expect(detail).not.toContain("Path: src/config.ts");
	component.handleInput?.("\u001b[B");
	let second = component.render(42).join("\n");
	component.handleInput?.("\u001b[F");
	second = component.render(42).join("\n");
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
	expect(detail).toContain("3 calls");
	expect(detail).toContain("◆ Calls");
	expect(detail).toContain("◆ Result");
	expect(detail).not.toContain("Path: a.ts");
	expect(detail).toContain("Path: b.ts");
	expect(detail).not.toContain("Path: c.ts");
	expect(detail).toContain("call 2/3");
	component.dispose?.();
});

test("/tools keeps a five-member selection window while arrows traverse the whole group", () => {
	const runtime = groupedRuntime(Array.from({ length: 8 }, (_, index) => `${String(index + 1)}.ts`));
	const harness = contextHarness(28);
	const component = createToolDialogView(runtime, "read-1").create(harness.context);
	expect(component.render(64).filter((line) => line.includes("Read ·"))).toHaveLength(5);
	for (let index = 0; index < 7; index += 1) component.handleInput?.("\u001b[B");
	const last = component.render(64);
	expect(last.filter((line) => line.includes("Read ·"))).toHaveLength(5);
	expect(last.join("\n")).toContain("Path: 8.ts");
	component.dispose?.();
});

test("/tools pages the Activity list with Space", () => {
	const paths = Array.from({ length: 12 }, (_, index) => `${String(index + 1)}.ts`);
	const first = createToolDialogView(groupedRuntime(paths, -1, true)).create(contextHarness().context);
	first.render(64);
	first.handleInput?.("\r");
	const firstTarget = first
		.render(64)
		.join("\n")
		.match(/Path: (\S+)/u)?.[1];
	first.dispose?.();

	const paged = createToolDialogView(groupedRuntime(paths, -1, true)).create(contextHarness().context);
	expect(paged.render(64).join("\n")).toContain("? keys");
	paged.handleInput?.(" ");
	paged.handleInput?.("\r");
	const pagedTarget = paged
		.render(64)
		.join("\n")
		.match(/Path: (\S+)/u)?.[1];
	expect(pagedTarget).toBeDefined();
	expect(pagedTarget).not.toBe(firstTarget);
	paged.dispose?.();
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
	expect(detail).toContain("Tools / Internal activity");
	expect(detail).toContain("◆ Result");
	expect(detail).not.toContain("◆ Calls");
	expect(detail).not.toContain("formatted");
	expect(detail).not.toContain("Target:");
	expect(detail).not.toContain("Summary:");
	expect(detail).toContain("context");
	expect(detail).not.toContain("internal-1");
	expect(detail).not.toContain("Arguments");
	expect(detail).not.toContain("Result content");
	component.handleInput?.("r");
	let raw = component.render(60).join("\n");
	expect(raw).toContain("◆ Raw");
	expect(raw).toContain("Call ID: internal-1");
	expect(raw).toContain("Tool name: ctx_reduce");
	expect(raw).toContain("Arguments");
	component.handleInput?.("\u001b[6~");
	raw += `\n${component.render(60).join("\n")}`;
	component.handleInput?.("\u001b[F");
	raw += `\n${component.render(60).join("\n")}`;
	expect(raw).toContain("Result content");
	expect(raw).toContain("Details");
	component.handleInput?.("\u001b");
	expect(component.render(60).join("\n")).toContain("◆ Result");
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
	runtime.registerActivity<ReadActivityArguments, unknown>("read", {
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
	interface ColorCodes {
		readonly [color: string]: number;
	}
	const colorCodes: ColorCodes = { error: 31, muted: 90, success: 32, warning: 33 };
	// SAFETY: this test fixture implements the exact Host surface exercised by this case.
	const semanticTheme = {
		bold: (value: string) => value,
		fg: (color: string, value: string) => {
			const code = colorCodes[color];
			return code === undefined ? value : `\u001b[${String(code)}m${value}\u001b[0m`;
		},
	} as Theme;
	const mixed = createToolDialogView(groupedRuntime(["a.ts", "missing.ts"], 1)).create(
		contextHarness(28, semanticTheme).context,
	);
	const mixedOutput = mixed.render(100).join("\n");
	expect(Bun.stripANSI(mixedOutput)).toContain("Read 2 files · 1 failed");
	expect(mixedOutput).toContain("\u001b[33m!\u001b[0m");
	mixed.dispose?.();

	const failed = createToolDialogView(groupedRuntime(["missing.ts"], 0)).create(
		contextHarness(28, semanticTheme).context,
	);
	expect(failed.render(100).join("\n")).toContain("\u001b[31m×\u001b[0m");
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

test("/tools keeps list and detail visible on wide terminals", () => {
	// SAFETY: this test fixture implements the exact Host surface exercised by this case.
	const focusTheme = {
		bold: (value: string) => value,
		fg: (color: string, value: string) => (color === "accent" ? `\u001b[35m${value}\u001b[0m` : value),
	} as Theme;
	const harness = contextHarness(32, focusTheme);
	const component = createToolDialogView(groupedRuntime(["a.ts", "b.ts"], -1, true)).create(harness.context);
	let lines = component.render(100);
	let output = lines.join("\n");
	expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
	expect(lines).toHaveLength(18);
	expect(lines[0]).toBe("━".repeat(100));
	expect(lines.slice(1).every((line) => Bun.stripANSI(line)[36] === "┃")).toBe(true);
	expect(Bun.stripANSI(output)).not.toContain("│");
	expect(lines[1]?.split("┃")[0]).toContain("\u001b[35mTools\u001b[0m");
	expect(lines[1]?.split("┃")[1]).not.toContain("\u001b[35mTools /");
	expect(output).toContain("Path: b.ts");

	component.handleInput?.("\u001b[B");
	lines = component.render(100);
	output = lines.join("\n");
	expect(lines).toHaveLength(18);
	expect(output).toContain("Path: a.ts");
	expect(output).not.toContain("Path: b.ts");

	component.handleInput?.("\t");
	lines = component.render(100);
	expect(lines).toHaveLength(18);
	expect(lines[1]?.split("┃")[0]).not.toContain("\u001b[35mTools\u001b[0m");
	expect(lines[1]?.split("┃")[1]).toContain("\u001b[35mTools /");
	component.handleInput?.("\u001b[Z");
	lines = component.render(100);
	expect(lines[1]?.split("┃")[0]).toContain("\u001b[35mTools\u001b[0m");
	component.handleInput?.("?");
	expect(component.render(100).join("\n")).toContain("Tools / Keys");
	component.handleInput?.("\u001b");
	component.handleInput?.("\t");
	expect(component.render(64).join("\n")).toContain("Tools /");
	lines = component.render(100);
	expect(lines).toHaveLength(18);
	expect(lines[1]?.split("┃")[1]).toContain("\u001b[35mTools /");

	component.handleInput?.("\u001b");
	lines = component.render(100);
	expect(lines[1]?.split("┃")[0]).toContain("\u001b[35mTools\u001b[0m");
	expect(lines[1]?.split("┃")[1]).not.toContain("\u001b[35mTools /");
	component.handleInput?.("\u001b");
	expect(harness.closed()).toBe(1);
	component.dispose?.();
});

test("/tools keeps narrow terminals single-column", () => {
	const component = createToolDialogView(groupedRuntime(["a.ts"])).create(contextHarness().context);
	const output = component.render(64).join("\n");
	expect(output).toContain("Tools");
	expect(output.startsWith("━".repeat(64))).toBe(true);
	expect(output).not.toContain("Tool activity details");
	component.dispose?.();
});

test("/tools keeps its empty state single-column at wide widths", () => {
	const component = createToolDialogView(new ToolUiRuntime()).create(contextHarness(32).context);
	const output = component.render(100).join("\n");
	expect(output.match(/No tool activity in this session\./gu)).toHaveLength(1);
	expect(output).not.toContain("┃");
	expect(output).not.toContain("select");
	expect(output).not.toContain("details");
	expect(output).toContain("? keys");
	expect(output).toContain("Esc close");
	component.dispose?.();
});
