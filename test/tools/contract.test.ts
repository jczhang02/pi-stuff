import { expect, spyOn, test } from "bun:test";
import type { AgentToolResult, ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	getToolUiRuntime,
	installToolUiRuntime,
	registerSuiteOwnedTool,
	ToolUiRuntime,
} from "../../packages/pi-stuff-tools/contract.js";
import { summarizeBuiltin } from "../../packages/pi-stuff-tools/render.js";
import { ToolUiSettingsStore } from "../../packages/pi-stuff-tools/settings.js";

const Params = Type.Object({ value: Type.String() });
type Params = { value: string };
type RenderContext = Parameters<NonNullable<ToolDefinition<typeof Params>["renderCall"]>>[2];

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

function apiHarness(): {
	readonly api: ExtensionAPI;
	readonly tools: Map<string, ToolDefinition>;
} {
	const tools = new Map<string, ToolDefinition>();
	const api = {
		events: {},
		on: () => {},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
	} as unknown as ExtensionAPI;
	return { api, tools };
}

function renderContext(
	state: Record<string, unknown>,
	args: Params,
	overrides: Partial<RenderContext> = {},
): RenderContext {
	return {
		args,
		argsComplete: true,
		cwd: "/project",
		executionStarted: true,
		expanded: false,
		invalidate: () => {},
		isError: false,
		isPartial: false,
		lastComponent: undefined,
		showImages: true,
		state,
		toolCallId: "call-1",
		...overrides,
	};
}

test("renderer decoration preserves the tool contract and model-visible result", async () => {
	const { api, tools } = apiHarness();
	const execute = async (): Promise<AgentToolResult<{ readonly source: string }>> => ({
		content: [{ type: "text", text: "MODEL_VISIBLE" }],
		details: { source: "original" },
	});
	const original: ToolDefinition<typeof Params, { readonly source: string }> = {
		description: "original description",
		execute,
		label: "Original",
		name: "original",
		parameters: Params,
		promptGuidelines: ["original guideline"],
		promptSnippet: "original snippet",
	};

	registerSuiteOwnedTool(api, original, {
		label: "Compact",
		runningSummary: "working",
		summarize: () => "done",
		target: (args) => args.value,
	});
	const decorated = tools.get("original");
	if (!decorated) throw new Error("tool was not registered");

	expect(decorated.parameters).toBe(original.parameters);
	expect(decorated.execute).toBe(original.execute);
	expect(decorated.description).toBe(original.description);
	expect(decorated.promptSnippet).toBe(original.promptSnippet);
	expect(decorated.promptGuidelines).toBe(original.promptGuidelines);
	const executionResult = await decorated.execute(
		"call-1",
		{ value: "工具.txt" },
		new AbortController().signal,
		undefined,
		{} as never,
	);
	expect(executionResult).toEqual({
		content: [{ type: "text", text: "MODEL_VISIBLE" }],
		details: { source: "original" },
	});

	const state = {};
	const args = { value: "工具.txt" };
	const row = decorated.renderCall?.(args, theme, renderContext(state, args));
	expect(row?.render(80).join("\n")).toContain("working");
	decorated.renderResult?.(executionResult, { expanded: false, isPartial: false }, theme, renderContext(state, args));
	expect(row?.render(80).join("\n")).toContain("done");
	expect(getToolUiRuntime(api).activities.get("call-1")?.detailLines.join("\n")).toContain("MODEL_VISIBLE");
	expect(getToolUiRuntime(api).activities.get("call-1")).not.toHaveProperty("args");
	getToolUiRuntime(api).clear();
});

test("keeps one runtime identity when Suite tools register before the Tool package", () => {
	const { api, tools } = apiHarness();
	const beforeInstall = getToolUiRuntime(api);
	const original: ToolDefinition<typeof Params> = {
		description: "reverse load fixture",
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
		label: "Reverse",
		name: "reverse",
		parameters: Params,
	};
	registerSuiteOwnedTool(api, original, { summarize: () => "done" });
	const afterInstall = installToolUiRuntime(api, ToolUiSettingsStore.memory({ liveElapsed: false, schemaVersion: 1 }));

	expect(afterInstall).toBe(beforeInstall);
	const state = {};
	const args = { value: "one" };
	const context = renderContext(state, args, { toolCallId: "reverse-1" });
	tools.get("reverse")?.renderCall?.(args, theme, context);
	tools
		.get("reverse")
		?.renderResult?.(
			{ content: [{ type: "text", text: "ok" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);
	expect(afterInstall.activities.get("reverse-1")?.summary).toBe("done");
	afterInstall.clear();
});

test("does not fabricate elapsed time when Pi replays a historical result", () => {
	const { api, tools } = apiHarness();
	const original: ToolDefinition<typeof Params> = {
		description: "replay fixture",
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
		label: "Bash",
		name: "replayed-bash",
		parameters: Params,
	};
	registerSuiteOwnedTool(api, original, {
		summarize: (args, result, state, durationMs) => summarizeBuiltin("bash", args, result, state, durationMs),
	});
	const state = {};
	const args = { value: "one" };
	const replay = renderContext(state, args, { executionStarted: false, toolCallId: "replay-1" });
	const row = tools.get("replayed-bash")?.renderCall?.(args, theme, replay);
	tools
		.get("replayed-bash")
		?.renderResult?.(
			{ content: [{ type: "text", text: "ok" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			replay,
		);

	expect(row?.render(80).join("\n")).toContain("done");
	expect(row?.render(80).join("\n")).not.toContain("<1s");
	expect(getToolUiRuntime(api).activities.get("replay-1")?.durationMs).toBeUndefined();
	getToolUiRuntime(api).clear();
});

test("errors-only Suite tools stay silent on success and reveal domain errors", () => {
	const { api, tools } = apiHarness();
	const tool: ToolDefinition<typeof Params, { readonly error?: string }> = {
		description: "task fixture",
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
		label: "Task",
		name: "task",
		parameters: Params,
	};
	registerSuiteOwnedTool(api, tool, {
		resultIsError: (_args, result) => Boolean(result.details?.error),
		summarize: (_args, result) => result.details?.error ?? "done",
		transcript: "errors-only",
	});
	const decorated = tools.get("task");
	if (!decorated) throw new Error("tool was not registered");

	const successState = {};
	const args = { value: "1" };
	const successRow = decorated.renderCall?.(args, theme, renderContext(successState, args));
	expect(successRow?.render(80)).toEqual([]);
	decorated.renderResult?.(
		{ content: [{ type: "text", text: "ok" }], details: {} },
		{ expanded: false, isPartial: false },
		theme,
		renderContext(successState, args),
	);
	expect(successRow?.render(80)).toEqual([]);

	const errorState = {};
	const errorContext = renderContext(errorState, args, { toolCallId: "call-2" });
	const errorRow = decorated.renderCall?.(args, theme, errorContext);
	decorated.renderResult?.(
		{ content: [{ type: "text", text: "duplicate" }], details: { error: "duplicate" } },
		{ expanded: false, isPartial: false },
		theme,
		errorContext,
	);
	expect(errorRow?.render(80).join("\n")).toContain("duplicate");
	expect(getToolUiRuntime(api).activities.get("call-2")?.state).toBe("error");
	getToolUiRuntime(api).clear();
});

test("only elapsed-aware presentations schedule one-second row invalidation", () => {
	const { api, tools } = apiHarness();
	const tool = (name: string): ToolDefinition<typeof Params> => ({
		description: name,
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
		label: name,
		name,
		parameters: Params,
	});
	const runtime = getToolUiRuntime(api);
	const startTimer = spyOn(runtime, "startTimer");
	registerSuiteOwnedTool(api, tool("quiet"), { runningSummary: "working" });
	registerSuiteOwnedTool(api, tool("timed"), {
		runningSummary: (_args, durationMs) => `running ${String(durationMs)}ms`,
		tracksElapsed: true,
	});

	const quietState = {};
	tools
		.get("quiet")
		?.renderCall?.({ value: "one" }, theme, renderContext(quietState, { value: "one" }, { toolCallId: "quiet-1" }));
	expect(startTimer).not.toHaveBeenCalled();
	const timedState = {};
	tools
		.get("timed")
		?.renderCall?.({ value: "two" }, theme, renderContext(timedState, { value: "two" }, { toolCallId: "timed-1" }));
	expect(startTimer).toHaveBeenCalledTimes(1);
	runtime.configure(ToolUiSettingsStore.memory({ liveElapsed: false, schemaVersion: 1 }));
	const disabledState = {};
	const disabledRow = tools
		.get("timed")
		?.renderCall?.(
			{ value: "three" },
			theme,
			renderContext(disabledState, { value: "three" }, { toolCallId: "timed-2" }),
		);
	expect(disabledRow?.render(80).join("\n")).toContain("running");
	expect(disabledRow?.render(80).join("\n")).not.toContain("ms");
	expect(startTimer).toHaveBeenCalledTimes(2);
	runtime.clear();
	startTimer.mockRestore();
});

test("timer setting changes repaint active elapsed-aware rows", async () => {
	const settings = ToolUiSettingsStore.memory({ liveElapsed: true, schemaVersion: 1 });
	const runtime = new ToolUiRuntime(settings);
	let invalidations = 0;
	runtime.startTimer("active-1", () => {
		invalidations += 1;
	});
	await settings.setLiveElapsed(false);
	runtime.syncTimers();
	expect(invalidations).toBe(1);
	await settings.setLiveElapsed(true);
	runtime.syncTimers();
	expect(invalidations).toBe(2);
	runtime.stopTimer("active-1");
});
