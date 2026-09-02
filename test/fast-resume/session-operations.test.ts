import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { deleteSessionFile, renameSessionFile } from "../../packages/pi-stuff/src/fast-resume/session-operations.js";

function sessionFile(dir: string, name = "session.jsonl"): string {
	const path = join(dir, name);
	writeFileSync(
		path,
		`${JSON.stringify({
			type: "session",
			version: 3,
			id: "session-id",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: dir,
		})}\n`,
	);
	return path;
}

describe("Fast Resume Session mutations", () => {
	test("renames through Pi Session metadata", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-rename-"));
		try {
			const path = sessionFile(dir);
			await Effect.runPromise(renameSessionFile(path, "Renamed Session"));
			const entries = readFileSync(path, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(entries.at(-1)).toMatchObject({ type: "session_info", name: "Renamed Session" });
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("falls back to permanent unlink when trash is unavailable", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-delete-"));
		try {
			const path = sessionFile(dir);
			const result = await Effect.runPromise(
				deleteSessionFile(path, { trashExecutable: join(dir, "missing-trash") }),
			);
			expect(result).toEqual({ ok: true, method: "unlink" });
			expect(existsSync(path)).toBeFalse();
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("reports a bounded failure when neither deletion route succeeds", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-delete-"));
		try {
			const result = await Effect.runPromise(
				deleteSessionFile(dir, { trashExecutable: join(dir, "missing-trash") }),
			);
			expect(result).toEqual({ ok: false, error: "trash and permanent deletion failed", method: "unlink" });
			expect(existsSync(dir)).toBeTrue();
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
