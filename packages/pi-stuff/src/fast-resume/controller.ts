import * as Effect from "effect/Effect";
import type { FastResumeOperationOwner } from "./effect-owner.js";
import {
	canonicalSessionPath,
	loadCompleteSessions,
	loadSessionBatch,
	resolveDeferredSessionNames,
	scanAllSessionMetas,
	scanCurrentSessions,
} from "./scanner.js";
import { invalidateSessionSearchText, type PickerScope } from "./search.js";
import {
	type CurrentSessionScan,
	SESSION_BATCH_SIZE,
	type SessionFileMeta,
	type SessionHeader,
	sortSessionsByModified,
} from "./session.js";
import { type DeleteSessionResult, deleteSessionFile, renameSessionFile } from "./session-operations.js";

export interface FastResumeSnapshot {
	allLoading: boolean;
	allProgress?: { readonly loaded: number; readonly total: number };
	allSessions?: readonly SessionHeader[];
	currentLoading: boolean;
	currentSessionPath?: string;
	currentSessions: readonly SessionHeader[];
	error?: string;
}

export interface FastResumeControllerOptions {
	currentSessionPath?: string;
	readonly cwd: string;
	readonly owner: FastResumeOperationOwner;
	readonly sessionDir: string;
	readonly usesDefaultSessionDir: boolean;
}

type Listener = (snapshot: FastResumeSnapshot) => void;

function batches<T>(items: readonly T[]): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += SESSION_BATCH_SIZE) {
		result.push(items.slice(index, index + SESSION_BATCH_SIZE));
	}
	return result;
}

function boundedError(_error: Error): string {
	return "Fast Resume failed to load Sessions.";
}

export class FastResumeController {
	private allLoading = true;
	private allProgress: FastResumeSnapshot["allProgress"];
	private allSessions: SessionHeader[] | undefined;
	private readonly cancelers = new Set<() => void>();
	private currentLoading: boolean;
	private currentSessions: SessionHeader[];
	private disposed = false;
	private error: string | undefined;
	private generation = 0;
	private readonly listeners = new Set<Listener>();
	private readonly currentSessionPath: string | undefined;
	private readonly metasByPath = new Map<string, SessionFileMeta>();
	private readonly options: FastResumeControllerOptions;
	private readonly nameQueue: SessionHeader[] = [];
	private nameRunning = false;
	private readonly resolvedNames = new Set<string>();
	private started = false;

	constructor(
		options: FastResumeControllerOptions,
		initial: CurrentSessionScan,
		currentSessionPath: string | undefined,
	) {
		this.options = options;
		this.currentSessionPath = currentSessionPath;
		this.currentSessions = [...initial.initial];
		this.currentLoading = initial.remaining.length > 0;
		for (const meta of initial.all) this.metasByPath.set(meta.path, meta);
		this.queueNames(initial.initial);
		this.remainingCurrent = [...initial.remaining];
	}

	private remainingCurrent: SessionFileMeta[];

	snapshot(): FastResumeSnapshot {
		const snapshot: FastResumeSnapshot = {
			allLoading: this.allLoading,
			currentLoading: this.currentLoading,
			currentSessions: this.currentSessions,
		};
		if (this.allProgress) snapshot.allProgress = this.allProgress;
		if (this.allSessions) snapshot.allSessions = this.allSessions;
		if (this.currentSessionPath) snapshot.currentSessionPath = this.currentSessionPath;
		if (this.error) snapshot.error = this.error;
		return snapshot;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.snapshot());
		return () => this.listeners.delete(listener);
	}

	start(): void {
		if (this.disposed || this.started) return;
		this.started = true;
		this.startNames();
		const generation = this.generation;
		this.fork(this.loadScopes(generation));
	}

	async delete(path: string, scope: PickerScope): Promise<DeleteSessionResult> {
		const result = await this.options.owner.run(deleteSessionFile(path));
		if (!result.ok) return result;
		this.currentSessions = this.currentSessions.filter((session) => session.path !== path);
		if (this.allSessions) this.allSessions = this.allSessions.filter((session) => session.path !== path);
		this.notify();
		this.refresh(scope);
		return result;
	}

	async rename(path: string, name: string, scope: PickerScope): Promise<void> {
		await this.options.owner.run(renameSessionFile(path, name));
		this.refresh(scope);
	}

	refresh(scope: PickerScope): void {
		if (this.disposed) return;
		this.cancelBackground();
		this.generation += 1;
		this.error = undefined;
		this.currentLoading = true;
		this.allLoading = true;
		this.allProgress = undefined;
		this.nameQueue.length = 0;
		this.resolvedNames.clear();
		this.metasByPath.clear();
		this.notify();
		this.fork(this.refreshScopes(scope, this.generation));
	}

	dispose(): void {
		this.disposed = true;
		this.cancelBackground();
		this.listeners.clear();
		this.nameQueue.length = 0;
	}

	private cancelBackground(): void {
		for (const cancel of this.cancelers) cancel();
		this.cancelers.clear();
		this.nameRunning = false;
	}

	private fork(program: Effect.Effect<void, Error>): void {
		let cancel: () => void = () => undefined;
		cancel = this.options.owner.fork(program, (error) => {
			this.cancelers.delete(cancel);
			if (!error || this.disposed) return;
			this.currentLoading = false;
			this.allLoading = false;
			this.error = boundedError(error);
			this.notify();
		});
		this.cancelers.add(cancel);
	}

	private loadScopes(generation: number): Effect.Effect<void, Error> {
		return Effect.gen({ self: this }, function* () {
			for (const batch of batches(this.remainingCurrent)) {
				if (!this.active(generation)) return;
				const loaded = yield* loadSessionBatch(batch, this.options.cwd);
				this.currentSessions = sortSessionsByModified([...this.currentSessions, ...loaded]);
				this.queueNames(loaded);
				this.notify();
				yield* Effect.sleep(0);
			}
			this.currentLoading = false;
			this.remainingCurrent = [];
			this.notify();
			if (!this.active(generation)) return;
			const metas = yield* scanAllSessionMetas(this.options.sessionDir, this.options.usesDefaultSessionDir);
			for (const meta of metas) this.metasByPath.set(meta.path, meta);
			this.allSessions = [];
			this.allProgress = { loaded: 0, total: metas.length };
			let processed = 0;
			this.notify();
			for (const batch of batches(metas)) {
				if (!this.active(generation)) return;
				const loaded = yield* loadSessionBatch(batch);
				this.allSessions.push(...loaded);
				processed += batch.length;
				this.allProgress = { loaded: processed, total: metas.length };
				this.queueNames(loaded);
				this.notify();
				yield* Effect.sleep(0);
			}
			this.allSessions = sortSessionsByModified(this.allSessions);
			this.allLoading = false;
			this.notify();
		});
	}

	private refreshScopes(scope: PickerScope, generation: number): Effect.Effect<void, Error> {
		const other: PickerScope = scope === "current" ? "all" : "current";
		return Effect.gen({ self: this }, function* () {
			yield* this.refreshScope(scope, generation);
			if (this.active(generation)) yield* this.refreshScope(other, generation);
		});
	}

	private refreshScope(scope: PickerScope, generation: number): Effect.Effect<void, Error> {
		return Effect.gen({ self: this }, function* () {
			if (scope === "current") {
				const scan = yield* scanCurrentSessions(
					this.options.sessionDir,
					this.options.cwd,
					this.options.usesDefaultSessionDir,
				);
				const sessions = yield* loadCompleteSessions(scan.all, this.options.cwd);
				if (!this.active(generation)) return;
				for (const meta of scan.all) this.metasByPath.set(meta.path, meta);
				this.currentSessions = sessions;
				this.remainingCurrent = [];
				this.currentLoading = false;
			} else {
				const metas = yield* scanAllSessionMetas(this.options.sessionDir, this.options.usesDefaultSessionDir);
				const sessions = yield* loadCompleteSessions(metas);
				if (!this.active(generation)) return;
				for (const meta of metas) this.metasByPath.set(meta.path, meta);
				this.allSessions = sessions;
				this.allLoading = false;
				this.allProgress = { loaded: metas.length, total: metas.length };
				this.queueNames(sessions);
			}
			this.notify();
		});
	}

	private queueNames(headers: readonly SessionHeader[]): void {
		for (const header of headers) {
			if (this.resolvedNames.has(header.path)) continue;
			this.resolvedNames.add(header.path);
			if (!header._fwdReachedEof) this.nameQueue.push(header);
		}
		if (this.started) this.startNames();
	}

	private startNames(): void {
		if (!this.started || this.disposed || this.nameRunning || this.nameQueue.length === 0) return;
		this.nameRunning = true;
		this.fork(
			Effect.gen({ self: this }, function* () {
				while (this.nameQueue.length > 0 && !this.disposed) {
					const batch = this.nameQueue.splice(0, SESSION_BATCH_SIZE);
					const names = yield* resolveDeferredSessionNames(batch, this.metasByPath);
					for (const header of batch) {
						if (!names.has(header.path)) continue;
						const name = names.get(header.path);
						if (name === undefined) delete header.name;
						else header.name = name;
						invalidateSessionSearchText(header);
					}
					this.notify();
					yield* Effect.sleep(0);
				}
				this.nameRunning = false;
			}),
		);
	}

	private active(generation: number): boolean {
		return !this.disposed && generation === this.generation;
	}

	private notify(): void {
		const snapshot = this.snapshot();
		for (const listener of this.listeners) listener(snapshot);
	}
}

export function prepareFastResumeController(
	options: FastResumeControllerOptions,
): Effect.Effect<FastResumeController, Error> {
	return Effect.gen(function* () {
		const initial = yield* scanCurrentSessions(options.sessionDir, options.cwd, options.usesDefaultSessionDir);
		const currentSessionPath = options.currentSessionPath
			? yield* canonicalSessionPath(options.currentSessionPath)
			: undefined;
		return new FastResumeController(options, initial, currentSessionPath);
	});
}
