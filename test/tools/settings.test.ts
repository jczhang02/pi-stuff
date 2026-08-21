import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeNamespaceRecord } from "../../packages/pi-stuff/src/shared/settings-io/index.js";
import { type ToolUiSettings, ToolUiSettingsStore } from "../../packages/pi-stuff/src/tool-display/settings.js";

interface Deferred {
	readonly promise: Promise<void>;
	resolve(): void;
}

function deferred(): Deferred {
	let resolve = (): void => {};
	const promise = new Promise<void>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

async function withTemporarySettings(run: (path: string, directory: string) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-tools-settings-"));
	try {
		await run(join(directory, "settings.json"), directory);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}

test("rapid toggles coalesce to the final in-memory and on-disk value", async () => {
	await withTemporarySettings(async (path, directory) => {
		const store = await ToolUiSettingsStore.load(path);
		const writes = Array.from({ length: 101 }, (_, index) => store.setLiveElapsed(index % 2 !== 0));

		await Promise.all(writes);

		expect(store.get()).toEqual({ liveElapsed: false, schemaVersion: 1 });
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ tools: { liveElapsed: false, schemaVersion: 1 } });
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await readdir(directory)).sort()).toEqual(["settings.json", "settings.json.lock"]);
	});
});

test("rapid toggles perform one coalesced write", async () => {
	await withTemporarySettings(async (path) => {
		const written: ToolUiSettings[] = [];
		const store = await ToolUiSettingsStore.load(path, async (_settingsPath, settings) => {
			written.push(settings);
		});

		await Promise.all(Array.from({ length: 101 }, (_, index) => store.setLiveElapsed(index % 2 !== 0)));

		expect(written).toEqual([{ liveElapsed: false, schemaVersion: 1 }]);
		expect(store.get()).toEqual({ liveElapsed: false, schemaVersion: 1 });
	});
});

test("whenIdle waits for active and subsequently queued writes before a reload", async () => {
	await withTemporarySettings(async (path) => {
		const firstStarted = deferred();
		const releaseFirst = deferred();
		const latestStarted = deferred();
		const releaseLatest = deferred();
		let writeCount = 0;
		const store = await ToolUiSettingsStore.load(path, async (settingsPath, settings) => {
			writeCount += 1;
			if (writeCount === 1) {
				firstStarted.resolve();
				await releaseFirst.promise;
			} else {
				latestStarted.resolve();
				await releaseLatest.promise;
			}
			await mergeNamespaceRecord(settingsPath, "tools", { liveElapsed: settings.liveElapsed, schemaVersion: 1 });
		});
		const first = store.setLiveElapsed(false);
		await firstStarted.promise;

		let idleSettled = false;
		const idle = store.whenIdle().then(() => {
			idleSettled = true;
		});
		const latest = store.setLiveElapsed(true);
		releaseFirst.resolve();
		await latestStarted.promise;
		expect(idleSettled).toBe(false);

		releaseLatest.resolve();
		await Promise.all([first, latest, idle]);
		const reloaded = await ToolUiSettingsStore.load(path);

		expect(writeCount).toBe(2);
		expect(idleSettled).toBe(true);
		expect(store.get()).toEqual({ liveElapsed: true, schemaVersion: 1 });
		expect(reloaded.get()).toEqual(store.get());
	});
});

test("a stale failed write does not roll back a newer value", async () => {
	await withTemporarySettings(async (path) => {
		const started = deferred();
		const release = deferred();
		let writeCount = 0;
		const store = await ToolUiSettingsStore.load(path, async () => {
			writeCount += 1;
			started.resolve();
			await release.promise;
			throw new Error("first write failed");
		});
		const first = store.setLiveElapsed(false);
		const firstError = first.then(
			() => undefined,
			(cause: unknown) => cause,
		);
		await started.promise;

		const second = store.setLiveElapsed(true);
		release.resolve();

		expect(await firstError).toBeInstanceOf(Error);
		await second;
		expect(writeCount).toBe(1);
		expect(store.get()).toEqual({ liveElapsed: true, schemaVersion: 1 });
	});
});

test("a latest failed write rolls back to the value that actually persisted", async () => {
	await withTemporarySettings(async (path) => {
		const started = deferred();
		const release = deferred();
		let persisted = true;
		let writeCount = 0;
		const store = await ToolUiSettingsStore.load(path, async (_settingsPath, settings) => {
			writeCount += 1;
			if (writeCount === 1) {
				started.resolve();
				await release.promise;
				persisted = settings.liveElapsed;
				return;
			}
			throw new Error("latest write failed");
		});
		const first = store.setLiveElapsed(false);
		await started.promise;
		const second = store.setLiveElapsed(true);
		const secondError = second.then(
			() => undefined,
			(cause: unknown) => cause,
		);

		release.resolve();
		await first;
		expect(await secondError).toBeInstanceOf(Error);
		expect(writeCount).toBe(2);
		expect(persisted).toBe(false);
		expect(store.get()).toEqual({ liveElapsed: false, schemaVersion: 1 });
	});
});
