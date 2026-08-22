import { expect, test } from "bun:test";
import {
	createEventBus,
	type AgentToolResult,
	type EventBus,
	type Theme,
	type ToolDefinition,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { ToolExecutionComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import { initTheme } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { isRuntimeNumber } from "../../packages/pi-stuff/src/shared/runtime-type.js";
import { classifyBashActivity } from "../../packages/pi-stuff/src/tool-display/activity.js";
import {
	assertSuiteToolActivityCoverage,
	createSuiteToolRegistrationTracker,
	getToolUiRuntime,
	installToolUiRuntime,
	registerSuiteOwnedTool,
	registerSuiteToolEnvelope,
	registerSuiteToolEnvelopeCompanion,
	type SuiteToolCodeModeContract,
	type SuiteToolEnvelopeOperation,
	type SuiteToolTrackerHost,
	ToolUiRuntime,
	type ToolUiTimerScheduler,
} from "../../packages/pi-stuff/src/tool-display/contract.js";
import { CachedToolRow } from "../../packages/pi-stuff/src/tool-display/render.js";
import { ToolUiSettingsStore } from "../../packages/pi-stuff/src/tool-display/settings.js";

const Params = Type.Object({ value: Type.String() });
const BashParams = Type.Object({ command: Type.String() });
type Params = { value: string };
type RenderContext = Parameters<NonNullable<ToolDefinition<typeof Params>["renderCall"]>>[2];

// SAFETY: this test fixture implements the exact Host surface exercised by this case.
const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as Theme;

class ManualTimerScheduler implements ToolUiTimerScheduler {
	private readonly callbacks = new Map<number, () => void>();
	private nextId = 1;
	readonly delays: number[] = [];

	get activeCount(): number {
		return this.callbacks.size;
	}

	clearInterval(id: ReturnType<ToolUiTimerScheduler["setInterval"]>): void {
		if (isRuntimeNumber(id)) this.callbacks.delete(id);
	}

	setInterval(callback: () => void, delayMs: number): ReturnType<ToolUiTimerScheduler["setInterval"]> {
		const id = this.nextId++;
		this.callbacks.set(id, callback);
		this.delays.push(delayMs);
		return id;
	}

	tick(): void {
		for (const callback of Array.from(this.callbacks.values())) callback();
	}
}

type EventBusLike = Pick<EventBus, "emit" | "on">;
type EventBusListener = Parameters<EventBus["on"]>[1];
type EventBusPayload = Parameters<EventBusListener>[0];

class EventBusHarness implements EventBusLike {
	private readonly listeners = new Map<string, Set<EventBusListener>>();

	emit(event: string, data: EventBusPayload): void {
		for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(data);
	}

	on(event: string, listener: EventBusListener): () => void {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
		return () => listeners.delete(listener);
	}
}

function eventBusView(bus: EventBusHarness): EventBusLike {
	return {
		emit: (event, data) => bus.emit(event, data),
		on: (event, listener) => bus.on(event, listener),
	};
}

function apiHarness(events: EventBus = createEventBus()) {
	let activeTools: string[] = [];
	const tools = new Map<string, ToolDefinition>();
	const api: SuiteToolTrackerHost = {
		events,
		getActiveTools: () => [...activeTools],
		getAllTools: () =>
			[...tools.values()].map((tool): ToolInfo => {
				const info: ToolInfo = {
					description: tool.description,
					name: tool.name,
					parameters: tool.parameters,
					sourceInfo: { origin: "top-level", path: "<test>", scope: "temporary", source: "test" },
				};
				if (tool.promptGuidelines !== undefined) info.promptGuidelines = tool.promptGuidelines;
				return info;
			}),
		on: () => {},
		registerTool: (tool) => {
			// SAFETY: the test registry erases only generic renderer state and retains the original Tool object.
			tools.set(tool.name, tool as ToolDefinition);
			if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
		},
		setActiveTools: (names: string[]) => {
			activeTools = [...names];
		},
	};
	return { api, tools };
}

function renderContext(
	state: RenderContext["state"],
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

function assistant(...content: unknown[]) {
	return { role: "assistant", content };
}

function call(id: string, name: string, value: string) {
	return { type: "toolCall", id, name, arguments: { value } };
}

function result(id: string, text = "ok", isError = false) {
	return Object.assign(
		{
			role: "toolResult",
			toolCallId: id,
			content: [{ type: "text", text }],
			details: {},
		},
		isError ? { isError: true } : undefined,
	);
}

function bashCall(id: string, command: string) {
	return { type: "toolCall", id, name: "bash", arguments: { command, value: command } };
}

type FixtureCategory =
	| "change-file"
	| "fetch-page"
	| "list-directory"
	| "read-file"
	| "run-command"
	| "search-pattern"
	| "view-image";

function presentation(category: FixtureCategory) {
	return {
		activity: {
			categories: [category],
			classify: ({ args }: { args: Readonly<Params> }) => [
				category === "run-command" || category === "search-pattern" || category === "list-directory"
					? { category, count: 1, target: args.value }
					: { category, countKeys: [args.value], target: args.value },
			],
		},
		label: category,
		runningSummary: "working",
		summarize: (_args: Readonly<Params>, _result: AgentToolResult<unknown>, state: string) =>
			state === "success" ? "done" : state,
		target: (args: Readonly<Params>) => args.value,
	};
}

function toolFromHarness(
	harness: Pick<ReturnType<typeof apiHarness>, "api" | "tools">,
	name: string,
	category: FixtureCategory,
	codeMode?: SuiteToolCodeModeContract,
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
	const fixturePresentation = presentation(category);
	registerSuiteOwnedTool(
		harness.api,
		original,
		name === "bash"
			? {
					...fixturePresentation,
					activity: {
						categories: ["run-command", "read-file", "search-pattern", "list-directory"],
						classify: (input) =>
							classifyBashActivity({
								...input,
								args: { ...input.args, command: input.args["command"] ?? input.args["value"] },
							}),
					},
				}
			: fixturePresentation,
		codeMode,
	);
	const decorated = harness.tools.get(name);
	if (!decorated) throw new Error(`missing ${name}`);
	// SAFETY: this test controls the value and supplies every ToolDefinition member exercised by this case.
	return decorated as ToolDefinition<typeof Params, { source: string }>;
}

function renderLines(component: { render(width: number): string[] }, width = 120): string[] {
	return component.render(width);
}

test("Suite coverage fails fast when a Tool bypasses Activity metadata", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "covered", "read-file");
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["covered"])).not.toThrow();
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["covered", "missing"])).toThrow(
		"Suite Tools missing Activity metadata: missing",
	);
});

test("Suite coverage checks the Tools actually registered by modules", () => {
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
		"Suite registered undeclared Tools: untracked",
	);
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["declared"], new Set())).toThrow(
		"Suite declared unregistered Tools: declared",
	);
});

test("Suite coverage rejects metadata-only Tools without the owned Activity renderer", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	getToolUiRuntime(harness.api).registerActivity("metadata-only", presentation("run-command").activity);
	registrations.api.registerTool({
		description: "metadata-only fixture",
		execute: async () => ({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}),
		label: "Metadata only",
		name: "metadata-only",
		parameters: Params,
	});
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["metadata-only"], registrations.toolNames)).toThrow(
		"Suite Tools missing Activity renderer: metadata-only",
	);
});

test("Suite coverage accepts an already registered Tool from an idempotent module", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "existing", "read-file");
	expect(() => assertSuiteToolActivityCoverage(harness.api, ["existing"], new Set())).not.toThrow();
});

test("Suite coverage permits optional Tools when absent and checks them when registered", () => {
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

test("Suite coverage accepts deferred Tools before registration but still requires metadata", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	expect(() => assertSuiteToolActivityCoverage(harness.api, [], registrations.toolNames, [], ["deferred"])).toThrow(
		"Suite Tools missing Activity metadata: deferred",
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
	resultText = isError ? "FAILED" : "MODEL_VISIBLE",
) {
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
			content: [{ type: "text", text: resultText }],
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

	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	const execution = await tool.execute("r1", { value: "a.ts" }, undefined, undefined, {} as never);
	expect(execution.content).toEqual([{ type: "text", text: "MODEL_VISIBLE" }]);
	const rendered = settle(tool, "r1", "a.ts");
	expect(rendered.callLines.join("\n")).toContain("Reading 1 file");
	expect(rendered.callLines.join("\n")).not.toContain("a.ts · done");
	expect(rendered.resultLines).toEqual([]);

	runtime.endTurn();
	expect(renderLines(rendered.callComponent).join("\n")).toContain("Read 1 file");
});

test("settled Host redraws build detail only while globally expanded", () => {
	const harness = apiHarness();
	let detailBuilds = 0;
	registerSuiteOwnedTool(
		harness.api,
		{
			description: "lazy detail fixture",
			execute: async () => ({ content: [{ type: "text", text: "MODEL_VISIBLE" }], details: { source: "read" } }),
			label: "Read",
			name: "read",
			parameters: Params,
		},
		{
			...presentation("read-file"),
			detailLines: () => {
				detailBuilds += 1;
				return ["PRESENTATION_DETAIL"];
			},
		},
	);
	// SAFETY: this test controls the value and supplies every ToolDefinition member exercised by this case.
	const tool = harness.tools.get("read") as ToolDefinition<typeof Params, { source: string }>;
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages([assistant(call("lazy-read", "read", "a.ts")), result("lazy-read", "MODEL_VISIBLE")], true);
	const state = {};
	const args = { value: "a.ts" };
	const base = renderContext(state, args, { executionStarted: false, toolCallId: "lazy-read" });
	const component = tool.renderCall?.(args, theme, base);
	if (!component) throw new Error("missing lazy detail component");
	const finalResult = {
		content: [{ type: "text" as const, text: "MODEL_VISIBLE" }],
		details: { source: "read" },
	};
	const redraw = (expanded: boolean): string[] => {
		const context = { ...base, expanded, lastComponent: component };
		tool.renderCall?.(args, theme, context);
		const body = tool.renderResult?.(finalResult, { expanded, isPartial: false }, theme, context);
		return body ? renderLines(body) : [];
	};

	redraw(false);
	redraw(false);
	expect(detailBuilds).toBe(0);
	expect(runtime.groupActivities("lazy-read")[0]?.detailLines).toEqual([]);
	expect(redraw(true).join("\n")).toContain("PRESENTATION_DETAIL");
	expect(detailBuilds).toBe(1);
	redraw(true);
	expect(detailBuilds).toBe(1);
	redraw(false);
	expect(redraw(true).join("\n")).toContain("PRESENTATION_DETAIL");
	expect(detailBuilds).toBe(2);
});

test("collapsed and expanded historical replay skip the synthetic running pass", () => {
	const harness = apiHarness();
	let runningSummaries = 0;
	let terminalSummaries = 0;
	registerSuiteOwnedTool(
		harness.api,
		{
			description: "historical replay fixture",
			execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
			label: "Read",
			name: "read",
			parameters: Params,
		},
		{
			...presentation("read-file"),
			runningSummary: () => {
				runningSummaries += 1;
				return "reading";
			},
			summarize: () => {
				terminalSummaries += 1;
				return "done";
			},
		},
	);
	// SAFETY: this test controls the value and supplies every ToolDefinition member exercised by this case.
	const tool = harness.tools.get("read") as ToolDefinition<typeof Params, { source: string }>;
	const runtime = getToolUiRuntime(harness.api);
	for (const expanded of [false, true]) {
		const toolCallId = expanded ? "replay-read-expanded" : "replay-read";
		runtime.indexMessages([assistant(call(toolCallId, "read", "a.ts")), result(toolCallId, "done")], true);
		const args = { value: "a.ts" };
		const context = renderContext({}, args, { executionStarted: false, expanded, toolCallId });
		const component = tool.renderCall?.(args, theme, context);
		if (!component) throw new Error("missing historical replay component");
		tool.renderResult?.(
			{ content: [{ type: "text", text: "done" }], details: { source: "a.ts" } },
			{ expanded, isPartial: false },
			theme,
			{ ...context, lastComponent: component },
		);
	}

	expect(runningSummaries).toBe(0);
	// The collapsed replay is represented by the already-built Group projection.
	// Its per-row terminal summary is materialized only when the user expands it.
	expect(terminalSummaries).toBe(1);
});

test("renderer binding does not aggregate Tools before the Session event", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn();
	const first = settle(read, "event-owned-read-1", "a.ts");
	settle(read, "event-owned-read-2", "b.ts");

	expect(runtime.listGroups().map((group) => group.memberIds)).toEqual([
		["event-owned-read-2"],
		["event-owned-read-1"],
	]);
	runtime.indexMessage(
		assistant(call("event-owned-read-1", "read", "a.ts"), call("event-owned-read-2", "read", "b.ts")),
	);
	runtime.indexMessage(result("event-owned-read-1", "MODEL_VISIBLE"));
	runtime.indexMessage(result("event-owned-read-2", "MODEL_VISIBLE"));
	runtime.endTurn();
	expect(runtime.resolveGroup("event-owned-read-1")).toMatchObject({
		memberIds: ["event-owned-read-1", "event-owned-read-2"],
		state: "success",
	});
	expect(renderLines(first.callComponent).join("\n")).toContain("Read 2 files");
});

test("a Code Mode envelope renders the same compact Tool Activity as a direct Tool call", () => {
	const directHarness = apiHarness();
	const directRead = toolFromHarness(directHarness, "read", "read-file");
	const directRuntime = getToolUiRuntime(directHarness.api);
	directRuntime.indexMessages([assistant(call("r1", "read", "a.ts")), result("r1")], true);
	const direct = settle(directRead, "r1", "a.ts").callLines;

	const envelopeHarness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(envelopeHarness.api);
	const nestedRead = toolFromHarness({ api: registrations.api, tools: envelopeHarness.tools }, "read", "read-file");
	const operation: SuiteToolEnvelopeOperation = {
		args: { value: "a.ts" },
		id: "exec-1:read-1",
		name: "read",
		result: {
			content: [{ type: "text", text: "MODEL_VISIBLE" }],
			details: { source: "a.ts" },
		},
		state: "success",
	};
	registerSuiteToolEnvelope(
		registrations.api,
		{
			description: "Execute Suite Tools through Code Mode",
			execute: async () => ({
				content: [{ type: "text", text: "MODEL_VISIBLE" }],
				details: { operations: [operation] },
			}),
			label: "Code Mode",
			name: "codemode",
			parameters: Type.Object({ code: Type.String() }),
		},
		{
			decode: () => [operation],
			registry: registrations.registry,
		},
	);
	const envelope = envelopeHarness.tools.get("codemode");
	if (!envelope) throw new Error("missing Code Mode envelope");
	const envelopeRuntime = getToolUiRuntime(envelopeHarness.api);
	envelopeRuntime.indexMessages(
		[
			assistant({ type: "toolCall", id: "exec-1", name: "codemode", arguments: { code: "read" } }),
			{
				role: "toolResult",
				toolCallId: "exec-1",
				content: [{ type: "text", text: "MODEL_VISIBLE" }],
				details: { operations: [operation] },
			},
		],
		true,
	);
	const state = {};
	const context = renderContext(state, { value: "unused" }, { toolCallId: "exec-1" });
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	const callComponent = envelope.renderCall?.({ code: "read" }, theme, context as never);
	if (!callComponent) throw new Error("missing Code Mode call component");
	const resultComponent = envelope.renderResult?.(
		{
			content: [{ type: "text", text: "MODEL_VISIBLE" }],
			details: { operations: [operation] },
		},
		{ expanded: false, isPartial: false },
		theme,
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		{ ...context, lastComponent: callComponent } as never,
	);
	if (!resultComponent) throw new Error("missing Code Mode result component");

	expect(resultComponent.render(120)).toEqual(direct);
	expect(nestedRead.name).toBe("read");
});

test("Code Mode and direct Tools stay pixel-equivalent when expanded, failed, and reconstructed", () => {
	for (const scenario of [
		{ expanded: true, isError: false, label: "expanded success", resultText: "MODEL_VISIBLE", state: "success" },
		{ expanded: false, isError: true, label: "compact failure", resultText: "FAILED", state: "error" },
		{ expanded: true, isError: true, label: "expanded failure", resultText: "FAILED", state: "error" },
		{
			expanded: false,
			isError: true,
			label: "compact cancellation",
			resultText: "Operation aborted",
			state: "cancelled",
		},
		{
			expanded: false,
			isError: true,
			label: "compact rejection",
			resultText: "Tool execution was blocked: fixture",
			state: "rejected",
		},
	] as const) {
		const directHarness = apiHarness();
		const directRead = toolFromHarness(directHarness, "read", "read-file");
		const directRuntime = getToolUiRuntime(directHarness.api);
		directRuntime.indexMessages(
			[assistant(call("direct-read", "read", "a.ts")), result("direct-read", scenario.resultText, scenario.isError)],
			true,
		);
		const direct = settle(
			directRead,
			"direct-read",
			"a.ts",
			scenario.isError,
			scenario.expanded,
			scenario.resultText,
		);
		const directLines = [...direct.callLines, ...direct.resultLines];

		const envelopeHarness = apiHarness();
		const registrations = createSuiteToolRegistrationTracker(envelopeHarness.api);
		toolFromHarness({ ...envelopeHarness, api: registrations.api }, "read", "read-file");
		const operation: SuiteToolEnvelopeOperation = {
			args: { value: "a.ts" },
			id: "nested-read",
			name: "read",
			result: {
				content: [{ type: "text", text: scenario.resultText }],
				details: { source: "a.ts" },
			},
			state: scenario.state,
		};
		registerSuiteToolEnvelope(
			registrations.api,
			{
				description: "Code Mode",
				execute: async () => ({ content: [], details: { operations: [operation] } }),
				label: "Code Mode",
				name: "codemode",
				parameters: Type.Object({ code: Type.String() }),
			},
			{
				decode: () => [operation],
				registry: registrations.registry,
			},
		);
		const envelope = envelopeHarness.tools.get("codemode");
		if (!envelope) throw new Error("missing Code Mode envelope");
		getToolUiRuntime(envelopeHarness.api).indexMessages(
			[
				assistant({ type: "toolCall", id: "outer", name: "codemode", arguments: { code: "read" } }),
				Object.assign(
					{
						role: "toolResult",
						toolCallId: "outer",
						content: [],
						details: { operations: [operation] },
					},
					scenario.isError ? { isError: true } : undefined,
				),
			],
			true,
		);
		const state = {};
		const context = renderContext(
			state,
			{ value: "unused" },
			{
				executionStarted: false,
				expanded: scenario.expanded,
				isError: scenario.isError,
				toolCallId: "outer",
			},
		);
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const callComponent = envelope.renderCall?.({ code: "read" }, theme, context as never);
		const rendered = envelope.renderResult?.(
			{ content: [], details: { operations: [operation] } },
			{ expanded: scenario.expanded, isPartial: false },
			theme,
			// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
			{ ...context, lastComponent: callComponent } as never,
		);
		if (!rendered) throw new Error(`missing ${scenario.label} envelope result`);
		expect(rendered.render(120), scenario.label).toEqual(directLines);
	}
});

test("Code Mode preserves the original Tool media projection without envelope chrome", () => {
	const image = {
		data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
		mimeType: "image/png",
		type: "image" as const,
	};
	const directHarness = apiHarness();
	const directView = toolFromHarness(directHarness, "view_image", "view-image");
	getToolUiRuntime(directHarness.api).indexMessages(
		[assistant(call("direct-media", "view_image", "pixel.png"))],
		true,
	);
	const directState = {};
	const directContext = renderContext(
		directState,
		{ value: "pixel.png" },
		{
			showImages: false,
			toolCallId: "direct-media",
		},
	);
	const directCall = directView.renderCall?.({ value: "pixel.png" }, theme, directContext);
	const directBody = directView.renderResult?.(
		{ content: [image], details: { source: "pixel.png" } },
		{ expanded: false, isPartial: false },
		theme,
		{ ...directContext, lastComponent: directCall },
	);
	if (!directCall || !directBody) throw new Error("missing direct media renderer");
	const direct = [...directCall.render(80), ...directBody.render(80)];
	expect(direct.join("\n")).toContain("Image preview hidden · PNG · 1×1");

	const envelopeHarness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(envelopeHarness.api);
	toolFromHarness({ ...envelopeHarness, api: registrations.api }, "view_image", "view-image");
	const operation: SuiteToolEnvelopeOperation = {
		args: { value: "pixel.png" },
		id: "nested-media",
		mediaPlacements: [{ afterContentIndex: 0, mediaIndex: 0 }],
		name: "view_image",
		result: { content: [], details: { source: "pixel.png" } },
		state: "success",
	};
	registerSuiteToolEnvelope(
		registrations.api,
		{
			description: "Code Mode",
			execute: async () => ({ content: [image], details: { operations: [operation] } }),
			label: "Code Mode",
			name: "codemode",
			parameters: Type.Object({ code: Type.String() }),
		},
		{ decode: () => [operation], registry: registrations.registry },
	);
	const envelope = envelopeHarness.tools.get("codemode");
	if (!envelope) throw new Error("missing media envelope");
	expect(getToolUiRuntime(registrations.api).isStandaloneInvocation("view_image", { value: "pixel.png" })).toBe(true);
	getToolUiRuntime(envelopeHarness.api).indexMessages(
		[
			assistant({ type: "toolCall", id: "outer-media", name: "codemode", arguments: { code: "view" } }),
			{
				role: "toolResult",
				toolCallId: "outer-media",
				content: [image],
				details: { operations: [operation] },
			},
		],
		true,
	);
	const envelopeContext = renderContext(
		{},
		{ value: "unused" },
		{
			showImages: false,
			toolCallId: "outer-media",
		},
	);
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	const envelopeCall = envelope.renderCall?.({ code: "view" }, theme, envelopeContext as never);
	const envelopeBody = envelope.renderResult?.(
		{ content: [image], details: { operations: [operation] } },
		{ expanded: false, isPartial: false },
		theme,
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		{ ...envelopeContext, lastComponent: envelopeCall } as never,
	);
	if (!envelopeBody) throw new Error("missing envelope media renderer");
	expect(envelopeBody.render(80)).toEqual(direct);
});

test("Code Mode keeps multiple Kitty images inside their original expanded Tool rows", () => {
	const firstImage = {
		data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
		mimeType: "image/png",
		type: "image" as const,
	};
	const secondImage = { ...firstImage, data: `${firstImage.data.slice(0, -2)}I=` };
	setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
	try {
		const harness = apiHarness();
		const registrations = createSuiteToolRegistrationTracker(harness.api);
		toolFromHarness({ ...harness, api: registrations.api }, "view_image", "view-image");
		const operations: readonly SuiteToolEnvelopeOperation[] = [
			{
				args: { value: "first.png" },
				id: "nested-first",
				mediaPlacements: [{ afterContentIndex: 0, mediaIndex: 0 }],
				name: "view_image",
				result: { content: [], details: { source: "first.png" } },
				state: "success",
			},
			{
				args: { value: "second.png" },
				id: "nested-second",
				mediaPlacements: [{ afterContentIndex: 0, mediaIndex: 1 }],
				name: "view_image",
				result: { content: [], details: { source: "second.png" } },
				state: "success",
			},
		];
		registerSuiteToolEnvelope(
			registrations.api,
			{
				description: "Code Mode",
				execute: async () => ({ content: [], details: { operations } }),
				label: "Code Mode",
				name: "codemode",
				parameters: Type.Object({ code: Type.String() }),
			},
			{ decode: () => operations, media: () => [[firstImage], [secondImage]], registry: registrations.registry },
		);
		const envelope = harness.tools.get("codemode");
		if (!envelope) throw new Error("missing Kitty media envelope");
		getToolUiRuntime(harness.api).indexMessages(
			[
				assistant({ type: "toolCall", id: "outer-kitty", name: "codemode", arguments: { code: "view" } }),
				{
					role: "toolResult",
					toolCallId: "outer-kitty",
					content: [],
					details: { operations },
				},
			],
			true,
		);
		const context = renderContext(
			{},
			{ value: "unused" },
			{ expanded: true, showImages: true, toolCallId: "outer-kitty" },
		);
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const callComponent = envelope.renderCall?.({ code: "view" }, theme, context as never);
		const body = envelope.renderResult?.(
			{ content: [], details: { operations } },
			{ expanded: true, isPartial: false },
			theme,
			// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
			{ ...context, lastComponent: callComponent } as never,
		);
		if (!body) throw new Error("missing Kitty media body");
		const lines = body.render(100);
		const firstRow = lines.findIndex((line) => line.includes("first.png"));
		const secondRow = lines.findIndex((line) => line.includes("second.png"));
		const imageRows = lines.flatMap((line, index) => (line.includes("\u001b_G") ? [index] : []));
		expect(firstRow).toBeGreaterThanOrEqual(0);
		expect(secondRow).toBeGreaterThan(firstRow);
		expect(imageRows).toHaveLength(2);
		expect(firstRow).toBeLessThan(imageRows[0] ?? -1);
		expect(imageRows[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(secondRow);
		expect(secondRow).toBeLessThan(imageRows[1] ?? -1);
	} finally {
		resetCapabilitiesCache();
	}
});

test("Pi 0.84.2 Host renders expanded multi-image Tools identically through Code Mode", () => {
	const image = {
		data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
		mimeType: "image/png",
		type: "image" as const,
	};
	const normalizeImageIds = (lines: readonly string[]): string[] =>
		lines.map((line) => line.replaceAll(/([,;]i=)\d+/gu, "$1<image-id>"));
	const hostUi = { requestRender: () => {} };
	initTheme("dark");
	setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
	try {
		const directHarness = apiHarness();
		const directView = toolFromHarness(directHarness, "view_image", "view-image");
		getToolUiRuntime(directHarness.api).indexMessages(
			[
				assistant(
					call("direct-first", "view_image", "first.png"),
					call("direct-second", "view_image", "second.png"),
				),
				result("direct-first"),
				result("direct-second"),
			],
			true,
		);
		const directComponents = [
			new ToolExecutionComponent(
				"view_image",
				"direct-first",
				{ value: "first.png" },
				{ showImages: true },
				directView,
				// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
				hostUi as never,
				"/project",
			),
			new ToolExecutionComponent(
				"view_image",
				"direct-second",
				{ value: "second.png" },
				{ showImages: true },
				directView,
				// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
				hostUi as never,
				"/project",
			),
		];
		for (const [index, component] of directComponents.entries()) {
			component.setExpanded(true);
			component.setArgsComplete();
			component.markExecutionStarted();
			component.updateResult({
				content: [image],
				details: { source: index === 0 ? "first.png" : "second.png" },
				isError: false,
			});
		}

		const envelopeHarness = apiHarness();
		const registrations = createSuiteToolRegistrationTracker(envelopeHarness.api);
		toolFromHarness({ ...envelopeHarness, api: registrations.api }, "view_image", "view-image");
		const operations: readonly SuiteToolEnvelopeOperation[] = [
			{
				args: { value: "first.png" },
				id: "nested-first",
				mediaPlacements: [{ afterContentIndex: 0, mediaIndex: 0 }],
				name: "view_image",
				result: { content: [], details: { source: "first.png" } },
				state: "success",
			},
			{
				args: { value: "second.png" },
				id: "nested-second",
				mediaPlacements: [{ afterContentIndex: 0, mediaIndex: 1 }],
				name: "view_image",
				result: { content: [], details: { source: "second.png" } },
				state: "success",
			},
		];
		const details = {
			kind: "pi-stuff-code-mode",
			mediaContentIndexes: [[0], [1]],
			modelContent: [image, image],
			operations,
			status: "success",
		};
		registerSuiteToolEnvelope(
			registrations.api,
			{
				description: "Code Mode",
				execute: async () => ({ content: [], details }),
				label: "Code Mode",
				name: "codemode",
				parameters: Type.Object({ code: Type.String() }),
			},
			{
				decode: () => operations,
				media: () => [[image], [image]],
				registry: registrations.registry,
			},
		);
		getToolUiRuntime(envelopeHarness.api).indexMessages(
			[
				assistant({ type: "toolCall", id: "outer", name: "codemode", arguments: { code: "view" } }),
				{ content: [], details, role: "toolResult", toolCallId: "outer" },
			],
			true,
		);
		const envelope = envelopeHarness.tools.get("codemode");
		if (!envelope) throw new Error("missing Code Mode envelope");
		const codeComponent = new ToolExecutionComponent(
			"codemode",
			"outer",
			{ code: "view" },
			{ showImages: true },
			envelope,
			// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
			hostUi as never,
			"/project",
		);
		codeComponent.setExpanded(true);
		codeComponent.setArgsComplete();
		codeComponent.markExecutionStarted();
		codeComponent.updateResult({ content: [], details, isError: false });

		const directLines = directComponents.flatMap((component) => component.render(100));
		expect(normalizeImageIds(codeComponent.render(100))).toEqual(normalizeImageIds(directLines));
	} finally {
		resetCapabilitiesCache();
	}
});

test("a completed nested Tool settles in place while the outer Code Mode result is still partial", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	toolFromHarness({ ...harness, api: registrations.api }, "read", "read-file");
	let operations: readonly SuiteToolEnvelopeOperation[] = [
		{ args: { value: "live.ts" }, id: "nested-live", name: "read", state: "running" },
	];
	registerSuiteToolEnvelope(
		registrations.api,
		{
			description: "Code Mode",
			execute: async () => ({ content: [], details: { operations } }),
			label: "Code Mode",
			name: "codemode",
			parameters: Type.Object({ code: Type.String() }),
		},
		{ decode: () => operations, registry: registrations.registry },
	);
	const envelope = harness.tools.get("codemode");
	if (!envelope) throw new Error("missing Code Mode envelope");
	const runtime = getToolUiRuntime(harness.api);
	const state = {};
	const context = renderContext(state, { value: "unused" }, { toolCallId: "outer-live" });
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	const callComponent = envelope.renderCall?.({ code: "read" }, theme, context as never);
	runtime.observeEnvelopeResult("codemode", "outer-live", { operations });
	const running = envelope.renderResult?.(
		{ content: [], details: { operations } },
		{ expanded: false, isPartial: true },
		theme,
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		{ ...context, lastComponent: callComponent } as never,
	);
	if (!running) throw new Error("missing running envelope result");
	expect(running.render(120).join("\n")).toContain("Reading 1 file");

	operations = [
		{
			args: { value: "live.ts" },
			id: "nested-live",
			name: "read",
			result: { content: [{ type: "text", text: "MODEL_VISIBLE" }], details: { source: "live.ts" } },
			state: "success",
		},
	];
	runtime.observeEnvelopeResult("codemode", "outer-live", { operations });
	const settled = envelope.renderResult?.(
		{ content: [], details: { operations } },
		{ expanded: false, isPartial: true },
		theme,
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		{ ...context, lastComponent: running } as never,
	);
	if (!settled) throw new Error("missing settled envelope result");
	expect(settled.render(120).join("\n")).toContain("Read 1 file");
	expect(settled.render(120).join("\n")).not.toContain("Reading 1 file");
});

test("envelope terminal operations without results keep their explicit outcome", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	const operations: readonly SuiteToolEnvelopeOperation[] = [
		{ args: { value: "done.ts" }, id: "nested-success", name: "read", state: "success" },
		{ args: { value: "blocked.ts" }, id: "nested-rejected", name: "read", state: "rejected" },
	];
	runtime.registerEnvelope("codemode", () => operations);
	runtime.observeEnvelopeResult("codemode", "outer", { operations });

	expect(runtime.resolveGroup("nested-success")).toMatchObject({ state: "success" });
	expect(runtime.resolveGroup("nested-rejected")).toMatchObject({ state: "warning" });
});

test("a settled envelope restores nested Tools to the outer call's source order", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "read", "read-file");
	toolFromHarness(harness, "bash", "run-command");
	toolFromHarness(harness, "background", "fetch-page");
	toolFromHarness(harness, "subagent", "fetch-page");
	const runtime = getToolUiRuntime(harness.api);
	const operations: readonly SuiteToolEnvelopeOperation[] = [
		{ args: { value: "a.ts" }, id: "nested-read", name: "read", state: "success" },
		{ args: { value: "printf ok" }, id: "nested-bash", name: "bash", state: "success" },
	];
	runtime.registerEnvelope("codemode", () => operations);
	runtime.startTurn();
	runtime.indexMessage(
		assistant(
			{ arguments: { code: "read then bash" }, id: "outer", name: "codemode", type: "toolCall" },
			call("direct-background", "background", "list"),
			call("direct-subagent", "subagent", "status"),
		),
	);
	runtime.observeEnvelopeResult("codemode", "outer", { operations });
	runtime.indexMessage({
		content: [],
		details: { operations },
		role: "toolResult",
		toolCallId: "outer",
		toolName: "codemode",
	});

	expect(runtime.listGroups().map((group) => group.memberIds)).toEqual([
		["direct-subagent"],
		["direct-background"],
		["nested-bash"],
		["nested-read"],
	]);
});

test("streaming, rebuild, and Code Mode share retrieval eligibility", () => {
	const configure = (runtime: ToolUiRuntime) => {
		runtime.registerActivity<Params, unknown>("read", {
			categories: ["read-file"],
			classify: ({ args }) => [{ category: "read-file", countKeys: [String(args["value"])] }],
		});
		runtime.registerActivity<Params, unknown>("edit", {
			categories: ["change-file"],
			classify: ({ args }) => [{ category: "change-file", countKeys: [String(args["value"])] }],
		});
		runtime.registerActivity("bash", {
			categories: ["run-command", "read-file", "search-pattern", "list-directory"],
			classify: classifyBashActivity,
		});
		for (const name of ["read", "edit", "bash"]) runtime.markRendererAttached(name);
	};
	const calls = [
		{ id: "read-before", name: "read", arguments: { value: "a.ts" } },
		{ id: "bash-read", name: "bash", arguments: { command: "cat a.ts", value: "cat a.ts" } },
		{ id: "edit", name: "edit", arguments: { value: "a.ts" } },
		{ id: "read-after", name: "read", arguments: { value: "b.ts" } },
	] as const;
	const persisted = [
		assistant(...calls.map((entry) => ({ ...entry, type: "toolCall" }))),
		...calls.map((entry) => result(entry.id)),
	];
	const rebuilt = new ToolUiRuntime();
	configure(rebuilt);
	rebuilt.indexMessages(persisted, true);

	const streaming = new ToolUiRuntime();
	configure(streaming);
	streaming.startTurn();
	for (const entry of calls) {
		streaming.observeAssistantEvent({
			contentIndex: 0,
			// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
			partial: assistant() as never,
			toolCall: { ...entry, type: "toolCall" },
			type: "toolcall_end",
		});
		streaming.indexMessage(result(entry.id));
	}
	streaming.endTurn();

	const operations: readonly SuiteToolEnvelopeOperation[] = calls.map((entry) => ({
		args: entry.arguments,
		id: entry.id,
		name: entry.name,
		result: { content: [{ type: "text", text: "ok" }], details: {} },
		state: "success",
	}));
	const codeMode = new ToolUiRuntime();
	configure(codeMode);
	codeMode.registerEnvelope("codemode", () => operations);
	codeMode.indexMessages(
		[
			assistant({ type: "toolCall", id: "outer", name: "codemode", arguments: { code: "inspect" } }),
			{ role: "toolResult", toolCallId: "outer", content: [], details: { operations } },
		],
		true,
	);

	const groupActivityNames = (runtime: ToolUiRuntime) =>
		runtime.listGroups().map((group) => runtime.groupActivities(group.id).map((activity) => activity.name));
	const expected = [["read"], ["edit"], ["read", "bash"]];
	expect(groupActivityNames(rebuilt)).toEqual(expected);
	expect(groupActivityNames(streaming)).toEqual(expected);
	expect(groupActivityNames(codeMode)).toEqual(expected);
});

test("the Code Mode surface hides every active Suite Tool without changing the virtual active Tool set", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	toolFromHarness({ ...harness, api: registrations.api }, "read", "read-file", {
		replay: "record",
	});
	toolFromHarness({ ...harness, api: registrations.api }, "bash", "run-command", {
		replay: "never",
	});
	toolFromHarness({ ...harness, api: registrations.api }, "write", "change-file");
	harness.api.setActiveTools(["read", "outside", "bash", "write"]);
	registerSuiteToolEnvelope(
		registrations.api,
		{
			description: "Code Mode",
			execute: async () => ({ content: [], details: {} }),
			label: "Code Mode",
			name: "codemode",
			parameters: Type.Object({ code: Type.String() }),
		},
		{ decode: () => [], registry: registrations.registry },
	);
	registerSuiteToolEnvelopeCompanion(
		registrations.api,
		"codemode",
		{
			description: "Search Code Mode Tools",
			execute: async () => ({ content: [], details: {} }),
			label: "Tool Search",
			name: "tool_search",
			parameters: Type.Object({ query: Type.String() }),
		},
		{
			activity: {
				categories: ["search-tool"],
				classify: ({ args }) => [{ category: "search-tool", countKeys: [args.query], target: args.query }],
			},
		},
	);
	expect(harness.tools.get("tool_search")?.renderShell).toBe("self");
	expect(harness.tools.get("tool_search")?.renderCall).toBeTypeOf("function");
	expect(harness.tools.get("tool_search")?.renderResult).toBeTypeOf("function");
	const searchTool = harness.tools.get("tool_search");
	if (!searchTool) throw new Error("missing tool_search companion");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([
		assistant({ type: "toolCall", id: "search-1", name: "tool_search", arguments: { query: "read file" } }),
	]);
	const state = {};
	const args = { query: "read file" };
	const context = renderContext(state, { value: "" }, { toolCallId: "search-1" });
	const callComponent = searchTool.renderCall?.(args, theme, context);
	if (!callComponent) throw new Error("missing tool_search call component");
	const resultComponent = searchTool.renderResult?.(
		{
			content: [{ type: "text", text: '{"results":[{"path":"tools.read"}],"definitions":["LARGE"]}' }],
			details: {},
		},
		{ expanded: false, isPartial: false },
		theme,
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		{ ...context, lastComponent: callComponent } as never,
	);
	expect(renderLines(callComponent)).toEqual([]);
	expect(resultComponent ? renderLines(resultComponent) : []).toEqual([]);
	runtime.endTurn();
	const compact = renderLines(callComponent).join("\n");
	expect(compact).toBe("");
	expect(compact).not.toContain("definitions");
	expect(runtime.resolveGroup("search-1")).toMatchObject({ memberIds: ["search-1"] });

	registrations.surface.enableEnvelope("codemode");
	expect(harness.api.getActiveTools()).toEqual(["codemode", "tool_search", "outside"]);
	expect(registrations.api.getActiveTools()).toEqual(["read", "outside", "bash", "write"]);
	expect(registrations.registry.catalog().map(({ definition }) => definition.name)).toEqual(["read", "bash", "write"]);

	registrations.api.setActiveTools(["outside", "bash", "write"]);
	expect(harness.api.getActiveTools()).toEqual(["outside", "codemode", "tool_search"]);
	expect(registrations.api.getActiveTools()).toEqual(["outside", "bash", "write"]);
	toolFromHarness({ ...harness, api: registrations.api }, "late", "read-file");
	expect(harness.api.getActiveTools()).toEqual(["outside", "codemode", "tool_search"]);
	expect(registrations.api.getActiveTools()).toEqual(["outside", "bash", "write", "late"]);

	registrations.surface.disableEnvelope("codemode");
	expect(harness.api.getActiveTools()).toEqual(["outside", "bash", "write", "late"]);
});

test("a disabled-by-default Code Mode surface removes only its envelope Tool", () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	toolFromHarness({ ...harness, api: registrations.api }, "read", "read-file");
	harness.api.setActiveTools(["outside", "read"]);
	registerSuiteToolEnvelope(
		registrations.api,
		{
			description: "Code Mode",
			execute: async () => ({ content: [], details: {} }),
			label: "Code Mode",
			name: "codemode",
			parameters: Type.Object({ code: Type.String() }),
		},
		{ decode: () => [], registry: registrations.registry },
	);
	expect(harness.api.getActiveTools()).toEqual(["outside", "read", "codemode"]);

	registrations.surface.disableEnvelope("codemode");
	expect(harness.api.getActiveTools()).toEqual(["outside", "read"]);
	expect(registrations.api.getActiveTools()).toEqual(["outside", "read"]);
});

test("an active Suite Tool needs no per-Tool caller policy to run through Code Mode", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	toolFromHarness({ ...harness, api: registrations.api }, "write", "change-file");
	harness.api.setActiveTools(["write"]);

	expect(registrations.registry.catalog()).toMatchObject([{ definition: { name: "write" } }]);
	const result = await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { value: "file.ts" },
		name: "write",
		toolCallId: "nested-write",
	});
	expect(result.isError).toBe(false);
});

test("Code Mode compensation runs only an explicitly declared inverse operation", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	const compensated: unknown[] = [];
	toolFromHarness({ ...harness, api: registrations.api }, "reversible", "change-file", {
		compensate: (invocation) => {
			compensated.push(invocation);
		},
		replay: "never",
	});
	toolFromHarness({ ...harness, api: registrations.api }, "read", "read-file", {
		replay: "record",
	});
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	const context = { cwd: "/project" } as never;
	expect(
		await registrations.registry.compensate({
			context,
			executionId: "cm-1",
			input: { value: "before" },
			name: "reversible",
			result: { version: 2 },
			sequence: 3,
		}),
	).toBe(true);
	expect(
		await registrations.registry.compensate({
			context,
			executionId: "cm-1",
			input: { value: "read" },
			name: "read",
			result: "data",
			sequence: 2,
		}),
	).toBe(false);
	expect(compensated).toMatchObject([
		{ executionId: "cm-1", input: { value: "before" }, name: "reversible", result: { version: 2 }, sequence: 3 },
	]);
});

test("nested invocation preserves Pi preparation, lifecycle hooks, updates, and result hooks", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	const order: string[] = [];
	registrations.api.on("tool_execution_start", () => {
		order.push("start");
	});
	registrations.api.on("tool_call", (event) => {
		order.push("call");
		// SAFETY: this test controls the value and supplies every Params member exercised by this case.
		(event.input as Params).value += "-hook";
	});
	registrations.api.on("tool_execution_update", () => {
		order.push("update");
	});
	registrations.api.on("tool_result", (event) => {
		order.push("result");
		return {
			content: [{ type: "text", text: `${event.content[0]?.type === "text" ? event.content[0].text : ""}-hooked` }],
		};
	});
	registrations.api.on("tool_execution_end", () => {
		order.push("end");
	});
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "lifecycle fixture",
			execute: async (_id, args, _signal, onUpdate) => {
				order.push(`execute:${args.value}`);
				onUpdate?.({ content: [{ type: "text", text: "partial" }], details: {} });
				return { content: [{ type: "text", text: args.value }], details: {} };
			},
			label: "Lifecycle",
			name: "lifecycle",
			parameters: Params,
			// SAFETY: this test controls the value and supplies every Params member exercised by this case.
			prepareArguments: (input) => ({ ...(input as Params), value: (input as Params).value.trim() }),
		},
		presentation("run-command"),
	);
	const updates: string[] = [];
	const invocation = await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { value: "  value  " },
		name: "lifecycle",
		onUpdate: (update) => {
			const first = update.content[0];
			if (first?.type === "text") updates.push(first.text);
		},
		toolCallId: "nested-1",
	});

	expect(invocation.isError).toBe(false);
	expect(invocation.result.content).toEqual([{ type: "text", text: "value-hook-hooked" }]);
	expect(updates).toEqual(["partial"]);
	expect(order).toEqual(["start", "call", "execute:value-hook", "update", "result", "end"]);
});

test("a Code Mode Bash call still reaches RTK's normal tool_call rewrite seam", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	let executed = "";
	registrations.api.on("tool_call", (event) => {
		if (event.toolName === "bash" && Check(BashParams, event.input)) event.input.command = "rtk git status";
	});
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "Bash fixture",
			execute: async (_id, args) => {
				executed = args.command;
				return { content: [{ type: "text", text: executed }], details: {} };
			},
			label: "Bash",
			name: "bash",
			parameters: BashParams,
		},
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		presentation("run-command") as never,
		{ replay: "never" },
	);
	harness.api.setActiveTools(["bash"]);
	await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { command: "git status" },
		name: "bash",
		toolCallId: "nested-bash-rtk",
	});
	expect(executed).toBe("rtk git status");
});

test("a failing nested tool_call hook still emits Pi's terminal lifecycle event", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	const lifecycle: string[] = [];
	registrations.api.on("tool_execution_start", () => {
		lifecycle.push("start");
	});
	registrations.api.on("tool_call", () => {
		lifecycle.push("call");
		throw new Error("hook failed");
	});
	registrations.api.on("tool_execution_end", (event) => {
		lifecycle.push(event.isError ? "end:error" : "end:success");
	});
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "never executes",
			execute: async () => {
				lifecycle.push("execute");
				return { content: [], details: {} };
			},
			label: "Hook failure",
			name: "hook_failure",
			parameters: Params,
		},
		presentation("run-command"),
	);

	const outcome = await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { value: "value" },
		name: "hook_failure",
		toolCallId: "nested-hook-failure",
	});

	expect(outcome.isError).toBe(true);
	expect(outcome.result.content).toEqual([{ type: "text", text: "hook failed" }]);
	expect(lifecycle).toEqual(["start", "call", "end:error"]);
});

test("a permission-style nested tool_call rejection blocks execution and preserves termination", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	let executions = 0;
	registrations.api.on("tool_call", () => ({ block: true, reason: "Approval denied", terminate: true }));
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "permission fixture",
			execute: async () => {
				executions += 1;
				return { content: [], details: {} };
			},
			label: "Permission",
			name: "permission_fixture",
			parameters: Params,
		},
		presentation("run-command"),
	);

	const outcome = await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { value: "value" },
		name: "permission_fixture",
		toolCallId: "nested-permission",
	});

	expect(executions).toBe(0);
	expect(outcome.isError).toBe(true);
	expect(outcome.result).toMatchObject({
		content: [{ text: "Approval denied", type: "text" }],
		terminate: true,
	});
});

test("nested invocation matches Pi cancellation and ignores updates after execution settles", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	const lifecycle: string[] = [];
	registrations.api.on("tool_execution_start", () => {
		lifecycle.push("start");
	});
	registrations.api.on("tool_call", () => {
		lifecycle.push("call");
	});
	registrations.api.on("tool_execution_update", () => {
		lifecycle.push("update");
	});
	registrations.api.on("tool_result", () => {
		lifecycle.push("result");
	});
	registrations.api.on("tool_execution_end", () => {
		lifecycle.push("end");
	});
	let executions = 0;
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "late update fixture",
			execute: async (_id, _args, _signal, onUpdate) => {
				executions += 1;
				setTimeout(() => onUpdate?.({ content: [{ type: "text", text: "late" }], details: {} }), 0);
				return { content: [{ type: "text", text: "done" }], details: {} };
			},
			label: "Late update",
			name: "late_update",
			parameters: Params,
		},
		presentation("run-command"),
	);

	const updates: string[] = [];
	const completed = await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { value: "value" },
		name: "late_update",
		onUpdate: () => updates.push("update"),
		toolCallId: "nested-late",
	});
	await Bun.sleep(0);
	expect(completed.isError).toBe(false);
	expect(updates).toEqual([]);
	expect(lifecycle).toEqual(["start", "call", "result", "end"]);

	lifecycle.splice(0);
	const controller = new AbortController();
	controller.abort();
	const cancelled = await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { value: "cancelled" },
		name: "late_update",
		signal: controller.signal,
		toolCallId: "nested-cancelled",
	});
	expect(cancelled.isError).toBe(true);
	expect(cancelled.result.content).toEqual([{ type: "text", text: "Operation aborted" }]);
	expect(executions).toBe(1);
	expect(lifecycle).toEqual(["start", "call", "end"]);
});

test("nested invocation records Tools activated by the original Pi Tool", async () => {
	const harness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(harness.api);
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "deferred fixture",
			execute: async () => ({ content: [], details: {} }),
			label: "Deferred",
			name: "deferred",
			parameters: Params,
		},
		presentation("read-file"),
	);
	registerSuiteOwnedTool(
		registrations.api,
		{
			description: "activator fixture",
			execute: async () => {
				registrations.api.setActiveTools([...registrations.api.getActiveTools(), "deferred"]);
				return { content: [{ type: "text", text: "activated" }], details: {} };
			},
			label: "Activator",
			name: "activator",
			parameters: Params,
		},
		presentation("run-command"),
	);
	registrations.api.setActiveTools(["activator"]);

	const invocation = await registrations.registry.invoke({
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		context: { cwd: "/project" } as never,
		input: { value: "value" },
		name: "activator",
		toolCallId: "nested-activator",
	});

	expect(invocation.result.addedToolNames).toEqual(["deferred"]);
});

test("live Activity Groups hold a target for 700 ms before advancing", async () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	const firstState = {};
	const firstContext = renderContext(firstState, { value: "first.ts" }, { toolCallId: "r1" });
	runtime.startTurn([assistant(call("r1", "read", "first.ts"))]);
	const first = read.renderCall?.({ value: "first.ts" }, theme, firstContext);
	if (!first) throw new Error("missing first component");
	runtime.indexMessage(result("r1"));
	runtime.indexMessage(assistant({ type: "thinking", thinking: "continue" }, call("r2", "read", "second.ts")));
	read.renderCall?.({ value: "second.ts" }, theme, renderContext({}, { value: "second.ts" }, { toolCallId: "r2" }));
	expect(renderLines(first).join("\n")).toContain("first.ts");
	await Bun.sleep(650);
	read.renderCall?.({ value: "first.ts" }, theme, firstContext);
	expect(renderLines(first).join("\n")).toContain("first.ts");
	await Bun.sleep(80);
	read.renderCall?.({ value: "first.ts" }, theme, firstContext);
	expect(renderLines(first).join("\n")).toContain("second.ts");
	runtime.clear();
});

test("settling an earlier group member preserves the latest source-order target", async () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([assistant(call("r1", "read", "first.ts"), call("r2", "read", "second.ts"))]);
	const firstState = {};
	const firstContext = renderContext(firstState, { value: "first.ts" }, { toolCallId: "r1" });
	const first = read.renderCall?.({ value: "first.ts" }, theme, firstContext);
	if (!first) throw new Error("missing first component");
	read.renderCall?.({ value: "second.ts" }, theme, renderContext({}, { value: "second.ts" }, { toolCallId: "r2" }));
	read.renderResult?.(
		{ content: [{ type: "text", text: "MODEL_VISIBLE" }], details: { source: "first.ts" } },
		{ expanded: false, isPartial: false },
		theme,
		{ ...firstContext, lastComponent: first },
	);
	expect(renderLines(first).join("\n")).toContain("second.ts");
	await Bun.sleep(720);
	read.renderCall?.({ value: "first.ts" }, theme, firstContext);
	expect(renderLines(first).join("\n")).toContain("second.ts");
	runtime.clear();
});

test("one retrieval group spans Tool round-trips and Thinking, then closes on prose", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const grep = toolFromHarness(harness, "grep", "search-pattern");
	const runtime = getToolUiRuntime(harness.api);
	const messages = [
		assistant({ type: "thinking", thinking: "inspect" }, call("r1", "read", "a.ts")),
		result("r1"),
		assistant({ type: "thinking", thinking: "search" }, call("g1", "grep", "needle")),
	];
	runtime.startTurn(messages);
	const first = settle(read, "r1", "a.ts");
	const second = settle(grep, "g1", "needle");
	expect(first.callLines.join("\n")).toContain("Searching 1 pattern, reading 1 file");
	expect(second.callLines).toEqual([]);

	runtime.indexMessage(assistant({ type: "text", text: "Done." }));
	expect(renderLines(first.callComponent).join("\n")).toContain("Searched 1 pattern, read 1 file");
});

test("multiple Bash calls render as separate operation blocks in native order", () => {
	const harness = apiHarness();
	const bash = toolFromHarness(harness, "bash", "run-command");
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	const messages = [
		assistant(call("r1", "read", "before.ts"), bashCall("b1", "printf 'one\\ntwo\\n'")),
		result("r1", "READ"),
		result("b1", "one\ntwo"),
		assistant(bashCall("b2", "printf 'three\\n' && printf 'four\\n'"), call("r2", "read", "after.ts")),
		result("b2", "three\nfour"),
		result("r2", "READ"),
	];
	runtime.indexMessages(messages, true);

	const before = settle(read, "r1", "before.ts");
	const first = settle(bash, "b1", "printf 'one\\ntwo\\n'", false, false, "one\ntwo");
	const second = settle(bash, "b2", "printf 'three\\n' && printf 'four\\n'", false, false, "three\nfour");
	const after = settle(read, "r2", "after.ts");

	expect(before.callLines.join("\n")).toContain("Read 1 file");
	expect(first.callLines).toEqual([" • Bash(printf 'one\\ntwo\\n')", "  ⎿  one", "     two"]);
	expect(second.callLines).toEqual([" • Bash(printf 'three\\n' && printf 'four\\n')", "  ⎿  three", "     four"]);
	expect(after.callLines.join("\n")).toContain("Read 1 file");
	expect([before, first, second, after].flatMap((entry) => entry.callLines).join("\n")).not.toContain("commands");
	expect(runtime.listGroups().map((group) => group.memberIds)).toEqual([["r2"], ["b2"], ["b1"], ["r1"]]);

	runtime.resetProjection(messages);
	expect(settle(bash, "b1", "printf 'one\\ntwo\\n'", false, false, "one\ntwo").callLines).toEqual(first.callLines);
});

test("Bash partial results update in place and the final output wins", () => {
	const harness = apiHarness();
	const bash = toolFromHarness(harness, "bash", "run-command");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages([assistant(bashCall("stream-bash", "printf 'first\\nsecond\\n'"))], false);
	runtime.observeToolExecutionStart("stream-bash");
	const context = renderContext(
		{},
		{ value: "printf 'first\\nsecond\\n'" },
		{
			toolCallId: "stream-bash",
		},
	);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const callComponent = bash.renderCall?.({ value: "printf 'first\\nsecond\\n'" }, theme, context as never);
	if (!callComponent) throw new Error("missing running Bash component");
	expect(renderLines(callComponent)).toEqual([" • Bash(printf 'first\\nsecond\\n')", "  ⎿  Running…"]);

	const partial = { content: [{ type: "text" as const, text: "first\nsecond" }], details: { source: "bash" } };
	runtime.observeToolExecutionUpdate("stream-bash", partial);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	bash.renderCall?.({ value: "printf 'first\\nsecond\\n'" }, theme, context as never);
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	bash.renderResult?.(partial, { expanded: false, isPartial: true }, theme, {
		...context,
		lastComponent: callComponent,
	} as never);
	expect(renderLines(callComponent)).toEqual([" • Bash(printf 'first\\nsecond\\n')", "  ⎿  first", "     second"]);

	const finalResult = {
		content: [{ type: "text" as const, text: "failed\n\nCommand exited with code 7" }],
		details: { source: "bash" },
		isError: true,
	};
	runtime.observeToolExecutionEnd("stream-bash", finalResult);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	bash.renderCall?.({ value: "printf 'first\\nsecond\\n'" }, theme, context as never);
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	bash.renderResult?.(finalResult, { expanded: false, isPartial: false }, theme, {
		...context,
		isError: true,
		lastComponent: callComponent,
	} as never);
	expect(renderLines(callComponent)).toEqual([
		" • Bash(printf 'first\\nsecond\\n')",
		"  ⎿  Error: Exit code 7",
		"     failed",
	]);
});

test("replaying Pi's Bash partial renderer pass settles after one invalidation", async () => {
	const harness = apiHarness();
	const bash = toolFromHarness(harness, "bash", "run-command");
	const runtime = getToolUiRuntime(harness.api);
	const toolCallId = "stable-partial";
	const args = { value: "sleep 2; printf done" };
	const state = {};
	const partial = { content: [{ type: "text" as const, text: "still working" }], details: { source: "bash" } };
	let invalidations = 0;
	let renderPass = (): void => {};
	const context = renderContext(state, args, {
		invalidate: () => {
			invalidations += 1;
			if (invalidations <= 10) renderPass();
		},
		toolCallId,
	});

	runtime.indexMessages([assistant(bashCall(toolCallId, args.value))], false);
	runtime.observeToolExecutionStart(toolCallId);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const component = bash.renderCall?.(args, theme, context as never);
	if (!component) throw new Error("missing running Bash component");
	renderPass = () => {
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		bash.renderCall?.(args, theme, context as never);
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		bash.renderResult?.(partial, { expanded: false, isPartial: true }, theme, {
			...context,
			lastComponent: component,
		} as never);
	};

	runtime.observeToolExecutionUpdate(toolCallId, partial);
	renderPass();
	for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();

	expect(invalidations).toBe(1);
	expect(renderLines(component)).toEqual([" • Bash(sleep 2; printf done)", "  ⎿  still working"]);
	runtime.suspend();
});

test("Ctrl+O expands Bash command and output inside the same operation block", () => {
	const harness = apiHarness();
	const bash = toolFromHarness(harness, "bash", "run-command");
	const runtime = getToolUiRuntime(harness.api);
	const command = "printf 'first\\nsecond\\nthird\\n'";
	runtime.indexMessages(
		[assistant(bashCall("expanded-bash", command)), result("expanded-bash", "1\n2\n3\n4\n5")],
		true,
	);
	const expanded = settle(bash, "expanded-bash", command, false, true, "1\n2\n3\n4\n5");

	expect(expanded.callLines).toEqual([
		" • Bash(printf 'first\\nsecond\\nthird\\n')",
		"  ⎿  1",
		"     2",
		"     3",
		"     4",
		"     5",
	]);
	expect(expanded.resultLines).toEqual([]);
	expect(expanded.callLines.join("\n")).not.toContain("Call\n");
	expect(expanded.callLines.join("\n")).not.toContain("Result\n");
});

test("Code Mode preserves standalone Bash operation blocks in compact and expanded views", () => {
	const directHarness = apiHarness();
	const directBash = toolFromHarness(directHarness, "bash", "run-command");
	getToolUiRuntime(directHarness.api).indexMessages(
		[assistant(bashCall("direct-bash", "printf 'ok\\n'")), result("direct-bash", "1\n2\n3\n4\n5")],
		true,
	);
	const directCompact = settle(directBash, "direct-bash", "printf 'ok\\n'", false, false, "1\n2\n3\n4\n5").callLines;
	const directExpanded = settle(directBash, "direct-bash", "printf 'ok\\n'", false, true, "1\n2\n3\n4\n5").callLines;

	const envelopeHarness = apiHarness();
	const registrations = createSuiteToolRegistrationTracker(envelopeHarness.api);
	toolFromHarness({ ...envelopeHarness, api: registrations.api }, "bash", "run-command");
	const operation: SuiteToolEnvelopeOperation = {
		args: { value: "printf 'ok\\n'" },
		id: "nested-bash",
		name: "bash",
		result: { content: [{ type: "text", text: "1\n2\n3\n4\n5" }], details: {} },
		state: "success",
	};
	registerSuiteToolEnvelope(
		registrations.api,
		{
			description: "Code Mode",
			execute: async () => ({ content: [], details: { operations: [operation] } }),
			label: "Code Mode",
			name: "codemode",
			parameters: Type.Object({ code: Type.String() }),
		},
		{ decode: () => [operation], registry: registrations.registry },
	);
	const envelope = envelopeHarness.tools.get("codemode");
	if (!envelope) throw new Error("missing Code Mode envelope");
	getToolUiRuntime(envelopeHarness.api).indexMessages(
		[
			assistant({ type: "toolCall", id: "outer", name: "codemode", arguments: { code: "bash" } }),
			{ role: "toolResult", toolCallId: "outer", content: [], details: { operations: [operation] } },
		],
		true,
	);
	for (const [expanded, expected] of [
		[false, directCompact],
		[true, directExpanded],
	] as const) {
		const context = renderContext({}, { value: "unused" }, { expanded, toolCallId: "outer" });
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		const callComponent = envelope.renderCall?.({ code: "bash" }, theme, context as never);
		const body = envelope.renderResult?.(
			{ content: [], details: { operations: [operation] } },
			{ expanded, isPartial: false },
			theme,
			// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
			{ ...context, lastComponent: callComponent } as never,
		);
		if (!body) throw new Error("missing Code Mode Bash body");
		expect(body.render(120)).toEqual(expected);
		expect(body.render(120).join("\n")).not.toContain("Call\n");
		expect(body.render(120).join("\n")).not.toContain("Result\n");
	}
});

test("non-retrieval image and web Tools stay independent boundaries", () => {
	const harness = apiHarness();
	const view = toolFromHarness(harness, "view", "view-image");
	const fetch = toolFromHarness(harness, "fetch", "fetch-page");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([
		assistant(
			call("v1", "view", "./images/sample.png"),
			call("v2", "view", "/project/images/sample.png"),
			call("f1", "fetch", "HTTPS://EXAMPLE.COM:443/a/../page#first"),
			call("f2", "fetch", "https://example.com/page#second"),
		),
	]);
	const first = settle(view, "v1", "./images/sample.png");
	settle(view, "v2", "/project/images/sample.png");
	settle(fetch, "f1", "HTTPS://EXAMPLE.COM:443/a/../page#first");
	settle(fetch, "f2", "https://example.com/page#second");
	runtime.endTurn();

	expect(renderLines(first.callComponent).join("\n")).toContain("view-image");
	expect(runtime.listGroups().map((group) => group.memberIds)).toEqual([["f2"], ["f1"], ["v2"], ["v1"]]);
});

test("projection rebuild rebinds grouped models to fresh Host row components", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const grep = toolFromHarness(harness, "grep", "search-pattern");
	const runtime = getToolUiRuntime(harness.api);
	const messages = [assistant(call("r1", "read", "a.ts"), call("g1", "grep", "needle")), result("r1"), result("g1")];
	runtime.indexMessages(messages, true);
	settle(read, "r1", "a.ts");
	settle(grep, "g1", "needle");

	runtime.resetProjection(messages);
	const rebuiltLeader = settle(read, "r1", "a.ts");
	const rebuiltFollower = settle(grep, "g1", "needle");
	expect(renderLines(rebuiltLeader.callComponent).join("\n")).toContain("Searched 1 pattern, read 1 file");
	expect(renderLines(rebuiltFollower.callComponent)).toEqual([]);
});

test("projection replacement isolates reused IDs from stale rows, callbacks, and timers", async () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	runtime.registerActivity("read", presentation("read-file").activity);
	runtime.registerActivity("edit", presentation("change-file").activity);
	runtime.markRendererAttached("read");
	runtime.markRendererAttached("edit");
	runtime.indexMessages([assistant(call("same", "read", "old.ts")), result("same")], true);
	const oldModel = {
		durationMs: undefined,
		label: "read",
		state: "success" as const,
		summary: "done",
		target: "old.ts",
	};
	const oldRow = new CachedToolRow(theme, oldModel);
	let oldInvalidations = 0;
	runtime.presentRow("same", oldRow, oldModel, true, () => oldInvalidations++, false, {
		args: { value: "old.ts" },
		name: "read",
	});
	runtime.startTimer("same", () => oldInvalidations++);
	runtime.setRowExpanded("same", true);
	runtime.suspend();

	const newModel = { ...oldModel, label: "edit", target: "new.ts" };
	const newRow = new CachedToolRow(theme, newModel);
	let newInvalidations = 0;
	runtime.presentRow("same", newRow, newModel, true, () => newInvalidations++, false, {
		args: { value: "new.ts" },
		name: "edit",
	});
	runtime.resetProjection([assistant(call("same", "edit", "new.ts")), result("same")]);
	await Promise.resolve();

	expect(oldInvalidations).toBe(0);
	expect(newInvalidations).toBe(1);
	expect(scheduler.activeCount).toBe(0);
	expect(renderLines(oldRow).join("\n")).not.toContain("Changed");
	expect(renderLines(newRow).join("\n")).toContain("edit new.ts · done");
});

test("a user input boundary prevents the next turn from reusing the previous group", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([assistant(call("r1", "read", "a.ts"))]);
	const first = settle(read, "r1", "a.ts");

	runtime.observeUserBoundary();
	runtime.startTurn();
	runtime.indexMessage(assistant(call("r2", "read", "b.ts")));
	const second = settle(read, "r2", "b.ts");
	expect(renderLines(first.callComponent).join("\n")).toContain("Read 1 file");
	expect(renderLines(second.callComponent).join("\n")).toContain("Reading 1 file");
	expect(runtime.resolveGroup("r1")).toMatchObject({ memberIds: ["r1"] });
	expect(runtime.resolveGroup("r2")).toMatchObject({ memberIds: ["r2"] });
});

test("turn end closes retrieval before an automatic continuation", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn([assistant(call("r1", "read", "a.ts"))]);
	const leader = settle(read, "r1", "a.ts");
	runtime.endTurn();

	runtime.startTurn();
	runtime.indexMessage(assistant(call("r2", "read", "b.ts")));
	settle(read, "r2", "b.ts");
	expect(runtime.resolveGroup("r1")).toMatchObject({ memberIds: ["r1"] });
	expect(runtime.resolveGroup("r2")).toMatchObject({ memberIds: ["r2"] });
	expect(renderLines(leader.callComponent).join("\n")).toContain("Read 1 file");
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

test("streaming Tool snapshots replace partial arguments and the final message wins", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	const partial = assistant(
		{ type: "toolCall", id: "r1", name: "read", arguments: { value: "" } },
		{ type: "toolCall", id: "r2", name: "read", arguments: { value: "" } },
	);
	const complete = assistant(call("r1", "read", "a.ts"), call("r2", "read", "b.ts"));
	runtime.startTurn();
	runtime.observeAssistantUpdate(partial);
	read.renderCall?.({ value: "a.ts" }, theme, renderContext({}, { value: "a.ts" }, { toolCallId: "r1" }));
	read.renderCall?.({ value: "b.ts" }, theme, renderContext({}, { value: "b.ts" }, { toolCallId: "r2" }));
	const renderedGroup = runtime.resolveGroup("r1");
	if (!renderedGroup || renderedGroup === "ambiguous") throw new Error("rendered streamed group missing");
	expect(renderedGroup.summary).toContain("Reading 2 files");
	runtime.observeAssistantUpdate(complete);
	runtime.indexMessage(complete);

	const group = runtime.resolveGroup("r1");
	if (!group || group === "ambiguous") throw new Error("streamed group missing");
	expect(group.summary).toContain("Reading 2 files");
	runtime.clear();
});

test("streaming Tool argument deltas do not rescan the accumulated argument", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "write", "change-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.startTurn();
	const pending = assistant();
	const started = performance.now();
	for (let index = 0; index < 800; index += 1) {
		runtime.observeAssistantEvent({
			type: "toolcall_delta",
			contentIndex: 0,
			delta: "x".repeat(10_000),
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
			partial: pending as never,
		});
	}
	runtime.observeAssistantEvent({
		type: "toolcall_end",
		contentIndex: 0,
		toolCall: { type: "toolCall", id: "large-write", name: "write", arguments: { value: "large.ts" } },
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		partial: pending as never,
	});

	expect(performance.now() - started).toBeLessThan(100);
	expect(runtime.resolveGroup("large-write")).toMatchObject({ memberIds: ["large-write"] });
});

test("an aborted final assistant message settles an unexecuted streamed Tool call", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	const pending = assistant(call("r1", "read", "a.ts"));
	const aborted = {
		role: "assistant",
		content: [call("r1", "read", "a.ts")],
		stopReason: "aborted",
	};

	runtime.startTurn();
	runtime.observeAssistantUpdate(pending);
	const component = read.renderCall?.(
		{ value: "a.ts" },
		theme,
		renderContext({}, { value: "a.ts" }, { toolCallId: "r1" }),
	);
	if (!component) throw new Error("missing streamed call component");
	expect(renderLines(component).join("\n")).toContain("Reading 1 file");

	runtime.observeAssistantUpdate(aborted);
	runtime.indexMessage(aborted);
	runtime.endTurn();
	const group = runtime.resolveGroup("r1");
	if (!group || group === "ambiguous") throw new Error("aborted group missing");
	expect(group.state).toBe("warning");
	expect(group.summary).toContain("cancelled");
	expect(group.summary).not.toContain("Reading");
	expect(renderLines(component).join("\n")).toContain("cancelled");
	runtime.clear();
});

test("unsupported Tool results never enter the owned pending-result cache or leak across projection resets", () => {
	const harness = apiHarness();
	toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessage(result("reused-id", "UNRELATED FAILURE", true));
	runtime.startTurn();
	runtime.indexMessage(assistant(call("reused-id", "read", "safe.ts")));
	const group = runtime.resolveGroup("reused-id");
	if (!group || group === "ambiguous") throw new Error("owned group missing after projection reset");
	expect(group.summary).toContain("Reading 1 file");
	expect(group.summary).not.toContain("failed");
});

test("Ctrl+O restores every member and bounded result detail", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const grep = toolFromHarness(harness, "grep", "search-pattern");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages(
		[assistant(call("r1", "read", "a.ts"), call("g1", "grep", "needle")), result("r1"), result("g1")],
		true,
	);

	const compactRead = settle(read, "r1", "a.ts");
	const compactGrep = settle(grep, "g1", "needle");
	expect(compactRead.callLines.join("\n")).toContain("Searched 1 pattern, read 1 file");
	expect(compactGrep.callLines).toEqual([]);

	const expandedRead = settle(read, "r1", "a.ts", false, true);
	const expandedGrep = settle(grep, "g1", "needle", false, true);
	expect(expandedRead.callLines.join("\n")).toContain("read-file");
	expect(expandedGrep.callLines.join("\n")).toContain("search-pattern");
	expect(expandedRead.resultLines.join("\n")).toContain("MODEL_VISIBLE");
	const formatted = [...expandedRead.resultLines, ...expandedGrep.resultLines].join("\n");
	expect(formatted).not.toContain("Call ID:");
	expect(formatted).not.toContain("Arguments");
	expect(formatted).not.toContain("Result content");
	expect(formatted).not.toContain("Details");
});

test("Ctrl+O restores retrieval Bash as an Operation Block in source order", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const bash = toolFromHarness(harness, "bash", "run-command");
	const runtime = getToolUiRuntime(harness.api);
	const command = "cat a.ts";
	runtime.indexMessages(
		[assistant(call("r1", "read", "a.ts"), bashCall("b1", command)), result("r1"), result("b1", "contents")],
		true,
	);

	const compactRead = settle(read, "r1", "a.ts");
	const compactBash = settle(bash, "b1", command, false, false, "contents");
	expect(compactRead.callLines.join("\n")).toContain("Read 2 files");
	expect(compactBash.callLines).toEqual([]);

	const expandedRead = settle(read, "r1", "a.ts", false, true);
	const expandedBash = settle(bash, "b1", command, false, true, "contents");
	expect(expandedRead.callLines.join("\n")).toContain("read-file");
	expect(expandedBash.callLines).toEqual([" • Bash(cat a.ts)", "  ⎿  contents"]);
});

test("native Read deduplicates paths while Search and List count invocations", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const grep = toolFromHarness(harness, "grep", "search-pattern");
	const list = toolFromHarness(harness, "ls", "list-directory");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages(
		[
			assistant(
				call("r1", "read", "./a.ts"),
				call("r2", "read", "/project/a.ts"),
				call("g1", "grep", "needle"),
				call("g2", "grep", "needle"),
				call("l1", "ls", "."),
				call("l2", "ls", "."),
			),
			...["r1", "r2", "g1", "g2", "l1", "l2"].map((id) => result(id)),
		],
		true,
	);
	const leader = settle(read, "r1", "./a.ts");
	settle(read, "r2", "/project/a.ts");
	settle(grep, "g1", "needle");
	settle(grep, "g2", "needle");
	settle(list, "l1", ".");
	settle(list, "l2", ".");
	expect(renderLines(leader.callComponent).join("\n")).toContain(
		"Searched 2 patterns, read 1 file, listed 2 directories",
	);
});

test("compact projection hides text bodies and explains unavailable image previews", () => {
	setCapabilities({ hyperlinks: false, images: null, trueColor: false });
	try {
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
		const wide = body?.render(80) ?? [];
		const narrow = body?.render(24) ?? [];
		expect(wide).toHaveLength(1);
		expect(wide[0]?.trimEnd()).toBe("   Image preview unavailable · PNG · 1×1");
		expect(wide.join("\n")).not.toContain("[Image:");
		expect(wide.join("\n")).not.toContain("hidden text");
		expect(narrow.length).toBeGreaterThan(1);
		expect(narrow.every((line) => line.startsWith("   "))).toBe(true);
	} finally {
		resetCapabilitiesCache();
	}
});

test("compact projection distinguishes user-hidden image previews", () => {
	setCapabilities({ hyperlinks: false, images: null, trueColor: false });
	try {
		const harness = apiHarness();
		const tool = toolFromHarness(harness, "view", "view-image");
		getToolUiRuntime(harness.api).indexMessages([assistant(call("v1", "view", "pixel.png"))], true);
		const state = {};
		const args = { value: "pixel.png" };
		const context = renderContext(state, args, { showImages: false, toolCallId: "v1" });
		const component = tool.renderCall?.(args, theme, context);
		if (!component) throw new Error("missing hidden media call component");
		const body = tool.renderResult?.(
			{
				content: [
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
		expect(body?.render(80)[0]?.trimEnd()).toBe("   Image preview hidden · PNG · 1×1");
	} finally {
		resetCapabilitiesCache();
	}
});

test("unavailable image fallbacks retain media order", () => {
	setCapabilities({ hyperlinks: false, images: null, trueColor: false });
	try {
		const harness = apiHarness();
		const tool = toolFromHarness(harness, "view", "view-image");
		getToolUiRuntime(harness.api).indexMessages([assistant(call("v1", "view", "media"))], true);
		const state = {};
		const args = { value: "media" };
		const context = renderContext(state, args, { toolCallId: "v1" });
		const component = tool.renderCall?.(args, theme, context);
		if (!component) throw new Error("missing multi-media call component");
		const body = tool.renderResult?.(
			{
				content: [
					{
						type: "image",
						data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
						mimeType: "image/png",
					},
					{
						type: "image",
						data: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
						mimeType: "image/gif",
					},
				],
				details: { source: "media" },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ ...context, lastComponent: component },
		);
		const visible = (body?.render(80) ?? []).map((line) => line.trimEnd()).filter(Boolean);
		expect(visible).toEqual(["   Image preview unavailable · PNG · 1×1", "   Image preview unavailable · GIF · 1×1"]);
	} finally {
		resetCapabilitiesCache();
	}
});

test("standalone Bash failures retain their own command and root cause", () => {
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
	const second = settle(command, "b2", "tests", true);
	const output = renderLines(first.callComponent).join("\n");
	expect(output).toContain("Bash(typecheck)");
	expect(output).toContain("FIRST FAILED");
	expect(second.callLines.join("\n")).toContain("Bash(tests)");
	expect(second.callLines.join("\n")).toContain("SECOND FAILED");
});

test("standalone Bash issue rows preserve chronological order across issue kinds", () => {
	const harness = apiHarness();
	const command = toolFromHarness(harness, "bash", "run-command");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages(
		[
			assistant(call("b1", "bash", "cancelled"), call("b2", "bash", "failed")),
			result("b1", "command was cancelled", true),
			result("b2", "LATER FAILED", true),
		],
		true,
	);
	const first = settle(command, "b1", "cancelled", true, false, "command was cancelled");
	const second = settle(command, "b2", "failed", true, false, "LATER FAILED");
	const output = renderLines(first.callComponent).join("\n");
	expect(output).toContain("Bash(cancelled)");
	expect(output).toContain("command was cancelled");
	expect(second.callLines.join("\n")).toContain("Bash(failed)");
	expect(second.callLines.join("\n")).toContain("LATER FAILED");
});

test("failed mutations never produce successful change clauses", () => {
	const harness = apiHarness();
	const mutation = toolFromHarness(harness, "edit", "change-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages([assistant(call("e1", "edit", "broken.ts")), result("e1", "EDIT FAILED", true)], true);
	const output = settle(mutation, "e1", "broken.ts", true).callLines.join("\n");
	expect(output).toContain("error");
	expect(output).not.toContain("Changed");
});

test("retrieval group outcomes keep failures visible after exact retries", () => {
	const project = (category: "read-file", firstValue: string, secondValue: string, secondError = false) => {
		const harness = apiHarness();
		const tool = toolFromHarness(harness, "read", category);
		const runtime = getToolUiRuntime(harness.api);
		const messages = [
			assistant(call("first", tool.name, firstValue), call("second", tool.name, secondValue)),
			result("first", "FIRST FAILED", true),
			result("second", secondError ? "SECOND FAILED" : "MODEL_VISIBLE", secondError),
		];
		runtime.indexMessages(messages, true);
		settle(tool, "first", firstValue, true, false, "FIRST FAILED");
		settle(tool, "second", secondValue, secondError, false, secondError ? "SECOND FAILED" : "MODEL_VISIBLE");
		return { messages, runtime, tool };
	};

	const retry = project("read-file", "same.ts", "same.ts");
	expect(retry.runtime.resolveGroup("first")).toMatchObject({
		state: "success",
		summary: expect.stringContaining("1 failed"),
	});
	retry.runtime.resetProjection(retry.messages);
	settle(retry.tool, "first", "bun test", true, false, "FIRST FAILED");
	settle(retry.tool, "second", "bun test");
	expect(retry.runtime.resolveGroup("first")).toMatchObject({
		state: "success",
		summary: expect.stringContaining("1 failed"),
	});

	const effect = project("read-file", "./a.ts", "/project/a.ts");
	expect(effect.runtime.resolveGroup("first")).toMatchObject({
		state: "success",
		summary: expect.stringContaining("1 failed"),
	});

	const unknown = project("read-file", "a.ts", "b.ts");
	expect(unknown.runtime.resolveGroup("first")).toMatchObject({
		state: "warning",
		summary: expect.stringContaining("1 failed"),
	});

	const failed = project("read-file", "a.ts", "b.ts", true);
	expect(failed.runtime.resolveGroup("first")).toMatchObject({
		state: "error",
		summary: expect.stringContaining("2 failed"),
	});
});

test("folded retrieval exposes failed, rejected, and cancelled calls plus the first reason", () => {
	const harness = apiHarness();
	const read = toolFromHarness(harness, "read", "read-file");
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages(
		[
			assistant(
				call("ok", "read", "ok.ts"),
				call("failed", "read", "failed.ts"),
				call("rejected", "read", "blocked.ts"),
				call("cancelled", "read", "cancelled.ts"),
			),
			result("ok"),
			result("failed", "FIRST REASON\nstack", true),
			result("rejected", "Tool execution was blocked by policy", true),
			result("cancelled", "Operation was cancelled", true),
		],
		true,
	);
	const leader = settle(read, "ok", "ok.ts");
	settle(read, "failed", "failed.ts", true, false, "FIRST REASON\nstack");
	settle(read, "rejected", "blocked.ts", true, false, "Tool execution was blocked by policy");
	settle(read, "cancelled", "cancelled.ts", true, false, "Operation was cancelled");
	const compact = renderLines(leader.callComponent).join("\n");
	expect(compact).toContain("1 failed, 1 rejected, 1 cancelled");
	expect(compact).toContain("FIRST REASON");
	expect(runtime.resolveGroup("ok")).toMatchObject({ state: "warning" });
});

test("successful infrastructure-only groups disappear but expand normally", () => {
	const harness = apiHarness();
	const original: ToolDefinition<typeof Params, { source: string }> = {
		description: "internal",
		execute: async () => ({
			content: [{ type: "text", text: "done" }],
			details: { source: "internal" },
		}),
		label: "ctx_reduce",
		name: "ctx_reduce",
		parameters: Params,
	};
	registerSuiteOwnedTool(harness.api, original, {
		activity: { categories: [], classify: () => [], silentSuccess: true },
		label: "ctx_reduce",
		summarize: () => "done",
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const tool = harness.tools.get("ctx_reduce") as ToolDefinition<typeof Params, { source: string }>;
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages([assistant(call("i1", "ctx_reduce", "context")), result("i1")], true);
	expect(settle(tool, "i1", "context").callLines).toEqual([]);
	expect(settle(tool, "i1", "context", false, true).callLines.join("\n")).toContain("ctx_reduce");
	const [details] = runtime.listGroups();
	expect(details?.summary).toBe("Internal activity");
	expect(details ? runtime.groupActivities(details.id) : []).toHaveLength(1);
});

test("failed infrastructure-only groups use the protocol fallback label", () => {
	const harness = apiHarness();
	const original: ToolDefinition<typeof Params, { source: string }> = {
		description: "internal",
		execute: async () => ({
			content: [{ type: "text", text: "done" }],
			details: { source: "internal" },
		}),
		label: "ctx_reduce",
		name: "ctx_reduce",
		parameters: Params,
	};
	registerSuiteOwnedTool(harness.api, original, {
		activity: { categories: [], classify: () => [], silentSuccess: true },
		label: "ctx_reduce",
		summarize: () => "failed",
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const tool = harness.tools.get("ctx_reduce") as ToolDefinition<typeof Params, { source: string }>;
	const runtime = getToolUiRuntime(harness.api);
	runtime.indexMessages(
		[assistant(call("i1", "ctx_reduce", "context")), result("i1", "reduction failed", true)],
		true,
	);
	const output = settle(tool, "i1", "context", true, false, "reduction failed").callLines.join("\n");
	expect(output).toContain("Internal operation failed");
	expect(output).not.toContain("ctx_reduce failed");
	expect(runtime.resolveGroup("i1")).toMatchObject({ state: "error", summary: "Internal operation failed" });
});

test("group details rebuild every member from the current branch beyond the live cache limit", () => {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity<Params, unknown>("read", {
		categories: ["read-file"],
		classify: ({ args }) => [{ category: "read-file", countKeys: [String(args["value"])] }],
	});
	runtime.markRendererAttached("read");
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

test("reload accepts the previous active-name-only handoff during a live code upgrade", () => {
	const key = Symbol.for("@jczhang02/pi-stuff-tools/reload-handoff.v1");
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const host = globalThis as { [name: symbol]: readonly string[] | undefined };
	host[key] = ["read", "bash"];
	const incoming = new ToolUiRuntime();
	expect(incoming.hasReloadSnapshot()).toBe(true);
	expect(incoming.consumeReloadActiveTools()).toEqual(["read", "bash"]);
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

test("the next running member keeps the folded group marker animated", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	runtime.registerActivity("read", presentation("read-file").activity);
	runtime.markRendererAttached("read");
	runtime.startTurn([assistant(call("r1", "read", "a.ts"), call("r2", "read", "b.ts"))]);
	const runningModel = {
		durationMs: undefined,
		label: "read",
		state: "running" as const,
		summary: "working",
		target: "a.ts",
	};
	const leader = new CachedToolRow(theme, runningModel);
	const follower = new CachedToolRow(theme, runningModel);
	runtime.presentRow("r1", leader, runningModel, true, () => {}, false, {
		args: { value: "a.ts" },
		cwd: "/project",
		name: "read",
	});
	runtime.presentRow("r2", follower, runningModel, true, () => {}, false, {
		args: { value: "b.ts" },
		cwd: "/project",
		name: "read",
	});
	runtime.startTimer(
		"r1",
		() => {},
		(visible) => leader.setMarkerVisible(visible),
	);
	runtime.startTimer(
		"r2",
		() => {},
		(visible) => follower.setMarkerVisible(visible),
	);
	const successModel = { ...runningModel, state: "success" as const, summary: "done" };
	runtime.presentRow("r1", leader, successModel, true, () => {}, false, {
		args: { value: "a.ts" },
		cwd: "/project",
		name: "read",
		result: { content: [{ type: "text", text: "done" }], details: {} },
	});
	runtime.stopTimer("r1");

	scheduler.tick();
	expect(leader.render(100)[0]).not.toStartWith("•");
	runtime.clear();
});

test("live timer state is bounded while the shared ticker keeps recent rows active", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	const invalidations = Array.from({ length: 769 }, () => 0);
	for (let index = 0; index < invalidations.length; index += 1) {
		runtime.startTimer(`call-${String(index)}`, () => {
			invalidations[index] = (invalidations[index] ?? 0) + 1;
		});
	}

	expect(scheduler.activeCount).toBe(1);
	scheduler.tick();
	expect(invalidations[0]).toBe(0);
	expect(invalidations.at(-1)).toBe(1);
	runtime.clear();
	expect(scheduler.activeCount).toBe(0);
});

test("active groups share one fallback pulse ticker", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	runtime.registerActivity("read", presentation("read-file").activity);
	runtime.markRendererAttached("read");
	runtime.startTurn([
		assistant(
			call("a1", "read", "a.ts"),
			call("a2", "read", "b.ts"),
			{ type: "text", text: "boundary" },
			call("b1", "read", "c.ts"),
			call("b2", "read", "d.ts"),
		),
	]);
	const model = {
		durationMs: undefined,
		label: "read",
		state: "running" as const,
		summary: "working",
		target: "a.ts",
	};
	for (const [id, value] of [
		["a1", "a.ts"],
		["b1", "c.ts"],
	] as const) {
		runtime.presentRow(id, new CachedToolRow(theme, model), model, true, () => {}, false, {
			args: { value },
			cwd: "/project",
			name: "read",
		});
	}

	expect(scheduler.activeCount).toBe(1);
	runtime.clear();
	expect(scheduler.activeCount).toBe(0);
});

test("runtime registry follows the Pi Host bus across per-extension event facades", () => {
	const bus = new EventBusHarness();
	const first = apiHarness(eventBusView(bus));
	const second = apiHarness(eventBusView(bus));
	const isolated = apiHarness(eventBusView(new EventBusHarness()));
	const settings = ToolUiSettingsStore.memory({
		liveElapsed: false,
		schemaVersion: 1,
	});
	expect(installToolUiRuntime(first.api, settings)).toBe(getToolUiRuntime(first.api));
	expect(getToolUiRuntime(first.api)).toBe(getToolUiRuntime(second.api));
	expect(getToolUiRuntime(first.api)).not.toBe(getToolUiRuntime(isolated.api));
	expect(getToolUiRuntime(first.api).showLiveElapsed()).toBe(false);
});
