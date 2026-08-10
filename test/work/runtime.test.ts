import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startMonitor } from "../../packages/pi-stuff/src/background-work/src/monitor.js";
import { BoundedOutputFile, readBoundedTail } from "../../packages/pi-stuff/src/background-work/src/output.js";
import {
	captureProcessIdentity,
	captureProcessIdentityWithRetry,
	processExists,
	signalProcessGroup,
} from "../../packages/pi-stuff/src/background-work/src/process.js";
import {
	type BackgroundMonitorActivity,
	type BackgroundWorkOutcome,
	BackgroundWorkRuntime,
	projectNotificationBatch,
} from "../../packages/pi-stuff/src/background-work/src/runtime.js";
import {
	createAuthenticatedRuntimeRecord,
	reconcileStaleRuns,
	type StoredProcessTask,
	WorkRunStorage,
} from "../../packages/pi-stuff/src/background-work/src/storage.js";
import { isForegroundBashResult } from "../../packages/pi-stuff/src/background-work/src/tools.js";
import {
	activateDiagnosticChannel,
	DiagnosticChannel,
	resetDiagnosticProcessState,
} from "../../packages/pi-stuff/src/conversation-ui/diagnostics.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
const escapedProcessGroups: number[] = [];
const TEST_WORK_AUTHORITY_KEY = Buffer.alloc(32, 0x5a);

afterEach(() => {
	resetDiagnosticProcessState();
	for (const child of children.splice(0)) {
		if (child.pid && processExists(child.pid)) signalProcessGroup(child.pid, "SIGKILL");
	}
	for (const pid of escapedProcessGroups.splice(0)) {
		signalProcessGroup(pid, "SIGKILL");
	}
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-work-test-"));
	roots.push(root);
	return root;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(25);
	}
	throw new Error("timed out waiting for condition");
}

async function leaderGoneProcessGroup(
	root: string,
	label: string,
): Promise<{
	childPid: number;
	leaderIdentity: NonNullable<ReturnType<typeof captureProcessIdentity>>;
}> {
	const childPath = join(root, `${label}.child.pid`);
	const releasePath = join(root, `${label}.release`);
	const leader = spawn(
		"/bin/sh",
		[
			"-c",
			'trap \'\' HUP; sh -c \'trap "" TERM HUP INT; while :; do sleep 1; done\' & echo $! > "$1"; while [ ! -e "$2" ]; do sleep 0.01; done',
			"fixture",
			childPath,
			releasePath,
		],
		{ detached: true, stdio: "ignore" },
	);
	children.push(leader);
	if (!leader.pid) throw new Error("leader-gone process fixture did not start");
	escapedProcessGroups.push(leader.pid);
	await waitUntil(() => existsSync(childPath) && captureProcessIdentity(leader.pid!) !== undefined);
	const leaderIdentity = captureProcessIdentity(leader.pid);
	if (!leaderIdentity) throw new Error("leader-gone process fixture has no leader identity");
	const childPid = Number(readFileSync(childPath, "utf-8").trim());
	writeFileSync(releasePath, "release\n");
	await waitUntil(() => !processExists(leaderIdentity.pid) && processExists(childPid));
	return { childPid, leaderIdentity };
}

function context(cwd: string): ExtensionContext {
	return {
		cwd,
		model: undefined,
		sessionManager: {
			getSessionFile: () => join(cwd, "session.jsonl"),
			getSessionId: () => "work-test-session",
		},
		thinkingLevel: "off",
	} as unknown as ExtensionContext;
}

function runtime(cwd: string, messages: unknown[] = [], backgroundAfterMs?: number): BackgroundWorkRuntime {
	const pi = {
		sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
	} as unknown as ExtensionAPI;
	return new BackgroundWorkRuntime({
		...(backgroundAfterMs !== undefined ? { backgroundAfterMs } : {}),
		cwd,
		pi,
		sessionId: "work-test-session",
		storage: new WorkRunStorage(cwd, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
	});
}

class SecondPersistFailsStorage extends WorkRunStorage {
	private calls = 0;

	override persist(tasks: readonly StoredProcessTask[]): void {
		this.calls += 1;
		if (this.calls === 2) {
			throw Object.assign(new Error("injected metadata failure"), { code: "EIO" });
		}
		super.persist(tasks);
	}
}

class RunningMetadataDegradesStorage extends WorkRunStorage {
	private calls = 0;

	override persist(tasks: readonly StoredProcessTask[]): void {
		this.calls += 1;
		if (this.calls >= 3) {
			throw Object.assign(new Error("injected running metadata failure"), { code: "EIO" });
		}
		super.persist(tasks);
	}

	override cleanup(): void {
		throw Object.assign(new Error("injected cleanup failure"), { code: "EIO" });
	}
}

describe("bounded background output", () => {
	test("never exceeds its byte cap and strips terminal control sequences", () => {
		const root = temporaryRoot();
		const path = join(root, "output");
		const output = new BoundedOutputFile(path, 256);
		expect(output.append(Buffer.from(`\u001b[31m${"x".repeat(500)}\u001b[0m`))).toBe(false);
		output.close();
		expect(statSync(path).size).toBe(256);
		expect(output.recentText()).not.toContain("\u001b[");
		expect(output.recentText()).toContain("output limit reached");
	});

	test("degrades write and close failures to the bounded in-memory tail", () => {
		const root = temporaryRoot();
		const writeFailure = new BoundedOutputFile(join(root, "write-failure"), 1_024, {
			writeSync: () => {
				throw Object.assign(new Error("injected write EIO"), { code: "EIO" });
			},
		});
		expect(writeFailure.append(Buffer.from("MEMORY-WRITE-TAIL\n"))).toBe(true);
		expect(writeFailure.durable).toBe(false);
		expect(writeFailure.recentText()).toContain("MEMORY-WRITE-TAIL");
		expect(writeFailure.recentText()).toContain("injected write EIO");
		expect(() => writeFailure.close()).not.toThrow();

		const closeFailure = new BoundedOutputFile(join(root, "close-failure"), 1_024, {
			closeSync: (fd) => {
				closeSync(fd);
				throw Object.assign(new Error("injected close EIO"), { code: "EIO" });
			},
		});
		expect(closeFailure.append(Buffer.from("MEMORY-CLOSE-TAIL\n"))).toBe(true);
		expect(() => closeFailure.close()).not.toThrow();
		expect(closeFailure.durable).toBe(false);
		expect(closeFailure.recentText()).toContain("MEMORY-CLOSE-TAIL");
		expect(closeFailure.recentText()).toContain("injected close EIO");
	});

	test("keeps in-memory and on-disk UTF-8 tails on character boundaries", () => {
		const root = temporaryRoot();
		const path = join(root, "multibyte-output");
		const output = new BoundedOutputFile(path, 1_024);
		expect(output.append(Buffer.from("界".repeat(100), "utf-8"))).toBe(true);
		const memoryTail = output.recentText(5);
		output.close();
		const diskTail = readBoundedTail(path, 5);

		expect(memoryTail).toEndWith("界");
		expect(diskTail).toEndWith("界");
		expect(memoryTail).not.toContain("�");
		expect(diskTail).not.toContain("�");
	});

	test("keeps every projected notification body below its hard byte cap", () => {
		const outcomes = Array.from({ length: 1_000 }, (_, index) => ({
			endedAt: 2,
			id: `task-${String(index)}-${"界<&".repeat(100)}`,
			kind: "shell" as const,
			recentOutput: "payload".repeat(10_000),
			startedAt: 1,
			status: "completed" as const,
			summary: "summary<&界".repeat(100),
			title: "title".repeat(100),
		}));
		const projected = projectNotificationBatch(outcomes);
		expect(Buffer.byteLength(projected.content, "utf-8")).toBeLessThanOrEqual(64 * 1024);
		expect(projected.content).toContain('count="1000"');
		expect(projected.outcomes).toHaveLength(1_000);
	});

	test("uses bounded inline output when an existing output path is too long to disclose", () => {
		const root = temporaryRoot();
		let directory = root;
		while (Buffer.byteLength(join(directory, "output.log"), "utf-8") <= 2_100) {
			directory = join(directory, "p".repeat(100));
		}
		mkdirSync(directory, { recursive: true });
		const outputPath = join(directory, "output.log");
		writeFileSync(outputPath, "FULL");
		const [outcome] = projectNotificationBatch([
			{
				endedAt: 2,
				id: "long-path",
				kind: "shell",
				outputPath,
				recentOutput: "INLINE-FALLBACK",
				startedAt: 1,
				status: "completed",
				summary: "done",
				title: "long path",
			},
		]).outcomes;
		expect(outcome?.outputPath).toBeUndefined();
		expect(outcome?.recentOutput).toBe("INLINE-FALLBACK");
	});
});

describe("BackgroundWorkRuntime", () => {
	test("keeps an unverified stale runtime in diagnostics without raising a main-UI notice", async () => {
		const root = temporaryRoot();
		const diagnostics = new DiagnosticChannel();
		activateDiagnosticChannel(diagnostics);
		const active = new BackgroundWorkRuntime({
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			reconcileStale: async () => ({ cleanedDirectories: 0, killedProcesses: 0, unresolvedDirectories: 1 }),
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
		});

		await active.prepare();
		expect(diagnostics.list()).toHaveLength(1);
		expect(diagnostics.list()[0]?.summary).toContain("unverified stale runtime directory was left untouched");
		expect(diagnostics.listNotices()).toEqual([]);
		await active.shutdown();
	});

	test("retries stale-runtime preparation after a transient failure", async () => {
		const root = temporaryRoot();
		let attempts = 0;
		const active = new BackgroundWorkRuntime({
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			reconcileStale: async () => {
				attempts += 1;
				if (attempts === 1) throw Object.assign(new Error("injected recovery EIO"), { code: "EIO" });
				return { cleanedDirectories: 0, killedProcesses: 0, unresolvedDirectories: 0 };
			},
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
		});

		await expect(active.prepare()).rejects.toThrow("injected recovery EIO");
		await expect(active.prepare()).resolves.toBeUndefined();
		expect(attempts).toBe(2);
		await active.shutdown();
	});

	test("does not open an output file when command authorization path resolution fails", async () => {
		const root = temporaryRoot();
		class AuthorizationPathFailsStorage extends WorkRunStorage {
			override commandAuthorizationPath(): string {
				throw Object.assign(new Error("injected command path EIO"), { code: "EIO" });
			}
		}
		let outputFactoryCalls = 0;
		const active = new BackgroundWorkRuntime({
			cwd: root,
			outputFactory: (filePath) => {
				outputFactoryCalls += 1;
				return new BoundedOutputFile(filePath);
			},
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage: new AuthorizationPathFailsStorage(root, "work-test-session", {
				authorityKey: TEST_WORK_AUTHORITY_KEY,
			}),
		});

		await expect(
			active.executeBash({ command: "printf 'must-not-start\\n'", toolCallId: "tool-path-failure" }, context(root)),
		).rejects.toThrow("injected command path EIO");
		expect(active.detachActiveForeground()).toBeFalse();
		expect(outputFactoryCalls).toBe(0);
		expect(
			readdirSync(resolve(root, ".pi", "tasks"), { recursive: true }).some((entry) =>
				String(entry).endsWith(".output"),
			),
		).toBeFalse();
		await active.shutdown();
	});

	test("shutdown cancels and awaits a supervisor whose launch identity is still being captured", async () => {
		const root = temporaryRoot();
		const marker = join(root, "must-not-run");
		let releaseIdentity!: () => void;
		const identityGate = new Promise<void>((resolve) => {
			releaseIdentity = resolve;
		});
		let identityCaptureStarted!: () => void;
		const captureStarted = new Promise<void>((resolve) => {
			identityCaptureStarted = resolve;
		});
		let supervisorPid: number | undefined;
		const storage = new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY });
		const active = new BackgroundWorkRuntime({
			captureSupervisorIdentity: async (pid) => {
				supervisorPid = pid;
				identityCaptureStarted();
				await identityGate;
				return captureProcessIdentityWithRetry(pid);
			},
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage,
		});

		const execution = active.executeBash(
			{ command: `touch ${JSON.stringify(marker)}`, toolCallId: "tool-shutdown-launch-race" },
			context(root),
		);
		await captureStarted;
		let shutdownSettled = false;
		const shutdown = active.shutdown().then(() => {
			shutdownSettled = true;
		});
		await Bun.sleep(25);
		expect(shutdownSettled).toBeFalse();
		releaseIdentity();
		await expect(execution).rejects.toThrow("session is shutting down");
		await shutdown;

		expect(supervisorPid).toBeNumber();
		if (supervisorPid !== undefined) expect(processExists(supervisorPid)).toBeFalse();
		expect(existsSync(marker)).toBeFalse();
		expect(active.snapshot()).toHaveLength(0);
		const runtimeFiles = storage.directory ? readdirSync(storage.directory) : [];
		expect(runtimeFiles.some((entry) => entry.endsWith(".command") || entry.endsWith(".ack"))).toBeFalse();
	});

	test("reserves the sixteenth activity slot before supervisor identity capture completes", async () => {
		const root = temporaryRoot();
		let releaseCaptures!: () => void;
		const captureGate = new Promise<void>((resolve) => {
			releaseCaptures = resolve;
		});
		let captureCalls = 0;
		const active = new BackgroundWorkRuntime({
			captureSupervisorIdentity: async (pid) => {
				captureCalls += 1;
				await captureGate;
				return captureProcessIdentityWithRetry(pid);
			},
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
		});
		for (let index = 0; index < 15; index += 1) {
			const id = `m-reserved-slot-${String(index)}`;
			const outcome: BackgroundWorkOutcome = {
				endedAt: 2,
				id,
				kind: "monitor",
				startedAt: 1,
				status: "stopped",
				summary: "Monitor stopped",
				title: "Capacity fixture",
			};
			active.registerMonitor({
				cancel: async () => outcome,
				id,
				outcome: new Promise<BackgroundWorkOutcome>(() => {}),
				readOutput: () => "Waiting for the condition.",
				snapshot: () => ({
					id,
					kind: "monitor",
					startedAt: 1,
					status: "running",
					title: "Capacity fixture",
				}),
			});
		}

		const launches = Array.from({ length: 2 }, (_, index) =>
			active.executeBash({ command: ":", toolCallId: `tool-reserved-slot-${String(index)}` }, context(root)),
		);
		const outcomesPromise = Promise.allSettled(launches);
		await waitUntil(() => captureCalls === 1);
		releaseCaptures();
		const outcomes = await outcomesPromise;
		expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
		const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
		expect(rejected).toHaveLength(1);
		expect(String(rejected[0]?.reason)).toContain("At most 16 Background Work activities");
		expect(captureCalls).toBe(1);
		await active.shutdown();
	});

	test("queues a manual foreground detach while supervisor identity is still being captured", async () => {
		const root = temporaryRoot();
		let releaseCapture!: () => void;
		const captureGate = new Promise<void>((resolve) => {
			releaseCapture = resolve;
		});
		let captureStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			captureStarted = resolve;
		});
		const active = new BackgroundWorkRuntime({
			captureSupervisorIdentity: async (pid) => {
				captureStarted();
				await captureGate;
				return captureProcessIdentityWithRetry(pid);
			},
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
		});

		const execution = active.executeBash(
			{ command: "sleep 30", toolCallId: "tool-pending-manual-detach" },
			context(root),
		);
		await started;
		expect(active.detachActiveForeground()).toBeTrue();
		expect(active.detachActiveForeground()).toBeFalse();
		releaseCapture();
		const result = await execution;
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("manually moved to background task");
		expect(active.snapshot()).toHaveLength(1);
		await active.shutdown();
	});

	test("keeps the Host event loop responsive while concurrent supervisor identities become readable", async () => {
		const attempts = new Map<number, number>();
		let heartbeat = 0;
		const timer = setInterval(() => {
			heartbeat += 1;
		}, 1);
		try {
			const identities = await Promise.all(
				Array.from({ length: 20 }, (_, index) =>
					captureProcessIdentityWithRetry(10_000 + index, 250, {
						capture: (pid) => {
							const attempt = (attempts.get(pid) ?? 0) + 1;
							attempts.set(pid, attempt);
							return attempt >= 4 ? { pid, started: `test:${pid}` } : undefined;
						},
						exists: () => true,
					}),
				),
			);
			expect(identities).toHaveLength(20);
			expect(identities.every(Boolean)).toBeTrue();
			expect(heartbeat).toBeGreaterThan(5);
		} finally {
			clearInterval(timer);
		}
	});

	test("settles from the in-memory tail when output-file writes fail", async () => {
		const root = temporaryRoot();
		const active = new BackgroundWorkRuntime({
			cwd: root,
			outputFactory: (filePath) =>
				new BoundedOutputFile(filePath, 1_024 * 1_024, {
					writeSync: () => {
						throw Object.assign(new Error("injected runtime output EIO"), { code: "EIO" });
					},
				}),
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
		});
		const result = await active.executeBash(
			{ command: "printf 'MEMORY-RUNTIME-RESULT\\n'", toolCallId: "tool-memory-output" },
			context(root),
		);
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("MEMORY-RUNTIME-RESULT");
		expect(text?.type === "text" ? text.text : "").toContain("injected runtime output EIO");
		expect(active.snapshot()).toHaveLength(0);
		await expect(active.shutdown()).resolves.toBeUndefined();
	});
	test("preserves native raw Bash output in the persisted foreground result", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		const result = await active.executeBash(
			{ command: "printf '\\033[31mRAW_FOREGROUND\\033[0m\\n'", toolCallId: "tool-raw" },
			context(root),
		);
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toBe("\u001b[31mRAW_FOREGROUND\u001b[0m\n");
		expect(result.details).toBeUndefined();
		expect(isForegroundBashResult(result)).toBe(true);
		await active.shutdown();
	});

	test("preserves the native foreground failure wording", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		await expect(
			active.executeBash({ command: "printf FAILURE >&2; exit 7", toolCallId: "tool-failure" }, context(root)),
		).rejects.toThrow("FAILURE\n\nCommand exited with code 7");
		await active.shutdown();
	});

	test("settles the foreground result and remains usable after runtime storage disappears", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		const execution = active.executeBash(
			{ command: "printf 'LIVE\\n'; sleep 0.3; printf 'SURVIVED\\n'", toolCallId: "tool-storage-loss" },
			context(root),
		);
		await waitUntil(() => existsSync(join(root, ".pi")) && active.snapshot().length > 0);
		renameSync(join(root, ".pi"), join(root, ".pi-away"));
		await waitUntil(() => active.snapshot()[0]?.recentOutput?.includes("LIVE") === true);
		const [running] = active.snapshot();
		expect(running?.outputPath).toBeUndefined();
		expect(running ? active.readOutput(running.id) : "").toContain("LIVE");

		const result = await execution;
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("SURVIVED");
		expect(active.snapshot()).toHaveLength(0);

		const next = await active.executeBash(
			{ command: "printf 'NEXT\\n'", toolCallId: "tool-after-storage-loss" },
			context(root),
		);
		const nextText = next.content.find((item) => item.type === "text");
		expect(nextText?.type === "text" ? nextText.text : "").toBe("NEXT\n");
		await active.shutdown();
	});

	test("delivers bounded background output when the persisted output path disappears", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		await active.executeBash(
			{
				command: "sleep 0.2; printf 'BACKGROUND-SURVIVED\\n'",
				runInBackground: true,
				toolCallId: "tool-background-storage-loss",
			},
			context(root),
		);
		renameSync(join(root, ".pi"), join(root, ".pi-away"));
		await waitUntil(() => messages.length > 0);

		const notification = messages[0] as { message?: { content?: string } };
		expect(notification.message?.content).toContain("BACKGROUND-SURVIVED");
		await active.shutdown();
	});

	test("recreates authenticated recovery metadata while Background Work is still live", async () => {
		const root = temporaryRoot();
		const active = new BackgroundWorkRuntime({
			backgroundAfterMs: 50,
			cwd: root,
			metadataHeartbeatMs: 40,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
		});
		try {
			await active.executeBash(
				{ command: "sleep 30", runInBackground: true, toolCallId: "tool-heartbeat-recovery" },
				context(root),
			);
			const taskRoot = join(root, ".pi", "tasks");
			await waitUntil(() => readdirSync(taskRoot).some((entry) => entry.startsWith("pi-stuff-")));
			const original = readdirSync(taskRoot).find((entry) => entry.startsWith("pi-stuff-"));
			if (!original) throw new Error("expected Background Work runtime directory");
			rmSync(join(taskRoot, original), { force: true, recursive: true });
			await waitUntil(() =>
				readdirSync(taskRoot).some(
					(entry) => entry.startsWith("pi-stuff-") && existsSync(join(taskRoot, entry, "runtime.json")),
				),
			);
			const replacement = readdirSync(taskRoot).find(
				(entry) => entry.startsWith("pi-stuff-") && existsSync(join(taskRoot, entry, "runtime.json")),
			);
			if (!replacement) throw new Error("expected replacement Background Work runtime directory");
			const metadata = JSON.parse(readFileSync(join(taskRoot, replacement, "runtime.json"), "utf-8")) as {
				tasks?: unknown[];
			};
			expect(metadata.tasks).toHaveLength(1);
		} finally {
			await active.shutdown();
		}
	});

	test("retries a transient terminal notification failure without duplicating delivery", async () => {
		const root = temporaryRoot();
		const messages: Array<{ message: unknown; options: unknown }> = [];
		let attempts = 0;
		const active = new BackgroundWorkRuntime({
			backgroundAfterMs: 50,
			cwd: root,
			pi: {
				sendMessage: (message: unknown, options: unknown) => {
					attempts += 1;
					if (attempts === 1) throw Object.assign(new Error("injected transient send failure"), { code: "EIO" });
					messages.push({ message, options });
				},
			} as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
		});
		try {
			await active.executeBash(
				{
					command: "sleep 0.1; printf 'RETRY-DELIVERY\\n'",
					runInBackground: true,
					toolCallId: "tool-notification-retry",
				},
				context(root),
			);
			await waitUntil(() => messages.length === 1);
			expect(attempts).toBe(2);
			await Bun.sleep(600);
			expect(messages).toHaveLength(1);
			const delivery = messages[0] as {
				message: { content: string; details: { outcomes: Array<{ outputPath?: string }> } };
			};
			expect(delivery.message.content).toContain("<output_file>");
			const outputPath = delivery.message.details.outcomes[0]?.outputPath;
			expect(outputPath).toBeString();
			expect(readFileSync(outputPath ?? "", "utf8")).toContain("RETRY-DELIVERY");
		} finally {
			await active.shutdown();
		}
	});

	test("isolates Background Work lifecycle from a failing UI subscriber", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		active.subscribe(() => {
			throw new Error("renderer failed");
		});

		const result = await active.executeBash(
			{ command: "printf 'SUBSCRIBER-SAFE\\n'", toolCallId: "tool-subscriber-failure" },
			context(root),
		);
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toBe("SUBSCRIBER-SAFE\n");
		await active.shutdown();
	});

	test("isolates foreground Bash progress from a failing onUpdate observer", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		try {
			const result = await active.executeBash(
				{
					command: "sleep 0.1; printf 'UPDATE-SAFE\\n'",
					onUpdate: () => {
						throw new Error("progress renderer failed");
					},
					toolCallId: "tool-update-observer-failure",
				},
				context(root),
			);
			const text = result.content.find((item) => item.type === "text");
			expect(text?.type === "text" ? text.text : "").toBe("UPDATE-SAFE\n");
			expect(active.snapshot()).toHaveLength(0);
		} finally {
			await active.shutdown();
		}
	});

	test("contains rejected timeout, abort, and output-limit stops without an unhandled rejection", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			for (const trigger of ["timeout", "abort", "output-limit"] as const) {
				const root = temporaryRoot();
				let terminationAttempts = 0;
				const active = new BackgroundWorkRuntime({
					cwd: root,
					...(trigger === "output-limit"
						? { outputFactory: (filePath) => new BoundedOutputFile(filePath, 64) }
						: {}),
					pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
					sessionId: "work-test-session",
					storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
					signalSupervisor: (supervisor, _identity, signal) => {
						terminationAttempts += 1;
						supervisor.kill(signal);
						throw new Error(`injected ${trigger} stop failure`);
					},
				});
				const controller = new AbortController();
				const execution = active.executeBash(
					{
						command:
							trigger === "output-limit"
								? `printf '${"x".repeat(512)}'; sleep 30`
								: "sleep 30; printf 'TERMINAL\\n'",
						...(trigger === "abort" ? { signal: controller.signal } : {}),
						...(trigger === "timeout" ? { timeoutSeconds: 0.01 } : {}),
						toolCallId: `tool-${trigger}-stop-rejection`,
					},
					context(root),
				);
				if (trigger === "abort") setTimeout(() => controller.abort(), 20);
				await expect(execution).rejects.toThrow();
				await Bun.sleep(25);
				expect(terminationAttempts).toBeGreaterThan(0);
				await active.shutdown();
			}
			await Bun.sleep(25);
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	test("retries process termination after a transient unresolved stop proof", async () => {
		const root = temporaryRoot();
		let attempts = 0;
		const active = new BackgroundWorkRuntime({
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
			signalSupervisor: (supervisor, identity, signal) => {
				attempts += 1;
				if (attempts === 1) return "unresolved";
				if (captureProcessIdentity(identity.pid)?.started !== identity.started) return "gone";
				supervisor.kill(signal);
				return "requested";
			},
		});
		try {
			await active.executeBash(
				{ command: "sleep 30", runInBackground: true, toolCallId: "tool-retry-unresolved-stop" },
				context(root),
			);
			const id = active.snapshot()[0]?.id;
			expect(id).toBeString();
			await expect(active.stop(id ?? "")).rejects.toThrow("could not be proven stopped");
			const outcome = await active.stop(id ?? "");
			expect(outcome.status).toBe("stopped");
			expect(attempts).toBeGreaterThanOrEqual(2);
		} finally {
			await active.shutdown();
		}
	});

	test("settles terminal outcome when launch-artifact cleanup fails", async () => {
		const root = temporaryRoot();
		const storage = new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY });
		const active = new BackgroundWorkRuntime({
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage,
		});
		try {
			const started = await active.startCommandMonitor(
				{ command: "sleep 0.2", timeoutSeconds: 5, toolCallId: "tool-cleanup-failure" },
				context(root),
			);
			mkdirSync(storage.commandAuthorizationPath(started.id), { recursive: true });
			mkdirSync(`${storage.commandAuthorizationPath(started.id)}.ack`, { recursive: true });
			const outcome = await Promise.race([
				started.outcome,
				Bun.sleep(3_000).then(() => {
					throw new Error("terminal outcome did not settle");
				}),
			]);
			expect(outcome.status).toBe("completed");
			await expect(active.shutdown()).resolves.toBeUndefined();
		} finally {
			await active.shutdown();
		}
	});

	test("rolls back a spawned supervisor when post-spawn metadata persistence fails", async () => {
		const root = temporaryRoot();
		const pi = { sendMessage: () => {} } as unknown as ExtensionAPI;
		const active = new BackgroundWorkRuntime({
			cwd: root,
			pi,
			sessionId: "work-test-session",
			storage: new SecondPersistFailsStorage(root, "work-test-session", {
				authorityKey: TEST_WORK_AUTHORITY_KEY,
			}),
		});
		try {
			await expect(
				active.executeBash(
					{ command: "printf 'MUST-NOT-RUN\\n'", toolCallId: "tool-persist-rollback" },
					context(root),
				),
			).rejects.toThrow("injected metadata failure");
			expect(active.snapshot()).toHaveLength(0);
		} finally {
			await active.shutdown();
		}
	});

	test("cancels and retains a published command when its acknowledgement is invalid", async () => {
		const root = temporaryRoot();
		class CorruptAcknowledgementStorage extends WorkRunStorage {
			private acknowledgementWritten = false;

			override commandAuthorizationPath(id: string): string {
				const authorizationPath = super.commandAuthorizationPath(id);
				if (!this.acknowledgementWritten) {
					this.acknowledgementWritten = true;
					writeFileSync(
						`${authorizationPath}.ack`,
						`${JSON.stringify({
							supervisorPid: process.pid,
							supervisorStarted: "wrong-identity",
							token: "wrong-token",
							version: 1,
						})}\n`,
						{ mode: 0o600 },
					);
				}
				return authorizationPath;
			}
		}
		let terminationAttempts = 0;
		const storage = new CorruptAcknowledgementStorage(root, "work-test-session", {
			authorityKey: TEST_WORK_AUTHORITY_KEY,
		});
		const active = new BackgroundWorkRuntime({
			cwd: root,
			pi: { sendMessage: () => {} } as unknown as ExtensionAPI,
			sessionId: "work-test-session",
			storage,
			signalSupervisor: (supervisor, identity, signal) => {
				terminationAttempts += 1;
				if (terminationAttempts === 1) return "unresolved";
				if (captureProcessIdentity(identity.pid)?.started !== identity.started) return "gone";
				supervisor.kill(signal);
				return "requested";
			},
		});

		try {
			await expect(
				active.executeBash({ command: "sleep 30", toolCallId: "tool-corrupt-ack" }, context(root)),
			).rejects.toThrow("acknowledgement does not match its supervisor authority");
			await waitUntil(() => terminationAttempts >= 1);
			const [retained] = active.snapshot();
			expect(retained).toMatchObject({ status: "stopping" });
			expect(readFileSync(join(storage.directory ?? "", "runtime.json"), "utf-8")).toContain(
				`"id": "${retained?.id ?? ""}"`,
			);
			const outcome = await active.stop(retained?.id ?? "");
			expect(outcome.status).toBe("stopped");
			expect(active.snapshot()).toHaveLength(0);
		} finally {
			await active.shutdown();
		}
	});

	test("keeps running and shuts down cleanly when live metadata storage degrades", async () => {
		const root = temporaryRoot();
		const pi = { sendMessage: () => {} } as unknown as ExtensionAPI;
		const active = new BackgroundWorkRuntime({
			cwd: root,
			pi,
			sessionId: "work-test-session",
			storage: new RunningMetadataDegradesStorage(root, "work-test-session", {
				authorityKey: TEST_WORK_AUTHORITY_KEY,
			}),
		});

		const result = await active.executeBash(
			{ command: "printf 'PERSIST-DEGRADED\\n'", toolCallId: "tool-live-persist-degraded" },
			context(root),
		);
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toBe("PERSIST-DEGRADED\n");
		expect(active.snapshot()).toHaveLength(0);
		await expect(active.shutdown()).resolves.toBeUndefined();
	});

	test("keeps concurrent supervisor pipes isolated inside one runtime", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		try {
			const started = await Promise.all(
				Array.from({ length: 6 }, (_, index) =>
					active.startCommandMonitor(
						{
							command: `sleep 0.1; printf 'TASK-${String(index)}\\n'`,
							timeoutSeconds: 3,
							toolCallId: `tool-concurrent-${String(index)}`,
						},
						context(root),
					),
				),
			);
			const outcomes = await Promise.all(started.map((activity) => activity.outcome));
			expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(6).fill("completed"));
			expect(outcomes.map((outcome) => outcome.recentOutput)).toEqual(
				Array.from({ length: 6 }, (_, index) => `TASK-${String(index)}`),
			);
			expect(active.snapshot()).toHaveLength(0);
		} finally {
			await active.shutdown();
		}
	});

	test("settles after supervisor exit even when an escaped descendant inherits its pipes", async () => {
		if (process.platform !== "linux" || !Bun.which("setsid")) return;
		const root = temporaryRoot();
		const pidPath = join(root, "escaped.pid");
		const active = runtime(root);
		try {
			const startedAt = Date.now();
			const result = await active.executeBash(
				{
					command: `setsid sh -c 'echo $$ > "$1"; sleep 30' sh ${JSON.stringify(pidPath)} & while [ ! -s ${JSON.stringify(pidPath)} ]; do sleep 0.01; done`,
					toolCallId: "tool-inherited-pipe",
				},
				context(root),
			);
			expect(Date.now() - startedAt).toBeLessThan(3_000);
			expect(result.content[0]).toMatchObject({ type: "text" });
			await waitUntil(() => existsSync(pidPath));
			const escapedPid = Number(readFileSync(pidPath, "utf-8").trim());
			escapedProcessGroups.push(escapedPid);
			expect(processExists(escapedPid)).toBe(true);
			expect(active.snapshot()).toHaveLength(0);
			expect(signalProcessGroup(escapedPid, "SIGKILL")).toBe(true);
		} finally {
			await active.shutdown();
		}
	});

	test("closes supervisor control descriptors after sequential and concurrent runs", async () => {
		if (process.platform !== "linux" || !existsSync("/proc/self/fd")) return;
		const root = temporaryRoot();
		const baseline = readdirSync("/proc/self/fd").length;
		const active = runtime(root);
		try {
			for (let index = 0; index < 24; index += 1) {
				await active.executeBash(
					{ command: ":", toolCallId: `tool-fd-sequential-${String(index)}` },
					context(root),
				);
			}
			const concurrent = Array.from({ length: 8 }, (_, index) =>
				active.executeBash(
					{ command: `printf '${String(index)}'`, toolCallId: `tool-fd-concurrent-${String(index)}` },
					context(root),
				),
			);
			await Promise.all(concurrent);
		} finally {
			await active.shutdown();
		}
		await waitUntil(() => readdirSync("/proc/self/fd").length <= baseline + 4, 5_000);
		expect(readdirSync("/proc/self/fd").length).toBeLessThanOrEqual(baseline + 4);
	});

	test("moves only the active foreground Bash command and then cleans its process tree", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		const execution = active.executeBash({ command: "sleep 30", toolCallId: "tool-foreground" }, context(root));
		await Bun.sleep(100);
		expect(active.detachActiveForeground()).toBe(true);
		expect(active.detachActiveForeground()).toBe(false);
		const result = await execution;
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("manually moved to background task");
		expect(active.snapshot()).toHaveLength(1);
		await active.shutdown();
		expect(active.snapshot()).toHaveLength(0);
	});

	test("automatically hands off a foreground command after the configured production seam", async () => {
		const root = temporaryRoot();
		const active = runtime(root, [], 100);
		const result = await active.executeBash({ command: "sleep 30", toolCallId: "tool-automatic" }, context(root));
		const text = result.content.find((item) => item.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("moved to background task");
		expect(isForegroundBashResult(result)).toBe(false);
		expect(active.snapshot()).toHaveLength(1);
		await active.shutdown();
	});

	test("kills TERM-ignoring descendants during session shutdown", async () => {
		const root = temporaryRoot();
		const childPath = join(root, "child.pid");
		const active = runtime(root);
		await active.executeBash(
			{
				command: `trap '' TERM HUP INT; sh -c 'trap "" TERM HUP INT; while :; do sleep 1; done' & echo $! > ${JSON.stringify(childPath)}; wait`,
				runInBackground: true,
				toolCallId: "tool-tree",
			},
			context(root),
		);
		await waitUntil(() => existsSync(childPath));
		const childPid = Number(readFileSync(childPath, "utf-8").trim());
		expect(processExists(childPid)).toBe(true);
		await active.shutdown();
		await waitUntil(() => !processExists(childPid));
		expect(existsSync(join(root, ".pi", "tasks"))).toBe(true);
		expect(readFileSync(childPath, "utf-8").trim()).toBe(String(childPid));
	});

	test("delivers a one-shot file Monitor result without conversational polling", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		const target = join(root, "ready.log");
		const started = await startMonitor(
			active,
			{
				intervalSeconds: 0.1,
				source: "file",
				successText: "READY",
				target,
				timeoutSeconds: 3,
				toolCallId: "tool-monitor",
			},
			context(root),
		);
		expect(active.snapshot().map((item) => item.id)).toContain(started.id);
		writeFileSync(target, "booting\nREADY\n");
		await waitUntil(() => active.snapshot().length === 0);
		await waitUntil(() => messages.length === 1);
		const delivered = messages[0] as {
			message: { details: { outcomes: Array<{ status: string }> } };
			options: { triggerTurn: boolean };
		};
		expect(delivered.message.details.outcomes[0]?.status).toBe("completed");
		expect(delivered.options.triggerTurn).toBe(true);
		expect(active.readOutput(started.id)).toContain("observed its condition");
		expect((await active.stop(started.id)).status).toBe("completed");
		await active.shutdown();
	});

	test("does not enqueue a second Agent turn for work the user explicitly stopped", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		try {
			await active.executeBash(
				{ command: "sleep 30", runInBackground: true, toolCallId: "tool-user-stopped-shell" },
				context(root),
			);
			const shellId = active.snapshot()[0]?.id;
			expect(shellId).toBeString();
			const shellOutcome = await active.stop(shellId ?? "");
			expect(shellOutcome.status).toBe("stopped");
			expect(await active.stop(shellId ?? "")).toEqual(shellOutcome);
			expect(active.readOutput(shellId ?? "")).toContain("stopped");

			const monitor = await startMonitor(
				active,
				{
					intervalSeconds: 0.1,
					source: "file",
					successText: "READY",
					target: join(root, "never-ready"),
					timeoutSeconds: 30,
					toolCallId: "tool-user-stopped-monitor",
				},
				context(root),
			);
			const monitorOutcome = await active.stop(monitor.id);
			expect(monitorOutcome.status).toBe("stopped");
			expect(await active.stop(monitor.id)).toEqual(monitorOutcome);
			expect(active.readOutput(monitor.id)).toContain("stopped");
			await Bun.sleep(250);
			expect(messages).toEqual([]);
		} finally {
			await active.shutdown();
		}
	});

	test("retains a failed Background Shell receipt with bounded in-memory fallback", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		try {
			const launched = await active.executeBash(
				{
					command: "sleep 0.1; printf 'BACKGROUND-FAILED\\n' >&2; exit 7",
					runInBackground: true,
					toolCallId: "tool-background-failed-receipt",
				},
				context(root),
			);
			const launchText = launched.content.find((item) => item.type === "text");
			const taskId = (launchText?.type === "text" ? launchText.text : "").match(/background task ([a-z0-9]+)/u)?.[1];
			expect(taskId).toBeString();
			await waitUntil(() => active.snapshot().length === 0);
			await waitUntil(() => messages.length === 1);
			expect((await active.stop(taskId ?? "")).status).toBe("failed");
			expect(active.readOutput(taskId ?? "")).toContain("BACKGROUND-FAILED");

			const unreadablePath = join(root, "unreadable-output");
			mkdirSync(unreadablePath);
			const fallbackOutcome = Promise.resolve({
				endedAt: 2,
				id: "m-unreadable-terminal-output",
				kind: "monitor" as const,
				outputPath: unreadablePath,
				recentOutput: `${"旧".repeat(100)}终TAIL`,
				startedAt: 1,
				status: "failed" as const,
				summary: "Monitor failed",
				title: "unreadable monitor",
			});
			active.registerMonitor({
				cancel: async () => fallbackOutcome,
				id: "m-unreadable-terminal-output",
				outcome: fallbackOutcome,
				readOutput: () => "live",
				snapshot: () => ({
					id: "m-unreadable-terminal-output",
					kind: "monitor",
					startedAt: 1,
					status: "running",
					title: "unreadable monitor",
				}),
			});
			await fallbackOutcome;
			await Bun.sleep(0);
			const fallback = active.readOutput("m-unreadable-terminal-output", 16);
			expect(fallback).toContain("终TAIL");
			expect(fallback).not.toContain("旧旧旧旧旧旧");
		} finally {
			await active.shutdown();
		}
	});

	test("keeps only the newest 64 terminal receipts", async () => {
		const root = temporaryRoot();
		const active = runtime(root);
		for (let index = 0; index < 65; index += 1) {
			const id = `m-terminal-${String(index)}`;
			const outcome = Promise.resolve({
				endedAt: index + 1,
				id,
				kind: "monitor" as const,
				recentOutput: `evidence-${String(index)}`,
				startedAt: index,
				status: "completed" as const,
				summary: `Monitor ${String(index)} completed`,
				title: `monitor-${String(index)}`,
			});
			const monitor: BackgroundMonitorActivity = {
				cancel: async () => outcome,
				id,
				outcome,
				readOutput: () => `evidence-${String(index)}`,
				snapshot: () => ({
					id,
					kind: "monitor",
					startedAt: index,
					status: "running",
					title: `monitor-${String(index)}`,
				}),
			};
			active.registerMonitor(monitor);
			await outcome;
			await Bun.sleep(0);
		}

		expect(() => active.readOutput("m-terminal-0")).toThrow("No current or recently finished");
		expect(active.readOutput("m-terminal-64")).toContain("evidence-64");
		await active.shutdown();
	});

	test("bounds and fairly tails a full batch of missing-file notifications", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		try {
			await Promise.all(
				Array.from({ length: 16 }, (_, index) =>
					active.executeBash(
						{
							command: `sleep 0.3; dd if=/dev/zero bs=50000 count=1 2>/dev/null | tr '\\0' x; printf '<unsafe&界-TAIL-${String(index)}\\n'`,
							runInBackground: true,
							toolCallId: `tool-notification-${String(index)}`,
						},
						context(root),
					),
				),
			);
			renameSync(join(root, ".pi"), join(root, ".pi-away"));
			await waitUntil(() => active.snapshot().length === 0, 8_000);
			await waitUntil(() => messages.length > 0);
			await Bun.sleep(250);
			const deliveries = messages as Array<{
				message: { content: string; details: { outcomes: Array<{ recentOutput?: string; outputPath?: string }> } };
			}>;
			const outcomes = deliveries.flatMap((delivery) => delivery.message.details.outcomes);
			expect(outcomes).toHaveLength(16);
			for (const delivery of deliveries) {
				expect(Buffer.byteLength(delivery.message.content, "utf-8")).toBeLessThanOrEqual(64 * 1024);
				expect(Buffer.byteLength(JSON.stringify(delivery.message.details), "utf-8")).toBeLessThanOrEqual(64 * 1024);
				expect(delivery.message.content).toContain("&lt;unsafe&amp;界-TAIL-");
			}
			for (let index = 0; index < 16; index += 1) {
				expect(outcomes.some((outcome) => outcome.recentOutput?.endsWith(`界-TAIL-${String(index)}`))).toBe(true);
			}
			for (const outcome of outcomes) {
				expect(outcome.outputPath).toBeUndefined();
				expect(outcome.recentOutput).toContain("[earlier output omitted]");
				expect(outcome.recentOutput).not.toContain("�");
			}
		} finally {
			await active.shutdown();
		}
	}, 12_000);

	test("keeps live output paths without duplicating recent output in notification details", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		try {
			await active.executeBash(
				{
					command: "sleep 0.1; printf 'LIVE-PATH\\n'",
					runInBackground: true,
					toolCallId: "tool-live-notification-path",
				},
				context(root),
			);
			await waitUntil(() => messages.length === 1);
			const delivery = messages[0] as {
				message: { details: { outcomes: Array<{ recentOutput?: string; outputPath?: string }> } };
			};
			const outcome = delivery.message.details.outcomes[0];
			expect(outcome?.outputPath).toBeString();
			expect(outcome?.recentOutput).toBeUndefined();
		} finally {
			await active.shutdown();
		}
	});

	test("enforces a Background Shell runtime timeout after returning control", async () => {
		const root = temporaryRoot();
		const messages: unknown[] = [];
		const active = runtime(root, messages);
		await active.executeBash(
			{ command: "sleep 30", runInBackground: true, timeoutSeconds: 0.2, toolCallId: "tool-timeout" },
			context(root),
		);
		const taskId = active.snapshot()[0]?.id;
		expect(taskId).toBeString();
		await waitUntil(() => active.snapshot().length === 0);
		await waitUntil(() => messages.length === 1);
		const delivered = messages[0] as { message: { details: { outcomes: Array<{ status: string }> } } };
		expect(delivered.message.details.outcomes[0]?.status).toBe("timed_out");
		expect(active.readOutput(taskId ?? "")).toContain("timed out");
		expect((await active.stop(taskId ?? "")).status).toBe("timed_out");
		await active.shutdown();
	});
});

describe("stale run reconciliation", () => {
	test("treats a reused PID identity as gone without signaling the new process", async () => {
		const root = temporaryRoot();
		const directory = join(root, ".pi", "tasks", "pi-stuff-stale-reused");
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(directory, "runtime.json"),
			JSON.stringify(
				createAuthenticatedRuntimeRecord(
					{ pid: process.pid, started: "linux:stale-owner" },
					[{ id: "b-reused", supervisor: { pid: process.pid, started: "linux:reused" } }],
					TEST_WORK_AUTHORITY_KEY,
				),
			),
		);
		const result = await reconcileStaleRuns(root, { authorityKey: TEST_WORK_AUTHORITY_KEY });
		expect(result).toEqual({ cleanedDirectories: 1, killedProcesses: 0, unresolvedDirectories: 0 });
		expect(processExists(process.pid)).toBe(true);
		expect(existsSync(directory)).toBe(false);
	});

	test("kills a verified process group left by a dead owner", async () => {
		if (process.platform !== "linux") return;
		const root = temporaryRoot();
		const directory = join(root, ".pi", "tasks", "pi-stuff-stale-live");
		mkdirSync(directory, { recursive: true });
		const child = spawn("/bin/sh", ["-c", "trap '' TERM HUP INT; while :; do sleep 1; done"], {
			detached: true,
			stdio: "ignore",
		});
		children.push(child);
		if (!child.pid) throw new Error("stale process fixture did not start");
		const childPid = child.pid;
		await waitUntil(() => captureProcessIdentity(childPid) !== undefined);
		const identity = captureProcessIdentity(childPid);
		if (!identity) throw new Error("stale process fixture has no identity");
		writeFileSync(
			join(directory, "runtime.json"),
			JSON.stringify(
				createAuthenticatedRuntimeRecord(
					{ pid: process.pid, started: "linux:dead-owner" },
					[{ id: "b-stale", command: identity, supervisor: identity }],
					TEST_WORK_AUTHORITY_KEY,
				),
			),
		);
		const result = await reconcileStaleRuns(root, { authorityKey: TEST_WORK_AUTHORITY_KEY });
		expect(result.cleanedDirectories).toBe(1);
		expect(result.killedProcesses).toBe(1);
		await waitUntil(() => !processExists(identity.pid));
	});

	test("retains an authenticated leader-gone group when continuity is unverifiable", async () => {
		if (process.platform !== "linux") return;
		const root = temporaryRoot();
		const directory = join(root, ".pi", "tasks", "pi-stuff-stale-leader-gone");
		mkdirSync(directory, { recursive: true });
		const { childPid, leaderIdentity } = await leaderGoneProcessGroup(root, "reconcile-leader-gone");
		writeFileSync(
			join(directory, "runtime.json"),
			JSON.stringify(
				createAuthenticatedRuntimeRecord(
					{ pid: process.pid, started: "linux:dead-owner" },
					[{ id: "b-leader-gone", command: leaderIdentity, supervisor: leaderIdentity }],
					TEST_WORK_AUTHORITY_KEY,
				),
			),
		);
		const result = await reconcileStaleRuns(root, { authorityKey: TEST_WORK_AUTHORITY_KEY });
		expect(result).toEqual({ cleanedDirectories: 0, killedProcesses: 0, unresolvedDirectories: 1 });
		expect(processExists(childPid)).toBe(true);
		expect(existsSync(directory)).toBe(true);
	});

	test("never trusts an unsigned repository-preseeded runtime record", async () => {
		const root = temporaryRoot();
		const directory = join(root, ".pi", "tasks", "pi-stuff-preseeded");
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(directory, "runtime.json"),
			JSON.stringify({
				owner: { pid: process.pid, started: "linux:fake-owner" },
				schemaVersion: 2,
				tasks: [
					{
						id: "forged",
						supervisor: captureProcessIdentity(process.pid),
					},
				],
			}),
		);
		const result = await reconcileStaleRuns(root, { authorityKey: TEST_WORK_AUTHORITY_KEY });
		expect(result).toEqual({ cleanedDirectories: 0, killedProcesses: 0, unresolvedDirectories: 1 });
		expect(processExists(process.pid)).toBe(true);
		expect(existsSync(directory)).toBe(true);
	});
});

describe("crash supervisor", () => {
	test("reaps a TERM-ignoring command tree after its Pi-like parent is killed", async () => {
		if (process.platform !== "linux") return;
		const root = temporaryRoot();
		const readyPath = join(root, "ready.json");
		const treePath = join(root, "tree.txt");
		const fixture = resolve(import.meta.dir, "../fixtures/work-supervisor-parent.mjs");
		const supervisor = resolve(
			import.meta.dir,
			"../../packages/pi-stuff/src/background-work/src/process-supervisor.mjs",
		);
		const parent = spawn(process.execPath, [fixture, supervisor, readyPath, treePath], {
			cwd: root,
			stdio: "ignore",
		});
		children.push(parent);
		await waitUntil(() => existsSync(readyPath) && existsSync(treePath));
		const ready = JSON.parse(readFileSync(readyPath, "utf-8")) as {
			commandPid: number;
			parentPid: number;
			supervisorPid: number;
		};
		const treePids = readFileSync(treePath, "utf-8").trim().split(/\s+/u).map(Number);
		expect(treePids).toContain(ready.commandPid);
		for (const pid of [ready.supervisorPid, ...treePids]) expect(processExists(pid)).toBe(true);
		process.kill(ready.parentPid, "SIGKILL");
		await waitUntil(() => [ready.supervisorPid, ...treePids].every((pid) => !processExists(pid)), 10_000);
	});
});
