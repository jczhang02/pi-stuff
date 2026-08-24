import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import type { NamingMessage } from "./prompt.js";

export const SESSION_NAMING_STATE_ENTRY_TYPE = "pi-stuff-session-naming-state";
export const LEGACY_AUTONAME_STATE_ENTRY_TYPE = "pi-autoname-state";

export type RenameMode = "forced" | "initial" | "periodic";
export type RenameSource = "ai" | "fallback" | "user";

export interface RenameMarker {
	readonly mode?: RenameMode;
	readonly name: string;
	readonly source: RenameSource;
	readonly timestamp: number;
}

function markerFromEntry(entry: SessionEntry): RenameMarker | undefined {
	if (entry.type !== "custom") return undefined;
	const customType = entry.customType;
	if (customType !== SESSION_NAMING_STATE_ENTRY_TYPE && customType !== LEGACY_AUTONAME_STATE_ENTRY_TYPE) {
		return undefined;
	}
	const data = entry.data;
	if (!isRuntimeObject(data) || data === null || !("name" in data)) {
		return undefined;
	}
	const event = "event" in data ? data["event"] : undefined;
	const source = "source" in data ? data["source"] : undefined;
	const timestampValue = "timestamp" in data ? data["timestamp"] : undefined;
	const timestamp = isRuntimeNumber(timestampValue) && Number.isFinite(timestampValue) ? timestampValue : 0;
	const name = data["name"];
	if (!isRuntimeString(name) || !name.trim()) {
		return undefined;
	}
	if (customType === LEGACY_AUTONAME_STATE_ENTRY_TYPE && event === "user_rename") {
		return { name: name.trim(), source: "user", timestamp };
	}
	if (source !== "ai" && source !== "fallback" && source !== "user") return undefined;
	const marker: RenameMarker = {
		name: name.trim(),
		source,
		timestamp,
	};
	const mode = "mode" in data ? data["mode"] : undefined;
	if (mode === "forced" || mode === "initial" || mode === "periodic") Object.assign(marker, { mode });
	return marker;
}

export function getLastRenameMarker(entries: readonly SessionEntry[]): RenameMarker | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry) continue;
		const marker = markerFromEntry(entry);
		if (marker) return marker;
	}
	return undefined;
}

function messageFromEntry(entry: SessionEntry): NamingMessage | undefined {
	if (entry.type !== "message") return undefined;
	const message = entry.message;
	if (message.role !== "user" && message.role !== "assistant") return undefined;
	return { content: message.content, role: message.role };
}

export function namingMessages(entries: readonly SessionEntry[], initial: boolean): NamingMessage[] {
	const messages = entries.flatMap((entry) => {
		const message = messageFromEntry(entry);
		return message ? [message] : [];
	});
	if (!initial) return messages.slice(-6);
	if (messages.length > 2) return messages.slice(-6);
	const firstUserIndex = messages.findIndex((message) => message.role === "user");
	if (firstUserIndex < 0) return [];
	const firstAssistantIndex = messages.findIndex(
		(message, index) => index > firstUserIndex && message.role === "assistant",
	);
	return firstAssistantIndex < 0 ? [] : messages.slice(firstUserIndex, firstAssistantIndex + 1);
}
