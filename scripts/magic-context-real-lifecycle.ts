import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { isJsonInputObject, type JsonInputObject } from "../packages/pi-stuff/src/shared/json-value.js";
import type { RpcRecord, RpcTransport } from "./magic-context-real-rpc.js";

const SESSION_STATE_SCHEMA = Type.Object(
	{
		isStreaming: Type.Boolean(),
		sessionFile: Type.Optional(Type.String()),
		sessionId: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);
const SESSION_CHANGE_SCHEMA = Type.Object({ cancelled: Type.Boolean() }, { additionalProperties: true });
const LAST_ASSISTANT_TEXT_SCHEMA = Type.Object({ text: Type.String() }, { additionalProperties: true });
const SESSION_ENTRIES_SCHEMA = Type.Object({ entries: Type.Array(Type.Unknown()) }, { additionalProperties: true });
const GOAL_ENTRY_SCHEMA = Type.Object(
	{
		customType: Type.Literal("goal-state"),
		data: Type.Object(
			{ goal: Type.Object({ status: Type.String() }, { additionalProperties: true }) },
			{ additionalProperties: true },
		),
		type: Type.Literal("custom"),
	},
	{ additionalProperties: true },
);

type SessionState = Static<typeof SESSION_STATE_SCHEMA>;

function fail(message: string): never {
	throw new Error(`Magic Context real-provider acceptance failed: ${message}`);
}

function responseData(record: RpcRecord, commandName: string): JsonInputObject {
	if (record.type !== "response" || record.command !== commandName || record.success !== true) {
		fail(`RPC ${commandName} failed: ${JSON.stringify(record)}`);
	}
	return isJsonInputObject(record.data) ? record.data : {};
}

async function sessionState(rpc: RpcTransport): Promise<SessionState> {
	const data = responseData(await rpc.send({ type: "get_state" }), "get_state");
	if (!Check(SESSION_STATE_SCHEMA, data)) fail("get_state returned malformed lifecycle state");
	return data;
}

async function lastAssistantText(rpc: RpcTransport): Promise<string> {
	const data = responseData(await rpc.send({ type: "get_last_assistant_text" }), "get_last_assistant_text");
	if (!Check(LAST_ASSISTANT_TEXT_SCHEMA, data)) fail("get_last_assistant_text returned malformed lifecycle data");
	return data.text;
}

async function verifyCancellationRecovery(rpc: RpcTransport): Promise<void> {
	const from = rpc.records.length;
	await rpc.send({
		message: "Write 400 numbered lines, one line at a time, and do not call tools.",
		type: "prompt",
	});
	await rpc.waitFor((record) => record.type === "agent_start", { from, timeoutMs: 60_000 });
	await rpc.send({ type: "abort" });
	await rpc.waitFor((record) => record.type === "agent_settled", { from, timeoutMs: 60_000 });
	if ((await sessionState(rpc)).isStreaming) fail("Pi remained busy after aborting a real turn");
	await rpc.promptAndWait("Reply exactly MAGIC_CANCEL_RECOVERY_DONE.");
	if ((await lastAssistantText(rpc)).trim() !== "MAGIC_CANCEL_RECOVERY_DONE") {
		fail("Magic Context did not recover after a real Pi cancellation");
	}
}

function assertSessionChange(record: RpcRecord, commandName: "new_session" | "switch_session"): void {
	const data = responseData(record, commandName);
	if (!Check(SESSION_CHANGE_SCHEMA, data) || data.cancelled) {
		fail(`${commandName} was cancelled: ${JSON.stringify(record)}`);
	}
}

async function verifyLiveSessionSwitch(
	rpc: RpcTransport,
	primary: { readonly sessionFile: string; readonly sessionId: string },
	canary: string,
): Promise<void> {
	assertSessionChange(await rpc.send({ type: "new_session" }), "new_session");
	const secondary = await sessionState(rpc);
	if (!secondary.sessionId || secondary.sessionId === primary.sessionId) {
		fail(`new_session did not replace the active identity: ${JSON.stringify(secondary)}`);
	}
	await rpc.promptAndWait("Reply exactly MAGIC_SWITCH_TARGET_DONE.");
	if ((await lastAssistantText(rpc)).trim() !== "MAGIC_SWITCH_TARGET_DONE") {
		fail("the replacement Session did not complete a Magic Context turn");
	}

	assertSessionChange(await rpc.send({ sessionPath: primary.sessionFile, type: "switch_session" }), "switch_session");
	const restored = await sessionState(rpc);
	if (restored.sessionId !== primary.sessionId || restored.sessionFile !== primary.sessionFile) {
		fail(`switch_session did not restore the primary identity: ${JSON.stringify(restored)}`);
	}
	const data = responseData(await rpc.send({ type: "get_entries" }), "get_entries");
	if (!Check(SESSION_ENTRIES_SCHEMA, data)) fail("get_entries returned malformed lifecycle data");
	const goal = data.entries.filter((entry) => Check(GOAL_ENTRY_SCHEMA, entry)).at(-1);
	if (!JSON.stringify(data.entries).includes(canary) || goal?.data.goal.status !== "paused") {
		fail("switch_session lost the primary canary or paused Goal state");
	}
	await rpc.promptAndWait("Reply exactly MAGIC_SWITCH_RETURN_DONE.");
	if ((await lastAssistantText(rpc)).trim() !== "MAGIC_SWITCH_RETURN_DONE") {
		fail("Magic Context did not resume after switching back to the primary Session");
	}
}

export async function verifyRealHostLifecycle(
	rpc: RpcTransport,
	primary: { readonly sessionFile: string; readonly sessionId: string },
	canary: string,
) {
	await verifyCancellationRecovery(rpc);
	await verifyLiveSessionSwitch(rpc, primary, canary);
	return { cancellationRecovery: true, liveSessionSwitch: true } as const;
}
