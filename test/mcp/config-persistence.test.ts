import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensureCompatibilityImports,
	writeProjectServerDisabledOverride,
	writeProjectServerLifecycleOverride,
	writeSharedServerEntry,
	writeStarterProjectConfig,
} from "../../packages/pi-stuff/src/mcp/runtime/config.js";

test("keeps server state writes project-local when a custom global config is loaded", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const customPath = join(cwd, "custom-global.json");
	const projectPath = join(cwd, ".pi/mcp.json");
	const customDocument = { mcpServers: { docs: { command: "docs-mcp", disabled: true } } };
	try {
		await writeFile(customPath, `${JSON.stringify(customDocument)}\n`);
		const result = await writeProjectServerDisabledOverride(customPath, cwd, "docs", false);
		expect(result).toEqual({ changed: true, path: projectPath });
		expect(JSON.parse(await readFile(customPath, "utf8"))).toEqual(customDocument);
		expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual({
			mcpServers: { docs: { disabled: false } },
		});
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("persists a server connection policy in the project MCP override", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const path = join(cwd, ".pi/mcp.json");
	try {
		await mkdir(join(cwd, ".pi"));
		await writeFile(path, '{"mcpServers":{"docs":{"disabled":false}},"settings":{"toolPrefix":"server"}}\n');
		expect((await writeProjectServerLifecycleOverride(cwd, "docs", "keep-alive")).changed).toBe(true);
		expect((await writeProjectServerLifecycleOverride(cwd, "docs", "keep-alive")).changed).toBe(false);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			mcpServers: { docs: { disabled: false, lifecycle: "keep-alive" } },
			settings: { toolPrefix: "server" },
		});
		expect((await writeProjectServerLifecycleOverride(cwd, "docs", "lazy")).changed).toBe(true);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			mcpServers: { docs: { disabled: false, lifecycle: "lazy" } },
			settings: { toolPrefix: "server" },
		});
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("creates the first project override and preserves special server names", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const path = join(cwd, ".pi/mcp.json");
	try {
		expect((await writeProjectServerLifecycleOverride(cwd, "docs", "keep-alive")).changed).toBe(true);
		expect((await writeProjectServerLifecycleOverride(cwd, "__proto__", "keep-alive")).changed).toBe(true);
		expect((await writeProjectServerLifecycleOverride(cwd, "toString", "lazy")).changed).toBe(true);
		const document = JSON.parse(await readFile(path, "utf8")) as { mcpServers: Record<string, unknown> };
		expect(Object.hasOwn(document.mcpServers, "docs")).toBe(true);
		expect(Object.hasOwn(document.mcpServers, "__proto__")).toBe(true);
		expect(Object.hasOwn(document.mcpServers, "toString")).toBe(true);
		expect(Reflect.get(document.mcpServers, "__proto__")).toEqual({ lifecycle: "keep-alive" });
		expect(Reflect.get(document.mcpServers, "toString")).toEqual({ lifecycle: "lazy" });
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("preserves a project override symlink", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const path = join(cwd, ".pi/mcp.json");
	const target = join(cwd, "shared-mcp.json");
	try {
		await mkdir(join(cwd, ".pi"));
		await writeFile(target, '{"mcpServers":{}}\n');
		await symlink(target, path);
		expect((await writeProjectServerLifecycleOverride(cwd, "docs", "keep-alive")).changed).toBe(true);
		expect((await lstat(path)).isSymbolicLink()).toBe(true);
		expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
			mcpServers: { docs: { lifecycle: "keep-alive" } },
		});
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("merges concurrent server additions without losing either entry", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const path = join(cwd, ".mcp.json");
	try {
		await Promise.all([
			writeSharedServerEntry(path, "docs", { url: "https://docs.example/mcp" }),
			writeSharedServerEntry(path, "browser", { command: "browser-mcp" }),
		]);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			mcpServers: {
				browser: { command: "browser-mcp" },
				docs: { url: "https://docs.example/mcp" },
			},
		});
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("starter setup never replaces a config created after its preview", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const path = join(cwd, ".mcp.json");
	try {
		await writeFile(path, '{"mcpServers":{"docs":{"url":"https://docs.example/mcp"}}}\n');
		await expect(writeStarterProjectConfig(cwd)).rejects.toThrow("Refusing to replace existing MCP config");
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			mcpServers: { docs: { url: "https://docs.example/mcp" } },
		});
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("refuses to overwrite a malformed project MCP override", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const path = join(cwd, ".pi/mcp.json");
	try {
		await mkdir(join(cwd, ".pi"));
		await writeFile(path, "not json\n");
		await expect(writeProjectServerLifecycleOverride(cwd, "docs", "keep-alive")).rejects.toThrow(
			"Failed to read project MCP override",
		);
		expect(await readFile(path, "utf8")).toBe("not json\n");
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("refuses to overwrite malformed shared MCP configuration", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-config-"));
	const sharedPath = join(cwd, ".mcp.json");
	const piPath = join(cwd, "mcp.json");
	try {
		await writeFile(sharedPath, "not json\n");
		await expect(writeSharedServerEntry(sharedPath, "docs", { command: "docs-mcp" })).rejects.toThrow(
			"Failed to read MCP config",
		);
		expect(await readFile(sharedPath, "utf8")).toBe("not json\n");
		await writeFile(sharedPath, '{"mcpServers":[]}\n');
		await expect(writeSharedServerEntry(sharedPath, "docs", { command: "docs-mcp" })).rejects.toThrow(
			"mcpServers must be an object",
		);
		expect(await readFile(sharedPath, "utf8")).toBe('{"mcpServers":[]}\n');

		await writeFile(piPath, "[]\n");
		await expect(ensureCompatibilityImports(["cursor"], piPath)).rejects.toThrow("Failed to read MCP config");
		expect(await readFile(piPath, "utf8")).toBe("[]\n");
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});
