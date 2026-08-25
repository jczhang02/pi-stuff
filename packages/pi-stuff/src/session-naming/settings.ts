import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import { isJsonInputValue, type JsonInputObject, type JsonInputValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { mergedSettingsPath, NamespacedSettingsStore } from "../shared/settings-io/index.js";
import { acquireSettingsLock } from "../shared/settings-io/lock.js";

export const SESSION_NAMING_NAMESPACE = "sessionNaming";
const MAX_COOLDOWN_MINUTES = 24 * 60;

export interface SessionNamingSettings {
	readonly cooldownMinutes: number;
	readonly enabled: boolean;
	readonly fallbackModels: readonly string[];
	readonly model?: string;
	readonly respectManualName: boolean;
	readonly schemaVersion: 1;
}

export interface SessionNamingSettingsPatch {
	readonly cooldownMinutes?: number;
	readonly enabled?: boolean;
	/** A model reference fixes routing; null restores the active Session model. */
	readonly model?: string | null;
	readonly respectManualName?: boolean;
}

interface SessionNamingRecord extends JsonInputObject {
	cooldownMinutes: number;
	enabled: boolean;
	fallbackModels: string[];
	model?: string;
	respectManualName: boolean;
	schemaVersion: 1;
}

export const DEFAULT_SESSION_NAMING_SETTINGS: SessionNamingSettings = {
	cooldownMinutes: 10,
	enabled: true,
	fallbackModels: [],
	respectManualName: false,
	schemaVersion: 1,
};

function isRecord(value: JsonInputValue): value is JsonInputObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function isModelReference(value: string): boolean {
	const separator = value.indexOf("/");
	return separator > 0 && separator < value.length - 1;
}

export function parseSessionNamingSettings(value: JsonInputValue): SessionNamingSettings {
	if (!isRecord(value)) throw new Error("expected a settings object");
	const enabled = value["enabled"];
	const cooldownMinutes = value["cooldownMinutes"];
	const respectManualName = value["respectManualName"];
	const model = value["model"];
	const fallbackModels = value["fallbackModels"];
	if (
		value["schemaVersion"] !== 1 ||
		!isRuntimeBoolean(enabled) ||
		!isRuntimeNumber(cooldownMinutes) ||
		!Number.isFinite(cooldownMinutes) ||
		cooldownMinutes < 1 ||
		cooldownMinutes > MAX_COOLDOWN_MINUTES ||
		!isRuntimeBoolean(respectManualName) ||
		(model !== undefined && (!isRuntimeString(model) || !isModelReference(model.trim()))) ||
		!Array.isArray(fallbackModels) ||
		!fallbackModels.every((candidate) => isRuntimeString(candidate) && isModelReference(candidate.trim()))
	) {
		throw new Error("expected schemaVersion 1 and valid Session Naming settings");
	}
	const settings: SessionNamingSettings = {
		cooldownMinutes,
		enabled,
		fallbackModels: fallbackModels.map((candidate) => candidate.trim()),
		respectManualName,
		schemaVersion: 1,
	};
	if (isRuntimeString(model)) Object.assign(settings, { model: model.trim() });
	return settings;
}

function toRecord(settings: SessionNamingSettings): SessionNamingRecord {
	const record: SessionNamingRecord = {
		cooldownMinutes: settings.cooldownMinutes,
		enabled: settings.enabled,
		fallbackModels: [...settings.fallbackModels],
		respectManualName: settings.respectManualName,
		schemaVersion: 1,
	};
	if (settings.model !== undefined) record.model = settings.model;
	return record;
}

function normalizeRecord<Value>(value: Value): SessionNamingRecord {
	if (!isJsonInputValue(value)) throw new Error("expected JSON-compatible Session Naming settings");
	return toRecord(parseSessionNamingSettings(value));
}

function reportSettingsDiagnostic(diagnostic: Parameters<typeof reportDiagnostic>[0]): void {
	reportDiagnostic({
		...diagnostic,
		action: "/autoname settings",
		capability: "Session Naming",
		summary: "Session Naming settings were invalid and built-in defaults are active",
	});
}

/** Startup is read-only; only a direct update from the settings Dialog persists this namespace. */
export class SessionNamingSettingsStore {
	private readonly store: NamespacedSettingsStore<SessionNamingRecord>;

	private constructor(store: NamespacedSettingsStore<SessionNamingRecord>) {
		this.store = store;
	}

	static async load(path = mergedSettingsPath(getAgentDir())): Promise<SessionNamingSettingsStore> {
		const store = await NamespacedSettingsStore.load<SessionNamingRecord>(
			SESSION_NAMING_NAMESPACE,
			toRecord(DEFAULT_SESSION_NAMING_SETTINGS),
			normalizeRecord,
			{
				acquireLock: acquireSettingsLock,
				path,
				reportDiagnostic: reportSettingsDiagnostic,
			},
		);
		return new SessionNamingSettingsStore(store);
	}

	static memory(settings: SessionNamingSettings = DEFAULT_SESSION_NAMING_SETTINGS): SessionNamingSettingsStore {
		return new SessionNamingSettingsStore(NamespacedSettingsStore.memory(toRecord(settings)));
	}

	get(): SessionNamingSettings {
		return parseSessionNamingSettings(this.store.get());
	}

	subscribe(listener: (settings: SessionNamingSettings) => void): () => void {
		return this.store.subscribe((record) => listener(parseSessionNamingSettings(record)));
	}

	async update(patch: SessionNamingSettingsPatch): Promise<void> {
		await this.store.updateWith((current) => {
			const record: SessionNamingRecord = { ...current };
			if (patch.cooldownMinutes !== undefined) record.cooldownMinutes = patch.cooldownMinutes;
			if (patch.enabled !== undefined) record.enabled = patch.enabled;
			if (patch.model === null) delete record.model;
			else if (patch.model !== undefined) record.model = patch.model;
			if (patch.respectManualName !== undefined) record.respectManualName = patch.respectManualName;
			return normalizeRecord(record);
		});
	}

	async whenIdle(): Promise<void> {
		await this.store.whenIdle();
	}
}

export async function loadSessionNamingSettings(
	path = mergedSettingsPath(getAgentDir()),
): Promise<SessionNamingSettings> {
	return (await SessionNamingSettingsStore.load(path)).get();
}
