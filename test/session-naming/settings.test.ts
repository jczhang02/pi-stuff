import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiagnosticProcessState } from "../../packages/pi-stuff/src/conversation-ui/diagnostics.js";
import {
	DEFAULT_SESSION_NAMING_SETTINGS,
	loadSessionNamingSettings,
	parseSessionNamingSettings,
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

		expect(await loadSessionNamingSettings(path)).toBe(DEFAULT_SESSION_NAMING_SETTINGS);
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

	test("falls back as one namespace when merged settings are malformed", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-session-naming-settings-"));
		roots.push(root);
		const path = join(root, "pi-stuff.json");
		await writeFile(path, '{"sessionNaming":{"schemaVersion":1,"enabled":"yes"}}\n');

		expect(await loadSessionNamingSettings(path)).toBe(DEFAULT_SESSION_NAMING_SETTINGS);
		expect(await Bun.file(path).text()).toContain('"enabled":"yes"');
	});
});
