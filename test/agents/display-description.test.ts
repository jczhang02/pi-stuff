import { describe, expect, test } from "bun:test";
import { resolveDisplayDescription } from "../../packages/pi-stuff/src/subagents/src/shared/display-description.ts";

describe("Agent display descriptions", () => {
	test.each([
		["Review /Users/me/private/file.ts", "Review file.ts"],
		["Review C:\\Users\\me\\secret\\file.ts", "Review file.ts"],
		["Review C:/Users/me/secret/file.ts", "Review file.ts"],
		["Review \\\\server\\share\\secret.txt", "Review secret.txt"],
		["See https://example.test/a/b", "See https://example.test/a/b"],
		["Review repo/src/index.ts", "Review repo/src/index.ts"],
		["Use input/output prose", "Use input/output prose"],
		["Compare ./src/a.ts with ../src/b.ts", "Compare ./src/a.ts with ../src/b.ts"],
		["See https://x.test/a and /tmp/private/b.ts", "See https://x.test/a and b.ts"],
	])("redacts only private absolute path tokens in %s", (task, expected) => {
		expect(resolveDisplayDescription(undefined, task)).toBe(expected);
	});

	test("preserves an explicit public description", () => {
		expect(resolveDisplayDescription("Docs: https://example.test/a/b", "/tmp/private.md")).toBe(
			"Docs: https://example.test/a/b",
		);
	});
});
