import * as fs from "node:fs";
import * as path from "node:path";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { tryAcquireKernelClaim } from "../../shared/durable-claim.ts";
import { createFileCoalescer } from "../../shared/file-coalescer.ts";
import {
	errnoCode,
	type OwnedFileSnapshot,
	readBoundedOwnedFileSnapshotAsync,
} from "../../shared/private-directory.ts";
import { ASYNC_DIR, type IntercomEventBus, RESULTS_DIR, type SubagentState } from "../../shared/types.ts";
import { isNotFoundError as isNotFound, resolveWatchPath } from "../../shared/utils.ts";
import { projectNestedEventsAuthoritatively } from "../shared/nested-events.ts";
import type { CompletionNotification } from "./notify.ts";
import { ResultProcessor } from "./result-processing.ts";

const WATCHER_RESTART_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 3000;
const RETRY_DELAY_MS = 100;

export type ResultWatcherState = Pick<
	SubagentState,
	| "completionSeen"
	| "currentSessionId"
	| "currentSessionScope"
	| "resultFileCoalescer"
	| "watcher"
	| "watcherRestartTimer"
>;

type ResultWatcherFs = Pick<typeof fs, "existsSync" | "realpathSync" | "watch">;

type ResultWatcherDeps = {
	acquireClaim?: typeof tryAcquireKernelClaim;
	fs?: ResultWatcherFs;
	notifier?: { deliver(notification: CompletionNotification, signal?: AbortSignal): Promise<boolean> };
	asyncDirRoot?: string;
	readResultSnapshot?: (resultPath: string, maxBytes: number) => Promise<OwnedFileSnapshot> | OwnedFileSnapshot;
	projectNestedEvents?: typeof projectNestedEventsAuthoritatively;
};

function resultFileFromWatchEntry(fileName: string): string | undefined {
	if (fileName.endsWith(".json")) return fileName;
	return /^\.([^/\\]+\.json)\.\d+\.\d+\.[a-z0-9]+\.tmp$/i.exec(fileName)?.[1];
}

function shouldPoll(cause: unknown): boolean {
	const code = errnoCode(cause);
	return code === "EMFILE" || code === "ENOSPC";
}

class ResultWatcher {
	private readonly state: ResultWatcherState;
	private readonly resultsDir: string;
	private readonly fsApi: ResultWatcherFs;
	private readonly pendingTriggerTurn = new Map<string, boolean>();
	private readonly processor: ResultProcessor;
	private safetyScanTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		pi: { events: IntercomEventBus },
		state: ResultWatcherState,
		resultsDir: string,
		completionTtlMs: number,
		deps: ResultWatcherDeps,
	) {
		this.state = state;
		this.resultsDir = resultsDir;
		this.fsApi = deps.fs ?? fs;
		const asyncDirRoot =
			deps.asyncDirRoot ??
			(path.resolve(resultsDir) === path.resolve(RESULTS_DIR) ? ASYNC_DIR : path.dirname(path.resolve(resultsDir)));
		this.processor = new ResultProcessor({
			pi,
			state,
			resultsDir,
			asyncDirRoot,
			completionTtlMs,
			notifier: deps.notifier ?? { deliver: async () => true },
			readResultSnapshot: deps.readResultSnapshot ?? readBoundedOwnedFileSnapshotAsync,
			acquireClaim: deps.acquireClaim ?? tryAcquireKernelClaim,
			projectNestedEvents: deps.projectNestedEvents ?? projectNestedEventsAuthoritatively,
			scheduleResult: (file, triggerTurn, delayMs) => this.scheduleResult(file, triggerTurn, delayMs),
		});
		state.resultFileCoalescer = createFileCoalescer((file) => {
			const triggerTurn = this.pendingTriggerTurn.get(file) !== false;
			this.pendingTriggerTurn.delete(file);
			void this.processor.handleResult(file, triggerTurn);
		}, 50);
	}

	private scheduleResult(file: string, triggerTurn: boolean, delayMs = 0): void {
		this.pendingTriggerTurn.set(file, (this.pendingTriggerTurn.get(file) ?? true) && triggerTurn);
		this.state.resultFileCoalescer.schedule(file, delayMs);
	}

	readonly primeExistingResults = (options: { triggerTurn?: boolean } = {}): void => {
		const triggerTurn = options.triggerTurn !== false;
		void fs.promises
			.readdir(this.resultsDir)
			.then((files) => {
				for (const file of files) if (file.endsWith(".json")) this.scheduleResult(file, triggerTurn);
			})
			.catch((error) => {
				if (!isNotFound(error))
					reportAgentDiagnostic(`Failed to scan subagent result directory '${this.resultsDir}':`, error);
			});
	};

	private startPolling(cause: unknown): boolean {
		this.state.watcher?.close();
		this.state.watcher = null;
		if (this.safetyScanTimer) clearInterval(this.safetyScanTimer);
		this.safetyScanTimer = undefined;
		if (this.state.watcherRestartTimer) return true;
		reportAgentDiagnostic(
			`Subagent result watcher for '${this.resultsDir}' fell back to polling because native fs.watch is unavailable (${errnoCode(cause) ?? "unknown error"}).`,
		);
		this.primeExistingResults();
		this.state.watcherRestartTimer = setInterval(this.primeExistingResults, POLL_INTERVAL_MS);
		this.state.watcherRestartTimer.unref?.();
		return true;
	}

	private scheduleRestart(): void {
		if (this.state.watcherRestartTimer) return;
		this.state.watcherRestartTimer = setTimeout(() => {
			this.state.watcherRestartTimer = null;
			if (this.processor.activeSessionId === undefined) return;
			try {
				if (this.startResultWatcher()) this.primeExistingResults();
				else this.scheduleRestart();
			} catch (error) {
				if (shouldPoll(error)) {
					this.startPolling(error);
					return;
				}
				reportAgentDiagnostic(`Failed to restart subagent result watcher for '${this.resultsDir}':`, error);
				this.scheduleRestart();
			}
		}, WATCHER_RESTART_DELAY_MS);
		this.state.watcherRestartTimer.unref?.();
	}

	readonly startResultWatcher = (): boolean => {
		if (this.state.watcher) return true;
		this.processor.activate();
		if (this.state.watcherRestartTimer) {
			clearTimeout(this.state.watcherRestartTimer);
			clearInterval(this.state.watcherRestartTimer);
			this.state.watcherRestartTimer = null;
		}
		if (!this.fsApi.existsSync(this.resultsDir)) {
			this.scheduleRestart();
			return false;
		}
		try {
			const watchDir = resolveWatchPath(this.resultsDir, this.fsApi.realpathSync.native);
			this.state.watcher = this.fsApi.watch(watchDir, (event, file) => {
				if (event !== "rename") return;
				if (!file) {
					this.state.watcher?.close();
					this.state.watcher = null;
					this.scheduleRestart();
					return;
				}
				const fileName = file.toString();
				const resultFile = resultFileFromWatchEntry(fileName);
				if (!resultFile) return;
				this.processor.forgetIgnoredResult(resultFile);
				this.scheduleResult(resultFile, true, resultFile === fileName ? undefined : RETRY_DELAY_MS);
			});
			if (!this.safetyScanTimer) {
				this.safetyScanTimer = setInterval(this.primeExistingResults, POLL_INTERVAL_MS);
				this.safetyScanTimer.unref?.();
			}
			this.state.watcher.on("error", (error) => {
				if (shouldPoll(error)) return this.startPolling(error);
				reportAgentDiagnostic(`Subagent result watcher failed for '${this.resultsDir}':`, error);
				this.state.watcher?.close();
				this.state.watcher = null;
				this.scheduleRestart();
			});
			this.state.watcher.unref?.();
			return true;
		} catch (error) {
			if (shouldPoll(error)) return this.startPolling(error);
			reportAgentDiagnostic(`Failed to start subagent result watcher for '${this.resultsDir}':`, error);
			this.state.watcher = null;
			this.scheduleRestart();
			return false;
		}
	};

	readonly stopResultWatcher = (): void => {
		this.processor.stop();
		this.state.watcher?.close();
		this.state.watcher = null;
		if (this.state.watcherRestartTimer) {
			clearTimeout(this.state.watcherRestartTimer);
			clearInterval(this.state.watcherRestartTimer);
		}
		this.state.watcherRestartTimer = null;
		if (this.safetyScanTimer) clearInterval(this.safetyScanTimer);
		this.safetyScanTimer = undefined;
		this.state.resultFileCoalescer.clear();
		this.pendingTriggerTurn.clear();
	};
}

/**
 * Watches persisted async results for the session currently owned by this
 * runtime. `stopResultWatcher()` revokes ownership before closing resources,
 * so old callbacks can never emit or delete after reload/session replacement.
 */
export function createResultWatcher(
	pi: { events: IntercomEventBus },
	state: ResultWatcherState,
	resultsDir: string,
	completionTtlMs: number,
	deps: ResultWatcherDeps = {},
) {
	return new ResultWatcher(pi, state, resultsDir, completionTtlMs, deps);
}
