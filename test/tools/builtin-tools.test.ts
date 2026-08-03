import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BashToolOptions,
	createBashToolDefinition,
	createReadToolDefinition,
	type ExtensionAPI,
	type ReadToolOptions,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerBuiltins, resolveBuiltinHostSettings } from "../../packages/pi-stuff-tools/builtin-tools.js";

test("built-in overrides receive Pi's merged image and shell settings exactly", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-builtin-settings-"));
	const agentDirectory = join(directory, "agent");
	const projectDirectory = join(directory, "project");
	mkdirSync(join(projectDirectory, ".pi"), { recursive: true });
	mkdirSync(agentDirectory, { recursive: true });
	writeFileSync(
		join(agentDirectory, "settings.json"),
		JSON.stringify({ images: { autoResize: false }, shellPath: "/bin/sh" }),
	);
	writeFileSync(
		join(projectDirectory, ".pi", "settings.json"),
		JSON.stringify({ shellCommandPrefix: "printf project-prefix;" }),
	);

	try {
		const untrusted = resolveBuiltinHostSettings(projectDirectory, false, agentDirectory);
		expect(untrusted).toEqual({
			autoResizeImages: false,
			shellCommandPrefix: undefined,
			shellPath: "/bin/sh",
		});
		const trusted = resolveBuiltinHostSettings(projectDirectory, true, agentDirectory);
		expect(trusted).toEqual({
			autoResizeImages: false,
			shellCommandPrefix: "printf project-prefix;",
			shellPath: "/bin/sh",
		});

		let readOptions: ReadToolOptions | undefined;
		let bashOptions: BashToolOptions | undefined;
		const tools = new Map<string, ToolDefinition>();
		const pi = {
			events: {},
			registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		} as unknown as ExtensionAPI;
		registerBuiltins(pi, projectDirectory, trusted, {
			bash: (cwd, options) => {
				bashOptions = options;
				return createBashToolDefinition(cwd, options);
			},
			read: (cwd, options) => {
				readOptions = options;
				return createReadToolDefinition(cwd, options);
			},
		});

		expect(readOptions).toMatchObject({ autoResizeImages: false });
		expect(bashOptions).toMatchObject({ commandPrefix: "printf project-prefix;", shellPath: "/bin/sh" });
		expect([...tools.keys()].sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
});
