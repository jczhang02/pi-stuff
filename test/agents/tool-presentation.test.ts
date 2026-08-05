import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
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
});

test("native parent and child communication tools use the shared Tool row", () => {
	const parent = apiHarness();
	const channel = createNativeSupervisorChannel(parent.api, { lastUiContext: undefined } as unknown as SubagentState);
	channel.start();
	expectCompactPresentation(parent.tools.get("subagent_supervisor"));
	expectCompactPresentation(parent.tools.get("intercom"));
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
