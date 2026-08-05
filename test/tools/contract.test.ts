import { expect, spyOn, test } from "bun:test";
import type { AgentToolResult, ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	getToolUiRuntime,
	installToolUiRuntime,
	registerSuiteOwnedTool,
	ToolUiRuntime,
	type ToolUiTimerScheduler,
} from "../../packages/pi-stuff-tools/contract.js";
import { CachedToolRow, summarizeBuiltin } from "../../packages/pi-stuff-tools/render.js";
import { ToolUiSettingsStore } from "../../packages/pi-stuff-tools/settings.js";

const Params = Type.Object({ value: Type.String() });
type Params = { value: string };
type RenderContext = Parameters<NonNullable<ToolDefinition<typeof Params>["renderCall"]>>[2];

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

class ManualTimerScheduler implements ToolUiTimerScheduler {
	private readonly callbacks = new Map<number, () => void>();
	private nextId = 1;
	readonly delays: number[] = [];

	get activeCount(): number {
		return this.callbacks.size;
	}

	clearInterval(id: unknown): void {
		if (typeof id === "number") this.callbacks.delete(id);
	}

	setInterval(callback: () => void, delayMs: number): unknown {
		const id = this.nextId;
		this.nextId += 1;
		this.callbacks.set(id, callback);
		this.delays.push(delayMs);
		return id;
	}

	tick(): void {
		for (const callback of [...this.callbacks.values()]) callback();
	}
}

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
	const runtime = getToolUiRuntime(api);
	const stopTimer = spyOn(runtime, "stopTimer");
	const row = decorated.renderCall?.(args, theme, renderContext(state, args));
	expect(row?.render(80).join("\n")).toContain("working");
	decorated.renderResult?.(executionResult, { expanded: false, isPartial: false }, theme, renderContext(state, args));
	expect(row?.render(80).join("\n")).toContain("done");
	expect(stopTimer).toHaveBeenCalledWith("call-1");
	expect(runtime.activities.get("call-1")?.detailLines.join("\n")).toContain("MODEL_VISIBLE");
	expect(runtime.activities.get("call-1")).not.toHaveProperty("args");
	runtime.clear();
	stopTimer.mockRestore();
});

test("settled Suite tools can keep media content below the shared lifecycle row", () => {
	const { api, tools } = apiHarness();
	const original: ToolDefinition<typeof Params, { readonly media: boolean }> = {
		description: "media fixture",
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: { media: true } }),
		label: "Media",
		name: "media",
		parameters: Params,
	};
	registerSuiteOwnedTool(api, original, {
		resultBody: (_args, result) => (result.details.media ? new Text("MEDIA_BODY", 0, 0) : undefined),
		summarize: () => "done",
	});
	const decorated = tools.get("media");
	if (!decorated) throw new Error("media tool was not registered");
	const state = {};
	const args = { value: "image.png" };
	const context = renderContext(state, args);
	decorated.renderCall?.(args, theme, context);
	const partial = decorated.renderResult?.(
		{ content: [{ type: "text", text: "pending" }], details: { media: true } },
		{ expanded: false, isPartial: true },
		theme,
		context,
	);
	expect(partial?.render(80)).toEqual([]);
	const settled = decorated.renderResult?.(
		{ content: [{ type: "text", text: "ok" }], details: { media: true } },
		{ expanded: false, isPartial: false },
		theme,
		context,
	);
	expect(settled?.render(80).join("\n")).toContain("MEDIA_BODY");
	getToolUiRuntime(api).clear();
});

test("collapses only adjacent successful exploration rows without losing local Tool records", () => {
	const { api, tools } = apiHarness();
	const explore: ToolDefinition<typeof Params> = {
		description: "exploration fixture",
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
		label: "Read",
		name: "explore",
		parameters: Params,
	};
	const mutate: ToolDefinition<typeof Params> = {
		...explore,
		description: "mutation fixture",
		label: "Write",
		name: "mutate",
	};
	registerSuiteOwnedTool(api, explore, {
		grouping: "exploration",
		summarize: (_args, _result, state) => (state === "success" ? "1 line" : "boom"),
		target: (args) => args.value,
	});
	registerSuiteOwnedTool(api, mutate, { summarize: () => "written" });
	const runtime = getToolUiRuntime(api);
	runtime.indexMessages([
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "explore-1", name: "explore", arguments: { value: "一.txt" } },
				{ type: "toolCall", id: "explore-2", name: "explore", arguments: { value: "二.txt" } },
				{ type: "toolCall", id: "mutate-1", name: "mutate", arguments: { value: "out.txt" } },
				{ type: "toolCall", id: "explore-3", name: "explore", arguments: { value: "三.txt" } },
				{ type: "toolCall", id: "explore-4", name: "explore", arguments: { value: "四.txt" } },
			],
		},
	]);

	const settled = (name: "explore" | "mutate", id: string, value: string, isError = false) => {
		const state = {};
		const args = { value };
		const context = renderContext(state, args, { isError, toolCallId: id });
		const definition = tools.get(name);
		const row = definition?.renderCall?.(args, theme, context);
		definition?.renderResult?.(
			{ content: [{ type: "text", text: isError ? "boom" : "ok" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);
		return row;
	};

	const first = settled("explore", "explore-1", "一.txt");
	const second = settled("explore", "explore-2", "二.txt");
	const mutation = settled("mutate", "mutate-1", "out.txt");
	const third = settled("explore", "explore-3", "三.txt");
	const failed = settled("explore", "explore-4", "四.txt", true);

	expect(first?.render(80)).toEqual(["● Explore 2 operations · Read ×2"]);
	expect(second?.render(80)).toEqual([]);
	expect(mutation?.render(80).join("\n")).toContain("Write");
	expect(third?.render(80).join("\n")).toContain("三.txt");
	expect(failed?.render(80).join("\n")).toContain("boom");
	expect(
		runtime.activities
			.list()
			.map((activity) => activity.id)
			.sort(),
	).toEqual(["explore-1", "explore-2", "explore-3", "explore-4", "mutate-1"]);

	runtime.indexMessages([]);
	expect(first?.render(80).join("\n")).toContain("一.txt");
	expect(second?.render(80).join("\n")).toContain("二.txt");
	runtime.clear();
});

test("replans late grouping ownership and honors final-result collapse vetoes", () => {
	const { api, tools } = apiHarness();
	const tool: ToolDefinition<typeof Params, { readonly detached: boolean }> = {
		description: "late grouping fixture",
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: { detached: false } }),
		label: "Bash",
		name: "late",
		parameters: Params,
	};
	registerSuiteOwnedTool(api, tool, {
		grouping: "exploration",
		summarize: () => "done",
		target: (args) => args.value,
	});
	const runtime = getToolUiRuntime(api);
	runtime.indexMessages([
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "late-1", name: "late", arguments: { value: "foreground-one" } },
				{ type: "toolCall", id: "late-2", name: "late", arguments: { value: "foreground-two" } },
			],
		},
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "late-3", name: "late", arguments: { value: "background-one" } },
				{ type: "toolCall", id: "late-4", name: "late", arguments: { value: "background-two" } },
			],
		},
	]);

	const settle = (id: string, value: string, detached = false) => {
		const args = { value };
		const context = renderContext({}, args, { toolCallId: id });
		const row = tools.get("late")?.renderCall?.(args, theme, context);
		tools
			.get("late")
			?.renderResult?.(
				{ content: [{ type: "text", text: "ok" }], details: { detached } },
				{ expanded: false, isPartial: false },
				theme,
				context,
			);
		return row;
	};

	const foregroundOne = settle("late-1", "foreground-one");
	const foregroundTwo = settle("late-2", "foreground-two", true);
	const backgroundOne = settle("late-3", "background-one");
	const backgroundTwo = settle("late-4", "background-two");
	expect(foregroundOne?.render(80).join("\n")).toContain("Explore 2 operations");
	expect(backgroundOne?.render(80).join("\n")).toContain("Explore 2 operations");

	runtime.registerGrouping<Params, { readonly detached: boolean }>(
		"late",
		(args) => (args.value.startsWith("foreground") ? "exploration" : "standalone"),
		(_args, result) => !result.details.detached,
	);
	expect(foregroundOne?.render(80).join("\n")).toContain("foreground-one");
	expect(foregroundTwo?.render(80).join("\n")).toContain("foreground-two");
	expect(backgroundOne?.render(80).join("\n")).toContain("background-one");
	expect(backgroundTwo?.render(80).join("\n")).toContain("background-two");
	runtime.clear();
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

test("all visible live rows schedule blink invalidation while replay stays static", () => {
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
	expect(startTimer).toHaveBeenCalledTimes(1);
	const timedState = {};
	tools
		.get("timed")
		?.renderCall?.({ value: "two" }, theme, renderContext(timedState, { value: "two" }, { toolCallId: "timed-1" }));
	expect(startTimer).toHaveBeenCalledTimes(2);
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
	expect(startTimer).toHaveBeenCalledTimes(3);

	const replayState = {};
	tools
		.get("quiet")
		?.renderCall?.(
			{ value: "replay" },
			theme,
			renderContext(replayState, { value: "replay" }, { executionStarted: false, toolCallId: "quiet-replay" }),
		);
	expect(startTimer).toHaveBeenCalledTimes(3);
	runtime.clear();
	startTimer.mockRestore();
});

test("uses a deterministic 600 ms blink and clears stopped timers", async () => {
	const settings = ToolUiSettingsStore.memory({ liveElapsed: true, schemaVersion: 1 });
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(settings, scheduler);
	const row = new CachedToolRow(theme, {
		durationMs: 0,
		label: "Read",
		state: "running",
		summary: "running",
		target: "工具.txt",
	});
	let invalidations = 0;
	runtime.startTimer(
		"active-1",
		() => {
			invalidations += 1;
		},
		(visible) => row.setMarkerVisible(visible),
	);
	expect(scheduler.delays).toEqual([600]);
	expect(scheduler.activeCount).toBe(1);
	expect(row.render(80)[0]).toStartWith("● Read");
	scheduler.tick();
	expect(invalidations).toBe(1);
	expect(row.render(80)[0]).toStartWith("  Read");
	scheduler.tick();
	expect(invalidations).toBe(2);
	expect(row.render(80)[0]).toStartWith("● Read");

	await settings.setLiveElapsed(false);
	runtime.syncTimers();
	expect(invalidations).toBe(3);
	expect(scheduler.activeCount).toBe(1);
	await settings.setLiveElapsed(true);
	runtime.syncTimers();
	expect(invalidations).toBe(4);
	expect(scheduler.activeCount).toBe(1);
	runtime.stopTimer("active-1");
	expect(scheduler.activeCount).toBe(0);
	expect(row.render(80)[0]).toStartWith("● Read");
	scheduler.tick();
	expect(invalidations).toBe(4);
});
