import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compensateCodeModeExecution } from "../../packages/pi-stuff/src/code-mode/extension.js";
import {
	CODE_MODE_LEDGER_ENTRY_TYPE,
	CodeModeIncompleteExecutionError,
	CodeModeSessionLedger,
} from "../../packages/pi-stuff/src/code-mode/ledger.js";
import type { JsonInputObject } from "../../packages/pi-stuff/src/shared/json-value.js";

function fixture() {
	const branch: Array<{ customType: string; data: unknown; type: "custom" }> = [];
	// SAFETY: this test fixture implements the exact Host surface exercised by this case.
	const context = {
		cwd: "/project",
		sessionManager: {
			getBranch: () => branch,
			getEntries: () => branch,
			getSessionId: () => "session-code-mode",
		},
	} as ExtensionContext;
	const ledger = new CodeModeSessionLedger({
		appendEntry(customType, data) {
			branch.push({ customType, data, type: "custom" });
		},
	});
	return { branch, context, ledger };
}

test("the Session ledger replays completed values and preserves binary, bigint, history, and snippets", () => {
	const { branch, context, ledger } = fixture();
	const controller = ledger.begin(
		context,
		"outer-read",
		"async (input) => await tools.read({ path: input.path })",
		new Map([["read", "record"]]),
	);
	controller.beginPass(0);
	const first = controller.beginToolCall("read", { path: "a.bin" });
	controller.completeToolCall(first, {
		status: "success",
		value: { bytes: new Uint8Array([1, 2, 3]), count: 4n },
	});

	controller.beginPass(1);
	const replay = controller.beginToolCall("read", { path: "a.bin" });
	expect(replay.replay).toMatchObject({ kind: "result", value: { count: 4n } });
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const bytes = replay.replay?.kind === "result" ? (replay.replay.value as { bytes: Uint8Array }).bytes : undefined;
	if (!bytes) throw new Error("replayed binary result is missing");
	expect([...bytes]).toEqual([1, 2, 3]);
	controller.finish("success");

	const history = ledger.history(context);
	expect(history).toMatchObject([
		{ executionId: controller.executionId, outerToolCallId: "outer-read", status: "success", toolCalls: 1 },
	]);
	const snippet = ledger.saveSnippet(context, controller.executionId, " read-binary ", "Read one binary file");
	expect(snippet.name).toBe("read-binary");
	expect(ledger.snippets(context)).toEqual([snippet]);
	expect(branch.every((entry) => entry.customType === CODE_MODE_LEDGER_ENTRY_TYPE)).toBe(true);
});

test("historical explicit Tool errors override a stale success classification in memory", () => {
	const { branch, context, ledger } = fixture();
	const policies = new Map([
		["read", "record"],
		["write", "never"],
	] as const);
	const approvals = new Set(["write"]);
	const controller = ledger.begin(
		context,
		"outer-historical-error",
		"await tools.read({}); await tools.write({})",
		policies,
		approvals,
	);
	controller.beginPass(0);
	const read = controller.beginToolCall("read", {});
	controller.completeToolCall(read, {
		result: Object.assign(
			{ content: [{ type: "text" as const, text: "nested failure" }], details: {} },
			{ isError: true },
		),
		status: "success",
		value: "stale success value",
	});
	const latest = branch.at(-1);
	if (!latest) throw new Error("historical settlement was not persisted");
	const persistedSettlement = structuredClone(latest);
	controller.beginToolCall("write", {});

	const resumed = ledger.resume(context, controller.executionId, policies, approvals);
	if (!resumed) throw new Error("historical execution did not resume");
	resumed.beginPass(1);
	const replay = resumed.beginToolCall("read", {});
	expect(replay.replay).toMatchObject({
		kind: "error",
		message: "nested failure",
		result: { content: [{ text: "nested failure", type: "text" }], isError: true },
	});
	expect(branch).toContainEqual(persistedSettlement);
});

test("historical replay does not infer Tool errors from prose or malformed results", () => {
	for (const result of [
		{ content: [{ type: "text", text: "error: ordinary business text" }], details: {} },
		{ content: "malformed", details: {}, isError: true },
	]) {
		const { context, ledger } = fixture();
		const policies = new Map([
			["read", "record"],
			["write", "never"],
		] as const);
		const approvals = new Set(["write"]);
		const controller = ledger.begin(context, "outer-control", "await tools.read({});", policies, approvals);
		controller.beginPass(0);
		const read = controller.beginToolCall("read", {});
		// SAFETY: this test deliberately supplies malformed historical presentation data to exercise fail-open replay.
		controller.completeToolCall(read, { result: result as never, status: "success", value: "success" });
		controller.beginToolCall("write", {});
		const resumed = ledger.resume(context, controller.executionId, policies, approvals);
		if (!resumed) throw new Error("historical execution did not resume");
		resumed.beginPass(1);
		expect(resumed.beginToolCall("read", {}).replay?.kind).toBe("result");
	}
});

test("approval pauses before the effect and resumes it only after an explicit user decision", () => {
	const { context, ledger } = fixture();
	const policies = new Map([["write", "never"]] as const);
	const approvals = new Set(["write"]);
	const controller = ledger.begin(
		context,
		"outer-write",
		"await tools.write({ path: 'a.txt', content: 'ok' })",
		policies,
		approvals,
	);
	controller.beginPass(0);
	const paused = controller.beginToolCall("write", { path: "a.txt", content: "ok" });
	expect(paused.pause).toBeDefined();
	expect(ledger.history(context)[0]?.status).toBe("paused");
	expect(ledger.pending(context)).toEqual([
		{
			args: { path: "a.txt", content: "ok" },
			connector: "tools",
			executionId: controller.executionId,
			method: "write",
			seq: 0,
		},
	]);
	const swallowedPauseFollowUp = controller.beginToolCall("read", { path: "should-not-run" });
	expect(swallowedPauseFollowUp.pause).toBeDefined();
	expect(ledger.history(context)[0]?.toolCalls).toBe(1);

	const resumed = ledger.resume(context, controller.executionId, policies, approvals);
	if (!resumed) throw new Error("paused execution did not resume");
	resumed.beginPass(1);
	const approved = resumed.beginToolCall("write", { path: "a.txt", content: "ok" });
	expect(approved.pause).toBeUndefined();
	resumed.completeToolCall(approved, { status: "success", value: { written: true } });
	resumed.finish("success");
	expect(ledger.pending(context)).toEqual([]);
	expect(ledger.resume(context, controller.executionId, policies, approvals)).toBeUndefined();
});

test("approval stays paused when the working directory changed", () => {
	const { context, ledger } = fixture();
	const policies = new Map([["write", "never"]] as const);
	const approvals = new Set(["write"]);
	const controller = ledger.begin(context, "outer-cwd", "await tools.write({ path: 'a.txt' })", policies, approvals);
	controller.beginPass(0);
	controller.beginToolCall("write", { path: "a.txt" });
	// SAFETY: this test fixture implements the exact Host surface exercised by this case.
	const movedContext = { ...context, cwd: "/another-project" } as ExtensionContext;

	expect(() => ledger.resume(movedContext, controller.executionId, policies, approvals)).toThrow(
		'Code Mode execution started in "/project"; current working directory is "/another-project"',
	);
	expect(ledger.history(context)[0]?.status).toBe("paused");
});

test("approval stays paused when its Tool is no longer active", () => {
	const { context, ledger } = fixture();
	const policies = new Map([["write", "never"]] as const);
	const approvals = new Set(["write"]);
	const controller = ledger.begin(
		context,
		"outer-missing",
		"await tools.write({ path: 'a.txt' })",
		policies,
		approvals,
	);
	controller.beginPass(0);
	controller.beginToolCall("write", { path: "a.txt" });

	expect(() => ledger.resume(context, controller.executionId, new Map(), approvals)).toThrow(
		'Code Mode pending Tool "write" is no longer active',
	);
	expect(ledger.history(context)[0]?.status).toBe("paused");
});

test("reject ends only the matching pending action and leaves earlier applied work available for rollback", () => {
	const { context, ledger } = fixture();
	const policies = new Map([
		["read", "record"],
		["write", "never"],
	] as const);
	const controller = ledger.begin(
		context,
		"outer-reject",
		"await tools.read({}); await tools.write({ value: 1 })",
		policies,
		new Set(["write"]),
	);
	controller.beginPass(0);
	const read = controller.beginToolCall("read", {});
	controller.completeToolCall(read, { status: "success", value: { observed: true } });
	controller.beginToolCall("write", { value: 1 });

	expect(ledger.reject(context, controller.executionId, 9)).toBe(false);
	expect(ledger.reject(context, controller.executionId, 1)).toBe(true);
	expect(ledger.reject(context, controller.executionId, 1)).toBe(false);
	expect(ledger.history(context)[0]?.status).toBe("rejected");
	expect(ledger.pending(context)).toEqual([]);
	expect(ledger.compensationTargets(context, controller.executionId)).toMatchObject([{ name: "read", sequence: 0 }]);
});

test("expiring a stale approval rejects it without executing the pending Tool", () => {
	const { context, ledger } = fixture();
	const controller = ledger.begin(
		context,
		"outer-expire",
		"await tools.write({ value: 1 })",
		new Map([["write", "never"]]),
		new Set(["write"]),
	);
	controller.beginPass(0);
	controller.beginToolCall("write", { value: 1 });

	expect(ledger.expire(context, 0)).toEqual([controller.executionId]);
	expect(ledger.history(context)[0]?.status).toBe("rejected");
	expect(ledger.pending(context)).toEqual([]);
});

test("an unrecorded non-replayable effect stops recovery as incomplete until the user abandons it", () => {
	const { context, ledger } = fixture();
	const controller = ledger.begin(
		context,
		"outer-effect",
		"await tools.bash({ command: 'deploy' })",
		new Map([["bash", "never"]]),
	);
	controller.beginPass(0);
	controller.beginToolCall("bash", { command: "deploy" });

	controller.beginPass(1);
	expect(() => controller.beginToolCall("bash", { command: "deploy" })).toThrow(CodeModeIncompleteExecutionError);
	expect(ledger.history(context)[0]).toMatchObject({ status: "incomplete", toolCalls: 1 });
	expect(ledger.abandon(context, controller.executionId)).toBe(true);
	expect(ledger.history(context)[0]?.status).toBe("abandoned");
	expect(ledger.abandon(context, controller.executionId)).toBe(false);
});

test("an unsettled recorded call is not repeated automatically after Runtime loss", () => {
	const { context, ledger } = fixture();
	const controller = ledger.begin(
		context,
		"outer-record",
		"await tools.read({ path: 'possibly-applied' })",
		new Map([["read", "record"]]),
	);
	controller.beginPass(0);
	controller.beginToolCall("read", { path: "possibly-applied" });

	controller.beginPass(1);
	expect(() => controller.beginToolCall("read", { path: "possibly-applied" })).toThrow(
		CodeModeIncompleteExecutionError,
	);
	expect(ledger.history(context)[0]).toMatchObject({ status: "incomplete", toolCalls: 1 });
});

test("only an explicit reexecute policy repeats an unsettled call after Runtime loss", () => {
	const { context, ledger } = fixture();
	const controller = ledger.begin(
		context,
		"outer-reexecute",
		"await tools.retryable({})",
		new Map([["retryable", "reexecute"]]),
	);
	controller.beginPass(0);
	controller.beginToolCall("retryable", {});

	controller.beginPass(1);
	const retried = controller.beginToolCall("retryable", {});
	expect(retried.replay).toBeUndefined();
	controller.completeToolCall(retried, { status: "success", value: "done" });
	controller.finish("success");
	expect(ledger.history(context)[0]).toMatchObject({ status: "success", toolCalls: 1 });
});

test("a result that cannot fit in the durable log fails instead of being replayed approximately", () => {
	const { context, ledger } = fixture();
	const controller = ledger.begin(
		context,
		"outer-large",
		"await tools.read({ path: 'large' })",
		new Map([["read", "record"]]),
	);
	controller.beginPass(0);
	const call = controller.beginToolCall("read", { path: "large" });
	expect(() => controller.completeToolCall(call, { status: "success", value: "x".repeat(1_000_001) })).toThrow(
		/too large to record durably.*small reference/s,
	);
});

test("explicit compensation attempts applied calls in reverse order and records what was undone", async () => {
	const { context, ledger } = fixture();
	const controller = ledger.begin(
		context,
		"outer-write",
		"await tools.first({}); await tools.second({})",
		new Map([
			["first", "never"],
			["second", "never"],
		]),
	);
	controller.beginPass(0);
	for (const name of ["first", "second"]) {
		const plan = controller.beginToolCall(name, { name });
		controller.completeToolCall(plan, { status: "success", value: { created: name } });
	}
	controller.finish("success");
	const order: string[] = [];
	const outcome = await compensateCodeModeExecution(
		{
			catalog: () => [],
			async compensate(invocation) {
				order.push(invocation.name);
				return true;
			},
			get: () => undefined,
			invoke: async () => {
				throw new Error("unexpected invoke");
			},
			isActive: () => false,
			list: () => [],
		},
		ledger,
		context,
		controller.executionId,
	);
	expect(order).toEqual(["second", "first"]);
	expect(outcome).toEqual({ compensated: 2, failures: [] });
	expect(ledger.history(context)[0]?.status).toBe("rolled_back");
	expect(ledger.compensationTargets(context, controller.executionId)).toEqual([]);
});

test("ledger maintenance expires stale work and retains only the newest fifty terminal executions", () => {
	const { branch, context, ledger } = fixture();
	const now = Date.now();
	const append = (data: JsonInputObject): void => {
		branch.push({ customType: CODE_MODE_LEDGER_ENTRY_TYPE, data, type: "custom" });
	};
	append({
		at: now - 25 * 60 * 60 * 1_000,
		code: "await tools.read({ path: 'stale' })",
		executionId: "stale-running",
		kind: "execution-started",
		outerToolCallId: "outer-stale",
		schemaVersion: 1,
	});
	for (let index = 0; index < 51; index += 1) {
		const executionId = `terminal-${String(index)}`;
		append({
			at: now - 1_000 + index,
			code: "text('done')",
			executionId,
			kind: "execution-started",
			outerToolCallId: `outer-${String(index)}`,
			schemaVersion: 1,
		});
		append({
			at: now - 500 + index,
			attempt: 0,
			executionId,
			kind: "execution-settled",
			schemaVersion: 1,
			status: "success",
		});
	}
	ledger.begin(context, "outer-new", "text('new')", new Map());
	const history = ledger.history(context, 100);
	expect(history.find((item) => item.executionId === "stale-running")?.status).toBe("expired");
	expect(history.filter((item) => item.status !== "running" && item.status !== "incomplete")).toHaveLength(50);
});
