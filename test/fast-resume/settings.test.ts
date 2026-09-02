import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
	DEFAULT_FAST_RESUME_SETTINGS,
	FastResumeSettingsStore,
	parseFastResumeSettings,
} from "../../packages/pi-stuff/src/fast-resume/settings.js";

describe("Fast Resume settings", () => {
	test("uses hijack mode by default without a standalone shortcut", () => {
		expect(DEFAULT_FAST_RESUME_SETTINGS).toEqual({ hijackResume: true });
	});

	test("accepts the complete persisted settings contract", () => {
		expect(parseFastResumeSettings({ hijackResume: false, shortcut: "alt+u" })).toEqual({
			hijackResume: false,
			shortcut: "alt+u",
		});
	});

	test("rejects malformed settings as one namespace", () => {
		expect(parseFastResumeSettings({ hijackResume: "yes" })).toBeUndefined();
		expect(parseFastResumeSettings({ hijackResume: true, shortcut: " " })).toBeUndefined();
		expect(parseFastResumeSettings({ hijackResume: true, shortcut: "not+a+key" })).toBeUndefined();
		expect(parseFastResumeSettings({})).toEqual(DEFAULT_FAST_RESUME_SETTINGS);
	});

	test("loads read-only and falls back to defaults when the namespace is absent", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-settings-"));
		const path = join(dir, "pi-stuff.json");
		try {
			const store = await Effect.runPromise(FastResumeSettingsStore.load(path));
			expect(store.get()).toEqual(DEFAULT_FAST_RESUME_SETTINGS);
			expect(existsSync(path)).toBeFalse();
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("reads only its merged namespace", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-settings-"));
		const path = join(dir, "pi-stuff.json");
		try {
			writeFileSync(
				path,
				JSON.stringify({
					ui: { schemaVersion: 3 },
					fastResume: { hijackResume: false, shortcut: "ctrl+shift+f" },
				}),
			);
			const store = await Effect.runPromise(FastResumeSettingsStore.load(path));
			expect(store.get()).toEqual({ hijackResume: false, shortcut: "ctrl+shift+f" });
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
