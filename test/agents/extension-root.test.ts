import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type Tool, validateToolArguments } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AgentWorkOrigin,
	listenForAgentWorkOriginQueries,
} from "../../packages/pi-stuff/src/conversation-ui/agent-run-origin.js";
import type { CommandDialogCoordinator } from "../../packages/pi-stuff/src/conversation-ui/index.js";
import type { PiStuffAgentsConfig } from "../../packages/pi-stuff/src/subagents/src/extension/config.js";
import registerAgents, {
	type ExtensionRootDependencies,
} from "../../packages/pi-stuff/src/subagents/src/extension/index.js";
import type { CompletionNotification } from "../../packages/pi-stuff/src/subagents/src/runs/background/notify.js";
import {
	deriveLaunchRunId,
	type SubagentParamsLike,
} from "../../packages/pi-stuff/src/subagents/src/runs/foreground/subagent-executor.js";
import { SUBAGENT_PARENT_SESSION_ENV } from "../../packages/pi-stuff/src/subagents/src/runs/shared/pi-args.js";
import type {
	AgentExecutionInvocation,
	GovernedAgentParams,
} from "../../packages/pi-stuff/src/subagents/src/runtime/agent-execution-coordinator.js";
import { CurrentAgents } from "../../packages/pi-stuff/src/subagents/src/session/current-agents.js";
import {
	ASYNC_DIR,
	type Details,
	RESULTS_DIR,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	type SubagentState,
} from "../../packages/pi-stuff/src/subagents/src/shared/types.js";
import type { AgentRoster } from "../../packages/pi-stuff/src/subagents/src/ui/agent-roster.js";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type EntryRenderer = (...args: unknown[]) => unknown;

interface TestMessage {
	readonly content?: string;
	readonly customType?: string;
	readonly details?: unknown;
	readonly display?: boolean;
}

interface TestToolResult {
	readonly content: Array<{ readonly text: string; readonly type: string }>;
	readonly details?: unknown;
}

interface RegisteredCommand {
	readonly description?: string;
	readonly handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
}

interface TestTool extends Tool {
	readonly label: string;
	execute(
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<TestToolResult>;
}

class EventBusHarness {
	readonly emissions: string[] = [];
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

	emit(event: string, data: unknown): void {
		this.emissions.push(event);
		for (const listener of [...(this.listeners.get(event) ?? [])]) listener(data);
	}

	on(event: string, listener: (data: unknown) => void): () => void {
		let listeners = this.listeners.get(event);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(event, listeners);
		}
		listeners.add(listener);
		return () => listeners?.delete(listener);
	}

	size(): number {
		return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
	}
}

class ApiHarness {
	readonly commands = new Map<string, RegisteredCommand>();
	readonly entries: Array<{ customType: string; data: unknown }> = [];
	readonly entryRenderers = new Map<string, EntryRenderer>();
	readonly events = new EventBusHarness();
	readonly handlers = new Map<string, Handler[]>();
	readonly messages: Array<{ message: TestMessage; options: unknown }> = [];
	readonly renderers: string[] = [];
	readonly tools = new Map<string, TestTool>();

	readonly api = {
		events: this.events,
		on: (event: string, handler: Handler) => {
			const handlers = this.handlers.get(event) ?? [];
			handlers.push(handler);
			this.handlers.set(event, handlers);
		},
		registerTool: (tool: TestTool) => this.tools.set(tool.name, tool),
		registerCommand: (name: string, command: RegisteredCommand) => this.commands.set(name, command),
		registerEntryRenderer: (name: string, renderer: EntryRenderer) => this.entryRenderers.set(name, renderer),
		registerMessageRenderer: (name: string) => this.renderers.push(name),
		appendEntry: (customType: string, data: unknown) => this.entries.push({ customType, data }),
		sendMessage: (message: TestMessage, options: unknown) => this.messages.push({ message, options }),
	} as unknown as ExtensionAPI;

	async fire(event: string, data: unknown, ctx = context()): Promise<void> {
		for (const handler of this.handlers.get(event) ?? []) await handler(data, ctx);
	}
}

interface HarnessOptions {
	backgroundGate?: Promise<void>;
	backgroundLifecycleAbort?: boolean | "throw";
	compatibility?: ExtensionRootDependencies["prepareGovernorCompatibility"];
	contextProjection?: string;
	coordinatorIdle?: Promise<void>;
	maintenance?: () => unknown | Promise<unknown>;
	monotonicNow?: () => number;
	governorLedgerExists?: boolean;
	governorReject?: boolean;
	restoreActive?: boolean;
	restoreFailure?: boolean;
	runtimeStartFailure?: boolean;
	settleFailure?: boolean;
	prepareGate?: Promise<void>;
	reconcileGate?: Promise<void>;
	foregroundGate?: Promise<void>;
	foregroundAsyncDir?: string;
	foregroundDetails?: Details;
}

interface RootHarness {
	readonly api: ApiHarness;
	readonly chrome: { registered: number; unregistered: number };
	readonly current: { disposed: number; refreshes: number; value?: CurrentAgents };
	readonly directories: string[];
	readonly dialogs: Array<{ initialKey?: string; hasReader: boolean }>;
	readonly engineParams: SubagentParamsLike[];
	readonly engineOrigins: AgentWorkOrigin[];
	readonly governor: {
		binds: Array<{ sessionId: string; ownerAgentPath: readonly string[] }>;
		completions: unknown[];
		disposed: number;
		failures: number;
		prepares: Array<{ launchRunId: string; params: GovernedAgentParams }>;
		reconcileChecks: number;
		reconciles: number;
		settlements: number;
		starts: unknown[];
	};
	readonly notifier: { value?: { deliver(result: CompletionNotification): Promise<boolean> } };
	readonly projectionOwnership: { delegated: boolean };
	readonly projections: string[];
	readonly roster: { contexts: number; disposed: number; suppressed: boolean[] };
	readonly state: { value?: SubagentState };
	readonly supervisor: { disposed: number; started: number };
	readonly timers: { cleared: number; callbacks: Array<() => void> };
	readonly tracker: {
		completed: number;
		pollers: number;
		reset: number;
		restored: number;
		started: number;
	};
	readonly watcher: { primes: number; starts: number; stops: number };
}

const roots: RootHarness[] = [];
const temporaryDirectories = new Set<string>();

function config(): PiStuffAgentsConfig {
	return {
		maxSubagentDepth: 3,
		maxRunningAgents: 20,
		maxAgentsPerSession: 200,
	};
}

function context(
	entries: readonly unknown[] = [],
	identity: { sessionFile?: string; sessionId?: string } = {},
): ExtensionContext {
	return {
		cwd: "/project",
		hasUI: true,
		mode: "tui",
		sessionManager: {
			getEntries: () => [...entries],
			getSessionFile: () => identity.sessionFile ?? "/sessions/root.jsonl",
			getSessionId: () => identity.sessionId ?? "root-id",
		},
		ui: {},
	} as unknown as ExtensionContext;
}

function currentSessionId(root: RootHarness): string {
	const value = root.state.value?.currentSessionId;
	if (!value) throw new Error("Expected current physical session identity");
	return value;
}

function createHarness(options: HarnessOptions = {}): RootHarness {
	const api = new ApiHarness();
	const chrome = { registered: 0, unregistered: 0 };
	const current = { disposed: 0, refreshes: 0, value: undefined as CurrentAgents | undefined };
	const directories: string[] = [];
	const dialogs: Array<{ initialKey?: string; hasReader: boolean }> = [];
	const engineParams: SubagentParamsLike[] = [];
	const engineOrigins: AgentWorkOrigin[] = [];
	const governor = {
		binds: [] as Array<{ sessionId: string; ownerAgentPath: readonly string[] }>,
		completions: [] as unknown[],
		disposed: 0,
		failures: 0,
		prepares: [] as Array<{ launchRunId: string; params: GovernedAgentParams }>,
		reconcileChecks: 0,
		reconciles: 0,
		settlements: 0,
		starts: [] as unknown[],
	};
	const notifier = { value: undefined as { deliver(result: CompletionNotification): Promise<boolean> } | undefined };
	const projectionOwnership = { delegated: false };
	const projections: string[] = [];
	const roster = { contexts: 0, disposed: 0, suppressed: [] as boolean[] };
	const state = { value: undefined as SubagentState | undefined };
	const supervisor = { disposed: 0, started: 0 };
	const timers = { cleared: 0, callbacks: [] as Array<() => void> };
	const tracker = { completed: 0, pollers: 0, reset: 0, restored: 0, started: 0 };
	const watcher = { primes: 0, starts: 0, stops: 0 };

	const coordinator = {
		registerChrome: (_id: string, chromeValue: { setSuppressed(suppressed: boolean): void }) => {
			chrome.registered += 1;
			expect(typeof chromeValue.setSuppressed).toBe("function");
			return () => {
				chrome.unregistered += 1;
			};
		},
		whenIdle: () => options.coordinatorIdle ?? Promise.resolve(),
	} as unknown as CommandDialogCoordinator;

	const dependencies: Partial<ExtensionRootDependencies> = {
		isChildProcess: () => false,
		loadConfiguration: config,
		maintainRuntime: options.maintenance ?? (() => {}),
		monotonicNow: options.monotonicNow ?? (() => performance.now()),
		getCoordinator: () => coordinator,
		ensureDirectory: (directory) => {
			directories.push(directory);
			if (options.runtimeStartFailure)
				throw Object.assign(new Error("injected runtime directory EIO"), { code: "EIO" });
		},
		randomId: () => "control-id",
		createGovernorCoordinator: () => ({
			bindSession: (identity) => governor.binds.push(identity),
			prepare: async (input) => {
				governor.prepares.push({ launchRunId: input.launchRunId, params: input.params });
				await options.prepareGate;
				if (options.governorReject) return { ok: false, message: "Agent limit reached; wait for one to finish." };
				if (input.params.action && input.params.action !== "resume") return { ok: true };
				return { ok: true, invocation: { launchRunId: input.launchRunId } as AgentExecutionInvocation };
			},
			observeAsyncStarted: async (event) => {
				governor.starts.push(event);
			},
			settle: async () => {
				governor.settlements += 1;
				if (options.settleFailure) throw Object.assign(new Error("injected settle EIO"), { code: "EIO" });
			},
			fail: async () => {
				governor.failures += 1;
			},
			complete: async (event) => {
				governor.completions.push(event);
			},
			reconcileDead: async () => {
				governor.reconciles += 1;
			},
			reconcileExisting: async () => {
				governor.reconcileChecks += 1;
				await options.reconcileGate;
				if (options.restoreActive || options.governorLedgerExists) governor.reconciles += 1;
			},
			dispose: () => {
				governor.disposed += 1;
			},
		}),
		prepareGovernorCompatibility:
			options.compatibility ??
			(async () => ({
				ok: true,
				importedLogicalAgentIds: [],
				legacyLedgerObserved: false,
			})),
		createExecutor: ({ projectContext, state: rootState }) => {
			state.value = rootState;
			projectionOwnership.delegated = typeof projectContext === "function";
			const backgroundLifecycleAbort = options.backgroundLifecycleAbort;
			return {
				execute: async (_id, params, _signal, _onUpdate, _ctx, hooks) => {
					engineParams.push(params);
					engineOrigins.push(hooks?.parentRunOrigin ?? "automatic");
					if (params.async === false && options.foregroundAsyncDir) {
						const launchRunId = params.launchRunId;
						if (!launchRunId) throw new Error("Expected a foreground launch run id");
						await hooks?.beforeForegroundStart?.({
							runId: launchRunId,
							asyncDir: options.foregroundAsyncDir,
							writerCount: options.foregroundDetails?.results.length ?? 1,
							abortStart: () => true,
						});
						await options.foregroundGate;
						return {
							content: [{ type: "text", text: "foreground engine receipt" }],
							details:
								options.foregroundDetails ??
								({
									mode: "single",
									runId: params.launchRunId,
									results: [{ agent: "worker", exitCode: 0, finalOutput: "done" }],
								} as Details),
						} as never;
					}
					await options.backgroundGate;
					return {
						content: [{ type: "text", text: "Async dir: /private/run" }],
						details: {
							mode: "single",
							results: [],
							asyncId: "run-1",
							...(backgroundLifecycleAbort === undefined
								? {}
								: {
										lifecycleBinding: {
											abortStart: () => {
												if (backgroundLifecycleAbort === "throw") {
													throw Object.assign(new Error("injected abort EIO"), { code: "EIO" });
												}
												return backgroundLifecycleAbort;
											},
										},
									}),
						} as Details,
					} as never;
				},
			};
		},
		createTracker: (_pi, rootState) => ({
			ensurePoller: () => {
				tracker.pollers += 1;
			},
			handleStarted: (data) => {
				tracker.started += 1;
				const event = data as { id?: string; sessionId?: string };
				if (!event.id) return;
				rootState.asyncJobs.set(event.id, {
					asyncId: event.id,
					asyncDir: `/tmp/${event.id}`,
					status: "running",
					...(event.sessionId ? { sessionId: event.sessionId } : {}),
					agents: ["worker"],
					startedAt: 1,
					updatedAt: 1,
				});
			},
			handleComplete: () => {
				tracker.completed += 1;
			},
			resetJobs: () => {
				tracker.reset += 1;
				rootState.asyncJobs.clear();
				rootState.recentAgentJobs?.clear();
			},
			restoreActiveJobs: () => {
				tracker.restored += 1;
				if (options.restoreFailure) throw Object.assign(new Error("injected restore EIO"), { code: "EIO" });
				if (!options.restoreActive) return;
				rootState.asyncJobs.set("restored", {
					asyncId: "restored",
					asyncDir: "/tmp/restored",
					status: "running",
					...(rootState.currentSessionId ? { sessionId: rootState.currentSessionId } : {}),
					agents: ["worker"],
					startedAt: 1,
					updatedAt: 1,
				});
			},
		}),
		createWatcher: ({ notifier: completionNotifier }) => {
			notifier.value = completionNotifier;
			return {
				startResultWatcher: () => {
					watcher.starts += 1;
					return true;
				},
				stopResultWatcher: () => {
					watcher.stops += 1;
				},
				primeExistingResults: () => {
					watcher.primes += 1;
				},
			};
		},
		createSupervisor: () => ({
			start: () => {
				supervisor.started += 1;
			},
			dispose: () => {
				supervisor.disposed += 1;
			},
		}),
		createCurrentAgents: (rootState, currentOptions) => {
			const value = new CurrentAgents(rootState, currentOptions);
			const refresh = value.refresh.bind(value);
			const dispose = value.dispose.bind(value);
			value.refresh = () => {
				current.refreshes += 1;
				refresh();
			};
			value.dispose = () => {
				current.disposed += 1;
				dispose();
			};
			current.value = value;
			return value;
		},
		createRoster: (_current, rosterOptions) => {
			expect(typeof rosterOptions.onOpen).toBe("function");
			return {
				createFooterTail: () => ({ invalidate: () => {}, render: () => [] }),
				setContext: () => {
					roster.contexts += 1;
				},
				setFooterHosted: () => {},
				setSuppressed: (suppressed: boolean) => roster.suppressed.push(suppressed),
				dispose: () => {
					roster.disposed += 1;
				},
			} as unknown as AgentRoster;
		},
		openDialog: async (_ctx, _coordinator, _current, dialogOptions) => {
			dialogs.push({
				...(dialogOptions.initialKey ? { initialKey: dialogOptions.initialKey } : {}),
				hasReader: typeof dialogOptions.readTranscript === "function",
			});
		},
		projectContext: async (audience) => {
			projections.push(audience);
			return {
				source: "magic-context",
				text: options.contextProjection ?? "",
				truncated: false,
			};
		},
		timers: {
			setInterval: (callback) => {
				timers.callbacks.push(callback);
				return { unref: () => {} } as ReturnType<typeof setInterval>;
			},
			clearInterval: () => {
				timers.cleared += 1;
			},
		},
	};

	registerAgents(api.api, dependencies);
	const harness = {
		api,
		chrome,
		current,
		directories,
		dialogs,
		engineParams,
		engineOrigins,
		governor,
		notifier,
		projectionOwnership,
		projections,
		roster,
		state,
		supervisor,
		timers,
		tracker,
		watcher,
	};
	roots.push(harness);
	return harness;
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await root.api.fire("session_shutdown", { reason: "quit", type: "session_shutdown" });
	}
	for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
	temporaryDirectories.clear();
	delete process.env[SUBAGENT_PARENT_SESSION_ENV];
});

describe("Agents extension composition root", () => {
	test("throttles runtime maintenance after success and retries failures after a bounded delay", async () => {
		let maintenanceCalls = 0;
		let now = 1_000;
		const root = createHarness({
			maintenance: () => {
				maintenanceCalls += 1;
				if (maintenanceCalls === 1) throw new Error("injected maintenance failure");
			},
			monotonicNow: () => now,
		});
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");
		const execute = (id: string) =>
			tool.execute(
				id,
				{ agent: "researcher", task: `Maintenance probe ${id}` },
				new AbortController().signal,
				undefined,
				context(),
			);
		const waitForCalls = async (expected: number): Promise<void> => {
			for (let attempt = 0; attempt < 100 && maintenanceCalls < expected; attempt++) await Bun.sleep(1);
			expect(maintenanceCalls).toBe(expected);
		};

		await execute("maintenance-first");
		await waitForCalls(1);
		await execute("maintenance-before-retry");
		await Bun.sleep(10);
		expect(maintenanceCalls).toBe(1);

		now += 60_001;
		await execute("maintenance-retry");
		await waitForCalls(2);
		await execute("maintenance-before-success-window");
		await Bun.sleep(10);
		expect(maintenanceCalls).toBe(2);

		now += 60 * 60 * 1_000 + 1;
		await execute("maintenance-after-success-window");
		await waitForCalls(3);
	});

	test("returns quietly in child processes", () => {
		const api = new ApiHarness();
		let loaded = 0;
		registerAgents(api.api, {
			isChildProcess: () => true,
			loadConfiguration: () => {
				loaded += 1;
				return config();
			},
		});

		expect(loaded).toBe(0);
		expect(api.tools.size).toBe(0);
		expect(api.commands.size).toBe(0);
		expect(api.handlers.size).toBe(0);
	});

	test("registers only the public Agent tool and /agents command", async () => {
		const root = createHarness();

		expect([...root.api.tools.keys()]).toEqual(["subagent"]);
		expect(root.api.tools.get("subagent")?.label).toBe("Agent");
		const presentation = root.api.tools.get("subagent") as unknown as {
			renderCall?: unknown;
			renderResult?: unknown;
			renderShell?: unknown;
		};
		expect(presentation.renderShell).toBe("self");
		expect(presentation.renderCall).toBeFunction();
		expect(presentation.renderResult).toBeFunction();
		expect([...root.api.commands.keys()]).toEqual(["agents"]);
		expect(root.api.renderers).toEqual(["pi-stuff-agent-complete"]);
		expect([...root.api.entryRenderers.keys()]).toEqual(["pi-stuff-agent-outcome"]);
		expect(root.chrome.registered).toBe(1);

		await root.api.commands.get("agents")?.handler("", context());
		expect(root.dialogs).toEqual([{ hasReader: true }]);
	});

	test("publishes one discoverable Agent call contract and rejects repair-prone legacy shapes", () => {
		const root = createHarness();
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");

		expect(tool.description).toContain("Choose exactly one call shape");
		expect(tool.description).toContain("Do not invent or pass a background field");
		expect(tool.description).toContain("Background completion never starts another main turn");
		expect(tool.description).toContain('action="status", "steer", "stop", or "resume"');
		expect(tool.description).toContain("Omit turnBudget and toolBudget for ordinary tasks");
		expect(tool.description).toContain("Pi Stuff does not provide built-in Agent definitions");
		expect(tool.description).toContain("Package, user, or project Agent");

		for (const args of [
			{ agent: "general-purpose", task: "Inspect the parser" },
			{
				tasks: [
					{ agent: "general-purpose", task: "Implement the parser" },
					{ agent: "general-purpose", task: "Review the parser" },
				],
			},
			{ action: "status" },
		]) {
			expect(() =>
				validateToolArguments(tool, { type: "toolCall", id: "call-1", name: "subagent", arguments: args }),
			).not.toThrow();
		}

		for (const args of [
			{ agent: "general-purpose", background: true, task: "Inspect the parser" },
			{ action: "list" },
		]) {
			expect(() =>
				validateToolArguments(tool, { type: "toolCall", id: "call-2", name: "subagent", arguments: args }),
			).toThrow('Validation failed for tool "subagent"');
		}
		const task = { agent: "general-purpose", task: "Review the parser" };
		expect(() =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "call-20",
				name: "subagent",
				arguments: { tasks: Array.from({ length: 20 }, () => task) },
			}),
		).not.toThrow();
		expect(() =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "call-21",
				name: "subagent",
				arguments: { tasks: Array.from({ length: 21 }, () => task) },
			}),
		).toThrow('Validation failed for tool "subagent"');

		expect(() =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "call-3",
				name: "subagent",
				arguments: {
					agent: "general-purpose",
					task: "Inspect the parser",
					tasks: [{ agent: "general-purpose", task: "Review the parser" }],
				},
			}),
		).not.toThrow();
		expect(Object.hasOwn(tool.parameters as object, "oneOf")).toBeFalse();
	});

	test("keeps session startup observation-only and activates recovery on the first Agent launch", async () => {
		const root = createHarness();
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });

		expect(root.tracker.restored).toBe(1);
		expect(root.directories).toEqual([]);
		expect(root.watcher.starts).toBe(0);
		expect(root.watcher.primes).toBe(0);
		expect(root.supervisor.started).toBe(0);
		expect(root.governor.reconcileChecks).toBe(0);
		expect(root.governor.reconciles).toBe(0);

		const result = await root.api.tools
			.get("subagent")
			?.execute(
				"call-1",
				{ agent: "researcher", task: "Find the cause" },
				new AbortController().signal,
				undefined,
				context(),
			);
		const launchRunId = deriveLaunchRunId("call-1", {
			sessionId: `${currentSessionId(root)}\0header:root-id`,
			ownerAgentPath: [],
		});
		expect(root.engineParams[0]).toEqual({
			agent: "researcher",
			async: true,
			context: "fresh",
			description: "Find the cause",
			launchRunId,
			task: "Find the cause",
		});
		expect(root.engineOrigins).toEqual(["automatic"]);
		expect(root.governor.prepares).toEqual([
			{
				launchRunId,
				params: { agent: "researcher", task: "Find the cause" },
			},
		]);
		expect(root.governor.settlements).toBe(1);
		expect(root.directories).toEqual([RESULTS_DIR, ASYNC_DIR]);
		expect(root.watcher.starts).toBe(1);
		expect(root.watcher.primes).toBe(2);
		expect(root.supervisor.started).toBe(1);
		expect(root.governor.reconcileChecks).toBe(1);
		expect(result?.content).toEqual([
			{
				type: "text",
				text: "Agent researcher started in the background (run-1). Continue independent work; completion will not start another main turn. Inspect it with /agents.",
			},
		]);
		expect(JSON.stringify(result?.content)).not.toContain("/private");
	});

	test("captures user attribution before launching a background Agent", async () => {
		const root = createHarness();
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const stop = listenForAgentWorkOriginQueries(root.api.api, () => "user");
		try {
			await root.api.tools
				.get("subagent")
				?.execute(
					"user-launch",
					{ agent: "researcher", task: "Inspect user work" },
					new AbortController().signal,
					undefined,
					context(),
				);
		} finally {
			stop();
		}
		expect(root.engineOrigins).toEqual(["user"]);
	});

	test("releases the governor invocation when post-prepare runtime startup fails", async () => {
		const root = createHarness({ runtimeStartFailure: true });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");

		await expect(
			tool.execute(
				"runtime-start-failure",
				{ agent: "researcher", task: "Inspect lifecycle ownership" },
				new AbortController().signal,
				undefined,
				context(),
			),
		).rejects.toThrow("injected runtime directory EIO");
		expect(root.governor.failures).toBe(1);
		expect(root.governor.settlements).toBe(0);
		expect(root.engineParams).toEqual([]);
		expect(root.timers.callbacks).toHaveLength(0);
	});

	test("retains a launched background Agent lease when post-launch settlement persistence fails", async () => {
		const root = createHarness({ settleFailure: true });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const result = await root.api.tools
			.get("subagent")
			?.execute(
				"settle-failure",
				{ agent: "researcher", task: "Continue in background" },
				new AbortController().signal,
				undefined,
				context(),
			);
		expect(result?.content[0]?.text).toContain("started in the background");
		expect(root.governor.settlements).toBe(1);
		expect(root.governor.failures).toBe(0);
		expect(root.engineParams).toHaveLength(1);
	});

	test("does not resurrect result recovery or the supervisor after shutdown during reconciliation", async () => {
		const gate = Promise.withResolvers<void>();
		const root = createHarness({ reconcileGate: gate.promise });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const starting = root.api.commands.get("agents")?.handler("", context());
		while (root.governor.reconcileChecks === 0) await Bun.sleep(1);
		await root.api.fire("session_shutdown", { reason: "quit", type: "session_shutdown" });
		gate.resolve();
		await starting;

		expect(root.watcher.starts).toBe(0);
		expect(root.watcher.primes).toBe(0);
		expect(root.supervisor.started).toBe(0);
	});

	test("releases a prepared launch instead of dispatching it after shutdown", async () => {
		const gate = Promise.withResolvers<void>();
		const root = createHarness({ prepareGate: gate.promise });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");
		const executing = tool.execute(
			"shutdown-during-prepare",
			{ agent: "researcher", task: "Must never launch" },
			new AbortController().signal,
			undefined,
			context(),
		);
		while (root.governor.prepares.length === 0) await Bun.sleep(1);
		await root.api.fire("session_shutdown", { reason: "quit", type: "session_shutdown" });
		gate.resolve();
		const result = await executing;

		expect(root.governor.failures).toBe(1);
		expect(root.engineParams).toEqual([]);
		expect(result.content[0]?.text).toContain("parent session ended or changed");
	});

	test("retains ledger authority when a background runner cannot be aborted across a session switch", async () => {
		const gate = Promise.withResolvers<void>();
		const root = createHarness({ backgroundGate: gate.promise, backgroundLifecycleAbort: false });
		const headerA = context([], { sessionFile: "/sessions/background-a.jsonl", sessionId: "background-a" });
		const headerB = context([], { sessionFile: "/sessions/background-b.jsonl", sessionId: "background-b" });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" }, headerA);
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");
		const executing = tool.execute(
			"background-session-switch",
			{ agent: "researcher", task: "Runner survives the switch" },
			new AbortController().signal,
			undefined,
			headerA,
		);
		while (root.engineParams.length === 0) await Bun.sleep(1);
		await root.api.fire("session_start", { reason: "switch", type: "session_start" }, headerB);
		gate.resolve();
		const result = await executing;

		expect(root.governor.settlements).toBe(1);
		expect(root.governor.failures).toBe(0);
		expect(result.content[0]?.text).toContain("session ended or changed");
	});

	test("retains ledger authority when aborting a session-switched runner throws", async () => {
		const gate = Promise.withResolvers<void>();
		const root = createHarness({ backgroundGate: gate.promise, backgroundLifecycleAbort: "throw" });
		const headerA = context([], {
			sessionFile: "/sessions/background-throw-a.jsonl",
			sessionId: "background-throw-a",
		});
		const headerB = context([], {
			sessionFile: "/sessions/background-throw-b.jsonl",
			sessionId: "background-throw-b",
		});
		await root.api.fire("session_start", { reason: "startup", type: "session_start" }, headerA);
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");
		const executing = tool.execute(
			"background-session-switch-abort-throws",
			{ agent: "researcher", task: "Runner remains governed after failed abort transport" },
			new AbortController().signal,
			undefined,
			headerA,
		);
		while (root.engineParams.length === 0) await Bun.sleep(1);
		await root.api.fire("session_start", { reason: "switch", type: "session_start" }, headerB);
		gate.resolve();
		const result = await executing;

		expect(root.governor.settlements).toBe(1);
		expect(root.governor.failures).toBe(0);
		expect(result.content[0]?.text).toContain("session ended or changed");
	});

	test("settles a completed foreground result against its original session after shutdown", async () => {
		const gate = Promise.withResolvers<void>();
		const asyncDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-root-foreground-race-"));
		temporaryDirectories.add(asyncDir);
		const root = createHarness({
			foregroundAsyncDir: asyncDir,
			foregroundGate: gate.promise,
			foregroundDetails: {
				mode: "parallel",
				runId: "foreground-mixed",
				results: [
					{ agent: "reviewer", success: true, exitCode: 0 } as never,
					{ agent: "writer", success: true, exitCode: 0, detached: true } as never,
				],
			},
		});
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");
		const executing = tool.execute(
			"foreground-shutdown-race",
			{ agent: "reviewer", task: "Finish before returning", foreground: true },
			new AbortController().signal,
			undefined,
			context(),
		);
		while (root.governor.starts.length === 0) await Bun.sleep(1);
		await root.api.fire("session_shutdown", { reason: "quit", type: "session_shutdown" });
		gate.resolve();
		const result = await executing;

		expect(root.governor.settlements).toBe(1);
		expect(root.governor.failures).toBe(0);
		expect(result.content[0]?.text).toContain("parent session ended or changed");
	});

	test("delegates private Context projection fitting to the Agent executor", async () => {
		const root = createHarness({
			contextProjection: '<pi-stuff-context trust="reference-only">memory</pi-stuff-context>',
		});
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");

		await tool.execute(
			"fresh-call",
			{ agent: "researcher", task: "Fresh task" },
			new AbortController().signal,
			undefined,
			context(),
		);
		await tool.execute(
			"fork-call",
			{ agent: "researcher", context: "fork", task: "Fork task" },
			new AbortController().signal,
			undefined,
			context(),
		);

		expect(root.projectionOwnership.delegated).toBe(true);
		expect(root.projections).toEqual([]);
		expect(root.engineParams.map((params) => params.contextProjection)).toEqual([undefined, undefined]);
	});

	test("defers existing-ledger reconciliation until an explicit Agent interaction", async () => {
		const root = createHarness({ governorLedgerExists: true });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });

		expect(root.governor.reconcileChecks).toBe(0);
		expect(root.governor.reconciles).toBe(0);
		expect(root.directories).toEqual([]);
		expect(root.watcher.starts).toBe(0);
		expect(root.watcher.primes).toBe(0);

		await root.api.commands.get("agents")?.handler("", context());

		expect(root.governor.reconcileChecks).toBe(1);
		expect(root.governor.reconciles).toBe(1);
		expect(root.watcher.starts).toBe(1);
		expect(root.watcher.primes).toBe(1);
	});

	test("restores an existing active run before starting its watcher", async () => {
		const root = createHarness({ restoreActive: true });
		await root.api.fire("session_start", { reason: "resume", type: "session_start" });

		expect(root.directories).toEqual([]);
		expect(root.watcher.starts).toBe(0);
		expect(root.watcher.primes).toBe(0);
		expect(root.tracker.pollers).toBe(0);
		expect(root.governor.reconciles).toBe(0);
		expect(root.state.value?.asyncJobs.has("restored")).toBe(true);

		await root.api.commands.get("agents")?.handler("", context());

		expect(root.watcher.starts).toBe(1);
		expect(root.watcher.primes).toBe(1);
		expect(root.tracker.pollers).toBe(1);
		expect(root.governor.reconciles).toBe(1);
	});

	test("propagates roster restoration failure instead of loading a partial Agent capability", async () => {
		const root = createHarness({ restoreFailure: true });
		await expect(root.api.fire("session_start", { reason: "resume", type: "session_start" })).rejects.toThrow(
			"injected restore EIO",
		);
		expect(root.tracker.restored).toBe(1);
		expect(root.watcher.starts).toBe(0);
		expect(root.watcher.primes).toBe(0);
		expect(root.supervisor.started).toBe(0);
	});

	test("isolates reused session paths by header identity while preserving ordinary reload continuity", async () => {
		const root = createHarness();
		const headerA = context([], { sessionFile: "/sessions/reused.jsonl", sessionId: "header-a" });
		const headerB = context([], { sessionFile: "/sessions/reused.jsonl", sessionId: "header-b" });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" }, headerA);
		const identityA = currentSessionId(root);
		await root.api.fire("session_start", { reason: "resume", type: "session_start" }, headerA);
		expect(currentSessionId(root)).toBe(identityA);
		await root.api.commands.get("agents")?.handler("", headerA);
		expect(root.governor.binds.at(-1)?.sessionId).toBe(identityA);

		await root.api.fire("session_start", { reason: "switch", type: "session_start" }, headerB);
		const identityB = currentSessionId(root);
		expect(identityB).not.toBe(identityA);
		await root.api.commands.get("agents")?.handler("", headerB);
		expect(root.governor.binds.at(-1)?.sessionId).toBe(identityB);

		const before = root.tracker.started;
		root.api.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, { id: "old-header-run", sessionId: identityA });
		expect(root.tracker.started).toBe(before);
		root.api.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, { id: "new-header-run", sessionId: identityB });
		expect(root.tracker.started).toBe(before + 1);
	});

	test("does not let an old session compatibility check authorize a new-session launch", async () => {
		const firstCheck = Promise.withResolvers<{
			ok: true;
			importedLogicalAgentIds: string[];
			legacyLedgerObserved: false;
		}>();
		let checks = 0;
		const root = createHarness({
			compatibility: async () => {
				checks += 1;
				if (checks === 1) return firstCheck.promise;
				return { ok: true, importedLogicalAgentIds: [], legacyLedgerObserved: false };
			},
		});
		const headerA = context([], { sessionFile: "/sessions/compat-a.jsonl", sessionId: "compat-a" });
		const headerB = context([], { sessionFile: "/sessions/compat-b.jsonl", sessionId: "compat-b" });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" }, headerA);
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");
		const staleLaunch = tool.execute(
			"stale-compatibility",
			{ agent: "researcher", task: "Must remain in session A" },
			new AbortController().signal,
			undefined,
			headerA,
		);
		while (checks < 1) await Bun.sleep(1);

		await root.api.fire("session_start", { reason: "switch", type: "session_start" }, headerB);
		const currentLaunch = await tool.execute(
			"current-compatibility",
			{ agent: "researcher", task: "Launch in session B" },
			new AbortController().signal,
			undefined,
			headerB,
		);

		expect(checks).toBe(2);
		expect(currentLaunch.content[0]?.text).toContain("started in the background");
		expect(root.engineParams).toHaveLength(1);
		firstCheck.resolve({ ok: true, importedLogicalAgentIds: [], legacyLedgerObserved: false });
		const staleResult = await staleLaunch;
		expect(staleResult.content[0]?.text).toContain("session ended or changed");
		expect(root.engineParams).toHaveLength(1);
	});

	test("releases a legacy governor barrier on A to B to A session transitions", async () => {
		let barrierHeld = false;
		let releases = 0;
		const root = createHarness({
			compatibility: async () => {
				if (barrierHeld) return { ok: false, message: "self-held legacy barrier" };
				barrierHeld = true;
				let released = false;
				return {
					ok: true,
					importedLogicalAgentIds: [],
					legacyLedgerObserved: false,
					releaseLegacyBarrier: () => {
						if (released) return;
						released = true;
						barrierHeld = false;
						releases += 1;
					},
				};
			},
		});
		const headerA = context([], { sessionFile: "/sessions/barrier-a.jsonl", sessionId: "barrier-a" });
		const headerB = context([], { sessionFile: "/sessions/barrier-b.jsonl", sessionId: "barrier-b" });
		const tool = root.api.tools.get("subagent");
		if (!tool) throw new Error("Expected public Agent tool");

		await root.api.fire("session_start", { reason: "startup", type: "session_start" }, headerA);
		const first = await tool.execute(
			"barrier-a-first",
			{ agent: "researcher", task: "First A launch" },
			new AbortController().signal,
			undefined,
			headerA,
		);
		expect(first.content[0]?.text).toContain("started in the background");
		expect(barrierHeld).toBeTrue();

		await root.api.fire("session_start", { reason: "switch", type: "session_start" }, headerB);
		expect(barrierHeld).toBeFalse();
		expect(releases).toBe(1);
		await root.api.fire("session_start", { reason: "switch", type: "session_start" }, headerA);
		const second = await tool.execute(
			"barrier-a-second",
			{ agent: "researcher", task: "Second A launch" },
			new AbortController().signal,
			undefined,
			headerA,
		);
		expect(second.content[0]?.text).toContain("started in the background");
		expect(barrierHeld).toBeTrue();
		await root.api.fire("session_shutdown", { reason: "quit", type: "session_shutdown" }, headerA);
		expect(barrierHeld).toBeFalse();
		expect(releases).toBe(2);
	});

	test("normalizes one branch-proven v1 lifecycle event before tracker projection", async () => {
		const root = createHarness();
		await root.api.fire("session_start", { reason: "resume", type: "session_start" });
		const primary = currentSessionId(root);
		if (!root.state.value) throw new Error("Expected root state");
		root.state.value.currentSessionScope = {
			sessionId: primary,
			governorSessionId: primary,
			legacyArtifactSessionId: "/sessions/root.jsonl",
			legacyRunIds: new Set(["legacy-live"]),
		};

		root.api.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, {
			id: "legacy-live",
			runId: "legacy-live",
			sessionId: "/sessions/root.jsonl",
		});

		expect(root.tracker.started).toBe(1);
		expect(root.state.value.asyncJobs.get("legacy-live")?.sessionId).toBe(primary);
	});

	test("replays foreground Agent rows from durable tool results on cold session start", async () => {
		const root = createHarness();
		await root.api.fire(
			"session_start",
			{ reason: "resume", type: "session_start" },
			context([
				{
					type: "message",
					timestamp: "2026-08-06T10:00:00.000Z",
					message: {
						role: "toolResult",
						toolName: "subagent",
						details: {
							mode: "single",
							runId: "cold-foreground",
							cwd: "/project",
							results: [
								{
									agent: "reviewer",
									task: "Review the durable foreground result",
									exitCode: 0,
									finalOutput: "Review complete",
									sessionFile: "/sessions/foreground-child.jsonl",
								},
							],
						},
					},
				},
			]),
		);

		expect(root.state.value?.foregroundRuns?.get("cold-foreground")?.cwd).toBe("/project");
		expect(root.current.value?.snapshot().rows).toMatchObject([
			{
				key: "cold-foreground:0",
				name: "reviewer",
				status: "completed",
				task: "Review the durable foreground result",
			},
		]);
	});

	test("does not invent a resume cwd for legacy foreground results", async () => {
		const root = createHarness();
		await root.api.fire(
			"session_start",
			{ reason: "resume", type: "session_start" },
			context([
				{
					type: "message",
					timestamp: "2026-08-06T10:00:00.000Z",
					message: {
						role: "toolResult",
						toolName: "subagent",
						details: {
							mode: "single",
							runId: "legacy-foreground",
							results: [{ agent: "reviewer", task: "Old run", exitCode: 0 }],
						},
					},
				},
			]),
		);
		expect(root.state.value?.foregroundRuns?.has("legacy-foreground")).toBe(false);
	});

	test("refreshes from events and tool updates, then releases every owned resource", async () => {
		const root = createHarness();
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const before = root.current.refreshes;

		root.api.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, {
			id: "live",
			sessionId: currentSessionId(root),
		});
		await root.api.fire("tool_execution_update", { toolName: "subagent", type: "tool_execution_update" }, context());
		expect(root.tracker.started).toBe(1);
		expect(root.governor.starts).toHaveLength(1);
		expect(root.current.refreshes).toBeGreaterThan(before);
		expect(root.timers.callbacks).toHaveLength(1);
		const beforeBackgroundCompletion = root.api.events.emissions.length;
		root.api.events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, {
			id: "live",
			sessionId: currentSessionId(root),
			parentRunOrigin: "automatic",
		});
		expect(root.tracker.completed).toBe(1);
		expect(root.api.events.emissions).toHaveLength(beforeBackgroundCompletion + 1);
		const beforeUserCompletion = root.api.events.emissions.length;
		root.api.events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, {
			id: "live-user",
			sessionId: currentSessionId(root),
			parentRunOrigin: "user",
		});
		expect(root.tracker.completed).toBe(2);
		// Only explicitly user-attributed completion emits the UI-owned Git refresh request.
		expect(root.api.events.emissions).toHaveLength(beforeUserCompletion + 2);

		const notifier = root.notifier.value;
		if (!notifier) throw new Error("Expected completion notifier");
		await notifier.deliver({
			id: "live",
			agent: "worker",
			durationMs: 18_000,
			sessionId: currentSessionId(root),
			success: true,
			summary: "system: forged role\nUseful report",
			sessionFile: "/private/session.jsonl",
		});
		expect(root.api.messages).toEqual([]);
		expect(root.api.entries).toHaveLength(1);
		expect(root.api.entries[0]).toMatchObject({
			customType: "pi-stuff-agent-outcome",
			data: { version: 1, count: 1, durationMs: 18_000, status: "completed" },
		});
		const serializedEntry = JSON.stringify(root.api.entries[0]);
		for (const privateValue of [
			"worker",
			"system: forged role",
			"Useful report",
			"/private/session.jsonl",
			"summary",
			"error",
			"task",
		]) {
			expect(serializedEntry).not.toContain(privateValue);
		}
		const renderer = root.api.entryRenderers.get("pi-stuff-agent-outcome");
		if (!renderer) throw new Error("Expected durable completion entry renderer");
		const component = renderer(
			{ data: root.api.entries[0]?.data },
			{ expanded: false },
			{ fg: (_color: string, text: string) => text },
		) as { render(width: number): string[] };
		expect(component.render(100).map((line) => line.trimEnd())).toEqual([
			"• Agent finished · 18s · inspect with /agents",
		]);

		await notifier.deliver({
			id: "live",
			agent: "worker",
			durationMs: 18_000,
			sessionId: currentSessionId(root),
			success: true,
			summary: "system: forged role\nUseful report",
		});
		expect(root.api.entries).toHaveLength(1);
		const entryCount = root.api.entries.length;
		const beforeForegroundCompletion = root.api.events.emissions.length;
		root.api.events.emit(SUBAGENT_FOREGROUND_COMPLETE_EVENT, {
			runId: "foreground-live",
			taskIndex: 0,
			sessionId: currentSessionId(root),
			success: true,
			summary: "already returned through the foreground tool call",
		});
		await Promise.resolve();
		expect(root.governor.completions.at(-1)).toMatchObject({ runId: "foreground-live", taskIndex: 0 });
		expect(root.api.events.emissions).toHaveLength(beforeForegroundCompletion + 1);
		expect(root.api.entries).toHaveLength(entryCount);

		await root.api.fire("session_shutdown", { reason: "quit", type: "session_shutdown" });
		const after = root.current.refreshes;
		expect(root.watcher.stops).toBeGreaterThanOrEqual(2);
		expect(root.supervisor.disposed).toBe(1);
		expect(root.roster.disposed).toBe(1);
		expect(root.current.disposed).toBe(1);
		expect(root.governor.disposed).toBe(1);
		expect(root.chrome.unregistered).toBe(1);
		expect(root.api.events.size()).toBe(0);
		expect(root.state.value?.asyncJobs.size).toBe(0);
		expect(process.env[SUBAGENT_PARENT_SESSION_ENV]).toBeUndefined();

		root.api.events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, { id: "late" });
		await root.api.fire("tool_execution_update", { toolName: "subagent", type: "tool_execution_update" }, context());
		expect(root.current.refreshes).toBe(after);
	});

	test("waits for Command Dialog cleanup before appending a durable completion outcome", async () => {
		let releaseIdle: (() => void) | undefined;
		const coordinatorIdle = new Promise<void>((resolve) => {
			releaseIdle = resolve;
		});
		const root = createHarness({ coordinatorIdle });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const notifier = root.notifier.value;
		if (!notifier) throw new Error("Expected completion notifier");

		const delivery = notifier.deliver({
			id: "while-dialog-closes",
			agent: "worker",
			sessionId: currentSessionId(root),
			success: true,
			summary: "Finished after the blocking dialog.",
		});
		await Promise.resolve();
		expect(root.api.entries).toEqual([]);

		releaseIdle?.();
		expect(await delivery).toBe(true);
		expect(root.api.entries).toHaveLength(1);
		expect(root.api.messages).toEqual([]);
	});

	test("deduplicates a persisted completion outcome after cold session resume", async () => {
		const first = createHarness();
		await first.api.fire("session_start", { reason: "startup", type: "session_start" });
		const completion: CompletionNotification = {
			id: "resume-run",
			agent: "worker",
			sessionId: currentSessionId(first),
			success: true,
			summary: "private child report",
		};
		expect(await first.notifier.value?.deliver(completion)).toBe(true);
		const persisted = first.api.entries[0];
		if (!persisted) throw new Error("Expected persisted completion outcome");

		const resumed = createHarness();
		await resumed.api.fire(
			"session_start",
			{ reason: "resume", type: "session_start" },
			context([{ type: "custom", customType: persisted.customType, data: persisted.data }]),
		);
		expect(await resumed.notifier.value?.deliver(completion)).toBe(true);
		expect(resumed.api.entries).toEqual([]);
		expect(resumed.api.messages).toEqual([]);
	});

	test("projects parallel failure and stopped outcomes without child details", async () => {
		const failed = createHarness();
		await failed.api.fire("session_start", { reason: "startup", type: "session_start" });
		expect(
			await failed.notifier.value?.deliver({
				id: "parallel-run",
				sessionId: currentSessionId(failed),
				success: false,
				results: [
					{ agent: "first", output: "private first report", success: true },
					{ agent: "second", error: "private failure", success: false },
				],
			}),
		).toBe(true);
		expect(failed.api.entries[0]?.data).toMatchObject({ count: 2, status: "failed", version: 1 });
		expect(JSON.stringify(failed.api.entries[0]?.data)).not.toContain("private");

		const stopped = createHarness();
		await stopped.api.fire("session_start", { reason: "startup", type: "session_start" });
		expect(
			await stopped.notifier.value?.deliver({
				id: "stopped-run",
				interrupted: true,
				sessionId: currentSessionId(stopped),
				success: false,
			}),
		).toBe(true);
		expect(stopped.api.entries[0]?.data).toMatchObject({ count: 1, status: "stopped", version: 1 });
	});

	test("rejects a launch before persistence or engine dispatch when the session governor is full", async () => {
		const root = createHarness({ governorReject: true });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });

		const result = await root.api.tools
			.get("subagent")
			?.execute(
				"blocked-call",
				{ agent: "researcher", task: "Should not start" },
				new AbortController().signal,
				undefined,
				context(),
			);

		expect(root.engineParams).toEqual([]);
		expect(root.directories).toEqual([]);
		expect(result?.content).toEqual([{ type: "text", text: "Agent limit reached; wait for one to finish." }]);
	});
});
