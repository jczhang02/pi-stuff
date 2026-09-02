import type { KeyId } from "@earendil-works/pi-tui";
import * as Effect from "effect/Effect";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import { isJsonInputObject } from "../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeString } from "../shared/runtime-type.js";
import { EffectNamespacedSettingsStore, mergedSettingsPath, type SettingsRecord } from "../shared/settings-io/index.js";

export interface FastResumeSettings {
	readonly hijackResume: boolean;
	readonly shortcut?: KeyId;
}

type FastResumeSettingsRecord = {
	hijackResume: boolean;
	shortcut?: KeyId;
};

export const DEFAULT_FAST_RESUME_SETTINGS: FastResumeSettingsRecord = {
	hijackResume: true,
};

const KEY_MODIFIERS = new Set(["alt", "ctrl", "shift", "super"]);
const SYMBOL_KEYS = new Set(Array.from("`-=[]\\;',./!@#$%^&*()_|~{}:<>?"));
const SPECIAL_KEYS = new Set([
	"backspace",
	"clear",
	"delete",
	"down",
	"end",
	"enter",
	"esc",
	"escape",
	"home",
	"insert",
	"left",
	"pagedown",
	"pageup",
	"return",
	"right",
	"space",
	"tab",
	"up",
	...Array.from({ length: 12 }, (_, index) => `f${String(index + 1)}`),
]);

function isKeyId(value: string): value is KeyId {
	const parts = value.toLowerCase().split("+");
	const key = parts.pop();
	if (!key || parts.length > 4 || new Set(parts).size !== parts.length) return false;
	if (!parts.every((part) => KEY_MODIFIERS.has(part))) return false;
	return SPECIAL_KEYS.has(key) || /^[a-z0-9]$/.test(key) || SYMBOL_KEYS.has(key);
}

export function parseFastResumeSettings(value: SettingsRecord): FastResumeSettingsRecord | undefined {
	const hijackResume = "hijackResume" in value ? value["hijackResume"] : undefined;
	const shortcut = "shortcut" in value ? value["shortcut"] : undefined;
	if (hijackResume !== undefined && !isRuntimeBoolean(hijackResume)) return;
	if (shortcut !== undefined && (!isRuntimeString(shortcut) || !isKeyId(shortcut))) return;
	const settings: FastResumeSettingsRecord = { hijackResume: hijackResume ?? true };
	return shortcut ? { ...settings, shortcut } : settings;
}

function normalizeFastResumeSettings<Value>(value: Value): FastResumeSettingsRecord {
	if (!isJsonInputObject(value)) {
		throw new Error("expected an object with optional hijackResume and shortcut settings");
	}
	const parsed = parseFastResumeSettings(value);
	if (!parsed) throw new Error("expected boolean hijackResume and a valid Pi key identifier");
	return parsed;
}

export class FastResumeSettingsStore {
	private readonly store: EffectNamespacedSettingsStore<FastResumeSettingsRecord>;

	private constructor(store: EffectNamespacedSettingsStore<FastResumeSettingsRecord>) {
		this.store = store;
	}

	static load(path = mergedSettingsPath()): Effect.Effect<FastResumeSettingsStore, Error> {
		return Effect.map(
			EffectNamespacedSettingsStore.load("fastResume", DEFAULT_FAST_RESUME_SETTINGS, normalizeFastResumeSettings, {
				path,
				reportDiagnostic: (diagnostic) =>
					reportDiagnostic({
						...diagnostic,
						action: "Fix fastResume in pi-stuff.json, then run /reload.",
						capability: "Fast Resume",
						key: "fast-resume-invalid-settings",
						summary: "Fast Resume settings were invalid and defaults are active",
					}),
			}),
			(store) => new FastResumeSettingsStore(store),
		);
	}

	static memory(value: FastResumeSettings = DEFAULT_FAST_RESUME_SETTINGS): FastResumeSettingsStore {
		return new FastResumeSettingsStore(EffectNamespacedSettingsStore.memory(normalizeFastResumeSettings(value)));
	}

	get(): FastResumeSettings {
		return this.store.get();
	}
}
