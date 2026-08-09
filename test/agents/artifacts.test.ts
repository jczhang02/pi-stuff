import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getArtifactsDir,
	getProjectArtifactsDir,
	maintainAgentArtifacts,
} from "../../packages/pi-stuff-agents/src/shared/artifacts.js";
import { DEFAULT_ARTIFACT_CONFIG, TEMP_ARTIFACTS_DIR } from "../../packages/pi-stuff-agents/src/shared/types.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Agent artifact location", () => {
	test("defaults persisted sessions to their Settings-owned project session directory", () => {
		const sessionFile = "/settings/sessions/project-a/root.jsonl";
		const artifacts = getArtifactsDir(sessionFile, "/workspace/project-a");

		expect(DEFAULT_ARTIFACT_CONFIG.dir).toBe("session");
		expect(artifacts).toBe("/settings/sessions/project-a/subagent-artifacts");
		expect(artifacts).not.toStartWith("/workspace/project-a");
	});

	test("never falls back into the workspace when no persisted session exists", () => {
		expect(getArtifactsDir(null, "/workspace/project-a")).toBe(TEMP_ARTIFACTS_DIR);
	});

	test("keeps session artifacts isolated by Pi project session root", () => {
		const first = getArtifactsDir("/settings/sessions/project-a/root.jsonl", "/workspace/project");
		const second = getArtifactsDir("/settings/sessions/project-b/root.jsonl", "/workspace/project");

		expect(first).not.toBe(second);
		expect(first).toBe(join("/settings/sessions/project-a", "subagent-artifacts"));
		expect(second).toBe(join("/settings/sessions/project-b", "subagent-artifacts"));
	});

	test("preserves the explicit project policy as an opt-in", () => {
		expect(getArtifactsDir("/settings/sessions/project/root.jsonl", "/workspace/project", "project")).toBe(
			getProjectArtifactsDir("/workspace/project"),
		);
	});
});

describe("Agent artifact maintenance", () => {
	test("finds nested session artifacts, removes only old regular files, and never follows symlinks", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const artifacts = join(sessionsRoot, "project", "2026", "08", "subagent-artifacts");
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(artifacts, { recursive: true });
		mkdirSync(tempArtifacts);
		const old = join(artifacts, "old.jsonl");
		const fresh = join(artifacts, "fresh.jsonl");
		const outside = join(root, "outside.txt");
		const linked = join(artifacts, "linked.txt");
		const tempOld = join(tempArtifacts, "old-output.md");
		writeFileSync(old, "old");
		writeFileSync(fresh, "fresh");
		writeFileSync(outside, "outside");
		writeFileSync(tempOld, "temp-old");
		symlinkSync(outside, linked);
		const now = Date.now();
		const oldDate = new Date(now - 8 * 24 * 60 * 60 * 1_000);
		for (const file of [old, tempOld]) utimesSync(file, oldDate, oldDate);

		const report = await maintainAgentArtifacts(7, { sessionsRoot, tempArtifactsDir: tempArtifacts, now });

		expect(report).toMatchObject({ directoriesInspected: 2, filesRemoved: 2, scanComplete: true });
		expect(report.bytesReclaimed).toBe(11);
		expect(existsSync(old)).toBeFalse();
		expect(existsSync(tempOld)).toBeFalse();
		expect(existsSync(fresh)).toBeTrue();
		expect(existsSync(linked)).toBeTrue();
		expect(existsSync(outside)).toBeTrue();
	});

	test("throttles complete directories and leaves an incomplete bounded scan eligible for retry", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-budget-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const artifacts = join(sessionsRoot, "nested", "subagent-artifacts");
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(artifacts, { recursive: true });
		mkdirSync(tempArtifacts);
		const now = Date.now();
		for (let index = 0; index < 4; index += 1) {
			const file = join(artifacts, `old-${String(index)}.txt`);
			writeFileSync(file, "x");
			const oldDate = new Date(now - 8 * 24 * 60 * 60 * 1_000);
			utimesSync(file, oldDate, oldDate);
		}

		const bounded = await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: tempArtifacts,
			now,
			maxEntries: 3,
		});
		expect(bounded.scanComplete).toBeFalse();
		expect(existsSync(join(artifacts, ".last-cleanup"))).toBeFalse();

		const complete = await maintainAgentArtifacts(7, { sessionsRoot, tempArtifactsDir: tempArtifacts, now });
		expect(complete.filesRemoved).toBeGreaterThan(0);
		expect(existsSync(join(artifacts, ".last-cleanup"))).toBeTrue();
		const throttled = await maintainAgentArtifacts(7, { sessionsRoot, tempArtifactsDir: tempArtifacts, now });
		expect(throttled.filesRemoved).toBe(0);
	});

	test("advances across bounded directory batches instead of rescanning the same prefix forever", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-batches-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(tempArtifacts, { recursive: true });
		const now = Date.now();
		const files = ["a", "b"].map((name) => {
			const directory = join(sessionsRoot, name, "subagent-artifacts");
			mkdirSync(directory, { recursive: true });
			const file = join(directory, "old.txt");
			writeFileSync(file, name);
			const oldDate = new Date(now - 8 * 24 * 60 * 60 * 1_000);
			utimesSync(file, oldDate, oldDate);
			return file;
		});

		const first = await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: tempArtifacts,
			now,
			maxDirectories: 1,
		});
		const second = await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: tempArtifacts,
			now,
			maxDirectories: 1,
		});

		expect(first.filesRemoved).toBe(1);
		expect(second.filesRemoved).toBe(1);
		expect(files.every((file) => !existsSync(file))).toBeTrue();
	});
});
