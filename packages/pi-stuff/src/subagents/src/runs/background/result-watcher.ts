import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import { tryAcquireKernelClaim } from "../../shared/durable-claim.ts";
import {
	errnoCode,
	type OwnedFileSnapshot,
	readBoundedOwnedFileSnapshotAsync,
} from "../../shared/private-directory.ts";
import { ASYNC_DIR, type IntercomEventBus, RESULTS_DIR, type SubagentState } from "../../shared/types.ts";
import { isNotFoundError as isNotFound, resolveWatchPath } from "../../shared/utils.ts";
import { projectNestedEventsAuthoritatively } from "../shared/nested-events.ts";
import type { BackgroundEffectOwner, BackgroundEffectTask } from "./background-effect-owner.ts";
import type { CompletionNotification } from "./notify.ts";
import { ResultProcessor } from "./result-processing.ts";

const WATCHER_RESTART_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 3000;
const RETRY_DELAY_MS = 100;

export type ResultWatcherState = Pick<SubagentState, "completionSeen" | "currentSessionId" | "currentSessionScope">;

type ResultWatcherFs = Pick<typeof fs, "existsSync" | "realpathSync" | "watch">;

type ResultWatcherDeps = {
	acquireClaim?: typeof tryAcquireKernelClaim;
	effects: BackgroundEffectOwner;
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
	private readonly resultsDir: string;
	private readonly fsApi: ResultWatcherFs;
	private readonly effects: BackgroundEffectOwner;
	private readonly pendingTriggerTurn = new Map<string, boolean>();
	private readonly processor: ResultProcessor;
	private readonly delayedResults = new Map<string, BackgroundEffectTask<void, never>>();
	private readonly processingResults = new Map<
		string,
		{ readonly token: symbol; readonly task: BackgroundEffectTask<void, unknown> }
	>();
	private pollTask: BackgroundEffectTask<void, never> | undefined;
	private primeTriggerTurn = true;
	private primeTask: BackgroundEffectTask<void, unknown> | undefined;
	private restartTask: BackgroundEffectTask<void, never> | undefined;
	private safetyScanTask: BackgroundEffectTask<void, never> | undefined;
	private watcher: fs.FSWatcher | undefined;

	constructor(
		pi: { events: IntercomEventBus },
		state: ResultWatcherState,
		resultsDir: string,
		completionTtlMs: number,
		deps: ResultWatcherDeps,
	) {
		this.resultsDir = resultsDir;
		this.fsApi = deps.fs ?? fs;
		this.effects = deps.effects;
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
	}

	private scheduleResult(file: string, triggerTurn: boolean, delayMs = 0): void {
		this.pendingTriggerTurn.set(file, (this.pendingTriggerTurn.get(file) ?? true) && triggerTurn);
		if (this.delayedResults.has(file)) return;
		let delayed!: BackgroundEffectTask<void, never>;
		delayed = this.effects.start(
			Effect.sleep(delayMs).pipe(
				Effect.andThen(
					Effect.sync(() => {
						if (this.delayedResults.get(file) !== delayed) return;
						this.delayedResults.delete(file);
						const shouldTriggerTurn = this.pendingTriggerTurn.get(file) !== false;
						this.pendingTriggerTurn.delete(file);
						this.startProcessing(file, shouldTriggerTurn);
					}),
				),
			),
		);
		this.delayedResults.set(file, delayed);
	}

	private startProcessing(file: string, triggerTurn: boolean): void {
		const token = Symbol(file);
		const task = this.effects.start(
			Effect.tryPromise({
				try: (signal) => this.processor.handleResult(file, triggerTurn, signal),
				catch: (error) => error,
			}),
		);
		this.processingResults.set(file, { token, task });
		void task.result.then(() => {
			if (this.processingResults.get(file)?.token === token) this.processingResults.delete(file);
		});
	}

	readonly primeExistingResults = (options: { triggerTurn?: boolean } = {}): void => {
		const triggerTurn = options.triggerTurn !== false;
		this.primeTriggerTurn &&= triggerTurn;
		if (this.primeTask) return;
		const task = this.effects.start(
			Effect.tryPromise({ try: () => fs.promises.readdir(this.resultsDir), catch: (error) => error }).pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						if (!isNotFound(error))
							reportAgentDiagnostic(`Failed to scan subagent result directory '${this.resultsDir}':`, error);
						// SAFETY: this failure branch deliberately projects the same mutable string-list type as readdir.
						return [] as string[];
					}),
				),
				Effect.flatMap((files) =>
					Effect.sync(() => {
						const shouldTriggerTurn = this.primeTriggerTurn;
						this.primeTriggerTurn = true;
						for (const file of files) if (file.endsWith(".json")) this.scheduleResult(file, shouldTriggerTurn);
					}),
				),
			),
		);
		this.primeTask = task;
		void task.result.then(() => {
			if (this.primeTask === task) this.primeTask = undefined;
		});
	};

	private startPolling(cause: unknown): boolean {
		this.watcher?.close();
		this.watcher = undefined;
		if (this.safetyScanTask) void this.safetyScanTask.interrupt();
		this.safetyScanTask = undefined;
		if (this.pollTask) return true;
		reportAgentDiagnostic(
			`Subagent result watcher for '${this.resultsDir}' fell back to polling because native fs.watch is unavailable (${errnoCode(cause) ?? "unknown error"}).`,
		);
		this.primeExistingResults();
		this.pollTask = this.effects.start(this.scanLoop());
		return true;
	}

	private scheduleRestart(): void {
		if (this.restartTask || this.pollTask) return;
		this.restartTask = this.effects.start(
			Effect.sleep(WATCHER_RESTART_DELAY_MS).pipe(
				Effect.andThen(
					Effect.sync(() => {
						this.restartTask = undefined;
						if (this.processor.activeSessionId === undefined) return;
						try {
							if (this.startResultWatcher()) this.primeExistingResults();
							else this.scheduleRestart();
						} catch (error) {
							if (shouldPoll(error)) {
								this.startPolling(error);
								return;
							}
							reportAgentDiagnostic(
								`Failed to restart subagent result watcher for '${this.resultsDir}':`,
								error,
							);
							this.scheduleRestart();
						}
					}),
				),
			),
		);
	}

	readonly startResultWatcher = (): boolean => {
		if (this.watcher) return true;
		this.processor.activate();
		if (this.restartTask) void this.restartTask.interrupt();
		this.restartTask = undefined;
		if (this.pollTask) void this.pollTask.interrupt();
		this.pollTask = undefined;
		if (!this.fsApi.existsSync(this.resultsDir)) {
			this.scheduleRestart();
			return false;
		}
		try {
			const watchDir = resolveWatchPath(this.resultsDir, this.fsApi.realpathSync.native);
			this.watcher = this.fsApi.watch(watchDir, (event, file) => {
				if (event !== "rename") return;
				if (!file) {
					this.watcher?.close();
					this.watcher = undefined;
					this.scheduleRestart();
					return;
				}
				const fileName = file.toString();
				const resultFile = resultFileFromWatchEntry(fileName);
				if (!resultFile) return;
				this.processor.forgetIgnoredResult(resultFile);
				this.scheduleResult(resultFile, true, resultFile === fileName ? undefined : RETRY_DELAY_MS);
			});
			this.safetyScanTask ??= this.effects.start(this.scanLoop());
			this.watcher.on("error", (error) => {
				if (shouldPoll(error)) return this.startPolling(error);
				reportAgentDiagnostic(`Subagent result watcher failed for '${this.resultsDir}':`, error);
				this.watcher?.close();
				this.watcher = undefined;
				this.scheduleRestart();
			});
			this.watcher.unref?.();
			return true;
		} catch (error) {
			if (shouldPoll(error)) return this.startPolling(error);
			reportAgentDiagnostic(`Failed to start subagent result watcher for '${this.resultsDir}':`, error);
			this.watcher = undefined;
			this.scheduleRestart();
			return false;
		}
	};

	readonly stopResultWatcher = (): void => {
		this.processor.stop();
		this.watcher?.close();
		this.watcher = undefined;
		for (const task of [this.restartTask, this.pollTask, this.primeTask, this.safetyScanTask]) {
			if (task) void task.interrupt();
		}
		this.restartTask = undefined;
		this.pollTask = undefined;
		this.primeTask = undefined;
		this.primeTriggerTurn = true;
		this.safetyScanTask = undefined;
		for (const task of this.delayedResults.values()) void task.interrupt();
		for (const { task } of this.processingResults.values()) void task.interrupt();
		this.delayedResults.clear();
		this.processingResults.clear();
		this.pendingTriggerTurn.clear();
	};

	private scanLoop(): Effect.Effect<void, never> {
		return Effect.gen({ self: this }, function* () {
			while (true) {
				yield* Effect.sleep(POLL_INTERVAL_MS);
				yield* Effect.sync(() => this.primeExistingResults());
			}
		});
	}
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
	deps: ResultWatcherDeps,
) {
	return new ResultWatcher(pi, state, resultsDir, completionTtlMs, deps);
}
