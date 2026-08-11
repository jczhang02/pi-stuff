import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	WEB_CONTENT_PRESENTATION,
	WEB_FETCH_PRESENTATION,
	WEB_SEARCH_PRESENTATION,
} from "../../packages/pi-stuff/src/web/presentation.js";
import { buildSearchErrorPlan } from "../../packages/pi-stuff/src/web/runtime/render-search-error.js";

function result(details: Record<string, unknown>): AgentToolResult<unknown> {
	return { content: [{ type: "text", text: "fixture" }], details };
}

describe("Web Tool presentation", () => {
	test("bounds error detail previews by terminal cells", () => {
		const plan = buildSearchErrorPlan({
			cancelled: true,
			error: `\u001b[31m${"失败".repeat(200)}\u001b[0m`,
			queryCount: 1,
			cancelledQueries: [{ error: "网络".repeat(100), provider: "fixture", query: "😀".repeat(31), resultCount: 0 }],
			extraLines: ["界".repeat(200)],
		});
		expect(plan).not.toBeNull();
		for (const line of plan?.expanded ?? []) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(302);
			expect(line).not.toContain("\u001b");
		}
		expect(plan?.expanded.some((line) => line.includes("…"))).toBeTrue();
	});

	test("marks an all-query search failure as failed without requiring a top-level error", () => {
		const failed = result({ queryCount: 2, successfulQueries: 0, totalResults: 0 });
		expect(WEB_SEARCH_PRESENTATION.resultIsError?.({}, failed)).toBe(true);
		expect(WEB_SEARCH_PRESENTATION.summarize?.({}, failed, "error", undefined)).toBe("failed");

		const partial = result({ queryCount: 2, successfulQueries: 1, totalResults: 3 });
		expect(WEB_SEARCH_PRESENTATION.resultIsError?.({}, partial)).toBe(false);
		expect(WEB_SEARCH_PRESENTATION.summarize?.({}, partial, "success", undefined)).toBe("1/2 queries · 3 sources");
	});

	test("marks an all-URL fetch failure while preserving empty continuation results", () => {
		const failed = result({ successful: 0, urlCount: 2 });
		expect(WEB_FETCH_PRESENTATION.resultIsError?.({}, failed)).toBe(true);
		expect(WEB_FETCH_PRESENTATION.summarize?.({}, failed, "error", undefined)).toBe("failed");

		const empty = result({ resultCount: 0 });
		expect(WEB_CONTENT_PRESENTATION.resultIsError?.({}, empty)).toBe(false);
		expect(WEB_CONTENT_PRESENTATION.summarize?.({}, empty, "success", undefined)).toBe("0 sources");
	});
});
