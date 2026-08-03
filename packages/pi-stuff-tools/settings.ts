import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const SETTINGS_FILE_NAME = "pi-stuff-tools.json";

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
	reject(reason: unknown): void;
	resolve(): void;
}

interface PendingSettingsWrite {
	generation: number;
	settings: ToolUiSettings;
	readonly waiters: PersistenceWaiter[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettings(value: unknown): ToolUiSettings {
	// biome-ignore lint/complexity/useLiteralKeys: this record is deliberately index-signature-only under noPropertyAccessFromIndexSignature
	if (!isRecord(value) || value["schemaVersion"] !== 1 || typeof value["liveElapsed"] !== "boolean") {
		throw new Error("expected schemaVersion 1 and a boolean liveElapsed value");
	}
	// biome-ignore lint/complexity/useLiteralKeys: this record is deliberately index-signature-only under noPropertyAccessFromIndexSignature
	return { liveElapsed: value["liveElapsed"], schemaVersion: 1 };
}

async function readSettings(path: string): Promise<ToolUiSettings> {
	try {
		return parseSettings(JSON.parse(await readFile(path, "utf8")) as unknown);
	} catch (error) {
		// biome-ignore lint/complexity/useLiteralKeys: this record is deliberately index-signature-only under noPropertyAccessFromIndexSignature
		if (isRecord(error) && error["code"] === "ENOENT") return DEFAULT_SETTINGS;
		console.warn(`[pi-stuff-tools] ignoring invalid settings at ${path}: ${String(error)}`);
		return DEFAULT_SETTINGS;
	}
}

async function writeSettings(path: string, settings: ToolUiSettings): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${String(process.pid)}-${randomUUID()}`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(settings, null, "\t")}\n`, { mode: 0o600 });
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
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
		path = join(getAgentDir(), SETTINGS_FILE_NAME),
		writer: SettingsWriter = writeSettings,
	): Promise<ToolUiSettingsStore> {
		return new ToolUiSettingsStore(path, await readSettings(path), writer);
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
