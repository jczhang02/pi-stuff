import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiagnosticProcessState } from "../../packages/pi-stuff/src/conversation-ui/diagnostics.js";
import {
	DEFAULT_SESSION_NAMING_SETTINGS,
	loadSessionNamingSettings,
	parseSessionNamingSettings,
	SessionNamingSettingsStore,
} from "../../packages/pi-stuff/src/session-naming/settings.js";

const roots: string[] = [];

afterEach(async () => {
	resetDiagnosticProcessState();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Session Naming settings", () => {
	test("loads defaults without creating the merged settings file", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-session-naming-settings-"));
		roots.push(root);
		const path = join(root, "pi-stuff.json");

		expect(await loadSessionNamingSettings(path)).toEqual(DEFAULT_SESSION_NAMING_SETTINGS);
		expect(await Bun.file(path).exists()).toBe(false);
	});

	test("parses explicit model order and manual-name policy", () => {
		expect(
			parseSessionNamingSettings({
				schemaVersion: 1,
				enabled: true,
				cooldownMinutes: 30,
				respectManualName: true,
				model: "fixture/primary",
				fallbackModels: ["fixture/backup"],
			}),
		).toEqual({
			schemaVersion: 1,
			enabled: true,
			cooldownMinutes: 30,
			respectManualName: true,
			model: "fixture/primary",
			fallbackModels: ["fixture/backup"],
		});
	});

	test("persists concurrent Dialog changes without clobbering advanced settings or siblings", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-session-naming-settings-"));
		roots.push(root);
		const path = join(root, "pi-stuff.json");
		await writeFile(
			path,
			JSON.stringify({
				ui: { statusline: true },
				sessionNaming: {
					...DEFAULT_SESSION_NAMING_SETTINGS,
					model: "fixture/primary",
					fallbackModels: ["fixture/backup"],
				},
			}),
		);
		const store = await SessionNamingSettingsStore.load(path);
		const observed: boolean[] = [];
		const unsubscribe = store.subscribe((settings) => observed.push(settings.enabled));

		await Promise.all([
			store.update({ enabled: false }),
			store.update({ cooldownMinutes: 30 }),
			store.update({ respectManualName: true }),
		]);
		unsubscribe();
		const persisted = JSON.parse(await Bun.file(path).text());

		expect(store.get()).toEqual({
			...DEFAULT_SESSION_NAMING_SETTINGS,
			enabled: false,
			cooldownMinutes: 30,
			respectManualName: true,
			model: "fixture/primary",
			fallbackModels: ["fixture/backup"],
		});
		expect(observed).toEqual([false, false, false]);
		expect(persisted.ui).toEqual({ statusline: true });
		expect(persisted.sessionNaming.model).toBe("fixture/primary");
		expect(persisted.sessionNaming.fallbackModels).toEqual(["fixture/backup"]);
	});

	test("falls back as one namespace when merged settings are malformed", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-session-naming-settings-"));
		roots.push(root);
		const path = join(root, "pi-stuff.json");
		const invalid = '{"sessionNaming":{"schemaVersion":1,"enabled":"yes"}}\n';
		await writeFile(path, invalid);
		const store = await SessionNamingSettingsStore.load(path);

		expect(store.get()).toEqual(DEFAULT_SESSION_NAMING_SETTINGS);
		await expect(store.update({ enabled: false })).rejects.toThrow("valid Session Naming settings");
		expect(await Bun.file(path).text()).toBe(invalid);
	});
});
