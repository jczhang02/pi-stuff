import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getArtifactPaths,
	getArtifactsDir,
	getProjectArtifactsDir,
	maintainAgentArtifacts,
} from "../../packages/pi-stuff-agents/src/shared/artifacts.js";
import { DEFAULT_ARTIFACT_CONFIG, TEMP_ARTIFACTS_DIR } from "../../packages/pi-stuff-agents/src/shared/types.js";

const temporaryDirectories: string[] = [];

function writeArtifactGroup(
	directory: string,
	runId: string,
	state: "complete" | "failed" | "running",
	now: number,
): { inputPath: string; metadataPath: string } {
	const paths = getArtifactPaths(directory, runId, "general-purpose");
	writeFileSync(paths.inputPath, runId);
	writeFileSync(
		paths.metadataPath,
		JSON.stringify({ state, runId, agent: "general-purpose", ...(state === "running" ? {} : { exitCode: 0 }) }),
	);
	const oldDate = new Date(now - 8 * 24 * 60 * 60 * 1_000);
	utimesSync(paths.inputPath, oldDate, oldDate);
	utimesSync(paths.metadataPath, oldDate, oldDate);
	return paths;
}

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
		const oldGroup = writeArtifactGroup(artifacts, "aaaaaaaaaaaa", "complete", Date.now());
		const old = oldGroup.inputPath;
		const fresh = join(artifacts, "fresh.jsonl");
		const outside = join(root, "outside.txt");
		const linked = join(artifacts, "linked.txt");
		const tempOldGroup = writeArtifactGroup(tempArtifacts, "bbbbbbbbbbbb", "failed", Date.now());
		const tempOld = tempOldGroup.inputPath;
		writeFileSync(fresh, "fresh");
		writeFileSync(outside, "outside");
		symlinkSync(outside, linked);
		const now = Date.now();
		const oldDate = new Date(now - 8 * 24 * 60 * 60 * 1_000);
		for (const file of [old, oldGroup.metadataPath, tempOld, tempOldGroup.metadataPath])
			utimesSync(file, oldDate, oldDate);

		const report = await maintainAgentArtifacts(7, { sessionsRoot, tempArtifactsDir: tempArtifacts, now });

		expect(report).toMatchObject({ directoriesInspected: 2, filesRemoved: 4, scanComplete: true });
		expect(report.bytesReclaimed).toBeGreaterThan(0);
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
		for (let index = 0; index < 4; index += 1)
			writeArtifactGroup(artifacts, `${String(index).repeat(12)}`, "complete", now);

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
			return writeArtifactGroup(directory, name.repeat(12), "complete", now).inputPath;
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

		expect(first.filesRemoved).toBe(2);
		expect(second.filesRemoved).toBe(2);
		expect(files.every((file) => !existsSync(file))).toBeTrue();
	});

	test("preserves old artifacts for a child whose metadata still says running", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-active-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const artifacts = join(sessionsRoot, "project", "subagent-artifacts");
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(artifacts, { recursive: true });
		mkdirSync(tempArtifacts);
		const now = Date.now();
		const active = writeArtifactGroup(artifacts, "cccccccccccc", "running", now);

		const report = await maintainAgentArtifacts(7, { sessionsRoot, tempArtifactsDir: tempArtifacts, now });

		expect(report.filesRemoved).toBe(0);
		expect(existsSync(active.inputPath)).toBeTrue();
		expect(existsSync(active.metadataPath)).toBeTrue();
	});

	test("advances past a retained prefix during repeated bounded scans", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-cursor-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const artifacts = join(sessionsRoot, "project", "subagent-artifacts");
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(artifacts, { recursive: true });
		mkdirSync(tempArtifacts);
		const now = Date.now();
		for (const runId of ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"])
			writeArtifactGroup(artifacts, runId, "running", now);
		const terminal = writeArtifactGroup(artifacts, "zzzzzzzzzzzz", "complete", now);

		for (let attempt = 0; attempt < 8 && existsSync(terminal.inputPath); attempt += 1) {
			await maintainAgentArtifacts(7, { sessionsRoot, tempArtifactsDir: tempArtifacts, now, maxEntries: 2 });
		}

		expect(existsSync(terminal.inputPath)).toBeFalse();
		expect(existsSync(terminal.metadataPath)).toBeFalse();
	});

	test("uses one code-unit ordering for mixed-case cleanup cursors", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-case-cursor-"));
		temporaryDirectories.push(root);
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(tempArtifacts);
		const now = Date.now();
		writeArtifactGroup(tempArtifacts, "aaaaaaaaaaaa", "running", now);
		const terminal = writeArtifactGroup(tempArtifacts, "BBBBBBBBBBBB", "complete", now);

		for (let attempt = 0; attempt < 4 && existsSync(terminal.inputPath); attempt += 1) {
			await maintainAgentArtifacts(7, {
				sessionsRoot: join(root, "missing-sessions"),
				tempArtifactsDir: tempArtifacts,
				now,
				maxEntries: 1,
			});
		}

		expect(existsSync(terminal.inputPath)).toBeFalse();
		expect(existsSync(terminal.metadataPath)).toBeFalse();
	});

	test("persists a discovery frontier across deeply bounded session-tree passes", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-discovery-frontier-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(sessionsRoot);
		mkdirSync(tempArtifacts);
		const now = Date.now();
		const files = ["a", "b", "c"].map((name) => {
			const directory = join(sessionsRoot, name, "nested", "subagent-artifacts");
			mkdirSync(directory, { recursive: true });
			return writeArtifactGroup(directory, name.repeat(12), "complete", now).inputPath;
		});

		for (let attempt = 0; attempt < 20 && files.some((file) => existsSync(file)); attempt += 1) {
			await maintainAgentArtifacts(7, {
				sessionsRoot,
				tempArtifactsDir: tempArtifacts,
				now,
				maxDirectories: 1,
				maxEntries: 2,
			});
		}

		expect(files.every((file) => !existsSync(file))).toBeTrue();
	});
});
