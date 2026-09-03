import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { loadAllSessions, loadCurrentSessions } from "../../packages/pi-stuff/src/fast-resume/scanner.js";
import { scanAllSessionDirs, scanSessionDir } from "../../packages/pi-stuff/src/fast-resume/scanner-native.js";
import { scanSessionInfoNames } from "../../packages/pi-stuff/src/fast-resume/session-reader-native.js";

interface SessionHeaderLine {
	readonly cwd: string;
	readonly id: string;
	readonly timestamp: string;
	readonly type: "session";
	readonly version: number;
}

interface SessionMessageLine {
	readonly message: { readonly content: string; readonly role: "user" };
	readonly timestamp: string;
	readonly type: "message";
}

interface SessionInfoLine {
	readonly name: string;
	readonly type: "session_info";
}

type SessionLine = SessionHeaderLine | SessionInfoLine | SessionMessageLine;

function line(value: SessionLine): string {
	return `${JSON.stringify(value)}\n`;
}

function writeSession(
	dir: string,
	id: string,
	cwd: string,
	message: string,
	suffix = "",
	messageTimestamp = "2026-01-01T00:00:01.000Z",
): string {
	const path = join(dir, `${id}.jsonl`);
	writeFileSync(
		path,
		line({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd }) +
			line({ type: "message", timestamp: messageTimestamp, message: { role: "user", content: message } }) +
			suffix,
	);
	return path;
}

describe("Fast Resume loaders", () => {
	test("loads, filters, sorts, and reports bounded Current batches", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-load-"));
		try {
			for (let index = 0; index < 131; index += 1) {
				const messageTimestamp = new Date(Date.parse("2026-01-01T00:00:01.000Z") + index * 1000).toISOString();
				const path = writeSession(dir, `current-${index}`, "/repo", `message ${index}`, "", messageTimestamp);
				utimesSync(path, index + 1, index + 1);
			}
			writeSession(dir, "other", "/other", "hidden");
			const progress: Array<[number, number]> = [];
			const sessions = await Effect.runPromise(
				loadCurrentSessions(dir, "/repo", (loaded, total) => progress.push([loaded, total])),
			);
			expect(sessions).toHaveLength(131);
			expect(sessions[0]?.id).toBe("current-130");
			expect(progress).toEqual([
				[50, 132],
				[100, 132],
				[132, 132],
			]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("reads a complete first message and the latest Session name", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-load-"));
		try {
			const message = "长".repeat(20_000);
			const followup = "searchable follow-up";
			const followupTimestamp = "2026-01-01T00:01:00.000Z";
			writeSession(
				dir,
				"named",
				dir,
				message,
				line({
					type: "message",
					timestamp: followupTimestamp,
					message: { role: "user", content: followup },
				}) + line({ type: "session_info", name: "Named Session" }),
			);
			const sessions = await Effect.runPromise(loadCurrentSessions(dir, dir));
			expect(sessions).toHaveLength(1);
			expect(sessions[0]).toMatchObject({
				allMessagesText: `${message} ${followup}`,
				firstMessage: message,
				messageCount: 2,
				modified: new Date(followupTimestamp),
				name: "Named Session",
			});
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe("Fast Resume Session names", () => {
	test("preserves the latest Session name outside the fixed tail window", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-load-"));
		try {
			const largeAssistant = `${JSON.stringify({
				type: "message",
				message: { role: "assistant", content: "x".repeat(2 * 1024 * 1024) },
			})}\n`;
			writeSession(
				dir,
				"named-middle",
				dir,
				"FIRST PROMPT",
				line({ type: "session_info", name: "Old Name" }) +
					line({ type: "session_info", name: "Session Name" }) +
					largeAssistant,
			);
			writeSession(
				dir,
				"cleared-middle",
				dir,
				"CLEARED PROMPT",
				line({ type: "session_info", name: "Old Name" }) +
					line({ type: "session_info", name: "" }) +
					largeAssistant,
			);
			const sessions = await Effect.runPromise(loadCurrentSessions(dir, dir));
			const byId = new Map(sessions.map((session) => [session.id, session]));
			expect(byId.get("named-middle")).toMatchObject({
				firstMessage: "FIRST PROMPT",
				name: "Session Name",
			});
			expect(byId.get("cleared-middle")).not.toHaveProperty("name");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("uses Pi's loader when exact name scan output exceeds its bound", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-load-"));
		try {
			const name = "n".repeat(8 * 1024 * 1024);
			writeSession(dir, "large-name", dir, "FIRST PROMPT", line({ type: "session_info", name }));
			expect(() => scanSessionInfoNames(scanSessionDir(dir))).toThrow("Could not scan Session names.");

			const sessions = await Effect.runPromise(loadCurrentSessions(dir, dir));
			expect(sessions[0]?.name?.length).toBe(name.length);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe("Fast Resume loader boundaries", () => {
	test("bounds forward reads while retaining Sessions without an early user message", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-load-"));
		try {
			const header = (id: string) =>
				line({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: dir });
			const largeAssistant = `${JSON.stringify({ type: "message", message: { role: "assistant", content: "x".repeat(2 * 1024 * 1024) } })}\n`;
			writeFileSync(
				join(dir, "late-user.jsonl"),
				header("late-user") +
					largeAssistant +
					line({
						type: "message",
						timestamp: "2026-01-01T00:00:01.000Z",
						message: { role: "user", content: "late message" },
					}),
			);
			writeFileSync(join(dir, "no-user.jsonl"), header("no-user") + largeAssistant);
			const sessions = await Effect.runPromise(loadCurrentSessions(dir, dir));
			expect(sessions.map((session) => session.id).sort()).toEqual(["late-user", "no-user"]);
			expect(sessions.map((session) => session.firstMessage)).toEqual(["(no messages)", "(no messages)"]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("discovers symlinked project directories like Pi listAll", () => {
		const parent = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-all-"));
		try {
			const sessions = join(parent, "sessions");
			const target = join(parent, "target");
			mkdirSync(sessions);
			mkdirSync(target);
			writeSession(target, "linked", "/repo", "linked");
			symlinkSync(target, join(sessions, "linked-project"), "dir");
			expect(scanAllSessionDirs(sessions).map((meta) => meta.path)).toEqual([
				join(sessions, "linked-project", "linked.jsonl"),
			]);
		} finally {
			rmSync(parent, { force: true, recursive: true });
		}
	});

	test("loads All from a custom directory and skips corrupt files", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-load-"));
		try {
			writeSession(dir, "first", "/repo", "first");
			writeSession(dir, "second", "/other", "second");
			writeFileSync(join(dir, "broken.jsonl"), "not json\n");
			const sessions = await Effect.runPromise(loadAllSessions(dir, false));
			expect(sessions.map((session) => session.id).sort()).toEqual(["first", "second"]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
