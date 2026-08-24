import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { GeneratedSessionName } from "./model.js";
import type { NamingMessage } from "./prompt.js";
import type { SessionNamingSettings } from "./settings.js";
import { getLastRenameMarker, namingMessages, type RenameMarker, type RenameMode } from "./state.js";

export type SessionNamingState = "disabled" | "failed" | "fallback" | "named" | "running" | "unnamed";

export interface SessionNamingControllerHost {
	appendMarker(marker: RenameMarker): void;
	generate(messages: readonly NamingMessage[], signal: AbortSignal): Promise<GeneratedSessionName | undefined>;
	getBranch(): readonly SessionEntry[];
	getSessionName(): string | undefined;
	now(): number;
	setSessionName(name: string): void;
}

export class SessionNamingController {
	private activeAbort: AbortController | undefined;
	private generation = 0;
	private readonly host: SessionNamingControllerHost;
	private lastGeneratedName: string | undefined;
	private lastRenameTime = 0;
	private manualName: string | undefined;
	private readonly settings: SessionNamingSettings;
	private state: SessionNamingState;

	constructor(settings: SessionNamingSettings, host: SessionNamingControllerHost) {
		this.settings = settings;
		this.host = host;
		this.state = settings.enabled ? "unnamed" : "disabled";
	}

	restore(): void {
		const existingName = this.host.getSessionName()?.trim();
		const marker = getLastRenameMarker(this.host.getBranch());
		this.lastGeneratedName = undefined;
		this.manualName = undefined;
		this.lastRenameTime = 0;
		if (!marker || !existingName || marker.name !== existingName) {
			this.lastRenameTime = this.host.now();
			this.state = this.settings.enabled ? "unnamed" : "disabled";
			return;
		}
		this.lastRenameTime = marker.timestamp || this.host.now();
		if (marker.source === "user") this.manualName = marker.name;
		else this.lastGeneratedName = marker.name;
		this.state =
			this.settings.enabled && existingName
				? marker.source === "fallback"
					? "fallback"
					: "named"
				: this.settings.enabled
					? "unnamed"
					: "disabled";
	}

	getState(): SessionNamingState {
		return this.state;
	}

	async handleSettled(): Promise<string | undefined> {
		if (!this.settings.enabled || this.state === "running") return undefined;
		if (this.settings.respectManualName && this.manualName) return undefined;
		const existingName = this.host.getSessionName()?.trim();
		if (this.state === "unnamed" || this.state === "failed" || this.state === "fallback" || !existingName) {
			return this.rename("initial");
		}
		const cooldownMs = this.settings.cooldownMinutes * 60_000;
		if (this.host.now() - this.lastRenameTime >= cooldownMs) return this.rename("periodic");
		return undefined;
	}

	async renameManually(): Promise<string | undefined> {
		if (!this.settings.enabled) return undefined;
		return this.rename("forced");
	}

	observeSessionNameChange(name: string | undefined): void {
		const normalized = name?.trim();
		if (normalized === this.lastGeneratedName) return;
		if (this.activeAbort) {
			this.generation += 1;
			this.activeAbort.abort(new Error("Session name changed by the user"));
			this.activeAbort = undefined;
		}
		if (!normalized) {
			this.manualName = undefined;
			if (this.settings.enabled) this.state = "unnamed";
			return;
		}
		this.manualName = normalized;
		this.lastRenameTime = this.host.now();
		this.state = this.settings.enabled ? "named" : "disabled";
		this.host.appendMarker({ name: normalized, source: "user", timestamp: this.lastRenameTime });
	}

	shutdown(): void {
		this.generation += 1;
		this.activeAbort?.abort(new Error("Session Naming stopped"));
		this.activeAbort = undefined;
		this.state = "disabled";
	}

	private async rename(mode: RenameMode): Promise<string | undefined> {
		this.activeAbort?.abort(new Error("Superseded Session naming request"));
		const abort = new AbortController();
		this.activeAbort = abort;
		const generation = ++this.generation;
		this.state = "running";
		try {
			const entries = this.host.getBranch();
			const result = await this.host.generate(namingMessages(entries, mode === "initial"), abort.signal);
			if (abort.signal.aborted || generation !== this.generation) return undefined;
			if (!result) {
				this.state = "failed";
				return undefined;
			}
			const { name, source } = result;
			this.lastGeneratedName = name;
			this.manualName = undefined;
			if (this.host.getSessionName()?.trim() !== name) this.host.setSessionName(name);
			this.lastRenameTime = this.host.now();
			this.host.appendMarker({ mode, name, source, timestamp: this.lastRenameTime });
			this.state = source === "fallback" ? "fallback" : "named";
			return name;
		} catch {
			if (generation === this.generation) this.state = "failed";
			return undefined;
		} finally {
			if (generation === this.generation) this.activeAbort = undefined;
		}
	}
}
