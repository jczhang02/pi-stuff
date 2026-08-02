import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	consumeStopRequests,
	requestAsyncStop,
	stopRequestPath,
} from "../../packages/pi-stuff-agents/src/runs/background/control-channel.js";

const roots = new Set<string>();

afterEach(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
	roots.clear();
});

function fixture(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-control-channel-"));
	roots.add(root);
	return root;
}

describe("Agent stop control channel", () => {
	test("queues concurrent targeted stops without overwriting either request", () => {
		const asyncDir = fixture();
		const firstPath = requestAsyncStop(asyncDir, { targetIndex: 0 }, { now: () => 1_000, randomId: () => "a" });
		const secondPath = requestAsyncStop(asyncDir, { targetIndex: 1 }, { now: () => 1_000, randomId: () => "b" });

		expect(firstPath).not.toBe(secondPath);
		expect(consumeStopRequests(asyncDir).map((request) => request.targetIndex)).toEqual([0, 1]);
		expect(consumeStopRequests(asyncDir)).toEqual([]);
	});

	test("accepts a valid legacy whole-run stop", () => {
		const asyncDir = fixture();
		fs.mkdirSync(path.dirname(stopRequestPath(asyncDir)), { recursive: true });
		fs.writeFileSync(stopRequestPath(asyncDir), JSON.stringify({ type: "stop", source: "legacy" }), "utf-8");

		expect(consumeStopRequests(asyncDir)).toEqual([{ type: "stop", source: "legacy" }]);
	});

	test("ignores malformed stop input instead of broadening it to a whole-run stop", () => {
		const asyncDir = fixture();
		fs.mkdirSync(path.dirname(stopRequestPath(asyncDir)), { recursive: true });
		fs.writeFileSync(stopRequestPath(asyncDir), JSON.stringify({ type: "stop", targetIndex: -1 }), "utf-8");

		expect(consumeStopRequests(asyncDir)).toEqual([]);
		expect(fs.existsSync(stopRequestPath(asyncDir))).toBeFalse();
	});
});
