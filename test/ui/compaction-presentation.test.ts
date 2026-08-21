import { describe, expect, test } from "bun:test";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { suppressDuplicatedLiveCompactionReplay } from "../../packages/pi-stuff/src/conversation-ui/compaction-presentation.js";

function compactionEntry(id: string): SessionEntry {
	return {
		firstKeptEntryId: "kept",
		fromHook: true,
		id,
		parentId: "kept",
		summary: "Magic Context manages prior history.",
		timestamp: "2026-08-04T00:00:00Z",
		tokensBefore: 31_589,
		type: "compaction",
	} as SessionEntry;
}

function customEntry(id: string): SessionEntry {
	return {
		customType: "fixture",
		data: {},
		id,
		parentId: null,
		timestamp: "2026-08-04T00:00:00Z",
		type: "custom",
	} as SessionEntry;
}

describe("live compaction presentation", () => {
	test("hides only the matching leading replay and restores the Host method immediately", () => {
		const compact = compactionEntry("compact-1");
		const kept = customEntry("kept");
		let reads = 0;
		const manager = {
			buildContextEntries: () => {
				reads += 1;
				return [compact, kept];
			},
		} as ExtensionContext["sessionManager"];
		const original = manager.buildContextEntries;

		expect(suppressDuplicatedLiveCompactionReplay(manager, "compact-1")).toBe(true);
		expect(manager.buildContextEntries()).toEqual([kept]);
		expect(manager.buildContextEntries).toBe(original);
		expect(manager.buildContextEntries()).toEqual([compact, kept]);
		expect(reads).toBe(2);
	});

	test("preserves a nonmatching replay and fails open for an immutable Host", () => {
		const compact = compactionEntry("compact-older");
		const manager = {
			buildContextEntries: () => [compact],
		} as ExtensionContext["sessionManager"];
		expect(suppressDuplicatedLiveCompactionReplay(manager, "compact-new")).toBe(true);
		expect(manager.buildContextEntries()).toEqual([compact]);

		const immutable = Object.freeze({
			buildContextEntries: () => [compact],
		}) as ExtensionContext["sessionManager"];
		expect(suppressDuplicatedLiveCompactionReplay(immutable, "compact-older")).toBe(false);
		expect(immutable.buildContextEntries()).toEqual([compact]);
	});
});
