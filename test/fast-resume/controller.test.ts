import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
	type FastResumeSnapshot,
	prepareFastResumeController,
} from "../../packages/pi-stuff/src/fast-resume/controller.js";
import type { FastResumeOperationOwner } from "../../packages/pi-stuff/src/fast-resume/effect-owner.js";

function writeSession(dir: string, id: string, cwd: string, suffix = ""): string {
	const path = join(dir, `${id}.jsonl`);
	writeFileSync(
		path,
		JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd }) +
			"\n" +
			JSON.stringify({ type: "message", message: { role: "user", content: `message ${id}` } }) +
			"\n" +
			suffix,
	);
	return path;
}

function owner(): FastResumeOperationOwner {
	return {
		run: <A>(program: Effect.Effect<A, Error>) => Effect.runPromise(program),
		fork: (program: Effect.Effect<void, Error>, onSettled: (error?: Error) => void) => {
			let active = true;
			void Effect.runPromise(program).then(
				() => {
					if (active) onSettled();
				},
				(error) => {
					if (active) onSettled(error instanceof Error ? error : new Error(String(error)));
				},
			);
			return () => {
				active = false;
			};
		},
	};
}

async function until(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Fast Resume controller did not settle");
		await Bun.sleep(1);
	}
}

describe("Fast Resume controller", () => {
	test("shows the first 30, completes Current before All, and resolves names", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-controller-"));
		try {
			for (let index = 0; index < 31; index += 1) {
				const suffix = index === 30 ? `${JSON.stringify({ type: "session_info", name: "Newest" })}\n` : "";
				const path = writeSession(dir, `current-${index}`, "/repo", suffix);
				utimesSync(path, index + 2, index + 2);
			}
			const other = writeSession(dir, "other", "/other");
			utimesSync(other, 1, 1);
			const controller = await Effect.runPromise(
				prepareFastResumeController({
					cwd: "/repo",
					owner: owner(),
					sessionDir: dir,
					usesDefaultSessionDir: false,
				}),
			);
			expect(controller.snapshot().currentSessions).toHaveLength(30);
			const snapshots: FastResumeSnapshot[] = [];
			controller.subscribe((snapshot) => snapshots.push(snapshot));
			controller.start();
			await until(() => controller.snapshot().allLoading === false);
			expect(controller.snapshot().currentSessions).toHaveLength(31);
			expect(controller.snapshot().allSessions).toHaveLength(32);
			expect(controller.snapshot().currentSessions[0]?.name).toBe("Newest");
			const firstAll = snapshots.findIndex((snapshot) => snapshot.allProgress !== undefined);
			expect(firstAll).toBeGreaterThan(0);
			expect(snapshots[firstAll - 1]?.currentLoading).toBeFalse();
			controller.dispose();
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("publishes each 50-Session Current batch before starting All", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-controller-"));
		try {
			for (let index = 0; index < 131; index += 1) {
				const path = writeSession(dir, `current-${index}`, "/repo");
				utimesSync(path, index + 1, index + 1);
			}
			const controller = await Effect.runPromise(
				prepareFastResumeController({
					cwd: "/repo",
					owner: owner(),
					sessionDir: dir,
					usesDefaultSessionDir: false,
				}),
			);
			const lengths = new Set<number>();
			controller.subscribe((snapshot) => lengths.add(snapshot.currentSessions.length));
			controller.start();
			await until(() => controller.snapshot().currentLoading === false);
			expect([...lengths]).toEqual(expect.arrayContaining([30, 80, 130, 131]));
			controller.dispose();
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("refreshes the active scope after permanent deletion", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-controller-"));
		try {
			const path = writeSession(dir, "delete-me", dir);
			const controller = await Effect.runPromise(
				prepareFastResumeController({ cwd: dir, owner: owner(), sessionDir: dir, usesDefaultSessionDir: false }),
			);
			const result = await controller.delete(path, "current");
			expect(result.ok).toBeTrue();
			await until(() => controller.snapshot().currentLoading === false);
			expect(controller.snapshot().currentSessions).toEqual([]);
			controller.dispose();
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
