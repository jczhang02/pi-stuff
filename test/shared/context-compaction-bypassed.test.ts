import { expect, test } from "bun:test";
import { isContextCompactionBypassedEvent } from "../../packages/pi-stuff/src/shared/context-compaction-bypassed.js";

test("the shared Context compaction-bypass contract rejects schema mismatches", () => {
	const sessionManager = {};
	expect(
		isContextCompactionBypassedEvent({ schemaVersion: 1, sessionManager, source: "magic-context" }),
	).toBeTrue();
	for (const value of [
		undefined,
		{},
		{ schemaVersion: 2, sessionManager, source: "magic-context" },
		{ schemaVersion: 1, source: "magic-context" },
		{ schemaVersion: 1, sessionManager: null, source: "magic-context" },
		{ schemaVersion: 1, sessionManager, source: "native" },
	]) {
		expect(isContextCompactionBypassedEvent(value)).toBeFalse();
	}
});
