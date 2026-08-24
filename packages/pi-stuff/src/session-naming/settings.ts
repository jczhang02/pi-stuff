import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import type { JsonInputObject, JsonInputValue } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { mergedSettingsPath, readNamespace } from "../shared/settings-io/index.js";

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

export async function loadSessionNamingSettings(
	path = mergedSettingsPath(getAgentDir()),
): Promise<SessionNamingSettings> {
	try {
		const namespace = await readNamespace(path, SESSION_NAMING_NAMESPACE);
		return namespace === undefined ? DEFAULT_SESSION_NAMING_SETTINGS : parseSessionNamingSettings(namespace);
	} catch (error) {
		reportDiagnostic({
			capability: "Session Naming",
			details: path,
			error,
			key: "invalid-settings",
			severity: "warning",
			summary: "Session Naming settings were invalid and built-in defaults are active",
			visibility: "notice",
		});
		return DEFAULT_SESSION_NAMING_SETTINGS;
	}
}
