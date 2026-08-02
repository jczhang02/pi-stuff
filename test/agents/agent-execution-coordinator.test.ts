import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writerProcessRegistryPath } from "../../packages/pi-stuff-agents/src/runs/background/writer-process-registry.js";
import {
	AgentExecutionCoordinator,
	type AgentExecutionCoordinatorSession,
	type AgentExecutionGovernorPort,
	createDurableAgentExecutionCoordinator,
	parseAgentOwnerPath,
	runtimeCompletionAddresses,
} from "../../packages/pi-stuff-agents/src/runtime/agent-execution-coordinator.js";
import type {
	AgentExecutionReservation,
	AgentExecutionReservationResult,
	AgentExecutionSettlement,
	AgentRuntimeCompletionEvent,
	AgentRuntimeCompletionResult,
	ReserveAgentResumeInput,
	ReserveAgentSpawnInput,
} from "../../packages/pi-stuff-agents/src/runtime/agent-execution-governor.js";
import {
	type AgentGovernorLease,
	type RebindAgentRuntimeRequest,
	SessionAgentGovernor,
	type SessionGovernorRebindResult,
} from "../../packages/pi-stuff-agents/src/runtime/session-governor.js";

interface RebindCall {
	readonly reservation: AgentExecutionReservation;
	readonly reservationIndex: number;
	readonly request: RebindAgentRuntimeRequest;
}

class RecordingGovernor implements AgentExecutionGovernorPort {
	readonly completions: AgentRuntimeCompletionEvent[] = [];
	readonly rebinds: RebindCall[] = [];
	readonly resumeReservations: ReserveAgentResumeInput[] = [];
	readonly settlements: Array<{ reservation: AgentExecutionReservation; settlement: AgentExecutionSettlement }> = [];
	readonly spawnReservations: ReserveAgentSpawnInput[] = [];
	completionResults: AgentRuntimeCompletionResult[] = [];

	async reserveSpawn(input: ReserveAgentSpawnInput): Promise<AgentExecutionReservationResult> {
		this.spawnReservations.push(input);
		return {
			ok: true,
			reservation: reservation("spawn", input.launchRunId, input.launchRunId, input.childCount),
		};
	}

	async reserveResume(input: ReserveAgentResumeInput): Promise<AgentExecutionReservationResult> {
		this.resumeReservations.push(input);
		return {
			ok: true,
			reservation: reservation("resume", input.launchRunId, input.targetRunId, 1, input.childIndex),
		};
	}

	async rebindChild(
		reservationValue: AgentExecutionReservation,
		reservationIndex: number,
		request: RebindAgentRuntimeRequest,
	): Promise<SessionGovernorRebindResult> {
		this.rebinds.push({ reservation: reservationValue, reservationIndex, request });
		const lease = reservationValue.leases[reservationIndex];
		if (!lease) throw new Error("Missing test lease");
		return {
			rebound: true,
			lease: {
				...lease,
				runtimeRunId: request.runtimeRunId ?? lease.runtimeRunId,
				childIndex: request.childIndex ?? lease.childIndex,
				pid: request.pid ?? lease.pid,
			},
			snapshot: snapshot(),
		};
	}

	async settle(
		reservationValue: AgentExecutionReservation,
		settlement: AgentExecutionSettlement,
	): Promise<{ releasedCount: number; alreadyReleasedCount: number; retainedCount: number }> {
		this.settlements.push({ reservation: reservationValue, settlement });
		const releasedCount =
			settlement.kind === "start-error"
				? reservationValue.leases.length
				: settlement.kind === "foreground"
					? new Set(settlement.terminalChildIndexes).size
					: 0;
		return {
			releasedCount,
			alreadyReleasedCount: 0,
			retainedCount: reservationValue.leases.length - releasedCount,
		};
	}

	async completeRuntime(event: AgentRuntimeCompletionEvent): Promise<AgentRuntimeCompletionResult> {
		this.completions.push(event);
		return this.completionResults.shift() ?? { released: true, logicalAgentId: `${event.runtimeRunId}:done` };
	}
}

function lease(logicalRunId: string, index: number, runtimeRunId: string, runtimeIndex = index): AgentGovernorLease {
	return {
		sessionId: "session",
		logicalAgentId: `${logicalRunId}:${index}`,
		runtimeRunId,
		childIndex: runtimeIndex,
		leaseId: `lease-${logicalRunId}-${index}`,
		ownerAgentPath: [],
		agentPath: [`${logicalRunId}:${index}`],
		pid: 1,
		mode: "spawn",
		acquiredAtMs: 1,
	};
}

function reservation(
	kind: "spawn" | "resume",
	launchRunId: string,
	logicalRunId: string,
	count: number,
	logicalStartIndex = 0,
): AgentExecutionReservation {
	return {
		kind,
		launchRunId,
		logicalRunId,
		leases: Array.from({ length: count }, (_, offset) =>
			lease(logicalRunId, logicalStartIndex + offset, launchRunId, logicalStartIndex + offset),
		),
	};
}

function snapshot() {
	return {
		sessionId: "session",
		limits: { maxDepth: 3, maxRunning: 20, maxTotal: 200 },
		effectiveLimits: { maxDepth: 3, maxRunning: 20, maxTotal: 200 },
		ownerAgentPath: [],
		total: 0,
		running: 0,
		agents: [],
		leases: [],
	};
}

function harness() {
	const governor = new RecordingGovernor();
	const identities: Array<{ sessionId: string; ownerAgentPath: readonly string[] }> = [];
	const reconciled: Array<Array<boolean | undefined>> = [];
	const coordinator = new AgentExecutionCoordinator({
		createSession: (identity): AgentExecutionCoordinatorSession => {
			identities.push(identity);
			return {
				governor,
				reconcile: async (isPidAlive) => {
					reconciled.push([
						isPidAlive(11, lease("probe", 0, "probe", 0)),
						isPidAlive(12, lease("probe", 1, "probe", 1)),
						isPidAlive(13, lease("probe", 2, "probe", 2)),
					]);
				},
			};
		},
		isPidAlive: (pid) => (pid === 11 ? false : pid === 12 ? true : undefined),
	});
	return { coordinator, governor, identities, reconciled };
}

describe("Agent execution lifecycle coordinator", () => {
	test("lazily reserves a whole parallel launch and rebinds every child from async-started", async () => {
		const { coordinator, governor, identities } = harness();
		coordinator.bindSession({ sessionId: "parent-session", ownerAgentPath: ["root-run:0"] });
		expect(identities).toEqual([]);

		const prepared = await coordinator.prepare({
			launchRunId: "launch-parallel",
			params: { tasks: [{}, {}, {}] },
		});
		expect(prepared.ok).toBe(true);
		expect(governor.spawnReservations).toEqual([{ launchRunId: "launch-parallel", childCount: 3 }]);
		expect(identities).toEqual([{ sessionId: "parent-session", ownerAgentPath: ["root-run:0"] }]);

		await coordinator.observeAsyncStarted({ id: "launch-parallel", pid: 8_888 });
		expect(governor.rebinds.map(({ reservationIndex, request }) => ({ reservationIndex, request }))).toEqual([
			{ reservationIndex: 0, request: { runtimeRunId: "launch-parallel", childIndex: 0, pid: 8_888 } },
			{ reservationIndex: 1, request: { runtimeRunId: "launch-parallel", childIndex: 1, pid: 8_888 } },
			{ reservationIndex: 2, request: { runtimeRunId: "launch-parallel", childIndex: 2, pid: 8_888 } },
		]);

		if (!prepared.ok || !prepared.invocation) throw new Error("Expected a governed invocation");
		await coordinator.settle(prepared.invocation, {
			details: { asyncId: "launch-parallel", runId: "launch-parallel", results: [] },
		});
		expect(governor.settlements.at(-1)?.settlement).toEqual({ kind: "background-started" });
	});

	test("releases only terminal foreground children and releases all reservations on engine failure", async () => {
		const { coordinator, governor } = harness();
		coordinator.bindSession({ sessionId: "parent-session", ownerAgentPath: [] });
		const prepared = await coordinator.prepare({ launchRunId: "foreground-run", params: { tasks: [{}, {}, {}] } });
		if (!prepared.ok || !prepared.invocation) throw new Error("Expected a governed invocation");

		await coordinator.settle(prepared.invocation, {
			details: {
				runId: "foreground-run",
				results: [{ exitCode: 0 }, { detached: true, exitCode: -2 }, { exitCode: 1 }],
			},
		});
		expect(governor.settlements.at(-1)?.settlement).toEqual({
			kind: "foreground",
			terminalChildIndexes: [0, 2],
		});

		const failed = await coordinator.prepare({ launchRunId: "failed-run", params: { agent: "worker" } });
		if (!failed.ok || !failed.invocation) throw new Error("Expected a governed invocation");
		await coordinator.fail(failed.invocation);
		expect(governor.settlements.at(-1)?.settlement).toEqual({ kind: "start-error" });
	});

	test("keeps resume logical identity while rebinding its new runtime as child zero", async () => {
		const { coordinator, governor } = harness();
		coordinator.bindSession({ sessionId: "parent-session", ownerAgentPath: [] });
		const prepared = await coordinator.prepare({
			launchRunId: "resume-tool-call",
			params: { action: "resume", id: "original-run", index: 4 },
		});
		if (!prepared.ok || !prepared.invocation) throw new Error("Expected a governed resume");
		expect(governor.resumeReservations).toEqual([
			{
				launchRunId: "resume-tool-call",
				targetRunId: "original-run",
				childIndex: 4,
			},
		]);

		await coordinator.observeAsyncStarted({ id: "actual-resume-run", pid: 9_999 });
		await coordinator.settle(prepared.invocation, {
			details: { asyncId: "actual-resume-run", runId: "actual-resume-run", results: [] },
		});
		expect(governor.rebinds.at(-1)).toMatchObject({
			reservationIndex: 0,
			request: { runtimeRunId: "actual-resume-run", childIndex: 0, pid: 9_999 },
		});
		expect(governor.settlements.at(-1)?.settlement).toEqual({ kind: "background-started" });
	});

	test("projects group, task-index, and single-child completion events to idempotent runtime releases", async () => {
		expect(
			runtimeCompletionAddresses({
				runId: "group-run",
				results: [{ taskIndex: 4 }, { index: 7 }, {}],
			}),
		).toEqual([
			{ runtimeRunId: "group-run", childIndex: 4 },
			{ runtimeRunId: "group-run", childIndex: 7 },
			{ runtimeRunId: "group-run", childIndex: 2 },
		]);
		expect(runtimeCompletionAddresses({ runId: "foreground-run", taskIndex: 5 })).toEqual([
			{ runtimeRunId: "foreground-run", childIndex: 5 },
		]);
		expect(runtimeCompletionAddresses({ id: "single-run" })).toEqual([{ runtimeRunId: "single-run", childIndex: 0 }]);

		const { coordinator, governor } = harness();
		coordinator.bindSession({ sessionId: "parent-session", ownerAgentPath: [] });
		governor.completionResults = [
			{ released: false, reason: "not_found" },
			{ released: true, logicalAgentId: "late-run:0" },
		];
		const prepared = await coordinator.prepare({ launchRunId: "late-runtime", params: { agent: "worker" } });
		if (!prepared.ok || !prepared.invocation) throw new Error("Expected a governed invocation");
		await coordinator.observeAsyncStarted({ id: "late-runtime", pid: 6_666 });
		await coordinator.complete({ runId: "late-runtime" });
		await coordinator.settle(prepared.invocation, {
			details: { asyncId: "late-runtime", runId: "late-runtime", results: [] },
		});
		expect(governor.completions).toEqual([
			{ runtimeRunId: "late-runtime", childIndex: 0 },
			{ runtimeRunId: "late-runtime", childIndex: 0 },
		]);
	});

	test("reconciles only through the injected explicit pid verdict and never releases on dispose", async () => {
		const { coordinator, governor, identities, reconciled } = harness();
		coordinator.bindSession({ sessionId: "restored-session", ownerAgentPath: parseAgentOwnerPath("a:0 › b:2") });
		expect(identities).toEqual([]);
		await coordinator.reconcileDead();
		expect(identities).toEqual([{ sessionId: "restored-session", ownerAgentPath: ["a:0", "b:2"] }]);
		expect(reconciled).toEqual([[false, true, undefined]]);

		coordinator.dispose();
		expect(governor.settlements).toEqual([]);
	});

	test("reconcileExisting is zero-write without a ledger and reclaims a confirmed-dead restored lease", async () => {
		const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-stuff-coordinator-restore-"));
		const rootDir = join(temporaryRoot, "governor-state");
		try {
			const empty = createDurableAgentExecutionCoordinator({ rootDir, isPidAlive: () => false });
			empty.bindSession({ sessionId: "empty-session", ownerAgentPath: [] });
			await empty.reconcileExisting();
			expect(existsSync(rootDir)).toBe(false);

			const seed = new SessionAgentGovernor({ rootDir, sessionId: "restored-session" });
			const acquired = await seed.acquireSpawn({ logicalAgentId: "restored-run:0", pid: 54_321 });
			if (!acquired.ok) throw new Error(acquired.error.message);
			expect((await seed.snapshot()).running).toBe(1);

			const restored = createDurableAgentExecutionCoordinator({ rootDir, isPidAlive: () => false });
			restored.bindSession({ sessionId: "restored-session", ownerAgentPath: [] });
			await restored.reconcileExisting();
			expect(await seed.snapshot()).toMatchObject({ total: 1, running: 0, leases: [] });
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	test("retains a dead-runner lease when writer registry evidence is missing or corrupt", async () => {
		const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-stuff-coordinator-writer-proof-"));
		const rootDir = join(temporaryRoot, "governor-state");
		const asyncDir = join(temporaryRoot, "async-run");
		try {
			await mkdir(asyncDir, { recursive: true });
			const seed = new SessionAgentGovernor({ rootDir, sessionId: "writer-proof-session" });
			const acquired = await seed.acquireSpawn({ logicalAgentId: "writer-proof:0", pid: 54_321 });
			if (!acquired.ok) throw new Error(acquired.error.message);
			await seed.rebindRuntime(acquired.lease, { asyncDir });

			const restored = createDurableAgentExecutionCoordinator({ rootDir, isPidAlive: () => false });
			restored.bindSession({ sessionId: "writer-proof-session", ownerAgentPath: [] });
			await restored.reconcileExisting();
			expect(await seed.snapshot()).toMatchObject({ running: 1 });

			await writeFile(writerProcessRegistryPath(asyncDir), "{not-json", "utf-8");
			await restored.reconcileExisting();
			expect(await seed.snapshot()).toMatchObject({ running: 1 });
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	test("root and fanout coordinators share one parent-session ledger with the propagated owner path", async () => {
		const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-stuff-coordinator-fanout-"));
		const rootDir = join(temporaryRoot, "governor-state");
		try {
			const root = createDurableAgentExecutionCoordinator({ rootDir });
			root.bindSession({ sessionId: "shared-parent", ownerAgentPath: [] });
			const parent = await root.prepare({ launchRunId: "parent-run", params: { agent: "worker" } });
			if (!parent.ok || !parent.invocation) throw new Error("Expected the parent reservation");

			const fanout = createDurableAgentExecutionCoordinator({ rootDir });
			fanout.bindSession({
				sessionId: "shared-parent",
				ownerAgentPath: parseAgentOwnerPath("parent-run:0"),
			});
			const nested = await fanout.prepare({ launchRunId: "nested-run", params: { agent: "reviewer" } });
			if (!nested.ok || !nested.invocation) throw new Error("Expected the nested reservation");

			const ledger = new SessionAgentGovernor({ rootDir, sessionId: "shared-parent" });
			expect(await ledger.snapshot()).toMatchObject({
				total: 2,
				running: 2,
				agents: [
					{ logicalAgentId: "parent-run:0", agentPath: ["parent-run:0"] },
					{
						logicalAgentId: "nested-run:0",
						ownerAgentPath: ["parent-run:0"],
						agentPath: ["parent-run:0", "nested-run:0"],
					},
				],
			});
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	test("parses the propagated Agent owner path without inventing root components", () => {
		expect(parseAgentOwnerPath(undefined)).toEqual([]);
		expect(parseAgentOwnerPath("  ")).toEqual([]);
		expect(parseAgentOwnerPath("root:0 › nested:3 › leaf:1")).toEqual(["root:0", "nested:3", "leaf:1"]);
	});
});
