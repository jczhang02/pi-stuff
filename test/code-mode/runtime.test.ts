import { expect, test } from "bun:test";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildSuiteSandboxSource, SuiteCodeModeConnector } from "../../packages/pi-stuff/src/code-mode/connector.js";
import { createCodeModeDefinition } from "../../packages/pi-stuff/src/code-mode/extension.js";
import { type CodeModeExecutor, CodeModeRuntime } from "../../packages/pi-stuff/src/code-mode/runtime.js";
import type {
	SuiteToolDefinitionRegistry,
	SuiteToolInvocation,
	SuiteToolInvocationResult,
} from "../../packages/pi-stuff/src/tool-display/contract.js";

function registryFixture(): SuiteToolDefinitionRegistry & { readonly invocations: SuiteToolInvocation[] } {
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
	]);
	return {
		get: (name) => definitions.get(name),
		async invoke(invocation): Promise<SuiteToolInvocationResult> {
			invocations.push(invocation);
			const result: AgentToolResult<unknown> = {
				content: [{ type: "text", text: "first line" }],
				details: { path: (invocation.input as { path?: string }).path },
			};
			invocation.onUpdate?.({ content: [{ type: "text", text: "partial" }], details: {} });
			return { isError: false, result };
		},
		invocations,
		isActive: (name) => name === "read",
		list: () => [...definitions.values()],
	};
}

test("the compact Tool contract states execution and Bash timeout constraints", () => {
	const definition = createCodeModeDefinition({} as CodeModeRuntime);
	expect(definition.description).toContain("timeout is seconds");
	expect(definition.description).toContain("max 86400");
	expect(definition.description).toContain("console is unavailable");
	expect(definition.description).toContain("top-level return is invalid");
});

test("the Connector exposes every active Suite Tool and keeps inactive Tools out", async () => {
	const registry = registryFixture();
	const connector = new SuiteCodeModeConnector(registry);
	const tools = connector.tools();
	expect(tools.map((tool) => tool.name)).toEqual(["read"]);
	expect(tools[0]?.inputSchema).toEqual(registry.get("read")?.parameters);

	let captured: AgentToolResult<unknown> | undefined;
	const value = await tools[0]?.invoke(
		{ path: "README.md", limit: 1 },
		{
			captureResult: (result) => {
				captured = result;
			},
			cwd: "/project",
			extensionContext: { cwd: "/project" } as ExtensionContext,
			onUpdate: () => {},
			toolCallId: "nested-read",
		},
		new AbortController().signal,
	);
	expect(value).toEqual(captured);
	expect(registry.invocations[0]).toMatchObject({
		input: { path: "README.md", limit: 1 },
		name: "read",
		toolCallId: "nested-read",
	});
});

test("the local prelude provides Cloudflare-style suite/search/describe without entering model history", () => {
	const source = buildSuiteSandboxSource("text((await suite.read({ path: 'README.md' })).content[0].text)", [
		{
			description: "Read a file",
			inputSchema: Type.Object({ path: Type.String() }),
			name: "read",
		},
	]);
	expect(source).toContain("globalThis.suite=globalThis.tools");
	expect(source).toContain("globalThis.codemode=");
	expect(source).toContain("codemode.search");
	expect(source).toEndWith("text((await suite.read({ path: 'README.md' })).content[0].text)");
});

test("the local catalog emits executable paths for non-identifier Tool names", () => {
	const source = buildSuiteSandboxSource("text(codemode.describe('suite[\"task-create\"]').usage)", [
		{
			description: "Create a task",
			inputSchema: Type.Object({ description: Type.String() }),
			name: "task-create",
		},
	]);
	expect(source).toContain('"path":"suite[\\"task-create\\"]"');
	expect(source).toContain('value.startsWith("suite[")');
	expect(source).toEndWith("text(codemode.describe('suite[\"task-create\"]').usage)");
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
		{ cwd: "/project" } as ExtensionContext,
	);
	expect(result.details.status).toBe("cancelled");
	expect(result.details.operations).toMatchObject([{ id: "nested-bash", state: "cancelled" }]);
});
