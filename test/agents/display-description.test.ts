import { describe, expect, test } from "bun:test";
import {
	compactAbsolutePaths,
	resolveDisplayDescription,
} from "../../packages/pi-stuff/src/subagents/src/shared/display-description.ts";

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

	test.each([
		["cwd:/Users/me/private/file.ts", "cwd:file.ts"],
		["path:C:\\Users\\me\\secret\\file.ts", "path:file.ts"],
		["See //cdn.example.test/assets/file.js", "See //cdn.example.test/assets/file.js"],
		["See https://example.test/a/b", "See https://example.test/a/b"],
	])("redacts absolute paths after token delimiters in %s", (value, expected) => {
		expect(compactAbsolutePaths(value)).toBe(expected);
	});

	test("preserves an explicit public description", () => {
		expect(resolveDisplayDescription("Docs: https://example.test/a/b", "/tmp/private.md")).toBe(
			"Docs: https://example.test/a/b",
		);
	});
});
