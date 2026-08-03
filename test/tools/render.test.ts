import { describe, expect, test } from "bun:test";
import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ToolActivityStore } from "../../packages/pi-stuff-tools/activity-store.js";
import {
	buildToolDetailLines,
	CachedToolRow,
	capDetailLines,
	classifyTerminalState,
	describeBuiltinTarget,
	oneLine,
	sanitizeTerminalText,
	summarizeBuiltin,
} from "../../packages/pi-stuff-tools/render.js";

const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

function result(text: string, details?: unknown): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

describe("terminal-safe Tool rendering", () => {
	test("uses one-cell, optically coherent status glyphs", () => {
		const glyphs = [
			["running", "⦿"],
			["success", "⊛"],
			["error", "⊗"],
			["rejected", "⊘"],
			["cancelled", "⊖"],
		] as const;

		for (const [state, glyph] of glyphs) {
			const row = new CachedToolRow(theme, {
				durationMs: 0,
				label: "Tool",
				state,
				summary: "status",
				target: "",
			});
			expect(row.render(80)).toEqual([`${glyph} Tool · status`]);
			expect([...glyph]).toHaveLength(1);
			expect(visibleWidth(glyph)).toBe(1);
		}
	});

	test("removes ANSI, OSC, DCS, C0, and C1 protocols while preserving CJK", () => {
		const unsafe =
			"前\u001b[31m红\u001b[0m\u001b]0;OWNED_TITLE\u0007后\u001bPpayload\u001b\\\u009b32m绿\u0000\u009dC1_TITLE\u009c终\u202eABC\u2066DEF\u2069";
		const safe = sanitizeTerminalText(unsafe);

		expect(safe).toBe("前红后绿 终 ABC DEF ");
		expect(safe).not.toContain("\u001b");
		expect(safe).not.toContain("OWNED_TITLE");
		expect(safe).not.toContain("C1_TITLE");
		expect(safe).not.toMatch(/[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u);
		expect(oneLine("  工具\n\t结果  ")).toBe("工具 结果");
	});

	test("keeps the cap marker inside both the line and UTF-8 byte limits", () => {
		const capped = capDetailLines(
			Array.from({ length: 20 }, () => "工具结果-1234567890"),
			5,
			80,
		);

		expect(capped.length).toBeLessThanOrEqual(5);
		expect(Buffer.byteLength(capped.join("\n"))).toBeLessThanOrEqual(80);
		expect(capped.at(-1)).toContain("detail capped");
	});

	test("fits CJK rows and bounds the settled-width cache", () => {
		const row = new CachedToolRow(theme, {
			durationMs: 1,
			label: "Read",
			state: "success",
			summary: "完成",
			target: "目录/工具结果.txt",
		});

		for (let width = 12; width <= 18; width += 1) {
			const line = row.render(width)[0] ?? "";
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(row.computationCount).toBe(7);
		row.render(18);
		expect(row.computationCount).toBe(7);
		row.render(12);
		expect(row.computationCount).toBe(8);
	});

	test("bounds work and retained previews for multi-megabyte arguments and results", () => {
		let lateGetterReads = 0;
		const hugeArguments: Record<string, unknown> = { command: "x".repeat(8 * 1024 * 1024) };
		Object.defineProperty(hugeArguments, "late", {
			enumerable: true,
			get: () => {
				lateGetterReads += 1;
				return "should not be visited after the cap";
			},
		});
		const argumentDetails = buildToolDetailLines(hugeArguments, result("ok"));
		const resultDetails = buildToolDetailLines({}, result("y".repeat(8 * 1024 * 1024)));

		for (const details of [argumentDetails, resultDetails]) {
			expect(details.length).toBeLessThanOrEqual(240);
			expect(Buffer.byteLength(details.join("\n"))).toBeLessThanOrEqual(24 * 1024);
			expect(details.at(-1)).toContain("detail capped");
		}
		expect(lateGetterReads).toBe(0);
		expect(Buffer.byteLength(describeBuiltinTarget("bash", hugeArguments))).toBeLessThanOrEqual(4 * 1024);
		expect(
			Buffer.byteLength(
				describeBuiltinTarget("grep", { pattern: "p".repeat(8 * 1024 * 1024), path: "d".repeat(8 * 1024 * 1024) }),
			),
		).toBeLessThanOrEqual(4 * 1024);
	});
});

describe("Tool semantics", () => {
	test("classifies success, rejection, cancellation, and error honestly", () => {
		expect(classifyTerminalState(result("ok"), false)).toBe("success");
		expect(classifyTerminalState(result("[pi-stuff-permissions] blocked"), true)).toBe("rejected");
		expect(classifyTerminalState(result("Command aborted"), true)).toBe("cancelled");
		expect(classifyTerminalState(result("boom"), true)).toBe("error");
	});

	test("summarizes all seven certified Host built-ins", () => {
		expect(summarizeBuiltin("read", {}, result("one\ntwo"), "success", 0)).toBe("2 lines");
		expect(summarizeBuiltin("write", { content: "one\ntwo" }, result("ok"), "success", 0)).toBe("2 lines");
		expect(summarizeBuiltin("edit", {}, result("ok", { diff: "--- a\n+++ b\n-old\n+new" }), "success", 0)).toBe(
			"+1/-1",
		);
		expect(summarizeBuiltin("bash", {}, result("ok"), "success", 2_500)).toBe("done in 2s");
		expect(summarizeBuiltin("grep", {}, result("a.ts:1:x\nb.ts:2:x"), "success", 0)).toBe("2 matches in 2 files");
		expect(summarizeBuiltin("find", {}, result("a.ts\nb.ts"), "success", 0)).toBe("2 files");
		expect(summarizeBuiltin("ls", {}, result("a.ts"), "success", 0)).toBe("1 entry");
		expect(summarizeBuiltin("ls", {}, result("a.ts\nb.ts"), "success", 0)).toBe("2 entries");
		expect(describeBuiltinTarget("bash", { command: "echo 工具" })).toBe("echo 工具");
	});

	test("bounds the current-session activity projection in long sessions", () => {
		const store = new ToolActivityStore(3);
		for (let index = 0; index < 1_000; index += 1) {
			const id = `tool-${String(index)}`;
			store.begin({ id, label: "Read", name: "read", target: `${String(index)}.txt` });
			store.settle(id, { detailLines: ["ok"], durationMs: 1, state: "success", summary: "1 line" });
		}

		expect(store.list()).toHaveLength(3);
		expect(store.list().map((activity) => activity.id)).toEqual(["tool-999", "tool-998", "tool-997"]);
	});
});
