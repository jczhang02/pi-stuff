import { expect, test } from "bun:test";
import { CodeModeTraceStore } from "../../packages/pi-stuff-code-mode/host/trace-store.js";

test("duplicate nested Tool IDs fail instead of corrupting the UI projection", () => {
	const traces = new CodeModeTraceStore();
	traces.start("cell", "nested-1", "read", { path: "a.ts" });
	expect(() => traces.start("cell", "nested-1", "write", { path: "b.ts" })).toThrow(
		"Duplicate Code Mode nested Tool call ID: nested-1",
	);
});
