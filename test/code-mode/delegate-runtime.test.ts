import { expect, test } from "bun:test";
import { Type } from "typebox";
import { CodeModeDelegateRuntime } from "../../packages/pi-stuff/src/code-mode/host/delegate-runtime.js";

test("delegate serialization failures reject the V8 call instead of leaving the cell hung", async () => {
	const responses: unknown[] = [];
	const updates: unknown[] = [];
	const runtime = new CodeModeDelegateRuntime((message) => {
		JSON.stringify(message);
		responses.push(message);
	});
	runtime.bindCell(
		"cell-serialization",
		{
			cwd: "/project",
			onTraceUpdate: (update) => updates.push(update),
		},
		new Map([
			[
				"fixture",
				{
					description: "serialization fixture",
					inputSchema: Type.Object({}),
					async invoke() {
						return { content: [], details: { unsupported: 1n } };
					},
					name: "fixture",
					usage: "suite.fixture({})",
				},
			],
		]),
	);

	runtime.handleRequest({
		id: 7,
		request: {
			invocation: {
				cell_id: "cell-serialization",
				input: {},
				runtime_tool_call_id: "nested-serialization",
				tool_name: { name: "fixture" },
			},
			type: "tool/invoke",
		},
	});
	for (let attempt = 0; attempt < 20 && responses.length === 0; attempt += 1) await Bun.sleep(1);

	expect(responses).toHaveLength(1);
	expect(responses[0]).toMatchObject({ id: 7, result: { status: "error" }, type: "delegate/response" });
	const message = (responses[0] as { result: { message: string } }).result.message;
	expect(message).toStartWith("Failed to serialize nested Tool result:");
	expect(message).toContain("BigInt");
	expect(updates.at(-1)).toMatchObject({
		traces: [
			{
				error: message,
				status: "error",
			},
		],
	});
	runtime.clear();
});

test("non-Error thrown values still settle the trace and V8 request", async () => {
	const responses: unknown[] = [];
	const updates: unknown[] = [];
	const runtime = new CodeModeDelegateRuntime((message) => {
		JSON.stringify(message);
		responses.push(message);
	});
	runtime.bindCell(
		"cell-thrown-value",
		{ cwd: "/project", onTraceUpdate: (update) => updates.push(update) },
		new Map([
			[
				"fixture",
				{
					description: "throw a non-Error value",
					inputSchema: Type.Object({}),
					async invoke() {
						throw 1n;
					},
					name: "fixture",
					usage: "suite.fixture({})",
				},
			],
		]),
	);
	runtime.handleRequest({
		id: 8,
		request: {
			invocation: {
				cell_id: "cell-thrown-value",
				input: {},
				runtime_tool_call_id: "nested-thrown-value",
				tool_name: { name: "fixture" },
			},
			type: "tool/invoke",
		},
	});
	for (let attempt = 0; attempt < 20 && responses.length === 0; attempt += 1) await Bun.sleep(1);

	expect(responses).toEqual([{ id: 8, result: { message: "1", status: "error" }, type: "delegate/response" }]);
	expect(updates.at(-1)).toMatchObject({
		traces: [{ error: "1", result: { content: [{ text: "1", type: "text" }] }, status: "error" }],
	});
	runtime.clear();
});
