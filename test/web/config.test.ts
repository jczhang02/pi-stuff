import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWebConfig, updateWebConfig } from "../../packages/pi-stuff/src/web/settings.js";

const roots: string[] = [];

async function root(): Promise<string> {
	const value = await mkdtemp(join(tmpdir(), "pi-stuff-web-config-"));
	roots.push(value);
	return value;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((value) => rm(value, { force: true, recursive: true })));
});

test("Web configuration stays read-only until an explicit update", async () => {
	const agentDir = await root();
	expect(readWebConfig(agentDir)).toBeUndefined();
	expect(await Bun.file(join(agentDir, "pi-stuff.json")).exists()).toBe(false);
});

test("explicit update lifts legacy Web configuration and preserves sibling namespaces", async () => {
	const agentDir = await root();
	const legacyPath = join(agentDir, "web-search.json");
	await writeFile(legacyPath, JSON.stringify({ parallelApiKey: "op://Private/Parallel/key", provider: "parallel" }));
	expect(readWebConfig(agentDir)?.["parallelApiKey"]).toBe("op://Private/Parallel/key");
	await writeFile(join(agentDir, "pi-stuff.json"), JSON.stringify({ ui: { statusline: true } }));
	await updateWebConfig({ workflow: "none" }, agentDir);
	expect(JSON.parse(await readFile(join(agentDir, "pi-stuff.json"), "utf8"))).toEqual({
		ui: { statusline: true },
		web: { parallelApiKey: "op://Private/Parallel/key", provider: "parallel", workflow: "none" },
	});
	expect(await Bun.file(legacyPath).exists()).toBe(false);
});

test("canonical Web configuration wins and concurrent updates retain both fields", async () => {
	const agentDir = await root();
	await writeFile(join(agentDir, "pi-stuff.json"), JSON.stringify({ web: { provider: "brave" } }));
	await writeFile(join(agentDir, "web-search.json"), JSON.stringify({ provider: "parallel" }));
	expect(readWebConfig(agentDir)?.["provider"]).toBe("brave");
	await Promise.all([
		updateWebConfig({ workflow: "summary-review" }, agentDir),
		updateWebConfig({ searchModel: "model-a" }, agentDir),
	]);
	expect(readWebConfig(agentDir)).toEqual({
		provider: "brave",
		workflow: "summary-review",
		searchModel: "model-a",
	});
	expect(await Bun.file(join(agentDir, "web-search.json")).exists()).toBe(false);
});

test("invalid canonical Web configuration never deletes legacy credentials", async () => {
	const agentDir = await root();
	await writeFile(join(agentDir, "pi-stuff.json"), JSON.stringify({ web: false }));
	await writeFile(join(agentDir, "web-search.json"), JSON.stringify({ parallelApiKey: "secret" }));
	await expect(updateWebConfig({ provider: "parallel" }, agentDir)).rejects.toThrow('"web" must be a JSON object');
	expect(await Bun.file(join(agentDir, "web-search.json")).exists()).toBe(true);
});

test("an interrupted legacy migration remains readable and resumes on the next explicit update", async () => {
	const agentDir = await root();
	const stagedPath = join(agentDir, "web-search.json.migrating");
	await writeFile(stagedPath, JSON.stringify({ provider: "parallel", parallelApiKey: "op://Private/key" }));
	expect(readWebConfig(agentDir)?.["provider"]).toBe("parallel");

	await updateWebConfig({ workflow: "none" }, agentDir);
	expect(readWebConfig(agentDir)).toEqual({
		provider: "parallel",
		parallelApiKey: "op://Private/key",
		workflow: "none",
	});
	expect(await Bun.file(stagedPath).exists()).toBe(false);
});
