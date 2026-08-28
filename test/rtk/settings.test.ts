import { afterEach, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RtkSettingsStore } from "../../packages/pi-stuff/src/rtk/settings.js";
import { writeSettingsFile } from "../../packages/pi-stuff/src/shared/settings-io/index.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("RTK settings discard unknown persisted keys", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-rtk-settings-"));
	roots.push(root);
	const path = join(root, "pi-stuff.json");
	await writeSettingsFile(path, {
		rtk: { outputProjection: false, rewriteCommands: true, schemaVersion: 1, future: "ignored" },
	});

	expect((await RtkSettingsStore.load(path)).get()).toEqual({
		outputProjection: false,
		rewriteCommands: true,
		schemaVersion: 1,
	});
});

test("RTK startup reads legacy settings without migrating them", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-rtk-settings-"));
	roots.push(root);
	const path = join(root, "pi-stuff.json");
	const legacyPath = join(root, "pi-stuff-rtk.json");
	const legacy = { outputProjection: false, rewriteCommands: false, schemaVersion: 1 } as const;
	await writeFile(legacyPath, JSON.stringify(legacy));

	expect((await RtkSettingsStore.load(path)).get()).toEqual(legacy);
	await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
	expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual(legacy);
});
