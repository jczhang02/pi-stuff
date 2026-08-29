import { expect, test } from "bun:test";
import type { AgentToolResult, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerWorkTools } from "../../packages/pi-stuff/src/background-work/src/tools.js";
import { registerCodexTools } from "../../packages/pi-stuff/src/codex/tools.js";
import { sanitizeMultilineTerminalText } from "../../packages/pi-stuff/src/shared/terminal-text.js";
import type { ToolArguments } from "../../packages/pi-stuff/src/tool-display/activity.js";
import { registerBuiltins } from "../../packages/pi-stuff/src/tool-display/builtin-tools.js";
import { getToolUiRuntime, type ToolUiRuntime } from "../../packages/pi-stuff/src/tool-display/contract.js";
import { toolRegistrationHarness } from "../fixtures/tool-registration-host.js";

// SAFETY: this deterministic fixture implements the exact Theme members exercised by Tool rows.
const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as Theme;

interface RenderOptions {
	readonly expanded?: boolean;
	readonly isError?: boolean;
}

function renderSettled(
	tool: ToolDefinition,
	runtime: ToolUiRuntime,
	id: string,
	args: ToolArguments,
	result: AgentToolResult<unknown>,
	options: RenderOptions = {},
): string[] {
	const resultMessage = { role: "toolResult", toolCallId: id, ...result };
	if (options.isError === true) Object.assign(resultMessage, { isError: true });
	runtime.resetProjection([
		{ role: "assistant", content: [{ type: "toolCall", id, name: tool.name, arguments: args }] },
		resultMessage,
	]);
	const state = {};
	const context = {
		args,
		argsComplete: true,
		cwd: "/project",
		executionStarted: false,
		expanded: options.expanded === true,
		invalidate: () => undefined,
		isError: options.isError === true,
		isPartial: false,
		lastComponent: undefined,
		showImages: true,
		state,
		toolCallId: id,
	};
	// SAFETY: the Tool owns this schema-validated fixture and the test supplies every renderer context member it reads.
	const component = tool.renderCall?.(args, theme, context as never);
	if (!component) throw new Error(`missing ${tool.name} call renderer`);
	// SAFETY: the result fixture follows the registered Tool's public result contract.
	tool.renderResult?.(result as never, { expanded: options.expanded === true, isPartial: false }, theme, {
		...context,
		lastComponent: component,
	} as never);
	return component.render(120);
}

function renderRunning(tool: ToolDefinition, runtime: ToolUiRuntime, id: string, args: ToolArguments): string {
	runtime.resetProjection([
		{ role: "assistant", content: [{ type: "toolCall", id, name: tool.name, arguments: args }] },
	]);
	const context = {
		args,
		argsComplete: true,
		cwd: "/project",
		executionStarted: true,
		expanded: false,
		invalidate: () => undefined,
		isError: false,
		isPartial: true,
		lastComponent: undefined,
		showImages: true,
		state: {},
		toolCallId: id,
	};
	// SAFETY: the Tool owns this schema-validated fixture and the test supplies every renderer context member it reads.
	const component = tool.renderCall?.(args, theme, context as never);
	if (!component) throw new Error(`missing ${tool.name} call renderer`);
	return component.render(120).join("\n");
}

function builtins() {
	const registration = toolRegistrationHarness();
	registerBuiltins(
		registration.host,
		"/project",
		{ autoResizeImages: true, shellCommandPrefix: undefined, shellPath: undefined },
		{},
		new Set(["write", "edit"]),
	);
	return { ...registration, runtime: getToolUiRuntime(registration.host) };
}

test("Write shows result-authorized final content with compact and expanded bounds", () => {
	const { runtime, tools } = builtins();
	const write = tools.get("write");
	if (!write) throw new Error("missing Write Tool");
	const content = Array.from({ length: 12 }, (_, index) =>
		index === 1 ? "" : `const value${String(index + 1)} = ${String(index + 1)};`,
	).join("\n");
	const result = {
		content: [{ type: "text" as const, text: "Successfully wrote 222 bytes to src/demo.ts" }],
		details: undefined,
	};
	const compact = renderSettled(write, runtime, "write-1", { content, path: "src/demo.ts" }, result).join("\n");
	expect(compact).toContain("Write(src/demo.ts)");
	expect(compact).toContain("12 lines written");
	expect(compact).toContain("2 │ ");
	expect(compact).toContain("… +2 lines (ctrl+o to expand)");
	expect(compact).not.toContain("Successfully wrote");

	const expanded = sanitizeMultilineTerminalText(
		renderSettled(write, runtime, "write-2", { content, path: "src/demo.ts" }, result, {
			expanded: true,
		}).join("\n"),
	);
	expect(expanded).toContain("12 │ const value12 = 12;");
	expect(expanded).not.toContain("ctrl+o to expand");
});

test("Edit shows verified exact statistics and old/new line gutters", () => {
	const { runtime, tools } = builtins();
	const edit = tools.get("edit");
	if (!edit) throw new Error("missing Edit Tool");
	const patch = [
		"--- a/src/demo.ts",
		"+++ b/src/demo.ts",
		"@@ -1,3 +1,4 @@",
		" const before = true;",
		"-const oldValue = 1;",
		"+const newValue = 2;",
		"+const extra = 3;",
		" export {};",
	].join("\n");
	const output = sanitizeMultilineTerminalText(
		renderSettled(
			edit,
			runtime,
			"edit-1",
			{ edits: [{ oldText: "old", newText: "new" }], path: "src/demo.ts" },
			{
				content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/demo.ts." }],
				details: { diff: "", patch },
			},
		).join("\n"),
	);
	expect(output).toContain("Edit(src/demo.ts)");
	expect(output).toContain("+2/-1");
	expect(output).toMatch(/2\s+│ - const oldValue/u);
	expect(output).toMatch(/\s3 │ \+ const extra/u);
	expect(output).not.toContain("Successfully replaced");
});

test("Patch reports aggregate and per-file evidence, including pure rename wording", () => {
	const registration = toolRegistrationHarness();
	registerCodexTools(registration.host);
	const runtime = getToolUiRuntime(registration.host);
	const patchTool = registration.tools.get("apply_patch");
	if (!patchTool) throw new Error("missing Patch Tool");
	const diff = [
		"--- a/src/a.ts",
		"+++ b/src/a.ts",
		"@@ -1 +1 @@",
		"-const a = 1;",
		"+const a = 2;",
		"--- /dev/null",
		"+++ b/src/b.ts",
		"@@ -0,0 +1 @@",
		"+export {};",
	].join("\n");
	const output = renderSettled(
		patchTool,
		runtime,
		"patch-1",
		{ input: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch" },
		{
			content: [{ type: "text", text: "Applied patch successfully. changed 2 files." }],
			details: {
				changedFiles: ["src/a.ts", "src/b.ts"],
				createdFiles: ["src/b.ts"],
				deletedFiles: [],
				diff,
				fuzz: 0,
				movedFiles: [],
			},
		},
	).join("\n");
	expect(output).toContain("Patch(2 files)");
	expect(output).toContain("+2/-1");
	expect(output).toContain("M src/a.ts · +1/-1");
	expect(output).toContain("A src/b.ts · +1/-0");

	const renameInput = "*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n*** End Patch";
	const rename = renderSettled(
		patchTool,
		runtime,
		"patch-rename",
		{ input: renameInput },
		{
			content: [{ type: "text", text: "Applied patch successfully. changed 1 file." }],
			details: {
				changedFiles: ["new.ts"],
				createdFiles: [],
				deletedFiles: [],
				fuzz: 0,
				movedFiles: ["new.ts"],
			},
		},
	).join("\n");
	expect(rename).toContain("Patch(new.ts)");
	expect(rename).toContain("+0/-0");
	expect(rename).toContain("renamed without content changes");
});

test("Background output is the only Background Operation Block", () => {
	const registration = toolRegistrationHarness();
	registerWorkTools(registration.host, { current: () => undefined }, { includeBash: false });
	const runtime = getToolUiRuntime(registration.host);
	const background = registration.tools.get("background");
	if (!background) throw new Error("missing Background Tool");
	const output = renderSettled(
		background,
		runtime,
		"background-output",
		{ action: "output", task_id: "shell-7" },
		{
			content: [{ type: "text", text: "first\nsecond\nthird\nfourth" }],
			details: { action: "output", status: "read", taskId: "shell-7" },
		},
	).join("\n");
	expect(output).toContain("Background(shell-7)");
	expect(output).toContain("4 lines read");
	expect(output).toContain("… +1 lines (ctrl+o to expand)");

	const list = renderSettled(
		background,
		runtime,
		"background-list",
		{ action: "list" },
		{
			content: [{ type: "text", text: "No Background Shell or Monitor activity is running in this session." }],
			details: { action: "list", status: "listed" },
		},
	).join("\n");
	expect(list).not.toContain("Background(");
	expect(list).not.toContain("⎿");
});

test("mutation issues do not invent evidence from invocation arguments", () => {
	const { runtime, tools } = builtins();
	const write = tools.get("write");
	if (!write) throw new Error("missing Write Tool");
	const output = renderSettled(
		write,
		runtime,
		"write-error",
		{ content: "must not appear", path: "src/fail.ts" },
		{ content: [{ type: "text", text: "Operation aborted" }], details: undefined },
		{ isError: true },
	).join("\n");
	expect(output).toContain("Write(src/fail.ts)");
	expect(output).toContain("Cancelled: Operation aborted");
	expect(output).not.toContain("must not appear");
});

test("every new Operation Block member materializes while running and names terminal issue kinds", () => {
	const builtinRegistration = builtins();
	const codexRegistration = toolRegistrationHarness();
	registerCodexTools(codexRegistration.host);
	const workRegistration = toolRegistrationHarness();
	registerWorkTools(workRegistration.host, { current: () => undefined }, { includeBash: false });
	const cases = [
		{
			args: { content: "verified only after success", path: "src/write.ts" },
			header: "Write(src/write.ts)",
			running: "Writing…",
			runtime: builtinRegistration.runtime,
			tool: builtinRegistration.tools.get("write"),
		},
		{
			args: { edits: [{ newText: "new", oldText: "old" }], path: "src/edit.ts" },
			header: "Edit(src/edit.ts)",
			running: "Editing…",
			runtime: builtinRegistration.runtime,
			tool: builtinRegistration.tools.get("edit"),
		},
		{
			args: { input: "*** Begin Patch\n*** Update File: src/patch.ts\n@@\n-old\n+new\n*** End Patch" },
			header: "Patch(src/patch.ts)",
			running: "Applying…",
			runtime: getToolUiRuntime(codexRegistration.host),
			tool: codexRegistration.tools.get("apply_patch"),
		},
		{
			args: { action: "output", task_id: "shell-9" },
			header: "Background(shell-9)",
			running: "Reading output…",
			runtime: getToolUiRuntime(workRegistration.host),
			tool: workRegistration.tools.get("background"),
		},
	] as const;
	for (const [caseIndex, fixture] of cases.entries()) {
		if (!fixture.tool) throw new Error(`missing Operation Block Tool ${String(caseIndex)}`);
		const running = renderRunning(fixture.tool, fixture.runtime, `running-${String(caseIndex)}`, fixture.args);
		expect(running).toContain(fixture.header);
		expect(running).toContain(fixture.running);
		for (const [issueIndex, issue] of [
			{ prefix: "Error:", text: "Permission denied" },
			{ prefix: "Rejected:", text: "Tool execution was blocked by policy" },
			{ prefix: "Cancelled:", text: "Operation aborted" },
		].entries()) {
			const output = renderSettled(
				fixture.tool,
				fixture.runtime,
				`issue-${String(caseIndex)}-${String(issueIndex)}`,
				fixture.args,
				{ content: [{ type: "text", text: issue.text }], details: undefined },
				{ isError: true },
			).join("\n");
			expect(output).toContain(fixture.header);
			expect(output).toContain(`${issue.prefix} ${issue.text}`);
			expect(output).not.toContain("verified only after success");
		}
	}
});
