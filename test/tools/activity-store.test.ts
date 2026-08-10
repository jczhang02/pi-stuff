import { expect, test } from "bun:test";
import { ToolActivityStore } from "../../packages/pi-stuff/src/tool-display/activity-store.js";

test("ToolActivityStore exposes immutable snapshots", () => {
	const store = new ToolActivityStore();
	const running = store.begin({
		id: "call-1",
		label: "Read",
		name: "read",
		target: "README.md",
	});
	const settled = store.settle("call-1", {
		detailLines: ["line one"],
		durationMs: 12,
		state: "success",
		summary: "Read 1 file",
	});

	expect(Object.isFrozen(running)).toBe(true);
	expect(settled).toBeDefined();
	if (!settled) throw new Error("Expected the activity to settle");
	expect(Object.isFrozen(settled)).toBe(true);
	expect(Object.isFrozen(settled.detailLines)).toBe(true);
	expect(() => {
		(settled as unknown as { summary: string }).summary = "tampered";
	}).toThrow();
	expect(() => {
		(settled.detailLines as unknown as string[]).push("tampered");
	}).toThrow();
	expect(store.get("call-1")?.summary).toBe("Read 1 file");
});
