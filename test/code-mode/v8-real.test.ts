import { expect, test } from "bun:test";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildSuiteSandboxSource, SuiteCodeModeConnector } from "../../packages/pi-stuff/src/code-mode/connector.js";
import { CodeModeSessionLedger } from "../../packages/pi-stuff/src/code-mode/ledger.js";
import type { RuntimeResponse, SuiteSandboxTool } from "../../packages/pi-stuff/src/code-mode/protocol.js";
import { CodeModeRuntime } from "../../packages/pi-stuff/src/code-mode/runtime.js";
import { V8CodeModeExecutor } from "../../packages/pi-stuff/src/code-mode/v8-executor.js";
import type { SuiteToolDefinitionRegistry } from "../../packages/pi-stuff/src/tool-display/contract.js";

const realTest = process.env["PI_STUFF_CODE_MODE_REAL"] === "1" ? test : test.skip;

realTest("the certified V8 host executes a real Connector call and returns its trace", async () => {
	const executor = new V8CodeModeExecutor();
	const tool: SuiteSandboxTool = {
		description: "Return one fixture value",
		inputSchema: Type.Object({ value: Type.String() }),
		name: "fixture",
		usage: "suite.fixture({ value: string })",
		async invoke(input, context) {
			const result = {
				content: [{ type: "text" as const, text: (input as { value: string }).value }],
				details: { real: true },
			};
			context.captureResult?.(result);
			return result;
		},
	};
	try {
		let response: RuntimeResponse = await executor.execute({
			context: { cwd: process.cwd() },
			source: buildSuiteSandboxSource(
				'const result = await suite.fixture({ value: "REAL_V8_OK" }); text(result.content[0].text);',
				[{ description: tool.description, inputSchema: tool.inputSchema, name: tool.name }],
			),
			tools: [tool],
		});
		while (response.kind === "yielded") {
			response = await executor.wait(response.cellId, {
				context: { cwd: process.cwd() },
				yieldTimeMs: 60_000,
			});
		}
		expect(response.kind).toBe("result");
		expect(response.contentItems).toContainEqual({ type: "input_text", text: "REAL_V8_OK" });
		expect(response.traces).toMatchObject([
			{
				input: { value: "REAL_V8_OK" },
				name: "fixture",
				result: { content: [{ type: "text", text: "REAL_V8_OK" }], details: { real: true } },
				status: "done",
			},
		]);
	} finally {
		await executor.shutdown();
	}
});

realTest("the certified V8 host exposes a delegated Tool literally named bash", async () => {
	const executor = new V8CodeModeExecutor();
	const tool: SuiteSandboxTool = {
		description: "Return a Bash fixture without running a process",
		inputSchema: Type.Object({ command: Type.String() }),
		name: "bash",
		usage: "tools.bash({ command })",
		async invoke(input) {
			return (input as { command: string }).command;
		},
	};
	try {
		let response: RuntimeResponse = await executor.execute({
			context: { cwd: process.cwd() },
			source: buildSuiteSandboxSource("text(await tools.bash({ command: 'BASH_TOOL_OK' }))", [
				{ description: tool.description, inputSchema: tool.inputSchema, name: tool.name },
			]),
			tools: [tool],
		});
		while (response.kind === "yielded") {
			response = await executor.wait(response.cellId, { context: { cwd: process.cwd() }, yieldTimeMs: 60_000 });
		}
		expect(response).toMatchObject({ kind: "result" });
		expect(response.contentItems).toContainEqual({ type: "input_text", text: "BASH_TOOL_OK" });
	} finally {
		await executor.shutdown();
	}
});

realTest("the Cloudflare async-arrow form returns once and never duplicates explicit output", async () => {
	const executor = new V8CodeModeExecutor();
	const tool: SuiteSandboxTool = {
		description: "Return two text blocks",
		inputSchema: Type.Object({}),
		name: "fixture_text_blocks",
		usage: "tools.fixture_text_blocks({})",
		async invoke(_input, context) {
			const result = {
				content: [
					{ type: "text" as const, text: "alpha" },
					{ type: "text" as const, text: "beta" },
				],
				details: {},
			};
			context.captureResult?.(result);
			return "alpha\nbeta";
		},
	};
	try {
		let response: RuntimeResponse = await executor.execute({
			context: { cwd: process.cwd() },
			source: buildSuiteSandboxSource(
				'async () => { const result = await tools.fixture_text_blocks({}); text(result); return "must not duplicate"; }',
				[{ description: tool.description, inputSchema: tool.inputSchema, name: tool.name }],
			),
			tools: [tool],
		});
		while (response.kind === "yielded") {
			response = await executor.wait(response.cellId, {
				context: { cwd: process.cwd() },
				yieldTimeMs: 60_000,
			});
		}
		expect(response.kind).toBe("result");
		expect(response.contentItems).toContainEqual({
			type: "input_text",
			text: "alpha\nbeta",
		});
		expect(response.contentItems).not.toContainEqual({ type: "input_text", text: "must not duplicate" });
	} finally {
		await executor.shutdown();
	}
});

realTest("the certified V8 host settles a Tool result whose text looks like cancellation", async () => {
	const executor = new V8CodeModeExecutor();
	const tool: SuiteSandboxTool = {
		description: "Return a deterministic cancellation-looking fixture",
		inputSchema: Type.Object({}),
		name: "fixture_cancel",
		usage: "suite.fixture_cancel({})",
		async invoke(_input, context) {
			const result = {
				content: [{ type: "text" as const, text: "Command exited with code 1\nOperation aborted" }],
				details: { exitCode: 1 },
			};
			context.captureResult?.(result);
			return result;
		},
	};
	try {
		let response: RuntimeResponse = await executor.execute({
			context: { cwd: process.cwd() },
			source: buildSuiteSandboxSource(
				"const result = await suite.fixture_cancel({}); text(result.content[0].text);",
				[{ description: tool.description, inputSchema: tool.inputSchema, name: tool.name }],
			),
			tools: [tool],
		});
		for (let attempt = 0; response.kind === "yielded" && attempt < 10; attempt += 1) {
			response = await executor.wait(response.cellId, {
				context: { cwd: process.cwd() },
				yieldTimeMs: 1_000,
			});
		}
		expect(response.kind).toBe("result");
		expect(response.contentItems).toContainEqual({
			type: "input_text",
			text: "Command exited with code 1\nOperation aborted",
		});
	} finally {
		await executor.shutdown();
	}
});

realTest("the certified V8 host settles a rejected delegated Tool call", async () => {
	const executor = new V8CodeModeExecutor();
	const tool: SuiteSandboxTool = {
		description: "Reject deterministically",
		inputSchema: Type.Object({}),
		name: "fixture_reject",
		usage: "suite.fixture_reject({})",
		async invoke() {
			throw new Error("Operation aborted\n\nCommand exited with code 1");
		},
	};
	try {
		let response: RuntimeResponse = await executor.execute({
			context: { cwd: process.cwd() },
			source: buildSuiteSandboxSource("await suite.fixture_reject({});", [
				{ description: tool.description, inputSchema: tool.inputSchema, name: tool.name },
			]),
			tools: [tool],
		});
		for (let attempt = 0; response.kind === "yielded" && attempt < 10; attempt += 1) {
			response = await executor.wait(response.cellId, {
				context: { cwd: process.cwd() },
				yieldTimeMs: 100,
			});
		}
		expect(response.kind).toBe("result");
		expect(response).toMatchObject({ errorText: expect.stringContaining("Command exited with code 1") });
	} finally {
		await executor.shutdown();
	}
});

realTest("the certified V8 host runs durable steps and saved snippets with binary and bigint values", async () => {
	const executor = new V8CodeModeExecutor();
	const branch: Array<{ customType: string; data: unknown; type: "custom" }> = [];
	const context = {
		cwd: process.cwd(),
		sessionManager: {
			getBranch: () => branch,
			getEntries: () => branch,
			getSessionId: () => "real-v8-ledger",
		},
	} as unknown as ExtensionContext;
	const ledger = new CodeModeSessionLedger({
		appendEntry(customType, data) {
			branch.push({ customType, data, type: "custom" });
		},
	});
	const definition = {
		description: "Round-trip binary and bigint values",
		execute: async () => ({ content: [], details: {} }),
		label: "Codec",
		name: "codec_fixture",
		parameters: Type.Object({ count: Type.Unknown(), payload: Type.Unknown() }),
	} satisfies ToolDefinition;
	let invocations = 0;
	let received: unknown;
	const registry: SuiteToolDefinitionRegistry = {
		catalog: () => [
			{
				codeMode: { replay: "record" },
				definition,
			},
		],
		compensate: async () => false,
		get: (name) => (name === definition.name ? definition : undefined),
		async invoke(invocation) {
			invocations += 1;
			received = invocation.input;
			const result = {
				content: [],
				details: {},
				structuredContent: { count: 8n, payload: new Uint8Array([1, 2, 3]) },
			} as AgentToolResult<unknown>;
			return { isError: false, result };
		},
		isActive: (name) => name === definition.name,
		list: () => [definition],
	};
	const runtime = new CodeModeRuntime(new SuiteCodeModeConnector(registry), executor, ledger);
	try {
		const first = await runtime.execute(
			"outer-codec",
			"async () => await codemode.step('codec', async () => await tools.codec_fixture({ count: 7n, payload: new Uint8Array([4, 5]) }))",
			context,
		);
		if (first.details.status !== "success") throw new Error(Bun.inspect(first));
		expect(first.details.status).toBe("success");
		expect(received).toMatchObject({ count: 7n, payload: new Uint8Array([4, 5]) });
		if (!first.details.executionId) throw new Error("Code Mode execution ID is missing");
		ledger.saveSnippet(context, first.details.executionId, "codec-step", "Round-trip typed values");

		const second = await runtime.execute(
			"outer-snippet",
			"const value = await codemode.run('codec-step'); text(String(value.count === 8n && value.payload instanceof Uint8Array && value.payload[2] === 3));",
			context,
		);
		expect(second.content).toContainEqual({ type: "text", text: "true" });
		expect(second.details.status).toBe("success");
		expect(invocations).toBe(2);
	} finally {
		await runtime.shutdown();
	}
});

realTest("the certified V8 host pauses an approval-required Tool and executes it once after approval", async () => {
	const executor = new V8CodeModeExecutor();
	const branch: Array<{ customType: string; data: unknown; type: "custom" }> = [];
	const context = {
		cwd: process.cwd(),
		sessionManager: {
			getBranch: () => branch,
			getEntries: () => branch,
			getSessionId: () => "real-v8-approval",
		},
	} as unknown as ExtensionContext;
	const ledger = new CodeModeSessionLedger({
		appendEntry(customType, data) {
			branch.push({ customType, data, type: "custom" });
		},
	});
	const definition = {
		description: "Apply one approval fixture effect",
		execute: async () => ({ content: [], details: {} }),
		label: "Approval fixture",
		name: "approval_fixture",
		parameters: Type.Object({ value: Type.String() }),
	} satisfies ToolDefinition;
	let effects = 0;
	const registry: SuiteToolDefinitionRegistry = {
		catalog: () => [{ codeMode: { replay: "never", requiresApproval: true }, definition }],
		compensate: async () => false,
		get: (name) => (name === definition.name ? definition : undefined),
		async invoke() {
			effects += 1;
			return {
				isError: false,
				result: { content: [{ type: "text", text: "APPROVED" }], details: {} },
			};
		},
		isActive: (name) => name === definition.name,
		list: () => [definition],
	};
	const runtime = new CodeModeRuntime(new SuiteCodeModeConnector(registry), executor, ledger);
	try {
		const paused = await runtime.execute(
			"outer-approval",
			"text(await tools.approval_fixture({ value: 'ok' }))",
			context,
		);
		expect(paused.details).toMatchObject({ pending: [{ method: "approval_fixture", seq: 0 }], status: "paused" });
		expect(effects).toBe(0);
		if (!paused.details.executionId) throw new Error("Paused Code Mode execution ID is missing");

		const approved = await runtime.approve(paused.details.executionId, context);
		expect(approved.content).toContainEqual({ type: "text", text: "APPROVED" });
		expect(approved.details.status).toBe("success");
		expect(effects).toBe(1);
		await runtime.approve(paused.details.executionId, context);
		expect(effects).toBe(1);
	} finally {
		await runtime.shutdown();
	}
});
