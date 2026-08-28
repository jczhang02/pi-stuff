import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import { type JsonInputObject, type JsonInputValue, parseJsonValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeObject } from "../shared/runtime-type.js";
import { mergedSettingsPath, readNamespace } from "../shared/settings-io/index.js";

const SETTINGS_FILE_NAME = "pi-stuff-tools.json";
const TOOLS_NAMESPACE = "tools";

export interface ToolUiSettings {
	readonly liveElapsed: boolean;
	readonly schemaVersion: 1;
}

const DEFAULT_SETTINGS: ToolUiSettings = {
	liveElapsed: true,
	schemaVersion: 1,
};

type SettingsListener = (settings: ToolUiSettings) => void;
type SettingsWriter = (path: string, settings: ToolUiSettings) => Promise<void>;

interface PersistenceWaiter {
	reject(cause: unknown): void;
	resolve(): void;
}

interface PendingSettingsWrite {
	generation: number;
	settings: ToolUiSettings;
	readonly waiters: PersistenceWaiter[];
}

function isRecord<Value>(value: Value): value is Value & JsonInputObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function parseSettings(value: JsonInputValue): ToolUiSettings {
	if (!isRecord(value) || value["schemaVersion"] !== 1 || !isRuntimeBoolean(value["liveElapsed"])) {
		throw new Error("expected schemaVersion 1 and a boolean liveElapsed value");
	}
	return { liveElapsed: value["liveElapsed"], schemaVersion: 1 };
}

/** Read the `tools` namespace; an absent namespace remains eligible for the legacy fallback. */
async function readSettings(path: string): Promise<ToolUiSettings | undefined> {
	try {
		const namespace = await readNamespace(path, TOOLS_NAMESPACE);
		return namespace === undefined ? undefined : parseSettings(namespace);
	} catch (error) {
		if (isRecord(error) && error["code"] === "ENOENT") return undefined;
		reportDiagnostic({
			action: "/ui",
			capability: "Tools",
			details: path,
			error,
			key: "invalid-settings",
			severity: "warning",
			summary: "Tool display settings were invalid and built-in defaults are active",
			visibility: "notice",
		});
		return DEFAULT_SETTINGS;
	}
}

/**
 * Read the legacy per-file `pi-stuff-tools.json` without mutating it.
 */
async function readLegacySettings(path: string): Promise<ToolUiSettings | undefined> {
	const legacyPath = join(dirname(path), SETTINGS_FILE_NAME);
	try {
		return parseSettings(parseJsonValue(await readFile(legacyPath, "utf8")));
	} catch (error) {
		if (isRecord(error) && error["code"] === "ENOENT") return undefined;
		return undefined;
	}
}

/** Write the `tools` namespace into the merged file, preserving siblings. */
async function writeSettings(path: string, settings: ToolUiSettings): Promise<void> {
	const { mergeNamespaceRecordLocked } = await import("../shared/settings-io/lock.js");
	await mergeNamespaceRecordLocked(
		path,
		TOOLS_NAMESPACE,
		{ liveElapsed: settings.liveElapsed, schemaVersion: 1 },
		"Tools",
	);
}

/** Explicitly user-mutated settings; construction and startup never write a file. */
export class ToolUiSettingsStore {
	private drainPromise: Promise<void> | undefined;
	private generation = 0;
	private readonly listeners = new Set<SettingsListener>();
	private readonly path: string;
	private pendingWrite: PendingSettingsWrite | undefined;
	private persistedValue: ToolUiSettings;
	private value: ToolUiSettings;
	private readonly writer: SettingsWriter;

	private constructor(path: string, value: ToolUiSettings, writer: SettingsWriter) {
		this.path = path;
		this.persistedValue = value;
		this.value = value;
		this.writer = writer;
	}

	static async load(
		path = mergedSettingsPath(getAgentDir()),
		writer: SettingsWriter = writeSettings,
	): Promise<ToolUiSettingsStore> {
		const value = await readSettings(path);
		const initial = value ?? (await readLegacySettings(path)) ?? DEFAULT_SETTINGS;
		return new ToolUiSettingsStore(path, initial, writer);
	}

	static memory(value: ToolUiSettings = DEFAULT_SETTINGS): ToolUiSettingsStore {
		return new ToolUiSettingsStore("", value, writeSettings);
	}

	get(): ToolUiSettings {
		return this.value;
	}

	/** Wait until every active or coalesced persistence operation has settled. */
	async whenIdle(): Promise<void> {
		while (this.drainPromise) {
			await this.drainPromise;
		}
	}

	subscribe(listener: SettingsListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async setLiveElapsed(liveElapsed: boolean): Promise<void> {
		if (this.value.liveElapsed === liveElapsed) return;
		const generation = ++this.generation;
		const next = { liveElapsed, schemaVersion: 1 } as const;
		this.value = next;
		const persistence = this.path ? this.enqueueWrite(generation, next) : undefined;
		this.notify();
		await persistence;
	}

	private async drainWrites(): Promise<void> {
		while (this.pendingWrite) {
			const pending = this.pendingWrite;
			this.pendingWrite = undefined;
			if (this.sameSettings(pending.settings, this.persistedValue)) {
				for (const waiter of pending.waiters) waiter.resolve();
				continue;
			}
			try {
				await this.writer(this.path, pending.settings);
				this.persistedValue = pending.settings;
				for (const waiter of pending.waiters) waiter.resolve();
			} catch (error) {
				if (pending.generation === this.generation && !this.sameSettings(this.value, this.persistedValue)) {
					this.value = this.persistedValue;
					this.notify();
				}
				for (const waiter of pending.waiters) waiter.reject(error);
			}
		}
	}

	private enqueueWrite(generation: number, settings: ToolUiSettings): Promise<void> {
		const promise = new Promise<void>((resolve, reject) => {
			const waiter = { reject, resolve };
			if (this.pendingWrite) {
				this.pendingWrite.generation = generation;
				this.pendingWrite.settings = settings;
				this.pendingWrite.waiters.push(waiter);
				return;
			}
			this.pendingWrite = { generation, settings, waiters: [waiter] };
		});
		this.ensureDrain();
		return promise;
	}

	private ensureDrain(): void {
		if (this.drainPromise) return;
		this.drainPromise = Promise.resolve()
			.then(() => this.drainWrites())
			.finally(() => {
				this.drainPromise = undefined;
				if (this.pendingWrite) this.ensureDrain();
			});
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.value);
			} catch {
				// Settings observers are presentation-only and cannot block persistence.
			}
		}
	}

	private sameSettings(left: ToolUiSettings, right: ToolUiSettings): boolean {
		return left.liveElapsed === right.liveElapsed && left.schemaVersion === right.schemaVersion;
	}
}
