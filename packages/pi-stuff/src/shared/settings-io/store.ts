/**
 * Per-namespace settings store over the single merged settings file.
 *
 * Each Capability owns one namespace (top-level key) in `<agentDir>/pi-stuff.json`
 * and a `normalize` function that validates an arbitrary record into its
 * strongly-typed shape. The store handles whole-file locking, read/merge/write,
 * subscription, and one-time migration from a legacy per-Capability file so
 * individual Capability modules stop duplicating this logic.
 */

import { access, unlink } from "node:fs/promises";
import { mergeNamespaceRecord, readNamespace, type SettingsRecord } from "./file.js";
import { mergedSettingsPath, resolveSettingsLockPath } from "./paths.js";

export type NamespaceRecord = SettingsRecord;
export type NamespaceWriter = (path: string, namespace: string, record: NamespaceRecord) => Promise<void>;
export type NamespaceLockAcquirer = (lockPath: string, owner: string) => Promise<() => Promise<void>>;
export type NamespaceNormalizer<T extends NamespaceRecord> = <Value>(value: Value) => T;

/**
 * Lift a legacy per-Capability settings file into the merged namespace.
 *
 * Return the parsed legacy record so the store can seed the namespace and
 * persist it into the merged file on first load. Return `undefined` when there
 * is no legacy file to migrate.
 */
export type NamespaceMigrator = (legacyPath: string) => Promise<NamespaceRecord | undefined>;

export interface NamespaceStoreDiagnostic {
	readonly action: "settings-load" | "settings-migration";
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
	/** Legacy per-Capability file to lift into this namespace on first load. */
	readonly legacyPath?: string;
	/** Lift a legacy file into the namespace record. */
	readonly migrator?: NamespaceMigrator;
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
 * Construction is lazy: `load()` reads the merged file (and migrates a legacy
 * file once if a migrator is supplied). Mutations go through `update()` /
 * `replace()`, which acquire the whole-file lock, re-read the current
 * namespace, apply the patch, and merge it back without touching sibling
 * namespaces.
 */
export class NamespacedSettingsStore<T extends NamespaceRecord> {
	private readonly listeners = new Set<(value: T) => void>();
	private readonly lockPath: string;
	private readonly migrator: NamespaceMigrator | undefined;
	private readonly legacyPath: string | undefined;
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
		legacyPath: string | undefined,
		migrator: NamespaceMigrator | undefined,
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
		this.legacyPath = legacyPath;
		this.migrator = migrator;
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
			options.legacyPath,
			options.migrator,
			options.acquireLock,
			options.reportDiagnostic,
			normalize,
		);
		await store.initialize(namespace, defaults);
		return store;
	}

	static memory<T extends NamespaceRecord>(value: T): NamespacedSettingsStore<T> {
		return new NamespacedSettingsStore<T>(
			"",
			"",
			"",
			value,
			async () => undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		);
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

	/** Apply a partial patch to the namespace and persist under the whole-file lock. */
	async update(patch: Partial<T>): Promise<T> {
		return this.commit((current) => ({ ...current, ...patch }), true);
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

	private async initialize(namespace: string, defaults: T): Promise<void> {
		if (!this.path) return;
		const normalize = this.normalize;
		if (!normalize) return;
		const existing = await this.readExisting(namespace);
		if (!this.migrator || !this.legacyPath || !(await fileExists(this.legacyPath))) {
			const value = existing === undefined ? defaults : normalize(existing);
			this.value = value;
			this.persistedValue = value;
			return;
		}

		const release = this.acquireLock ? await this.acquireLock(this.lockPath, "pi-stuff") : async () => {};
		try {
			const lockedExisting = await this.readExisting(namespace);
			if (lockedExisting !== undefined) {
				const value = normalize(lockedExisting);
				this.value = value;
				this.persistedValue = value;
				await removeLegacyFile(this.legacyPath);
				return;
			}

			let legacy: T | undefined;
			try {
				const lifted = await this.migrator(this.legacyPath);
				if (lifted) legacy = normalize(lifted);
			} catch (error) {
				if (!isMissingFile(error)) {
					this.reportDiagnostic?.({
						action: "settings-migration",
						capability: "pi-stuff",
						details: this.legacyPath,
						error,
						key: "migration-failed",
						severity: "warning",
						summary: "Legacy settings could not be migrated; built-in defaults are active",
						visibility: "notice",
					});
				}
			}
			const value = legacy ?? defaults;
			this.value = value;
			this.persistedValue = value;
			if (legacy !== undefined) {
				// Persist first; the legacy file stays authoritative if the write fails.
				await this.writer(this.path, this.namespace, legacy);
				await removeLegacyFile(this.legacyPath);
			}
		} catch (error) {
			this.reportDiagnostic?.({
				action: "settings-migration",
				capability: "pi-stuff",
				details: this.path,
				error,
				key: "migration-write-failed",
				severity: "warning",
				summary: "Legacy settings could not be consolidated; the legacy value remains active for this session",
				visibility: "notice",
			});
		} finally {
			await release();
		}
	}

	/**
	 * Read the current namespace; a malformed merged file degrades to
	 * defaults (with a diagnostic) instead of throwing, matching every legacy
	 * per-Capability store's fail-closed contract. A missing file returns
	 * `undefined`.
	 */
	private async readExisting(namespace: string): Promise<SettingsRecord | undefined> {
		try {
			return await readNamespace(this.path, namespace);
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
			return undefined;
		}
	}

	private async persistNamespace(apply: (current: T) => T, readCurrent: boolean): Promise<T> {
		const release = this.acquireLock ? await this.acquireLock(this.lockPath, "pi-stuff") : async () => {};
		try {
			const record = readCurrent ? await readNamespace(this.path, this.namespace) : undefined;
			const current = record === undefined || !this.normalize ? this.persistedValue : this.normalize(record);
			const next = apply(current);
			await this.writer(this.path, this.namespace, next);
			this.persistedValue = next;
			return next;
		} finally {
			await release();
		}
	}

	private replaceValue(next: T): void {
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

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if (isMissingFile(error)) return false;
		throw error;
	}
}

async function removeLegacyFile(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (!isMissingFile(error)) throw error;
	}
}

function isMissingFile(cause: unknown): cause is NodeJS.ErrnoException {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}
