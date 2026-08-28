import { afterEach, expect, test } from "bun:test";
import {
	BackgroundWorkRuntime,
	BoundedOutputFile,
	captureProcessIdentity,
	cleanupRuntimeFixtures,
	context,
	type DeliveredMessage,
	escapedProcessGroups,
	existsSync,
	isForegroundBashResult,
	join,
	mkdirSync,
	processExists,
	RunningMetadataDegradesStorage,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	runtime,
	SecondPersistFailsStorage,
	type SuiteAgentMessage,
	type SuiteAgentMessageOptions,
	signalProcessGroup,
	TEST_WORK_AUTHORITY_KEY,
	temporaryRoot,
	WorkRunStorage,
	waitUntil,
	writeFileSync,
} from "./runtime-fixtures.js";

afterEach(cleanupRuntimeFixtures);

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
		pi: { sendMessage: () => {} },
		sessionId: "work-test-session",
		storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
	});
	const result = await active.executeBash({ command: "printf 'MEMORY-RUNTIME-RESULT\\n'" }, context(root));
	const text = result.content.find((item) => item.type === "text");
	expect(text?.type === "text" ? text.text : "").toContain("MEMORY-RUNTIME-RESULT");
	expect(text?.type === "text" ? text.text : "").toContain("injected runtime output EIO");
	expect(active.snapshot()).toHaveLength(0);
	await expect(active.shutdown()).resolves.toBeUndefined();
});

test("preserves native raw Bash output in the persisted foreground result", async () => {
	const root = temporaryRoot();
	const active = runtime(root);
	const result = await active.executeBash({ command: "printf '\\033[31mRAW_FOREGROUND\\033[0m\\n'" }, context(root));
	const text = result.content.find((item) => item.type === "text");
	expect(text?.type === "text" ? text.text : "").toBe("\u001b[31mRAW_FOREGROUND\u001b[0m\n");
	expect(result.details).toBeUndefined();
	expect(isForegroundBashResult(result)).toBe(true);
	await active.shutdown();
});

test("preserves the native foreground failure wording", async () => {
	const root = temporaryRoot();
	const active = runtime(root);
	await expect(active.executeBash({ command: "printf FAILURE >&2; exit 7" }, context(root))).rejects.toThrow(
		"FAILURE\n\nCommand exited with code 7",
	);
	await active.shutdown();
});

test("settles the foreground result and remains usable after runtime storage disappears", async () => {
	const root = temporaryRoot();
	const active = runtime(root);
	const execution = active.executeBash(
		{ command: "printf 'LIVE\\n'; sleep 0.3; printf 'SURVIVED\\n'" },
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

	const next = await active.executeBash({ command: "printf 'NEXT\\n'" }, context(root));
	const nextText = next.content.find((item) => item.type === "text");
	expect(nextText?.type === "text" ? nextText.text : "").toBe("NEXT\n");
	await active.shutdown();
});

test("delivers bounded background output when the persisted output path disappears", async () => {
	const root = temporaryRoot();
	const messages: DeliveredMessage[] = [];
	const active = runtime(root, messages);
	await active.executeBash(
		{
			command: "sleep 0.2; printf 'BACKGROUND-SURVIVED\\n'",
			runInBackground: true,
		},
		context(root),
	);
	renameSync(join(root, ".pi"), join(root, ".pi-away"));
	await waitUntil(() => messages.length > 0);

	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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
		pi: { sendMessage: () => {} },
		sessionId: "work-test-session",
		storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
	});
	try {
		await active.executeBash({ command: "sleep 30", runInBackground: true }, context(root));
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
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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
	const messages: DeliveredMessage[] = [];
	let attempts = 0;
	const active = new BackgroundWorkRuntime({
		backgroundAfterMs: 50,
		cwd: root,
		pi: {
			sendMessage: (message: SuiteAgentMessage, options?: SuiteAgentMessageOptions) => {
				attempts += 1;
				if (attempts === 1) throw Object.assign(new Error("injected transient send failure"), { code: "EIO" });
				messages.push({ message, options });
			},
		},
		sessionId: "work-test-session",
		storage: new WorkRunStorage(root, "work-test-session", { authorityKey: TEST_WORK_AUTHORITY_KEY }),
	});
	try {
		await active.executeBash(
			{
				command: "sleep 0.1; printf 'RETRY-DELIVERY\\n'",
				runInBackground: true,
			},
			context(root),
		);
		await waitUntil(() => messages.length === 1);
		expect(attempts).toBe(2);
		await Bun.sleep(600);
		expect(messages).toHaveLength(1);
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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

	const result = await active.executeBash({ command: "printf 'SUBSCRIBER-SAFE\\n'" }, context(root));
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
	const onUnhandled: NodeJS.UnhandledRejectionListener = (reason) => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	try {
		for (const trigger of ["timeout", "abort", "output-limit"] as const) {
			const root = temporaryRoot();
			let terminationAttempts = 0;
			const runtimeOptions: ConstructorParameters<typeof BackgroundWorkRuntime>[0] = {
				cwd: root,
				pi: { sendMessage: () => {} },
				sessionId: "work-test-session",
				storage: new WorkRunStorage(root, "work-test-session", {
					authorityKey: TEST_WORK_AUTHORITY_KEY,
				}),
				signalSupervisor: (supervisor, _identity, signal) => {
					terminationAttempts += 1;
					supervisor.kill(signal);
					throw new Error(`injected ${trigger} stop failure`);
				},
			};
			if (trigger === "output-limit") {
				Object.assign(runtimeOptions, {
					outputFactory: (filePath: string) => new BoundedOutputFile(filePath, 64),
				});
			}
			const active = new BackgroundWorkRuntime(runtimeOptions);
			const controller = new AbortController();
			const execution = active.executeBash(
				Object.assign(
					{
						command:
							trigger === "output-limit"
								? `printf '${"x".repeat(512)}'; sleep 30`
								: "sleep 30; printf 'TERMINAL\\n'",
					},
					trigger === "abort" ? { signal: controller.signal } : undefined,
					trigger === "timeout" ? { timeoutSeconds: 0.01 } : undefined,
				),
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
		pi: { sendMessage: () => {} },
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
		await active.executeBash({ command: "sleep 30", runInBackground: true }, context(root));
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
		pi: { sendMessage: () => {} },
		sessionId: "work-test-session",
		storage,
	});
	try {
		const started = await active.startCommandMonitor({ command: "sleep 0.2", timeoutSeconds: 5 }, context(root));
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
	const pi = { sendMessage: () => {} };
	const active = new BackgroundWorkRuntime({
		cwd: root,
		pi,
		sessionId: "work-test-session",
		storage: new SecondPersistFailsStorage(root, "work-test-session", {
			authorityKey: TEST_WORK_AUTHORITY_KEY,
		}),
	});
	try {
		await expect(active.executeBash({ command: "printf 'MUST-NOT-RUN\\n'" }, context(root))).rejects.toThrow(
			"injected metadata failure",
		);
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
		pi: { sendMessage: () => {} },
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
		await expect(active.executeBash({ command: "sleep 30" }, context(root))).rejects.toThrow(
			"acknowledgement does not match its supervisor authority",
		);
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
	const pi = { sendMessage: () => {} };
	const active = new BackgroundWorkRuntime({
		cwd: root,
		pi,
		sessionId: "work-test-session",
		storage: new RunningMetadataDegradesStorage(root, "work-test-session", {
			authorityKey: TEST_WORK_AUTHORITY_KEY,
		}),
	});

	const result = await active.executeBash({ command: "printf 'PERSIST-DEGRADED\\n'" }, context(root));
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
			await active.executeBash({ command: ":" }, context(root));
		}
		const concurrent = Array.from({ length: 8 }, (_, index) =>
			active.executeBash({ command: `printf '${String(index)}'` }, context(root)),
		);
		const results = await Promise.all(concurrent);
		for (const result of results) {
			expect(result.content).not.toContainEqual(
				expect.objectContaining({ text: expect.stringContaining("Background output storage failed") }),
			);
		}
	} finally {
		await active.shutdown();
	}
	await waitUntil(() => readdirSync("/proc/self/fd").length <= baseline + 4, 5_000);
	expect(readdirSync("/proc/self/fd").length).toBeLessThanOrEqual(baseline + 4);
});
