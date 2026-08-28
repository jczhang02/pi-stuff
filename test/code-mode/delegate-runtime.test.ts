import { expect, test } from "bun:test";
import { Type } from "typebox";
import { isCodemodeObject, requireCodemodeValue } from "../../packages/pi-stuff/src/code-mode/cloudflare/codec.js";
import { CodeModeDelegateRuntime } from "../../packages/pi-stuff/src/code-mode/host/delegate-runtime.js";

test("delegate transport preserves binary and bigint values across the JSON host boundary", async () => {
	const responses: unknown[] = [];
	const updates: unknown[] = [];
	let received: unknown;
	const runtime = new CodeModeDelegateRuntime((message) => {
		JSON.stringify(message);
		responses.push(message);
	});
	runtime.bindCell(
		"cell-codec",
		{
			cwd: "/project",
			onTraceUpdate: (update) => updates.push(update),
		},
		new Map([
			[
				"fixture",
				{
					description: "serialization fixture",
					inputSchema: Type.Object({ payload: Type.Unknown() }),
					async invoke(input) {
						received = input;
						if (!isCodemodeObject(input)) throw new TypeError("fixture input must be an object");
						const payload = input["payload"];
						return requireCodemodeValue({ count: 1n, payload }, "delegate test result");
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
				cell_id: "cell-codec",
				input: {
					payload: { __codemode_binary_v1__: "Uint8Array", data: "AQID" },
				},
				runtime_tool_call_id: "nested-codec",
				tool_name: { name: "fixture" },
			},
			type: "tool/invoke",
		},
	});
	for (let attempt = 0; attempt < 20 && responses.length === 0; attempt += 1) await Bun.sleep(1);

	expect(responses).toHaveLength(1);
	expect(received).toMatchObject({ payload: new Uint8Array([1, 2, 3]) });
	expect(responses[0]).toMatchObject({
		id: 7,
		result: {
			status: "ok",
			value: {
				result: {
					count: { __codemode_bigint_v1__: "1" },
					payload: { __codemode_binary_v1__: "Uint8Array", data: "AQID" },
				},
				type: "tool/result",
			},
		},
		type: "delegate/response",
	});
	expect(updates.at(-1)).toMatchObject({
		trace: {
			status: "done",
		},
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
		trace: { error: "1", result: { content: [{ text: "1", type: "text" }] }, status: "error" },
	});
	runtime.clear();
});

test("malformed transport input returns an error response", async () => {
	const responses: unknown[] = [];
	const runtime = new CodeModeDelegateRuntime((message) => responses.push(message));
	runtime.bindCell(
		"cell-malformed-input",
		{ cwd: "/project" },
		new Map([
			[
				"fixture",
				{
					description: "input fixture",
					inputSchema: Type.Object({}),
					invoke: async () => true,
					name: "fixture",
					usage: "tools.fixture({})",
				},
			],
		]),
	);
	runtime.handleRequest({
		id: 11,
		request: {
			invocation: {
				cell_id: "cell-malformed-input",
				input: { __codemode_bigint_v1__: "not-an-integer" },
				runtime_tool_call_id: "nested-malformed-input",
				tool_name: { name: "fixture" },
			},
			type: "tool/invoke",
		},
	});
	for (let attempt = 0; attempt < 20 && responses.length === 0; attempt += 1) await Bun.sleep(1);

	expect(responses).toEqual([
		{
			id: 11,
			result: { message: "Code Mode bigint envelope is invalid", status: "error" },
			type: "delegate/response",
		},
	]);
	runtime.clear();
});

test("a durable approval decision pauses before the nested Tool can execute", async () => {
	const responses: unknown[] = [];
	const updates: unknown[] = [];
	let effects = 0;
	const runtime = new CodeModeDelegateRuntime((message) => responses.push(message));
	runtime.bindCell(
		"cell-approval",
		{
			beginToolCall: () => ({
				attempt: 0,
				executionId: "cm-approval",
				id: "cm-approval:0",
				pause: { message: "approval required" },
				sequence: 0,
			}),
			cwd: "/project",
			onTraceUpdate: (update) => updates.push(update),
		},
		new Map([
			[
				"write",
				{
					description: "write fixture",
					inputSchema: Type.Object({}),
					async invoke() {
						effects += 1;
						return true;
					},
					name: "write",
					usage: "tools.write({})",
				},
			],
		]),
	);
	runtime.handleRequest({
		id: 9,
		request: {
			invocation: {
				cell_id: "cell-approval",
				input: {},
				runtime_tool_call_id: "nested-write",
				tool_name: { name: "write" },
			},
			type: "tool/invoke",
		},
	});
	for (let attempt = 0; attempt < 20 && responses.length === 0; attempt += 1) await Bun.sleep(1);

	expect(effects).toBe(0);
	expect(responses).toEqual([
		{ id: 9, result: { message: "approval required", status: "error" }, type: "delegate/response" },
	]);
	expect(updates.at(-1)).toMatchObject({ trace: { id: "cm-approval:0", status: "pending" } });
	runtime.clear();
});

test("a failed durable success record is settled as an error instead of staying in flight", async () => {
	const responses: unknown[] = [];
	const settlements: string[] = [];
	const runtime = new CodeModeDelegateRuntime((message) => responses.push(message));
	runtime.bindCell(
		"cell-ledger-failure",
		{
			beginToolCall: () => ({
				attempt: 0,
				executionId: "cm-ledger-failure",
				id: "cm-ledger-failure:0",
				sequence: 0,
			}),
			completeToolCall: (_plan, settlement) => {
				settlements.push(settlement.status);
				if (settlement.status === "success") throw new Error("ledger full");
			},
			cwd: "/project",
		},
		new Map([
			[
				"fixture",
				{
					description: "ledger failure fixture",
					inputSchema: Type.Object({}),
					invoke: async () => true,
					name: "fixture",
					usage: "tools.fixture({})",
				},
			],
		]),
	);
	runtime.handleRequest({
		id: 10,
		request: {
			invocation: {
				cell_id: "cell-ledger-failure",
				input: {},
				runtime_tool_call_id: "nested-ledger-failure",
				tool_name: { name: "fixture" },
			},
			type: "tool/invoke",
		},
	});
	for (let attempt = 0; attempt < 20 && responses.length === 0; attempt += 1) await Bun.sleep(1);

	expect(settlements).toEqual(["success", "error"]);
	expect(responses).toEqual([
		{ id: 10, result: { message: "ledger full", status: "error" }, type: "delegate/response" },
	]);
	runtime.clear();
});

test("an unserializable Tool result settles as an error before durable success", async () => {
	const responses: unknown[] = [];
	const settlements: string[] = [];
	const cyclic: unknown[] = [];
	cyclic.push(cyclic);
	const runtime = new CodeModeDelegateRuntime((message) => responses.push(message));
	runtime.bindCell(
		"cell-unserializable-result",
		{
			beginToolCall: () => ({
				attempt: 0,
				executionId: "cm-unserializable-result",
				id: "cm-unserializable-result:0",
				sequence: 0,
			}),
			completeToolCall: (_plan, settlement) => settlements.push(settlement.status),
			cwd: "/project",
		},
		new Map([
			[
				"fixture",
				{
					description: "unserializable result fixture",
					inputSchema: Type.Object({}),
					// SAFETY: the malformed return intentionally exercises the runtime Tool-result boundary.
					invoke: async () => cyclic as never,
					name: "fixture",
					usage: "tools.fixture({})",
				},
			],
		]),
	);
	runtime.handleRequest({
		id: 12,
		request: {
			invocation: {
				cell_id: "cell-unserializable-result",
				input: {},
				runtime_tool_call_id: "nested-unserializable-result",
				tool_name: { name: "fixture" },
			},
			type: "tool/invoke",
		},
	});
	for (let attempt = 0; attempt < 20 && responses.length === 0; attempt += 1) await Bun.sleep(1);

	expect(settlements).toEqual(["error"]);
	expect(responses).toEqual([
		{
			id: 12,
			result: {
				message: "Failed to serialize nested Tool result: Code Mode storage value is not serializable",
				status: "error",
			},
			type: "delegate/response",
		},
	]);
	runtime.clear();
});

test("hidden nested Tools count against the per-execution safety bound", async () => {
	const responses: Array<{ id: number; result: { message?: string; status: string } }> = [];
	let invocations = 0;
	const runtime = new CodeModeDelegateRuntime((message) => responses.push(message));
	runtime.bindCell(
		"cell-hidden-limit",
		{ cwd: "/project" },
		new Map([
			[
				"hidden",
				{
					description: "hidden fixture",
					inputSchema: Type.Object({}),
					invoke: async () => {
						invocations += 1;
						return true;
					},
					name: "hidden",
					presentation: "hidden",
					usage: "tools.hidden({})",
				},
			],
		]),
	);
	for (let index = 1; index <= 769; index += 1) {
		runtime.handleRequest({
			id: index,
			request: {
				invocation: {
					cell_id: "cell-hidden-limit",
					input: {},
					runtime_tool_call_id: `hidden-${String(index)}`,
					tool_name: { name: "hidden" },
				},
				type: "tool/invoke",
			},
		});
	}
	for (let attempt = 0; attempt < 20 && responses.length < 769; attempt += 1) await Bun.sleep(1);

	expect(invocations).toBe(768);
	expect(responses).toHaveLength(769);
	expect(responses.find((response) => response.id === 769)?.result).toEqual({
		message: "Code Mode supports at most 768 nested Tool calls per execution",
		status: "error",
	});
	runtime.clear();
});
