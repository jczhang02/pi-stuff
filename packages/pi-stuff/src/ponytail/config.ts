import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isJsonInputObject } from "../shared/json-value.js";
import { isRuntimeBoolean } from "../shared/runtime-type.js";
import {
	MERGED_SETTINGS_FILE,
	readSettingsFileSync,
	type SettingsRecord,
	writeSettingsFileSync,
} from "../shared/settings-io/index.js";
import { withSettingsLock } from "../shared/settings-io/lock.js";
import {
	normalizePonytailMode,
	PONYTAIL_DEFAULT_MODE,
	type PonytailEffectiveSettings,
	type PonytailSavedSettings,
} from "./types.js";

const DEFAULT_SAVED_SETTINGS: PonytailSavedSettings = {
	defaultMode: PONYTAIL_DEFAULT_MODE,
	hideStatus: false,
	quietStartup: false,
};

type PonytailConfigEnvironment = Readonly<Record<string, string | undefined>>;

interface SavedSettingsRead {
	readonly settings: PonytailSavedSettings;
	readonly source: "defaults" | "legacy" | "merged";
	readonly writable: boolean;
	readonly error?: string;
}

export interface PonytailConfigStoreOptions {
	readonly env?: PonytailConfigEnvironment;
	readonly homeDir?: string;
	readonly legacyPath?: string;
}

export type PonytailSettingsPatch = Partial<PonytailSavedSettings>;

function isObject<Value>(value: Value): value is Value & SettingsRecord {
	return isJsonInputObject(value);
}

function strictSavedSettings<Value>(value: Value): PonytailSavedSettings | undefined {
	if (!isObject(value)) return undefined;
	const defaultMode =
		value["defaultMode"] === undefined ? PONYTAIL_DEFAULT_MODE : normalizePonytailMode(value["defaultMode"]);
	if (!defaultMode) return undefined;
	if (value["hideStatus"] !== undefined && !isRuntimeBoolean(value["hideStatus"])) return undefined;
	if (value["quietStartup"] !== undefined && !isRuntimeBoolean(value["quietStartup"])) return undefined;
	return {
		defaultMode,
		hideStatus: value["hideStatus"] === true,
		quietStartup: value["quietStartup"] === true,
	};
}

function lenientLegacySettings<Value>(value: Value): PonytailSavedSettings | undefined {
	if (!isObject(value)) return undefined;
	return {
		defaultMode: normalizePonytailMode(value["defaultMode"]) ?? PONYTAIL_DEFAULT_MODE,
		hideStatus: value["hideStatus"] === true,
		quietStartup: value["quietStartup"] === true,
	};
}

function booleanEnvironmentValue(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no";
}

function errorMessage<ErrorValue>(prefix: string, error: ErrorValue): string {
	return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

function isMissingFileError<ErrorValue>(error: ErrorValue): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function legacyPonytailConfigPath(env: PonytailConfigEnvironment = process.env, homeDir = os.homedir()): string {
	if (env["XDG_CONFIG_HOME"]) return path.join(env["XDG_CONFIG_HOME"], "ponytail", "config.json");
	if (process.platform === "win32") {
		const appData = env["APPDATA"] || path.join(homeDir, "AppData", "Roaming");
		return path.join(appData, "ponytail", "config.json");
	}
	return path.join(homeDir, ".config", "ponytail", "config.json");
}

export class PonytailConfigStore {
	private readonly env: PonytailConfigEnvironment;
	private readonly legacyPath: string;
	private readonly settingsPath: string;

	constructor(agentDir: string, options: PonytailConfigStoreOptions = {}) {
		this.env = options.env ?? process.env;
		this.legacyPath = options.legacyPath ?? legacyPonytailConfigPath(this.env, options.homeDir ?? os.homedir());
		this.settingsPath = path.join(agentDir, MERGED_SETTINGS_FILE);
	}

	read(): PonytailEffectiveSettings {
		return this.resolve(this.readSavedSettings());
	}

	async write(patch: PonytailSettingsPatch): Promise<PonytailEffectiveSettings> {
		await withSettingsLock(this.settingsPath, "ponytail", async () => {
			const root = readSettingsFileSync(this.settingsPath);
			let namespace: SettingsRecord;
			if (Object.hasOwn(root, "ponytail")) {
				if (!strictSavedSettings(root["ponytail"]) || !isObject(root["ponytail"])) {
					throw new Error("Cannot update the invalid ponytail namespace in pi-stuff.json.");
				}
				namespace = root["ponytail"];
			} else {
				namespace = { ...this.readLegacySettings().settings };
			}
			const nextNamespace: SettingsRecord = { ...namespace };
			if (patch.defaultMode !== undefined) nextNamespace["defaultMode"] = patch.defaultMode;
			if (patch.hideStatus !== undefined) nextNamespace["hideStatus"] = patch.hideStatus;
			if (patch.quietStartup !== undefined) nextNamespace["quietStartup"] = patch.quietStartup;
			writeSettingsFileSync(this.settingsPath, { ...root, ponytail: nextNamespace });
		});
		return this.read();
	}

	private readSavedSettings(): SavedSettingsRead {
		let root: ReturnType<typeof readSettingsFileSync>;
		try {
			root = readSettingsFileSync(this.settingsPath);
		} catch (error) {
			return {
				error: errorMessage("Invalid pi-stuff.json", error),
				settings: DEFAULT_SAVED_SETTINGS,
				source: "defaults",
				writable: false,
			};
		}
		if (!Object.hasOwn(root, "ponytail")) return this.readLegacySettings();
		const settings = strictSavedSettings(root["ponytail"]);
		if (!settings) {
			return {
				error: "Invalid ponytail namespace in pi-stuff.json; Ponytail is using safe defaults.",
				settings: DEFAULT_SAVED_SETTINGS,
				source: "defaults",
				writable: false,
			};
		}
		return { settings, source: "merged", writable: true };
	}

	private readLegacySettings(): SavedSettingsRead {
		let text: string;
		try {
			text = fs.readFileSync(this.legacyPath, "utf8").replace(/^\uFEFF/u, "");
		} catch (error) {
			if (isMissingFileError(error)) {
				return { settings: DEFAULT_SAVED_SETTINGS, source: "defaults", writable: true };
			}
			return {
				error: errorMessage("Could not read legacy Ponytail configuration", error),
				settings: DEFAULT_SAVED_SETTINGS,
				source: "defaults",
				writable: true,
			};
		}
		try {
			const settings = lenientLegacySettings(JSON.parse(text));
			if (!settings) throw new Error("expected a JSON object");
			return { settings, source: "legacy", writable: true };
		} catch (error) {
			return {
				error: errorMessage("Invalid legacy Ponytail configuration", error),
				settings: DEFAULT_SAVED_SETTINGS,
				source: "defaults",
				writable: true,
			};
		}
	}

	private resolve(read: SavedSettingsRead): PonytailEffectiveSettings {
		const envDefault = normalizePonytailMode(this.env["PONYTAIL_DEFAULT_MODE"]);
		const envHide = booleanEnvironmentValue(this.env["PONYTAIL_HIDE_STATUS"]);
		const envQuiet = booleanEnvironmentValue(this.env["PONYTAIL_QUIET_STARTUP"]);
		const settings = {
			defaultMode: envDefault ?? read.settings.defaultMode,
			defaultModeOverridden: envDefault !== undefined,
			hideStatus: envHide ?? read.settings.hideStatus,
			hideStatusOverridden: envHide !== undefined,
			quietStartup: envQuiet ?? read.settings.quietStartup,
			quietStartupOverridden: envQuiet !== undefined,
			saved: read.settings,
			source: read.source,
			writable: read.writable,
		};
		return read.error ? { ...settings, error: read.error } : settings;
	}
}
