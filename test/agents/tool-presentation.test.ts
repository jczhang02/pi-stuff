import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
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
