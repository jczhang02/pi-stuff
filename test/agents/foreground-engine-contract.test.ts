import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../packages/pi-stuff/src/subagents/src/agents/agents.js";
import { steerRequestsDir } from "../../packages/pi-stuff/src/subagents/src/runs/background/control-channel.js";
import { createInitialStatus } from "../../packages/pi-stuff/src/subagents/src/runs/background/initial-status.js";
import { initializeWriterProcessRegistry } from "../../packages/pi-stuff/src/subagents/src/runs/background/writer-process-registry.js";
import {
	executeForegroundConfig,
	projectForegroundCompletion,
} from "../../packages/pi-stuff/src/subagents/src/runs/foreground/execution.js";
import {
	createSubagentExecutor,
	deriveLaunchRunId,
} from "../../packages/pi-stuff/src/subagents/src/runs/foreground/subagent-executor.js";
import {
	createNestedRoute,
	projectNestedEvents,
	writeNestedEvent,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/nested-events.js";
import type { BackgroundRunnerConfig } from "../../packages/pi-stuff/src/subagents/src/runs/shared/parallel-utils.js";
import {
	SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV,
	SUBAGENT_PARENT_CHILD_INDEX_ENV,
	SUBAGENT_PARENT_CONTROL_INBOX_ENV,
	SUBAGENT_PARENT_DEPTH_ENV,
	SUBAGENT_PARENT_EVENT_SINK_ENV,
	SUBAGENT_PARENT_PATH_ENV,
	SUBAGENT_PARENT_PHYSICAL_SESSION_ENV,
	SUBAGENT_PARENT_ROOT_RUN_ID_ENV,
	SUBAGENT_PARENT_RUN_ID_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/pi-args.js";
import {
	observeForegroundRuntimeRuns,
	recoverForegroundRuntimeRuns,
	refreshForegroundRuntimeRun,
	replayForegroundRuns,
} from "../../packages/pi-stuff/src/subagents/src/session/foreground-replay.js";
import { resolveCurrentSessionId } from "../../packages/pi-stuff/src/subagents/src/shared/session-identity.js";
import { type SubagentState, TEMP_ROOT_DIR } from "../../packages/pi-stuff/src/subagents/src/shared/types.js";

const temporaryDirectories: string[] = [];

const MOCK_PARENT_SESSION_ENVIRONMENT_KEYS = [
	SUBAGENT_PARENT_EVENT_SINK_ENV,
	SUBAGENT_PARENT_CONTROL_INBOX_ENV,
	SUBAGENT_PARENT_ROOT_RUN_ID_ENV,
	SUBAGENT_PARENT_RUN_ID_ENV,
	SUBAGENT_PARENT_CHILD_INDEX_ENV,
	SUBAGENT_PARENT_DEPTH_ENV,
	SUBAGENT_PARENT_PATH_ENV,
	SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
	SUBAGENT_PARENT_PHYSICAL_SESSION_ENV,
] as const;
let parentSessionEnvironment: Map<(typeof MOCK_PARENT_SESSION_ENVIRONMENT_KEYS)[number], string | undefined>;

beforeEach(() => {
	parentSessionEnvironment = new Map(
		MOCK_PARENT_SESSION_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const),
	);
	for (const key of MOCK_PARENT_SESSION_ENVIRONMENT_KEYS) delete process.env[key];
});

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
	for (const [key, value] of parentSessionEnvironment) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function agent(): AgentConfig {
	return {
		name: "general-purpose",
		description: "General Agent",
		systemPrompt: "Complete the delegated task.",
		systemPromptMode: "append",
		inheritProjectContext: true,
		inheritSkills: true,
		source: "builtin",
		filePath: "/agents/general-purpose.md",
	};
}

function state(): SubagentState {
	return {
		baseCwd: "",
		currentSessionId: null,
		asyncJobs: new Map(),
		recentAgentJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

function context(
	cwd: string,
	models: Array<{ provider: string; id: string; contextWindow: number; maxTokens: number }> = [],
	usageTokens?: number,
): ExtensionContext {
	return {
		cwd,
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: { getAvailable: () => models },
		sessionManager: {
			buildContextEntries: () => [],
			getLeafId: () => "leaf",
			getSessionFile: () => path.join(cwd, "parent.jsonl"),
			getSessionId: () => "parent-session",
			openSession: () => ({ createBranchedSession: () => path.join(cwd, "parent.jsonl") }),
		},
		getContextUsage: () =>
			usageTokens === undefined ? undefined : { tokens: usageTokens, contextWindow: 200_000, percent: 1 },
	} as unknown as ExtensionContext;
}

function executor(
	cwd: string,
	runState: SubagentState,
	onBackgroundSingle?: (launch: {
		agentConfig?: AgentConfig;
		capabilityCeiling?: { allowedTools?: "*" | string[] };
		cwd?: string;
		description?: string;
		modelCandidates?: string[];
		nestedRoute?: {
			rootRunId: string;
			eventSink: string;
			controlInbox: string;
			capabilityToken: string;
		};
		parentRunOrigin?: "automatic" | "user";
		sessionFile?: string;
		task: string;
	}) => void,
	options: {
		agent?: AgentConfig;
		agents?: AgentConfig[];
		foregroundCrash?: boolean;
		foregroundDelayMs?: number;
		foregroundError?: Error;
		onForegroundConfig?: (config: BackgroundRunnerConfig) => void;
		pi?: ExtensionAPI;
		projectContext?: Parameters<typeof createSubagentExecutor>[0]["projectContext"];
	} = {},
) {
	const pi = options.pi ?? ({ events: { emit: () => {} } } as unknown as ExtensionAPI);
	const delegate = createSubagentExecutor({
		pi,
		state: runState,
		config: { artifactDir: "temp", maxSubagentDepth: 3 },
		asyncByDefault: true,
		tempArtifactsDir: cwd,
		getSubagentSessionRoot: () => path.join(cwd, "sessions"),
		expandTilde: (value) => value,
		discoverAgents: () => ({ agents: options.agents ?? [options.agent ?? agent()] }),
		projectContext: options.projectContext,
		engines: {
			backgroundSingle: async (id, launch) => {
				onBackgroundSingle?.(launch);
				return {
					content: [{ type: "text", text: `Background Agent started [${id}]` }],
					details: { asyncId: id, mode: "single", results: [], runId: id },
				};
			},
			foreground: async (config) => {
				temporaryDirectories.push(config.asyncDir);
				options.onForegroundConfig?.(config);
				if (options.foregroundError) throw options.foregroundError;
				if (options.foregroundDelayMs) await Bun.sleep(options.foregroundDelayMs);
				return projectForegroundCompletion(config, {
					id: config.id,
					runId: config.id,
					mode: config.work.mode,
					state: options.foregroundCrash ? "failed" : "complete",
					success: !options.foregroundCrash,
					results: (config.work.mode === "single" ? [config.work.task] : config.work.group.tasks).map(
						(task, index) => ({
							agent: task.agent,
							context: task.context,
							output: `result-${index + 1}`,
							success: !options.foregroundCrash,
							exitCode: options.foregroundCrash ? 1 : 0,
							...(options.foregroundCrash
								? {
										writerProcesses: [
											{
												attempt: 0,
												closeObservedAt: Date.now(),
												exitCode: null,
												kind: "pi-writer" as const,
												processInstanceId: "external-crash",
												signal: "SIGSEGV" as const,
												terminationOrigin: "external" as const,
											},
										],
									}
								: {}),
							sessionFile: path.join(cwd, `child-${index}.jsonl`),
						}),
					),
				});
			},
		},
	});
	return {
		execute: (...args: Parameters<typeof delegate.execute>) => {
			const [id, params, signal, onUpdate, ctx, hooks] = args;
			return delegate.execute(
				id,
				{
					...params,
					launchRunId: params.launchRunId ?? deriveLaunchRunId(id, { sessionId: cwd, ownerAgentPath: [] }),
				},
				signal,
				onUpdate,
				ctx,
				hooks,
			);
		},
	};
}

describe("reduced foreground Agent engine", () => {
	test("persists parent run attribution in a background launch", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-background-origin-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let observedOrigin: "automatic" | "user" | undefined;
		await executor(cwd, state(), (launch) => {
			observedOrigin = launch.parentRunOrigin;
		}).execute(
			"background-origin",
			{ agent: "general-purpose", task: "Inspect the parser", context: "fresh" },
			new AbortController().signal,
			undefined,
			context(cwd),
			{ parentRunOrigin: "user" },
		);
		expect(observedOrigin).toBe("user");
	});

	test("carries direct user takeover attribution into the durable steer request", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-background-user-steer-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runId = "user-steer";
		const asyncDir = path.join(cwd, runId);
		const ctx = context(cwd);
		const parentSessionId = resolveCurrentSessionId(ctx.sessionManager, cwd);
		fs.mkdirSync(asyncDir, { mode: 0o700 });
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: runId,
			parentRunOrigin: "automatic",
			cwd,
			asyncDir,
			resultPath: path.join(cwd, "result.json"),
			sessionId: parentSessionId,
			work: {
				mode: "single",
				task: {
					agent: "general-purpose",
					task: "Wait for steering",
					cwd,
					inheritProjectContext: true,
					inheritSkills: false,
				},
			},
		};
		const status = createInitialStatus(config, Date.now());
		const [step] = status.steps;
		if (!step) throw new Error("Expected one background status step");
		step.status = "running";
		const statusPath = path.join(asyncDir, "status.json");
		fs.writeFileSync(statusPath, JSON.stringify(status), { mode: 0o600 });
		const runState = state();
		runState.asyncJobs.set(runId, { asyncId: runId, asyncDir, sessionId: parentSessionId, status: "running" });

		const observeRequest = (async () => {
			const deadline = Date.now() + 2_000;
			let requestPath: string | undefined;
			while (!requestPath) {
				if (Date.now() >= deadline) throw new Error("Timed out waiting for the durable steer request");
				const directory = steerRequestsDir(asyncDir);
				const entry = fs.existsSync(directory)
					? fs.readdirSync(directory).find((candidate) => candidate.endsWith(".json"))
					: undefined;
				if (entry) requestPath = path.join(directory, entry);
				else await Bun.sleep(10);
			}
			const request = JSON.parse(fs.readFileSync(requestPath, "utf8")) as {
				id: string;
				message: string;
				parentRunOrigin?: string;
				ts: number;
			};
			const deliveredAt = Date.now();
			status.steering = {
				requested: 1,
				scheduled: 0,
				pending: 0,
				delivered: 1,
				failed: 0,
				recovered: 0,
				lastRequestedAt: request.ts,
				lastDeliveredAt: deliveredAt,
				recent: [
					{
						id: request.id,
						requestedAt: request.ts,
						messagePreview: request.message,
						targets: [{ index: 0, state: "delivered", deliveredAt }],
					},
				],
			};
			fs.writeFileSync(statusPath, JSON.stringify(status), { mode: 0o600 });
			return request;
		})();
		const controlled = executor(cwd, runState).execute(
			"control-call",
			{ action: "steer", id: runId, message: "Apply the user's correction." },
			new AbortController().signal,
			undefined,
			ctx,
			{ parentRunOrigin: "user" },
		);

		const [result, request] = await Promise.all([controlled, observeRequest]);
		expect(result.isError).not.toBe(true);
		expect(request.parentRunOrigin).toBe("user");
	});

	test("single foreground execution completes through the shared v2 runner shape", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-single-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runState = state();
		const result = await executor(cwd, runState).execute(
			"single-call",
			{ agent: "general-purpose", task: "Inspect the parser", async: false, context: "fresh" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(result.isError).not.toBe(true);
		expect(result.details.mode).toBe("single");
		expect(result.details.results.map((child) => child.finalOutput)).toEqual(["result-1"]);
		expect(runState.foregroundControls.size).toBe(0);
		expect(runState.foregroundRuns?.size).toBe(1);
	});

	test("does not let a failing completion observer replace a valid Agent result", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-observer-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runState = state();
		const result = await executor(cwd, runState, undefined, {
			pi: {
				events: {
					emit: () => {
						throw new Error("completion observer failed");
					},
				},
			} as unknown as ExtensionAPI,
		}).execute(
			"observer-call",
			{ agent: "general-purpose", task: "Inspect the parser", async: false, context: "fresh" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(result.details.results[0]?.finalOutput).toBe("result-1");
		expect(result.isError).not.toBe(true);
	});

	test("preserves explicit external-crash proof through foreground projection and session memory", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-crash-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runState = state();
		const result = await executor(cwd, runState, undefined, { foregroundCrash: true }).execute(
			"foreground-crash-call",
			{ agent: "general-purpose", task: "Inspect the crash", async: false, context: "fresh" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("crashed") });
		expect(result.details.results[0]?.crashed).toBe(true);
		expect(runState.foregroundRuns?.get(result.details.runId ?? "")?.children[0]?.crashed).toBe(true);
	});

	test("does not call an expected foreground termination a crash", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-expected-stop-"));
		temporaryDirectories.push(cwd);
		const config = {
			version: 2 as const,
			id: "expected-stop",
			cwd,
			asyncDir: path.join(cwd, "async"),
			resultPath: path.join(cwd, "result.json"),
			work: {
				mode: "single" as const,
				task: {
					agent: "general-purpose",
					task: "Wait",
					cwd,
					inheritProjectContext: true,
					inheritSkills: false,
				},
			},
		};
		const result = projectForegroundCompletion(config, {
			id: config.id,
			runId: config.id,
			mode: "single",
			state: "failed",
			success: false,
			timedOut: true,
			results: [
				{
					agent: "general-purpose",
					output: "Timed out",
					success: false,
					exitCode: 1,
					timedOut: true,
					writerProcesses: [
						{
							attempt: 0,
							closeObservedAt: Date.now(),
							exitCode: null,
							kind: "pi-writer",
							processInstanceId: "manager-stop",
							signal: "SIGTERM",
							terminationOrigin: "external",
						},
					],
				},
			],
		});
		expect(result.details.results[0]?.crashed).toBeUndefined();
	});

	test("contains a synchronous cancellation transport failure and still settles foreground execution", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-cancel-transport-"));
		temporaryDirectories.push(cwd);
		let release: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const config = {
			version: 2 as const,
			id: "cancel-transport",
			cwd,
			asyncDir: path.join(cwd, "async"),
			resultPath: path.join(cwd, "result.json"),
			work: {
				mode: "single" as const,
				task: {
					agent: "general-purpose",
					task: "Wait for cancellation",
					cwd,
					inheritProjectContext: true,
					inheritSkills: false,
				},
			},
		};
		const controller = new AbortController();
		const running = executeForegroundConfig(config, controller.signal, {
			runConfigured: async () => blocked,
			requestStop: () => {
				throw Object.assign(new Error("injected control EIO"), { code: "EIO" });
			},
			readCompletion: () => ({
				id: config.id,
				runId: config.id,
				mode: "single",
				state: "complete",
				success: true,
				results: [{ agent: "general-purpose", output: "settled", success: true, exitCode: 0 }],
			}),
		});
		await Promise.resolve();
		controller.abort();
		release?.();

		const result = await running;
		expect(result.isError).toBeUndefined();
		expect(result.details).toMatchObject({ cwd, results: [{ finalOutput: "settled" }] });
		expect(result.details.stopped).toBeUndefined();
		expect(result.content.some((part) => "text" in part && part.text.includes("injected control EIO"))).toBeTrue();
	});

	test("returns a terminal failure when foreground status persistence or claim release fails", async () => {
		for (const fault of ["status-write", "claim-release"] as const) {
			const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `pi-stuff-foreground-${fault}-`));
			temporaryDirectories.push(cwd);
			const id = `foreground-${fault}`;
			const config: BackgroundRunnerConfig = {
				version: 2,
				id,
				cwd,
				asyncDir: path.join(cwd, id),
				resultPath: path.join(cwd, "result.json"),
				work: {
					mode: "single",
					task: {
						agent: "general-purpose",
						task: "Fail after starting",
						cwd,
						inheritProjectContext: true,
						inheritSkills: false,
					},
				},
			};
			fs.mkdirSync(config.asyncDir, { recursive: true, mode: 0o700 });
			const status = createInitialStatus(config, Date.now());
			const firstStep = status.steps.at(0);
			if (!firstStep) throw new Error("Expected an initial foreground step");
			firstStep.status = "running";
			fs.writeFileSync(path.join(config.asyncDir, "status.json"), JSON.stringify(status), { mode: 0o600 });
			let releaseCalls = 0;

			const result = await executeForegroundConfig(config, undefined, {
				acquireStatusClaim: () => ({
					release: () => {
						releaseCalls += 1;
						if (fault === "claim-release") {
							throw Object.assign(new Error("injected claim release EIO"), { code: "EIO" });
						}
					},
				}),
				reapWriters: async () => ({ remaining: 0, terminated: 1 }),
				runConfigured: async () => {
					throw new Error("injected foreground engine failure");
				},
				writeStatus: (filePath, value) => {
					if (fault === "status-write") {
						throw Object.assign(new Error("injected status write EIO"), { code: "EIO" });
					}
					fs.writeFileSync(filePath, JSON.stringify(value), { mode: 0o600 });
				},
			});

			expect(result.isError).toBe(true);
			expect(result.details.results[0]?.error).toContain("injected foreground engine failure");
			expect(releaseCalls).toBe(1);
			expect(fs.existsSync(path.join(config.asyncDir, ".foreground-owner-ended.json"))).toBeTrue();
			if (fault === "claim-release") {
				expect(JSON.parse(fs.readFileSync(path.join(config.asyncDir, "status.json"), "utf8")).state).toBe("failed");
			}
		}
	});

	for (const statusFault of ["missing", "corrupt"] as const) {
		test(`records owner exit and reaps writers when foreground status is ${statusFault}`, async () => {
			const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `pi-stuff-foreground-${statusFault}-status-`));
			temporaryDirectories.push(cwd);
			const id = `foreground-${statusFault}`;
			const config: BackgroundRunnerConfig = {
				version: 2,
				id,
				cwd,
				asyncDir: path.join(cwd, id),
				resultPath: path.join(cwd, "result.json"),
				work: {
					mode: "single",
					task: {
						agent: "general-purpose",
						task: "Fail after status loss",
						cwd,
						inheritProjectContext: true,
						inheritSkills: false,
					},
				},
			};
			fs.mkdirSync(config.asyncDir, { recursive: true, mode: 0o700 });
			if (statusFault === "corrupt") {
				fs.writeFileSync(path.join(config.asyncDir, "status.json"), "{not-json", { mode: 0o600 });
			}
			let reapCalls = 0;

			const result = await executeForegroundConfig(config, undefined, {
				reapWriters: async () => {
					reapCalls += 1;
					return { remaining: 1, terminated: 1 };
				},
				runConfigured: async () => {
					throw new Error("injected foreground engine failure after status loss");
				},
			});

			expect(result.isError).toBe(true);
			expect(result.details.results).toEqual([]);
			expect(reapCalls).toBe(1);
			expect(fs.existsSync(path.join(config.asyncDir, ".foreground-owner-ended.json"))).toBeTrue();
		});
	}

	test("does not let a failing progress observer change or leak a foreground Agent run", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-update-observer-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runState = state();
		let updateCalls = 0;
		const result = await executor(cwd, runState).execute(
			"update-observer-call",
			{ agent: "general-purpose", task: "Inspect the parser", async: false, context: "fresh" },
			new AbortController().signal,
			() => {
				updateCalls += 1;
				throw new Error("progress observer failed");
			},
			context(cwd),
		);

		expect(updateCalls).toBe(2);
		expect(result.details.results[0]?.finalOutput).toBe("result-1");
		expect(result.isError).not.toBe(true);
		expect(runState.foregroundControls.size).toBe(0);
		expect(runState.lastForegroundControlId).toBeNull();
	});

	test("preserves the real foreground start time in completed nested lifecycle projection", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-nested-timing-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const route = createNestedRoute("nested-timing-root");
		temporaryDirectories.push(path.dirname(route.eventSink));
		writeNestedEvent(route, {
			type: "subagent.nested.started",
			ts: Date.now(),
			parentRunId: route.rootRunId,
			parentStepIndex: 0,
			child: {
				id: "nested-timing-parent",
				parentRunId: route.rootRunId,
				parentStepIndex: 0,
				depth: 1,
				path: [{ runId: route.rootRunId, stepIndex: 0 }],
				state: "running",
				ownerState: "live",
			},
		});
		const environment = {
			[SUBAGENT_PARENT_ROOT_RUN_ID_ENV]: route.rootRunId,
			[SUBAGENT_PARENT_EVENT_SINK_ENV]: route.eventSink,
			[SUBAGENT_PARENT_CONTROL_INBOX_ENV]: route.controlInbox,
			[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV]: route.capabilityToken,
			[SUBAGENT_PARENT_RUN_ID_ENV]: "nested-timing-parent",
			[SUBAGENT_PARENT_CHILD_INDEX_ENV]: "0",
			[SUBAGENT_PARENT_DEPTH_ENV]: "1",
		};
		const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]] as const));
		Object.assign(process.env, environment);
		try {
			await executor(cwd, state(), undefined, { foregroundDelayMs: 75 }).execute(
				"nested-timing-call",
				{ agent: "general-purpose", task: "Inspect the parser", async: false, context: "fresh" },
				new AbortController().signal,
				undefined,
				context(cwd),
			);
			const child = projectNestedEvents(route).children[0]?.children?.[0];
			expect(child).toMatchObject({ state: "complete", ownerState: "gone" });
			expect(child?.endedAt).toBeNumber();
			expect((child?.endedAt ?? 0) - (child?.startedAt ?? 0)).toBeGreaterThanOrEqual(50);
		} finally {
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	test("parallel foreground execution completes as one bounded group", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-parallel-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runState = state();
		const result = await executor(cwd, runState).execute(
			"parallel-call",
			{
				async: false,
				context: "fresh",
				tasks: [
					{ agent: "general-purpose", task: "Implement" },
					{ agent: "general-purpose", task: "Review" },
				],
			},
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(result.isError).not.toBe(true);
		expect(result.details.mode).toBe("parallel");
		expect(result.details.results.map((child) => child.finalOutput)).toEqual(["result-1", "result-2"]);
	});

	test("fits the private Context projection to the tightest child fallback model", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let captured:
			| {
					description?: string;
					nestedRoute?: { rootRunId: string; eventSink: string; controlInbox: string; capabilityToken: string };
					task: string;
			  }
			| undefined;
		const requestedBudgets: number[] = [];
		const smallAgent = { ...agent(), model: "test/large", fallbackModels: ["test/small"] };
		await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: smallAgent,
				projectContext: async (_audience, _ctx, projectionOptions) => {
					requestedBudgets.push(projectionOptions?.maxTokens ?? -1);
					return {
						source: "magic-context",
						text: '<pi-stuff-context trust="reference-only">memory</pi-stuff-context>',
						truncated: false,
					};
				},
			},
		).execute(
			"context-call",
			{
				agent: "general-purpose",
				context: "fresh",
				task: "Inspect the parser",
			},
			new AbortController().signal,
			undefined,
			context(cwd, [
				{ provider: "test", id: "large", contextWindow: 128_000, maxTokens: 8_000 },
				{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 },
			]),
		);

		expect(requestedBudgets).toHaveLength(1);
		expect(requestedBudgets[0]).toBeGreaterThan(0);
		expect(requestedBudgets[0]).toBeLessThanOrEqual(4_000);
		expect(captured?.task).toBe(
			'<pi-stuff-context trust="reference-only">memory</pi-stuff-context>\n\nInspect the parser',
		);
	});

	test("uses a native raw fork when the parent history fits without adding duplicate projection", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-fork-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const requestedBudgets: number[] = [];
		let captured: { sessionFile?: string; task: string } | undefined;
		let openSessionCalls = 0;
		const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 3_500);
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return {
				createBranchedSession: () => {
					const child = path.join(cwd, "child.jsonl");
					fs.writeFileSync(child, "");
					return child;
				},
			};
		};
		await executor(cwd, state(), (launch) => (captured = launch), {
			agent: { ...agent(), model: "test/small" },
			projectContext: async (_audience, _ctx, projectionOptions) => {
				requestedBudgets.push(projectionOptions?.maxTokens ?? -1);
				return { source: "magic-context", text: "memory", truncated: false };
			},
		}).execute(
			"fork-budget-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(requestedBudgets).toHaveLength(0);
		expect(openSessionCalls).toBe(1);
		expect(captured?.sessionFile).toBe(path.join(cwd, "child.jsonl"));
		expect(captured?.task).not.toContain("memory");
	});

	test("converts an oversized raw fork into a bounded projected fork without cloning history", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fork-too-large-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let captured: { sessionFile?: string; task: string } | undefined;
		let openSessionCalls = 0;
		const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 7_000);
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return { createBranchedSession: () => path.join(cwd, "child.jsonl") };
		};
		let frozenProjectionMessages: readonly unknown[] | undefined;
		const result = await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: { ...agent(), model: "test/small" },
				projectContext: async (_audience, _context, options) => {
					frozenProjectionMessages = options?.sourceMessages;
					return {
						source: "magic-context",
						text: `<bounded max="${String(options?.maxTokens)}">parent memory</bounded>`,
						truncated: true,
					};
				},
			},
		).execute(
			"oversized-fork-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBe(true);
		expect(openSessionCalls).toBe(0);
		expect(fs.existsSync(path.join(cwd, "child.jsonl"))).toBeFalse();
		expect(captured?.sessionFile).toBeUndefined();
		expect(captured?.task).toContain("parent memory");
		expect(captured?.task).toContain("delegated subagent running from a fork");
		expect(frozenProjectionMessages).toEqual([]);
	});

	test("projects multilingual parent history instead of admitting an overflowing raw fork", async () => {
		for (const { label, history } of [
			{ label: "cjk", history: "上下文".repeat(1_500) },
			{ label: "emoji", history: "🧭".repeat(2_100) },
		]) {
			const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `pi-stuff-parent-${label}-`));
			temporaryDirectories.push(cwd);
			fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
			const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 100);
			(ctx.sessionManager as unknown as { buildContextEntries: () => unknown[] }).buildContextEntries = () => [
				{ type: "message", message: { role: "user", content: history } },
			];
			let openSessionCalls = 0;
			(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
				openSessionCalls += 1;
				return { createBranchedSession: () => path.join(cwd, "child.jsonl") };
			};
			let projectedSource = "";

			const result = await executor(cwd, state(), undefined, {
				agent: { ...agent(), model: "test/small" },
				projectContext: async (_audience, _context, options) => {
					projectedSource = JSON.stringify(options?.sourceMessages ?? []);
					return { source: "native", text: "bounded multilingual history", truncated: true };
				},
			}).execute(
				`parent-${label}`,
				{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
				new AbortController().signal,
				undefined,
				ctx,
			);

			expect(result.isError, label).not.toBeTrue();
			expect(openSessionCalls, label).toBe(0);
			expect(projectedSource, label).toContain(history.slice(0, 4));
		}
	});

	test("conservatively preflights multilingual and high-entropy fork inputs", async () => {
		const cases = [
			{ label: "Chinese", task: "界".repeat(4_100) },
			{ label: "rare-CJK", task: "𠮷".repeat(2_000) },
			{ label: "emoji", task: "🧭".repeat(2_050) },
			{ label: "mixed", task: `${"界".repeat(2_000)}${"a".repeat(8_000)}` },
			{ label: "Base64", task: "AP6Zz9+/0f3cD7aQ".repeat(400) },
		];
		for (const { label, task } of cases) {
			const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `pi-stuff-foreground-${label.toLowerCase()}-`));
			temporaryDirectories.push(cwd);
			fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
			let engineCalls = 0;
			const result = await executor(
				cwd,
				state(),
				() => {
					engineCalls += 1;
				},
				{ agent: { ...agent(), model: "test/small" } },
			).execute(
				`multilingual-${label}`,
				{ agent: "general-purpose", context: "fork", task },
				new AbortController().signal,
				undefined,
				context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 0),
			);

			expect(result.isError, label).toBe(true);
			expect(engineCalls, label).toBe(0);
		}
	});

	test("does not bind or leave runtime state when foreground preflight fails", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-preflight-clean-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const callId = `unknown-${Date.now()}-${Math.random()}`;
		const runId = deriveLaunchRunId(callId, { sessionId: cwd, ownerAgentPath: [] });
		let binds = 0;
		const result = await executor(cwd, state()).execute(
			callId,
			{ agent: "missing", task: "Never launch", async: false },
			new AbortController().signal,
			undefined,
			context(cwd),
			{
				beforeForegroundStart: () => {
					binds += 1;
				},
			},
		);

		expect(result.isError).toBe(true);
		expect(binds).toBe(0);
		expect(fs.existsSync(path.join(TEMP_ROOT_DIR, "foreground-runs", runId))).toBeFalse();
		expect(fs.existsSync(path.join(cwd, "sessions", runId))).toBeFalse();
	});

	test("does not bind or commit runtime state when foreground launch is already cancelled", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-pre-abort-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const callId = `pre-abort-${Date.now()}-${Math.random()}`;
		const runId = deriveLaunchRunId(callId, { sessionId: cwd, ownerAgentPath: [] });
		const controller = new AbortController();
		controller.abort();
		let binds = 0;

		const result = await executor(cwd, state()).execute(
			callId,
			{ agent: "general-purpose", task: "Never launch", async: false },
			controller.signal,
			undefined,
			context(cwd),
			{
				beforeForegroundStart: () => {
					binds += 1;
				},
			},
		);

		expect(result).toMatchObject({ isError: true, details: { stopped: true, results: [] } });
		expect(binds).toBe(0);
		expect(fs.existsSync(path.join(TEMP_ROOT_DIR, "foreground-runs", runId))).toBeFalse();
	});

	test("removes a newly prepared foreground directory when governor binding fails", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-bind-clean-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const callId = `bind-failure-${Date.now()}-${Math.random()}`;
		const runId = deriveLaunchRunId(callId, { sessionId: cwd, ownerAgentPath: [] });
		const result = await executor(cwd, state()).execute(
			callId,
			{ agent: "general-purpose", task: "Never launch", async: false },
			new AbortController().signal,
			undefined,
			context(cwd),
			{ beforeForegroundStart: () => Promise.reject(new Error("injected governor EIO")) },
		);

		expect(result.isError).toBe(true);
		expect(fs.existsSync(path.join(TEMP_ROOT_DIR, "foreground-runs", runId))).toBeFalse();
		expect(fs.existsSync(path.join(cwd, "sessions", runId))).toBeFalse();
	});

	test("retires an unused nested route when the foreground engine throws before durable work starts", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-started-route-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let routeDirectory: string | undefined;
		const result = await executor(cwd, state(), undefined, {
			foregroundError: new Error("injected engine failure after start"),
			onForegroundConfig: (config) => {
				routeDirectory = config.nestedRoute ? path.dirname(config.nestedRoute.eventSink) : undefined;
				if (routeDirectory) temporaryDirectories.push(routeDirectory);
			},
		}).execute(
			`started-route-${Date.now()}-${Math.random()}`,
			{ agent: "general-purpose", task: "Start then fail", async: false },
			new AbortController().signal,
			undefined,
			context(cwd),
			{ beforeForegroundStart: () => {} },
		);

		expect(result.isError).toBe(true);
		expect(routeDirectory).toBeDefined();
		expect(fs.existsSync(routeDirectory ?? "")).toBeFalse();
	});

	test("preserves a colliding foreground runtime instead of overwriting or deleting its evidence", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-collision-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const callId = `collision-${Date.now()}-${Math.random()}`;
		const runId = deriveLaunchRunId(callId, { sessionId: cwd, ownerAgentPath: [] });
		const runtimeDir = path.join(TEMP_ROOT_DIR, "foreground-runs", runId);
		fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
		temporaryDirectories.push(runtimeDir);
		const sentinel = path.join(runtimeDir, "live-recovery-evidence.json");
		fs.writeFileSync(sentinel, JSON.stringify({ state: "running", pid: process.pid }), { mode: 0o600 });
		let binds = 0;

		const result = await executor(cwd, state()).execute(
			callId,
			{ agent: "general-purpose", task: "Must not launch", async: false },
			new AbortController().signal,
			undefined,
			context(cwd),
			{
				beforeForegroundStart: () => {
					binds += 1;
				},
			},
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("refusing to overwrite") });
		expect(binds).toBe(0);
		expect(JSON.parse(fs.readFileSync(sentinel, "utf8"))).toEqual({ state: "running", pid: process.pid });
	});

	test("allows fresh context at the same parent usage because it does not clone the branch", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fresh-large-parent-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let engineCalls = 0;
		const result = await executor(
			cwd,
			state(),
			() => {
				engineCalls += 1;
			},
			{ agent: { ...agent(), model: "test/small" } },
		).execute(
			"large-parent-fresh-call",
			{ agent: "general-purpose", context: "fresh", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 7_000),
		);

		expect(result.isError).not.toBe(true);
		expect(engineCalls).toBe(1);
	});

	test("uses one projected fork so heterogeneous fallback candidates keep their order", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fork-filter-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let captured: { modelCandidates?: string[]; sessionFile?: string; task: string } | undefined;
		const result = await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: { ...agent(), model: "test/large", fallbackModels: ["test/small"] },
				projectContext: async () => ({ source: "native", text: "bounded parent", truncated: true }),
			},
		).execute(
			"fork-filter-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(
				cwd,
				[
					{ provider: "test", id: "large", contextWindow: 128_000, maxTokens: 8_000 },
					{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 },
				],
				7_000,
			),
		);

		expect(result.isError).not.toBe(true);
		expect(captured?.modelCandidates).toEqual(["test/large", "test/small"]);
		expect(captured?.sessionFile).toBeUndefined();
		expect(captured?.task).toContain("bounded parent");
	});

	test("uses the persisted branch estimator to avoid cloning an oversized raw branch", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fork-estimate-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let engineCalls = 0;
		const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }]);
		(ctx.sessionManager as unknown as { buildContextEntries: () => unknown[] }).buildContextEntries = () => [
			{ type: "message", message: { role: "user", content: "x".repeat(80_000) } },
		];
		const result = await executor(
			cwd,
			state(),
			() => {
				engineCalls += 1;
			},
			{ agent: { ...agent(), model: "test/small" } },
		).execute(
			"estimated-fork-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBe(true);
		expect(engineCalls).toBe(1);
	});

	test("does not mistake Magic Context's effective usage for the larger persisted raw branch", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fork-effective-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let captured: { sessionFile?: string; task: string } | undefined;
		let openSessionCalls = 0;
		const ctx = context(cwd, [{ provider: "test", id: "large", contextWindow: 128_000, maxTokens: 8_000 }], 70_000);
		(ctx.sessionManager as unknown as { buildContextEntries: () => unknown[] }).buildContextEntries = () => [
			{ type: "message", message: { role: "user", content: "x".repeat(2_000_000) } },
		];
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return { createBranchedSession: () => path.join(cwd, "child.jsonl") };
		};
		const result = await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: { ...agent(), model: "test/large" },
				projectContext: async () => ({
					source: "magic-context",
					text: "bounded managed history",
					truncated: true,
				}),
			},
		).execute(
			"effective-fork-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBe(true);
		expect(openSessionCalls).toBe(0);
		expect(captured?.sessionFile).toBeUndefined();
		expect(captured?.task).toContain("bounded managed history");
	});

	test("uses a bounded projection when the persisted raw branch cannot be measured", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fork-unmeasured-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let captured: { sessionFile?: string; task: string } | undefined;
		let openSessionCalls = 0;
		const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 500);
		(ctx.sessionManager as unknown as { buildContextEntries: () => unknown[] }).buildContextEntries = () => {
			throw new Error("injected branch read failure");
		};
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return { createBranchedSession: () => path.join(cwd, "child.jsonl") };
		};

		const result = await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: { ...agent(), model: "test/small" },
				projectContext: async () => ({
					source: "magic-context",
					text: "bounded fallback history",
					truncated: true,
				}),
			},
		).execute(
			"unmeasured-fork-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBe(true);
		expect(openSessionCalls).toBe(0);
		expect(captured?.sessionFile).toBeUndefined();
		expect(captured?.task).toContain("bounded fallback history");
	});

	test("accounts for resolved skill metadata before creating a fork session", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fork-skill-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const skillRoot = path.join(cwd, "skills");
		const skillName = `large-skill-${path.basename(cwd)}`;
		const skillDirectory = path.join(skillRoot, skillName);
		fs.mkdirSync(skillDirectory, { recursive: true });
		fs.writeFileSync(
			path.join(skillDirectory, "SKILL.md"),
			`---\ndescription: ${"x".repeat(20_000)}\n---\nInstructions\n`,
		);
		let openSessionCalls = 0;
		const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 500);
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return { createBranchedSession: () => path.join(cwd, "child.jsonl") };
		};
		const result = await executor(cwd, state(), undefined, {
			agent: {
				...agent(),
				model: "test/small",
				skills: [skillName],
				skillPath: [skillRoot],
			},
		}).execute(
			"skill-overflow-fork-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).toBe(true);
		expect(openSessionCalls).toBe(0);
	});

	test("accounts for the Host system prompt before admitting a child launch", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-host-prompt-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 100);
		(ctx as unknown as { getSystemPrompt: () => string }).getSystemPrompt = () => "p".repeat(20_000);
		let engineCalls = 0;

		const result = await executor(
			cwd,
			state(),
			() => {
				engineCalls += 1;
			},
			{ agent: { ...agent(), model: "test/small" } },
		).execute(
			"host-prompt-overflow",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).toBeTrue();
		expect(engineCalls).toBe(0);
	});

	test("accounts for the selected tool schema before admitting a child launch", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-tool-schema-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let engineCalls = 0;
		const pi = {
			events: { emit: () => {} },
			getActiveTools: () => ["read"],
			getAllTools: () => [
				{
					name: "read",
					description: "Read a file.",
					parameters: { type: "object", properties: { path: { type: "string" } } },
					promptGuidelines: ["s".repeat(20_000)],
				},
			],
		} as unknown as ExtensionAPI;

		const result = await executor(
			cwd,
			state(),
			() => {
				engineCalls += 1;
			},
			{ agent: { ...agent(), model: "test/small", tools: ["read"] }, pi },
		).execute(
			"tool-schema-overflow",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 100),
		);

		expect(result.isError).toBeTrue();
		expect(engineCalls).toBe(0);
	});

	test("accounts for the read Tool forced into a skill-enabled child", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-skill-read-tool-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const skillRoot = path.join(cwd, "skills");
		const skillName = "small-skill";
		fs.mkdirSync(path.join(skillRoot, skillName), { recursive: true });
		fs.writeFileSync(path.join(skillRoot, skillName, "SKILL.md"), "---\ndescription: Small skill\n---\nUse it.\n");
		let engineCalls = 0;
		const pi = {
			events: { emit: () => {} },
			getActiveTools: () => ["write"],
			getAllTools: () => [
				{ name: "write", description: "Write.", parameters: {} },
				{ name: "read", description: "Read.", parameters: {}, promptGuidelines: ["r".repeat(20_000)] },
			],
		} as unknown as ExtensionAPI;

		const result = await executor(
			cwd,
			state(),
			() => {
				engineCalls += 1;
			},
			{
				agent: {
					...agent(),
					model: "test/small",
					tools: ["write"],
					skills: [skillName],
					skillPath: [skillRoot],
				},
				pi,
			},
		).execute(
			"skill-read-tool-overflow",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 100),
		);

		expect(result.isError).toBeTrue();
		expect(engineCalls).toBe(0);
	});

	test("does not charge a replaced Host base prompt when inherited context and Skills are disabled", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-replace-prompt-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const ctx = context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 100);
		(ctx as unknown as { getSystemPrompt: () => string }).getSystemPrompt = () => "parent".repeat(4_000);
		let engineCalls = 0;

		const result = await executor(
			cwd,
			state(),
			() => {
				engineCalls += 1;
			},
			{
				agent: {
					...agent(),
					model: "test/small",
					systemPromptMode: "replace",
					inheritProjectContext: false,
					inheritSkills: false,
				},
			},
		).execute(
			"replace-prompt-fits",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBeTrue();
		expect(engineCalls).toBe(1);
	});

	test("projects a replace-mode fork when retained project context makes the raw child too large", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-replace-context-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const ctx = context(cwd, [{ provider: "test", id: "large", contextWindow: 32_000, maxTokens: 4_000 }], 17_000);
		(ctx as unknown as { getSystemPrompt: () => string }).getSystemPrompt = () => "default base".repeat(20_000);
		(ctx as unknown as { getSystemPromptOptions: () => unknown }).getSystemPromptOptions = () => ({
			cwd,
			customPrompt: "default base".repeat(20_000),
			contextFiles: [{ path: path.join(cwd, "AGENTS.md"), content: "p".repeat(4_000) }],
			skills: [],
		});
		let openSessionCalls = 0;
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return { createBranchedSession: () => path.join(cwd, "child.jsonl") };
		};
		let captured: { sessionFile?: string; task: string } | undefined;
		let projectionCalls = 0;

		const result = await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: { ...agent(), model: "test/large", systemPromptMode: "replace" },
				projectContext: async () => {
					projectionCalls += 1;
					return { source: "magic-context", text: "bounded parent", truncated: true };
				},
			},
		).execute(
			"replace-context-projects",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBeTrue();
		expect(openSessionCalls).toBe(0);
		expect(projectionCalls).toBe(1);
		expect(captured?.sessionFile).toBeUndefined();
		expect(captured?.task).toContain("bounded parent");
	});

	test("accounts for replace-mode project context from the child's actual cwd", async () => {
		const parentCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-parent-cwd-"));
		const childCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-child-cwd-"));
		temporaryDirectories.push(parentCwd, childCwd);
		fs.writeFileSync(path.join(parentCwd, "parent.jsonl"), "");
		fs.writeFileSync(path.join(parentCwd, "AGENTS.md"), "small parent rule");
		fs.writeFileSync(path.join(childCwd, "AGENTS.md"), `large child rule\n${"x".repeat(9_000)}`);
		const ctx = context(
			parentCwd,
			[{ provider: "test", id: "large", contextWindow: 32_000, maxTokens: 4_000 }],
			13_000,
		);
		(ctx as unknown as { getSystemPromptOptions: () => unknown }).getSystemPromptOptions = () => ({
			cwd: parentCwd,
			contextFiles: [{ path: path.join(parentCwd, "AGENTS.md"), content: "small parent rule" }],
			skills: [],
		});
		let openSessionCalls = 0;
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return { createBranchedSession: () => path.join(parentCwd, "child.jsonl") };
		};
		let projectionCalls = 0;
		let captured: { sessionFile?: string; task: string } | undefined;

		const result = await executor(
			parentCwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: {
					...agent(),
					model: "test/large",
					systemPromptMode: "replace",
					inheritSkills: false,
				},
				projectContext: async () => {
					projectionCalls += 1;
					return { source: "magic-context", text: "bounded parent", truncated: true };
				},
			},
		).execute(
			"replace-child-cwd-projects",
			{ agent: "general-purpose", context: "fork", cwd: childCwd, task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBeTrue();
		expect(openSessionCalls).toBe(0);
		expect(projectionCalls).toBe(1);
		expect(captured?.sessionFile).toBeUndefined();
		expect(captured?.task).toContain("bounded parent");
	});

	test("supports one native and one projected child in the same parallel fork", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-fork-parallel-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let openSessionCalls = 0;
		const ctx = context(
			cwd,
			[
				{ provider: "test", id: "large", contextWindow: 128_000, maxTokens: 8_000 },
				{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 },
			],
			7_000,
		);
		(ctx.sessionManager as unknown as { openSession: () => unknown }).openSession = () => {
			openSessionCalls += 1;
			return {
				createBranchedSession: () => {
					const child = path.join(cwd, "child.jsonl");
					fs.writeFileSync(child, "");
					return child;
				},
			};
		};
		const runState = state();
		const result = await executor(cwd, runState, undefined, {
			agent: { ...agent(), model: "test/small" },
			projectContext: async () => ({ source: "magic-context", text: "bounded parent", truncated: true }),
		}).execute(
			"parallel-oversized-fork-call",
			{
				async: false,
				context: "fork",
				tasks: [
					{ agent: "general-purpose", model: "test/large", task: "Fits" },
					{ agent: "general-purpose", model: "test/small", task: "Does not fit" },
				],
			},
			new AbortController().signal,
			undefined,
			ctx,
		);

		expect(result.isError).not.toBe(true);
		expect(openSessionCalls).toBe(1);
		expect(runState.foregroundRuns?.size).toBe(1);
	});

	test("launches without a projection when model limits are unknown", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-unknown-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let projections = 0;
		let captured: { task: string } | undefined;
		await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				projectContext: async () => {
					projections++;
					throw new Error("projection should not be requested");
				},
			},
		).execute(
			"unknown-budget-call",
			{ agent: "general-purpose", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(projections).toBe(0);
		expect(captured?.task).toBe("Inspect the parser");
	});

	test("launches without a projection when Context fails open", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-failure-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let projections = 0;
		let captured: { task: string } | undefined;
		await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: { ...agent(), model: "test/small" },
				projectContext: async () => {
					projections++;
					throw new Error("Magic unavailable");
				},
			},
		).execute(
			"failed-projection-call",
			{ agent: "general-purpose", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }]),
		);

		expect(projections).toBe(1);
		expect(captured?.task).toBe("Inspect the parser");
	});

	test("resume labels the revived Agent from the follow-up while preserving the recovery task", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-resume-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const childSession = path.join(cwd, "child.jsonl");
		fs.writeFileSync(childSession, "");
		const runState = state();
		const sessionIdentity = path.join(cwd, "parent.jsonl");
		runState.currentSessionId = sessionIdentity;
		runState.foregroundRuns?.set("source-run", {
			children: [
				{
					agent: "general-purpose",
					index: 0,
					sessionFile: childSession,
					status: "completed",
					task: "Inspect every parser edge case in full detail",
				},
			],
			cwd,
			mode: "single",
			runId: "source-run",
			sessionId: sessionIdentity,
			updatedAt: 1_000,
		});
		let captured:
			| {
					description?: string;
					nestedRoute?: { rootRunId: string; eventSink: string; controlInbox: string; capabilityToken: string };
					task: string;
			  }
			| undefined;
		const result = await executor(cwd, runState, (launch) => {
			captured = launch;
		}).execute(
			"resume-call",
			{ action: "resume", id: "source-run", message: "复核恢复结果 🧪" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		if (result.isError) {
			throw new Error(result.content.map((part) => ("text" in part ? part.text : "")).join("\n"));
		}
		expect(captured?.description).toBe("复核恢复结果 🧪");
		expect(captured?.task).toContain("复核恢复结果 🧪");
		expect(captured?.task).toContain("source-run");
		expect(captured?.nestedRoute?.rootRunId).toBe(result.details.asyncId);
		if (captured?.nestedRoute) temporaryDirectories.push(path.dirname(captured.nestedRoute.eventSink));
	});

	test("keeps an inherited nested route when a child Agent is resumed and can fan out again", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-nested-resume-"));
		temporaryDirectories.push(cwd);
		const sessionIdentity = path.join(cwd, "parent.jsonl");
		const childSession = path.join(cwd, "child.jsonl");
		fs.writeFileSync(sessionIdentity, "");
		fs.writeFileSync(childSession, "");
		const route = createNestedRoute("nested-resume-root");
		temporaryDirectories.push(path.dirname(route.eventSink));
		const runState = state();
		runState.currentSessionId = sessionIdentity;
		runState.foregroundRuns?.set("nested-resume-source", {
			children: [
				{
					agent: "general-purpose",
					index: 0,
					sessionFile: childSession,
					status: "completed",
					task: "Continue nested work",
				},
			],
			cwd,
			mode: "single",
			runId: "nested-resume-source",
			sessionId: sessionIdentity,
			updatedAt: 1_000,
		});
		const environment = {
			[SUBAGENT_PARENT_ROOT_RUN_ID_ENV]: route.rootRunId,
			[SUBAGENT_PARENT_EVENT_SINK_ENV]: route.eventSink,
			[SUBAGENT_PARENT_CONTROL_INBOX_ENV]: route.controlInbox,
			[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV]: route.capabilityToken,
			[SUBAGENT_PARENT_RUN_ID_ENV]: "nested-owner",
			[SUBAGENT_PARENT_CHILD_INDEX_ENV]: "0",
			[SUBAGENT_PARENT_DEPTH_ENV]: "1",
		};
		const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]] as const));
		let captured: { nestedRoute?: typeof route } | undefined;
		try {
			Object.assign(process.env, environment);
			const result = await executor(cwd, runState, (launch) => {
				captured = launch;
			}).execute(
				"nested-resume-call",
				{ action: "resume", id: "nested-resume-source", message: "Continue and delegate" },
				new AbortController().signal,
				undefined,
				context(cwd),
			);
			expect(result.isError).not.toBeTrue();
			expect(captured?.nestedRoute).toEqual(route);
		} finally {
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	test("rejects user-stopped foreground resume before and after cold replay", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-stopped-resume-"));
		temporaryDirectories.push(cwd);
		const sessionIdentity = path.join(cwd, "parent.jsonl");
		const childSession = path.join(cwd, "child.jsonl");
		fs.writeFileSync(sessionIdentity, "");
		fs.writeFileSync(childSession, "");
		const stoppedChild = {
			agent: "general-purpose",
			exitCode: 143,
			index: 0,
			sessionFile: childSession,
			status: "stopped" as const,
			task: "Inspect every parser edge case",
		};
		const warmState = state();
		warmState.currentSessionId = sessionIdentity;
		warmState.foregroundRuns?.set("stopped-run", {
			children: [stoppedChild],
			cwd,
			mode: "single",
			runId: "stopped-run",
			sessionId: sessionIdentity,
			updatedAt: 1_000,
		});
		const coldState = state();
		coldState.currentSessionId = sessionIdentity;
		coldState.foregroundRuns = replayForegroundRuns(
			[
				{
					type: "message",
					timestamp: "2026-08-06T10:00:00.000Z",
					message: {
						role: "toolResult",
						toolName: "subagent",
						details: {
							cwd,
							mode: "single",
							results: [{ ...stoppedChild, stopped: true }],
							runId: "stopped-run",
						},
					},
				},
			],
			sessionIdentity,
		);

		let launches = 0;
		for (const runState of [warmState, coldState]) {
			const result = await executor(cwd, runState, () => {
				launches += 1;
			}).execute(
				"stopped-resume-call",
				{ action: "resume", id: "stopped-run", message: "Continue" },
				new AbortController().signal,
				undefined,
				context(cwd),
			);
			expect(result.isError).toBeTrue();
			expect(result.content.map((part) => ("text" in part ? part.text : "")).join("\n")).toContain(
				"stopped by the user and cannot be resumed",
			);
		}
		expect(launches).toBe(0);
	});

	test("cold-replayed foreground resume preserves its exact non-default cwd", async () => {
		const parentCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-cold-resume-"));
		temporaryDirectories.push(parentCwd);
		const effectiveCwd = path.join(parentCwd, "packages", "target");
		fs.mkdirSync(effectiveCwd, { recursive: true });
		fs.writeFileSync(path.join(parentCwd, "parent.jsonl"), "");
		const childSession = path.join(effectiveCwd, "child.jsonl");
		fs.writeFileSync(childSession, "");
		const config = {
			version: 2 as const,
			id: "cold-source-run",
			cwd: effectiveCwd,
			asyncDir: path.join(parentCwd, "async"),
			resultPath: path.join(parentCwd, "result.json"),
			work: {
				mode: "single" as const,
				task: {
					agent: "general-purpose",
					task: "Inspect from the package directory",
					cwd: effectiveCwd,
					inheritProjectContext: true,
					inheritSkills: false,
				},
			},
		};
		const persisted = projectForegroundCompletion(config, {
			id: config.id,
			runId: config.id,
			mode: "single",
			state: "complete",
			success: true,
			results: [
				{
					agent: "general-purpose",
					output: "done",
					success: true,
					exitCode: 0,
					sessionFile: childSession,
				},
			],
		});
		expect(persisted.details.cwd).toBe(effectiveCwd);
		const sessionIdentity = path.join(parentCwd, "parent.jsonl");
		const runState = state();
		runState.currentSessionId = sessionIdentity;
		runState.foregroundRuns = replayForegroundRuns(
			[
				{
					type: "message",
					timestamp: "2026-08-06T10:00:00.000Z",
					message: { role: "toolResult", toolName: "subagent", details: persisted.details },
				},
			],
			sessionIdentity,
		);
		let resumedCwd: string | undefined;
		const result = await executor(parentCwd, runState, (launch) => {
			resumedCwd = launch.cwd;
		}).execute(
			"cold-resume-call",
			{ action: "resume", id: config.id, message: "Continue from the persisted package state" },
			new AbortController().signal,
			undefined,
			context(parentCwd),
		);

		if (result.isError) {
			throw new Error(result.content.map((part) => ("text" in part ? part.text : "")).join("\n"));
		}
		expect(resumedCwd).toBe(effectiveCwd);
	});

	test("live and cold parallel child resume both preserve the selected child's exact cwd", async () => {
		const parentCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-parallel-cwd-"));
		temporaryDirectories.push(parentCwd);
		const firstCwd = path.join(parentCwd, "packages", "first");
		const secondCwd = path.join(parentCwd, "packages", "second");
		fs.mkdirSync(firstCwd, { recursive: true });
		fs.mkdirSync(secondCwd, { recursive: true });
		fs.writeFileSync(path.join(parentCwd, "parent.jsonl"), "");
		const liveState = state();
		const completion = await executor(parentCwd, liveState).execute(
			"parallel-cwd-source",
			{
				async: false,
				tasks: [
					{ agent: "general-purpose", task: "Inspect first", cwd: firstCwd },
					{ agent: "general-purpose", task: "Inspect second", cwd: secondCwd },
				],
			},
			new AbortController().signal,
			undefined,
			context(parentCwd),
		);
		const sourceRunId = completion.details.runId;
		if (!sourceRunId) throw new Error("Expected foreground run id");
		for (const child of completion.details.results) {
			if (child.sessionFile) fs.writeFileSync(child.sessionFile, "");
		}
		expect(completion.details.results.map((child) => child.cwd)).toEqual([firstCwd, secondCwd]);

		let liveResumeCwd: string | undefined;
		await executor(parentCwd, liveState, (launch) => {
			liveResumeCwd = launch.cwd;
		}).execute(
			"parallel-live-resume",
			{ action: "resume", id: sourceRunId, index: 1, message: "Continue second" },
			new AbortController().signal,
			undefined,
			context(parentCwd),
		);
		expect(liveResumeCwd).toBe(secondCwd);

		const sessionIdentity = path.join(parentCwd, "parent.jsonl");
		const coldState = state();
		coldState.currentSessionId = sessionIdentity;
		coldState.foregroundRuns = replayForegroundRuns(
			[
				{
					type: "message",
					timestamp: "2026-08-06T10:00:00.000Z",
					message: { role: "toolResult", toolName: "subagent", details: completion.details },
				},
			],
			sessionIdentity,
		);
		let coldResumeCwd: string | undefined;
		await executor(parentCwd, coldState, (launch) => {
			coldResumeCwd = launch.cwd;
		}).execute(
			"parallel-cold-resume",
			{ action: "resume", id: sourceRunId, index: 1, message: "Continue second after reload" },
			new AbortController().signal,
			undefined,
			context(parentCwd),
		);
		expect(coldResumeCwd).toBe(secondCwd);
	});

	test("runtime-only foreground replay revives the exact child contract after its source agent is removed", async () => {
		const parentCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-runtime-contract-"));
		temporaryDirectories.push(parentCwd);
		const firstCwd = path.join(parentCwd, "first");
		const secondCwd = path.join(parentCwd, "second");
		fs.mkdirSync(firstCwd);
		fs.mkdirSync(secondCwd);
		fs.writeFileSync(path.join(parentCwd, "parent.jsonl"), "");
		let foregroundConfig: BackgroundRunnerConfig | undefined;
		await executor(parentCwd, state(), undefined, {
			onForegroundConfig: (config) => {
				foregroundConfig = config;
			},
		}).execute(
			"runtime-contract-source",
			{
				async: false,
				tasks: [
					{ agent: "general-purpose", task: "Inspect first", cwd: firstCwd },
					{ agent: "general-purpose", task: "Inspect second", cwd: secondCwd },
				],
			},
			new AbortController().signal,
			undefined,
			context(parentCwd),
		);
		if (!foregroundConfig) throw new Error("Expected foreground runtime config");
		const config: BackgroundRunnerConfig = foregroundConfig;
		const childSessions = [path.join(firstCwd, "child.jsonl"), path.join(secondCwd, "child.jsonl")];
		for (const sessionFile of childSessions) fs.writeFileSync(sessionFile, "");
		const narrowCeiling = {
			version: 1 as const,
			allowedTools: ["read"],
			denyExtensions: true,
			sources: ["runtime-test"],
		};
		const status = createInitialStatus(config, 1, 2_147_000_000, "linux:dead-owner");
		status.state = "failed";
		status.endedAt = 2;
		status.lastUpdate = 2;
		for (const [index, step] of status.steps.entries()) {
			step.status = "failed";
			step.exitCode = 1;
			step.sessionFile = childSessions[index];
			step.launchContractDigest = `digest-${index}`;
			step.capabilityCeiling = narrowCeiling;
		}
		fs.writeFileSync(path.join(config.asyncDir, "status.json"), JSON.stringify(status));
		const descriptorPath = path.join(config.asyncDir, "recovery-descriptors.json");
		const descriptors = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
		descriptors.children[1] = {
			...descriptors.children[1],
			launchContractDigest: "digest-1",
			systemPrompt: "Persisted source contract",
			tools: ["read"],
			capabilityCeiling: narrowCeiling,
		};
		fs.writeFileSync(descriptorPath, JSON.stringify(descriptors));

		const sessionId = status.sessionId;
		if (!sessionId) throw new Error("Expected persisted foreground session identity");
		const runtimeRoot = path.dirname(config.asyncDir);
		const recovered = recoverForegroundRuntimeRuns(runtimeRoot, {
			sessionId,
			governorSessionId: sessionId,
			legacyRunIds: new Set(),
		});
		expect(recovered.get(config.id)?.children[1]).toMatchObject({
			cwd: secondCwd,
			launchContractDigest: "digest-1",
			capabilityCeiling: narrowCeiling,
		});

		const coldState = state();
		coldState.currentSessionId = sessionId;
		coldState.foregroundRuns = recovered;
		let revived: Parameters<NonNullable<Parameters<typeof executor>[2]>>[0] | undefined;
		const result = await executor(
			parentCwd,
			coldState,
			(launch) => {
				revived = launch;
			},
			{ agents: [] },
		).execute(
			"runtime-contract-resume",
			{ action: "resume", id: config.id, index: 1, message: "Continue the second child" },
			new AbortController().signal,
			undefined,
			context(parentCwd),
		);

		expect(result.isError).not.toBeTrue();
		expect(revived).toMatchObject({
			cwd: secondCwd,
			agentConfig: { systemPrompt: "Persisted source contract", tools: ["read"] },
			capabilityCeiling: narrowCeiling,
		});
	});

	test("foreground replay fails closed on malformed ceilings and bounds retained session strings", () => {
		const cwd = "/project";
		const entry = (child: Record<string, unknown>) => ({
			type: "message",
			timestamp: "2026-08-06T10:00:00.000Z",
			message: {
				role: "toolResult",
				toolName: "subagent",
				details: { mode: "single", runId: "replayed", cwd, results: [child] },
			},
		});
		const base = { agent: "general-purpose", task: "Inspect", exitCode: 0 };
		expect(
			replayForegroundRuns(
				[entry({ ...base, capabilityCeiling: { version: 1, allowedTools: "*", sources: [] } })],
				"session",
			).size,
		).toBe(0);

		const replayed = replayForegroundRuns(
			[
				entry({
					...base,
					task: "t".repeat(100_000),
					finalOutput: "o".repeat(100_000),
					capabilityCeiling: { version: 1, allowedTools: ["read"], denyExtensions: true, sources: ["test"] },
				}),
			],
			"session",
		);
		const child = replayed.get("replayed")?.children[0];
		expect(child?.task?.length).toBe(16 * 1024);
		expect(child?.finalOutput?.length).toBe(32 * 1024);
		expect(child?.capabilityCeiling).toEqual({
			version: 1,
			allowedTools: ["read"],
			denyExtensions: true,
			sources: ["test"],
		});
		expect(replayForegroundRuns([entry({ ...base, model: "m".repeat(257) })], "session").size).toBe(0);
		expect(replayForegroundRuns([entry({ ...base, sessionFile: "/tmp/bad\npath" })], "session").size).toBe(0);
	});

	test("cold runtime replay skips a malformed newest run and still restores a healthy sibling", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-runtime-replay-"));
		temporaryDirectories.push(root);
		const sessionId = "/sessions/current.jsonl";
		const healthyId = "aaaaaaaaaaaa";
		const corruptId = "bbbbbbbbbbbb";
		for (const runId of [healthyId, corruptId]) fs.mkdirSync(path.join(root, runId), { recursive: true });
		fs.writeFileSync(
			path.join(root, healthyId, "status.json"),
			JSON.stringify({
				runId: healthyId,
				sessionId,
				mode: "single",
				state: "complete",
				cwd: "/project",
				startedAt: 1,
				endedAt: 2,
				lastUpdate: 2,
				steps: [{ agent: "general-purpose", task: "Inspect", status: "complete", exitCode: 0 }],
			}),
		);
		fs.writeFileSync(
			path.join(root, corruptId, "status.json"),
			JSON.stringify({
				runId: corruptId,
				sessionId,
				mode: "single",
				state: "complete",
				cwd: 123,
				startedAt: 3,
				steps: "not-an-array",
			}),
		);
		const now = new Date();
		fs.utimesSync(path.join(root, corruptId), now, new Date(now.getTime() + 1_000));

		const recovered = recoverForegroundRuntimeRuns(root, {
			sessionId,
			governorSessionId: sessionId,
			legacyRunIds: new Set(),
		});
		expect([...recovered.keys()]).toEqual([healthyId]);
		expect(recovered.get(healthyId)?.children[0]).toMatchObject({
			agent: "general-purpose",
			status: "completed",
			task: "Inspect",
		});
	});

	test("observation-only startup isolates disappearing and corrupt foreground siblings", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-runtime-observe-"));
		temporaryDirectories.push(root);
		const sessionId = "/sessions/current.jsonl";
		const healthyId = "111111111111";
		const disappearingId = "222222222222";
		const corruptId = "333333333333";
		for (const runId of [healthyId, disappearingId, corruptId]) fs.mkdirSync(path.join(root, runId));
		fs.writeFileSync(
			path.join(root, healthyId, "status.json"),
			JSON.stringify({
				runId: healthyId,
				sessionId,
				mode: "single",
				state: "complete",
				cwd: "/project",
				startedAt: 1,
				endedAt: 2,
				lastUpdate: 2,
				steps: [{ agent: "general-purpose", task: "Inspect", status: "complete", exitCode: 0 }],
			}),
		);
		fs.writeFileSync(path.join(root, corruptId, "status.json"), "{not-json");

		const observed = observeForegroundRuntimeRuns(
			root,
			{ sessionId, governorSessionId: sessionId, legacyRunIds: new Set() },
			{
				lstat: ((target: fs.PathLike) => {
					if (path.basename(String(target)) === disappearingId)
						throw Object.assign(new Error("disappeared"), { code: "ENOENT" });
					return fs.lstatSync(target);
				}) as typeof fs.lstatSync,
			},
		);

		expect([...observed.keys()]).toEqual([healthyId]);
		expect(observed.get(healthyId)?.children[0]).toMatchObject({ status: "completed", task: "Inspect" });
	});

	test("cold runtime replay durably repairs a terminal completion left ahead of running status", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-completion-repair-"));
		temporaryDirectories.push(root);
		const runId = "cccccccccccc";
		const sessionId = "/sessions/current.jsonl";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId,
				mode: "single",
				state: "running",
				cwd: "/project",
				startedAt: 1,
				lastUpdate: 1,
				steps: [{ agent: "general-purpose", task: "Inspect", status: "running" }],
			}),
		);
		fs.writeFileSync(
			path.join(asyncDir, "completion.json"),
			JSON.stringify({
				id: runId,
				runId,
				state: "complete",
				endedAt: 2,
				results: [{ agent: "general-purpose", success: true, exitCode: 0, output: "done" }],
			}),
		);

		const recovered = recoverForegroundRuntimeRuns(root, {
			sessionId,
			governorSessionId: sessionId,
			legacyRunIds: new Set(),
		});
		const persisted = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			state?: string;
			steps?: Array<{ status?: string }>;
		};

		expect(recovered.get(runId)?.children[0]?.status).toBe("completed");
		expect(persisted.state).toBe("complete");
		expect(persisted.steps?.[0]?.status).toBe("complete");
	});

	test("invalid completion cannot pin a foreground run whose owner is proven dead", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-invalid-completion-"));
		temporaryDirectories.push(root);
		const runId = "dddddddddddd";
		const sessionId = "/sessions/current.jsonl";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId,
				mode: "single",
				state: "running",
				cwd: "/project",
				pid: 2_147_000_000,
				processStartIdentity: "linux:dead-owner",
				startedAt: 1,
				lastUpdate: 1,
				steps: [{ agent: "general-purpose", task: "Inspect", status: "running" }],
			}),
		);
		initializeWriterProcessRegistry(asyncDir, runId, process.pid, 1);
		fs.writeFileSync(path.join(asyncDir, "completion.json"), "{not-json", { mode: 0o600 });

		const recovered = recoverForegroundRuntimeRuns(root, {
			sessionId,
			governorSessionId: sessionId,
			legacyRunIds: new Set(),
		});
		const persisted = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
			state?: string;
			steps?: Array<{ agentStatus?: string; status?: string }>;
		};

		expect(recovered.get(runId)?.children[0]).toMatchObject({ status: "failed", crashed: true });
		expect(persisted.state).toBe("failed");
		expect(persisted.steps?.[0]).toMatchObject({ status: "failed", agentStatus: "crashed" });
	});

	test("advances cold foreground orphan reaping until TERM-resistant writers are absent", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-reap-retry-"));
		temporaryDirectories.push(root);
		const runId = "abababababab";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId: "/sessions/current.jsonl",
				mode: "single",
				state: "running",
				cwd: "/project",
				pid: 2_147_000_000,
				processStartIdentity: "linux:dead-owner",
				startedAt: 1,
				lastUpdate: 1,
				steps: [{ agent: "general-purpose", task: "Inspect", status: "running" }],
			}),
		);
		const run = {
			runId,
			mode: "single" as const,
			cwd: "/project",
			asyncDir,
			sessionId: "/sessions/current.jsonl",
			updatedAt: 1,
			children: [{ agent: "general-purpose", index: 0, task: "Inspect", status: "detached" as const, updatedAt: 1 }],
		};
		let passes = 0;
		const terminateWriters = () => {
			passes += 1;
			return passes === 1 ? { remaining: 1, terminated: 1 } : { remaining: 0, terminated: 1 };
		};

		refreshForegroundRuntimeRun(run, { terminateWriters });
		expect(run.children[0]?.status).toBe("detached");
		refreshForegroundRuntimeRun(run, { terminateWriters });

		expect(passes).toBe(2);
		expect(run.children[0]).toMatchObject({ status: "failed", crashed: true });
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"))).toMatchObject({
			state: "failed",
			steps: [{ status: "failed", agentStatus: "crashed" }],
		});
	});

	test("invalid completion does not fail a foreground run without dead-owner proof", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-unknown-owner-"));
		temporaryDirectories.push(root);
		const runId = "eeeeeeeeeeee";
		const sessionId = "/sessions/current.jsonl";
		const asyncDir = path.join(root, runId);
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({
				runId,
				sessionId,
				mode: "single",
				state: "running",
				cwd: "/project",
				startedAt: 1,
				lastUpdate: 1,
				steps: [{ agent: "general-purpose", task: "Inspect", status: "running" }],
			}),
		);
		fs.writeFileSync(
			path.join(asyncDir, "completion.json"),
			JSON.stringify({ runId: "foreign-run", state: "complete", results: [] }),
			{ mode: 0o600 },
		);

		const recovered = recoverForegroundRuntimeRuns(root, {
			sessionId,
			governorSessionId: sessionId,
			legacyRunIds: new Set(),
		});

		expect(recovered.get(runId)?.children[0]?.status).toBe("detached");
		expect(JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")).state).toBe("running");
	});

	test("the private executor contract contains no removed orchestration fields or legacy branches", () => {
		const root = path.resolve(import.meta.dir, "../..");
		const executorSource = fs.readFileSync(
			path.join(root, "packages/pi-stuff/src/subagents/src/runs/foreground/subagent-executor.ts"),
			"utf8",
		);
		const executionSource = fs.readFileSync(
			path.join(root, "packages/pi-stuff/src/subagents/src/runs/foreground/execution.ts"),
			"utf8",
		);
		const params = executorSource.match(/export interface SubagentParamsLike \{([\s\S]*?)\n\}/)?.[1] ?? "";
		for (const field of [
			"acceptance",
			"agentContract",
			"chain",
			"dynamic",
			"outputPath",
			"progress",
			"share",
			"structuredOutput",
			"workflow",
		]) {
			expect(params).not.toMatch(new RegExp(`\\b${field}\\??:`));
		}
		for (const removedModule of [
			"agent-memory",
			"acceptance",
			"agent-contract",
			"completion-guard",
			"dynamic-fanout",
			"intercom",
			"long-running-guard",
			"parallel-handoff",
			"single-output",
			"structured-output",
		]) {
			expect(`${executorSource}\n${executionSource}`).not.toContain(`/${removedModule}.ts`);
		}
	});
});
