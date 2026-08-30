import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { getHostSharedResource } from "../shared/host-resource.js";
import {
	mergedSettingsPath,
	mergeNamespaceRecord,
	readNamespace,
	resolveSettingsLockPath,
} from "../shared/settings-io/index.js";
import { reportDiagnostic } from "./diagnostics.js";
import type { StatuslineDensity } from "./statusline.js";

const SETTINGS_FILE_NAME = "pi-stuff-ui.json";
const UI_NAMESPACE = "ui";

const UI_SETTING_IDS = [
	"statusline",
	"statuslineDensity",
	"statuslineLatestPrompt",
	"welcomeHeader",
	"inputHighlighting",
	"inlineSlashAutocomplete",
] as const;

const BOOLEAN_SETTING_VALUES = [true, false] as const;
const STATUSLINE_DENSITY_VALUES = ["auto", "full", "compact"] as const satisfies readonly StatuslineDensity[];
const LEGACY_STATUSLINE_ICON_VALUES = ["auto", "nerd", "ascii"] as const;
const ERRNO_SCHEMA = Type.Object({ code: Type.String() });
const UI_SETTINGS_VERSION_ONE_SCHEMA = Type.Object(
	{
		inlineSlashAutocomplete: Type.Boolean(),
		inputHighlighting: Type.Boolean(),
		schemaVersion: Type.Literal(1),
		statusline: Type.Boolean(),
		welcomeHeader: Type.Boolean(),
	},
	{ additionalProperties: true },
);
const UI_SETTINGS_VERSION_TWO_SCHEMA = Type.Object(
	{
		inlineSlashAutocomplete: Type.Boolean(),
		inputHighlighting: Type.Boolean(),
		schemaVersion: Type.Literal(2),
		statusline: Type.Boolean(),
		statuslineDensity: Type.Union(STATUSLINE_DENSITY_VALUES.map((value) => Type.Literal(value))),
		statuslineIcons: Type.Union(LEGACY_STATUSLINE_ICON_VALUES.map((value) => Type.Literal(value))),
		statuslineLatestPrompt: Type.Boolean(),
		welcomeHeader: Type.Boolean(),
	},
	{ additionalProperties: true },
);
const UI_SETTINGS_VERSION_THREE_SCHEMA = Type.Object(
	{
		inlineSlashAutocomplete: Type.Boolean(),
		inputHighlighting: Type.Boolean(),
		schemaVersion: Type.Literal(3),
		statusline: Type.Boolean(),
		statuslineDensity: Type.Union(STATUSLINE_DENSITY_VALUES.map((value) => Type.Literal(value))),
		statuslineLatestPrompt: Type.Boolean(),
		welcomeHeader: Type.Boolean(),
	},
	{ additionalProperties: true },
);

export type UiSettingId = (typeof UI_SETTING_IDS)[number];

export interface UiSettings {
	readonly inlineSlashAutocomplete: boolean;
	readonly inputHighlighting: boolean;
	readonly schemaVersion: 3;
	readonly statusline: boolean;
	readonly statuslineDensity: StatuslineDensity;
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

export type UiSettingsHost = Pick<ExtensionAPI, "events" | "on">;

const DEFAULT_SETTINGS: UiSettings = {
	inlineSlashAutocomplete: true,
	inputHighlighting: true,
	schemaVersion: 3,
	statusline: true,
	statuslineDensity: "auto",
	statuslineLatestPrompt: true,
	welcomeHeader: true,
};

type SettingsListener = (settings: UiSettings) => void;
type SettingsWriter = (path: string, settings: UiSettings) => Promise<void>;

interface PersistenceWaiter {
	reject(cause: unknown): void;
	resolve(): void;
}

interface PendingSettingsWrite {
	readonly changes: SettingsChanges;
	readonly waiters: PersistenceWaiter[];
}

type SettingsChanges = { -readonly [Id in UiSettingId]?: UiSettings[Id] };

export function resolveUiSettingsLockPath(
	settingsPath: string,
	environment: NodeJS.ProcessEnv = process.env,
	agentDir = getAgentDir(),
): string {
	return resolveSettingsLockPath(settingsPath, environment, agentDir);
}

function parseVersionOneSettings(value: Static<typeof UI_SETTINGS_VERSION_ONE_SCHEMA>): UiSettings {
	return {
		inlineSlashAutocomplete: value.inlineSlashAutocomplete,
		inputHighlighting: value.inputHighlighting,
		schemaVersion: 3,
		statusline: value.statusline,
		statuslineDensity: DEFAULT_SETTINGS.statuslineDensity,
		statuslineLatestPrompt: DEFAULT_SETTINGS.statuslineLatestPrompt,
		welcomeHeader: value.welcomeHeader,
	};
}

function parseSettings<Value>(value: Value): UiSettings {
	if (Check(UI_SETTINGS_VERSION_ONE_SCHEMA, value)) return parseVersionOneSettings(value);
	if (Check(UI_SETTINGS_VERSION_TWO_SCHEMA, value) || Check(UI_SETTINGS_VERSION_THREE_SCHEMA, value)) {
		return {
			inlineSlashAutocomplete: value.inlineSlashAutocomplete,
			inputHighlighting: value.inputHighlighting,
			schemaVersion: 3,
			statusline: value.statusline,
			statuslineDensity: value.statuslineDensity,
			statuslineLatestPrompt: value.statuslineLatestPrompt,
			welcomeHeader: value.welcomeHeader,
		};
	}
	throw new Error("expected schemaVersion 1, 2, or 3");
}

async function readSettings(path: string): Promise<UiSettings | undefined> {
	try {
		const namespace = await readNamespace(path, UI_NAMESPACE);
		return namespace === undefined ? undefined : parseSettings(namespace);
	} catch (error) {
		if (Check(ERRNO_SCHEMA, error) && error.code === "ENOENT") return undefined;
		reportDiagnostic({
			action: "/ui",
			capability: "UI",
			details: path,
			error,
			key: "invalid-settings",
			severity: "warning",
			summary: "UI settings were invalid and built-in defaults are active",
			visibility: "notice",
		});
		return DEFAULT_SETTINGS;
	}
}

async function writeSettings(path: string, settings: UiSettings): Promise<void> {
	await mergeNamespaceRecord(path, UI_NAMESPACE, { ...settings });
}

/** Read the legacy `pi-stuff-ui.json` without mutating user configuration. */
async function readLegacySettings(path: string): Promise<UiSettings | undefined> {
	try {
		return parseSettings(JSON.parse(await readFile(join(dirname(path), SETTINGS_FILE_NAME), "utf8")));
	} catch {
		return undefined;
	}
}

/**
 * Re-export the shared whole-file settings lock so the Notification module (and
 * any other Capability that imported it from here) keeps one lock owner for the
 * merged settings file. The lock path and flock lease live in shared/settings-io.
 */
export async function acquireSettingsLock(lockPath: string, owner = "UI"): Promise<() => Promise<void>> {
	const { acquireSettingsLock: acquireSharedSettingsLock } = await import("../shared/settings-io/lock.js");
	return acquireSharedSettingsLock(lockPath, owner);
}

function applySettingsChanges(settings: UiSettings, changes: SettingsChanges | undefined): UiSettings {
	return {
		inlineSlashAutocomplete: changes?.inlineSlashAutocomplete ?? settings.inlineSlashAutocomplete,
		inputHighlighting: changes?.inputHighlighting ?? settings.inputHighlighting,
		schemaVersion: 3,
		statusline: changes?.statusline ?? settings.statusline,
		statuslineDensity: changes?.statuslineDensity ?? settings.statuslineDensity,
		statuslineLatestPrompt: changes?.statuslineLatestPrompt ?? settings.statuslineLatestPrompt,
		welcomeHeader: changes?.welcomeHeader ?? settings.welcomeHeader,
	};
}

async function persistSettingsChanges(
	path: string,
	lockPath: string,
	changes: SettingsChanges,
	fallback: UiSettings,
	writer: SettingsWriter,
): Promise<UiSettings> {
	const release = await acquireSettingsLock(lockPath);
	try {
		const current = (await readSettings(path)) ?? fallback;
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
	private readonly lockPath: string;
	private readonly path: string;
	private pendingWrite: PendingSettingsWrite | undefined;
	private persistedValue: UiSettings;
	private value: UiSettings;
	private readonly writer: SettingsWriter;

	private constructor(path: string, lockPath: string, value: UiSettings, writer: SettingsWriter) {
		this.path = path;
		this.lockPath = lockPath;
		this.persistedValue = value;
		this.value = value;
		this.writer = writer;
	}

	static async load(
		path = mergedSettingsPath(getAgentDir()),
		writer: SettingsWriter = writeSettings,
	): Promise<UiSettingsStore> {
		const value = await readSettings(path);
		const initial = value ?? (await readLegacySettings(path)) ?? DEFAULT_SETTINGS;
		return new UiSettingsStore(path, resolveUiSettingsLockPath(path), initial, writer);
	}

	static memory(value: UiSettings = DEFAULT_SETTINGS): UiSettingsStore {
		return new UiSettingsStore("", "", value, writeSettings);
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
				this.persistedValue = await persistSettingsChanges(
					this.path,
					this.lockPath,
					pending.changes,
					this.persistedValue,
					this.writer,
				);
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

function settingsRegistries(): WeakMap<object, UiSettingRegistryImplementation> {
	const existing = Object.getOwnPropertyDescriptor(globalThis, SETTINGS_REGISTRY)?.value;
	if (existing instanceof WeakMap) return existing;
	const created = new WeakMap<object, UiSettingRegistryImplementation>();
	Object.defineProperty(globalThis, SETTINGS_REGISTRY, {
		configurable: true,
		value: created,
		writable: true,
	});
	return created;
}

export function beginUiSettingsGeneration(pi: UiSettingsHost): UiSettingRegistry {
	return getUiSettingRegistryImplementation(pi).beginGeneration();
}

export function getUiSettingRegistry(pi: UiSettingsHost): UiSettingRegistry {
	return getUiSettingRegistryImplementation(pi).currentGeneration();
}

function getUiSettingRegistryImplementation(pi: UiSettingsHost): UiSettingRegistryImplementation {
	const registries = settingsRegistries();
	return getHostSharedResource(
		pi.events,
		registries,
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
				description: "Suggest Host-ranked Skills after slash text anywhere in the input",
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
