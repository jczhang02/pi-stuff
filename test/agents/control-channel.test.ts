import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	consumeStopRequests,
	requestAsyncStop,
	stopRequestPath,
	watchAsyncControlInbox,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/control-channel.js";

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

	test("replays a stop after a consumer dies between durable claim and callback", () => {
		const asyncDir = fixture();
		const requestPath = requestAsyncStop(asyncDir, { targetIndex: 3 }, { now: () => 1_000, randomId: () => "crash" });
		const received: number[] = [];
		const disposeCrashed = watchAsyncControlInbox(asyncDir, {
			onInterrupt: () => {},
			onStop: (request) => received.push(request.targetIndex ?? -1),
			afterControlClaim: (kind) => {
				if (kind === "stop") throw new Error("injected crash after claim");
			},
			pollIntervalMs: 60_000,
		});
		disposeCrashed();

		expect(received).toEqual([]);
		expect(fs.existsSync(requestPath)).toBeFalse();
		expect(
			fs.readdirSync(path.dirname(requestPath)).some((entry) => entry.includes(".pi-stuff-inflight.")),
		).toBeTrue();

		const disposeRecovered = watchAsyncControlInbox(asyncDir, {
			onInterrupt: () => {},
			onStop: (request) => received.push(request.targetIndex ?? -1),
			pollIntervalMs: 60_000,
		});
		disposeRecovered();

		expect(received).toEqual([3]);
		expect(
			fs.readdirSync(path.dirname(requestPath)).some((entry) => entry.includes(".pi-stuff-inflight.")),
		).toBeFalse();
	});

	test("polling delivers a durable stop exactly once when fs.watch stays silent", () => {
		const asyncDir = fixture();
		const silentDirectory = fixture();
		let poll = (): void => {};
		const intervalToken = setInterval(() => {}, 60_000);
		clearInterval(intervalToken);
		const silentWatch = new Proxy(fs.watch, {
			apply: () => fs.watch(silentDirectory, () => {}),
		});
		const setPollInterval = new Proxy(setInterval, {
			apply: (_target, _thisArg, argumentsList) => {
				// SAFETY: watchAsyncControlInbox always schedules its local zero-argument check callback.
				poll = argumentsList[0] as () => void;
				return intervalToken;
			},
		});
		const received: number[] = [];
		const dispose = watchAsyncControlInbox(asyncDir, {
			onInterrupt: () => {},
			onStop: (request) => received.push(request.targetIndex ?? -1),
			fs: { ...fs, watch: silentWatch },
			timers: {
				setInterval: setPollInterval,
				clearInterval,
			},
		});
		const requestPath = requestAsyncStop(asyncDir, { targetIndex: 4 }, { now: () => 1_000, randomId: () => "poll" });

		expect(received).toEqual([]);
		poll();
		expect(received).toEqual([4]);
		expect(fs.existsSync(requestPath)).toBeFalse();
		poll();
		expect(received).toEqual([4]);
		dispose();
	});
});
