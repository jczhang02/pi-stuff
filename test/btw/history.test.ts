import { beforeEach, describe, expect, test } from "bun:test";
import {
	BTW_HISTORY_LIMIT,
	clearBtwHistory,
	clearEarlierBtwHistory,
	readBtwHistory,
	recordBtwExchange,
	resetBtwHistoryForTests,
} from "../../packages/pi-stuff-btw/btw-history.js";

beforeEach(() => resetBtwHistoryForTests());

function record(sessionKey: string, value: number) {
	return recordBtwExchange(sessionKey, {
		question: `question ${value}`,
		answer: `answer ${value}`,
		timestamp: value,
		contextTrimmed: false,
	});
}

describe("BTW display history", () => {
	test("is isolated by session and capped to the newest twenty successes", () => {
		for (let index = 0; index < BTW_HISTORY_LIMIT + 3; index++) record("session-a", index);
		record("session-b", 100);

		expect(readBtwHistory("session-a")).toHaveLength(BTW_HISTORY_LIMIT);
		expect(readBtwHistory("session-a")[0]?.question).toBe("question 3");
		expect(readBtwHistory("session-b").map((exchange) => exchange.question)).toEqual(["question 100"]);
	});

	test("clear earlier retains exactly the open successful exchange", () => {
		record("session", 1);
		const current = record("session", 2);
		record("session", 3);

		expect(clearEarlierBtwHistory("session", current.id)).toEqual([current]);
		expect(readBtwHistory("session")).toEqual([current]);
	});

	test("a pending exchange can clear all prior display history", () => {
		record("session", 1);
		clearBtwHistory("session");
		expect(readBtwHistory("session")).toEqual([]);
	});
});
