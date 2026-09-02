import { describe, expect, test } from "bun:test";
import {
	buildSessionTree,
	buildTreePrefix,
	filterAndSortSessions,
	flattenSessionTree,
	parseSearchQuery,
} from "../../packages/pi-stuff/src/fast-resume/search.js";
import type { SessionHeader } from "../../packages/pi-stuff/src/fast-resume/session.js";

function session(id: string, options: Partial<SessionHeader> = {}): SessionHeader {
	return {
		cwd: "/repo",
		firstMessage: "fix oauth callback",
		id,
		messageCount: 1,
		modified: new Date("2026-01-01T00:00:00.000Z"),
		path: `/sessions/${id}.jsonl`,
		created: new Date("2026-01-01T00:00:00.000Z"),
		...options,
	};
}

describe("Fast Resume search", () => {
	test("parses fuzzy, phrase, regex, and malformed queries", () => {
		expect(parseSearchQuery('oauth "callback route"').tokens).toEqual([
			{ kind: "fuzzy", value: "oauth" },
			{ kind: "phrase", value: "callback route" },
		]);
		expect(parseSearchQuery("re:^session").regex?.source).toBe("^session");
		expect(parseSearchQuery("re:[").error).toBeTruthy();
		expect(parseSearchQuery('"unclosed phrase').tokens).toEqual([
			{ kind: "fuzzy", value: '"unclosed' },
			{ kind: "fuzzy", value: "phrase" },
		]);
	});

	test("searches only id, name, cwd, and first user message", () => {
		const sessions = [
			session("alpha", { name: "Release plan" }),
			session("beta", { cwd: "/repo/payments", firstMessage: "database migration" }),
		];
		expect(filterAndSortSessions(sessions, '"release plan"', "relevance").map((item) => item.id)).toEqual(["alpha"]);
		expect(filterAndSortSessions(sessions, "re:payments", "relevance").map((item) => item.id)).toEqual(["beta"]);
		expect(filterAndSortSessions(sessions, "oauth", "recent").map((item) => item.id)).toEqual(["alpha"]);
		expect(filterAndSortSessions(sessions, "", "recent", "named").map((item) => item.id)).toEqual(["alpha"]);
	});

	test("keeps recent input order and relevance tie-breaks by modification time", () => {
		const older = session("older", { firstMessage: "token", modified: new Date("2025-01-01T00:00:00Z") });
		const newer = session("newer", { firstMessage: "token", modified: new Date("2026-01-01T00:00:00Z") });
		expect(filterAndSortSessions([older, newer], "token", "recent").map((item) => item.id)).toEqual([
			"older",
			"newer",
		]);
		expect(filterAndSortSessions([older, newer], "token", "relevance").map((item) => item.id)).toEqual([
			"newer",
			"older",
		]);
	});

	test("builds a threaded tree from canonical parent paths", () => {
		const parent = session("parent", { canonicalPath: "/real/parent", modified: new Date("2025-01-01T00:00:00Z") });
		const child = session("child", {
			parentSessionCanonicalPath: "/real/parent",
			modified: new Date("2026-01-01T00:00:00Z"),
		});
		const flat = flattenSessionTree(buildSessionTree([child, parent]));
		expect(flat.map((node) => node.session.id)).toEqual(["parent", "child"]);
		const childNode = flat[1];
		expect(childNode).toBeDefined();
		if (!childNode) throw new Error("expected a child tree node");
		expect(buildTreePrefix(childNode)).toBe("   └─ ");
	});
});
