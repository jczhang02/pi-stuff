import { randomUUID } from "node:crypto";
import type { AssistantMessage, StopReason, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";

/** A session would have to accumulate roughly three BTW exchanges a day for a year to reach this guard. */
export const BTW_HISTORY_LIMIT = 1_000;
export const BTW_HISTORY_BYTES_LIMIT = 8 * 1024 * 1024;
export const BTW_VISIBLE_HISTORY_LIMIT = 5;
export const BTW_HISTORY_ENTRY_TYPE = "@jczhang02/pi-stuff-btw/history/v1";

interface BtwResponseMetadata {
	readonly api: AssistantMessage["api"];
	readonly provider: string;
	readonly model: string;
	readonly usage: Usage;
	readonly stopReason: StopReason;
	readonly timestamp: number;
	readonly errorMessage?: string;
}

export interface BtwExchange {
	readonly id: string;
	readonly question: string;
	readonly answer: string;
	readonly timestamp: number;
	readonly contextTrimmed: boolean;
	/** Enough provider metadata to promote this text as a real assistant turn without another model request. */
	readonly response?: BtwResponseMetadata;
}

type BtwHistoryEvent =
	| {
			readonly version: 1;
			readonly ownerSessionId: string;
			readonly operation: "record";
			readonly exchange: BtwExchange;
	  }
	| {
			readonly version: 1;
			readonly ownerSessionId: string;
			readonly operation: "retain";
			readonly exchangeId: string;
	  }
	| {
			readonly version: 1;
			readonly ownerSessionId: string;
			readonly operation: "clear";
	  };

type AppendHistoryEntry = (customType: string, event: BtwHistoryEvent) => void;

interface BtwHistoryState {
	readonly sessions: Map<string, BtwExchange[]>;
	readonly hydratedSessions: Set<string>;
}

const BTW_HISTORY_STATE = Symbol.for("@jczhang02/pi-stuff-btw/history/v2");

function state(): BtwHistoryState {
	const root = globalThis as unknown as { [key: symbol]: BtwHistoryState | undefined };
	root[BTW_HISTORY_STATE] ??= { sessions: new Map(), hydratedSessions: new Set() };
	return root[BTW_HISTORY_STATE];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return isRuntimeObject(value) && value !== null;
}

function isResponseMetadata(value: unknown): value is BtwResponseMetadata {
	if (!isRecord(value)) return false;
	const candidate = value as {
		api?: unknown;
		provider?: unknown;
		model?: unknown;
		usage?: unknown;
		stopReason?: unknown;
		timestamp?: unknown;
	};
	if (!isRecord(candidate.usage)) return false;
	return (
		isRuntimeString(candidate.api) &&
		isRuntimeString(candidate.provider) &&
		isRuntimeString(candidate.model) &&
		isRuntimeString(candidate.stopReason) &&
		isRuntimeNumber(candidate.timestamp)
	);
}

function isExchange(value: unknown): value is BtwExchange {
	if (!isRecord(value)) return false;
	const candidate = value as {
		id?: unknown;
		question?: unknown;
		answer?: unknown;
		timestamp?: unknown;
		contextTrimmed?: unknown;
		response?: unknown;
	};
	return (
		isRuntimeString(candidate.id) &&
		isRuntimeString(candidate.question) &&
		isRuntimeString(candidate.answer) &&
		isRuntimeNumber(candidate.timestamp) &&
		isRuntimeBoolean(candidate.contextTrimmed) &&
		(candidate.response === undefined || isResponseMetadata(candidate.response))
	);
}

function readEvent(entry: SessionEntry): BtwHistoryEvent | undefined {
	if (entry.type !== "custom" || entry.customType !== BTW_HISTORY_ENTRY_TYPE || !isRecord(entry.data)) {
		return undefined;
	}
	const data = entry.data as {
		version?: unknown;
		ownerSessionId?: unknown;
		operation?: unknown;
		exchangeId?: unknown;
		exchange?: unknown;
	};
	if (data.version !== 1 || !isRuntimeString(data.ownerSessionId)) return undefined;
	if (data.operation === "clear") {
		return { version: 1, ownerSessionId: data.ownerSessionId, operation: "clear" };
	}
	if (data.operation === "retain" && isRuntimeString(data.exchangeId)) {
		return {
			version: 1,
			ownerSessionId: data.ownerSessionId,
			operation: "retain",
			exchangeId: data.exchangeId,
		};
	}
	if (data.operation === "record" && isExchange(data.exchange)) {
		return {
			version: 1,
			ownerSessionId: data.ownerSessionId,
			operation: "record",
			exchange: data.exchange,
		};
	}
	return undefined;
}

function serializedBytes(exchange: BtwExchange): number {
	return Buffer.byteLength(JSON.stringify(exchange), "utf8");
}

function boundHistory(history: readonly BtwExchange[]): BtwExchange[] {
	const newest: BtwExchange[] = [];
	let bytes = 0;
	for (let index = history.length - 1; index >= 0 && newest.length < BTW_HISTORY_LIMIT; index--) {
		const exchange = history[index];
		if (!exchange) continue;
		const exchangeBytes = serializedBytes(exchange);
		if (exchangeBytes > BTW_HISTORY_BYTES_LIMIT) continue;
		if (bytes + exchangeBytes > BTW_HISTORY_BYTES_LIMIT) break;
		newest.push(exchange);
		bytes += exchangeBytes;
	}
	return newest.reverse();
}

function appendSafely(appendEntry: AppendHistoryEntry | undefined, event: BtwHistoryEvent): void {
	try {
		appendEntry?.(BTW_HISTORY_ENTRY_TYPE, event);
	} catch {
		// The in-process copy remains usable. A later successful record will still
		// be persisted, and a Host/session persistence failure must not break BTW.
	}
}

export function btwSessionKey(ctx: Pick<ExtensionContext, "sessionManager">): string {
	return ctx.sessionManager.getSessionId();
}

/** Rebuild invisible BTW state once per loaded session. Forked/new sessions have a different owner id. */
export function hydrateBtwHistory(sessionKey: string, entries: readonly SessionEntry[]): readonly BtwExchange[] {
	const historyState = state();
	if (historyState.hydratedSessions.has(sessionKey)) return historyState.sessions.get(sessionKey) ?? [];

	let history: BtwExchange[] = [];
	for (const entry of entries) {
		const event = readEvent(entry);
		if (!event || event.ownerSessionId !== sessionKey) continue;
		if (event.operation === "record") {
			history = boundHistory([...history.filter((exchange) => exchange.id !== event.exchange.id), event.exchange]);
		} else if (event.operation === "retain") {
			const retained = history.find((exchange) => exchange.id === event.exchangeId);
			history = retained ? [retained] : [];
		} else {
			history = [];
		}
	}

	historyState.sessions.set(sessionKey, history);
	historyState.hydratedSessions.add(sessionKey);
	return history;
}

export function readBtwHistory(sessionKey: string): readonly BtwExchange[] {
	return state().sessions.get(sessionKey) ?? [];
}

/** Release process-local state after Pi closes or switches away from a session. */
export function evictBtwHistory(sessionKey: string): void {
	const historyState = state();
	historyState.sessions.delete(sessionKey);
	historyState.hydratedSessions.delete(sessionKey);
}

export function recordBtwExchange(
	sessionKey: string,
	exchange: Omit<BtwExchange, "id">,
	appendEntry?: AppendHistoryEntry,
): BtwExchange {
	const historyState = state();
	const recorded = { ...exchange, id: randomUUID() };
	const prior = historyState.sessions.get(sessionKey) ?? [];
	const next = boundHistory([...prior, recorded]);
	historyState.sessions.set(sessionKey, next);
	historyState.hydratedSessions.add(sessionKey);
	if (next.some((candidate) => candidate.id === recorded.id)) {
		appendSafely(appendEntry, {
			version: 1,
			ownerSessionId: sessionKey,
			operation: "record",
			exchange: recorded,
		});
	}
	return recorded;
}

/** Claude-style clear: retain the exchange currently being viewed, discard its siblings. */
export function clearEarlierBtwHistory(
	sessionKey: string,
	currentId: string,
	appendEntry?: AppendHistoryEntry,
): readonly BtwExchange[] {
	const current = (state().sessions.get(sessionKey) ?? []).find((exchange) => exchange.id === currentId);
	const next = current ? [current] : [];
	state().sessions.set(sessionKey, next);
	appendSafely(appendEntry, {
		version: 1,
		ownerSessionId: sessionKey,
		operation: "retain",
		exchangeId: currentId,
	});
	return next;
}

export function clearBtwHistory(sessionKey: string, appendEntry?: AppendHistoryEntry): void {
	state().sessions.set(sessionKey, []);
	appendSafely(appendEntry, { version: 1, ownerSessionId: sessionKey, operation: "clear" });
}

/** Test-only reset of process-local display state. Not used by the extension runtime. */
export function resetBtwHistoryForTests(): void {
	const historyState = state();
	historyState.sessions.clear();
	historyState.hydratedSessions.clear();
}
