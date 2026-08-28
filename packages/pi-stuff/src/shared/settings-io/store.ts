/**
 * Per-namespace settings store over the single merged settings file.
 *
 * Each Capability owns one namespace (top-level key) in `<agentDir>/pi-stuff.json`
 * and a `normalize` function that validates an arbitrary record into its
 * strongly-typed shape. The store handles whole-file locking, read/merge/write,
 * subscription, and read-only fallback to a legacy per-Capability file so
 * individual Capability modules stop duplicating this logic.
 */

import { isDeepStrictEqual } from "node:util";
import { mergeNamespaceRecord, readNamespace, type SettingsRecord } from "./file.js";
import { mergedSettingsPath, resolveSettingsLockPath } from "./paths.js";

export type NamespaceRecord = SettingsRecord;
export type NamespaceWriter = (path: string, namespace: string, record: NamespaceRecord) => Promise<void>;
export type NamespaceLockAcquirer = (lockPath: string, owner: string) => Promise<() => Promise<void>>;
export type NamespaceNormalizer<T extends NamespaceRecord> = <Value>(value: Value) => T;

/**
 * Read a legacy per-Capability settings file as a startup-only fallback.
 * Return `undefined` when there is no valid legacy file.
 */
export type NamespaceLegacyReader = (legacyPath: string) => Promise<NamespaceRecord | undefined>;

export interface NamespaceStoreDiagnostic {
	readonly action: "settings-load";
	readonly capability: "pi-stuff";
	readonly details: string;
	readonly error: unknown;
	readonly key: string;
	readonly severity: "warning";
	readonly summary: string;
	readonly visibility: "notice";
}

export type NamespaceDiagnosticReporter = (diagnostic: NamespaceStoreDiagnostic) => void;

export interface NamespaceStoreOptions {
	/** Override the merged file path for tests. */
	readonly path?: string;
	/** Override the writer for tests. */
	readonly writer?: NamespaceWriter;
	/** Legacy per-Capability file to read without mutating it. */
	readonly legacyPath?: string;
	/** Parse a legacy file as an in-memory fallback when the namespace is absent. */
	readonly legacyReader?: NamespaceLegacyReader;
	/**
	 * Acquire the whole-file lock before persisting. Defaults to none, so the
	 * store stays free of `bun:ffi`; Bun-based Capabilities inject the real
	 * flock-based acquirer from `./lock.js`.
	 */
	readonly acquireLock?: NamespaceLockAcquirer;
	/** Capability-owned diagnostic adapter; the shared store has no UI dependency. */
	readonly reportDiagnostic?: NamespaceDiagnosticReporter;
}

/**
 * A single-Capability view over the merged settings file.
 *
 * Construction is lazy and read-only: `load()` reads the merged file, then a
 * configured legacy fallback. Mutations go through `update()`, `updateWith()`,
 * or `replace()`, which acquire the whole-file lock and merge the result back
 * without touching sibling namespaces or the legacy file.
 */
export class NamespacedSettingsStore<T extends NamespaceRecord> {
	private readonly listeners = new Set<(value: T) => void>();
	private readonly lockPath: string;
	private readonly namespace: string;
	private readonly path: string;
	private pending = Promise.resolve();
	private persistedValue: T;
	private value: T;
	private readonly writer: NamespaceWriter;
	private readonly acquireLock: NamespaceLockAcquirer | undefined;
	private readonly reportDiagnostic: NamespaceDiagnosticReporter | undefined;
	private readonly normalize: NamespaceNormalizer<T> | undefined;

	private constructor(
		namespace: string,
		path: string,
		lockPath: string,
		value: T,
		writer: NamespaceWriter,
		acquireLock: NamespaceLockAcquirer | undefined,
		reportDiagnostic: NamespaceDiagnosticReporter | undefined,
		normalize: NamespaceNormalizer<T> | undefined,
	) {
		this.namespace = namespace;
		this.path = path;
		this.lockPath = lockPath;
		this.value = value;
		this.persistedValue = value;
		this.writer = writer;
		this.acquireLock = acquireLock;
		this.reportDiagnostic = reportDiagnostic;
		this.normalize = normalize;
	}

	static async load<T extends NamespaceRecord>(
		namespace: string,
		defaults: T,
		normalize: NamespaceNormalizer<T>,
		options: NamespaceStoreOptions = {},
	): Promise<NamespacedSettingsStore<T>> {
		const path = options.path ?? mergedSettingsPath();
		const lockPath = resolveSettingsLockPath(path);
		const writer: NamespaceWriter =
			options.writer ??
			(async (settingsPath, settingsNamespace, record) => {
				await mergeNamespaceRecord(settingsPath, settingsNamespace, record);
			});
		const store = new NamespacedSettingsStore<T>(
			namespace,
			path,
			lockPath,
			defaults,
			writer,
			options.acquireLock,
			options.reportDiagnostic,
			normalize,
		);
		await store.initialize(namespace, defaults, options.legacyPath, options.legacyReader);
		return store;
	}

	static memory<T extends NamespaceRecord>(value: T): NamespacedSettingsStore<T> {
		return new NamespacedSettingsStore<T>("", "", "", value, async () => undefined, undefined, undefined, undefined);
	}

	get(): T {
		return this.value;
	}

	subscribe(listener: (value: T) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async whenIdle(): Promise<void> {
		await this.pending;
	}

	/** Apply a partial patch under the whole-file lock; unchanged records neither write nor notify. */
	async update(patch: Partial<T>): Promise<T> {
		return this.commit((current) => ({ ...current, ...patch }), true);
	}

	/** Compute an update from the latest persisted namespace under the whole-file lock. */
	async updateWith(apply: (current: T) => T): Promise<T> {
		return this.commit(apply, true);
	}

	/** Replace the namespace wholesale (used by full-state setters). */
	async replace(next: T): Promise<T> {
		return this.commit(() => next, false);
	}

	private async commit(apply: (current: T) => T, readCurrent: boolean): Promise<T> {
		if (!this.path) {
			this.replaceValue(apply(this.value));
			return this.value;
		}
		const write = this.pending.then(async () => {
			this.replaceValue(await this.persistNamespace(apply, readCurrent));
		});
		this.pending = write.catch(() => undefined);
		await write;
		return this.value;
	}

	private async initialize(
		namespace: string,
		defaults: T,
		legacyPath: string | undefined,
		legacyReader: NamespaceLegacyReader | undefined,
	): Promise<void> {
		if (!this.path) return;
		const normalize = this.normalize;
		if (!normalize) return;
		const existing = await this.readExisting(namespace);
		if (existing.kind !== "missing" || !legacyReader || !legacyPath) {
			const value = existing.kind === "loaded" ? this.normalizeInitial(existing.record, defaults) : defaults;
			this.value = value;
			this.persistedValue = value;
			return;
		}

		try {
			const legacy = await legacyReader(legacyPath);
			const value = legacy === undefined ? defaults : normalize(legacy);
			this.value = value;
			this.persistedValue = value;
		} catch (error) {
			if (!isMissingFile(error)) {
				this.reportDiagnostic?.({
					action: "settings-load",
					capability: "pi-stuff",
					details: legacyPath,
					error,
					key: "invalid-legacy-settings",
					severity: "warning",
					summary: "Legacy settings were invalid and built-in defaults are active",
					visibility: "notice",
				});
			}
		}
	}

	/**
	 * Read the current namespace; a malformed merged file degrades to
	 * defaults (with a diagnostic) instead of throwing, matching every legacy
	 * per-Capability store's fail-closed contract.
	 */
	private async readExisting(
		namespace: string,
	): Promise<{ readonly kind: "invalid" | "missing" } | { readonly kind: "loaded"; readonly record: SettingsRecord }> {
		try {
			const record = await readNamespace(this.path, namespace);
			return record === undefined ? { kind: "missing" } : { kind: "loaded", record };
		} catch (error) {
			this.reportDiagnostic?.({
				action: "settings-load",
				capability: "pi-stuff",
				details: this.path,
				error,
				key: "invalid-settings",
				severity: "warning",
				summary: "Settings were invalid and built-in defaults are active",
				visibility: "notice",
			});
			return { kind: "invalid" };
		}
	}

	private normalizeInitial(record: SettingsRecord, defaults: T): T {
		try {
			return this.normalize?.(record) ?? defaults;
		} catch (error) {
			this.reportDiagnostic?.({
				action: "settings-load",
				capability: "pi-stuff",
				details: this.path,
				error,
				key: "invalid-settings",
				severity: "warning",
				summary: "Settings were invalid and built-in defaults are active",
				visibility: "notice",
			});
			return defaults;
		}
	}

	private async persistNamespace(apply: (current: T) => T, readCurrent: boolean): Promise<T> {
		const release = this.acquireLock ? await this.acquireLock(this.lockPath, "pi-stuff") : async () => {};
		try {
			const record = readCurrent ? await readNamespace(this.path, this.namespace) : undefined;
			const current = record === undefined || !this.normalize ? this.persistedValue : this.normalize(record);
			const next = apply(current);
			if (readCurrent && isDeepStrictEqual(current, next)) {
				this.persistedValue = current;
				return current;
			}
			await this.writer(this.path, this.namespace, next);
			this.persistedValue = next;
			return next;
		} finally {
			await release();
		}
	}

	private replaceValue(next: T): void {
		if (isDeepStrictEqual(this.value, next)) return;
		this.value = next;
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.value);
			} catch {
				// Presentation observers cannot block persistence.
			}
		}
	}
}

function isMissingFile(cause: unknown): cause is NodeJS.ErrnoException {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}
