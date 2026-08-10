import { dlopen, FFIType } from "bun:ffi";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getHostSharedResource } from "./host-resource.js";
import type { StatuslineDensity, StatuslineIconMode } from "./statusline.js";

const SETTINGS_FILE_NAME = "pi-stuff-ui.json";
const SETTINGS_LOCK_POLL_MS = 10;
const SETTINGS_LOCK_TIMEOUT_MS = 10_000;
const FLOCK_EXCLUSIVE_NONBLOCKING = 2 | 4;

const UI_SETTING_IDS = [
	"statusline",
	"statuslineDensity",
	"statuslineLatestPrompt",
	"statuslineIcons",
	"welcomeHeader",
	"inputHighlighting",
	"inlineSlashAutocomplete",
] as const;

const BOOLEAN_SETTING_VALUES = [true, false] as const;
const STATUSLINE_DENSITY_VALUES = ["auto", "full", "compact"] as const satisfies readonly StatuslineDensity[];
const STATUSLINE_ICON_VALUES = ["auto", "nerd", "ascii"] as const satisfies readonly StatuslineIconMode[];

export type UiSettingId = (typeof UI_SETTING_IDS)[number];

export interface UiSettings {
	readonly inlineSlashAutocomplete: boolean;
	readonly inputHighlighting: boolean;
	readonly schemaVersion: 2;
	readonly statusline: boolean;
	readonly statuslineDensity: StatuslineDensity;
	readonly statuslineIcons: StatuslineIconMode;
	readonly statuslineLatestPrompt: boolean;
	readonly welcomeHeader: boolean;
}

export interface RegisteredUiSetting {
	readonly description: string;
	readonly id: string;
	readonly label: string;
	readonly order: number;
	readonly values: readonly string[];
	get(): string;
	set(value: string): Promise<void>;
	subscribe(listener: () => void): () => void;
}

export interface UiSettingRegistry {
	list(): readonly RegisteredUiSetting[];
	register(setting: RegisteredUiSetting): () => void;
}

const DEFAULT_SETTINGS: UiSettings = {
	inlineSlashAutocomplete: true,
	inputHighlighting: true,
	schemaVersion: 2,
	statusline: true,
	statuslineDensity: "auto",
	statuslineIcons: "auto",
	statuslineLatestPrompt: true,
	welcomeHeader: true,
};

type SettingsListener = (settings: UiSettings) => void;
type SettingsWriter = (path: string, settings: UiSettings) => Promise<void>;

interface PersistenceWaiter {
	reject(reason: unknown): void;
	resolve(): void;
}

interface PendingSettingsWrite {
	readonly changes: SettingsChanges;
	readonly waiters: PersistenceWaiter[];
}

type SettingsChanges = { -readonly [Id in UiSettingId]?: UiSettings[Id] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanProperty(value: Record<string, unknown>, id: string): boolean {
	const property = Reflect.get(value, id);
	if (typeof property !== "boolean") throw new Error(`expected a boolean ${id} value`);
	return property;
}

function enumProperty<Value extends string>(
	value: Record<string, unknown>,
	id: string,
	values: readonly Value[],
): Value {
	const property = Reflect.get(value, id);
	const match = typeof property === "string" ? values.find((candidate) => candidate === property) : undefined;
	if (match === undefined) {
		throw new Error(`expected ${id} to be one of ${values.join(", ")}`);
	}
	return match;
}

function parseVersionOneSettings(value: Record<string, unknown>): UiSettings {
	return {
		inlineSlashAutocomplete: booleanProperty(value, "inlineSlashAutocomplete"),
		inputHighlighting: booleanProperty(value, "inputHighlighting"),
		schemaVersion: 2,
		statusline: booleanProperty(value, "statusline"),
		statuslineDensity: DEFAULT_SETTINGS.statuslineDensity,
		statuslineIcons: DEFAULT_SETTINGS.statuslineIcons,
		statuslineLatestPrompt: DEFAULT_SETTINGS.statuslineLatestPrompt,
		welcomeHeader: booleanProperty(value, "welcomeHeader"),
	};
}

function parseVersionTwoSettings(value: Record<string, unknown>): UiSettings {
	return {
		inlineSlashAutocomplete: booleanProperty(value, "inlineSlashAutocomplete"),
		inputHighlighting: booleanProperty(value, "inputHighlighting"),
		schemaVersion: 2,
		statusline: booleanProperty(value, "statusline"),
		statuslineDensity: enumProperty(value, "statuslineDensity", STATUSLINE_DENSITY_VALUES),
		statuslineIcons: enumProperty(value, "statuslineIcons", STATUSLINE_ICON_VALUES),
		statuslineLatestPrompt: booleanProperty(value, "statuslineLatestPrompt"),
		welcomeHeader: booleanProperty(value, "welcomeHeader"),
	};
}

function parseSettings(value: unknown): UiSettings {
	if (!isRecord(value)) throw new Error("expected a settings object");
	const schemaVersion = Reflect.get(value, "schemaVersion");
	if (schemaVersion === 1) return parseVersionOneSettings(value);
	if (schemaVersion === 2) return parseVersionTwoSettings(value);
	throw new Error("expected schemaVersion 1 or 2");
}

async function readSettings(path: string): Promise<UiSettings> {
	try {
		return parseSettings(JSON.parse(await readFile(path, "utf8")) as unknown);
	} catch (error) {
		if (isRecord(error) && Reflect.get(error, "code") === "ENOENT") return DEFAULT_SETTINGS;
		console.warn(`[pi-stuff-ui] ignoring invalid settings at ${path}: ${String(error)}`);
		return DEFAULT_SETTINGS;
	}
}

async function writeSettings(path: string, settings: UiSettings): Promise<void> {
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

/**
 * Keep one stable lock inode and let the kernel own its lease. Closing the file
 * descriptor, including on process exit, releases the lease without a stale
 * check-then-unlink race against a later owner.
 */
function loadFlockLibrary() {
	if (process.platform !== "linux") {
		throw new Error(`UI settings locking is not supported on ${process.platform}`);
	}
	return dlopen("libc.so.6", {
		flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
	});
}

let flockLibrary: ReturnType<typeof loadFlockLibrary> | undefined;

function tryAcquireFileLock(fileDescriptor: number): boolean {
	flockLibrary ??= loadFlockLibrary();
	return flockLibrary.symbols.flock(fileDescriptor, FLOCK_EXCLUSIVE_NONBLOCKING) === 0;
}

async function acquireSettingsLock(path: string): Promise<() => Promise<void>> {
	await mkdir(dirname(path), { recursive: true });
	const lockPath = `${path}.lock`;
	const startedAt = Date.now();
	const handle = await open(lockPath, "a+", 0o600);
	try {
		while (!tryAcquireFileLock(handle.fd)) {
			if (Date.now() - startedAt >= SETTINGS_LOCK_TIMEOUT_MS) {
				throw new Error(`timed out waiting for the UI settings lock at ${lockPath}`);
			}
			await new Promise<void>((resolve) => setTimeout(resolve, SETTINGS_LOCK_POLL_MS));
		}
		await handle.chmod(0o600);
		await handle.truncate(0);
		// This record is diagnostic only; flock owns the mutual-exclusion contract.
		await handle.writeFile(`${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`);
		let released = false;
		return async () => {
			if (released) return;
			released = true;
			await handle.close();
		};
	} catch (error) {
		await handle.close().catch(() => undefined);
		throw error;
	}
}

function applySettingsChanges(settings: UiSettings, changes: SettingsChanges | undefined): UiSettings {
	return {
		inlineSlashAutocomplete: changes?.inlineSlashAutocomplete ?? settings.inlineSlashAutocomplete,
		inputHighlighting: changes?.inputHighlighting ?? settings.inputHighlighting,
		schemaVersion: 2,
		statusline: changes?.statusline ?? settings.statusline,
		statuslineDensity: changes?.statuslineDensity ?? settings.statuslineDensity,
		statuslineIcons: changes?.statuslineIcons ?? settings.statuslineIcons,
		statuslineLatestPrompt: changes?.statuslineLatestPrompt ?? settings.statuslineLatestPrompt,
		welcomeHeader: changes?.welcomeHeader ?? settings.welcomeHeader,
	};
}

async function persistSettingsChanges(
	path: string,
	changes: SettingsChanges,
	writer: SettingsWriter,
): Promise<UiSettings> {
	const release = await acquireSettingsLock(path);
	try {
		const current = await readSettings(path);
		const next = applySettingsChanges(current, changes);
		if (!sameSettings(current, next)) await writer(path, next);
		return next;
	} finally {
		await release();
	}
}

/** Settings are read at startup and written only after an explicit /ui mutation. */
export class UiSettingsStore {
	private drainPromise: Promise<void> | undefined;
	private readonly listeners = new Set<SettingsListener>();
	private readonly path: string;
	private pendingWrite: PendingSettingsWrite | undefined;
	private persistedValue: UiSettings;
	private value: UiSettings;
	private readonly writer: SettingsWriter;

	private constructor(path: string, value: UiSettings, writer: SettingsWriter) {
		this.path = path;
		this.persistedValue = value;
		this.value = value;
		this.writer = writer;
	}

	static async load(
		path = join(getAgentDir(), SETTINGS_FILE_NAME),
		writer: SettingsWriter = writeSettings,
	): Promise<UiSettingsStore> {
		return new UiSettingsStore(path, await readSettings(path), writer);
	}

	static memory(value: UiSettings = DEFAULT_SETTINGS): UiSettingsStore {
		return new UiSettingsStore("", value, writeSettings);
	}

	get(): UiSettings {
		return this.value;
	}

	getValue<Id extends UiSettingId>(id: Id): UiSettings[Id] {
		return this.value[id];
	}

	subscribe(listener: SettingsListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async set<Id extends UiSettingId>(id: Id, value: UiSettings[Id]): Promise<void> {
		if (this.value[id] === value) return;
		const next = { ...this.value, [id]: value };
		this.value = next;
		const persistence = this.path ? this.enqueueWrite(id, value) : undefined;
		this.notify();
		await persistence;
	}

	async whenIdle(): Promise<void> {
		while (this.drainPromise) await this.drainPromise;
	}

	private async drainWrites(): Promise<void> {
		while (this.pendingWrite) {
			const pending = this.pendingWrite;
			this.pendingWrite = undefined;
			try {
				this.persistedValue = await persistSettingsChanges(this.path, pending.changes, this.writer);
				this.reconcileValueWithPersisted();
				for (const waiter of pending.waiters) waiter.resolve();
			} catch (error) {
				this.reconcileValueWithPersisted();
				for (const waiter of pending.waiters) waiter.reject(error);
			}
		}
	}

	private enqueueWrite<Id extends UiSettingId>(id: Id, value: UiSettings[Id]): Promise<void> {
		const promise = new Promise<void>((resolve, reject) => {
			const waiter = { reject, resolve };
			if (this.pendingWrite) {
				this.pendingWrite.changes[id] = value;
				this.pendingWrite.waiters.push(waiter);
				return;
			}
			this.pendingWrite = { changes: { [id]: value }, waiters: [waiter] };
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
				// Presentation observers cannot block persistence.
			}
		}
	}

	private replaceValue(value: UiSettings): void {
		if (sameSettings(this.value, value)) return;
		this.value = value;
		this.notify();
	}

	private reconcileValueWithPersisted(): void {
		this.replaceValue(applySettingsChanges(this.persistedValue, this.pendingWrite?.changes));
	}
}

class UiSettingRegistryImplementation implements UiSettingRegistry {
	private current: UiSettingRegistryGeneration;
	private generation = 0;
	private readonly settings = new Map<string, RegisteredUiSetting>();

	constructor() {
		this.current = new UiSettingRegistryGeneration(this, this.generation);
	}

	beginGeneration(): UiSettingRegistry {
		this.generation += 1;
		this.settings.clear();
		this.current = new UiSettingRegistryGeneration(this, this.generation);
		return this.current;
	}

	currentGeneration(): UiSettingRegistry {
		return this.current;
	}

	list(generation = this.generation): readonly RegisteredUiSetting[] {
		if (generation !== this.generation) return [];
		return [...this.settings.values()].sort(
			(left, right) => left.order - right.order || left.id.localeCompare(right.id),
		);
	}

	register(setting: RegisteredUiSetting, generation = this.generation): () => void {
		if (generation !== this.generation) return () => {};
		if (!setting.id.trim()) throw new Error("UI setting id must not be empty");
		if (this.settings.has(setting.id)) throw new Error(`Duplicate UI setting id: ${setting.id}`);
		this.settings.set(setting.id, setting);
		let registered = true;
		return () => {
			if (!registered) return;
			registered = false;
			if (this.settings.get(setting.id) === setting) this.settings.delete(setting.id);
		};
	}
}

class UiSettingRegistryGeneration implements UiSettingRegistry {
	private readonly generation: number;
	private readonly owner: UiSettingRegistryImplementation;

	constructor(owner: UiSettingRegistryImplementation, generation: number) {
		this.owner = owner;
		this.generation = generation;
	}

	list(): readonly RegisteredUiSetting[] {
		return this.owner.list(this.generation);
	}

	register(setting: RegisteredUiSetting): () => void {
		return this.owner.register(setting, this.generation);
	}
}

const SETTINGS_REGISTRY = Symbol.for("@jczhang02/pi-stuff-ui/settings-registry/v1");
const SETTINGS_REGISTRY_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/settings-registry-discovery/v1";

function settingsRegistries(): WeakMap<ExtensionAPI["events"], UiSettingRegistryImplementation> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], UiSettingRegistryImplementation> | undefined;
	};
	root[SETTINGS_REGISTRY] ??= new WeakMap();
	return root[SETTINGS_REGISTRY];
}

export function beginUiSettingsGeneration(pi: ExtensionAPI): UiSettingRegistry {
	return getUiSettingRegistryImplementation(pi).beginGeneration();
}

export function getUiSettingRegistry(pi: ExtensionAPI): UiSettingRegistry {
	return getUiSettingRegistryImplementation(pi).currentGeneration();
}

function getUiSettingRegistryImplementation(pi: ExtensionAPI): UiSettingRegistryImplementation {
	const registries = settingsRegistries();
	return getHostSharedResource(
		pi.events,
		registries as WeakMap<object, UiSettingRegistryImplementation>,
		SETTINGS_REGISTRY_DISCOVERY_EVENT,
		() => new UiSettingRegistryImplementation(),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
}

interface OwnedSettingDefinition<Id extends UiSettingId> {
	readonly description: string;
	readonly id: Id;
	readonly label: string;
	readonly order: number;
}

function registerStoreSetting<Id extends UiSettingId>(
	registry: UiSettingRegistry,
	store: UiSettingsStore,
	definition: OwnedSettingDefinition<Id>,
	values: readonly UiSettings[Id][],
): () => void {
	const serializedValues = values.map(String);
	return registry.register({
		...definition,
		get: () => String(store.getValue(definition.id)),
		set: async (value) => {
			const index = serializedValues.indexOf(value);
			const storedValue = values[index];
			if (storedValue === undefined) {
				throw new Error(`Invalid ${definition.id} value: ${value}`);
			}
			await store.set(definition.id, storedValue);
		},
		subscribe: (listener) => store.subscribe(listener),
		values: serializedValues,
	});
}

export function registerOwnedUiSettings(registry: UiSettingRegistry, store: UiSettingsStore): () => void {
	const unregister = [
		registerStoreSetting(
			registry,
			store,
			{
				description: "Show session and context information below the editor",
				id: "statusline",
				label: "Statusline",
				order: 10,
			},
			BOOLEAN_SETTING_VALUES,
		),
		registerStoreSetting(
			registry,
			store,
			{
				description: "Choose how much Statusline detail is retained as space narrows",
				id: "statuslineDensity",
				label: "Statusline density",
				order: 11,
			},
			STATUSLINE_DENSITY_VALUES,
		),
		registerStoreSetting(
			registry,
			store,
			{
				description: "Show the latest prompt under the Statusline when space allows",
				id: "statuslineLatestPrompt",
				label: "Latest prompt",
				order: 12,
			},
			BOOLEAN_SETTING_VALUES,
		),
		registerStoreSetting(
			registry,
			store,
			{
				description: "Detect Statusline icons automatically or force Nerd Font or ASCII icons",
				id: "statuslineIcons",
				label: "Statusline icons",
				order: 13,
			},
			STATUSLINE_ICON_VALUES,
		),
		registerStoreSetting(
			registry,
			store,
			{
				description: "Show startup context summary (applies next launch)",
				id: "welcomeHeader",
				label: "Welcome header",
				order: 20,
			},
			BOOLEAN_SETTING_VALUES,
		),
		registerStoreSetting(
			registry,
			store,
			{
				description: "Highlight recognized commands and skills while typing",
				id: "inputHighlighting",
				label: "Input highlighting",
				order: 30,
			},
			BOOLEAN_SETTING_VALUES,
		),
		registerStoreSetting(
			registry,
			store,
			{
				description: "Suggest real commands and skills after slash text anywhere in the input",
				id: "inlineSlashAutocomplete",
				label: "Inline slash autocomplete",
				order: 40,
			},
			BOOLEAN_SETTING_VALUES,
		),
	];
	return () => {
		for (const dispose of unregister.reverse()) dispose();
	};
}

function sameSettings(left: UiSettings, right: UiSettings): boolean {
	return UI_SETTING_IDS.every((id) => left[id] === right[id]) && left.schemaVersion === right.schemaVersion;
}
