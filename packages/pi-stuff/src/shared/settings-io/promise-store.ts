/** Migration-only Promise adapter for settings consumers not yet on Effect. */

import { Effect } from "effect";
import {
	EffectNamespacedSettingsStore,
	type EffectNamespaceLegacyReader,
	type EffectNamespaceLock,
	type EffectNamespaceStoreOptions,
	type EffectNamespaceWriter,
	type NamespaceDiagnosticReporter,
	type NamespaceNormalizer,
	type NamespaceRecord,
} from "./store.js";

export type NamespaceWriter = (path: string, namespace: string, record: NamespaceRecord) => Promise<void>;
export type NamespaceLockAcquirer = (lockPath: string, owner: string) => Promise<() => Promise<void>>;
export type NamespaceLegacyReader = (legacyPath: string) => Promise<NamespaceRecord | undefined>;

export interface NamespaceStoreOptions {
	readonly path?: string;
	readonly writer?: NamespaceWriter;
	readonly legacyPath?: string;
	readonly legacyReader?: NamespaceLegacyReader;
	readonly acquireLock?: NamespaceLockAcquirer;
	readonly reportDiagnostic?: NamespaceDiagnosticReporter;
}

type MutableEffectNamespaceStoreOptions = {
	-readonly [Key in keyof EffectNamespaceStoreOptions]: EffectNamespaceStoreOptions[Key];
};

export class NamespacedSettingsStore<T extends NamespaceRecord> {
	private readonly store: EffectNamespacedSettingsStore<T>;

	private constructor(store: EffectNamespacedSettingsStore<T>) {
		this.store = store;
	}

	static async load<T extends NamespaceRecord>(
		namespace: string,
		defaults: T,
		normalize: NamespaceNormalizer<T>,
		options: NamespaceStoreOptions = {},
	): Promise<NamespacedSettingsStore<T>> {
		const effectOptions: MutableEffectNamespaceStoreOptions = {};
		if (options.path !== undefined) effectOptions.path = options.path;
		if (options.legacyPath !== undefined) effectOptions.legacyPath = options.legacyPath;
		if (options.reportDiagnostic !== undefined) effectOptions.reportDiagnostic = options.reportDiagnostic;
		if (options.writer !== undefined) effectOptions.writer = adaptWriter(options.writer);
		if (options.legacyReader !== undefined) effectOptions.legacyReader = adaptLegacyReader(options.legacyReader);
		if (options.acquireLock !== undefined) effectOptions.acquireLock = adaptLock(options.acquireLock);
		return new NamespacedSettingsStore(
			await Effect.runPromise(EffectNamespacedSettingsStore.load(namespace, defaults, normalize, effectOptions)),
		);
	}

	static memory<T extends NamespaceRecord>(value: T): NamespacedSettingsStore<T> {
		return new NamespacedSettingsStore(EffectNamespacedSettingsStore.memory(value));
	}

	get(): T {
		return this.store.get();
	}

	subscribe(listener: (value: T) => void): () => void {
		return this.store.subscribe(listener);
	}

	whenIdle(): Promise<void> {
		return Effect.runPromise(this.store.whenIdle());
	}

	update(patch: Partial<T>): Promise<T> {
		return Effect.runPromise(this.store.update(patch));
	}

	updateWith(apply: (current: T) => T): Promise<T> {
		return Effect.runPromise(this.store.updateWith(apply));
	}

	replace(next: T): Promise<T> {
		return Effect.runPromise(this.store.replace(next));
	}
}

function adaptWriter(writer: NamespaceWriter): EffectNamespaceWriter {
	return (path, namespace, record) =>
		Effect.tryPromise({
			try: () => writer(path, namespace, record),
			catch: asError,
		});
}

function adaptLegacyReader(reader: NamespaceLegacyReader): EffectNamespaceLegacyReader {
	return (path) =>
		Effect.tryPromise({
			try: () => reader(path),
			catch: asError,
		});
}

function adaptLock(acquire: NamespaceLockAcquirer): EffectNamespaceLock {
	return (path, owner) =>
		Effect.acquireRelease(
			Effect.tryPromise({
				try: () => acquire(path, owner),
				catch: asError,
			}),
			(release) => Effect.promise(release),
		).pipe(Effect.asVoid);
}

function asError(cause: unknown): Error {
	return cause instanceof Error ? cause : new Error(String(cause));
}
