import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { projectCurrentContext } from "../../../context-management/index.js";
import { isRuntimeFunction } from "../../../shared/runtime-type.js";
import { registerSuiteOwnedTool } from "../../../tool-display/index.js";
import { discoverAgents } from "../agents/agents.ts";
import {
	createSubagentExecutor,
	deriveLaunchRunId,
	resolveResumeTargetRunId,
	type SubagentExecutionHooks,
	type SubagentParamsLike,
} from "../runs/foreground/subagent-executor.ts";
import {
	PI_STUFF_AGENT_PATH_ENV,
	SUBAGENT_CHILD_ENV,
	SUBAGENT_FANOUT_CHILD_ENV,
	SUBAGENT_PARENT_PHYSICAL_SESSION_ENV,
	SUBAGENT_PARENT_SESSION_ENV,
} from "../runs/shared/pi-args.ts";
import {
	type AgentExecutionCoordinatorPort,
	AgentRuntimeBindingRejectedError,
	createDurableAgentExecutionCoordinator,
	parseAgentOwnerPath,
} from "../runtime/agent-execution-coordinator.ts";
import { reportAgentDiagnostic } from "../shared/diagnostics.ts";
import {
	type Details,
	SESSION_GOVERNOR_ROOT,
	SUBAGENT_ASYNC_COMPLETE_EVENT,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	SUBAGENT_PROCESS_TERMINAL_EVENT,
	type SubagentState,
} from "../shared/types.ts";
import { createAgentToolPresentation } from "./agent-tool-presentation.ts";
import { loadConfig, type PiStuffAgentsConfig } from "./config.ts";
import {
	normalizePublicAgentParams,
	type PublicAgentParams,
	projectEngineResult,
	toEngineParams,
} from "./product-executor.ts";
import { FanoutChildSubagentParams } from "./schemas.ts";
import { buildFanoutChildSubagentToolDescription } from "./tool-description.ts";

interface FanoutChildGlobalStore {
	__piSubagentFanoutChildRegisteredApis?: WeakSet<ExtensionAPI>;
}

type AgentPrepareInput = Parameters<AgentExecutionCoordinatorPort["prepare"]>[0];
type AgentToolFailureResult = AgentToolResult<Details> & { readonly isError: true };
type ExtensionEventPayload = Parameters<Parameters<ExtensionAPI["events"]["on"]>[1]>[0];

interface FanoutExecutor {
	execute(
		id: string,
		params: SubagentParamsLike,
		signal: AbortSignal,
		onUpdate: ((result: AgentToolResult<Details>) => void) | undefined,
		ctx: ExtensionContext,
		hooks?: SubagentExecutionHooks,
	): Promise<AgentToolResult<Details>>;
}

interface FanoutExecutorInput {
	readonly config: PiStuffAgentsConfig;
	readonly pi: ExtensionAPI;
	readonly projectContext: typeof projectCurrentContext;
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
	createExecutor: ({ config, pi, projectContext, state }) =>
		createSubagentExecutor({
			pi,
			state,
			config,
			asyncByDefault: false,
			getSubagentSessionRoot,
			expandTilde,
			discoverAgents,
			projectContext,
			allowMutatingManagementActions: false,
		}),
	createGovernorCoordinator: (config) =>
		createDurableAgentExecutionCoordinator({
			rootDir: SESSION_GOVERNOR_ROOT,
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
		subagentSpawns: { sessionId: null, count: 0 },
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		pendingForegroundControlNotices: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: {
			schedule: () => false,
			clear: () => {},
		},
	};
}

export default function registerFanoutChildSubagentExtension(
	pi: ExtensionAPI,
	overrides: Partial<FanoutChildDependencies> = {},
): void {
	if (process.env[SUBAGENT_CHILD_ENV] !== "1" || process.env[SUBAGENT_FANOUT_CHILD_ENV] !== "1") return;
	const deps: FanoutChildDependencies = { ...PRODUCTION_DEPENDENCIES, ...overrides };

	// SAFETY: this module owns the single optional global WeakSet slot and validates it before reuse.
	const globalStore = globalThis as typeof globalThis & FanoutChildGlobalStore;
	const registeredApis =
		globalStore.__piSubagentFanoutChildRegisteredApis instanceof WeakSet
			? globalStore.__piSubagentFanoutChildRegisteredApis
			: new WeakSet<ExtensionAPI>();
	globalStore.__piSubagentFanoutChildRegisteredApis = registeredApis;
	if (registeredApis.has(pi)) return;

	const config = deps.loadConfiguration();
	const state = createChildSafeState();
	const executor = deps.createExecutor({ config, pi, projectContext: projectCurrentContext, state });
	const executionGovernor = deps.createGovernorCoordinator(config);
	let active = true;
	let boundLaunchIdentity: { sessionId: string; ownerAgentPath: readonly string[] } | undefined;

	const bindExecutionGovernor = (): string | undefined => {
		const parentSessionId = process.env[SUBAGENT_PARENT_SESSION_ENV]?.trim();
		if (!parentSessionId) return "Cannot start an Agent because the child has no parent session identity.";
		const physicalSessionId = process.env[SUBAGENT_PARENT_PHYSICAL_SESSION_ENV]?.trim();
		if (!physicalSessionId) return "Cannot start an Agent because the child has no physical parent session identity.";
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
		boundLaunchIdentity = { sessionId: physicalSessionId, ownerAgentPath };
		return undefined;
	};

	const governorFailureResult = (params: PublicAgentParams, message: string): AgentToolResult<Details> => {
		const result: AgentToolFailureResult = {
			content: [{ type: "text", text: message }],
			isError: true,
			details: {
				mode: params.action ? "management" : params.tasks?.length ? "parallel" : "single",
				results: [],
			},
		};
		return result;
	};

	const tool: ToolDefinition<typeof FanoutChildSubagentParams, Details> = {
		name: "subagent",
		label: "Agent",
		description: buildFanoutChildSubagentToolDescription(),
		parameters: FanoutChildSubagentParams,
		async execute(id, rawParams, signal, onUpdate, ctx) {
			// SAFETY: FanoutChildSubagentParams is an explicit launch-only subset of PublicAgentParams.
			const publicParams = rawParams as PublicAgentParams;
			const forbiddenField = ["action", "id", "index", "message", "foreground"].find((field) =>
				Object.hasOwn(rawParams, field),
			);
			if (forbiddenField) {
				const params = { ...publicParams, foreground: true };
				return projectEngineResult(
					params,
					governorFailureResult(
						params,
						`Nested Agent calls are launch-only; field '${forbiddenField}' is unavailable.`,
					),
				);
			}
			// A fanout owner must not finish while work it owns is still detached.
			// Nested Agent calls therefore execute in the owner foreground and are
			// collected before the parent writer can report terminal success.
			let params: PublicAgentParams;
			try {
				params = normalizePublicAgentParams({ ...publicParams, foreground: true });
			} catch (error) {
				const supplied = { ...publicParams, foreground: true };
				return projectEngineResult(
					supplied,
					governorFailureResult(supplied, error instanceof Error ? error.message : String(error)),
				);
			}
			const bindingError = bindExecutionGovernor();
			if (bindingError) return projectEngineResult(params, governorFailureResult(params, bindingError));
			if (!boundLaunchIdentity) {
				return projectEngineResult(params, governorFailureResult(params, "Nested Agent governor is not bound."));
			}
			const launchRunId = deriveLaunchRunId(id, boundLaunchIdentity);
			let resumeTargetRunId: string | undefined;
			let foregroundStarted = false;
			try {
				resumeTargetRunId = resolveResumeTargetRunId(params, state);
			} catch (error) {
				return projectEngineResult(
					params,
					governorFailureResult(params, error instanceof Error ? error.message : String(error)),
				);
			}
			const prepareInput = {
				launchRunId,
				params,
			} satisfies AgentPrepareInput;
			if (resumeTargetRunId) Object.assign(prepareInput, { resumeTargetRunId });
			const prepared = await executionGovernor.prepare(prepareInput);
			if (!prepared.ok) return projectEngineResult(params, governorFailureResult(params, prepared.message));
			if (!active) {
				if (prepared.invocation) {
					try {
						await executionGovernor.fail(prepared.invocation);
					} catch (error) {
						reportAgentDiagnostic("Failed to release a cancelled nested Agent launch reservation:", error);
					}
				}
				return projectEngineResult(
					params,
					governorFailureResult(params, "Nested Agent launch cancelled because the parent session ended."),
				);
			}
			try {
				const result = await executor.execute(
					id,
					{ ...toEngineParams(params), launchRunId },
					signal ?? new AbortController().signal,
					onUpdate ? (update) => onUpdate(projectEngineResult(params, update)) : undefined,
					ctx,
					prepared.invocation
						? {
								beforeForegroundStart: async ({ runId, asyncDir, abortStart }) => {
									await executionGovernor.observeAsyncStarted({
										id: runId,
										pid: process.pid,
										asyncDir,
										abortStart,
									});
									foregroundStarted = true;
								},
							}
						: undefined,
				);
				if (!active && prepared.invocation) {
					if (foregroundStarted) {
						try {
							await executionGovernor.settle(prepared.invocation, result);
						} catch (error) {
							reportAgentDiagnostic("Failed to settle a session-ended nested foreground Agent result:", error);
						}
					} else {
						const binding = result.details.lifecycleBinding;
						let safeToRelease = !binding && !result.details.asyncId;
						if (binding?.abortStart) {
							try {
								safeToRelease = binding.abortStart();
							} catch (error) {
								// Failed control transport cannot prove the runner stopped.
								// Retain the parent session's governor authority fail-closed.
								reportAgentDiagnostic("Failed to abort a session-ended nested Agent runtime:", error);
								safeToRelease = false;
							}
						}
						if (safeToRelease) {
							try {
								await executionGovernor.fail(prepared.invocation);
							} catch (error) {
								reportAgentDiagnostic("Failed to release a session-ended nested Agent reservation:", error);
							}
						} else {
							try {
								await executionGovernor.settle(prepared.invocation, result);
							} catch (error) {
								reportAgentDiagnostic("Failed to retain a session-ended nested Agent runtime binding:", error);
							}
						}
					}
					return projectEngineResult(
						params,
						governorFailureResult(params, "Nested Agent launch cancelled because the parent session ended."),
					);
				}
				if (prepared.invocation) {
					try {
						await executionGovernor.settle(prepared.invocation, result);
					} catch (error) {
						if (error instanceof AgentRuntimeBindingRejectedError) {
							return projectEngineResult(params, governorFailureResult(params, error.message));
						}
						reportAgentDiagnostic(
							"Failed to persist the launched nested Agent lease binding; retaining it for reconciliation:",
							error,
						);
					}
				}
				return projectEngineResult(params, result);
			} catch (error) {
				if (prepared.invocation) {
					try {
						await executionGovernor.fail(prepared.invocation);
					} catch (releaseError) {
						reportAgentDiagnostic(
							"Failed to release a nested Agent reservation after engine launch failure:",
							releaseError,
						);
					}
				}
				throw error;
			}
		},
	};

	const eventUnsubscribes: Array<() => void> = [];
	const onBus = (event: string, handler: (data: ExtensionEventPayload) => void): void => {
		const unsubscribe = pi.events.on(event, handler);
		if (isRuntimeFunction(unsubscribe)) eventUnsubscribes.push(unsubscribe);
	};
	const disposeComposition = (): void => {
		for (const unsubscribe of eventUnsubscribes.splice(0)) {
			try {
				unsubscribe();
			} catch (error) {
				reportAgentDiagnostic("Failed to unsubscribe a nested Agent event handler:", error);
			}
		}
		try {
			executionGovernor.dispose();
		} catch (error) {
			reportAgentDiagnostic("Failed to dispose the nested Agent execution governor:", error);
		}
	};
	try {
		const complete = (data: ExtensionEventPayload): void => {
			if (!active) return;
			void executionGovernor.complete(data).catch((error) => {
				reportAgentDiagnostic("Failed to release completed nested Agent lease:", error);
			});
		};
		onBus(SUBAGENT_ASYNC_COMPLETE_EVENT, complete);
		onBus(SUBAGENT_FOREGROUND_COMPLETE_EVENT, complete);
		onBus(SUBAGENT_PROCESS_TERMINAL_EVENT, () => {
			if (!active) return;
			void executionGovernor.reconcileDead().catch((error) => {
				reportAgentDiagnostic("Failed to reconcile nested Agent leases after runner exit:", error);
			});
		});

		pi.on("session_shutdown", () => {
			if (!active) return;
			active = false;
			registeredApis.delete(pi);
			disposeComposition();
		});

		// Register the public tool last. If any earlier initialization step fails,
		// the inert handlers are rolled back and the same API can retry cleanly.
		registerSuiteOwnedTool(pi, tool, createAgentToolPresentation());
		registeredApis.add(pi);
	} catch (error) {
		active = false;
		disposeComposition();
		registeredApis.delete(pi);
		throw error;
	}
}
