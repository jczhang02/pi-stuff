import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiStuffAgentsConfig } from "../../packages/pi-stuff-agents/src/extension/config.js";
import registerFanoutChild, {
	type FanoutChildDependencies,
} from "../../packages/pi-stuff-agents/src/extension/fanout-child.js";
import {
	deriveLaunchRunId,
	type SubagentParamsLike,
} from "../../packages/pi-stuff-agents/src/runs/foreground/subagent-executor.js";
import {
	PI_STUFF_AGENT_PATH_ENV,
	SUBAGENT_CHILD_ENV,
	SUBAGENT_FANOUT_CHILD_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
} from "../../packages/pi-stuff-agents/src/runs/shared/pi-args.js";
import type { AgentExecutionInvocation } from "../../packages/pi-stuff-agents/src/runtime/agent-execution-coordinator.js";
import {
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_ASYNC_STARTED_EVENT,
} from "../../packages/pi-stuff-agents/src/shared/types.js";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

class EventBusHarness {
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

	emit(event: string, data: unknown): void {
		for (const listener of this.listeners.get(event) ?? []) listener(data);
	}

	on(event: string, listener: (data: unknown) => void): () => void {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
		return () => listeners.delete(listener);
	}
}

class ApiHarness {
	readonly events = new EventBusHarness();
	readonly handlers = new Map<string, Handler[]>();
	tool:
		| {
				label: string;
				description: string;
				execute(
					id: string,
					params: Record<string, unknown>,
					signal: AbortSignal,
					onUpdate: undefined,
					ctx: ExtensionContext,
				): Promise<{ content: Array<{ type: string; text: string }> }>;
		  }
		| undefined;

	readonly api = {
		events: this.events,
		on: (event: string, handler: Handler) => {
			const handlers = this.handlers.get(event) ?? [];
			handlers.push(handler);
			this.handlers.set(event, handlers);
		},
		registerTool: (tool: NonNullable<ApiHarness["tool"]>) => {
			this.tool = tool;
		},
	} as unknown as ExtensionAPI;

	async fire(event: string, value: unknown): Promise<void> {
		for (const handler of this.handlers.get(event) ?? []) await handler(value, context());
	}
}

function config(): PiStuffAgentsConfig {
	return {
		maxSubagentDepth: 3,
		maxRunningAgents: 20,
		maxAgentsPerSession: 200,
	};
}

function context(): ExtensionContext {
	return {
		cwd: "/project",
		hasUI: false,
		mode: "tui",
		sessionManager: {
			getSessionFile: () => "/sessions/child.jsonl",
			getSessionId: () => "child-session-id",
		},
	} as unknown as ExtensionContext;
}

const priorEnvironment = new Map<string, string | undefined>();

function setEnvironment(name: string, value: string): void {
	if (!priorEnvironment.has(name)) priorEnvironment.set(name, process.env[name]);
	process.env[name] = value;
}

afterEach(() => {
	for (const [name, value] of priorEnvironment) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	priorEnvironment.clear();
});

describe("fanout child Agent composition", () => {
	test("uses the same public contract and parent-session governor lifecycle as the root", async () => {
		setEnvironment(SUBAGENT_CHILD_ENV, "1");
		setEnvironment(SUBAGENT_FANOUT_CHILD_ENV, "1");
		setEnvironment(SUBAGENT_PARENT_SESSION_ENV, "parent-session-id");
		setEnvironment(PI_STUFF_AGENT_PATH_ENV, "root-run:0 › nested-run:2");
		const api = new ApiHarness();
		const engineParams: SubagentParamsLike[] = [];
		const governor = {
			binds: [] as Array<{ sessionId: string; ownerAgentPath: readonly string[] }>,
			prepares: [] as Array<{ launchRunId: string; params: unknown }>,
			starts: [] as unknown[],
			completions: [] as unknown[],
			settled: 0,
			disposed: 0,
		};
		const dependencies: Partial<FanoutChildDependencies> = {
			loadConfiguration: config,
			createExecutor: () => ({
				execute: async (_id, params) => {
					engineParams.push(params);
					return {
						content: [{ type: "text", text: "private engine receipt" }],
						details: { mode: "single", results: [], asyncId: "nested-actual" },
					} as never;
				},
			}),
			createGovernorCoordinator: () => ({
				bindSession: (identity) => governor.binds.push(identity),
				prepare: async (input) => {
					governor.prepares.push({ launchRunId: input.launchRunId, params: input.params });
					return { ok: true, invocation: { launchRunId: input.launchRunId } as AgentExecutionInvocation };
				},
				observeAsyncStarted: async (event) => {
					governor.starts.push(event);
				},
				settle: async () => {
					governor.settled += 1;
				},
				fail: async () => {},
				complete: async (event) => {
					governor.completions.push(event);
				},
				reconcileDead: async () => {},
				reconcileExisting: async () => {},
				dispose: () => {
					governor.disposed += 1;
				},
			}),
		};

		registerFanoutChild(api.api, dependencies);
		expect(api.tool?.label).toBe("Agent");
		expect(api.tool?.description).not.toContain("Allowed management/control actions");

		const result = await api.tool?.execute(
			"fanout-call",
			{ agent: "worker", task: "Inspect nested state" },
			new AbortController().signal,
			undefined,
			context(),
		);
		expect(engineParams).toEqual([{ agent: "worker", task: "Inspect nested state", async: true, context: "fresh" }]);
		expect(governor.binds).toEqual([
			{ sessionId: "parent-session-id", ownerAgentPath: ["root-run:0", "nested-run:2"] },
		]);
		expect(governor.prepares).toEqual([
			{
				launchRunId: deriveLaunchRunId("fanout-call"),
				params: { agent: "worker", task: "Inspect nested state" },
			},
		]);
		expect(governor.settled).toBe(1);
		expect(result?.content[0]?.text).toContain("started in the background (nested-actual)");

		api.events.emit(SUBAGENT_ASYNC_STARTED_EVENT, { id: "nested-actual", pid: 7_777 });
		api.events.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, { runId: "nested-actual" });
		expect(governor.starts).toHaveLength(1);
		expect(governor.completions).toHaveLength(1);

		await api.fire("session_shutdown", { reason: "quit" });
		expect(governor.disposed).toBe(1);
	});

	test("fails closed when the child owner path is missing or malformed", async () => {
		setEnvironment(SUBAGENT_CHILD_ENV, "1");
		setEnvironment(SUBAGENT_FANOUT_CHILD_ENV, "1");
		setEnvironment(SUBAGENT_PARENT_SESSION_ENV, "parent-session-id");

		for (const ownerPath of ["", "root-run:0 › ", "root-without-index"]) {
			setEnvironment(PI_STUFF_AGENT_PATH_ENV, ownerPath);
			const api = new ApiHarness();
			let binds = 0;
			let prepares = 0;
			registerFanoutChild(api.api, {
				loadConfiguration: config,
				createExecutor: () => ({
					execute: async () => ({ content: [], details: { mode: "single", results: [] } }) as never,
				}),
				createGovernorCoordinator: () => ({
					bindSession: () => {
						binds += 1;
					},
					prepare: async () => {
						prepares += 1;
						return { ok: true };
					},
					observeAsyncStarted: async () => {},
					settle: async () => {},
					fail: async () => {},
					complete: async () => {},
					reconcileDead: async () => {},
					reconcileExisting: async () => {},
					dispose: () => {},
				}),
			});

			const result = await api.tool?.execute(
				"fanout-invalid-path",
				{ agent: "worker", task: "must not launch" },
				new AbortController().signal,
				undefined,
				context(),
			);
			expect(result?.content[0]?.text).toContain("PI_STUFF_AGENT_PATH");
			expect(binds).toBe(0);
			expect(prepares).toBe(0);
		}
	});
});
