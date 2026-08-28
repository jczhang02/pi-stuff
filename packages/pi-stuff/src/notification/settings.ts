import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import { isJsonInputValue, type JsonInputObject, type JsonInputValue, parseJsonValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { mergedSettingsPath, mergeNamespaceRecord, NamespacedSettingsStore } from "../shared/settings-io/index.js";
import { acquireSettingsLock } from "../shared/settings-io/lock.js";
import type { TerminalDeliveryMode } from "./transport.js";

const SETTINGS_FILE_NAME = "pi-stuff-notification.json";
const NOTIFICATION_NAMESPACE = "notification";
const DELIVERY_MODES = new Set<TerminalDeliveryMode>(["auto", "bell", "kitty", "osc9", "osc777"]);

export interface NotificationSettings {
	readonly completionAlerts: boolean;
	readonly delivery: TerminalDeliveryMode;
	readonly enabled: boolean;
	readonly failureAlerts: boolean;
	readonly gracePeriodMs: number;
	readonly minimumDurationMs: number;
	readonly responsePreview: boolean;
	readonly schemaVersion: 3;
	readonly terminalBell: boolean;
	readonly tmuxNotification: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
	completionAlerts: true,
	delivery: "auto",
	enabled: true,
	failureAlerts: true,
	gracePeriodMs: 2_000,
	minimumDurationMs: 10_000,
	responsePreview: false,
	schemaVersion: 3,
	terminalBell: false,
	tmuxNotification: true,
};

type SettingsWriter = (path: string, settings: NotificationSettings) => Promise<void>;
type SettingsChanges = {
	-readonly [Id in Exclude<keyof NotificationSettings, "schemaVersion">]?: NotificationSettings[Id];
};

interface NotificationSettingsRecord extends JsonInputObject {
	completionAlerts: boolean;
	delivery: TerminalDeliveryMode;
	enabled: boolean;
	failureAlerts: boolean;
	gracePeriodMs: number;
	minimumDurationMs: number;
	responsePreview: boolean;
	schemaVersion: 3;
	terminalBell: boolean;
	tmuxNotification: boolean;
}

function isRecord(value: JsonInputValue): value is JsonInputObject {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value);
}

function deliveryMode(value: JsonInputValue): TerminalDeliveryMode | undefined {
	if (!isRuntimeString(value)) return undefined;
	for (const mode of DELIVERY_MODES) {
		if (value === mode) return mode;
	}
	return undefined;
}

function parseSettings(value: JsonInputValue): NotificationSettings {
	if (!isRecord(value)) throw new Error("expected a settings object");
	const delivery = deliveryMode(value["delivery"]);
	const minimumDurationMs = value["minimumDurationMs"];
	const gracePeriodMs = value["gracePeriodMs"];
	const schemaVersion = value["schemaVersion"];
	const legacy = schemaVersion === 1;
	const enabled = value["enabled"];
	const completionAlerts = value["completionAlerts"];
	const failureAlerts = value["failureAlerts"];
	const responsePreview = legacy ? false : value["responsePreview"];
	const terminalBell = legacy ? value["sound"] : value["terminalBell"];
	const tmuxNotification = schemaVersion === 3 ? value["tmuxNotification"] : true;
	if (
		(schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) ||
		!isRuntimeBoolean(enabled) ||
		!isRuntimeBoolean(completionAlerts) ||
		!isRuntimeBoolean(failureAlerts) ||
		!isRuntimeBoolean(terminalBell) ||
		!isRuntimeBoolean(tmuxNotification) ||
		!isRuntimeBoolean(responsePreview) ||
		!delivery ||
		!isRuntimeNumber(minimumDurationMs) ||
		!Number.isFinite(minimumDurationMs) ||
		minimumDurationMs < 0 ||
		!isRuntimeNumber(gracePeriodMs) ||
		!Number.isFinite(gracePeriodMs) ||
		gracePeriodMs < 0
	) {
		throw new Error("expected schemaVersion 1, 2, or 3 and valid Notification settings");
	}
	return {
		completionAlerts,
		delivery,
		enabled,
		failureAlerts,
		gracePeriodMs,
		minimumDurationMs,
		responsePreview,
		schemaVersion: 3,
		terminalBell,
		tmuxNotification,
	};
}

async function writeSettings(path: string, settings: NotificationSettings): Promise<void> {
	await mergeNamespaceRecord(path, NOTIFICATION_NAMESPACE, toRecord(settings));
}

/** Read the legacy `pi-stuff-notification.json` without mutating user configuration. */
async function readLegacySettings(path: string): Promise<NotificationSettings | undefined> {
	try {
		return parseSettings(parseJsonValue(await readFile(path, "utf8")));
	} catch {
		return undefined;
	}
}

function toRecord(settings: NotificationSettings): NotificationSettingsRecord {
	return { ...settings };
}

function normalizeRecord<Value>(value: Value): NotificationSettingsRecord {
	if (!isJsonInputValue(value)) throw new Error("expected JSON-compatible Notification settings");
	return toRecord(parseSettings(value));
}

function reportSettingsDiagnostic(diagnostic: Parameters<typeof reportDiagnostic>[0]): void {
	reportDiagnostic({
		...diagnostic,
		action: "/notifications",
		capability: "Notification",
		summary: "Notification settings were invalid and built-in defaults are active",
	});
}

/** Loading is read-only; only direct user updates create the settings file. */
export class NotificationSettingsStore {
	private readonly store: NamespacedSettingsStore<NotificationSettingsRecord>;

	private constructor(store: NamespacedSettingsStore<NotificationSettingsRecord>) {
		this.store = store;
	}

	static async load(
		path = mergedSettingsPath(getAgentDir()),
		writer: SettingsWriter = writeSettings,
	): Promise<NotificationSettingsStore> {
		const store = await NamespacedSettingsStore.load<NotificationSettingsRecord>(
			NOTIFICATION_NAMESPACE,
			toRecord(DEFAULT_NOTIFICATION_SETTINGS),
			normalizeRecord,
			{
				acquireLock: acquireSettingsLock,
				legacyPath: join(dirname(path), SETTINGS_FILE_NAME),
				legacyReader: async (legacyPath) => {
					const settings = await readLegacySettings(legacyPath);
					return settings ? toRecord(settings) : undefined;
				},
				path,
				reportDiagnostic: reportSettingsDiagnostic,
				writer: async (settingsPath, _namespace, record) => writer(settingsPath, parseSettings(record)),
			},
		);
		return new NotificationSettingsStore(store);
	}

	static memory(value: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS): NotificationSettingsStore {
		return new NotificationSettingsStore(NamespacedSettingsStore.memory(toRecord(value)));
	}

	get(): NotificationSettings {
		return parseSettings(this.store.get());
	}

	subscribe(listener: (settings: NotificationSettings) => void): () => void {
		return this.store.subscribe((record) => listener(parseSettings(record)));
	}

	async update(patch: SettingsChanges): Promise<void> {
		await this.store.updateWith((current) => normalizeRecord({ ...current, ...patch }));
	}

	async whenIdle(): Promise<void> {
		await this.store.whenIdle();
	}
}
