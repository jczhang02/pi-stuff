import { expect, test } from "bun:test";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	assertSuiteToolActivityCoverage,
	createSuiteToolRegistrationTracker,
	getToolUiRuntime,
	installToolUiRuntime,
	registerSuiteOwnedTool,
	ToolUiRuntime,
	type ToolUiTimerScheduler,
} from "../../packages/pi-stuff-tools/contract.js";
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
		const id = this.nextId++;
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
		getAllTools: () => [...tools.values()],
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

function assistant(...content: unknown[]): unknown {
	return { role: "assistant", content };
}

function call(id: string, name: string, value: string): unknown {
	return { type: "toolCall", id, name, arguments: { value } };
}

function result(id: string, text = "ok", isError = false): unknown {
	return {
		role: "toolResult",
		toolCallId: id,
		content: [{ type: "text", text }],
		details: {},
		...(isError ? { isError: true } : {}),
	};
}

function presentation(category: "change-file" | "read-file" | "run-command") {
	return {
		activity: {
			categories: [category],
			classify: ({ args }: { args: Readonly<Params> }) => [
				category === "run-command"
					? { category, count: 1, target: args.value }
					: { category, countKeys: [args.value], target: args.value },
			],
		},
		label: category,
		runningSummary: "working",
		summarize: (_args: Readonly<Params>, _result: unknown, state: string) => (state === "success" ? "done" : state),
		target: (args: Readonly<Params>) => args.value,
	};
}

function toolFromHarness(
	harness: ReturnType<typeof apiHarness>,
	name: string,
	category: "change-file" | "read-file" | "run-command",
): ToolDefinition<typeof Params, { source: string }> {
	const original: ToolDefinition<typeof Params, { source: string }> = {
		description: `${name} fixture`,
		execute: async () => ({
			content: [{ type: "text", text: "MODEL_VISIBLE" }],
			details: { source: name },
		}),
		label: name,
		name,
		parameters: Params,
	};
	registerSuiteOwnedTool(harness.api, original, presentation(category));
	const decorated = harness.tools.get(name);
	if (!decorated) throw new Error(`missing ${name}`);
	return decorated as ToolDefinition<typeof Params, { source: string }>;
}

function renderLines(component: { render(width: number): string[] }, width = 120): string[] {
	return component.render(width);
}

test("Aggregate coverage fails fast when a Tool bypasses Activity metadata", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "covered", "read-file");
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["covered"])).not.toThrow();
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["covered", "missing"])).toThrow(
		"Aggregate Tools missing Activity metadata: missing",
	);
});

test("Aggregate coverage checks the Tools actually registered by capabilities", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	registrations.api.registerTool({
		description: "untracked fixture",
		execute: async () => ({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}),
		label: "Untracked",
		name: "untracked",
		parameters: Params,
	});
	expect(() => assertSuiteToolActivityCoverage(harness.api, [], registrations.toolNames)).toThrow(
		"Aggregate registered undeclared Tools: untracked",
	);
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["declared"], new Set())).toThrow(
		"Aggregate declared unregistered Tools: declared",
	);
});

test("Aggregate coverage accepts an already registered Tool from an idempotent capability", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "existing", "read-file");
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["existing"], new Set())).not.toThrow();
});

test("Aggregate coverage permits optional Tools when absent and checks them when registered", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	expect(() => assertSuiteToolActivityCoverage(harness.api, [], registrations.toolNames, ["optional"])).not.toThrow();
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "dynamic fixture",
			execute: async () => ({
				content: [{ type: "text", text: "ok" }],
				details: {},
			}),
			label: "Optional",
			name: "optional",
			parameters: Params,
		},
		presentation("run-command"),
	);
	expect(() => assertSuiteToolActivityCoverage(harness.api, [], registrations.toolNames, ["optional"])).not.toThrow();
});

test("Aggregate coverage accepts deferred Tools before registration but still requires metadata", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	expect(() => assertSuiteToolActivityCoverage(harness.api, [], registrations.toolNames, [], ["deferred"])).toThrow(
		"Aggregate Tools missing Activity metadata: deferred",
	);
	getToolUiRuntime(harness.api).registerActivity("deferred", presentation("run-command").activity);
	expect(() =>
		assertSuiteToolActivityCoverage(harness.api, [], registrations.toolNames, [], ["deferred"]),
	).not.toThrow();
});

function settle(
	tool: ToolDefinition<typeof Params, { source: string }>,
	id: string,
	value: string,
	isError = false,
	expanded = false,
): {
	callComponent: { render(width: number): string[] };
	callLines: string[];
	resultLines: string[];
} {
	const state = {};
	const args = { value };
	const context = renderContext(state, args, {
		expanded,
		isError,
		toolCallId: id,
	});
	const component = tool.renderCall?.(args, theme, context);
	if (!component) throw new Error("missing call component");
	const body = tool.renderResult?.(
		{
			content: [{ type: "text", text: isError ? "FAILED" : "MODEL_VISIBLE" }],
			details: { source: value },
		},
		{ expanded, isPartial: false },
		theme,
		{ ...context, lastComponent: component },
	);
	return {
		callComponent: component,
		callLines: renderLines(component),
		resultLines: body ? renderLines(body) : [],
	};
}

test("decoration preserves execution and projects one Tool immediately", async () => {
	const harness = apiHarness();
	const tool = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([assistant(call("r1", "read", "a.ts"))]);

	const execution = await tool.execute("r1", { value: "a.ts" }, undefined, undefined, {} as never);
	expect(execution.content).toEqual([{ type: "text", text: "MODEL_VISIBLE" }]);
	const rendered = settle(tool, "r1", "a.ts");
	expect(rendered.callLines.join("\n")).toContain("Reading 1 file");
	expect(rendered.callLines.join("\n")).not.toContain("a.ts · done");
	expect(rendered.resultLines).toEqual([]);

	runtime.endTurn();
	expect(renderLines(rendered.callComponent).join("\n")).toContain("Read 1 file");
});

test("live targets remain stable for at least 700 ms", () => {
	let now = 0;
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), new ManualTimerScheduler(), () => now);
	const stableTarget = (
		runtime as unknown as {
			stableTarget(leaderId: string, candidate: string, active: boolean): string;
		}
	).stableTarget.bind(runtime);

	expect(stableTarget("group", "first.ts", true)).toBe("first.ts");
	now = 699;
	expect(stableTarget("group", "second.ts", true)).toBe("first.ts");
	now = 700;
	expect(stableTarget("group", "second.ts", true)).toBe("second.ts");
	expect(stableTarget("group", "second.ts", false)).toBe("");
});

test("live Activity Groups advance to the latest target after the hold", () => {
	const harness = apiHarness();
	let now = 0;
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	(runtime as unknown as { now: () => number }).now = () => now;
	const firstState = {};
	runtime.startTurn([assistant(call("r1", "read", "first.ts"))]);
	const first = read.renderCall?.(
		{ value: "first.ts" },
		theme,
		renderContext(firstState, { value: "first.ts" }, { toolCallId: "r1" }),
	);
	if (!first) throw new Error("missing first component");
	runtime.indexMessage(result("r1"));
	runtime.indexMessage(assistant({ type: "thinking", thinking: "continue" }, call("r2", "read", "second.ts")));
	read.renderCall?.({ value: "second.ts" }, theme, renderContext({}, { value: "second.ts" }, { toolCallId: "r2" }));
	const hints = (
		runtime as unknown as {
			groupHints: Map<string, { candidate: string; shownAt: number; value: string }>;
		}
	).groupHints;
	expect(hints.get("r1")).toEqual({
		candidate: "second.ts",
		shownAt: 0,
		value: "first.ts",
	});

	now = 700;
	runtime.indexMessages(
		[
			assistant(call("r1", "read", "first.ts")),
			result("r1"),
			assistant({ type: "thinking", thinking: "continue" }, call("r2", "read", "second.ts")),
		],
		false,
	);
	expect(hints.get("r1")).toEqual({
		candidate: "second.ts",
		shownAt: 700,
		value: "second.ts",
	});
	expect(renderLines(first).join("\n")).toContain("second.ts");
});

test("one group spans Tool round-trips and Thinking, then closes on prose", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const edit = toolFromHarness(harness, "edit", "change-file");
	const runtime = getToolUiRuntime(harness.api);
	const messages = [
		assistant({ type: "thinking", thinking: "inspect" }, call("r1", "read", "a.ts")),
		result("r1"),
		assistant({ type: "thinking", thinking: "change" }, call("e1", "edit", "a.ts")),
	];
	runtime.startTurn(messages);
	const first = settle(read, "r1", "a.ts");
	const second = settle(edit, "e1", "a.ts");
	expect(first.callLines.join("\n")).toContain("Changing 1 file, reading 1 file");
	expect(second.callLines).toEqual([]);

	runtime.indexMessage(assistant({ type: "text", text: "Done." }));
	expect(renderLines(first.callComponent).join("\n")).toContain("Changed 1 file, read 1 file");
});

test("projection rebuild rebinds grouped models to fresh Host row components", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const edit = toolFromHarness(harness, "edit", "change-file");
	const runtime = getToolUiRuntime(harness.api);
	const messages = [assistant(call("r1", "read", "a.ts"), call("e1", "edit", "b.ts")), result("r1"), result("e1")];
	runtime.indexMessages(messages, true);
	settle(read, "r1", "a.ts");
	settle(edit, "e1", "b.ts");

	runtime.resetProjection(messages);
	const rebuiltLeader = settle(read, "r1", "a.ts");
	const rebuiltFollower = settle(edit, "e1", "b.ts");
	expect(renderLines(rebuiltLeader.callComponent).join("\n")).toContain("Changed 1 file, read 1 file");
	expect(renderLines(rebuiltFollower.callComponent)).toEqual([]);
});

test("a user input boundary prevents the next turn from reusing the previous group", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const edit = toolFromHarness(harness, "edit", "change-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([assistant(call("r1", "read", "a.ts"))]);
	const first = settle(read, "r1", "a.ts");

	runtime.observeUserBoundary();
	runtime.startTurn();
	runtime.indexMessage(assistant(call("e1", "edit", "b.ts")));
	const second = settle(edit, "e1", "b.ts");
	expect(renderLines(first.callComponent).join("\n")).toContain("Read 1 file");
	expect(renderLines(first.callComponent).join("\n")).not.toContain("Changed");
	expect(renderLines(second.callComponent).join("\n")).toContain("Changing 1 file");
});

test("Tool results, Thinking, and hidden Custom Messages keep the live group open", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([assistant(call("r1", "read", "a.ts"))]);
	runtime.indexMessage(result("r1"));
	runtime.indexMessage(assistant({ type: "thinking", thinking: "continue" }));
	runtime.indexMessage({
		role: "custom",
		customType: "state",
		content: "hidden",
		display: false,
	});
	const active = runtime.resolveGroup("r1");
	if (!active || active === "ambiguous") throw new Error("active group missing");
	expect(active.summary).toContain("Reading 1 file");

	runtime.indexMessage({
		role: "custom",
		customType: "notice",
		content: "visible",
		display: true,
	});
	const closed = runtime.resolveGroup("r1");
	if (!closed || closed === "ambiguous") throw new Error("closed group missing");
	expect(closed.summary).toContain("Read 1 file");
});

test("Ctrl+O restores every member and bounded result detail", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const edit = toolFromHarness(harness, "edit", "change-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages(
		[assistant(call("r1", "read", "a.ts"), call("e1", "edit", "b.ts")), result("r1"), result("e1")],
		true,
	);

	const compactRead = settle(read, "r1", "a.ts");
	const compactEdit = settle(edit, "e1", "b.ts");
	expect(compactRead.callLines.join("\n")).toContain("Changed 1 file, read 1 file");
	expect(compactEdit.callLines).toEqual([]);

	const expandedRead = settle(read, "r1", "a.ts", false, true);
	const expandedEdit = settle(edit, "e1", "b.ts", false, true);
	expect(expandedRead.callLines.join("\n")).toContain("read-file");
	expect(expandedEdit.callLines.join("\n")).toContain("change-file");
	expect(expandedRead.resultLines.join("\n")).toContain("MODEL_VISIBLE");
});

test("compact projection hides text bodies but preserves real media", () => {
	const harness = apiHarness();
	const tool = toolFromHarness(harness, "view", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages([assistant(call("v1", "view", "pixel.png"))], true);
	const state = {};
	const args = { value: "pixel.png" };
	const context = renderContext(state, args, { toolCallId: "v1" });
	const component = tool.renderCall?.(args, theme, context);
	if (!component) throw new Error("missing media call component");
	const body = tool.renderResult?.(
		{
			content: [
				{ type: "text", text: "hidden text" },
				{
					type: "image",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
					mimeType: "image/png",
				},
			],
			details: { source: "pixel.png" },
		},
		{ expanded: false, isPartial: false },
		theme,
		{ ...context, lastComponent: component },
	);
	expect(body?.render(80).length).toBeGreaterThan(0);
	expect(body?.render(80).join("\n")).not.toContain("hidden text");
});

test("issues stay folded but expose the first failure and remaining count", () => {
	const harness = apiHarness();
	const command = toolFromHarness(harness, "bash", "run-command");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages(
		[
			assistant(call("b1", "bash", "typecheck"), call("b2", "bash", "tests")),
			result("b1", "FIRST FAILED", true),
			result("b2", "SECOND FAILED", true),
		],
		true,
	);
	const first = settle(command, "b1", "typecheck", true);
	settle(command, "b2", "tests", true);
	const output = renderLines(first.callComponent).join("\n");
	expect(output).toContain("Ran 2 commands · 2 failed");
	expect(output).toContain("run-command error · +1 issues");
});

test("failed mutations never produce successful change clauses", () => {
	const harness = apiHarness();
	const mutation = toolFromHarness(harness, "edit", "change-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages([assistant(call("e1", "edit", "broken.ts")), result("e1", "EDIT FAILED", true)], true);
	const output = settle(mutation, "e1", "broken.ts", true).callLines.join("\n");
	expect(output).toContain("change-file failed");
	expect(output).not.toContain("Changed");
});

test("successful infrastructure-only groups disappear but expand normally", () => {
	const harness = apiHarness();
	const original: ToolDefinition<typeof Params, { source: string }> = {
		description: "internal",
		execute: async () => ({
			content: [{ type: "text", text: "done" }],
			details: { source: "internal" },
		}),
		label: "internal",
		name: "internal",
		parameters: Params,
	};
	registerSuiteOwnedTool(harness.api, original, {
		activity: { categories: [], classify: () => [], silentSuccess: true },
		label: "internal",
		summarize: () => "done",
	});
	const tool = harness.tools.get("internal") as ToolDefinition<typeof Params, { source: string }>;
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages([assistant(call("i1", "internal", "context")), result("i1")], true);
	expect(settle(tool, "i1", "context").callLines).toEqual([]);
	expect(settle(tool, "i1", "context", false, true).callLines.join("\n")).toContain("internal");
	const [details] = runtime.listGroups();
	expect(details?.summary).toBe("Internal activity");
	expect(details ? runtime.groupActivities(details.id) : []).toHaveLength(1);
});

test("group details rebuild every member from the current branch beyond the live cache limit", () => {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity("read", {
		categories: ["read-file"],
		classify: ({ args }) => [{ category: "read-file", countKeys: [String(args["value"])] }],
	});
	const content = Array.from({ length: 900 }, (_, index) =>
		call(`read-${String(index)}`, "read", `${String(index)}.ts`),
	);
	const results = Array.from({ length: 900 }, (_, index) => result(`read-${String(index)}`));
	runtime.indexMessages([assistant(...content), ...results], true);
	const group = runtime.resolveGroup("read-0");
	expect(group).not.toBe("ambiguous");
	if (!group || group === "ambiguous") throw new Error("group missing");
	expect(group.memberIds).toHaveLength(900);
	expect(runtime.groupActivities(group.id)).toHaveLength(900);
	expect(runtime.groupActivityPage(group.id, 512, 2).map((activity) => activity.id)).toEqual(["read-512", "read-513"]);
	expect(runtime.groupActivityPage(group.id, 900, 2)).toEqual([]);
});

test("reload handoff crosses the fresh Extension event registry created by Pi", () => {
	const outgoing = new ToolUiRuntime();
	outgoing.prepareReload(["read", "bash"]);
	const incoming = new ToolUiRuntime();
	expect(incoming.hasReloadSnapshot()).toBe(true);
	expect(incoming.consumeReloadActiveTools()).toEqual(["read", "bash"]);
	expect(incoming.hasReloadSnapshot()).toBe(false);
});

test("timers blink, invalidate, synchronize, and are cleared for reload", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	let invalidations = 0;
	const markers: boolean[] = [];
	runtime.startTimer(
		"call",
		() => invalidations++,
		(visible) => markers.push(visible),
	);
	expect(scheduler.delays).toEqual([600]);
	scheduler.tick();
	expect(invalidations).toBe(1);
	expect(markers.at(-1)).toBe(false);
	runtime.syncTimers();
	expect(markers.at(-1)).toBe(true);
	expect(invalidations).toBe(2);
	runtime.prepareReload([]);
	expect(scheduler.activeCount).toBe(0);
	expect(runtime.consumeReloadActiveTools()).toEqual([]);
});

test("parallel timers keep independent marker phases", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	const first: boolean[] = [];
	const second: boolean[] = [];
	runtime.startTimer(
		"first",
		() => {},
		(visible) => first.push(visible),
	);
	runtime.startTimer(
		"second",
		() => {},
		(visible) => second.push(visible),
	);
	scheduler.tick();
	expect(first.at(-1)).toBe(false);
	expect(second.at(-1)).toBe(false);
});

test("runtime registry is shared per Pi event bus and settings remain configurable", () => {
	const first = apiHarness();
	const second = apiHarness();
	const settings = ToolUiSettingsStore.memory({
		liveElapsed: false,
		schemaVersion: 1,
	});
	expect(installToolUiRuntime(first.api, settings)).toBe(getToolUiRuntime(first.api));
	expect(getToolUiRuntime(first.api)).not.toBe(getToolUiRuntime(second.api));
	expect(getToolUiRuntime(first.api).showLiveElapsed()).toBe(false);
});
