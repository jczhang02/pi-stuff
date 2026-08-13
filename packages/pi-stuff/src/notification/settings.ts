import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import type { TerminalDeliveryMode } from "./transport.js";

const SETTINGS_FILE_NAME = "pi-stuff-notification.json";
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettings(value: unknown): NotificationSettings {
	if (!isRecord(value)) throw new Error("expected a settings object");
	const delivery = value["delivery"];
	const minimumDurationMs = value["minimumDurationMs"];
	const gracePeriodMs = value["gracePeriodMs"];
	const legacy = value["schemaVersion"] === 1;
	if (
		(!legacy && value["schemaVersion"] !== 2) ||
		typeof value["enabled"] !== "boolean" ||
		typeof value["completionAlerts"] !== "boolean" ||
		typeof value["failureAlerts"] !== "boolean" ||
		(legacy ? typeof value["sound"] !== "boolean" : typeof value["terminalBell"] !== "boolean") ||
		(!legacy && typeof value["responsePreview"] !== "boolean") ||
		typeof delivery !== "string" ||
		!DELIVERY_MODES.has(delivery as TerminalDeliveryMode) ||
		typeof minimumDurationMs !== "number" ||
		!Number.isFinite(minimumDurationMs) ||
		minimumDurationMs < 0 ||
		typeof gracePeriodMs !== "number" ||
		!Number.isFinite(gracePeriodMs) ||
		gracePeriodMs < 0
	) {
		throw new Error("expected schemaVersion 1 or 2 and valid Notification settings");
	}
	return {
		completionAlerts: value["completionAlerts"],
		delivery: delivery as TerminalDeliveryMode,
		enabled: value["enabled"],
		failureAlerts: value["failureAlerts"],
		gracePeriodMs,
		minimumDurationMs,
		responsePreview: legacy ? false : (value["responsePreview"] as boolean),
		schemaVersion: 2,
		terminalBell: legacy ? (value["sound"] as boolean) : (value["terminalBell"] as boolean),
	};
}

async function readSettings(path: string): Promise<NotificationSettings> {
	try {
		return parseSettings(JSON.parse(await readFile(path, "utf8")) as unknown);
	} catch (error) {
		if (isRecord(error) && error["code"] === "ENOENT") return DEFAULT_NOTIFICATION_SETTINGS;
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

/** Loading is read-only; only direct user updates create the settings file. */
export class NotificationSettingsStore {
	private readonly listeners = new Set<(settings: NotificationSettings) => void>();
	private readonly path: string;
	private pending = Promise.resolve();
	private value: NotificationSettings;
	private readonly writer: SettingsWriter;

	private constructor(path: string, value: NotificationSettings, writer: SettingsWriter) {
		this.path = path;
		this.value = value;
		this.writer = writer;
	}

	static async load(
		path = join(getAgentDir(), SETTINGS_FILE_NAME),
		writer: SettingsWriter = writeSettings,
	): Promise<NotificationSettingsStore> {
		return new NotificationSettingsStore(path, await readSettings(path), writer);
	}

	static memory(value: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS): NotificationSettingsStore {
		return new NotificationSettingsStore("", value, writeSettings);
	}

	get(): NotificationSettings {
		return this.value;
	}

	subscribe(listener: (settings: NotificationSettings) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async update(patch: Partial<Omit<NotificationSettings, "schemaVersion">>): Promise<void> {
		const previous = this.value;
		const next = parseSettings({ ...previous, ...patch });
		if (JSON.stringify(next) === JSON.stringify(previous)) return;
		this.value = next;
		this.notify();
		if (!this.path) return;
		const write = this.pending.then(() => this.writer(this.path, next));
		this.pending = write.catch(() => undefined);
		try {
			await write;
		} catch (error) {
			if (this.value === next) {
				this.value = previous;
				this.notify();
			}
			throw error;
		}
	}

	async whenIdle(): Promise<void> {
		await this.pending;
	}

	private notify(): void {
		for (const listener of this.listeners) listener(this.value);
	}
}
