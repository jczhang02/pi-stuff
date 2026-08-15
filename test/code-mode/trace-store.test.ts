import { expect, test } from "bun:test";
import { CodeModeTraceStore } from "../../packages/pi-stuff/src/code-mode/host/trace-store.js";
import type { RuntimeTraceUpdate } from "../../packages/pi-stuff/src/code-mode/protocol.js";

test("duplicate nested Tool IDs fail instead of corrupting the UI projection", () => {
	const traces = new CodeModeTraceStore();
	traces.start("cell", "nested-1", "read", { path: "a.ts" });
	expect(() => traces.start("cell", "nested-1", "write", { path: "b.ts" })).toThrow(
		"Duplicate Code Mode nested Tool call ID: nested-1",
	);
});

test("trace updates carry only the changed nested Tool", () => {
	const traces = new CodeModeTraceStore();
	const updates: RuntimeTraceUpdate[] = [];
	const context = { cwd: "/project", onTraceUpdate: (update: RuntimeTraceUpdate) => updates.push(update) };
	const first = traces.start("cell", "nested-1", "read", { path: "a.ts" });
	traces.emit("cell", first, context);
	first.status = "done";
	const second = traces.start("cell", "nested-2", "write", { path: "b.ts" });
	traces.emit("cell", second, context);

	expect(updates.map((update) => update.trace.id)).toEqual(["nested-1", "nested-2"]);
	expect(updates[0]?.trace.status).toBe("running");
	expect(updates.every((update) => !("traces" in update))).toBe(true);
});
