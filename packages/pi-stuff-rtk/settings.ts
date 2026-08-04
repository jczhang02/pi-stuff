import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const SETTINGS_FILE_NAME = "pi-stuff-rtk.json";

export interface RtkSettings {
	readonly outputProjection: boolean;
	readonly rewriteCommands: boolean;
	readonly schemaVersion: 1;
}

const DEFAULT_SETTINGS: RtkSettings = {
	outputProjection: true,
	rewriteCommands: true,
	schemaVersion: 1,
};

type SettingsListener = (settings: RtkSettings) => void;
type SettingsWriter = (path: string, settings: RtkSettings) => Promise<void>;

interface PersistenceWaiter {
	reject(reason: unknown): void;
	resolve(): void;
}

interface PendingSettingsWrite {
	generation: number;
	settings: RtkSettings;
	readonly waiters: PersistenceWaiter[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettings(value: unknown): RtkSettings {
	if (!isRecord(value)) throw new Error("expected a settings object");
	const schemaVersion = Reflect.get(value, "schemaVersion");
	const outputProjection = Reflect.get(value, "outputProjection");
	const rewriteCommands = Reflect.get(value, "rewriteCommands");
	if (schemaVersion !== 1 || typeof outputProjection !== "boolean" || typeof rewriteCommands !== "boolean") {
		throw new Error("expected schemaVersion 1 and boolean RTK settings");
	}
	return { outputProjection, rewriteCommands, schemaVersion };
}

async function readSettings(path: string): Promise<RtkSettings> {
	try {
		return parseSettings(JSON.parse(await readFile(path, "utf8")) as unknown);
	} catch (error) {
		if (isRecord(error) && Reflect.get(error, "code") === "ENOENT") return DEFAULT_SETTINGS;
		console.warn(`[pi-stuff-rtk] ignoring invalid settings at ${path}: ${String(error)}`);
		return DEFAULT_SETTINGS;
	}
}

async function writeSettings(path: string, settings: RtkSettings): Promise<void> {
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

function sameSettings(left: RtkSettings, right: RtkSettings): boolean {
	return (
		left.outputProjection === right.outputProjection &&
		left.rewriteCommands === right.rewriteCommands &&
		left.schemaVersion === right.schemaVersion
	);
}

/** Settings remain read-only until the user changes them from `/ui`. */
export class RtkSettingsStore {
	private drainPromise: Promise<void> | undefined;
	private generation = 0;
	private readonly listeners = new Set<SettingsListener>();
	private readonly path: string;
	private pendingWrite: PendingSettingsWrite | undefined;
	private persistedValue: RtkSettings;
	private value: RtkSettings;
	private readonly writer: SettingsWriter;

	private constructor(path: string, value: RtkSettings, writer: SettingsWriter) {
		this.path = path;
		this.persistedValue = value;
		this.value = value;
		this.writer = writer;
	}

	static async load(
		path = join(getAgentDir(), SETTINGS_FILE_NAME),
		writer: SettingsWriter = writeSettings,
	): Promise<RtkSettingsStore> {
		return new RtkSettingsStore(path, await readSettings(path), writer);
	}

	static memory(value: RtkSettings = DEFAULT_SETTINGS): RtkSettingsStore {
		return new RtkSettingsStore("", value, writeSettings);
	}

	get(): RtkSettings {
		return this.value;
	}

	subscribe(listener: SettingsListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async setOutputProjection(outputProjection: boolean): Promise<void> {
		await this.set({ ...this.value, outputProjection });
	}

	async setRewriteCommands(rewriteCommands: boolean): Promise<void> {
		await this.set({ ...this.value, rewriteCommands });
	}

	async whenIdle(): Promise<void> {
		while (this.drainPromise) await this.drainPromise;
	}

	private async set(next: RtkSettings): Promise<void> {
		if (sameSettings(this.value, next)) return;
		const generation = ++this.generation;
		this.value = next;
		const persistence = this.path ? this.enqueueWrite(generation, next) : undefined;
		this.notify();
		await persistence;
	}

	private enqueueWrite(generation: number, settings: RtkSettings): Promise<void> {
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

	private async drainWrites(): Promise<void> {
		while (this.pendingWrite) {
			const pending = this.pendingWrite;
			this.pendingWrite = undefined;
			if (sameSettings(pending.settings, this.persistedValue)) {
				for (const waiter of pending.waiters) waiter.resolve();
				continue;
			}
			try {
				await this.writer(this.path, pending.settings);
				this.persistedValue = pending.settings;
				for (const waiter of pending.waiters) waiter.resolve();
			} catch (error) {
				if (pending.generation === this.generation && !sameSettings(this.value, this.persistedValue)) {
					this.value = this.persistedValue;
					this.notify();
				}
				for (const waiter of pending.waiters) waiter.reject(error);
			}
		}
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.value);
			} catch {
				// Presentation observers cannot block an explicit settings write.
			}
		}
	}
}
