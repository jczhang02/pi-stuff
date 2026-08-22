import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "../../packages/pi-stuff/src/subagents/src/agents/agents.js";
import { buildAsyncSingleRunnerWork } from "../../packages/pi-stuff/src/subagents/src/runs/background/async-execution.js";
import {
	computeMcpServerHash,
	resolveMcpDirectToolSelections,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/mcp-direct-tool-allowlist.js";

const roots: string[] = [];
const originalAgentDir = process.env["PI_CODING_AGENT_DIR"];
const originalCacheHome = process.env["XDG_CACHE_HOME"];

function buildContext(cwd: string) {
	return {
		// SAFETY: this test double supplies the exact Pi event member exercised while building launch work.
		pi: { events: { emit() {} } } as never,
		cwd,
		currentSessionId: "parent-session",
		currentModelProvider: "provider",
		currentModel: { provider: "provider", id: "parent" },
	};
}

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

test("Agent launch fails closed when direct MCP Tools change with the execution cwd", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-cwd-"));
	roots.push(root);
	const parentCwd = join(root, "parent");
	const targetCwd = join(root, "target");
	const agentDir = join(root, "config", "pi");
	const cacheDir = join(root, "cache", "pi-stuff", "mcp");
	process.env["PI_CODING_AGENT_DIR"] = agentDir;
	process.env["XDG_CACHE_HOME"] = join(root, "cache");
	await Promise.all([
		mkdir(parentCwd, { recursive: true }),
		mkdir(targetCwd, { recursive: true }),
		mkdir(agentDir, { recursive: true }),
		mkdir(cacheDir, { recursive: true }),
	]);

	const definition = { command: "example-mcp" };
	await Bun.write(
		join(parentCwd, ".mcp.json"),
		JSON.stringify({ mcpServers: { example: definition }, settings: { toolPrefix: "server" } }),
	);
	await Bun.write(
		join(targetCwd, ".mcp.json"),
		JSON.stringify({ mcpServers: { example: definition }, settings: { toolPrefix: "none" } }),
	);
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

	const agent: AgentConfig = {
		name: "mcp-reviewer",
		description: "Reviews through MCP",
		systemPrompt: "",
		systemPromptMode: "append",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: join(parentCwd, ".pi", "agents", "mcp-reviewer.md"),
		mcpDirectTools: ["example"],
	};
	const built = buildAsyncSingleRunnerWork("mcp-cwd-drift", {
		agent: agent.name,
		task: "Review the target project",
		agentConfig: agent,
		ctx: buildContext(parentCwd),
		cwd: targetCwd,
		maxSubagentDepth: 1,
	});

	expect(built).toEqual({
		error: "Agent 'mcp-reviewer' direct MCP Tool contract changes with cwd (parent: example_echo; execution: echo).",
	});

	const unresolved = buildAsyncSingleRunnerWork("mcp-selector-missing", {
		agent: agent.name,
		task: "Review the parent project",
		agentConfig: { ...agent, mcpDirectTools: ["example/echo", "example/missing"] },
		ctx: buildContext(parentCwd),
		cwd: parentCwd,
		maxSubagentDepth: 1,
	});
	expect(unresolved).toEqual({
		error: "Agent 'mcp-reviewer' direct MCP Tool selectors do not resolve in the parent project: example/missing.",
	});
});
