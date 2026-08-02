import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "../agents/agents.ts";
import { deliverSubagentIntercomMessageEvent } from "../intercom/result-intercom.ts";
import { resolveSubagentIntercomTarget } from "../intercom/subagent-target.ts";
import {
	createSubagentExecutor,
	deriveLaunchRunId,
	type SubagentParamsLike,
} from "../runs/foreground/subagent-executor.ts";
import {
	readNestedControlRequests,
	resolveNestedRouteFromEnv,
	writeNestedControlResult,
} from "../runs/shared/nested-events.ts";
import {
	PI_STUFF_AGENT_PATH_ENV,
	SUBAGENT_CHILD_ENV,
	SUBAGENT_FANOUT_CHILD_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
} from "../runs/shared/pi-args.ts";
import {
	type AgentExecutionCoordinatorPort,
	createDurableAgentExecutionCoordinator,
	parseAgentOwnerPath,
} from "../runtime/agent-execution-coordinator.ts";
import { getArtifactsDir } from "../shared/artifacts.ts";
import {
	type Details,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_ASYNC_STARTED_EVENT,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	type SubagentState,
	TEMP_ROOT_DIR,
} from "../shared/types.ts";
import { loadConfig, type PiStuffAgentsConfig } from "./config.ts";
import { type PublicAgentParams, projectEngineResult, toEngineParams } from "./product-executor.ts";
import { SubagentParams } from "./schemas.ts";
import { buildSubagentToolDescription } from "./tool-description.ts";

interface FanoutExecutor {
	execute(
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<Details>>;
}

interface FanoutExecutorInput {
	readonly config: PiStuffAgentsConfig;
	readonly pi: ExtensionAPI;
	readonly state: SubagentState;
}

export interface FanoutChildDependencies {
	readonly createExecutor: (input: FanoutExecutorInput) => FanoutExecutor;
	readonly createGovernorCoordinator: (config: PiStuffAgentsConfig) => AgentExecutionCoordinatorPort;
	readonly loadConfiguration: () => PiStuffAgentsConfig;
}

function getSubagentSessionRoot(parentSessionFile: string | null): string {
	if (parentSessionFile) {
		const baseName = path.basename(parentSessionFile, ".jsonl");
		const sessionsDir = path.dirname(parentSessionFile);
		return path.join(sessionsDir, baseName);
	}
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-session-"));
}

function expandTilde(p: string): string {
	return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

const PRODUCTION_DEPENDENCIES: FanoutChildDependencies = {
	createExecutor: ({ config, pi, state }) =>
		createSubagentExecutor({
			pi,
			state,
			config,
			asyncByDefault: true,
			tempArtifactsDir: getArtifactsDir(null),
			getSubagentSessionRoot,
			expandTilde,
			discoverAgents,
			allowMutatingManagementActions: false,
		}),
	createGovernorCoordinator: (config) =>
		createDurableAgentExecutionCoordinator({
			rootDir: path.join(TEMP_ROOT_DIR, "session-governor"),
			limits: {
				maxDepth: config.maxSubagentDepth,
				maxRunning: config.maxRunningAgents,
				maxTotal: config.maxAgentsPerSession,
			},
		}),
	loadConfiguration: loadConfig,
};

function createChildSafeState(): SubagentState {
	return {
		baseCwd: "",
		currentSessionId: null,
		subagentInProgress: false,
		subagentSpawns: { sessionId: null, count: 0 },
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		pendingForegroundControlNotices: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: {
			schedule: () => false,
			clear: () => {},
		},
	};
}

function startNestedControlInboxListener(pi: ExtensionAPI, state: SubagentState): NodeJS.Timeout | undefined {
	let route: ReturnType<typeof resolveNestedRouteFromEnv>;
	try {
		route = resolveNestedRouteFromEnv();
	} catch {
		return undefined;
	}
	if (!route) return undefined;
	const seen = new Set<string>();
	const inFlight = new Set<string>();
	const pendingResults = new Map<string, Parameters<typeof writeNestedControlResult>[1]>();
	const timer = setInterval(() => {
		try {
			for (const request of readNestedControlRequests(route)) {
				if (seen.has(request.requestId) || inFlight.has(request.requestId)) continue;
				inFlight.add(request.requestId);
				void (async () => {
					try {
						let result = pendingResults.get(request.requestId);
						if (!result) {
							let ok = false;
							let message = "Control request failed.";
							try {
								const control = state.foregroundControls.get(request.targetRunId);
								if (!control) {
									message = `Nested run ${request.targetRunId} is not active in this fanout child.`;
								} else if (request.action === "interrupt") {
									ok = control.interrupt?.() === true;
									message = ok
										? `Interrupt requested for nested run ${request.targetRunId}.`
										: `Nested run ${request.targetRunId} has no active child step to interrupt.`;
								} else if (!request.message?.trim()) {
									message = "Nested resume requires message.";
								} else if (!control.currentAgent) {
									message = `Nested run ${request.targetRunId} has no active child message route.`;
								} else {
									const index = control.currentIndex ?? 0;
									const target = resolveSubagentIntercomTarget(
										request.targetRunId,
										control.currentAgent,
										index,
									);
									ok = await deliverSubagentIntercomMessageEvent(
										pi.events,
										target,
										`Follow-up for nested run ${request.targetRunId} (${control.currentAgent}):\n\n${request.message.trim()}`,
										500,
										{
											source: "nested-resume",
											runId: request.targetRunId,
											agent: control.currentAgent,
											index,
										},
									);
									message = ok
										? `Delivered follow-up to live nested run ${request.targetRunId}.`
										: `Nested child intercom target is not registered: ${target}`;
								}
							} catch (error) {
								message = error instanceof Error ? error.message : String(error);
							}
							result = {
								ts: Date.now(),
								requestId: request.requestId,
								targetRunId: request.targetRunId,
								ok,
								message,
							};
						}
						try {
							writeNestedControlResult(route, result);
						} catch (error) {
							pendingResults.set(request.requestId, result);
							console.error(
								`Failed to write nested control result for request '${request.requestId}' targeting '${request.targetRunId}' via inbox '${route.controlInbox}'; keeping request for retry:`,
								error,
							);
							return;
						}
						pendingResults.delete(request.requestId);
						seen.add(request.requestId);
						try {
							fs.unlinkSync(request.filePath);
						} catch {}
					} finally {
						inFlight.delete(request.requestId);
					}
				})();
			}
		} catch (error) {
			console.error(
				`Failed to poll nested control inbox '${route.controlInbox}' for root '${route.rootRunId}':`,
				error,
			);
		}
	}, 200);
	timer.unref?.();
	return timer;
}

export default function registerFanoutChildSubagentExtension(
	pi: ExtensionAPI,
	overrides: Partial<FanoutChildDependencies> = {},
): void {
	if (process.env[SUBAGENT_CHILD_ENV] !== "1" || process.env[SUBAGENT_FANOUT_CHILD_ENV] !== "1") return;
	const deps: FanoutChildDependencies = { ...PRODUCTION_DEPENDENCIES, ...overrides };

	const globalStore = globalThis as Record<string, unknown>;
	const registeredKey = "__piSubagentFanoutChildRegisteredApis";
	const registeredApis =
		globalStore[registeredKey] instanceof WeakSet
			? (globalStore[registeredKey] as WeakSet<ExtensionAPI>)
			: new WeakSet<ExtensionAPI>();
	globalStore[registeredKey] = registeredApis;
	if (registeredApis.has(pi)) return;
	registeredApis.add(pi);

	const config = deps.loadConfiguration();
	const state = createChildSafeState();
	const executor = deps.createExecutor({ config, pi, state });
	const executionGovernor = deps.createGovernorCoordinator(config);
	let active = true;

	const bindExecutionGovernor = (): string | undefined => {
		const parentSessionId = process.env[SUBAGENT_PARENT_SESSION_ENV]?.trim();
		if (!parentSessionId) return "Cannot start an Agent because the child has no parent session identity.";
		const rawOwnerPath = process.env[PI_STUFF_AGENT_PATH_ENV];
		const rawComponents = rawOwnerPath?.split("›") ?? [];
		const ownerAgentPath = parseAgentOwnerPath(rawOwnerPath);
		const validOwnerPath =
			rawComponents.length > 0 &&
			rawComponents.length <= config.maxSubagentDepth &&
			rawComponents.every((component) => component.trim().length > 0) &&
			ownerAgentPath.length === rawComponents.length &&
			ownerAgentPath.every((component) => {
				const separator = component.lastIndexOf(":");
				if (separator <= 0) return false;
				const index = component.slice(separator + 1);
				return /^\d+$/.test(index) && Number.isSafeInteger(Number(index)) && Number(index) <= 1_000_000;
			});
		if (!validOwnerPath) {
			return "Cannot start an Agent because PI_STUFF_AGENT_PATH is missing or invalid for this child.";
		}
		executionGovernor.bindSession({
			sessionId: parentSessionId,
			ownerAgentPath,
		});
		return undefined;
	};

	const governorFailureResult = (params: PublicAgentParams, message: string): AgentToolResult<Details> =>
		({
			content: [{ type: "text", text: message }],
			isError: true,
			details: {
				mode: params.action ? "management" : params.tasks?.length ? "parallel" : "single",
				results: [],
			},
		}) as AgentToolResult<Details>;

	const tool: ToolDefinition<typeof SubagentParams, Details> = {
		name: "subagent",
		label: "Agent",
		description: buildSubagentToolDescription(),
		parameters: SubagentParams,
		async execute(id, rawParams, signal, onUpdate, ctx) {
			const params = rawParams as PublicAgentParams;
			const bindingError = bindExecutionGovernor();
			if (bindingError) return projectEngineResult(params, governorFailureResult(params, bindingError));
			const prepared = await executionGovernor.prepare({
				launchRunId: deriveLaunchRunId(id),
				params,
			});
			if (!prepared.ok) return projectEngineResult(params, governorFailureResult(params, prepared.message));
			try {
				const result = await executor.execute(
					id,
					toEngineParams(params),
					signal ?? new AbortController().signal,
					onUpdate ? (update) => onUpdate(projectEngineResult(params, update)) : undefined,
					ctx,
				);
				if (prepared.invocation) await executionGovernor.settle(prepared.invocation, result);
				return projectEngineResult(params, result);
			} catch (error) {
				if (prepared.invocation) await executionGovernor.fail(prepared.invocation);
				throw error;
			}
		},
	};

	pi.registerTool(tool);
	const nestedControlTimer = startNestedControlInboxListener(pi, state);
	const eventUnsubscribes: Array<() => void> = [];
	const onBus = (event: string, handler: (data: unknown) => void): void => {
		const unsubscribe = pi.events.on(event, handler);
		if (typeof unsubscribe === "function") eventUnsubscribes.push(unsubscribe);
	};
	onBus(SUBAGENT_ASYNC_STARTED_EVENT, (data) => {
		if (!active) return;
		void executionGovernor.observeAsyncStarted(data).catch((error) => {
			console.error("Failed to bind nested Agent governor runtime identity:", error);
		});
	});
	const complete = (data: unknown): void => {
		if (!active) return;
		void executionGovernor.complete(data).catch((error) => {
			console.error("Failed to release completed nested Agent lease:", error);
		});
	};
	onBus(SUBAGENT_ASYNC_COMPLETE_EVENT, complete);
	onBus(SUBAGENT_FOREGROUND_COMPLETE_EVENT, complete);

	pi.on("session_start", async () => {
		if (!active) return;
		const bindingError = bindExecutionGovernor();
		if (bindingError) {
			console.error(bindingError);
			return;
		}
		try {
			await executionGovernor.reconcileExisting();
		} catch (error) {
			console.error("Failed to reconcile existing nested Agent leases:", error);
		}
	});
	pi.on("session_shutdown", () => {
		if (!active) return;
		active = false;
		if (nestedControlTimer) clearInterval(nestedControlTimer);
		for (const unsubscribe of eventUnsubscribes.splice(0)) unsubscribe();
		executionGovernor.dispose();
	});
}
