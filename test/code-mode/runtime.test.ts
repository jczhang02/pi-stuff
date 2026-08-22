import { expect, test } from "bun:test";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildSuiteSandboxSource,
	SuiteCodeModeConnector,
	unwrapSuiteToolResult,
} from "../../packages/pi-stuff/src/code-mode/connector.js";
import {
	CODE_MODE_SEARCH_PRESENTATION,
	createCodeModeDefinition,
	createCodeModeSearchDefinition,
} from "../../packages/pi-stuff/src/code-mode/extension.js";
import { CodeModeHostLostError } from "../../packages/pi-stuff/src/code-mode/host/host-client.js";
import { CodeModeSessionLedger } from "../../packages/pi-stuff/src/code-mode/ledger.js";
import type { RuntimeResponse } from "../../packages/pi-stuff/src/code-mode/protocol.js";
import { type CodeModeExecutor, CodeModeRuntime } from "../../packages/pi-stuff/src/code-mode/runtime.js";
import type {
	SuiteToolCodeModeLifecycle,
	SuiteToolDefinitionRegistry,
	SuiteToolInvocation,
	SuiteToolInvocationResult,
} from "../../packages/pi-stuff/src/tool-display/contract.js";

function registryFixture(
	lifecycle?: SuiteToolCodeModeLifecycle,
): SuiteToolDefinitionRegistry & { readonly invocations: SuiteToolInvocation[] } {
	const invocations: SuiteToolInvocation[] = [];
	const definitions = new Map<string, ToolDefinition>([
		[
			"read",
			{
				description: "Read a file",
				execute: async () => ({ content: [], details: {} }),
				label: "Read",
				name: "read",
				parameters: Type.Object({ path: Type.String(), limit: Type.Optional(Type.Number()) }),
			},
		],
		[
			"hidden",
			{
				description: "Inactive fixture",
				execute: async () => ({ content: [], details: {} }),
				label: "Hidden",
				name: "hidden",
				parameters: Type.Object({}),
			},
		],
		[
			"write",
			{
				description: "Write a file",
				execute: async () => ({ content: [], details: {} }),
				label: "Write",
				name: "write",
				parameters: Type.Object({ path: Type.String(), content: Type.String() }),
			},
		],
	]);
	return {
		catalog: () =>
			[...definitions.values()].map((definition) =>
				definition.name === "read"
					? {
							codeMode: {
								replay: "record" as const,
							},
							definition,
						}
					: definition.name === "write"
						? {
								codeMode: Object.assign(
									{
										replay: "never" as const,
										requiresApproval: true,
									},
									lifecycle ? { lifecycle } : undefined,
								),
								definition,
							}
						: { definition },
			),
		compensate: async () => false,
		get: (name) => definitions.get(name),
		async invoke(invocation): Promise<SuiteToolInvocationResult> {
			invocations.push(invocation);
			const result: AgentToolResult<unknown> = {
				content: [{ type: "text", text: "first line" }],
				// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
				details: { path: (invocation.input as { path?: string }).path },
			};
			invocation.onUpdate?.({ content: [{ type: "text", text: "partial" }], details: {} });
			return { isError: false, result };
		},
		invocations,
		isActive: (name) => name === "read" || name === "write",
		list: () => [...definitions.values()],
	};
}

function sessionLedgerFixture() {
	const branch: Array<{ customType: string; data: unknown; type: "custom" }> = [];
	return {
		// SAFETY: this test fixture implements the exact Host surface exercised by this case.
		context: {
			cwd: "/project",
			sessionManager: {
				getBranch: () => branch,
				getEntries: () => branch,
				getSessionId: () => "runtime-recovery-session",
			},
		} as ExtensionContext,
		ledger: new CodeModeSessionLedger({
			appendEntry(customType, data) {
				branch.push({ customType, data, type: "custom" });
			},
		}),
	};
}

test("the compact Tool contract describes execution without advertising optional Tools", () => {
	// SAFETY: this test controls the value and supplies every CodeModeRuntime member exercised by this case.
	const definition = createCodeModeDefinition({} as CodeModeRuntime);
	expect(definition.description).toContain("top-level await");
	expect(definition.description).toContain("await every tools.* call");
	expect(definition.description).toContain("Do not guess Tool names");
	expect(definition.description).not.toContain("tools.read");
	expect(definition.description).not.toContain("tools.bash");
	expect(definition.description).toContain("console is unavailable");
	expect(definition.description).toContain("async arrow functions with return");
	expect(definition.description).not.toContain("codemode.resultText");
	expect(definition.description).not.toContain("codemode.emitText");
});

test("the Connector exposes every active Suite Tool without a per-Tool caller contract", async () => {
	const registry = registryFixture();
	const connector = new SuiteCodeModeConnector(registry);
	const tools = connector.tools();
	expect(tools.map((tool) => tool.name)).toEqual(["read", "write"]);
	expect(connector.search("inactive fixture").results).toEqual([]);
	expect(connector.describe("tools.hidden").types).toBe('"tools.hidden" not found.');
	expect(tools[0]?.inputSchema).toEqual(registry.get("read")?.parameters);

	let captured: AgentToolResult<unknown> | undefined;
	const value = await tools[0]?.invoke(
		{ path: "README.md", limit: 1 },
		{
			captureResult: (result) => {
				captured = result;
			},
			cwd: "/project",
			// SAFETY: this test fixture implements the exact Host surface exercised by this case.
			extensionContext: { cwd: "/project" } as ExtensionContext,
			onUpdate: () => {},
			toolCallId: "nested-read",
		},
		new AbortController().signal,
	);
	expect(value).toBe("first line");
	expect(captured?.content).toEqual([{ type: "text", text: "first line" }]);
	expect(registry.invocations[0]).toMatchObject({
		input: { path: "README.md", limit: 1 },
		name: "read",
		toolCallId: "nested-read",
	});
});

test("top-level and in-program discovery share Cloudflare-ranked catalog data and typed describe output", async () => {
	const connector = new SuiteCodeModeConnector(registryFixture());
	const search = connector.search("read file");
	expect(search.results[0]).toMatchObject({ connector: "tools", method: "read", path: "tools.read" });
	expect(connector.describe("tools.read").types).toContain("type ReadInput");

	const definition = createCodeModeSearchDefinition(connector);
	// SAFETY: this test fixture implements the exact Host surface exercised by this case.
	const result = await definition.execute("search-1", { query: "read file" }, undefined, undefined, {
		cwd: "/project",
	} as ExtensionContext);
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";
	expect(JSON.parse(text)).toMatchObject({
		definitions: [{ kind: "method", path: "tools.read" }],
		results: [{ path: "tools.read" }],
	});
	expect(result.details).toEqual({
		paths: ["tools.read"],
		query: "read file",
		total: 1,
		truncated: false,
	});
	expect(CODE_MODE_SEARCH_PRESENTATION.summarize?.({ query: "read file" }, result, "success", undefined)).toBe(
		"1 match",
	);
	expect(CODE_MODE_SEARCH_PRESENTATION.detailLines?.({ query: "read file" }, result, "success")).toEqual([
		"1 match",
		"tools.read",
	]);
});

test("approval-required Tools cannot opt into reexecute replay", () => {
	const base = registryFixture();
	const registry: SuiteToolDefinitionRegistry = {
		...base,
		catalog: () =>
			base
				.catalog()
				.map((entry) =>
					entry.definition.name === "write"
						? { ...entry, codeMode: { replay: "reexecute" as const, requiresApproval: true } }
						: entry,
				),
	};
	expect(() => new SuiteCodeModeConnector(registry).catalog()).toThrow(
		'Code Mode Tool "write" cannot combine requiresApproval with replay: reexecute',
	);
});

test("result adaptation unwraps structured/text JSON and reports an actionable failing path", () => {
	expect(
		unwrapSuiteToolResult("fixture", {
			content: [{ type: "text", text: '{"ok":true}' }],
			details: {},
		}),
	).toEqual({ ok: true });
	expect(
		// SAFETY: this test controls the value and supplies every AgentToolResult member exercised by this case.
		unwrapSuiteToolResult("fixture", {
			content: [],
			details: {},
			structuredContent: { value: 3 },
		} as AgentToolResult<unknown>),
	).toEqual({ value: 3 });
	expect(() =>
		unwrapSuiteToolResult("fixture", {
			content: [{ type: "text", text: 7 }],
			details: {},
		}),
	).toThrow(
		'Code Mode Tool "fixture" returned an invalid result at result.content[0].text: expected a string; received number; retry safe: false',
	);
});

test("the local prelude provides canonical tools plus compatible suite/search/describe without entering model history", () => {
	const source = buildSuiteSandboxSource("const value = await tools.read({ path: 'README.md' }); text(value)", [
		{
			description: "Read a file",
			inputSchema: Type.Object({ path: Type.String() }),
			name: "read",
			replay: "record",
		},
	]);
	expect(source).toContain("globalThis.suite=globalThis.tools");
	expect(source).toContain("globalThis.codemode=");
	expect(source).toContain("codemode.search");
	expect(source).toContain("const value = await tools.read({ path: 'README.md' });");
	expect(source).toContain("return (text(value))");
	expect(source).toContain("__piStuffOutputCount===0");
});

test("the local catalog emits executable paths for non-identifier Tool names", () => {
	const source = buildSuiteSandboxSource("text((await codemode.describe('tools[\"task-create\"]')).types)", [
		{
			description: "Create a task",
			inputSchema: Type.Object({ description: Type.String() }),
			name: "task-create",
			replay: "record",
		},
	]);
	expect(source).toContain('"path":"tools[\\"task-create\\"]"');
	expect(source).toContain("globalThis.tools.__pi_stuff_codemode_describe_v1");
	expect(source).toContain("text((await codemode.describe('tools[\"task-create\"]')).types)");
});

test("the Cloudflare compatibility adapter invokes async-arrow input and emits a return only without explicit output", () => {
	const returned = buildSuiteSandboxSource("async () => { return { ok: true }; }", []);
	expect(returned).toContain("const __piStuffProgram=(async () => { return { ok: true }; });");
	expect(returned).toContain("const __piStuffResult=await __piStuffProgram();");
	expect(returned).toContain("if(__piStuffOutputCount===0&&__piStuffResult!==undefined)");

	const explicit = buildSuiteSandboxSource("text('done')", []);
	expect(explicit).toContain("return (text('done'))");
	expect(explicit).not.toContain("codemode.emitText");
});

test("the prelude exposes durable steps and saved snippets without a second model-facing dialect", () => {
	const source = buildSuiteSandboxSource(
		"text(await codemode.run('read-one', { path: 'README.md' }))",
		[],
		[
			{
				code: "async (input) => input.path",
				description: "Return one path",
				name: "read-one",
				savedAt: 1,
			},
		],
	);
	expect(source).toContain("codemode.run=async");
	expect(source).toContain("codemode.step=async");
	expect(source).toContain('["read-one",(async (input) => input.path)]');
});

test("runtime loss replays a recorded nested result once instead of repeating the Tool", async () => {
	const { context, ledger } = sessionLedgerFixture();
	let effects = 0;
	let passes = 0;
	const lifecycle: string[] = [];
	const executor: CodeModeExecutor = {
		async execute(options) {
			const plan = options.context.beginToolCall?.("read", { path: "README.md" });
			if (!plan) throw new Error("missing recovery plan");
			if (!plan.replay) {
				effects += 1;
				options.context.completeToolCall?.(plan, { status: "success", value: "recorded" });
			}
			options.context.onTraceUpdate?.({
				cellId: `cell-${String(passes)}`,
				trace: {
					attempt: plan.attempt,
					executionId: plan.executionId,
					id: plan.id,
					input: { path: "README.md" },
					name: "read",
					replayed: plan.replay !== undefined,
					sequence: plan.sequence,
					status: "done",
				},
			});
			passes += 1;
			if (passes === 1) throw new CodeModeHostLostError("fixture host loss");
			return { cellId: "cell-recovered", contentItems: [{ type: "input_text", text: "done" }], kind: "result" };
		},
		async shutdown() {},
		async wait() {
			throw new Error("unexpected wait");
		},
	};
	const result = await new CodeModeRuntime(
		new SuiteCodeModeConnector(
			registryFixture({
				disposeExecution: (_executionId, status) => {
					lifecycle.push(`dispose:${status}`);
				},
				onPassEnd: (_executionId, status) => {
					lifecycle.push(`pass:${status}`);
				},
			}),
		),
		executor,
		ledger,
	).execute("outer-recovery", "text(await tools.read({ path: 'README.md' }))", context);
	expect(effects).toBe(1);
	expect(passes).toBe(2);
	expect(result.details).toMatchObject({ attempt: 1, status: "success" });
	expect(result.details.operations).toMatchObject([{ attempt: 1, replayed: true, sequence: 0 }]);
	expect(ledger.history(context)[0]).toMatchObject({ status: "success", toolCalls: 1 });
	expect(lifecycle).toEqual(["pass:error", "pass:completed", "dispose:completed"]);
});

test("runtime returns a durable pause and executes an approved Tool exactly once", async () => {
	const { context, ledger } = sessionLedgerFixture();
	let effects = 0;
	const lifecycle: string[] = [];
	const executor: CodeModeExecutor = {
		async execute(options) {
			const plan = options.context.beginToolCall?.("write", { path: "a.txt", content: "ok" });
			if (!plan) throw new Error("missing approval plan");
			if (plan.pause) {
				return { cellId: "cell-paused", contentItems: [], errorText: plan.pause.message, kind: "result" };
			}
			effects += 1;
			options.context.completeToolCall?.(plan, { status: "success", value: { written: true } });
			return { cellId: "cell-approved", contentItems: [{ type: "input_text", text: "written" }], kind: "result" };
		},
		async shutdown() {},
		async wait() {
			throw new Error("unexpected wait");
		},
	};
	const runtime = new CodeModeRuntime(
		new SuiteCodeModeConnector(
			registryFixture({
				disposeExecution: (_executionId, status) => {
					lifecycle.push(`dispose:${status}`);
				},
				onPassEnd: (_executionId, status) => {
					lifecycle.push(`pass:${status}`);
				},
			}),
		),
		executor,
		ledger,
	);
	const paused = await runtime.execute(
		"outer-approval",
		"text(await tools.write({ path: 'a.txt', content: 'ok' }))",
		context,
	);
	expect(effects).toBe(0);
	expect(paused.details).toMatchObject({
		pending: [{ args: { path: "a.txt", content: "ok" }, method: "write", seq: 0 }],
		status: "paused",
	});
	expect(lifecycle).toEqual(["pass:paused"]);
	const executionId = paused.details.executionId;
	if (!executionId) throw new Error("paused result is missing its execution ID");

	const completed = await runtime.approve(executionId, context);
	expect(effects).toBe(1);
	expect(completed.content).toEqual([{ type: "text", text: "written" }]);
	expect(completed.details.status).toBe("success");
	expect(lifecycle).toEqual(["pass:paused", "pass:completed", "dispose:completed"]);
	const stale = await runtime.approve(executionId, context);
	expect(effects).toBe(1);
	expect(stale.details.status).toBe("error");
});

test("runtime rejection terminates a pending approval without running its Tool", async () => {
	const { context, ledger } = sessionLedgerFixture();
	let effects = 0;
	const lifecycle: string[] = [];
	const executor: CodeModeExecutor = {
		async execute(options) {
			const plan = options.context.beginToolCall?.("write", { path: "a.txt", content: "no" });
			if (!plan) throw new Error("missing rejection plan");
			if (!plan.pause) effects += 1;
			const result: RuntimeResponse = {
				cellId: "cell-rejected",
				contentItems: [],
				kind: "result",
			};
			return plan.pause ? { ...result, errorText: plan.pause.message } : result;
		},
		async shutdown() {},
		async wait() {
			throw new Error("unexpected wait");
		},
	};
	const runtime = new CodeModeRuntime(
		new SuiteCodeModeConnector(
			registryFixture({
				disposeExecution: (_executionId, status) => {
					lifecycle.push(`dispose:${status}`);
				},
				onPassEnd: (_executionId, status) => {
					lifecycle.push(`pass:${status}`);
				},
			}),
		),
		executor,
		ledger,
	);
	const paused = await runtime.execute("outer-reject", "await tools.write({})", context);
	const executionId = paused.details.executionId;
	if (!executionId) throw new Error("paused result is missing its execution ID");
	expect(await runtime.reject(executionId, 0, context)).toBe(true);
	expect(await runtime.reject(executionId, 0, context)).toBe(false);
	expect(effects).toBe(0);
	expect(lifecycle).toEqual(["pass:paused", "dispose:rejected"]);
});

test("connector lifecycle failures never replace the Code Mode result", async () => {
	const { context, ledger } = sessionLedgerFixture();
	let lifecycleCalls = 0;
	const runtime = new CodeModeRuntime(
		new SuiteCodeModeConnector(
			registryFixture({
				disposeExecution: () => {
					lifecycleCalls += 1;
					throw new Error("dispose fixture");
				},
				onPassEnd: () => {
					lifecycleCalls += 1;
					throw new Error("pass fixture");
				},
			}),
		),
		{
			async execute() {
				return { cellId: "cell-lifecycle", contentItems: [{ type: "input_text", text: "kept" }], kind: "result" };
			},
			async shutdown() {},
			async wait() {
				throw new Error("unexpected wait");
			},
		},
		ledger,
	);

	const result = await runtime.execute("outer-lifecycle", "text('kept')", context);
	expect(result.content).toEqual([{ type: "text", text: "kept" }]);
	expect(result.details.status).toBe("success");
	expect(lifecycleCalls).toBe(2);
});

test("runtime auto-waits yielded V8 cells and persists the final nested trace", async () => {
	const calls: string[] = [];
	const executor: CodeModeExecutor = {
		async execute(options) {
			calls.push("execute");
			expect(options.source).toContain("globalThis.suite=globalThis.tools");
			expect(options.context.toolCallId).toBe("outer-1");
			return { cellId: "cell-1", contentItems: [], kind: "yielded", traces: [] };
		},
		async shutdown() {},
		async wait() {
			calls.push("wait");
			return {
				cellId: "cell-1",
				contentItems: [{ type: "input_text", text: "first line" }],
				kind: "result",
				traces: [
					{
						id: "nested-read",
						input: { path: "README.md" },
						name: "read",
						result: { content: [{ type: "text", text: "first line" }], details: {} },
						status: "done",
					},
				],
			};
		},
	};
	const runtime = new CodeModeRuntime(new SuiteCodeModeConnector(registryFixture()), executor);
	// SAFETY: this test fixture implements the exact Host surface exercised by this case.
	const result = await runtime.execute("outer-1", "text((await suite.read({ path: 'README.md' })).content[0].text)", {
		cwd: "/project",
	} as ExtensionContext);
	expect(calls).toEqual(["execute", "wait"]);
	expect(result.content).toEqual([{ type: "text", text: "first line" }]);
	expect(result.details).toMatchObject({
		kind: "pi-stuff-code-mode",
		operations: [{ id: "nested-read", name: "read", state: "success" }],
		status: "success",
	});
});

test("runtime preserves nested termination, deferred Tools, and Tool usage", async () => {
	const usage = {
		cacheRead: 3,
		cacheWrite: 5,
		cost: { cacheRead: 0.03, cacheWrite: 0.05, input: 0.02, output: 0.07, total: 0.17 },
		input: 2,
		output: 7,
		totalTokens: 17,
	};
	const executor: CodeModeExecutor = {
		async execute() {
			return {
				cellId: "cell-control",
				contentItems: [{ type: "input_text", text: "complete" }],
				kind: "result",
				traces: [
					{
						id: "nested-complete",
						input: {},
						name: "goal_complete",
						result: {
							addedToolNames: ["ctx_search"],
							content: [{ type: "text", text: "complete" }],
							details: {},
							terminate: true,
							usage,
						},
						status: "done",
					},
				],
			};
		},
		async shutdown() {},
		async wait() {
			throw new Error("unexpected wait");
		},
	};
	const result = await new CodeModeRuntime(new SuiteCodeModeConnector(registryFixture()), executor).execute(
		"outer-control",
		"text('complete')",
		// SAFETY: this test fixture implements the exact Host surface exercised by this case.
		{ cwd: "/project" } as ExtensionContext,
	);

	expect(result.terminate).toBe(true);
	expect(result.addedToolNames).toEqual(["ctx_search"]);
	expect(result.usage).toEqual(usage);
});

test("runtime hoists nested media while preserving each image's position inside its Tool result", async () => {
	const image = {
		data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
		mimeType: "image/png",
		type: "image" as const,
	};
	const executor: CodeModeExecutor = {
		async execute() {
			return {
				cellId: "cell-media",
				contentItems: [],
				kind: "result" as const,
				traces: [
					{
						id: "nested-media",
						input: { path: "pixel.png" },
						name: "view_image",
						result: {
							content: [
								{ type: "text", text: "before" },
								image,
								{ type: "text", text: "between" },
								image,
								{ type: "text", text: "after" },
							],
							details: { path: "pixel.png" },
						},
						status: "done" as const,
					},
				],
			};
		},
		async shutdown() {},
		async wait() {
			throw new Error("unexpected wait");
		},
	};
	const result = await new CodeModeRuntime(new SuiteCodeModeConnector(registryFixture()), executor).execute(
		"outer-media",
		"await suite.view_image({ path: 'pixel.png' })",
		// SAFETY: this test fixture implements the exact Host surface exercised by this case.
		{ cwd: "/project" } as ExtensionContext,
	);
	expect(result.content).toEqual([
		{ type: "text", text: "Code completed with no output; use text(...) to return a value" },
		image,
		image,
	]);
	expect(result.details.operations).toMatchObject([
		{
			mediaPlacements: [
				{ afterContentIndex: 1, mediaIndex: 0 },
				{ afterContentIndex: 2, mediaIndex: 1 },
			],
			result: {
				content: [
					{ type: "text", text: "before" },
					{ type: "text", text: "between" },
					{ type: "text", text: "after" },
				],
			},
			state: "success",
		},
	]);
});

test("runtime settles every still-running nested row when the outer execution is cancelled", async () => {
	const controller = new AbortController();
	const executor: CodeModeExecutor = {
		async execute(options) {
			options.context.onTraceUpdate?.({
				cellId: "cell-cancelled",
				trace: { id: "nested-bash", input: { command: "sleep 30" }, name: "bash", status: "running" },
			});
			controller.abort();
			throw Object.assign(new Error("Code Mode operation aborted"), { name: "AbortError" });
		},
		async shutdown() {},
		async wait() {
			throw new Error("unexpected wait");
		},
	};
	const result = await new CodeModeRuntime(new SuiteCodeModeConnector(registryFixture()), executor).execute(
		"outer-cancelled",
		"await suite.bash({ command: 'sleep 30' })",
		// SAFETY: this test fixture implements the exact Host surface exercised by this case.
		{ cwd: "/project" } as ExtensionContext,
		controller.signal,
	);
	expect(result.details).toMatchObject({
		operations: [
			{
				id: "nested-bash",
				result: { content: [{ text: "Operation aborted", type: "text" }] },
				state: "cancelled",
			},
		],
		status: "cancelled",
	});
});

test("runtime recognizes an executor AbortError even without an outer AbortSignal", async () => {
	const executor: CodeModeExecutor = {
		async execute(options) {
			options.context.onTraceUpdate?.({
				cellId: "cell-abort-error",
				trace: { id: "nested-bash", input: { command: "sleep 30" }, name: "bash", status: "running" },
			});
			throw Object.assign(new Error("The V8 operation was aborted"), { name: "AbortError" });
		},
		async shutdown() {},
		async wait() {
			throw new Error("unexpected wait");
		},
	};
	const result = await new CodeModeRuntime(new SuiteCodeModeConnector(registryFixture()), executor).execute(
		"outer-abort-error",
		"await suite.bash({ command: 'sleep 30' })",
		// SAFETY: this test fixture implements the exact Host surface exercised by this case.
		{ cwd: "/project" } as ExtensionContext,
	);
	expect(result.details.status).toBe("cancelled");
	expect(result.details.operations).toMatchObject([{ id: "nested-bash", state: "cancelled" }]);
});
