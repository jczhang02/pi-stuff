import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	computeMcpServerHash,
	resolveMcpDirectToolSelections,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/mcp-direct-tool-allowlist.js";

const roots: string[] = [];
const originalAgentDir = process.env["PI_CODING_AGENT_DIR"];
const originalCacheHome = process.env["XDG_CACHE_HOME"];

afterEach(async () => {
	if (originalAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
	else process.env["PI_CODING_AGENT_DIR"] = originalAgentDir;
	if (originalCacheHome === undefined) delete process.env["XDG_CACHE_HOME"];
	else process.env["XDG_CACHE_HOME"] = originalCacheHome;
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("Agent direct MCP tools read metadata from the XDG cache", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-xdg-"));
	roots.push(root);
	const agentDir = join(root, "config", "pi");
	const cacheDir = join(root, "cache", "pi-stuff", "mcp");
	process.env["PI_CODING_AGENT_DIR"] = agentDir;
	process.env["XDG_CACHE_HOME"] = join(root, "cache");
	await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(cacheDir, { recursive: true })]);

	const definition = { command: "example-mcp" };
	await Bun.write(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { example: definition } }));
	await Bun.write(
		join(cacheDir, "mcp-cache.json"),
		JSON.stringify({
			version: 1,
			servers: {
				example: {
					cachedAt: Date.now(),
					configHash: computeMcpServerHash(definition),
					tools: [{ name: "echo" }],
				},
			},
		}),
	);

	expect(resolveMcpDirectToolSelections(["example"], root)).toEqual([
		{ name: "example_echo", selector: "example/echo" },
	]);
});
