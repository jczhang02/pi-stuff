import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
	loadSessionBatch,
	resolveDeferredSessionNames,
	scanCurrentSessions,
} from "../../packages/pi-stuff/src/fast-resume/scanner.js";
import type { SessionFileMeta } from "../../packages/pi-stuff/src/fast-resume/session.js";

interface HeaderLine {
	readonly cwd: string;
	readonly id: string;
	readonly timestamp: string;
	readonly type: "session";
	readonly version: number;
}

interface MessageLine {
	readonly message: { readonly content: string; readonly role: "user" };
	readonly timestamp: string;
	readonly type: "message";
}

interface InfoLine {
	readonly name: string;
	readonly type: "session_info";
}

type SessionLine = HeaderLine | InfoLine | MessageLine;

function line(value: SessionLine): string {
	return `${JSON.stringify(value)}\n`;
}

function writeSession(dir: string, id: string, cwd: string, message: string, suffix = ""): string {
	const path = join(dir, `${id}.jsonl`);
	writeFileSync(
		path,
		line({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd }) +
			line({ type: "message", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: message } }) +
			suffix,
	);
	return path;
}

describe("Fast Resume scanner", () => {
	test("handles empty, single, and exact initial-page Session sets", async () => {
		for (const count of [0, 1, 30]) {
			const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-boundary-"));
			try {
				for (let index = 0; index < count; index += 1) writeSession(dir, String(index), dir, "hello");
				const result = await Effect.runPromise(scanCurrentSessions(dir, dir, true));
				expect(result.initial).toHaveLength(count);
				expect(result.remaining).toHaveLength(0);
			} finally {
				rmSync(dir, { force: true, recursive: true });
			}
		}
	});

	test("loads the newest 30 current Sessions and leaves the remainder for batches", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-scan-"));
		try {
			for (let index = 0; index < 31; index += 1) {
				const path = writeSession(dir, String(index).padStart(2, "0"), "/repo", `message ${index}`);
				utimesSync(path, index + 1, index + 1);
			}
			const result = await Effect.runPromise(scanCurrentSessions(dir, "/repo", true));
			expect(result.initial).toHaveLength(30);
			expect(result.remaining).toHaveLength(1);
			expect(result.initial[0]?.id).toBe("30");
			expect(result.remaining[0]?.path).toEndWith("00.jsonl");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("fills the immediate Current page after filtering a shared Session directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-scan-"));
		try {
			for (let index = 0; index < 31; index += 1) {
				const path = writeSession(dir, `current-${String(index).padStart(2, "0")}`, "/repo", "current");
				utimesSync(path, index + 1, index + 1);
			}
			for (let index = 0; index < 5; index += 1) {
				const path = writeSession(dir, `other-${String(index)}`, "/other", "other");
				utimesSync(path, 100 + index, 100 + index);
			}
			const result = await Effect.runPromise(scanCurrentSessions(dir, "/repo", false));
			expect(result.initial).toHaveLength(30);
			expect(result.initial.every((item) => item.cwd === "/repo")).toBeTrue();
			expect(result.remaining).toHaveLength(1);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("preserves a first user line larger than the 16 KiB read chunk", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-scan-"));
		try {
			const message = "长".repeat(20_000);
			writeSession(dir, "large", dir, message);
			const result = await Effect.runPromise(scanCurrentSessions(dir, dir, true));
			expect(result.initial[0]?.firstMessage).toBe(message);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("filters a custom shared Session directory by cwd before display", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-scan-"));
		try {
			writeSession(dir, "kept", "/repo", "keep");
			writeSession(dir, "other", "/other", "hide");
			const result = await Effect.runPromise(scanCurrentSessions(dir, "/repo", false));
			expect(result.initial.map((item) => item.id)).toEqual(["kept"]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("resolves the latest bounded tail name after first paint", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-scan-"));
		try {
			const path = writeSession(dir, "named", dir, "hello", line({ type: "session_info", name: "Named Session" }));
			const result = await Effect.runPromise(scanCurrentSessions(dir, dir, true));
			const header = result.initial[0];
			expect(header).toBeDefined();
			if (!header) throw new Error("expected the named Session header");
			expect(header.name).toBeUndefined();
			const metas = new Map<string, SessionFileMeta>(result.all.map((meta) => [meta.path, meta]));
			const names = await Effect.runPromise(resolveDeferredSessionNames([header], metas));
			expect(names.get(path)).toBe("Named Session");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("skips corrupt files while loading a batch", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-scan-"));
		try {
			const good = writeSession(dir, "good", dir, "hello");
			const bad = join(dir, "bad.jsonl");
			writeFileSync(bad, "not json\n");
			const metas: SessionFileMeta[] = [good, bad].map((path) => ({
				path,
				size: Bun.file(path).size,
				mtimeMs: Date.now(),
			}));
			const headers = await Effect.runPromise(loadSessionBatch(metas));
			expect(headers.map((item) => item.id)).toEqual(["good"]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
