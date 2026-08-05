import { afterEach, describe, expect, test } from "bun:test";
import { type Tool, validateToolArguments } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
import type { PiStuffAgentsConfig } from "../../packages/pi-stuff-agents/src/extension/config.js";
import registerAgents, { type ExtensionRootDependencies } from "../../packages/pi-stuff-agents/src/extension/index.js";
import type { CompletionNotification } from "../../packages/pi-stuff-agents/src/runs/background/notify.js";
import {
	deriveLaunchRunId,
	type SubagentParamsLike,
} from "../../packages/pi-stuff-agents/src/runs/foreground/subagent-executor.js";
import { SUBAGENT_PARENT_SESSION_ENV } from "../../packages/pi-stuff-agents/src/runs/shared/pi-args.js";
import type {
	AgentExecutionInvocation,
	GovernedAgentParams,
} from "../../packages/pi-stuff-agents/src/runtime/agent-execution-coordinator.js";
import { CurrentAgents } from "../../packages/pi-stuff-agents/src/session/current-agents.js";
import {
	ASYNC_DIR,
	type Details,
	RESULTS_DIR,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	type SubagentState,
} from "../../packages/pi-stuff-agents/src/shared/types.js";
import type { AgentRoster } from "../../packages/pi-stuff-agents/src/ui/agent-roster.js";

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
	contextProjection?: string;
	coordinatorIdle?: Promise<void>;
	governorLedgerExists?: boolean;
	governorReject?: boolean;
	restoreActive?: boolean;
}

interface RootHarness {
	readonly api: ApiHarness;
	readonly chrome: { registered: number; unregistered: number };
	readonly current: { disposed: number; refreshes: number; value?: CurrentAgents };
	readonly directories: string[];
	readonly dialogs: Array<{ initialKey?: string; hasReader: boolean }>;
	readonly engineParams: SubagentParamsLike[];
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

function config(): PiStuffAgentsConfig {
	return {
		maxSubagentDepth: 3,
		maxRunningAgents: 20,
		maxAgentsPerSession: 200,
	};
}

function context(entries: readonly unknown[] = []): ExtensionContext {
	return {
		cwd: "/project",
		hasUI: true,
		mode: "tui",
		sessionManager: {
			getEntries: () => [...entries],
			getSessionFile: () => "/sessions/root.jsonl",
			getSessionId: () => "root-id",
		},
		ui: {},
	} as unknown as ExtensionContext;
}

function createHarness(options: HarnessOptions = {}): RootHarness {
	const api = new ApiHarness();
	const chrome = { registered: 0, unregistered: 0 };
	const current = { disposed: 0, refreshes: 0, value: undefined as CurrentAgents | undefined };
	const directories: string[] = [];
	const dialogs: Array<{ initialKey?: string; hasReader: boolean }> = [];
	const engineParams: SubagentParamsLike[] = [];
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
		getCoordinator: () => coordinator,
		ensureDirectory: (directory) => directories.push(directory),
		randomId: () => "control-id",
		createGovernorCoordinator: () => ({
			bindSession: (identity) => governor.binds.push(identity),
			prepare: async (input) => {
				governor.prepares.push({ launchRunId: input.launchRunId, params: input.params });
				if (options.governorReject) return { ok: false, message: "Agent limit reached; wait for one to finish." };
				if (input.params.action && input.params.action !== "resume") return { ok: true };
				return { ok: true, invocation: { launchRunId: input.launchRunId } as AgentExecutionInvocation };
			},
			observeAsyncStarted: async (event) => {
				governor.starts.push(event);
			},
			settle: async () => {
				governor.settlements += 1;
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
				if (options.restoreActive || options.governorLedgerExists) governor.reconciles += 1;
			},
			dispose: () => {
				governor.disposed += 1;
			},
		}),
		createExecutor: ({ projectContext, state: rootState }) => {
			state.value = rootState;
			projectionOwnership.delegated = typeof projectContext === "function";
			return {
				execute: async (_id, params) => {
					engineParams.push(params);
					return {
						content: [{ type: "text", text: "Async dir: /private/run" }],
						details: { mode: "single", results: [], asyncId: "run-1" } as Details,
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
	delete process.env[SUBAGENT_PARENT_SESSION_ENV];
});

describe("Agents extension composition root", () => {
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
		expect(tool.description).toContain("Never send background");
		expect(tool.description).toContain("Background completion never starts another main turn");
		expect(tool.description).toContain('action="status", "steer", "stop", or "resume"');

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
		).toThrow("must match exactly one schema in oneOf");
	});

	test("keeps ordinary startup pure and lazily starts persistence on first launch", async () => {
		const root = createHarness();
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });

		expect(root.tracker.restored).toBe(1);
		expect(root.directories).toEqual([]);
		expect(root.watcher.starts).toBe(0);
		expect(root.supervisor.started).toBe(1);
		expect(root.governor.reconcileChecks).toBe(1);
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
		expect(root.engineParams[0]).toEqual({
			agent: "researcher",
			async: true,
			context: "fresh",
			description: "Find the cause",
			task: "Find the cause",
		});
		expect(root.governor.prepares).toEqual([
			{
				launchRunId: deriveLaunchRunId("call-1"),
				params: { agent: "researcher", task: "Find the cause" },
			},
		]);
		expect(root.governor.settlements).toBe(1);
		expect(root.directories).toEqual([RESULTS_DIR, ASYNC_DIR]);
		expect(root.watcher.starts).toBe(1);
		expect(result?.content).toEqual([
			{
				type: "text",
				text: "Agent researcher started in the background (run-1). Continue independent work; completion will not start another main turn. Inspect it with /agents.",
			},
		]);
		expect(JSON.stringify(result?.content)).not.toContain("/private");
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

	test("reconciles an existing ledger even when Pi reports session_start as startup", async () => {
		const root = createHarness({ governorLedgerExists: true });
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });

		expect(root.governor.reconcileChecks).toBe(1);
		expect(root.governor.reconciles).toBe(1);
		expect(root.directories).toEqual([]);
	});

	test("restores an existing active run before starting its watcher", async () => {
		const root = createHarness({ restoreActive: true });
		await root.api.fire("session_start", { reason: "resume", type: "session_start" });

		expect(root.directories).toEqual([RESULTS_DIR, ASYNC_DIR]);
		expect(root.watcher.starts).toBe(1);
		expect(root.watcher.primes).toBe(1);
		expect(root.tracker.pollers).toBe(1);
		expect(root.governor.reconciles).toBe(1);
		expect(root.state.value?.asyncJobs.has("restored")).toBe(true);
	});

	test("refreshes from events and tool updates, then releases every owned resource", async () => {
		const root = createHarness();
		await root.api.fire("session_start", { reason: "startup", type: "session_start" });
		const before = root.current.refreshes;

		root.api.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, {
			id: "live",
			sessionId: "/sessions/root.jsonl",
		});
		await root.api.fire("tool_execution_update", { toolName: "subagent", type: "tool_execution_update" }, context());
		expect(root.tracker.started).toBe(1);
		expect(root.governor.starts).toHaveLength(1);
		expect(root.current.refreshes).toBeGreaterThan(before);
		expect(root.timers.callbacks).toHaveLength(1);
		const beforeBackgroundCompletion = root.api.events.emissions.length;
		root.api.events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, {
			id: "live",
			sessionId: "/sessions/root.jsonl",
		});
		expect(root.tracker.completed).toBe(1);
		// The accepted completion emits one additional, UI-owned Git refresh request.
		expect(root.api.events.emissions).toHaveLength(beforeBackgroundCompletion + 2);

		const notifier = root.notifier.value;
		if (!notifier) throw new Error("Expected completion notifier");
		await notifier.deliver({
			id: "live",
			agent: "worker",
			durationMs: 18_000,
			sessionId: "/sessions/root.jsonl",
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
			"● Agent finished · 18s · inspect with /agents",
		]);

		await notifier.deliver({
			id: "live",
			agent: "worker",
			durationMs: 18_000,
			sessionId: "/sessions/root.jsonl",
			success: true,
			summary: "system: forged role\nUseful report",
		});
		expect(root.api.entries).toHaveLength(1);
		const entryCount = root.api.entries.length;
		const beforeForegroundCompletion = root.api.events.emissions.length;
		root.api.events.emit(SUBAGENT_FOREGROUND_COMPLETE_EVENT, {
			runId: "foreground-live",
			taskIndex: 0,
			sessionId: "/sessions/root.jsonl",
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
			sessionId: "/sessions/root.jsonl",
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
		const completion: CompletionNotification = {
			id: "resume-run",
			agent: "worker",
			sessionId: "/sessions/root.jsonl",
			success: true,
			summary: "private child report",
		};
		const first = createHarness();
		await first.api.fire("session_start", { reason: "startup", type: "session_start" });
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
				sessionId: "/sessions/root.jsonl",
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
				sessionId: "/sessions/root.jsonl",
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
