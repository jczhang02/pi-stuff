import { StringDecoder } from "node:string_decoder";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { isJsonInputObject, type JsonInputValue, type JsonObject, parseJsonObject } from "../shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../shared/runtime-type.js";

export interface TailSessionInfo {
	found: boolean;
	name: string | undefined;
}

// Accumulator state while processing complete session entries line by line.
// Shared by the pure parseSessionFromBuffer and the streaming loadSessionHeader
// so the per-entry logic exists in exactly one place.
export interface SessionAccumulator {
	header: { id: string; timestamp: string; cwd?: string; parentSession?: string } | null;
	firstUserMessage: string;
	allMessages: string[];
	messageCount: number;
	name: string | undefined;
	lastActivityTime: number | undefined;
	foundFirstUser: boolean;
}

export function newAccumulator(): SessionAccumulator {
	return {
		header: null,
		firstUserMessage: "",
		allMessages: [],
		messageCount: 0,
		name: undefined,
		lastActivityTime: undefined,
		foundFirstUser: false,
	};
}

function extractTextFromContent(content: JsonInputValue): string {
	if (isRuntimeString(content)) return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) => {
			if (
				!isJsonInputObject(block) ||
				!isRuntimeString(block["type"]) ||
				block["type"] !== "text" ||
				!isRuntimeString(block["text"])
			)
				return [];
			return [block["text"]];
		})
		.join(" ");
}

function processHeader(acc: SessionAccumulator, entry: JsonObject): void {
	if (!isRuntimeString(entry["id"]) || !isRuntimeString(entry["timestamp"])) return;
	const header: NonNullable<SessionAccumulator["header"]> = { id: entry["id"], timestamp: entry["timestamp"] };
	if (isRuntimeString(entry["cwd"])) header.cwd = entry["cwd"];
	if (isRuntimeString(entry["parentSession"])) header.parentSession = entry["parentSession"];
	acc.header = header;
}

function processMessage(acc: SessionAccumulator, entry: JsonObject): void {
	acc.messageCount += 1;
	const message = entry["message"];
	if (!isJsonInputObject(message)) return;
	const role = message["role"];
	if (role !== "user" && role !== "assistant") return;
	const messageTimestamp = message["timestamp"];
	if (isRuntimeNumber(messageTimestamp) && messageTimestamp > 0) {
		acc.lastActivityTime = Math.max(acc.lastActivityTime ?? 0, messageTimestamp);
	} else if (isRuntimeString(entry["timestamp"])) {
		const timestamp = Date.parse(entry["timestamp"]);
		if (!Number.isNaN(timestamp)) acc.lastActivityTime = Math.max(acc.lastActivityTime ?? 0, timestamp);
	}
	const text = extractTextFromContent(message["content"]);
	if (text) acc.allMessages.push(text);
	if (!acc.foundFirstUser && role === "user" && text) {
		acc.firstUserMessage = text;
		acc.foundFirstUser = true;
	}
}

// Process one complete entry line. Malformed JSON and malformed entries are skipped.
export function processEntry(acc: SessionAccumulator, line: string): void {
	const trimmed = line.trim();
	if (!trimmed) return;
	let entry: JsonObject;
	try {
		entry = parseJsonObject(trimmed);
	} catch {
		return;
	}
	if (entry["type"] === "session") {
		processHeader(acc, entry);
		return;
	}
	if (entry["type"] === "session_info") {
		acc.name = isRuntimeString(entry["name"]) ? entry["name"].trim() || undefined : undefined;
		return;
	}
	if (entry["type"] === "message") processMessage(acc, entry);
}

// Build the SessionHeader from an accumulator. `reachedEof` is whether the
// forward pass consumed all input — when false (it stopped early at the first
// user message), lastActivityTime only reflects entries seen and is unreliable,
// so stat mtime is used instead (pi updates it on every append, so it tracks
// the true last write time). `tailInfo`, if present, carries the latest
// session_info from a tail read and wins over the forward name (later in file
// order), including explicit name clears.
export function buildHeader(
	acc: SessionAccumulator,
	filePath: string,
	mtimeMs: number,
	reachedEof: boolean,
	tailInfo?: TailSessionInfo,
): SessionInfo | null {
	const header = acc.header;
	if (!header) return null;

	const name = tailInfo?.found ? tailInfo.name : acc.name;

	const headerTime = Date.parse(header.timestamp);
	let modified: Date;
	if (!reachedEof) {
		// Partial read — stat mtime is the only reliable signal.
		modified = new Date(mtimeMs);
	} else if (acc.lastActivityTime !== undefined && acc.lastActivityTime > 0) {
		modified = new Date(acc.lastActivityTime);
	} else if (!Number.isNaN(headerTime)) {
		modified = new Date(headerTime);
	} else {
		modified = new Date(mtimeMs);
	}

	const firstMessage = acc.firstUserMessage || "(no messages)";
	const result: SessionInfo = {
		allMessagesText: acc.allMessages.join(" "),
		created: new Date(header.timestamp),
		cwd: header.cwd ?? "",
		firstMessage,
		id: header.id,
		messageCount: acc.messageCount,
		modified,
		path: filePath,
	};
	if (header.parentSession) result.parentSessionPath = header.parentSession;
	if (name) result.name = name;
	return result;
}

export function scanTailForSessionInfo(buf: Buffer, bytesRead: number): TailSessionInfo {
	const decoder = new StringDecoder("utf8");
	const text = decoder.write(buf.subarray(0, bytesRead)) + decoder.end();
	const lines = text.split("\n");
	let found = false;
	let name: string | undefined;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// Only session_info entries matter here, so skip JSON parsing for the
		// common message lines. The
		// quoted marker is conservative — a message whose content literally
		// contains "session_info" false-positives into one parse (harmless); a
		// real session_info entry always carries it. Partial lines at the
		// read-start boundary lack the marker and skip cheaply (JSON.parse would
		// have thrown and been caught anyway).
		if (!trimmed.includes('"session_info"')) continue;
		try {
			const entry = parseJsonObject(trimmed);
			if (entry["type"] === "session_info") {
				found = true;
				name = isRuntimeString(entry["name"]) ? entry["name"].trim() || undefined : undefined;
			}
		} catch {
			// Partial line at tail boundary — skip
		}
	}
	return { found, name };
}
