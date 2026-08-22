import { describe, expect, test } from "bun:test";
import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ToolActivityStore } from "../../packages/pi-stuff/src/tool-display/activity-store.js";
import {
	buildToolDetailLines,
	CachedToolRow,
	capDetailLines,
	classifyTerminalState,
	describeBuiltinTarget,
	oneLine,
	sanitizeTerminalText,
	summarizeBuiltin,
} from "../../packages/pi-stuff/src/tool-display/render.js";

type ToolResultDetails = AgentToolResult<unknown>["details"];

interface HugeArguments {
	command: string;
	late?: string;
}

// SAFETY: this test fixture implements the exact Host surface exercised by this case.
const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as Theme;

function result(text: string, details?: ToolResultDetails): AgentToolResult<ToolResultDetails> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function isWellFormed(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return false;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return false;
	}
	return true;
}

function hasRecognizableTruncatedTarget(line: string): boolean {
	const marker = " • Bash ";
	const outcome = " · done";
	if (!line.startsWith(marker) || !line.endsWith(outcome)) return true;
	const target = line.slice(marker.length, -outcome.length);
	if (!target.endsWith("…")) return true;
	const prefix = target.slice(0, -1).trimEnd();
	if (prefix.endsWith("/")) return true;
	const unit = prefix.match(/[^\s/|&;,:=()[\]{}<>]+$/u)?.[0] ?? "";
	const semantic = unit.match(/[\p{L}\p{N}\p{Extended_Pictographic}]/gu) ?? [];
	const compact =
		semantic.length > 0 && semantic.every((value) => /[\p{Script=Han}\p{Extended_Pictographic}]/u.test(value));
	return semantic.length >= (compact ? 2 : 3);
}

describe("terminal-safe Tool rendering", () => {
	test("keeps one fixed dot slot and semantic colors across lifecycle states", () => {
		const states = [
			["running", "muted"],
			["success", "success"],
			["error", "error"],
			["rejected", "warning"],
			["cancelled", "warning"],
		] as const;

		for (const [state, expectedColor] of states) {
			const markerColors: string[] = [];
			// SAFETY: this test fixture implements the exact Host surface exercised by this case.
			const recordingTheme = {
				bold: (value: string) => value,
				fg: (color: string, value: string) => {
					if (value === "•") markerColors.push(color);
					return value;
				},
			} as Theme;
			const row = new CachedToolRow(recordingTheme, {
				durationMs: 0,
				label: "Tool",
				state,
				summary: "status",
				target: "",
			});
			expect(row.render(80)).toEqual([" • Tool · status"]);
			expect(markerColors).toEqual([expectedColor]);
			expect([..."•"]).toHaveLength(1);
			expect(visibleWidth("•")).toBe(1);
		}

		const running = new CachedToolRow(theme, {
			durationMs: 0,
			label: "Tool",
			state: "running",
			summary: "status",
			target: "",
		});
		const visible = running.render(80)[0] ?? "";
		running.setMarkerVisible(false);
		const blank = running.render(80)[0] ?? "";
		expect(visible).toBe(" • Tool · status");
		expect(blank).toBe("   Tool · status");
		expect(visible.indexOf("Tool")).toBe(blank.indexOf("Tool"));

		const settled = new CachedToolRow(theme, {
			durationMs: 0,
			label: "Tool",
			state: "success",
			summary: "done",
			target: "",
		});
		settled.setMarkerVisible(false);
		expect(settled.render(80)).toEqual([" • Tool · done"]);
	});

	test("renders compact activity summaries without raw Tool chrome", () => {
		const stoppedMarkerColors: string[] = [];
		const stopped = new CachedToolRow(
			// SAFETY: this test fixture implements the exact Host surface exercised by this case.
			{
				bold: (value: string) => value,
				fg: (color: string, value: string) => {
					if (value === "•") stoppedMarkerColors.push(color);
					return value;
				},
			} as Theme,
			{
				active: false,
				expandable: false,
				hint: "",
				kind: "activity",
				outcome: "stopped",
				summary: "Agent stopped",
			},
		);
		expect(stopped.render(54)).toEqual([" • Agent stopped"]);
		expect(stoppedMarkerColors).toEqual(["dim"]);

		const active = new CachedToolRow(theme, {
			active: true,
			expandable: true,
			hint: "Running focused checks in packages/pi-stuff/src/tool-display",
			kind: "activity",
			outcome: "running",
			summary: "Changing 2 files, running 3 commands, reading 4 files",
		});
		expect(active.render(54)).toEqual([
			" • Changing 2 files, running 3 commands, reading 4",
			"   files…  (ctrl+o to expand)",
			"   ⎿ Running focused checks in",
			"     packages/pi-stuff/src/tool-display",
		]);
		active.setMarkerVisible(false);
		expect(active.render(54)[0]).toStartWith("   Changing");

		const settled = new CachedToolRow(theme, {
			active: false,
			expandable: true,
			hint: "",
			kind: "activity",
			outcome: "success",
			summary: "Changed 2 files, ran 3 commands",
		});
		expect(settled.render(80)).toEqual([" • Changed 2 files, ran 3 commands  (ctrl+o to expand)"]);
	});

	test("renders each Bash call as one Claude-style operation with bounded child output", () => {
		const settled = new CachedToolRow(theme, {
			active: false,
			command: "rg -n 'durationMs' packages/pi-stuff/src",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: [
				"contract.ts:2131: durationMs",
				"contract.ts:2159: durationMs",
				"third",
				"fourth",
				"fifth",
				"sixth",
			].join("\n"),
			state: "success",
		});
		expect(settled.render(100)).toEqual([
			" • Bash(rg -n 'durationMs' packages/pi-stuff/src)",
			"  ⎿  contract.ts:2131: durationMs",
			"     contract.ts:2159: durationMs",
			"     third",
			"     … +3 lines (ctrl+o to expand)",
		]);

		const running = new CachedToolRow(theme, {
			active: true,
			command: "printf 'first\\nsecond\\n' && sleep 1",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "first\nsecond",
			state: "running",
		});
		expect(running.render(80)).toEqual([
			" • Bash(printf 'first\\nsecond\\n' && sleep 1)",
			"  ⎿  first",
			"     second",
		]);
		running.setMarkerVisible(false);
		expect(running.render(80)[0]).toStartWith("   Bash(");
	});

	test("renders Claude-style Bash no-output and explicit failure states", () => {
		const noOutput = new CachedToolRow(theme, {
			active: false,
			command: "true",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "(no output)",
			state: "success",
		});
		expect(noOutput.render(80)).toEqual([" • Bash(true)", "  ⎿  (No output)"]);

		const running = new CachedToolRow(theme, {
			active: true,
			command: "sleep 30",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "",
			state: "running",
		});
		expect(running.render(80)).toEqual([" • Bash(sleep 30)", "  ⎿  Running…"]);

		const failed = new CachedToolRow(theme, {
			active: false,
			command: "printf 'boom\\n' >&2; exit 7",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "boom\n\nCommand exited with code 7",
			state: "error",
		});
		expect(failed.render(80)).toEqual([
			" • Bash(printf 'boom\\n' >&2; exit 7)",
			"  ⎿  Error: Exit code 7",
			"     boom",
		]);

		const rejected = new CachedToolRow(theme, {
			active: false,
			command: "rm -rf generated",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "Tool execution was blocked by policy",
			state: "rejected",
		});
		expect(rejected.render(80)).toEqual([
			" • Bash(rm -rf generated)",
			"  ⎿  Rejected",
			"     Tool execution was blocked by policy",
		]);

		const cancelled = new CachedToolRow(theme, {
			active: false,
			command: "sleep 30",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "Command aborted",
			state: "cancelled",
		});
		expect(cancelled.render(80)).toEqual([" • Bash(sleep 30)", "  ⎿  Interrupted"]);

		const timedOut = new CachedToolRow(theme, {
			active: false,
			command: "curl https://example.invalid",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "partial stderr\nCommand timed out after 10 seconds",
			state: "error",
		});
		expect(timedOut.render(80)).toEqual([
			" • Bash(curl https://example.invalid)",
			"  ⎿  Error: Command timed out after 10 seconds",
			"     partial stderr",
		]);

		const longRejection = new CachedToolRow(theme, {
			active: false,
			command: "dangerous-command",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: ["policy", "scope", "owner", "reason", "remediation"].join("\n"),
			state: "rejected",
		});
		expect(longRejection.render(80).at(-1)).toBe("     … +3 lines (ctrl+o to expand)");
		longRejection.setModel({
			active: false,
			command: "rm -rf generated",
			expandable: true,
			expanded: true,
			kind: "bash-operation",
			output: ["policy", "scope", "owner", "reason", "remediation"].join("\n"),
			state: "rejected",
		});
		expect(longRejection.render(80)).toEqual([
			" • Bash(rm -rf generated)",
			"  ⎿  Rejected",
			"     policy",
			"     scope",
			"     owner",
			"     reason",
			"     remediation",
		]);
	});

	test("uses Claude-style semantic roles across a settled Bash operation", () => {
		const calls: Array<[string, string]> = [];
		// SAFETY: this test fixture implements the exact Host surface exercised by this case.
		const recordingTheme = {
			bold: (value: string) => value,
			fg: (color: string, value: string) => {
				calls.push([color, value]);
				return value;
			},
		} as Theme;
		const row = new CachedToolRow(recordingTheme, {
			active: false,
			command: "seq 1 5",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "1\n2\n3\n4\n5",
			state: "success",
		});

		row.render(80);
		expect(calls).toContainEqual(["muted", "  ⎿  "]);
		expect(calls).toContainEqual(["text", "1"]);
		expect(calls).toContainEqual(["text", "2"]);
		expect(calls).toContainEqual(["text", "3"]);
		expect(calls).toContainEqual(["dim", "… +2 lines (ctrl+o to expand)"]);
	});

	test("caps Bash commands to Claude's two-line and 160-character call preview", () => {
		const row = new CachedToolRow(theme, {
			active: false,
			command: `first line\nsecond line\n${"x".repeat(200)}`,
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "ok",
			state: "success",
		});
		const rendered = row.render(48);
		expect(rendered.slice(0, 2)).toEqual([" • Bash(first line", "      second line…)"]);
		expect(rendered.at(2)).toBe("  ⎿  ok");
		expect(rendered.every((line) => visibleWidth(line) <= 48)).toBe(true);
	});

	test("restores the bounded full Bash command and output when expanded", () => {
		const row = new CachedToolRow(theme, {
			active: false,
			command: "printf 'first\nsecond\nthird\n'",
			expandable: true,
			expanded: true,
			kind: "bash-operation",
			output: "1\n2\n3\n4\n5",
			state: "success",
		});

		expect(row.render(80)).toEqual([
			" • Bash(printf 'first",
			"      second",
			"      third",
			"      ')",
			"  ⎿  1",
			"     2",
			"     3",
			"     4",
			"     5",
		]);
	});

	test("wraps long Bash titles and output at their Claude child origins", () => {
		const row = new CachedToolRow(theme, {
			active: false,
			command: "printf_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
			state: "success",
		});

		expect(row.render(64)).toEqual([
			" • Bash(printf_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVW",
			"      XYZ0123456789)",
			"  ⎿  abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
			"     789",
		]);
	});

	test("bounds retained Bash output before deriving its compact preview", () => {
		const row = new CachedToolRow(theme, {
			active: false,
			command: "printf huge-output",
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: `${"输出".repeat(32 * 1024)}\nSHOULD_NOT_BE_RETAINED`,
			state: "success",
		});
		const rendered = row.render(64);

		expect(rendered[0]).toBe(" • Bash(printf huge-output)");
		expect(rendered.join("\n")).not.toContain("SHOULD_NOT_BE_RETAINED");
		expect(rendered.every((line) => visibleWidth(line) <= 64)).toBe(true);
	});

	test("bounds long Bash command work before deriving its two-line preview", () => {
		const row = new CachedToolRow(theme, {
			active: false,
			command: `${"echo x; ".repeat(32 * 1024)}SHOULD_NOT_BE_SCANNED`,
			expandable: true,
			expanded: false,
			kind: "bash-operation",
			output: "ok",
			state: "success",
		});
		const rendered = row.render(64);

		expect(rendered[0]).toStartWith(" • Bash(echo x;");
		expect(rendered.join("\n")).not.toContain("SHOULD_NOT_BE_SCANNED");
		expect(rendered.every((line) => visibleWidth(line) <= 64)).toBe(true);
	});

	test("colors Activity Group markers by effective outcome", () => {
		for (const [outcome, expectedColor] of [
			["running", "muted"],
			["success", "success"],
			["warning", "warning"],
			["error", "error"],
		] as const) {
			const colors: string[] = [];
			// SAFETY: this test fixture implements the exact Host surface exercised by this case.
			const recordingTheme = {
				bold: (value: string) => value,
				fg: (color: string, value: string) => {
					if (value === "•") colors.push(color);
					return value;
				},
			} as Theme;
			const row = new CachedToolRow(recordingTheme, {
				active: outcome === "running",
				expandable: true,
				hint: "",
				kind: "activity",
				outcome,
				summary: "Activity result",
			});
			expect(row.render(80)[0]).toStartWith(" • ");
			expect(colors).toEqual([expectedColor]);
		}
	});

	test("bounds activity hints to two rows and keeps issue markers visible", () => {
		const row = new CachedToolRow(theme, {
			active: false,
			expandable: true,
			hint: "x".repeat(1_000),
			kind: "activity",
			outcome: "error",
			summary: "Ran 8 commands · 1 failed",
		});
		const rendered = row.render(40);
		expect(rendered[0]).toStartWith(" • Ran 8 commands · 1 failed");
		expect(rendered.filter((line) => line.includes("⎿") || line.startsWith("     x"))).toHaveLength(2);
		expect(rendered.every((line) => visibleWidth(line) <= 40)).toBe(true);
	});

	test("removes ANSI, OSC, DCS, C0, and C1 protocols while preserving CJK", () => {
		const unsafe =
			"前\u001b[31m红\u001b[0m\u001b]0;OWNED_TITLE\u0007后\u001bPpayload\u001b\\\u009b32m绿\u0000\u009dC1_TITLE\u009c终\u202eABC\u2066DEF\u2069";
		const safe = sanitizeTerminalText(unsafe);

		expect(safe).toBe("前红后绿 终ABCDEF");
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

	test("does not repaint a Tool row for invisible duration changes", () => {
		const row = new CachedToolRow(theme, {
			durationMs: 1,
			label: "Read",
			state: "running",
			summary: "reading",
			target: "sample.txt",
		});
		const initial = row.render(80);

		expect(
			row.setModel({
				durationMs: 2,
				label: "Read",
				state: "running",
				summary: "reading",
				target: "sample.txt",
			}),
		).toBe(false);
		expect(row.render(80)).toBe(initial);
		expect(row.computationCount).toBe(1);
	});

	test("keeps marker and label ahead of CJK target and summary at narrow widths", () => {
		const row = new CachedToolRow(theme, {
			durationMs: 1,
			label: "Read",
			state: "running",
			summary: "正在读取🙂",
			target: "目录/工具结果.txt",
		});

		for (let width = 1; width <= 24; width += 1) {
			const visible = row.render(width)[0] ?? "";
			expect(visibleWidth(visible)).toBeLessThanOrEqual(width);
			row.setMarkerVisible(false);
			const blank = row.render(width)[0] ?? "";
			expect(visibleWidth(blank)).toBeLessThanOrEqual(width);
			row.setMarkerVisible(true);
		}

		expect(row.render(8)[0]).toStartWith(" • Read");
		row.setMarkerVisible(false);
		expect(row.render(8)[0]).toStartWith("   Read");
		expect(row.render(8)[0]?.indexOf("Read")).toBe(3);
		row.setMarkerVisible(true);
		expect(row.render(4)[0]).toStartWith(" • ");
	});

	test("omits useless target fragments and keeps result metadata on a semantic boundary", () => {
		const rows = [
			new CachedToolRow(theme, {
				durationMs: 18_000,
				label: "Read",
				state: "success",
				summary: "done in 18s",
				target: "/tmp/pi-max-tools/session/sample.txt",
			}),
			new CachedToolRow(theme, {
				durationMs: 18_000,
				label: "Read",
				state: "success",
				summary: "完成🙂",
				target: "目录/很长的🧪工具结果/sample.txt",
			}),
		];

		for (const width of [100, 64, 48, 32, 24]) {
			for (const row of rows) {
				const line = row.render(width)[0] ?? "";
				const plain = Bun.stripANSI(line);
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(line).not.toContain("\n");
				expect(plain).not.toMatch(/…(?:done|完成)/u);
				if (plain.includes("…") && plain.includes("·")) expect(plain).toContain("… · ");
			}
		}

		expect(rows[0]?.render(24)).toEqual([" • Read · done in 18s"]);
		expect(Bun.stripANSI(rows[0]?.render(32)[0] ?? "")).toContain("… · done in 18s");
	});

	test("backs off punctuation-only and one-character target tails at adjacent widths", () => {
		const target = "pwd && printf '%s\\n' '--- files ---' && find . -maxdepth 2 -type f -printf '%P\\n' | sort";
		const row = new CachedToolRow(theme, {
			durationMs: 1,
			label: "Bash",
			state: "success",
			summary: "done",
			target,
		});

		for (const width of [100, 99, 98, 97, 96, 64, 48, 32, 24]) {
			const line = Bun.stripANSI(row.render(width)[0] ?? "");
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(line).toEndWith(" · done");
			expect(line).not.toMatch(/(?:\|\s*[\p{L}\p{N}]?|-[\p{L}\p{N}]?|'%[\p{L}\p{N}]?|\bpr)… · done$/u);
		}
	});

	test("keeps only recognizable Latin, path, shell, CJK, and emoji target units", () => {
		for (const target of [
			"complete | sort-command-that-keeps-going",
			"/tmp/prefix/partial-component-that-keeps-going",
			"printf '%single-character-fragment-that-keeps-going",
			"目录/很长的中文目标仍然继续",
			"🙂🙂🙂🙂🙂🙂",
		]) {
			const row = new CachedToolRow(theme, {
				durationMs: 1,
				label: "Bash",
				state: "success",
				summary: "done",
				target,
			});
			for (let width = 16; width <= 48; width += 1) {
				const line = Bun.stripANSI(row.render(width)[0] ?? "");
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(hasRecognizableTruncatedTarget(line)).toBe(true);
			}
		}
	});

	test("reserves recognizable results before truncating long Tool labels", () => {
		const rows = [
			new CachedToolRow(theme, {
				durationMs: 1,
				label: "Contact Supervisor",
				state: "running",
				summary: "running",
				target: "parent-agent",
			}),
			new CachedToolRow(theme, {
				durationMs: 1,
				label: "Structured Output",
				state: "success",
				summary: "done",
				target: "result.json",
			}),
			new CachedToolRow(theme, {
				durationMs: 1,
				label: "Contact Supervisor",
				state: "error",
				summary: "Command exited with code 7",
				target: "parent-agent",
			}),
			new CachedToolRow(theme, {
				durationMs: 1,
				label: "AnExtremelyLongCustomToolName",
				state: "running",
				summary: "running",
				target: "custom-target",
			}),
			new CachedToolRow(theme, {
				durationMs: 1,
				label: "X".repeat(22),
				state: "success",
				summary: "done",
				target: "",
			}),
		];

		for (const width of [32, 24]) {
			for (const row of rows) {
				const line = Bun.stripANSI(row.render(width)[0] ?? "");
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(line).toContain(" · ");
				expect(line).not.toMatch(/ · [rdw]…$/u);
			}
		}
		expect(rows[0]?.render(24)[0]).toEndWith(" · running");
		expect(rows[1]?.render(24)[0]).toEndWith(" · done");
		expect(rows[2]?.render(24)[0]).toContain(" · Command");
		expect(rows[3]?.render(24)[0]).toEndWith(" · running");
		expect(rows[4]?.render(24)[0]).toEndWith(" · done");
	});

	test("bounds work and retained previews for multi-megabyte arguments and results", () => {
		let lateGetterReads = 0;
		const hugeArguments: HugeArguments = { command: "x".repeat(8 * 1024 * 1024) };
		Object.defineProperty(hugeArguments, "late", {
			enumerable: true,
			get: () => {
				lateGetterReads += 1;
				return "should not be visited after the cap";
			},
		});
		const argumentDetails = buildToolDetailLines(hugeArguments, result("ok"));
		const resultDetails = buildToolDetailLines({}, result("y".repeat(8 * 1024 * 1024)));
		const unicodeDetails = buildToolDetailLines({ value: "👩‍💻".repeat(10_000) }, result("ok"));

		for (const details of [argumentDetails, resultDetails, unicodeDetails]) {
			expect(details.length).toBeLessThanOrEqual(240);
			expect(Buffer.byteLength(details.join("\n"))).toBeLessThanOrEqual(24 * 1024);
			expect(details.at(-1)).toContain("detail capped");
			expect(details.every(isWellFormed)).toBeTrue();
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
		expect(classifyTerminalState(result("Tool execution was blocked by the fixture"), true)).toBe("rejected");
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

	test("does not read successful Bash output just to produce its terminal summary", () => {
		let reads = 0;
		const content = {
			type: "text" as const,
			get text() {
				reads += 1;
				return "large output";
			},
		};
		expect(summarizeBuiltin("bash", {}, { content: [content], details: {} }, "success", undefined)).toBe("done");
		expect(reads).toBe(0);
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
