import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import { isJsonInputValue, type JsonInputObject, type JsonInputValue, parseJsonValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import {
	mergedSettingsPath,
	mergeNamespaceRecord,
	readNamespace,
	resolveSettingsLockPath,
} from "../shared/settings-io/index.js";
import { acquireSettingsLock, migrateLegacyNamespace } from "../shared/settings-io/lock.js";
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
	readonly schemaVersion: 2;
	readonly terminalBell: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
	completionAlerts: true,
	delivery: "auto",
	enabled: true,
	failureAlerts: true,
	gracePeriodMs: 2_000,
	minimumDurationMs: 10_000,
	responsePreview: false,
	schemaVersion: 2,
	terminalBell: false,
};

type SettingsWriter = (path: string, settings: NotificationSettings) => Promise<void>;
type SettingsChanges = {
	-readonly [Id in Exclude<keyof NotificationSettings, "schemaVersion">]?: NotificationSettings[Id];
};

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
	const legacy = value["schemaVersion"] === 1;
	const enabled = value["enabled"];
	const completionAlerts = value["completionAlerts"];
	const failureAlerts = value["failureAlerts"];
	const responsePreview = legacy ? false : value["responsePreview"];
	const terminalBell = legacy ? value["sound"] : value["terminalBell"];
	if (
		(!legacy && value["schemaVersion"] !== 2) ||
		!isRuntimeBoolean(enabled) ||
		!isRuntimeBoolean(completionAlerts) ||
		!isRuntimeBoolean(failureAlerts) ||
		!isRuntimeBoolean(terminalBell) ||
		!isRuntimeBoolean(responsePreview) ||
		!delivery ||
		!isRuntimeNumber(minimumDurationMs) ||
		!Number.isFinite(minimumDurationMs) ||
		minimumDurationMs < 0 ||
		!isRuntimeNumber(gracePeriodMs) ||
		!Number.isFinite(gracePeriodMs) ||
		gracePeriodMs < 0
	) {
		throw new Error("expected schemaVersion 1 or 2 and valid Notification settings");
	}
	return {
		completionAlerts,
		delivery,
		enabled,
		failureAlerts,
		gracePeriodMs,
		minimumDurationMs,
		responsePreview,
		schemaVersion: 2,
		terminalBell,
	};
}

async function readSettings(path: string): Promise<NotificationSettings> {
	try {
		const namespace = await readNamespace(path, NOTIFICATION_NAMESPACE);
		return namespace === undefined ? DEFAULT_NOTIFICATION_SETTINGS : parseSettings(namespace);
	} catch (error) {
		if (isRuntimeObject(error) && error !== null && "code" in error && error.code === "ENOENT") {
			return DEFAULT_NOTIFICATION_SETTINGS;
		}
		reportDiagnostic({
			action: "/notifications",
			capability: "Notification",
			details: path,
			error,
			key: "invalid-settings",
			severity: "warning",
			summary: "Notification settings were invalid and built-in defaults are active",
			visibility: "notice",
		});
		return DEFAULT_NOTIFICATION_SETTINGS;
	}
}

async function writeSettings(path: string, settings: NotificationSettings): Promise<void> {
	await mergeNamespaceRecord(path, NOTIFICATION_NAMESPACE, { ...settings });
}

/** One-time lift of the legacy `pi-stuff-notification.json` into the merged `notification` namespace. */
async function readLegacySettings(path: string): Promise<NotificationSettings | undefined> {
	try {
		return parseSettings(parseJsonValue(await readFile(join(dirname(path), SETTINGS_FILE_NAME), "utf8")));
	} catch {
		return undefined;
	}
}

// resolveSettingsLockPath is imported from shared/settings-io for the merged file.

function applySettingsChanges(
	settings: NotificationSettings,
	changes: SettingsChanges | undefined,
): NotificationSettings {
	return parseSettings({ ...settings, ...changes });
}

function sameSettings(left: NotificationSettings, right: NotificationSettings): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function persistSettingsChanges(
	path: string,
	lockPath: string,
	changes: SettingsChanges,
	writer: SettingsWriter,
): Promise<NotificationSettings> {
	const release = await acquireSettingsLock(lockPath, "Notification");
	try {
		const current = await readSettings(path);
		const next = applySettingsChanges(current, changes);
		if (!sameSettings(current, next)) await writer(path, next);
		return next;
	} finally {
		await release();
	}
}

/** Loading is read-only; only direct user updates create the settings file. */
export class NotificationSettingsStore {
	private readonly listeners = new Set<(settings: NotificationSettings) => void>();
	private readonly lockPath: string;
	private readonly path: string;
	private pending = Promise.resolve();
	private value: NotificationSettings;
	private readonly writer: SettingsWriter;

	private constructor(path: string, lockPath: string, value: NotificationSettings, writer: SettingsWriter) {
		this.path = path;
		this.lockPath = lockPath;
		this.value = value;
		this.writer = writer;
	}

	static async load(
		path = mergedSettingsPath(getAgentDir()),
		writer: SettingsWriter = writeSettings,
	): Promise<NotificationSettingsStore> {
		const value = await readSettings(path);
		if (value === DEFAULT_NOTIFICATION_SETTINGS) {
			const legacy = await readLegacySettings(path);
			if (
				legacy &&
				(await migrateLegacyNamespace(
					path,
					NOTIFICATION_NAMESPACE,
					join(dirname(path), SETTINGS_FILE_NAME),
					{ ...legacy },
					"Notification",
					(value) => isValidSettings(value),
				))
			) {
				return new NotificationSettingsStore(path, resolveSettingsLockPath(path), legacy, writer);
			}
		}
		return new NotificationSettingsStore(path, resolveSettingsLockPath(path), await readSettings(path), writer);
	}

	static memory(value: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS): NotificationSettingsStore {
		return new NotificationSettingsStore("", "", value, writeSettings);
	}

	get(): NotificationSettings {
		return this.value;
	}

	subscribe(listener: (settings: NotificationSettings) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async update(patch: SettingsChanges): Promise<void> {
		if (!this.path) {
			this.replaceValue(applySettingsChanges(this.value, patch));
			return;
		}
		const write = this.pending.then(async () => {
			this.replaceValue(await persistSettingsChanges(this.path, this.lockPath, patch, this.writer));
		});
		this.pending = write.catch(() => undefined);
		await write;
	}

	async whenIdle(): Promise<void> {
		await this.pending;
	}

	private notify(): void {
		for (const listener of this.listeners) listener(this.value);
	}

	private replaceValue(next: NotificationSettings): void {
		if (sameSettings(this.value, next)) return;
		this.value = next;
		this.notify();
	}
}

function isValidSettings<Value>(value: Value): boolean {
	try {
		if (!isJsonInputValue(value)) return false;
		parseSettings(value);
		return true;
	} catch {
		return false;
	}
}
