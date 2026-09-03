import { describe, expect, test } from "bun:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	type InteractiveModeConstructor,
	installFastResumeHostPatch,
} from "../../packages/pi-stuff/src/fast-resume/host-adapter.js";

function target(prototype: InteractiveModeConstructor["prototype"]): InteractiveModeConstructor {
	return { prototype };
}

function context(): ExtensionCommandContext {
	const stub: Partial<ExtensionCommandContext> = {};
	// SAFETY: the Host adapter treats the captured context as opaque; these tests compare identity only.
	return stub as ExtensionCommandContext;
}

interface SelectorReceiver {
	readonly session?: { readonly extensionRunner?: { createCommandContext(): ExtensionCommandContext } };
}

function invokeSelector(mode: InteractiveModeConstructor, receiver: SelectorReceiver): void {
	const selector = mode.prototype.showSessionSelector;
	if (!selector) throw new Error("expected a Session selector");
	selector.call(receiver);
}

describe("Fast Resume Host adapter", () => {
	test("routes the Host selector through the latest Fast Resume generation", async () => {
		let originalCalls = 0;
		const mode = target({
			showSessionSelector() {
				originalCalls += 1;
			},
		});
		const first: ExtensionCommandContext[] = [];
		const second: ExtensionCommandContext[] = [];
		const ctx = context();
		const host = { session: { extensionRunner: { createCommandContext: () => ctx } } };
		const old = installFastResumeHostPatch(mode, {
			hijackResume: true,
			open: async (value) => {
				first.push(value);
			},
		});
		const current = installFastResumeHostPatch(mode, {
			hijackResume: true,
			open: async (value) => {
				second.push(value);
			},
		});
		invokeSelector(mode, host);
		await Promise.resolve();
		expect(first).toEqual([]);
		expect(second).toEqual([ctx]);
		expect(originalCalls).toBe(0);
		old.restore();
		invokeSelector(mode, host);
		await Promise.resolve();
		expect(second).toEqual([ctx, ctx]);
		current.restore();
	});

	test("reconciles hijack and shortcut patches when reload changes settings", async () => {
		let originalCalls = 0;
		const originalSelector = () => {
			originalCalls += 1;
		};
		const originalSetup = () => undefined;
		const mode = target({ setupExtensionShortcuts: originalSetup, showSessionSelector: originalSelector });
		const ctx = context();
		const receiver = { session: { extensionRunner: { createCommandContext: () => ctx } } };
		const opened: ExtensionCommandContext[] = [];
		const enabled = installFastResumeHostPatch(mode, {
			captureShortcutContext: true,
			hijackResume: true,
			open: async (value) => {
				opened.push(value);
			},
		});
		expect(mode.prototype.showSessionSelector).not.toBe(originalSelector);
		expect(mode.prototype.setupExtensionShortcuts).not.toBe(originalSetup);

		const disabled = installFastResumeHostPatch(mode, { hijackResume: false, open: async () => undefined });
		expect(mode.prototype.showSessionSelector).toBe(originalSelector);
		expect(mode.prototype.setupExtensionShortcuts).toBe(originalSetup);
		expect(disabled.commandContext()).toBeUndefined();
		invokeSelector(mode, receiver);
		await Promise.resolve();
		expect(opened).toEqual([]);
		expect(originalCalls).toBe(1);
		enabled.restore();
		expect(mode.prototype.showSessionSelector).toBe(originalSelector);

		const reenabled = installFastResumeHostPatch(mode, {
			hijackResume: true,
			open: async (value) => {
				opened.push(value);
			},
		});
		invokeSelector(mode, receiver);
		await Promise.resolve();
		expect(opened).toEqual([ctx]);
		disabled.restore();
		expect(mode.prototype.showSessionSelector).not.toBe(originalSelector);
		reenabled.restore();
		expect(mode.prototype.showSessionSelector).toBe(originalSelector);
	});
});

describe("Fast Resume Host adapter fallbacks", () => {
	test("falls back to the original selector when a command context is unavailable", () => {
		let calls = 0;
		const original = () => {
			calls += 1;
		};
		const mode = target({ showSessionSelector: original });
		const patch = installFastResumeHostPatch(mode, { hijackResume: true, open: async () => undefined });
		invokeSelector(mode, { session: {} });
		expect(calls).toBe(1);
		patch.restore();
		expect(mode.prototype.showSessionSelector).toBe(original);
	});

	test("falls back to the original selector when Fast Resume cannot open", async () => {
		let calls = 0;
		const reports: string[] = [];
		const mode = target({
			showSessionSelector() {
				calls += 1;
			},
		});
		const patch = installFastResumeHostPatch(mode, {
			hijackResume: true,
			open: async () => {
				throw new Error("open failed");
			},
			report: (message) => reports.push(message),
		});
		invokeSelector(mode, { session: { extensionRunner: { createCommandContext: context } } });
		await Promise.resolve();
		expect(calls).toBe(1);
		expect(reports).toEqual(["Fast Resume failed to open; native /resume was restored for this invocation."]);
		patch.restore();
	});

	test("does not overwrite a later third-party patch during cleanup", () => {
		const original = () => undefined;
		const later = () => undefined;
		const mode = target({ showSessionSelector: original });
		const patch = installFastResumeHostPatch(mode, { hijackResume: true, open: async () => undefined });
		mode.prototype.showSessionSelector = later;
		patch.restore();
		expect(mode.prototype.showSessionSelector).toBe(later);
	});

	test("captures the command context for a configured public shortcut", () => {
		let setupCalls = 0;
		const original = () => {
			setupCalls += 1;
		};
		const mode = target({ setupExtensionShortcuts: original });
		const patch = installFastResumeHostPatch(mode, {
			captureShortcutContext: true,
			hijackResume: false,
			open: async () => undefined,
		});
		const ctx = context();
		const runner = { createCommandContext: () => ctx };
		const setup = mode.prototype.setupExtensionShortcuts;
		if (!setup) throw new Error("expected shortcut setup");
		setup.call({}, runner);
		expect(setupCalls).toBe(1);
		expect(patch.commandContext()).toBe(ctx);
		patch.restore();
		expect(mode.prototype.setupExtensionShortcuts).toBe(original);
	});

	test("reports unavailable certified seams without mutating the target", () => {
		const reports: string[] = [];
		const mode = target({});
		const patch = installFastResumeHostPatch(mode, {
			hijackResume: true,
			open: async () => undefined,
			report: (message) => reports.push(message),
		});
		expect(patch.hijackInstalled).toBeFalse();
		expect(reports).toEqual(["InteractiveMode.showSessionSelector is unavailable."]);
	});
});
