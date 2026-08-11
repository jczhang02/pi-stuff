import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createAgentToolPresentation } from "../../packages/pi-stuff/src/subagents/src/extension/agent-tool-presentation.js";
import {
	createNativeSupervisorChannel,
	registerNativeSupervisorClient,
	resolveSupervisorChannelDir,
} from "../../packages/pi-stuff/src/subagents/src/intercom/native-supervisor-channel.js";
import {
	steerAckPathFromDir,
	writeSteerAckAt,
	writeSteerRequestToDir,
} from "../../packages/pi-stuff/src/subagents/src/runs/background/control-channel.js";
import {
	buildPiArgs,
	PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV,
	resolvePiLaunchToolPlan,
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV,
	SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV,
	SUBAGENT_RUN_ID_ENV,
	SUBAGENT_STEER_ACK_DIR_ENV,
	SUBAGENT_STEER_INBOX_ENV,
	SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/pi-args.js";
import {
	STRUCTURED_OUTPUT_CAPTURE_ENV,
	STRUCTURED_OUTPUT_SCHEMA_ENV,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/structured-output.js";
import registerSubagentPromptRuntime, {
	CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS,
	registerSteeringInbox,
	registerToolBudget,
	rewriteSubagentPrompt,
	validateFinalProviderPayload,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/subagent-prompt-runtime.js";
import {
	CHILD_TOOL_DIAGNOSTIC_PATH_ENV,
	REQUIRED_CHILD_TOOLS_ENV,
	readChildToolDiagnosticError,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/tool-availability.js";
import type { SubagentState } from "../../packages/pi-stuff/src/subagents/src/shared/types.js";
import {
	boundStreamedRecentOutput,
	extractToolArgsPreview,
} from "../../packages/pi-stuff/src/subagents/src/shared/utils.js";

const environment = new Map<string, string | undefined>();
const temporaryDirectories: string[] = [];
const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

function isWellFormed(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return false;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return false;
	}
	return true;
}

function setEnvironment(name: string, value: string): void {
	if (!environment.has(name)) environment.set(name, process.env[name]);
	process.env[name] = value;
}

function apiHarness(): {
	readonly api: ExtensionAPI;
	readonly tools: Map<string, ToolDefinition>;
	run(event: string): Promise<void>;
} {
	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
	const api = {
		events: { emit: () => {}, on: () => () => {} },
		getAllTools: () => [...tools.values()].map((tool) => ({ name: tool.name })),
		on: (event: string, handler: (...args: never[]) => unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		sendMessage: () => {},
	} as unknown as ExtensionAPI;
	return {
		api,
		tools,
		run: async (event: string) => {
			for (const handler of handlers.get(event) ?? []) await handler();
		},
	};
}

function expectCompactPresentation(tool: ToolDefinition | undefined): void {
	expect(tool).toBeDefined();
	expect(tool?.renderShell).toBe("self");
	expect(tool?.renderCall).toBeFunction();
	expect(tool?.renderResult).toBeFunction();
}

function renderedSummary(
	tool: ToolDefinition | undefined,
	args: Record<string, unknown>,
	result: AgentToolResult<unknown>,
	toolCallId: string,
	isError = false,
): string {
	expect(tool).toBeDefined();
	const state = {};
	const context = {
		args,
		argsComplete: true,
		cwd: "/project",
		executionStarted: true,
		expanded: false,
		invalidate: () => {},
		isError,
		isPartial: false,
		lastComponent: undefined,
		showImages: true,
		state,
		toolCallId,
	};
	const row = tool?.renderCall?.(args, theme, context as never);
	expect(row).toBeDefined();
	tool?.renderResult?.(result, { expanded: false, isPartial: false }, theme, {
		...context,
		lastComponent: row,
	} as never);
	return row?.render(100).join("\n") ?? "";
}

afterEach(() => {
	for (const [name, value] of environment) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	environment.clear();
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

test("Agent Tool rows use short descriptions and honest lifecycle outcomes", () => {
	const presentation = createAgentToolPresentation();
	const fullTask = "Inspect /tmp/pi-run/deep/sample.txt and verify every checksum without changing the file.";
	expect(presentation.target?.({ agent: "reviewer", description: "Verify sample checksums", task: fullTask })).toBe(
		"reviewer · Verify sample checksums",
	);
	expect(
		presentation.target?.({
			tasks: [
				{ agent: "reviewer", description: "复核样本 🧪", task: fullTask },
				{ agent: "writer", description: "Update fixture docs", task: "Update every relevant fixture document." },
			],
		}),
	).toBe("reviewer · 复核样本 🧪, writer · Update fixture docs");
	expect(
		presentation.target?.({
			tasks: [
				{} as never,
				{ agent: undefined, description: undefined, task: undefined } as never,
				{ agent: "reviewer", task: "Inspect the partial payload." },
			],
		}),
	).toBe("reviewer · Inspect the partial payload.");
	expect(presentation.target?.({ agent: undefined, task: undefined })).toBe("");
	const longReport = {
		content: [
			{ type: "text" as const, text: "Agent general-purpose returned a deliberately long final report.".repeat(20) },
		],
		details: { asyncId: "run-1", mode: "parallel", results: [] } as never,
	};
	expect(presentation.summarize?.({ agent: "reviewer", task: fullTask }, longReport, "success", 18_000)).toBe(
		"launched",
	);
	expect(
		presentation.summarize?.(
			{
				tasks: [
					{ agent: "reviewer", task: fullTask },
					{ agent: "writer", task: "Update fixture docs." },
				],
			},
			longReport,
			"success",
			18_000,
		),
	).toBe("2 launched");
	expect(
		presentation.summarize?.({ agent: "reviewer", foreground: true, task: fullTask }, longReport, "success", 18_000),
	).toBe("finished");
	expect(presentation.summarize?.({ action: "resume", id: "run-1" }, longReport, "success", 18_000)).toBe("resumed");
	expect(presentation.summarize?.({ action: "steer", id: "run-1" }, longReport, "success", 18_000)).toBe("sent");
	expect(presentation.summarize?.({ action: "stop", id: "run-1" }, longReport, "success", 18_000)).toBe("stopped");
	expect(presentation.summarize?.({ action: "status", id: "run-1" }, longReport, "success", 18_000)).toBe("checked");
	expect(presentation.summarize?.({}, longReport, "cancelled", 18_000)).toBe("cancelled");
	const backgroundActivities = presentation.activity?.classify({
		args: { agent: "reviewer", task: fullTask },
		result: { content: [], details: { asyncId: "run-1", mode: "single", results: [] } },
		state: "success",
		toolCallId: "agent-background",
	} as never);
	expect(backgroundActivities).toHaveLength(1);
	expect(backgroundActivities?.[0]).toMatchObject({ category: "launch-agent", count: 1 });
	const parallelArgs = {
		tasks: [
			{ agent: "reviewer", task: "Review the change." },
			{ agent: "tester", task: "Run the tests." },
			{ agent: "writer", task: "Check the docs." },
		],
	};
	expect(typeof presentation.label === "function" ? presentation.label(parallelArgs) : presentation.label).toBe(
		"Agents",
	);
	expect(
		presentation.activity?.classify({
			args: parallelArgs,
			state: "running",
			toolCallId: "agent-streaming",
		} as never),
	).toEqual([]);
	const refused = {
		content: [{ type: "text" as const, text: "Fork preflight refused before any Agent launched." }],
		details: { mode: "parallel" as const, results: [] },
		isError: true,
	};
	expect(presentation.resultIsError?.(parallelArgs, refused)).toBeTrue();
	expect(
		presentation.activity?.classify({
			args: parallelArgs,
			result: refused,
			state: "error",
			toolCallId: "agent-refused",
		} as never),
	).toEqual([]);
	const launched = {
		content: [{ type: "text" as const, text: "3 Agents started in the background (run-2)." }],
		details: { asyncId: "run-2", mode: "parallel" as const, results: [] },
	};
	expect(presentation.resultIsError?.(parallelArgs, launched)).toBeFalse();
	expect(
		presentation.activity?.classify({
			args: parallelArgs,
			result: launched,
			state: "success",
			toolCallId: "agent-launched",
		} as never),
	).toEqual([
		{
			category: "launch-agent",
			count: 3,
			target: "reviewer · Review the change., tester · Run the tests., writer · Check the docs.",
		},
	]);
	expect(presentation.summarize?.(parallelArgs, launched, "success", 18_000)).toBe("3 launched");
	const foregroundActivities = presentation.activity?.classify({
		args: { ...parallelArgs, foreground: true },
		result: { content: [], details: { mode: "parallel", results: [{}, {}] } },
		state: "success",
		toolCallId: "agent-foreground",
	} as never);
	expect(foregroundActivities).toEqual([
		{
			category: "run-agent",
			count: 2,
			target: "reviewer · Review the change., tester · Run the tests., writer · Check the docs.",
		},
	]);
	expect(
		presentation.activity?.classify({
			args: { tasks: [{} as never] },
			state: "running",
			toolCallId: "agent-partial",
		} as never),
	).toEqual([]);
	const cancelledBeforeLaunch = presentation.activity?.classify({
		args: { agent: "reviewer", foreground: true, task: fullTask },
		result: {
			content: [{ type: "text", text: "Cancelled before launch" }],
			details: { mode: "single", results: [] },
		},
		state: "cancelled",
		toolCallId: "agent-cancelled-before-launch",
	} as never);
	expect(cancelledBeforeLaunch).toEqual([]);
	for (const [action, category] of [
		["status", "check-agent"],
		["steer", "steer-agent"],
		["stop", "stop-agent"],
		["resume", "resume-agent"],
	] as const) {
		const managedActivities = presentation.activity?.classify({
			args: { action, id: "run-1" },
			result: { content: [], details: { mode: "control", results: [] } },
			state: "success",
			toolCallId: `agent-${action}`,
		} as never);
		expect(managedActivities?.[0]).toMatchObject({ category });
	}
});

test("bounds live Agent arguments and streamed text by grapheme and terminal cells", () => {
	const args = extractToolArgsPreview({ query: "😀".repeat(31) });
	const output = boundStreamedRecentOutput([`\u001b[31m${"界".repeat(1_100)}\u001b[0m`])[0] ?? "";
	for (const [value, width] of [
		[args, 60],
		[output, 2_000],
	] as const) {
		expect(visibleWidth(value)).toBeLessThanOrEqual(width);
		expect(isWellFormed(value)).toBeTrue();
		expect(value).not.toContain("\u001b");
	}
	expect(args).toEndWith("...");
	expect(output).toEndWith("… [truncated]");

	const presentation = createAgentToolPresentation();
	const issue = presentation.summarize?.(
		{ agent: "reviewer", foreground: true, task: "Inspect" },
		{ content: [{ type: "text", text: `\u001b[31m${"失败".repeat(100)}\u001b[0m` }], details: {} as never },
		"error",
		1,
	);
	expect(visibleWidth(issue ?? "")).toBeLessThanOrEqual(160);
	expect(issue).not.toContain("\u001b");
});

test("native parent and child communication tools use the shared Tool row", async () => {
	const parent = apiHarness();
	const channel = createNativeSupervisorChannel(parent.api, { lastUiContext: undefined } as unknown as SubagentState);
	channel.start();
	expectCompactPresentation(parent.tools.get("subagent_supervisor"));
	await parent.run("before_agent_start");
	expectCompactPresentation(parent.tools.get("intercom"));
	for (const [action, category] of [
		["status", "check-agent"],
		["list", "check-agent"],
		["send", "message-agent"],
		["reply", "message-agent"],
		["ask", "message-agent"],
	] as const) {
		const summary = renderedSummary(
			parent.tools.get("subagent_supervisor"),
			{ action, to: "worker" },
			{ content: [{ type: "text", text: "done" }], details: {} },
			`parent-${action}`,
		);
		expect(summary).toContain(category === "check-agent" ? "Checked 1 agent" : "Messaged 1 agent");
	}
	const failedMessage = renderedSummary(
		parent.tools.get("subagent_supervisor"),
		{ action: "send", to: "worker" },
		{ content: [{ type: "text", text: "delivery failed" }], details: {} },
		"parent-send-failed",
		true,
	);
	expect(failedMessage).toContain("failed");
	expect(failedMessage).not.toContain("Messaged");
	channel.dispose();

	const directory = resolveSupervisorChannelDir("run-1", "worker", 0);
	mkdirSync(join(directory, "requests"), { recursive: true });
	mkdirSync(join(directory, "replies"), { recursive: true });
	temporaryDirectories.push(directory);
	setEnvironment(SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV, directory);
	setEnvironment(SUBAGENT_RUN_ID_ENV, "run-1");
	setEnvironment(SUBAGENT_CHILD_AGENT_ENV, "worker");
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");
	setEnvironment(SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV, "parent-session");
	setEnvironment(SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV, "legacy-test-session");
	const child = apiHarness();
	registerNativeSupervisorClient(child.api);
	expectCompactPresentation(child.tools.get("contact_supervisor"));
	expectCompactPresentation(child.tools.get("intercom"));
});

test("waits until before_agent_start before installing intercom fallback so a later extension can register it", async () => {
	const runId = `dynamic-intercom-${Date.now()}`;
	const physicalSessionId = "dynamic-intercom-physical";
	const directory = resolveSupervisorChannelDir(runId, "worker", 0, physicalSessionId);
	mkdirSync(join(directory, "requests"), { recursive: true });
	mkdirSync(join(directory, "replies"), { recursive: true });
	temporaryDirectories.push(directory);
	setEnvironment(SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV, directory);
	setEnvironment(SUBAGENT_RUN_ID_ENV, runId);
	setEnvironment(SUBAGENT_CHILD_AGENT_ENV, "worker");
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");
	setEnvironment(SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV, "parent-session");
	setEnvironment(SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV, physicalSessionId);
	setEnvironment(REQUIRED_CHILD_TOOLS_ENV, JSON.stringify(["intercom"]));

	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, Array<(event: never) => unknown>>();
	const api = {
		events: { emit: () => {}, on: () => () => {} },
		getAllTools: () => [...tools.values()].map((tool) => ({ name: tool.name })),
		on: (event: string, handler: (event: never) => unknown) => {
			const listeners = handlers.get(event) ?? [];
			listeners.push(handler);
			handlers.set(event, listeners);
		},
		// Pi's extension registry is first-wins for duplicate tool names.
		registerTool: (tool: ToolDefinition) => {
			if (!tools.has(tool.name)) tools.set(tool.name, tool);
		},
		sendMessage: () => {},
	} as unknown as ExtensionAPI;
	registerSubagentPromptRuntime(api);
	(api as ExtensionAPI).on("session_start", () => {
		(api as ExtensionAPI).registerTool({
			name: "intercom",
			label: "External Intercom",
			description: "Dynamically registered external intercom.",
			parameters: {} as never,
			execute: async () => ({ content: [{ type: "text", text: "external" }], details: {} }),
		} as ToolDefinition);
	});

	for (const handler of handlers.get("session_start") ?? []) await handler({} as never);
	expect(tools.get("intercom")?.label).toBe("External Intercom");
	for (const handler of handlers.get("before_agent_start") ?? []) {
		await handler({ systemPrompt: "child" } as never);
	}
	expect(tools.get("intercom")?.label).toBe("External Intercom");
	expect(tools.get("contact_supervisor")?.label).toBe("Contact Supervisor");
});

test("detached root Agents keep native supervisor coordination with an explicit tool allowlist", () => {
	const runId = `tool-plan-${Date.now().toString(36)}`;
	const channelDir = resolveSupervisorChannelDir(runId, "worker", 0, "parent-physical-session");
	temporaryDirectories.push(channelDir);
	const built = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "Inspect the project.",
		sessionEnabled: false,
		inheritProjectContext: false,
		inheritSkills: false,
		tools: ["read"],
		parentSessionId: "parent-session",
		governorSessionId: "parent-physical-session",
		runId,
		childAgentName: "worker",
		childIndex: 0,
		enableNativeSupervisor: true,
	});
	const toolsIndex = built.args.indexOf("--tools");
	expect(toolsIndex).toBeGreaterThanOrEqual(0);
	expect(built.args[toolsIndex + 1]?.split(",")).toEqual(expect.arrayContaining(["read", "contact_supervisor"]));
	expect(built.args).toContain("--no-context-files");
	expect(built.args).toContain("--no-skills");
	expect(built.env[SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV]).toBe(channelDir);
	expect(existsSync(channelDir)).toBeFalse();

	const foreground = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "Inspect in foreground.",
		sessionEnabled: false,
		inheritProjectContext: false,
		inheritSkills: false,
		parentSessionId: "parent-session",
		runId: `${runId}-foreground`,
		childAgentName: "worker",
		enableNativeSupervisor: false,
	});
	expect(foreground.env[SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV]).toBeUndefined();
});

test("replaces ambient child discovery with a controlled Suite surface and a terminal payload gate", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-child-base-extension-"));
	temporaryDirectories.push(root);
	const baseExtension = join(root, "suite.ts");
	writeFileSync(baseExtension, "export default () => {};\n");
	setEnvironment(PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV, baseExtension);
	const ambientSafe = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "Inspect the project.",
		sessionEnabled: false,
		inheritProjectContext: true,
		inheritSkills: true,
	});
	if (ambientSafe.tempDir) temporaryDirectories.push(ambientSafe.tempDir);
	const ambientSafePaths = ambientSafe.args.flatMap((argument, index) =>
		argument === "--extension" && ambientSafe.args[index + 1] ? [ambientSafe.args[index + 1] as string] : [],
	);
	expect(ambientSafe.args).toContain("--no-extensions");
	expect(ambientSafePaths[0]).toBe(baseExtension);
	expect(ambientSafePaths.at(-1)?.endsWith("subagent-prompt-runtime.ts")).toBeTrue();

	const configuredExtension = "/tmp/pi-stuff-explicit-child-extension.ts";
	const built = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "Inspect the project.",
		sessionEnabled: false,
		inheritProjectContext: true,
		inheritSkills: true,
		extensions: [configuredExtension],
	});
	if (built.tempDir) temporaryDirectories.push(built.tempDir);
	const extensionPaths = built.args.flatMap((argument, index) =>
		argument === "--extension" && built.args[index + 1] ? [built.args[index + 1] as string] : [],
	);

	expect(extensionPaths[0]).toBe(configuredExtension);
	expect(extensionPaths.at(-1)?.endsWith("subagent-prompt-runtime.ts")).toBeTrue();
	expect(extensionPaths).not.toContain(baseExtension);
	expect(built.args).toContain("--no-extensions");
	expect(built.toolDiagnosticPath).toBeTruthy();
	expect(built.env[CHILD_TOOL_DIAGNOSTIC_PATH_ENV]).toBe(built.toolDiagnosticPath);
});

test("passes the Suite child surface through the child environment without mutating the parent", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-explicit-child-base-"));
	temporaryDirectories.push(root);
	const baseExtension = join(root, "suite.ts");
	writeFileSync(baseExtension, "export default () => {};\n");
	const parentValue = process.env[PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV];

	const built = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "Inspect the project.",
		sessionEnabled: false,
		inheritProjectContext: true,
		inheritSkills: true,
		childBaseExtensionPath: baseExtension,
	});
	if (built.tempDir) temporaryDirectories.push(built.tempDir);

	expect(process.env[PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV]).toBe(parentValue);
	expect(built.env[PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV]).toBe(baseExtension);
	expect(built.args).toContain(baseExtension);
});

test("forces and verifies read for every skill-enabled explicit Tool shape", () => {
	for (const tools of [[], ["/tmp/child-tool.ts"], ["edit"]]) {
		const plan = resolvePiLaunchToolPlan({
			tools,
			requireReadTool: true,
			...(tools.includes("edit")
				? {
						capabilityCeiling: {
							version: 1 as const,
							allowedTools: ["edit", "read"],
							denyExtensions: false,
							sources: ["test"],
						},
					}
				: {}),
		});
		expect(plan.effectiveToolAllowlist).toContain("read");
		expect(plan.requiredChildTools).toContain("read");
	}
	const implicit = resolvePiLaunchToolPlan({ requireReadTool: true });
	expect(implicit.requiredChildTools).toContain("read");
});

test("leaves Host-like delimiter examples intact because resource isolation belongs to Pi CLI flags", () => {
	const prompt = [
		"Replacement instructions.",
		"",
		"<project_context>",
		"",
		"Project-specific instructions and guidelines:",
		"",
		'<project_instructions path="/workspace/AGENTS.md">project rules</project_instructions>',
		"",
		"</project_context>",
		"",
		"The following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"",
		"<available_skills>",
		"  <skill><name>review</name></skill>",
		"</available_skills>",
		'<skill name="pi-subagents" location="/literal/SKILL.md">DO_NOT_DELETE_LITERAL_SKILL</skill>',
		CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS,
		"Current working directory: /workspace",
	].join("\n");

	const rewritten = rewriteSubagentPrompt(prompt, {});
	expect(rewritten).toContain("Replacement instructions.");
	expect(rewritten).toContain("project rules");
	expect(rewritten).toContain("available_skills");
	expect(rewritten).toContain("DO_NOT_DELETE_LITERAL_SKILL");
	expect(rewritten.indexOf(CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS)).not.toBe(
		rewritten.lastIndexOf(CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS),
	);
	expect(rewritten).toContain("Current working directory: /workspace");
});

test("a rejected advisory tool-budget nudge cannot escape the child runtime", async () => {
	const handlers = new Map<string, (event: { toolName?: string }) => unknown>();
	const pi = {
		on: (event: string, handler: (event: { toolName?: string }) => unknown) => handlers.set(event, handler),
		sendUserMessage: () => Promise.reject(new Error("injected advisory transport failure")),
	} as unknown as ExtensionAPI;
	registerToolBudget(pi, { soft: 1, hard: 1, block: "*" });

	expect(handlers.get("tool_call")?.({ toolName: "read" })).toBeUndefined();
	await Bun.sleep(0);
	expect(handlers.get("tool_call")?.({ toolName: "write" })).toEqual({
		block: true,
		reason: expect.stringContaining("Tool budget"),
	});
});

test("aborts an oversized final child provider payload with a durable diagnostic", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-child-payload-guard-"));
	temporaryDirectories.push(root);
	const diagnosticPath = join(root, "child-diagnostic.json");
	setEnvironment(CHILD_TOOL_DIAGNOSTIC_PATH_ENV, diagnosticPath);
	const handlers = new Map<string, Array<(event: never, ctx: never) => unknown>>();
	const pi = {
		events: { emit: () => {}, on: () => () => {} },
		getAllTools: () => [],
		on: (event: string, handler: (event: never, ctx: never) => unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool: () => {},
		sendMessage: () => {},
	} as unknown as ExtensionAPI;
	registerSubagentPromptRuntime(pi);
	let aborts = 0;
	for (const handler of handlers.get("before_provider_request") ?? []) {
		await handler(
			{ payload: { input: "𠮷".repeat(2_000), tools: [{ description: "x".repeat(10_000) }] } } as never,
			{
				model: { contextWindow: 8_000, maxTokens: 2_000 },
				abort: () => {
					aborts += 1;
				},
			} as never,
		);
	}

	expect(aborts).toBe(1);
	expect(readChildToolDiagnosticError(diagnosticPath)).toContain("final child payload");
	expect(validateFinalProviderPayload({ input: "small" }, { contextWindow: 8_000, maxTokens: 2_000 })).toEqual({
		ok: true,
	});
});

test("measures final OpenAI child payloads in tokens instead of UTF-8 bytes", () => {
	const model = {
		provider: "openai-codex",
		id: "gpt-5.6-sol",
		contextWindow: 272_000,
		maxTokens: 128_000,
	};
	const payload = (input: string) => ({
		input,
		tools: [
			{
				name: "read",
				description: "Read a file safely. ".repeat(100),
				parameters: { type: "object", properties: { path: { type: "string" } } },
			},
		],
		skills: [{ name: "review", instructions: "Inspect the complete change." }],
		extensions: ["child-runtime"],
	});

	for (const input of [
		"Bounded child prompt. ".repeat(4_100),
		"上下文".repeat(10_000),
		"AP6Zz9+/0f3cD7aQ".repeat(5_200),
	]) {
		const request = payload(input);
		expect(Buffer.byteLength(JSON.stringify(request), "utf8")).toBeGreaterThan(76_000);
		expect(validateFinalProviderPayload(request, model)).toEqual({ ok: true });
	}

	const nearLimit = payload("AP6Zz9+/0f3cD7aQ".repeat(5_200));
	expect(
		validateFinalProviderPayload(nearLimit, {
			...model,
			contextWindow: 160_000,
			maxTokens: 80_000,
		}).ok,
	).toBe(false);
	expect(validateFinalProviderPayload(nearLimit, model)).toEqual({ ok: true });

	const oversized = validateFinalProviderPayload(payload("AP6Zz9+/0f3cD7aQ".repeat(6_000)), model);
	expect(oversized.ok).toBe(false);
	if (!oversized.ok) {
		expect(oversized.message).toContain("input tokens");
		expect(oversized.message).not.toContain("byte input bound");
	}
});

test("native supervisor channels are created lazily on the first child request", async () => {
	const runId = `lazy-channel-${Date.now().toString(36)}`;
	const physicalSessionId = `lazy-physical-${Date.now().toString(36)}`;
	const channelDir = resolveSupervisorChannelDir(runId, "worker", 0, physicalSessionId);
	temporaryDirectories.push(channelDir);
	setEnvironment(SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV, channelDir);
	setEnvironment(SUBAGENT_RUN_ID_ENV, runId);
	setEnvironment(SUBAGENT_CHILD_AGENT_ENV, "worker");
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");
	setEnvironment(SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV, "parent-session");
	setEnvironment(SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV, physicalSessionId);
	const child = apiHarness();
	registerNativeSupervisorClient(child.api);

	expect(existsSync(channelDir)).toBeFalse();
	const tool = child.tools.get("contact_supervisor");
	if (!tool) throw new Error("Expected contact_supervisor to be registered.");
	await tool.execute(
		"progress-call",
		{ reason: "progress_update", message: "Still working." },
		new AbortController().signal,
		undefined,
		undefined as never,
	);

	expect(existsSync(join(channelDir, "channel.json"))).toBeTrue();
	expect(readdirSync(join(channelDir, "requests")).filter((entry) => entry.endsWith(".json"))).toHaveLength(1);
});

test("structured_output uses the shared Tool row without changing its terminating result", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-structured-presentation-"));
	temporaryDirectories.push(directory);
	const schemaPath = join(directory, "schema.json");
	const capturePath = join(directory, "capture.json");
	writeFileSync(
		schemaPath,
		JSON.stringify({
			additionalProperties: false,
			properties: { answer: { type: "string" } },
			required: ["answer"],
			type: "object",
		}),
	);
	setEnvironment(STRUCTURED_OUTPUT_SCHEMA_ENV, schemaPath);
	setEnvironment(STRUCTURED_OUTPUT_CAPTURE_ENV, capturePath);
	const harness = apiHarness();
	registerSubagentPromptRuntime(harness.api);
	const tool = harness.tools.get("structured_output");
	expectCompactPresentation(tool);
	const result = await tool?.execute(
		"structured-1",
		{ value: { answer: "ok" } },
		new AbortController().signal,
		undefined,
		{} as never,
	);
	expect(result).toMatchObject({
		content: [{ text: "Structured output captured.", type: "text" }],
		terminate: true,
	});
});

test("retries a failed steering acknowledgement without delivering the steer twice", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-steering-ack-"));
	temporaryDirectories.push(directory);
	const inbox = join(directory, "inbox");
	const ackDir = join(directory, "ack");
	writeFileSync(ackDir, "temporarily-not-a-directory");
	setEnvironment(SUBAGENT_STEER_INBOX_ENV, inbox);
	setEnvironment(SUBAGENT_STEER_ACK_DIR_ENV, ackDir);
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");

	const handlers = new Map<string, (event: unknown) => unknown>();
	const delivered: string[] = [];
	const pi = {
		on: (event: string, handler: (event: unknown) => unknown) => handlers.set(event, handler),
		sendUserMessage: (content: string) => delivered.push(content),
	} as unknown as ExtensionAPI;
	registerSteeringInbox(pi);
	try {
		handlers.get("session_start")?.({});
		writeSteerRequestToDir(inbox, {
			type: "steer",
			id: "retry-ack",
			ts: Date.now(),
			message: "Continue with the lifecycle audit.",
		});
		handlers.get("agent_start")?.({});
		expect(delivered).toHaveLength(1);
		const formatted = delivered[0];
		expect(formatted).toContain("Continue with the lifecycle audit.");

		handlers.get("input")?.({
			content: `ambient-prefix\n${formatted}\nambient-suffix`,
			source: "extension",
			streamingBehavior: "steer",
		});
		expect(existsSync(steerAckPathFromDir(ackDir, "retry-ack"))).toBe(false);

		rmSync(ackDir, { force: true });
		mkdirSync(ackDir, { recursive: true });
		handlers.get("turn_end")?.({});
		const ack = JSON.parse(readFileSync(steerAckPathFromDir(ackDir, "retry-ack"), "utf-8")) as {
			requestId: string;
			state: string;
		};
		expect(ack).toMatchObject({ requestId: "retry-ack", state: "delivered" });
		expect(delivered).toHaveLength(1);
	} finally {
		handlers.get("session_shutdown")?.({});
	}
});

test("retries a correlated steering acknowledgement once during immediate shutdown", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-steering-shutdown-ack-"));
	temporaryDirectories.push(directory);
	const inbox = join(directory, "inbox");
	const ackDir = join(directory, "ack");
	writeFileSync(ackDir, "temporarily-not-a-directory");
	setEnvironment(SUBAGENT_STEER_INBOX_ENV, inbox);
	setEnvironment(SUBAGENT_STEER_ACK_DIR_ENV, ackDir);
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");

	const handlers = new Map<string, (event: unknown) => unknown>();
	const delivered: string[] = [];
	const pi = {
		on: (event: string, handler: (event: unknown) => unknown) => handlers.set(event, handler),
		sendUserMessage: (content: string) => delivered.push(content),
	} as unknown as ExtensionAPI;
	registerSteeringInbox(pi);
	handlers.get("session_start")?.({});
	writeSteerRequestToDir(inbox, {
		type: "steer",
		id: "shutdown-retry-ack",
		ts: Date.now(),
		message: "Finish the accepted work.",
	});
	handlers.get("agent_start")?.({});
	const formatted = delivered[0];
	expect(formatted).toContain("Finish the accepted work.");
	handlers.get("input")?.({ content: formatted, source: "extension", streamingBehavior: "steer" });
	expect(existsSync(steerAckPathFromDir(ackDir, "shutdown-retry-ack"))).toBe(false);

	rmSync(ackDir, { force: true });
	mkdirSync(ackDir, { recursive: true });
	handlers.get("session_shutdown")?.({});
	const ack = JSON.parse(readFileSync(steerAckPathFromDir(ackDir, "shutdown-retry-ack"), "utf-8")) as {
		requestId: string;
		state: string;
	};
	expect(ack).toMatchObject({ requestId: "shutdown-retry-ack", state: "delivered" });
	expect(delivered).toHaveLength(1);
});

test("holds startup steering until the child's initial Agent turn has started", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-steering-startup-"));
	temporaryDirectories.push(directory);
	const inbox = join(directory, "inbox");
	setEnvironment(SUBAGENT_STEER_INBOX_ENV, inbox);

	const handlers = new Map<string, (event: unknown) => unknown>();
	const delivered: string[] = [];
	registerSteeringInbox({
		on: (event: string, handler: (event: unknown) => unknown) => handlers.set(event, handler),
		sendUserMessage: (content: string) => delivered.push(content),
	} as unknown as ExtensionAPI);
	handlers.get("session_start")?.({});
	writeSteerRequestToDir(inbox, {
		type: "steer",
		id: "startup-race",
		ts: Date.now(),
		message: "Wait for the initial task to start.",
	});
	handlers.get("message_start")?.({});
	expect(delivered).toEqual([]);

	handlers.get("agent_start")?.({});
	expect(delivered).toHaveLength(1);
	expect(delivered[0]).toContain("Wait for the initial task to start.");
	handlers.get("session_shutdown")?.({});
});

test("replays a steering request after dispatch crashes before Pi accepts the input", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-steering-dispatch-crash-"));
	temporaryDirectories.push(directory);
	const inbox = join(directory, "inbox");
	const ackDir = join(directory, "ack");
	mkdirSync(ackDir, { recursive: true });
	setEnvironment(SUBAGENT_STEER_INBOX_ENV, inbox);
	setEnvironment(SUBAGENT_STEER_ACK_DIR_ENV, ackDir);
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");

	const request = {
		type: "steer" as const,
		id: "dispatch-crash",
		ts: Date.now(),
		message: "Continue after the child restart.",
	};
	const firstHandlers = new Map<string, (event: unknown) => unknown>();
	const firstDeliveries: string[] = [];
	registerSteeringInbox({
		on: (event: string, handler: (event: unknown) => unknown) => firstHandlers.set(event, handler),
		sendUserMessage: (content: string) => firstDeliveries.push(content),
	} as unknown as ExtensionAPI);
	firstHandlers.get("session_start")?.({});
	writeSteerRequestToDir(inbox, request);
	firstHandlers.get("agent_start")?.({});
	expect(firstDeliveries).toHaveLength(1);
	expect(readdirSync(inbox).some((entry) => entry.includes(".pi-stuff-inflight."))).toBeTrue();
	firstHandlers.get("session_shutdown")?.({});

	const replacementHandlers = new Map<string, (event: unknown) => unknown>();
	const replacementDeliveries: string[] = [];
	registerSteeringInbox({
		on: (event: string, handler: (event: unknown) => unknown) => replacementHandlers.set(event, handler),
		sendUserMessage: (content: string) => replacementDeliveries.push(content),
	} as unknown as ExtensionAPI);
	replacementHandlers.get("session_start")?.({});
	replacementHandlers.get("agent_start")?.({});
	expect(replacementDeliveries).toHaveLength(1);
	replacementHandlers.get("input")?.({
		content: replacementDeliveries[0],
		source: "extension",
	});
	expect(readFileSync(steerAckPathFromDir(ackDir, request.id), "utf-8")).toContain('"state": "delivered"');
	expect(
		readdirSync(inbox).filter((entry) => entry.endsWith(".json") || entry.includes(".pi-stuff-inflight.")),
	).toEqual([]);
	replacementHandlers.get("session_shutdown")?.({});
});

test("uses an existing steering acknowledgement to retire a crash-left request without redelivery", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-steering-existing-ack-"));
	temporaryDirectories.push(directory);
	const inbox = join(directory, "inbox");
	const ackDir = join(directory, "ack");
	setEnvironment(SUBAGENT_STEER_INBOX_ENV, inbox);
	setEnvironment(SUBAGENT_STEER_ACK_DIR_ENV, ackDir);
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");
	const request = {
		type: "steer" as const,
		id: "accepted-before-crash",
		ts: Date.now(),
		message: "Do not deliver this twice.",
	};
	writeSteerRequestToDir(inbox, request);
	writeSteerAckAt(steerAckPathFromDir(ackDir, request.id), {
		requestId: request.id,
		index: 0,
		ts: Date.now(),
		state: "delivered",
		message: "Pi accepted the correlated steering input.",
	});

	const handlers = new Map<string, (event: unknown) => unknown>();
	const delivered: string[] = [];
	registerSteeringInbox({
		on: (event: string, handler: (event: unknown) => unknown) => handlers.set(event, handler),
		sendUserMessage: (content: string) => delivered.push(content),
	} as unknown as ExtensionAPI);
	handlers.get("session_start")?.({});
	handlers.get("agent_start")?.({});
	expect(delivered).toEqual([]);
	expect(
		readdirSync(inbox).filter((entry) => entry.endsWith(".json") || entry.includes(".pi-stuff-inflight.")),
	).toEqual([]);
	handlers.get("session_shutdown")?.({});
});
