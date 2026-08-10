// biome-ignore-all lint/complexity/useLiteralKeys: TypeScript enforces bracket access for untrusted index-signature data.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface CodexSettings {
	readonly fast: boolean;
}

type SettingsListener = (settings: CodexSettings) => void;

const DEFAULT_SETTINGS: CodexSettings = { fast: false };
const SETTINGS_FILENAME = "pi-stuff-codex.json";

function normalizeSettings(value: unknown): CodexSettings {
	if (typeof value !== "object" || value === null) return DEFAULT_SETTINGS;
	return { fast: (value as Record<string, unknown>)["fast"] === true };
}

function codexSettingsPath(agentDirectory = getAgentDir()): string {
	return join(agentDirectory, SETTINGS_FILENAME);
}

export class CodexSettingsStore {
	private readonly listeners = new Set<SettingsListener>();
	private readonly path: string;
	private settings: CodexSettings;

	private constructor(settings: CodexSettings, path: string) {
		this.path = path;
		this.settings = settings;
	}

	static async load(path = codexSettingsPath()): Promise<CodexSettingsStore> {
		try {
			const value: unknown = JSON.parse(await readFile(path, "utf8"));
			return new CodexSettingsStore(normalizeSettings(value), path);
		} catch {
			return new CodexSettingsStore(DEFAULT_SETTINGS, path);
		}
	}

	get(): CodexSettings {
		return this.settings;
	}

	async setFast(fast: boolean): Promise<void> {
		if (this.settings.fast === fast) return;
		const next = { fast } satisfies CodexSettings;
		const temporaryPath = `${this.path}.${String(process.pid)}.${String(Date.now())}.tmp`;
		try {
			await mkdir(dirname(this.path), { recursive: true });
			await writeFile(temporaryPath, `${JSON.stringify(next, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
			await rename(temporaryPath, this.path);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw new Error(`Unable to save Codex settings: ${error instanceof Error ? error.message : String(error)}`);
		}
		this.settings = next;
		for (const listener of this.listeners) listener(next);
	}

	subscribe(listener: SettingsListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
