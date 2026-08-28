import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_NOTIFICATION_SETTINGS,
	NotificationSettingsStore,
} from "../../packages/pi-stuff/src/notification/settings.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

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
		schemaVersion: 3,
		terminalBell: false,
		tmuxNotification: true,
	});
	await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

	await store.update({ enabled: false });
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ notification: { ...store.get(), enabled: false } });
	expect((await stat(path)).mode & 0o777).toBe(0o600);
	expect((await stat(`${path}.lock`)).mode & 0o777).toBe(0o600);
});

test("schema 2 settings gain tmux notifications without a startup write", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
	roots.push(root);
	const path = join(root, "notification.json");
	const versionTwo = {
		completionAlerts: true,
		delivery: "osc777" as const,
		enabled: true,
		failureAlerts: true,
		gracePeriodMs: 2_000,
		minimumDurationMs: 10_000,
		responsePreview: false,
		schemaVersion: 2,
		terminalBell: false,
	};
	await writeFile(path, `${JSON.stringify({ notification: versionTwo })}\n`);

	const store = await NotificationSettingsStore.load(path);

	expect(store.get()).toEqual({ ...versionTwo, schemaVersion: 3, tmuxNotification: true });
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ notification: versionTwo });
	await store.update({ tmuxNotification: false });
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ notification: store.get() });
});

test("two failed queued updates restore the last durable settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
	roots.push(root);
	const path = join(root, "notification.json");
	let writes = 0;
	let releaseFirstWrite: (() => void) | undefined;
	let reportFirstWriteStarted: (() => void) | undefined;
	const firstWriteStarted = new Promise<void>((resolve) => {
		reportFirstWriteStarted = resolve;
	});
	const firstWriteRelease = new Promise<void>((resolve) => {
		releaseFirstWrite = resolve;
	});
	const store = await NotificationSettingsStore.load(path, async () => {
		writes += 1;
		if (writes === 1) {
			reportFirstWriteStarted?.();
			await firstWriteRelease;
		}
		throw new Error(`settings write ${String(writes)} failed`);
	});

	const first = store.update({ enabled: false });
	await firstWriteStarted;
	const second = store.update({ terminalBell: true });
	releaseFirstWrite?.();
	const results = await Promise.allSettled([first, second]);

	expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
	expect(writes).toBe(2);
	expect(store.get()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
	await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("independent stores apply patches to the latest durable settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
	roots.push(root);
	const path = join(root, "notification.json");
	const first = await NotificationSettingsStore.load(path);
	const second = await NotificationSettingsStore.load(path);

	await Promise.all([first.update({ enabled: false }), second.update({ terminalBell: true })]);

	expect((await NotificationSettingsStore.load(path)).get()).toEqual({
		...DEFAULT_NOTIFICATION_SETTINGS,
		enabled: false,
		terminalBell: true,
	});
});

test("overlapping updates to one field retain the latest requested value", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
	roots.push(root);
	const path = join(root, "notification.json");
	const store = await NotificationSettingsStore.load(path);

	await Promise.all([store.update({ enabled: false }), store.update({ enabled: true })]);

	expect(store.get()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
	expect((await NotificationSettingsStore.load(path)).get()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
});

test("unchanged updates do not write or notify", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
	roots.push(root);
	const path = join(root, "notification.json");
	const store = await NotificationSettingsStore.load(path);
	const seen: boolean[] = [];
	store.subscribe((settings) => seen.push(settings.enabled));

	await store.update({ enabled: true });

	expect(seen).toEqual([]);
	await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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
	await writeFile(path, `${JSON.stringify({ notification: legacy })}\n`);

	const store = await NotificationSettingsStore.load(path);

	expect(store.get()).toEqual({
		completionAlerts: true,
		delivery: "osc9",
		enabled: true,
		failureAlerts: true,
		gracePeriodMs: 2_000,
		minimumDurationMs: 10_000,
		responsePreview: false,
		schemaVersion: 3,
		terminalBell: true,
		tmuxNotification: true,
	});
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ notification: legacy });

	await store.update({ responsePreview: true });
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
		notification: { ...store.get(), responsePreview: true },
	});
});

test("the legacy Notification file is consolidated once", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-notification-settings-"));
	roots.push(root);
	const path = join(root, "pi-stuff.json");
	const legacyPath = join(root, "pi-stuff-notification.json");
	await writeFile(legacyPath, `${JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS)}\n`);

	const store = await NotificationSettingsStore.load(path);

	expect(store.get()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
		notification: DEFAULT_NOTIFICATION_SETTINGS,
	});
	await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});
