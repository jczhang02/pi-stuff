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

test("650 trace fan-out updates each carry only the changed nested Tool", () => {
	const traces = new CodeModeTraceStore();
	const updates: RuntimeTraceUpdate[] = [];
	const context = { cwd: "/project", onTraceUpdate: (update: RuntimeTraceUpdate) => updates.push(update) };
	for (let index = 0; index < 650; index += 1) {
		const trace = traces.start("cell", `nested-${String(index)}`, "read", { path: `${String(index)}.ts` });
		traces.emit("cell", trace, context);
	}

	expect(updates).toHaveLength(650);
	expect(updates[0]?.trace.id).toBe("nested-0");
	expect(updates[649]?.trace.id).toBe("nested-649");
	expect(updates.every((update) => update.trace.status === "running")).toBe(true);
	expect(updates.every((update) => !("traces" in update))).toBe(true);
});
