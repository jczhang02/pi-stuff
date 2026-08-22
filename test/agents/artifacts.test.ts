import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	getArtifactPaths,
	getArtifactsDir,
	getProjectArtifactsDir,
	maintainAgentArtifacts,
	withArtifactGroupWriteClaim,
} from "../../packages/pi-stuff/src/subagents/src/shared/artifacts.js";
import { shardedDurableClaimName } from "../../packages/pi-stuff/src/subagents/src/shared/durable-claim.js";
import { DEFAULT_ARTIFACT_CONFIG, TEMP_ARTIFACTS_DIR } from "../../packages/pi-stuff/src/subagents/src/shared/types.js";

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
		JSON.stringify(
			Object.assign({ state, runId, agent: "general-purpose" }, state === "running" ? undefined : { exitCode: 0 }),
		),
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

	test("does not let a retained session directory starve terminal temp artifacts", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-temp-fairness-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const artifacts = join(sessionsRoot, "a", "subagent-artifacts");
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(artifacts, { recursive: true });
		mkdirSync(tempArtifacts);
		const now = Date.now();
		for (let index = 0; index < 12; index += 1) {
			writeArtifactGroup(artifacts, `running${String(index).padStart(5, "0")}`, "running", now);
		}
		const terminal = writeArtifactGroup(tempArtifacts, "terminaltemp", "complete", now);

		await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: tempArtifacts,
			now,
			maxDirectories: 1,
			maxEntries: 3,
		});

		expect(existsSync(terminal.inputPath)).toBeFalse();
		expect(existsSync(terminal.metadataPath)).toBeFalse();
	});

	test("advances over mixed-case entries without relying on lexical cursor ordering", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-case-cursor-"));
		temporaryDirectories.push(root);
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(tempArtifacts);
		const now = Date.now();
		writeArtifactGroup(tempArtifacts, "aaaaaaaaaaaa", "running", now);
		const terminal = writeArtifactGroup(tempArtifacts, "BBBBBBBBBBBB", "complete", now);

		for (let attempt = 0; attempt < 8 && existsSync(terminal.inputPath); attempt += 1) {
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

	test("bounds construction of a wide discovery snapshot to the requested scan budget", async () => {
		if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) return;
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-bounded-snapshot-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		mkdirSync(sessionsRoot);
		for (let index = 0; index < 20; index += 1) {
			mkdirSync(join(sessionsRoot, `project-${String(index).padStart(2, "0")}`));
		}

		await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: join(root, "missing-temp"),
			maxDirectories: 1,
			maxEntries: 1,
		});

		const snapshotDirectory = join(sessionsRoot, ".artifact-cleanup-snapshots");
		const controls = readdirSync(snapshotDirectory);
		expect(controls.filter((name) => name.endsWith(".build.json"))).toHaveLength(1);
		expect(controls.filter((name) => name.endsWith(".partial"))).toHaveLength(1);
		expect(controls.filter((name) => /^[0-9a-f-]{36}\.jsonl$/u.test(name))).toHaveLength(0);
		const frontier = JSON.parse(readFileSync(join(sessionsRoot, ".artifact-cleanup-frontier"), "utf8"));
		expect(frontier.pending.some((frame: { building?: boolean }) => frame.building === true)).toBeTrue();
	});

	test("does not let a stale cleanup cursor skip a replacement snapshot", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-stale-cursor-"));
		temporaryDirectories.push(root);
		const tempArtifacts = join(root, "temp-artifacts");
		const control = join(tempArtifacts, ".artifact-cleanup-control");
		mkdirSync(control, { recursive: true, mode: 0o700 });
		chmodSync(control, 0o700);
		writeFileSync(
			join(control, ".cleanup-cursor"),
			JSON.stringify({ version: 2, offset: 999_999, snapshot: { dev: 0, ino: 0, mtimeMs: 0, size: 0 } }),
		);
		const now = Date.now();
		const terminal = writeArtifactGroup(tempArtifacts, "stalecursor00", "complete", now);

		await maintainAgentArtifacts(7, {
			sessionsRoot: join(root, "missing-sessions"),
			tempArtifactsDir: tempArtifacts,
			now,
		});

		expect(existsSync(terminal.inputPath)).toBeFalse();
		expect(existsSync(terminal.metadataPath)).toBeFalse();
	});

	test("skips an oversized malformed snapshot record without losing the next valid artifact", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-malformed-snapshot-"));
		temporaryDirectories.push(root);
		const tempArtifacts = join(root, "temp-artifacts");
		const control = join(tempArtifacts, ".artifact-cleanup-control");
		mkdirSync(control, { recursive: true, mode: 0o700 });
		chmodSync(control, 0o700);
		const now = Date.now();
		const terminal = writeArtifactGroup(tempArtifacts, "afterbadline", "complete", now);
		writeFileSync(
			join(control, ".cleanup-snapshot.jsonl"),
			`${"x".repeat(128 * 1024)}\n${JSON.stringify("afterbadline_general-purpose_meta.json")}\n`,
		);

		await maintainAgentArtifacts(7, {
			sessionsRoot: join(root, "missing-sessions"),
			tempArtifactsDir: tempArtifacts,
			now,
		});

		expect(existsSync(terminal.inputPath)).toBeFalse();
		expect(existsSync(terminal.metadataPath)).toBeFalse();
	});

	test("sweeps old orphan discovery snapshots but preserves a fresh possible writer", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-orphan-snapshot-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const snapshotDirectory = join(sessionsRoot, ".artifact-cleanup-snapshots");
		mkdirSync(snapshotDirectory, { recursive: true, mode: 0o700 });
		chmodSync(snapshotDirectory, 0o700);
		const oldSnapshot = join(snapshotDirectory, "00000000-0000-0000-0000-000000000001.jsonl");
		const freshSnapshot = join(snapshotDirectory, "00000000-0000-0000-0000-000000000002.jsonl");
		writeFileSync(oldSnapshot, "");
		writeFileSync(freshSnapshot, "");
		const now = Date.now();
		const oldDate = new Date(now - 2 * 60 * 60 * 1_000);
		utimesSync(oldSnapshot, oldDate, oldDate);

		await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: join(root, "missing-temp"),
			now,
		});

		expect(existsSync(oldSnapshot)).toBeFalse();
		expect(existsSync(freshSnapshot)).toBeTrue();
	});

	test("sweeps an orphan discovery snapshot beyond a large stable prefix", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-wide-discovery-control-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const snapshotDirectory = join(sessionsRoot, ".artifact-cleanup-snapshots");
		mkdirSync(snapshotDirectory, { recursive: true, mode: 0o700 });
		chmodSync(snapshotDirectory, 0o700);
		const now = Date.now();
		for (let index = 0; index < 300; index += 1) {
			writeFileSync(join(snapshotDirectory, `unknown-${String(index).padStart(3, "0")}`), "retained");
		}
		const orphan = join(snapshotDirectory, "00000000-0000-0000-0000-000000000007.jsonl");
		writeFileSync(orphan, '"stale"\n');
		const oldDate = new Date(now - 2 * 60 * 60 * 1_000);
		utimesSync(orphan, oldDate, oldDate);

		const report = await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: join(root, "missing-temp"),
			now,
		});

		expect(report.scanComplete).toBeTrue();
		expect(existsSync(orphan)).toBeFalse();
	});

	test("removes the snapshot referenced by a discovery frame whose directory disappeared", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-deleted-frontier-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const snapshotDirectory = join(sessionsRoot, ".artifact-cleanup-snapshots");
		mkdirSync(snapshotDirectory, { recursive: true, mode: 0o700 });
		chmodSync(snapshotDirectory, 0o700);
		const snapshotName = "00000000-0000-0000-0000-000000000003.jsonl";
		const snapshot = join(snapshotDirectory, snapshotName);
		writeFileSync(snapshot, '"child"\n');
		writeFileSync(
			join(sessionsRoot, ".artifact-cleanup-frontier"),
			JSON.stringify({ version: 3, pending: [{ directory: "deleted", snapshot: snapshotName, offset: 0 }] }),
		);

		await maintainAgentArtifacts(7, {
			sessionsRoot,
			tempArtifactsDir: join(root, "missing-temp"),
		});

		expect(existsSync(snapshot)).toBeFalse();
		expect(existsSync(join(sessionsRoot, ".artifact-cleanup-frontier"))).toBeFalse();
	});

	test("serializes concurrent discovery maintenance without leaking snapshot controls", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-concurrent-discovery-"));
		temporaryDirectories.push(root);
		const sessionsRoot = join(root, "sessions");
		const artifacts = join(sessionsRoot, "project", "nested", "subagent-artifacts");
		mkdirSync(artifacts, { recursive: true });
		const now = Date.now();
		const terminal = writeArtifactGroup(artifacts, "concurrent00", "complete", now);
		const options = { sessionsRoot, tempArtifactsDir: join(root, "missing-temp"), now, maxEntries: 2 };

		await Promise.all(Array.from({ length: 8 }, async () => maintainAgentArtifacts(7, options)));
		for (let attempt = 0; attempt < 20 && existsSync(terminal.inputPath); attempt += 1) {
			await maintainAgentArtifacts(7, options);
		}
		await maintainAgentArtifacts(7, options);

		const snapshotDirectory = join(sessionsRoot, ".artifact-cleanup-snapshots");
		const leaked = readdirSync(snapshotDirectory).filter((name) => /\.jsonl(?:\.|$)/u.test(name));
		expect(existsSync(terminal.inputPath)).toBeFalse();
		expect(leaked).toEqual([]);
	});

	test("does not delete an artifact group while a Suite writer owns its claim", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-writer-claim-"));
		temporaryDirectories.push(root);
		const tempArtifacts = join(root, "temp-artifacts");
		mkdirSync(tempArtifacts);
		const now = Date.now();
		const terminal = writeArtifactGroup(tempArtifacts, "claimedgroup", "complete", now);

		await withArtifactGroupWriteClaim(terminal.inputPath, async () => {
			const report = await maintainAgentArtifacts(7, {
				sessionsRoot: join(root, "missing-sessions"),
				tempArtifactsDir: tempArtifacts,
				now,
			});
			expect(report.filesRemoved).toBe(0);
			expect(existsSync(terminal.inputPath)).toBeTrue();
			expect(existsSync(terminal.metadataPath)).toBeTrue();
		});
	});

	test("does not strand a different process whose artifact group shares the same claim shard", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-claim-collision-"));
		temporaryDirectories.push(root);
		const artifacts = join(root, "artifacts");
		mkdirSync(artifacts, { mode: 0o700 });

		const groupsByClaim = new Map<string, string>();
		let collidingGroups: readonly [string, string] | undefined;
		for (let index = 0; index < 1_000 && !collidingGroups; index += 1) {
			const group = `group-${index}`;
			const claim = shardedDurableClaimName("artifact-group", group);
			const prior = groupsByClaim.get(claim);
			if (prior) collidingGroups = [prior, group];
			else groupsByClaim.set(claim, group);
		}
		expect(collidingGroups).toBeDefined();
		if (!collidingGroups) throw new Error("Unable to find an artifact claim collision.");

		const moduleUrl = pathToFileURL(resolve("packages/pi-stuff/src/subagents/src/shared/artifacts.ts")).href;
		const holderPath = join(artifacts, `${collidingGroups[0]}_input.md`);
		const contenderPath = join(artifacts, `${collidingGroups[1]}_input.md`);
		const holderScript = `
import * as fs from "node:fs";
const { withArtifactGroupWriteClaim } = await import(${JSON.stringify(moduleUrl)});
const deadline = Date.now() + 1_000;
let ready = false;
while (Date.now() < deadline) {
	withArtifactGroupWriteClaim(${JSON.stringify(holderPath)}, () => fs.appendFileSync(${JSON.stringify(holderPath)}, "holder\\n"));
	if (!ready) {
		ready = true;
		process.stdout.write("ready\\n");
	}
	await Bun.sleep(10);
}
`;
		const holder = spawn(process.execPath, ["-e", holderScript], { stdio: ["ignore", "pipe", "pipe"] });
		let holderStderr = "";
		holder.stderr?.on("data", (chunk: Buffer) => {
			holderStderr = `${holderStderr}${chunk.toString("utf8")}`.slice(-8_192);
		});
		try {
			await new Promise<void>((resolveReady, reject) => {
				const timeout = setTimeout(
					() => reject(new Error(`Artifact claim holder timed out: ${holderStderr}`)),
					3_000,
				);
				holder.once("error", reject);
				holder.stdout?.once("data", (chunk: Buffer) => {
					if (!chunk.toString("utf8").includes("ready")) return;
					clearTimeout(timeout);
					resolveReady();
				});
			});

			const contenderScript = `
import * as fs from "node:fs";
const { withArtifactGroupWriteClaim } = await import(${JSON.stringify(moduleUrl)});
withArtifactGroupWriteClaim(${JSON.stringify(contenderPath)}, () => fs.writeFileSync(${JSON.stringify(contenderPath)}, "contender"));
`;
			const contender = Bun.spawnSync([process.execPath, "-e", contenderScript], {
				stderr: "pipe",
				stdout: "pipe",
			});
			expect(new TextDecoder().decode(contender.stderr)).toBe("");
			expect(contender.exitCode).toBe(0);
			expect(readFileSync(contenderPath, "utf8")).toBe("contender");
		} finally {
			if (holder.exitCode === null && holder.signalCode === null) {
				const closed = new Promise<void>((resolveClose) => holder.once("close", () => resolveClose()));
				holder.kill("SIGKILL");
				await closed;
			}
		}
	}, 5_000);

	test("recovers malformed overflow state and sweeps stale control temporaries", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-control-recovery-"));
		temporaryDirectories.push(root);
		const tempArtifacts = join(root, "temp-artifacts");
		const control = join(tempArtifacts, ".artifact-cleanup-control");
		mkdirSync(control, { recursive: true, mode: 0o700 });
		chmodSync(control, 0o700);
		const now = Date.now();
		const terminal = writeArtifactGroup(tempArtifacts, "controlstate", "complete", now);
		const overflow = join(control, ".cleanup-snapshot.jsonl.overflow.json");
		const staleTemporary = join(
			control,
			".cleanup-snapshot.jsonl.build.json.00000000-0000-0000-0000-000000000004.tmp",
		);
		const freshTemporary = join(control, ".cleanup-snapshot.jsonl.00000000-0000-0000-0000-000000000005.tmp");
		writeFileSync(overflow, "{malformed");
		writeFileSync(staleTemporary, "stale");
		writeFileSync(freshTemporary, "fresh");
		const oldDate = new Date(now - 2 * 60 * 60 * 1_000);
		utimesSync(staleTemporary, oldDate, oldDate);

		await maintainAgentArtifacts(7, {
			sessionsRoot: join(root, "missing-sessions"),
			tempArtifactsDir: tempArtifacts,
			now,
		});

		expect(existsSync(overflow)).toBeFalse();
		expect(existsSync(staleTemporary)).toBeFalse();
		expect(existsSync(freshTemporary)).toBeTrue();
		expect(existsSync(terminal.inputPath)).toBeFalse();
		expect(existsSync(terminal.metadataPath)).toBeFalse();
	});

	test("sweeps a stale control temporary beyond a large stable prefix before throttling maintenance", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-stuff-artifacts-wide-control-"));
		temporaryDirectories.push(root);
		const tempArtifacts = join(root, "temp-artifacts");
		const control = join(tempArtifacts, ".artifact-cleanup-control");
		mkdirSync(control, { recursive: true, mode: 0o700 });
		chmodSync(control, 0o700);
		const now = Date.now();
		for (let index = 0; index < 300; index += 1) {
			writeFileSync(join(control, `unknown-${String(index).padStart(3, "0")}`), "retained");
		}
		const orphan = join(control, ".cleanup-snapshot.jsonl.00000000-0000-0000-0000-000000000006.tmp");
		writeFileSync(orphan, "stale");
		const oldDate = new Date(now - 2 * 60 * 60 * 1_000);
		utimesSync(orphan, oldDate, oldDate);

		const report = await maintainAgentArtifacts(7, {
			sessionsRoot: join(root, "missing-sessions"),
			tempArtifactsDir: tempArtifacts,
			now,
		});

		expect(report.scanComplete).toBeTrue();
		expect(existsSync(orphan)).toBeFalse();
		expect(existsSync(join(tempArtifacts, ".last-cleanup"))).toBeTrue();
	});
});
