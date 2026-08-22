import { beforeEach, describe, expect, test } from "bun:test";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	BTW_HISTORY_BYTES_LIMIT,
	BTW_HISTORY_ENTRY_TYPE,
	BTW_HISTORY_LIMIT,
	clearBtwHistory,
	clearEarlierBtwHistory,
	hydrateBtwHistory,
	readBtwHistory,
	recordBtwExchange,
	resetBtwHistoryForTests,
} from "../../packages/pi-stuff/src/btw/btw-history.js";
import type { BtwHost } from "../../packages/pi-stuff/src/btw/index.js";
import piStuffBtw from "../../packages/pi-stuff/src/btw/index.js";
import { createExtensionContext } from "../fixtures/extension-context.js";

beforeEach(() => resetBtwHistoryForTests());

function record(sessionKey: string, value: number, appendEntry?: (customType: string, data: unknown) => void) {
	return recordBtwExchange(
		sessionKey,
		{
			question: `question ${value}`,
			answer: `answer ${value}`,
			timestamp: value,
			contextTrimmed: false,
		},
		appendEntry,
	);
}

function persistedEntry(index: number, data: unknown): SessionEntry {
	return {
		type: "custom",
		id: `entry-${index}`,
		parentId: index === 0 ? null : `entry-${index - 1}`,
		timestamp: new Date(index).toISOString(),
		customType: BTW_HISTORY_ENTRY_TYPE,
		data,
	};
}

describe("BTW display history", () => {
	test("is isolated by session and capped only at an abnormal exchange count", () => {
		for (let index = 0; index < BTW_HISTORY_LIMIT + 3; index++) record("session-a", index);
		record("session-b", 100);

		expect(readBtwHistory("session-a")).toHaveLength(BTW_HISTORY_LIMIT);
		expect(readBtwHistory("session-a")[0]?.question).toBe("question 3");
		expect(readBtwHistory("session-b").map((exchange) => exchange.question)).toEqual(["question 100"]);
	});

	test("evicts the oldest records only after the abnormal byte bound", () => {
		const largeAnswer = "x".repeat(Math.floor(BTW_HISTORY_BYTES_LIMIT * 0.6));
		recordBtwExchange("session", {
			question: "old",
			answer: largeAnswer,
			timestamp: 1,
			contextTrimmed: false,
		});
		recordBtwExchange("session", {
			question: "new",
			answer: largeAnswer,
			timestamp: 2,
			contextTrimmed: false,
		});
		expect(readBtwHistory("session").map((exchange) => exchange.question)).toEqual(["new"]);
	});

	test("never retains a single exchange whose serialized form exceeds the 8 MiB guard", () => {
		const seedEvents: unknown[] = [];
		record("seed", 1, (_customType, event) => seedEvents.push(event));
		const seedEvent = seedEvents[0] as { exchange: Record<string, unknown> };
		resetBtwHistoryForTests();
		const oversizedAnswer = "x".repeat(BTW_HISTORY_BYTES_LIMIT);
		const persisted: unknown[] = [];
		recordBtwExchange(
			"session",
			{
				question: "oversized",
				answer: oversizedAnswer,
				timestamp: 1,
				contextTrimmed: false,
			},
			(_customType, event) => persisted.push(event),
		);

		expect(readBtwHistory("session")).toEqual([]);
		expect(persisted).toEqual([]);

		resetBtwHistoryForTests();
		const oversizedPersistedEvent = {
			...seedEvent,
			exchange: { ...seedEvent.exchange, answer: oversizedAnswer },
		};
		expect(hydrateBtwHistory("session", [persistedEntry(0, oversizedPersistedEvent)])).toEqual([]);
	});

	test("replays invisible custom entries on resume but ignores them in a new or forked session", () => {
		const events: unknown[] = [];
		const appendEntry = (customType: string, data: unknown): void => {
			expect(customType).toBe(BTW_HISTORY_ENTRY_TYPE);
			events.push(data);
		};
		record("original-session", 1, appendEntry);
		record("original-session", 2, appendEntry);
		resetBtwHistoryForTests();
		const entries = events.map((event, index) => persistedEntry(index, event));

		expect(hydrateBtwHistory("original-session", entries).map((exchange) => exchange.question)).toEqual([
			"question 1",
			"question 2",
		]);
		expect(hydrateBtwHistory("fork-session", entries)).toEqual([]);
	});

	test("replays validated provider metadata for BTW promotion", () => {
		const response = {
			api: "openai-responses",
			provider: "openai",
			model: "gpt-test",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 2,
				cacheWrite: 1,
				totalTokens: 18,
				cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
			},
			stopReason: "stop",
			timestamp: 123,
		};
		const entry = persistedEntry(0, {
			version: 1,
			ownerSessionId: "session",
			operation: "record",
			exchange: {
				id: "exchange",
				question: "question",
				answer: "answer",
				timestamp: 123,
				contextTrimmed: false,
				response,
			},
		});

		expect(hydrateBtwHistory("session", [entry])[0]?.response).toEqual(response);
	});

	test("replays retain and clear operations without putting history in model context", () => {
		const events: unknown[] = [];
		const appendEntry = (_customType: string, data: unknown): void => {
			events.push(data);
		};
		const first = record("session", 1, appendEntry);
		record("session", 2, appendEntry);
		clearEarlierBtwHistory("session", first.id, appendEntry);
		expect(readBtwHistory("session")).toEqual([first]);

		resetBtwHistoryForTests();
		const retainedEntries = events.map((event, index) => persistedEntry(index, event));
		expect(hydrateBtwHistory("session", retainedEntries)).toEqual([first]);

		clearBtwHistory("session", appendEntry);
		resetBtwHistoryForTests();
		const clearedEntries = events.map((event, index) => persistedEntry(index, event));
		expect(hydrateBtwHistory("session", clearedEntries)).toEqual([]);
	});

	test("a persistence failure degrades to usable in-process history", () => {
		record("session", 1, () => {
			throw new Error("disk unavailable");
		});
		expect(readBtwHistory("session").map((exchange) => exchange.question)).toEqual(["question 1"]);
	});

	test("evicts only the shutting-down session and can replay that session again", async () => {
		const shutdownHandlers: Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void> = [];
		// SAFETY: this test adapter records the one shutdown overload without changing its callback.
		const on = ((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
			if (event === "session_shutdown") shutdownHandlers.push(handler);
		}) as ExtensionAPI["on"];
		const api: BtwHost = {
			appendEntry: () => undefined,
			events: createEventBus(),
			registerCommand: () => {},
			on,
		};
		piStuffBtw(api);

		const persisted: unknown[] = [];
		record("session-a", 1, (_customType, event) => persisted.push(event));
		record("session-b", 2);
		expect(shutdownHandlers).toHaveLength(1);

		await shutdownHandlers[0]?.(
			{ reason: "switch", type: "session_shutdown" },
			createExtensionContext({ sessionManager: { getSessionId: () => "session-a" } }),
		);

		expect(readBtwHistory("session-a")).toEqual([]);
		expect(readBtwHistory("session-b").map((exchange) => exchange.question)).toEqual(["question 2"]);
		expect(
			hydrateBtwHistory("session-a", [persistedEntry(0, persisted[0])]).map((exchange) => exchange.question),
		).toEqual(["question 1"]);
	});
});
