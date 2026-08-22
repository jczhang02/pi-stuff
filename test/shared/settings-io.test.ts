import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import {
	mergeNamespaceRecord,
	NamespacedSettingsStore,
	readNamespace,
	readSettingsFile,
	writeSettingsFile,
} from "../../packages/pi-stuff/src/shared/settings-io/index.js";
import { acquireSettingsLock, migrateLegacyNamespace } from "../../packages/pi-stuff/src/shared/settings-io/lock.js";

const roots: string[] = [];

async function dir(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-settings-io-"));
	roots.push(root);
	return root;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("readSettingsFile returns {} for a missing file", async () => {
	const path = join(await dir(), "pi-stuff.json");
	expect(await readSettingsFile(path)).toEqual({});
});

test("writeSettingsFile writes tab-indented JSON", async () => {
	const path = join(await dir(), "pi-stuff.json");
	await writeSettingsFile(path, { ui: { statusline: true } });
	const content = await readFile(path, "utf8");
	expect(content).toBe('{\n\t"ui": {\n\t\t"statusline": true\n\t}\n}\n');
});

test("settings locks refuse symlinks without changing their targets", async () => {
	const root = await dir();
	const target = join(root, "outside.txt");
	const lockPath = join(root, "pi-stuff.json.lock");
	await Bun.write(target, "preserve me\n");
	await symlink(target, lockPath);

	await expect(acquireSettingsLock(lockPath, "test settings")).rejects.toThrow();
	expect(await readFile(target, "utf8")).toBe("preserve me\n");
});

test("mergeNamespaceRecord preserves sibling namespaces", async () => {
	const path = join(await dir(), "pi-stuff.json");
	await writeSettingsFile(path, { ui: { statusline: true }, tools: { liveElapsed: false } });
	const merged = await mergeNamespaceRecord(path, "ui", { statusline: false });
	expect(merged).toEqual({ ui: { statusline: false }, tools: { liveElapsed: false } });
	expect(await readSettingsFile(path)).toEqual({ ui: { statusline: false }, tools: { liveElapsed: false } });
});

test("readNamespace returns undefined for a missing namespace", async () => {
	const path = join(await dir(), "pi-stuff.json");
	await writeSettingsFile(path, { ui: { statusline: true } });
	expect(await readNamespace(path, "ui")).toEqual({ statusline: true });
	expect(await readNamespace(path, "tools")).toBeUndefined();
});

test("readNamespace rejects a malformed namespace", async () => {
	const path = join(await dir(), "pi-stuff.json");
	await writeSettingsFile(path, { codeMode: true });
	await expect(readNamespace(path, "codeMode")).rejects.toThrow("is not a JSON object");
});

const TEST_SETTINGS_SCHEMA = Type.Object({ count: Type.Number(), enabled: Type.Boolean() });
type TestSettings = Static<typeof TEST_SETTINGS_SCHEMA>;

function normalize<Value>(value: Value): TestSettings {
	if (!Check(TEST_SETTINGS_SCHEMA, value)) throw new Error("expected enabled boolean and count number");
	return value;
}

test("NamespacedSettingsStore loads defaults when the namespace is absent", async () => {
	const path = join(await dir(), "pi-stuff.json");
	const store = await NamespacedSettingsStore.load<TestSettings>("codex", { enabled: false, count: 0 }, normalize, {
		path,
	});
	expect(store.get()).toEqual({ enabled: false, count: 0 });
});

test("NamespacedSettingsStore update persists under the whole-file lock and preserves siblings", async () => {
	const path = join(await dir(), "pi-stuff.json");
	await writeSettingsFile(path, { ui: { statusline: true } });
	const store = await NamespacedSettingsStore.load<TestSettings>("codex", { enabled: false, count: 0 }, normalize, {
		path,
	});
	await store.update({ enabled: true });
	expect(store.get()).toEqual({ enabled: true, count: 0 });
	expect(await readNamespace(path, "codex")).toEqual({ enabled: true, count: 0 });
	// Sibling namespace survives the locked write.
	expect(await readNamespace(path, "ui")).toEqual({ statusline: true });
});

test("NamespacedSettingsStore replace writes the whole namespace wholesale", async () => {
	const path = join(await dir(), "pi-stuff.json");
	const store = await NamespacedSettingsStore.load<TestSettings>("codex", { enabled: false, count: 0 }, normalize, {
		path,
	});
	await store.replace({ enabled: true, count: 7 });
	expect(await readNamespace(path, "codex")).toEqual({ enabled: true, count: 7 });
});

test("NamespacedSettingsStore replace repairs an invalid namespace and preserves siblings", async () => {
	const path = join(await dir(), "pi-stuff.json");
	await writeSettingsFile(path, { codex: { enabled: false, count: 0 }, ui: { statusline: true } });
	const store = await NamespacedSettingsStore.load<TestSettings>("codex", { enabled: false, count: 0 }, normalize, {
		path,
	});
	await writeSettingsFile(path, { codex: { enabled: "invalid" }, ui: { statusline: true } });
	await store.replace({ enabled: true, count: 7 });
	expect(store.get()).toEqual({ enabled: true, count: 7 });
	expect(await readSettingsFile(path)).toEqual({
		codex: { enabled: true, count: 7 },
		ui: { statusline: true },
	});
});

test("NamespacedSettingsStore migrates a legacy file into the namespace on first load", async () => {
	const root = await dir();
	const mergedPath = join(root, "pi-stuff.json");
	const legacyPath = join(root, "pi-stuff-codex.json");
	await Bun.write(legacyPath, JSON.stringify({ fast: true }));
	const store = await NamespacedSettingsStore.load<TestSettings>("codex", { enabled: false, count: 0 }, normalize, {
		path: mergedPath,
		legacyPath,
		migrator: async (source) => {
			const raw = JSON.parse(await readFile(source, "utf8"));
			return { enabled: raw["fast"] === true, count: 1 };
		},
	});
	expect(store.get()).toEqual({ enabled: true, count: 1 });
	expect(await readNamespace(mergedPath, "codex")).toEqual({ enabled: true, count: 1 });
	// The legacy file is lifted once and removed; no `.bak` is retained.
	expect(await fileExists(legacyPath)).toBe(false);
});

test("NamespacedSettingsStore keeps the merged namespace authoritative over stale legacy settings", async () => {
	const root = await dir();
	const mergedPath = join(root, "pi-stuff.json");
	const legacyPath = join(root, "pi-stuff-codex.json");
	await writeSettingsFile(mergedPath, { codex: { enabled: false, count: 7 } });
	await Bun.write(legacyPath, JSON.stringify({ fast: true }));
	const store = await NamespacedSettingsStore.load<TestSettings>("codex", { enabled: false, count: 0 }, normalize, {
		path: mergedPath,
		legacyPath,
		migrator: async () => ({ enabled: true, count: 1 }),
	});
	expect(store.get()).toEqual({ enabled: false, count: 7 });
	expect(await fileExists(legacyPath)).toBe(false);
});

test("migrateLegacyNamespace preserves siblings and removes the legacy file", async () => {
	const root = await dir();
	const mergedPath = join(root, "pi-stuff.json");
	const legacyPath = join(root, "pi-stuff-tools.json");
	await writeSettingsFile(mergedPath, { ui: { statusline: true } });
	await Bun.write(legacyPath, "{}\n");
	expect(
		await migrateLegacyNamespace(mergedPath, "tools", legacyPath, { liveElapsed: false, schemaVersion: 1 }, "test"),
	).toBe(true);
	expect(await readSettingsFile(mergedPath)).toEqual({
		ui: { statusline: true },
		tools: { liveElapsed: false, schemaVersion: 1 },
	});
	expect(await fileExists(legacyPath)).toBe(false);
});

test("migrateLegacyNamespace preserves legacy data when the canonical namespace is invalid", async () => {
	const root = await dir();
	const mergedPath = join(root, "pi-stuff.json");
	const legacyPath = join(root, "pi-stuff-tools.json");
	await writeSettingsFile(mergedPath, { tools: { schemaVersion: 99 } });
	await Bun.write(legacyPath, "{}\n");
	expect(
		await migrateLegacyNamespace(
			mergedPath,
			"tools",
			legacyPath,
			{ liveElapsed: false, schemaVersion: 1 },
			"test",
			() => false,
		),
	).toBe(false);
	expect(await fileExists(legacyPath)).toBe(true);
});

test("NamespacedSettingsStore memory store does not touch disk", async () => {
	const store = NamespacedSettingsStore.memory<TestSettings>({ enabled: false, count: 0 });
	await store.update({ enabled: true });
	expect(store.get()).toEqual({ enabled: true, count: 0 });
});

test("NamespacedSettingsStore subscribers receive updated values", async () => {
	const path = join(await dir(), "pi-stuff.json");
	const store = await NamespacedSettingsStore.load<TestSettings>("codex", { enabled: false, count: 0 }, normalize, {
		path,
	});
	const seen: TestSettings[] = [];
	store.subscribe((value) => seen.push(value));
	await store.update({ enabled: true });
	expect(seen).toEqual([{ enabled: true, count: 0 }]);
});
