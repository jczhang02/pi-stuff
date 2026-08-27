import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult as CoreAgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import {
	type AsyncStatus,
	type Details,
	SUBAGENT_FOREGROUND_COMPLETE_EVENT,
	type SubagentState,
} from "../../shared/types.ts";
import { type BackgroundRecoveryDescriptor, persistRecoveries } from "../background/async-execution.ts";
import { createInitialStatus } from "../background/initial-status.ts";
import { initializeWriterProcessRegistry } from "../background/writer-process-registry.ts";
import type { BackgroundRunnerConfig } from "../shared/parallel-utils.ts";
import type { executeForegroundConfig } from "./execution.ts";
import {
	createForegroundControl,
	emitNestedLifecycle,
	type ForegroundProjectionData,
	type ForegroundTask,
	refreshForegroundNestedProjection,
	rememberForegroundResult,
	updateForegroundControl,
} from "./foreground-projection.ts";
import type { ForegroundRunDirectoryClaim } from "./foreground-run-claim.ts";

type AgentToolResult<T> = CoreAgentToolResult<T> & { isError?: boolean };

export interface ForegroundLaunchData extends ForegroundProjectionData {
	readonly sessionRoot: string;
}

interface ForegroundLifecycleRuntime {
	readonly pi: Pick<ExtensionAPI, "events">;
	readonly state: SubagentState;
	readonly onForegroundStatus?: (() => void) | undefined;
}

interface ForegroundLifecycleHooks {
	readonly beforeForegroundStart?:
		| ((binding: {
				readonly runId: string;
				readonly asyncDir: string;
				readonly writerCount: number;
				readonly abortStart: () => boolean;
		  }) => void | Promise<void>)
		| undefined;
}

export interface PreparedForegroundConfig {
	readonly config: BackgroundRunnerConfig;
	readonly directoryClaim: ForegroundRunDirectoryClaim;
	readonly recoveries: BackgroundRecoveryDescriptor[];
}

async function commitForegroundStart(
	data: ForegroundLaunchData,
	tasks: readonly ForegroundTask[],
	prepared: PreparedForegroundConfig,
	hooks?: ForegroundLifecycleHooks,
	onLifecycleCommitted?: (() => void) | undefined,
): Promise<void> {
	const { config, directoryClaim, recoveries } = prepared;
	try {
		persistRecoveries(config.asyncDir, recoveries);
		initializeWriterProcessRegistry(config.asyncDir, config.id, process.pid, tasks.length);
		writePrivateAtomicJson(
			path.join(config.asyncDir, "status.json"),
			createInitialStatus(config, config.startedAt ?? Date.now()),
		);
		await hooks?.beforeForegroundStart?.({
			runId: data.runId,
			asyncDir: config.asyncDir,
			writerCount: tasks.length,
			abortStart: directoryClaim.abortIfUnstarted,
		});
		if (!directoryClaim.commit()) {
			throw new Error(`Foreground Agent runtime ownership changed before '${data.runId}' could start.`);
		}
		onLifecycleCommitted?.();
	} catch (error) {
		// Remove only the exact unstarted inode; collisions remain recovery evidence.
		directoryClaim.cleanup();
		try {
			fs.rmdirSync(data.sessionRoot);
		} catch {
			// A non-empty session root may contain a prepared fork and remains recovery evidence.
		}
		throw error;
	}
}

export async function executeForegroundLifecycle(
	data: ForegroundLaunchData,
	tasks: readonly ForegroundTask[],
	prepared: PreparedForegroundConfig,
	runtime: ForegroundLifecycleRuntime,
	engine: typeof executeForegroundConfig,
	signal: AbortSignal,
	onUpdate?: ((result: AgentToolResult<Details>) => void) | undefined,
	hooks?: ForegroundLifecycleHooks,
	onLifecycleCommitted?: (() => void) | undefined,
): Promise<AgentToolResult<Details>> {
	const { config, directoryClaim } = prepared;
	await commitForegroundStart(data, tasks, prepared, hooks, onLifecycleCommitted);
	const emitUpdate = (update: AgentToolResult<Details>) => {
		try {
			onUpdate?.(update);
		} catch (error) {
			reportAgentDiagnostic(`Foreground Agent progress observer failed for '${data.runId}':`, error);
		}
	};
	const control = createForegroundControl(data, config, tasks);
	runtime.state.foregroundControls.set(data.runId, control);
	runtime.state.lastForegroundControlId = data.runId;
	let liveStatus: AsyncStatus | undefined;
	const nestedProjectionTimer = setInterval(() => {
		refreshForegroundNestedProjection(control);
		if (data.inheritedNestedRoute) {
			emitNestedLifecycle(data, config, control, tasks, control.startedAt, undefined, true, liveStatus);
		}
		runtime.onForegroundStatus?.();
	}, 500);
	nestedProjectionTimer.unref?.();
	emitNestedLifecycle(data, config, control, tasks, control.startedAt);
	emitUpdate({
		content: [{ type: "text", text: `${data.mode === "parallel" ? "Agents" : "Agent"} running in foreground.` }],
		details: { mode: data.mode, runId: data.runId, results: [], context: data.context },
	});
	let result: AgentToolResult<Details>;
	let abortedBeforeStart = false;
	try {
		result = await engine(config, signal, {
			onStatus(status) {
				liveStatus = status;
				updateForegroundControl(control, status);
				runtime.onForegroundStatus?.();
			},
		});
		if (result.details.results.length === 0 && directoryClaim.abortIfUnstarted()) {
			abortedBeforeStart = true;
		}
	} catch (error) {
		if (!directoryClaim.abortIfUnstarted()) throw error;
		abortedBeforeStart = true;
		result = {
			content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
			isError: true,
			details: { mode: data.mode, results: [], runId: data.runId, cwd: data.effectiveCwd },
		};
	} finally {
		clearInterval(nestedProjectionTimer);
		refreshForegroundNestedProjection(control);
		runtime.state.foregroundControls.delete(data.runId);
		if (runtime.state.lastForegroundControlId === data.runId) runtime.state.lastForegroundControlId = null;
	}
	if (abortedBeforeStart) {
		emitNestedLifecycle(data, config, control, tasks, control.startedAt, result);
		emitUpdate(result);
		return result;
	}
	rememberForegroundResult(runtime.state, data, result, tasks, control.startedAt, config.asyncDir);
	emitNestedLifecycle(data, config, control, tasks, control.startedAt, result);
	for (const [index, child] of result.details.results.entries()) {
		if (child.detached) continue;
		try {
			runtime.pi.events.emit(SUBAGENT_FOREGROUND_COMPLETE_EVENT, {
				id: `${data.runId}:${index}`,
				runId: data.runId,
				source: "foreground",
				mode: data.mode,
				agent: child.agent,
				success: child.exitCode === 0,
				summary: child.finalOutput || child.error || "(no report)",
				exitCode: child.exitCode,
				state: child.stopped
					? "stopped"
					: child.interrupted
						? "paused"
						: child.exitCode === 0
							? "complete"
							: "failed",
				timestamp: Date.now(),
				cwd: data.effectiveCwd,
				sessionFile: child.sessionFile,
				sessionId: data.currentSessionId,
				taskIndex: index,
			});
		} catch (error) {
			reportAgentDiagnostic(`Foreground Agent completion observer failed for '${data.runId}:${index}':`, error);
		}
	}
	emitUpdate(result);
	return result;
}
