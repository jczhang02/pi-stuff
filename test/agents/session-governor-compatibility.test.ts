import { afterEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initializeWriterProcessRegistry } from "../../packages/pi-stuff/src/subagents/src/runs/background/writer-process-registry.ts";
import { SessionAgentGovernor } from "../../packages/pi-stuff/src/subagents/src/runtime/session-governor.ts";
import { prepareSessionGovernorCompatibility } from "../../packages/pi-stuff/src/subagents/src/runtime/session-governor-compatibility.ts";
import type { SessionGovernorCompatibilityScope } from "../../packages/pi-stuff/src/subagents/src/shared/session-identity.ts";
import { TEMP_ROOT_DIR } from "../../packages/pi-stuff/src/subagents/src/shared/types.ts";

const limits = { maxDepth: 3, maxRunning: 20, maxTotal: 200 };
const roots = new Set<string>();

interface LegacyLockOwnerFixture {
	readonly pid: number;
	readonly processStartIdentity?: string;
	readonly token: string;
}

afterEach(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
	roots.clear();
});

function temporaryRoot(prefix: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	roots.add(root);
	return root;
}

function scope(
	input: { declared?: readonly string[]; started?: readonly string[]; legacyArtifactSessionId?: string } = {},
): SessionGovernorCompatibilityScope {
	const result: SessionGovernorCompatibilityScope = {
		sessionId: "ps2-current",
		governorSessionId: "ps2-current",
		legacyGovernorSessionId: "logical-session",
		declaredLogicalAgentIds: new Set(input.declared ?? []),
		startedLogicalAgentIds: new Set(input.started ?? []),
	};
	if (input.legacyArtifactSessionId) {
		Object.assign(result, { legacyArtifactSessionId: input.legacyArtifactSessionId, startedAtMs: 1 });
	}
	return result;
}

function governor(rootDir: string, sessionId: string, ownerAgentPath: readonly string[] = []): SessionAgentGovernor {
	return new SessionAgentGovernor({ rootDir, sessionId, ownerAgentPath, limits });
}

function makeFixtureUseLegacyLockProtocol(rootDir: string): void {
	const sessionDir = path.join(rootDir, createHash("sha256").update("logical-session").digest("hex"));
	fs.rmSync(path.join(sessionDir, "ledger.lock"), { recursive: true, force: true });
}

function legacyLockPath(rootDir: string): string {
	return path.join(rootDir, createHash("sha256").update("logical-session").digest("hex"), "ledger.lock");
}

function writeStaleLegacyLock(rootDir: string, owner: LegacyLockOwnerFixture): string {
	const lockDir = legacyLockPath(rootDir);
	fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify(owner), { mode: 0o600 });
	const old = new Date(Date.now() - 60_000);
	fs.utimesSync(lockDir, old, old);
	return lockDir;
}

function runtimeDirectory(runId: string, sessionId: string, childIndex = 0): string {
	const directory = path.join(TEMP_ROOT_DIR, "async-subagent-runs", runId);
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	fs.chmodSync(directory, 0o700);
	initializeWriterProcessRegistry(directory, runId, process.pid, 0);
	fs.writeFileSync(
		path.join(directory, "status.json"),
		`${JSON.stringify({
			runId,
			sessionId,
			mode: "single",
			state: "complete",
			startedAt: 1,
			endedAt: 2,
			steps: Array.from({ length: childIndex + 1 }, (_, index) => ({
				agent: "worker",
				status: index === childIndex ? "completed" : "complete",
				startedAt: 1,
				endedAt: 2,
			})),
		})}\n`,
		{ mode: 0o600 },
	);
	roots.add(directory);
	return directory;
}

describe("session governor v1 compatibility", () => {
	test("never reclaims a stale v1 lock whose directory protocol cannot exclude a legacy replacement race", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const lockDir = writeStaleLegacyLock(legacyRoot, {
			token: "dead-generation",
			pid: process.pid,
			processStartIdentity: "definitely-not-the-current-process-generation",
		});

		const result = await prepareSessionGovernorCompatibility({
			scope: scope(),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
			legacyBarrierOptions: { timeoutMs: 20, retryMs: 1 },
		});

		expect(result.ok).toBeFalse();
		if (result.ok) throw new Error("Expected the stale v1 lock to remain blocked.");
		expect(result.message).toContain("may be stale after a crash");
		expect(result.message).toContain(lockDir);
		expect(fs.existsSync(lockDir)).toBeTrue();
		// SAFETY: this test controls the serialized JSON fixture and exercises only the asserted fields.
		const owner = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")) as {
			processStartIdentity?: unknown;
			token?: unknown;
		};
		expect(owner.token).toBe("dead-generation");
		expect(owner.processStartIdentity).toBe("definitely-not-the-current-process-generation");
	});

	test("keeps concurrent upgraded contenders fail-closed behind one uncooperative v1 lock", async () => {
		const currentRootA = temporaryRoot("pi-governor-current-a-");
		const currentRootB = temporaryRoot("pi-governor-current-b-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const lockDir = writeStaleLegacyLock(legacyRoot, { token: "stale", pid: 999_999_991 });
		const first = prepareSessionGovernorCompatibility({
			scope: scope(),
			limits,
			currentRootDir: currentRootA,
			legacyRootDir: legacyRoot,
			legacyBarrierOptions: {
				timeoutMs: 30,
				retryMs: 1,
			},
		});
		const second = prepareSessionGovernorCompatibility({
			scope: scope(),
			limits,
			currentRootDir: currentRootB,
			legacyRootDir: legacyRoot,
			legacyBarrierOptions: { timeoutMs: 30, retryMs: 1 },
		});
		const results = await Promise.all([first, second]);
		expect(results.every((result) => !result.ok)).toBeTrue();
		expect(fs.existsSync(lockDir)).toBeTrue();
		expect(JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"))).toMatchObject({ token: "stale" });
	});

	test("keeps a legacy owner without process-generation identity conservative", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const lockDir = writeStaleLegacyLock(legacyRoot, { token: "legacy-live", pid: process.pid });
		const result = await prepareSessionGovernorCompatibility({
			scope: scope(),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
			legacyBarrierOptions: { timeoutMs: 20, retryMs: 1 },
		});
		expect(result.ok).toBeFalse();
		expect(fs.existsSync(lockDir)).toBeTrue();
	});

	test("imports only paired branch starts when no v1 ledger remains and is idempotent", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const first = await prepareSessionGovernorCompatibility({
			scope: scope({ declared: ["started:0", "preflight-only:0"], started: ["started:0"] }),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
			now: () => 10,
		});
		if (!first.ok || !first.releaseLegacyBarrier) throw new Error("Expected a no-ledger v1 barrier.");
		await first.releaseLegacyBarrier();
		const second = await prepareSessionGovernorCompatibility({
			scope: scope({ declared: ["started:0", "preflight-only:0"], started: ["started:0"] }),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
			now: () => 10,
		});
		if (!second.ok || !second.releaseLegacyBarrier) throw new Error("Expected an idempotent v1 barrier.");
		await second.releaseLegacyBarrier();
		const snapshot = await governor(currentRoot, "ps2-current").inspectExistingSnapshot();

		expect(first).toMatchObject({ ok: true, importedLogicalAgentIds: ["started:0"] });
		expect(second).toMatchObject({ ok: true, importedLogicalAgentIds: [] });
		expect(snapshot?.agents.map(({ logicalAgentId }) => logicalAgentId)).toEqual(["started:0"]);
		expect(snapshot?.agents[0]?.limits).toEqual({ maxDepth: 1, maxRunning: 1, maxTotal: 1 });
	});

	test("blocks a pre-upgrade governor's first write even when no v1 ledger existed at startup", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const result = await prepareSessionGovernorCompatibility({
			scope: scope(),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
		});
		if (!result.ok || !result.releaseLegacyBarrier) throw new Error("Expected a retained no-ledger v1 barrier.");

		const sessionDir = path.join(legacyRoot, createHash("sha256").update("logical-session").digest("hex"));
		const legacyWriter = `
			import * as fs from "node:fs";
			import * as path from "node:path";
			const sessionDir = process.argv[1];
			const lockDir = path.join(sessionDir, "ledger.lock");
			const deadline = Date.now() + 250;
			while (Date.now() < deadline) {
				try {
					fs.mkdirSync(lockDir, { mode: 0o700 });
					fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ token: "legacy", pid: process.pid }), { flag: "wx", mode: 0o600 });
					fs.writeFileSync(path.join(sessionDir, "ledger.json"), JSON.stringify({ version: 1, sessionId: "logical-session", limits: { maxDepth: 3, maxRunning: 20, maxTotal: 200 }, total: 0, agents: [], leases: [], updatedAtMs: Date.now() }), { mode: 0o600 });
					fs.rmSync(lockDir, { recursive: true });
					process.exit(0);
				} catch (error) {
					if (error?.code !== "EEXIST") throw error;
			}
			await Bun.sleep(5);
			}
			process.exit(75);
		`;
		const blocked = Bun.spawnSync([process.execPath, "-e", legacyWriter, sessionDir], {
			stdout: "ignore",
			stderr: "ignore",
		});
		expect(blocked.exitCode).toBe(75);
		expect(fs.existsSync(path.join(sessionDir, "ledger.json"))).toBe(false);

		await result.releaseLegacyBarrier();
		const admitted = Bun.spawnSync([process.execPath, "-e", legacyWriter, sessionDir], {
			stdout: "ignore",
			stderr: "ignore",
		});
		expect(admitted.exitCode).toBe(0);
		expect(fs.existsSync(path.join(sessionDir, "ledger.json"))).toBe(true);
	});

	test("never imports an undeclared parallel index from an idle v1 ledger", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const old = governor(legacyRoot, "logical-session");
		for (const logicalAgentId of ["parallel:0", "parallel:1", "parallel:99"]) {
			const acquired = await old.acquireSpawn({ logicalAgentId });
			if (!acquired.ok) throw new Error(acquired.error.message);
			await old.release(acquired.lease);
		}
		makeFixtureUseLegacyLockProtocol(legacyRoot);

		const result = await prepareSessionGovernorCompatibility({
			scope: scope({ declared: ["parallel:0", "parallel:1"] }),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
		});
		const snapshot = await governor(currentRoot, "ps2-current").inspectExistingSnapshot();

		expect(result.ok).toBeTrue();
		expect(snapshot?.agents.map(({ logicalAgentId }) => logicalAgentId).sort()).toEqual(["parallel:0", "parallel:1"]);
		if (!result.ok || !result.releaseLegacyBarrier) throw new Error("Legacy migration barrier was not retained.");
		const legacyLock = path.join(
			legacyRoot,
			createHash("sha256").update("logical-session").digest("hex"),
			"ledger.lock",
		);
		expect(() => fs.mkdirSync(legacyLock)).toThrow();
		await result.releaseLegacyBarrier();
		expect(() => fs.mkdirSync(legacyLock)).not.toThrow();
		fs.rmSync(legacyLock, { recursive: true, force: true });
	});

	test("quarantines a v1 lease whose runtime ownership is still live or unknown", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const old = governor(legacyRoot, "logical-session");
		const acquired = await old.acquireSpawn({ logicalAgentId: "live:0" });
		if (!acquired.ok) throw new Error(acquired.error.message);
		makeFixtureUseLegacyLockProtocol(legacyRoot);

		const result = await prepareSessionGovernorCompatibility({
			scope: scope({ declared: ["live:0"] }),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
		});

		expect(result).toMatchObject({ ok: false });
		expect(result.ok ? "" : result.message).toContain("temporarily paused");
		expect(await governor(currentRoot, "ps2-current").inspectExistingSnapshot()).toBeUndefined();
	});

	test("ignores another physical copy's live v1 lease", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const old = governor(legacyRoot, "logical-session");
		const acquired = await old.acquireSpawn({ logicalAgentId: "copied:0", pid: 999_999_991 });
		if (!acquired.ok) throw new Error(acquired.error.message);
		const asyncDir = runtimeDirectory(`copy-${randomUUID()}`, "/sessions/original.jsonl");
		await old.rebindRuntime(acquired.lease, { runtimeRunId: path.basename(asyncDir), asyncDir, pid: 999_999_991 });
		makeFixtureUseLegacyLockProtocol(legacyRoot);

		const result = await prepareSessionGovernorCompatibility({
			scope: scope({
				declared: ["copied:0"],
				started: ["copied:0"],
				legacyArtifactSessionId: "/sessions/copied.jsonl",
			}),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
		});

		expect(result).toMatchObject({ ok: true, importedLogicalAgentIds: ["copied:0"] });
	});

	test("imports a physically-proven dead nested ownership tree", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const oldRoot = governor(legacyRoot, "logical-session");
		const parent = await oldRoot.acquireSpawn({ logicalAgentId: "root-run:0" });
		if (!parent.ok) throw new Error(parent.error.message);
		await oldRoot.release(parent.lease);
		const oldChild = governor(legacyRoot, "logical-session", ["root-run:0"]);
		const nested = await oldChild.acquireSpawn({ logicalAgentId: "nested-run:0", pid: 999_999_992 });
		if (!nested.ok) throw new Error(nested.error.message);
		const asyncDir = runtimeDirectory(`nested-${randomUUID()}`, "/sessions/current.jsonl");
		await oldChild.rebindRuntime(nested.lease, {
			runtimeRunId: path.basename(asyncDir),
			asyncDir,
			pid: 999_999_992,
		});
		makeFixtureUseLegacyLockProtocol(legacyRoot);

		const result = await prepareSessionGovernorCompatibility({
			scope: scope({ declared: ["root-run:0"], legacyArtifactSessionId: "/sessions/current.jsonl" }),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
			isPidAlive: () => false,
		});
		const snapshot = await governor(currentRoot, "ps2-current").inspectExistingSnapshot();

		expect(result.ok).toBeTrue();
		expect(snapshot?.agents.map(({ logicalAgentId }) => logicalAgentId).sort()).toEqual([
			"nested-run:0",
			"root-run:0",
		]);
		expect(snapshot?.leases).toHaveLength(0);
	});

	test("rejects a physically-current lease whose owner chain is orphaned", async () => {
		const currentRoot = temporaryRoot("pi-governor-current-");
		const legacyRoot = temporaryRoot("pi-governor-legacy-");
		const asyncDir = runtimeDirectory(`orphan-${randomUUID()}`, "/sessions/current.jsonl");
		const sessionDir = path.join(legacyRoot, createHash("sha256").update("logical-session").digest("hex"));
		fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
		fs.writeFileSync(
			path.join(sessionDir, "ledger.json"),
			`${JSON.stringify({
				version: 1,
				sessionId: "logical-session",
				limits,
				total: 1,
				agents: [
					{
						logicalAgentId: "orphan:0",
						ownerAgentPath: ["missing:0"],
						agentPath: ["missing:0", "orphan:0"],
						limits,
						createdAtMs: 2,
					},
				],
				leases: [
					{
						logicalAgentId: "orphan:0",
						runtimeRunId: path.basename(asyncDir),
						childIndex: 0,
						leaseId: "lease",
						ownerAgentPath: ["missing:0"],
						agentPath: ["missing:0", "orphan:0"],
						pid: 999_999_993,
						asyncDir,
						mode: "spawn",
						acquiredAtMs: 2,
					},
				],
				updatedAtMs: 2,
			})}\n`,
			{ mode: 0o600 },
		);

		const result = await prepareSessionGovernorCompatibility({
			scope: scope({ declared: ["root-run:0"], legacyArtifactSessionId: "/sessions/current.jsonl" }),
			limits,
			currentRootDir: currentRoot,
			legacyRootDir: legacyRoot,
			isPidAlive: () => false,
		});

		expect(result).toMatchObject({ ok: false });
		expect(result.ok ? "" : result.message).toContain("unproven ownership path");
	});
});
