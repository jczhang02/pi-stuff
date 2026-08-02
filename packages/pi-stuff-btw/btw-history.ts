import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const BTW_HISTORY_LIMIT = 20;
export const BTW_VISIBLE_EARLIER_LIMIT = 5;

export interface BtwExchange {
	readonly id: string;
	readonly question: string;
	readonly answer: string;
	readonly timestamp: number;
	readonly contextTrimmed: boolean;
}

interface BtwHistoryState {
	readonly sessions: Map<string, BtwExchange[]>;
	nextId: number;
}

const BTW_HISTORY_STATE = Symbol.for("@jczhang02/pi-stuff-btw/history/v1");

function state(): BtwHistoryState {
	const root = globalThis as unknown as { [key: symbol]: BtwHistoryState | undefined };
	root[BTW_HISTORY_STATE] ??= { sessions: new Map(), nextId: 1 };
	return root[BTW_HISTORY_STATE];
}

export function btwSessionKey(ctx: Pick<ExtensionContext, "sessionManager">): string {
	return ctx.sessionManager.getSessionId();
}

export function readBtwHistory(sessionKey: string): readonly BtwExchange[] {
	return state().sessions.get(sessionKey) ?? [];
}

export function recordBtwExchange(sessionKey: string, exchange: Omit<BtwExchange, "id">): BtwExchange {
	const historyState = state();
	const recorded = { ...exchange, id: `${exchange.timestamp}-${historyState.nextId++}` };
	const prior = historyState.sessions.get(sessionKey) ?? [];
	historyState.sessions.set(sessionKey, [...prior, recorded].slice(-BTW_HISTORY_LIMIT));
	return recorded;
}

/** Claude-style clear: retain the exchange currently being viewed, discard its siblings. */
export function clearEarlierBtwHistory(sessionKey: string, currentId: string): readonly BtwExchange[] {
	const current = (state().sessions.get(sessionKey) ?? []).find((exchange) => exchange.id === currentId);
	const next = current ? [current] : [];
	state().sessions.set(sessionKey, next);
	return next;
}

export function clearBtwHistory(sessionKey: string): void {
	state().sessions.set(sessionKey, []);
}

/** Test-only reset of process-local display state. Not used by the extension runtime. */
export function resetBtwHistoryForTests(): void {
	const historyState = state();
	historyState.sessions.clear();
	historyState.nextId = 1;
}
