import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebAccess, type PiWebAccessHost } from "../../packages/pi-stuff/src/web/runtime/implementation.js";
import { readWebConfig, updateWebConfig, WebConfigError } from "../../packages/pi-stuff/src/web/settings.js";

const roots: string[] = [];
const originalAgentDirectory = process.env["PI_CODING_AGENT_DIR"];

async function root(): Promise<string> {
	const value = await mkdtemp(join(tmpdir(), "pi-stuff-web-config-"));
	roots.push(value);
	return value;
}

afterEach(async () => {
	if (originalAgentDirectory === undefined) delete process.env["PI_CODING_AGENT_DIR"];
	else process.env["PI_CODING_AGENT_DIR"] = originalAgentDirectory;
	await Promise.all(roots.splice(0).map((value) => rm(value, { force: true, recursive: true })));
});

function installWeb(agentDirectory: string): string[] {
	process.env["PI_CODING_AGENT_DIR"] = agentDirectory;
	const tools: string[] = [];
	const host: PiWebAccessHost = {
		appendEntry: () => undefined,
		on: () => undefined,
		registerTool: (tool) => {
			tools.push(tool.name);
		},
	};
	createPiWebAccess()(host);
	return tools;
}

test("Web configuration stays read-only until an explicit update", async () => {
	const agentDir = await root();
	expect(readWebConfig(agentDir)).toBeUndefined();
	expect(await Bun.file(join(agentDir, "pi-stuff.json")).exists()).toBe(false);
});

test("invalid Web configuration diagnoses and installs built-in defaults", async () => {
	const agentDir = await root();
	await writeFile(join(agentDir, "pi-stuff.json"), "{");
	expect(installWeb(agentDir)).toEqual(["web_search", "fetch_content", "get_search_content"]);
});

test("Web configuration I/O failures propagate during initialization", async () => {
	const agentDir = await root();
	await mkdir(join(agentDir, "pi-stuff.json"));
	let failure: unknown;
	try {
		installWeb(agentDir);
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(Error);
	expect(failure).not.toBeInstanceOf(WebConfigError);
});

test("explicit update lifts legacy Web configuration and preserves sibling namespaces", async () => {
	const agentDir = await root();
	const legacyPath = join(agentDir, "web-search.json");
	await writeFile(legacyPath, JSON.stringify({ parallelApiKey: "op://Private/Parallel/key", provider: "parallel" }));
	expect(readWebConfig(agentDir)?.["parallelApiKey"]).toBe("op://Private/Parallel/key");
	await writeFile(join(agentDir, "pi-stuff.json"), JSON.stringify({ ui: { statusline: true } }));
	await updateWebConfig({ searchModel: "model-a" }, agentDir);
	expect(JSON.parse(await readFile(join(agentDir, "pi-stuff.json"), "utf8"))).toEqual({
		ui: { statusline: true },
		web: { parallelApiKey: "op://Private/Parallel/key", provider: "parallel", searchModel: "model-a" },
	});
	expect(await Bun.file(legacyPath).exists()).toBe(false);
});

test("canonical Web configuration wins and concurrent updates retain both fields", async () => {
	const agentDir = await root();
	await writeFile(join(agentDir, "pi-stuff.json"), JSON.stringify({ web: { provider: "brave" } }));
	await writeFile(join(agentDir, "web-search.json"), JSON.stringify({ provider: "parallel" }));
	expect(readWebConfig(agentDir)?.["provider"]).toBe("brave");
	await Promise.all([
		updateWebConfig({ recencyFilter: "month" }, agentDir),
		updateWebConfig({ searchModel: "model-a" }, agentDir),
	]);
	expect(readWebConfig(agentDir)).toEqual({
		provider: "brave",
		recencyFilter: "month",
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
