import { expect, test } from "bun:test";
import {
	apiHarness,
	assistant,
	CachedToolRow,
	call,
	eventBusView,
	getToolUiRuntime,
	installToolUiRuntime,
	ManualTimerScheduler,
	presentation,
	ToolUiRuntime,
	ToolUiSettingsStore,
	theme,
} from "./contract-fixtures.js";

test("reload handoff crosses the fresh Extension event registry created by Pi", () => {
	const outgoing = new ToolUiRuntime();
	outgoing.prepareReload(["read", "bash"]);
	const incoming = new ToolUiRuntime();
	expect(incoming.hasReloadSnapshot()).toBe(true);
	expect(incoming.consumeReloadActiveTools()).toEqual(["read", "bash"]);
	expect(incoming.hasReloadSnapshot()).toBe(false);
});

test("reload accepts the previous active-name-only handoff during a live code upgrade", () => {
	const key = Symbol.for("@jczhang02/pi-stuff-tools/reload-handoff.v1");
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const host = globalThis as { [name: symbol]: readonly string[] | undefined };
	host[key] = ["read", "bash"];
	const incoming = new ToolUiRuntime();
	expect(incoming.hasReloadSnapshot()).toBe(true);
	expect(incoming.consumeReloadActiveTools()).toEqual(["read", "bash"]);
});

test("timers blink, invalidate, synchronize, and are cleared for reload", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	let invalidations = 0;
	const markers: boolean[] = [];
	runtime.startTimer(
		"call",
		() => invalidations++,
		(visible) => markers.push(visible),
	);
	expect(scheduler.delays).toEqual([600]);
	scheduler.tick();
	expect(invalidations).toBe(1);
	expect(markers.at(-1)).toBe(false);
	runtime.syncTimers();
	expect(markers.at(-1)).toBe(true);
	expect(invalidations).toBe(2);
	runtime.prepareReload([]);
	expect(scheduler.activeCount).toBe(0);
	expect(runtime.consumeReloadActiveTools()).toEqual([]);
});

test("active Retrieval Groups show elapsed time only when the setting and threshold allow it", () => {
	for (const [liveElapsed, expected] of [
		[true, true],
		[false, false],
	] as const) {
		const runtime = new ToolUiRuntime(
			ToolUiSettingsStore.memory({ liveElapsed, schemaVersion: 1 }),
			new ManualTimerScheduler(),
		);
		runtime.registerActivity("read", presentation("read-file").activity);
		runtime.markRendererAttached("read");
		runtime.startTurn([assistant(call("r1", "read", "a.ts"))]);
		const model = {
			durationMs: 2_500,
			label: "read",
			state: "running" as const,
			summary: "working",
			target: "a.ts",
		};
		const row = new CachedToolRow(theme, model);
		runtime.presentRow("r1", row, model, true, () => {}, false, {
			args: { value: "a.ts" },
			cwd: "/project",
			name: "read",
		});

		expect(row.render(80)[0]?.includes(" · 2s")).toBe(expected);
		runtime.clear();
	}
});

test("active Retrieval Group timers advance without a fresh member renderer pass", () => {
	let now = 1_000;
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler, () => now);
	runtime.registerActivity("read", presentation("read-file").activity);
	runtime.markRendererAttached("read");
	runtime.startTurn([assistant(call("r1", "read", "a.ts"))]);
	const model = {
		durationMs: 0,
		label: "read",
		state: "running" as const,
		summary: "working",
		target: "a.ts",
	};
	const row = new CachedToolRow(theme, model);
	runtime.presentRow("r1", row, model, true, () => {}, false, {
		args: { value: "a.ts" },
		cwd: "/project",
		name: "read",
	});
	runtime.startTimer("r1", () => {});
	expect(row.render(80)[0]).not.toContain(" · 2s");

	now = 3_500;
	scheduler.tick();
	expect(row.render(80)[0]).toContain(" · 2s");
	runtime.clear();
});

test("parallel timers keep independent marker phases", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	const first: boolean[] = [];
	const second: boolean[] = [];
	runtime.startTimer(
		"first",
		() => {},
		(visible) => first.push(visible),
	);
	runtime.startTimer(
		"second",
		() => {},
		(visible) => second.push(visible),
	);
	scheduler.tick();
	expect(first.at(-1)).toBe(false);
	expect(second.at(-1)).toBe(false);
});

test("the next running member keeps the folded group marker animated", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	runtime.registerActivity("read", presentation("read-file").activity);
	runtime.markRendererAttached("read");
	runtime.startTurn([assistant(call("r1", "read", "a.ts"), call("r2", "read", "b.ts"))]);
	const runningModel = {
		durationMs: undefined,
		label: "read",
		state: "running" as const,
		summary: "working",
		target: "a.ts",
	};
	const leader = new CachedToolRow(theme, runningModel);
	const follower = new CachedToolRow(theme, runningModel);
	runtime.presentRow("r1", leader, runningModel, true, () => {}, false, {
		args: { value: "a.ts" },
		cwd: "/project",
		name: "read",
	});
	runtime.presentRow("r2", follower, runningModel, true, () => {}, false, {
		args: { value: "b.ts" },
		cwd: "/project",
		name: "read",
	});
	runtime.startTimer(
		"r1",
		() => {},
		(visible) => leader.setMarkerVisible(visible),
	);
	runtime.startTimer(
		"r2",
		() => {},
		(visible) => follower.setMarkerVisible(visible),
	);
	const successModel = { ...runningModel, state: "success" as const, summary: "done" };
	runtime.presentRow("r1", leader, successModel, true, () => {}, false, {
		args: { value: "a.ts" },
		cwd: "/project",
		name: "read",
		result: { content: [{ type: "text", text: "done" }], details: {} },
	});
	runtime.stopTimer("r1");

	scheduler.tick();
	expect(leader.render(100)[0]).not.toStartWith("•");
	runtime.clear();
});

test("live timer state is bounded while the shared ticker keeps recent rows active", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	const invalidations = Array.from({ length: 769 }, () => 0);
	for (let index = 0; index < invalidations.length; index += 1) {
		runtime.startTimer(`call-${String(index)}`, () => {
			invalidations[index] = (invalidations[index] ?? 0) + 1;
		});
	}

	expect(scheduler.activeCount).toBe(1);
	scheduler.tick();
	expect(invalidations[0]).toBe(0);
	expect(invalidations.at(-1)).toBe(1);
	runtime.clear();
	expect(scheduler.activeCount).toBe(0);
});

test("active groups share one fallback pulse ticker", () => {
	const scheduler = new ManualTimerScheduler();
	const runtime = new ToolUiRuntime(ToolUiSettingsStore.memory(), scheduler);
	runtime.registerActivity("read", presentation("read-file").activity);
	runtime.markRendererAttached("read");
	runtime.startTurn([
		assistant(
			call("a1", "read", "a.ts"),
			call("a2", "read", "b.ts"),
			{ type: "text", text: "boundary" },
			call("b1", "read", "c.ts"),
			call("b2", "read", "d.ts"),
		),
	]);
	const model = {
		durationMs: undefined,
		label: "read",
		state: "running" as const,
		summary: "working",
		target: "a.ts",
	};
	for (const [id, value] of [
		["a1", "a.ts"],
		["b1", "c.ts"],
	] as const) {
		runtime.presentRow(id, new CachedToolRow(theme, model), model, true, () => {}, false, {
			args: { value },
			cwd: "/project",
			name: "read",
		});
	}

	expect(scheduler.activeCount).toBe(1);
	runtime.clear();
	expect(scheduler.activeCount).toBe(0);
});

test("runtime registry follows the Pi Host bus across per-extension event facades", () => {
	const bus = eventBusView();
	const first = apiHarness(eventBusView(bus));
	const second = apiHarness(eventBusView(bus));
	const isolated = apiHarness(eventBusView());
	const settings = ToolUiSettingsStore.memory({
		liveElapsed: false,
		schemaVersion: 1,
	});
	expect(installToolUiRuntime(first.api, settings)).toBe(getToolUiRuntime(first.api));
	expect(getToolUiRuntime(first.api)).toBe(getToolUiRuntime(second.api));
	expect(getToolUiRuntime(first.api)).not.toBe(getToolUiRuntime(isolated.api));
	expect(getToolUiRuntime(first.api).showLiveElapsed()).toBe(false);
});
