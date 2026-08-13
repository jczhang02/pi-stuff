import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationSettingsStore } from "../../packages/pi-stuff/src/notification/settings.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("NotificationSettingsStore", () => {
	test("defaults stay in memory until a user changes a setting", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
		roots.push(root);
		const path = join(root, "notification.json");
		const store = await NotificationSettingsStore.load(path);

		expect(store.get()).toEqual({
			completionAlerts: true,
			delivery: "auto",
			enabled: true,
			failureAlerts: true,
			gracePeriodMs: 2_000,
			minimumDurationMs: 10_000,
			responsePreview: false,
			schemaVersion: 2,
			terminalBell: false,
		});
		await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

		await store.update({ enabled: false });
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...store.get(), enabled: false });
	});

	test("legacy sound settings migrate in memory and persist only after direct input", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
		roots.push(root);
		const path = join(root, "notification.json");
		const legacy = {
			completionAlerts: true,
			delivery: "osc9",
			enabled: true,
			failureAlerts: true,
			gracePeriodMs: 2_000,
			minimumDurationMs: 10_000,
			schemaVersion: 1,
			sound: true,
		};
		await writeFile(path, `${JSON.stringify(legacy)}\n`);

		const store = await NotificationSettingsStore.load(path);

		expect(store.get()).toEqual({
			completionAlerts: true,
			delivery: "osc9",
			enabled: true,
			failureAlerts: true,
			gracePeriodMs: 2_000,
			minimumDurationMs: 10_000,
			responsePreview: false,
			schemaVersion: 2,
			terminalBell: true,
		});
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual(legacy);

		await store.update({ responsePreview: true });
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...store.get(), responsePreview: true });
	});
});
