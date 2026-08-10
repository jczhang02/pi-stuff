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
import {
	registerBuiltins,
	resolveBuiltinHostSettings,
} from "../../packages/pi-stuff/src/tool-display/builtin-tools.js";
import { getToolUiRuntime } from "../../packages/pi-stuff/src/tool-display/contract.js";

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

test("shell prefixes do not leak raw commands or break complete activity grouping", () => {
	const tools = new Map<string, ToolDefinition>();
	const pi = {
		events: {},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
	} as unknown as ExtensionAPI;
	registerBuiltins(pi, "/project", {
		autoResizeImages: true,
		shellCommandPrefix: "printf prefix",
		shellPath: undefined,
	});
	const runtime = getToolUiRuntime(pi);
	runtime.indexMessages([
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "bash-prefix-1", name: "bash", arguments: { command: "pwd" } },
				{ type: "toolCall", id: "bash-prefix-2", name: "bash", arguments: { command: "pwd" } },
			],
		},
		{ role: "toolResult", toolCallId: "bash-prefix-1", content: [{ type: "text", text: "/project" }] },
		{ role: "toolResult", toolCallId: "bash-prefix-2", content: [{ type: "text", text: "/project" }] },
	]);
	const bash = tools.get("bash");
	if (!bash?.renderCall || !bash.renderResult) throw new Error("Expected decorated Bash renderers");
	const theme = { bold: (value: string) => value, fg: (_color: string, value: string) => value } as never;
	const settle = (toolCallId: string) => {
		const state = {};
		const args = { command: "pwd" };
		const context = {
			args,
			executionStarted: false,
			invalidate: () => {},
			isError: false,
			lastComponent: undefined,
			state,
			toolCallId,
		} as never;
		const row = bash.renderCall?.(args, theme, context);
		bash.renderResult?.(
			{ content: [{ type: "text", text: "/project\n" }], details: undefined },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);
		return row?.render(80).join("\n") ?? "";
	};
	const first = settle("bash-prefix-1");
	expect(first).toContain("Ran 2 commands");
	expect(first).not.toContain("pwd");
	expect(settle("bash-prefix-2")).toBe("");
	runtime.clear();
});
