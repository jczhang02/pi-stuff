import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/diagnostics.js";
import { isRuntimeObject } from "../shared/runtime-type.js";
import { mergedSettingsPath, NamespacedSettingsStore } from "../shared/settings-io/index.js";
import { acquireSettingsLock } from "../shared/settings-io/lock.js";

export interface CodexSettings {
	readonly fast: boolean;
}

type SettingsListener = (settings: CodexSettings) => void;

const DEFAULT_SETTINGS: CodexSettings = { fast: false };
const SETTINGS_FILENAME = "pi-stuff-codex.json";
const CODEX_NAMESPACE = "codex";

type CodexRecord = { fast: boolean };

interface RawCodexSettings {
	readonly fast?: unknown;
}

function rawCodexSettings<Value>(value: Value): RawCodexSettings {
	if (!isRuntimeObject(value) || value === null || Array.isArray(value)) return {};
	// SAFETY: the normalizer reads only the declared field and accepts only the literal true value.
	return value as Value & RawCodexSettings;
}

function normalizeSettings<Value>(value: Value): CodexSettings {
	return { fast: rawCodexSettings(value).fast === true };
}

function toRecord(settings: CodexSettings): CodexRecord {
	return { fast: settings.fast };
}

export class CodexSettingsStore {
	private readonly store: NamespacedSettingsStore<CodexRecord>;

	private constructor(store: NamespacedSettingsStore<CodexRecord>) {
		this.store = store;
	}

	static async load(agentDirectory = getAgentDir()): Promise<CodexSettingsStore> {
		const store = await NamespacedSettingsStore.load<CodexRecord>(
			CODEX_NAMESPACE,
			toRecord(DEFAULT_SETTINGS),
			normalizeSettings,
			{
				path: mergedSettingsPath(agentDirectory),
				legacyPath: join(agentDirectory, SETTINGS_FILENAME),
				acquireLock: acquireSettingsLock,
				reportDiagnostic,
				legacyReader: async (legacyPath) => {
					const raw: unknown = JSON.parse(await Bun.file(legacyPath).text());
					return toRecord(normalizeSettings(raw));
				},
			},
		);
		return new CodexSettingsStore(store);
	}

	static memory(settings: CodexSettings = DEFAULT_SETTINGS): CodexSettingsStore {
		return new CodexSettingsStore(NamespacedSettingsStore.memory(toRecord(settings)));
	}

	get(): CodexSettings {
		return normalizeSettings(this.store.get());
	}

	async setFast(fast: boolean): Promise<void> {
		await this.store.replace({ fast });
	}

	subscribe(listener: SettingsListener): () => void {
		return this.store.subscribe((record) => listener(normalizeSettings(record)));
	}
}
