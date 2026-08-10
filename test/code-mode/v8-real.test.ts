import { expect, test } from "bun:test";
import { Type } from "typebox";
import { buildSuiteSandboxSource } from "../../packages/pi-stuff/src/code-mode/connector.js";
import type { RuntimeResponse, SuiteSandboxTool } from "../../packages/pi-stuff/src/code-mode/protocol.js";
import { V8CodeModeExecutor } from "../../packages/pi-stuff/src/code-mode/v8-executor.js";

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
