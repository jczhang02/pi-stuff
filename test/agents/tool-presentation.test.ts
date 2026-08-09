import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createAgentToolPresentation } from "../../packages/pi-stuff-agents/src/extension/agent-tool-presentation.js";
import {
	createNativeSupervisorChannel,
	registerNativeSupervisorClient,
} from "../../packages/pi-stuff-agents/src/intercom/native-supervisor-channel.js";
import {
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV,
	SUBAGENT_RUN_ID_ENV,
	SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV,
} from "../../packages/pi-stuff-agents/src/runs/shared/pi-args.js";
import {
	STRUCTURED_OUTPUT_CAPTURE_ENV,
	STRUCTURED_OUTPUT_SCHEMA_ENV,
} from "../../packages/pi-stuff-agents/src/runs/shared/structured-output.js";
import registerSubagentPromptRuntime from "../../packages/pi-stuff-agents/src/runs/shared/subagent-prompt-runtime.js";
import type { SubagentState } from "../../packages/pi-stuff-agents/src/shared/types.js";

const environment = new Map<string, string | undefined>();
const temporaryDirectories: string[] = [];
const theme = {
	bold: (value: string) => value,
	fg: (_color: string, value: string) => value,
} as unknown as Theme;

function setEnvironment(name: string, value: string): void {
	if (!environment.has(name)) environment.set(name, process.env[name]);
	process.env[name] = value;
}

function apiHarness(): { readonly api: ExtensionAPI; readonly tools: Map<string, ToolDefinition> } {
	const tools = new Map<string, ToolDefinition>();
	const api = {
		events: { emit: () => {}, on: () => () => {} },
		getAllTools: () => [...tools.values()].map((tool) => ({ name: tool.name })),
		on: () => {},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		sendMessage: () => {},
	} as unknown as ExtensionAPI;
	return { api, tools };
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
	const longReport = {
		content: [
			{ type: "text" as const, text: "Agent general-purpose returned a deliberately long final report.".repeat(20) },
		],
		details: {} as never,
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
		result: { content: [], details: { mode: "single", results: [] } },
		state: "success",
		toolCallId: "agent-background",
	} as never);
	expect(backgroundActivities).toHaveLength(1);
	expect(backgroundActivities?.[0]).toMatchObject({ category: "launch-agent", count: 1 });
	const cancelledBeforeLaunch = presentation.activity?.classify({
		args: { agent: "reviewer", foreground: true, task: fullTask },
		result: {
			content: [{ type: "text", text: "Cancelled before launch" }],
			details: { mode: "single", results: [] },
		},
		state: "cancelled",
		toolCallId: "agent-cancelled-before-launch",
	} as never);
	expect(cancelledBeforeLaunch).toHaveLength(1);
	expect(cancelledBeforeLaunch?.[0]).toMatchObject({ category: "run-agent", count: 0 });
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

test("native parent and child communication tools use the shared Tool row", () => {
	const parent = apiHarness();
	const channel = createNativeSupervisorChannel(parent.api, { lastUiContext: undefined } as unknown as SubagentState);
	channel.start();
	expectCompactPresentation(parent.tools.get("subagent_supervisor"));
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

	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-tool-presentation-"));
	temporaryDirectories.push(directory);
	setEnvironment(SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV, directory);
	setEnvironment(SUBAGENT_RUN_ID_ENV, "run-1");
	setEnvironment(SUBAGENT_CHILD_AGENT_ENV, "worker");
	setEnvironment(SUBAGENT_CHILD_INDEX_ENV, "0");
	setEnvironment(SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV, "parent-session");
	const child = apiHarness();
	registerNativeSupervisorClient(child.api);
	expectCompactPresentation(child.tools.get("contact_supervisor"));
	expectCompactPresentation(child.tools.get("intercom"));
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
