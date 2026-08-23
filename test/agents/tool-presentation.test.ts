import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentToolResult,
	createSyntheticSourceInfo,
	type ExtensionAPI,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import {
	isRuntimeFunction,
	isRuntimeObject,
	isRuntimeString,
} from "../../packages/pi-stuff/src/shared/runtime-type.js";
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
	PI_STUFF_CODE_MODE_FROZEN_ENV,
	resolvePiLaunchToolPlan,
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV,
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
import type { ToolArguments } from "../../packages/pi-stuff/src/tool-display/activity.js";
import { getToolUiRuntime } from "../../packages/pi-stuff/src/tool-display/contract.js";
import { createExtensionApi } from "../fixtures/extension-api.js";
import { testTheme } from "../fixtures/extension-context.js";

const environment = new Map<string, string | undefined>();
const temporaryDirectories: string[] = [];
const theme = testTheme;

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];
type LifecycleResult = object | undefined | Promise<object | undefined>;
const FIXTURE_MESSAGE_SCHEMA = Type.Object(
	{
		content: Type.Unknown(),
		isError: Type.Optional(Type.Boolean()),
		role: Type.String(),
		stopReason: Type.Optional(Type.String()),
		timestamp: Type.Optional(Type.Number()),
		toolCallId: Type.Optional(Type.String()),
		toolName: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);
const CONTEXT_RESULT_SCHEMA = Type.Object(
	{ messages: Type.Optional(Type.Array(FIXTURE_MESSAGE_SCHEMA)) },
	{ additionalProperties: true },
);
type FixtureMessage = Static<typeof FIXTURE_MESSAGE_SCHEMA>;

interface LifecycleEvent {
	readonly content?: string;
	readonly messages?: FixtureMessage[];
	readonly payload?: object;
	readonly reason?: string;
	readonly source?: string;
	readonly streamingBehavior?: string;
	readonly systemPrompt?: string;
	readonly toolName?: string;
}

interface LifecycleContext {
	abort?(): void;
	getSystemPrompt?(): string;
	readonly model?: {
		readonly contextWindow: number;
		readonly id?: string;
		readonly maxTokens: number;
		readonly provider?: string;
	};
}

type LifecycleHandler = (event: LifecycleEvent, context?: LifecycleContext) => LifecycleResult;

function projectedMessages(result: Awaited<LifecycleResult>, fallback: FixtureMessage[]): FixtureMessage[] {
	return Check(CONTEXT_RESULT_SCHEMA, result) && result.messages ? result.messages : fallback;
}

function toolInfo(tool: Pick<ToolDefinition, "description" | "name" | "parameters">): ToolInfo {
	return {
		description: tool.description,
		name: tool.name,
		parameters: tool.parameters,
		sourceInfo: createSyntheticSourceInfo(`/test/${tool.name}`, { source: "extension" }),
	};
}

function lifecycleHandlers<Handler>(handlers: Map<string, Handler[]>): ExtensionAPI["on"] {
	return new Proxy(createExtensionApi().on, {
		apply(_target, _thisArg, [event, handler]) {
			if (!isRuntimeString(event) || !isRuntimeFunction(handler)) return undefined;
			// SAFETY: Tests invoke each captured callback only with the matching lifecycle payload used at registration.
			const captured = handler as Handler;
			handlers.set(event, [...(handlers.get(event) ?? []), captured]);
			return undefined;
		},
	});
}

function lifecycleHandler<Event>(handlers: Map<string, (event: Event) => LifecycleResult>): ExtensionAPI["on"] {
	return new Proxy(createExtensionApi().on, {
		apply(_target, _thisArg, [event, handler]) {
			if (!isRuntimeString(event) || !isRuntimeFunction(handler)) return undefined;
			// SAFETY: Tests invoke each captured callback only with the matching lifecycle payload used at registration.
			handlers.set(event, handler as (event: Event) => LifecycleResult);
			return undefined;
		},
	});
}

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

function apiHarness() {
	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, LifecycleHandler[]>();
	const api = createExtensionApi({
		getAllTools: () => [...tools.values()].map(toolInfo),
		on: lifecycleHandlers(handlers),
		registerTool: (tool) => {
			// SAFETY: this test registry erases only generic renderer state and returns the original Tool unchanged.
			tools.set(tool.name, tool as ToolDefinition);
		},
		sendMessage: () => {},
	});
	return {
		api,
		tools,
		run: async (event: string) => {
			for (const handler of handlers.get(event) ?? []) await handler({});
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
	api: ExtensionAPI,
	tool: ToolDefinition | undefined,
	args: ToolArguments,
	result: AgentToolResult<unknown>,
	toolCallId: string,
	isError = false,
): string {
	expect(tool).toBeDefined();
	getToolUiRuntime(api).indexMessages(
		[
			{ role: "assistant", content: [{ type: "toolCall", id: toolCallId, name: tool?.name, arguments: args }] },
			Object.assign(
				{
					role: "toolResult",
					toolCallId,
					content: result.content,
					details: result.details,
				},
				isError ? { isError: true } : undefined,
			),
		],
		true,
	);
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
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	const row = tool?.renderCall?.(args, theme, context as never);
	expect(row).toBeDefined();
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
				// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
				{} as never,
				// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
	expect(isRuntimeFunction(presentation.label) ? presentation.label(parallelArgs) : presentation.label).toBe("Agents");
	expect(
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		presentation.activity?.classify({
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
			args: { tasks: [{} as never] },
			state: "running",
			toolCallId: "agent-partial",
		} as never),
	).toEqual([]);
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
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
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		{ content: [{ type: "text", text: `\u001b[31m${"失败".repeat(100)}\u001b[0m` }], details: {} as never },
		"error",
		1,
	);
	expect(visibleWidth(issue ?? "")).toBeLessThanOrEqual(160);
	expect(issue).not.toContain("\u001b");
});

test("native parent and child communication tools use the shared Tool row", async () => {
	const parent = apiHarness();
	const state: SubagentState = {
		asyncJobs: new Map(),
		baseCwd: "",
		cleanupTimers: new Map(),
		completionSeen: new Map(),
		currentSessionId: null,
		foregroundControls: new Map(),
		foregroundRuns: new Map(),
		lastForegroundControlId: null,
		lastUiContext: null,
		recentAgentJobs: new Map(),
		resultFileCoalescer: { clear: () => {}, schedule: () => false },
		watcher: null,
		watcherRestartTimer: null,
	};
	const channel = createNativeSupervisorChannel(parent.api, state);
	channel.start();
	expectCompactPresentation(parent.tools.get("subagent_supervisor"));
	await parent.run("before_agent_start");
	expectCompactPresentation(parent.tools.get("intercom"));
	for (const action of ["status", "list", "send", "reply", "ask"] as const) {
		const summary = renderedSummary(
			parent.api,
			parent.tools.get("subagent_supervisor"),
			{ action, to: "worker" },
			{ content: [{ type: "text", text: "done" }], details: {} },
			`parent-${action}`,
		);
		expect(summary).toContain(`Subagent Supervisor ${action} · worker · done`);
	}
	const failedMessage = renderedSummary(
		parent.api,
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
	const handlers = new Map<string, LifecycleHandler[]>();
	const api = createExtensionApi({
		getAllTools: () => [...tools.values()].map(toolInfo),
		on: lifecycleHandlers(handlers),
		// Pi's extension registry is first-wins for duplicate tool names.
		registerTool: (tool) => {
			// SAFETY: this test registry erases only generic renderer state and returns the original Tool unchanged.
			const stored = tool as ToolDefinition;
			if (!tools.has(stored.name)) tools.set(stored.name, stored);
		},
		sendMessage: () => {},
	});
	registerSubagentPromptRuntime(api);
	api.on("session_start", () => {
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		api.registerTool({
			name: "intercom",
			label: "External Intercom",
			description: "Dynamically registered external intercom.",
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
			parameters: {} as never,
			execute: async () => ({ content: [{ type: "text", text: "external" }], details: {} }),
		} as ToolDefinition);
	});

	for (const handler of handlers.get("session_start") ?? []) await handler({});
	expect(tools.get("intercom")?.label).toBe("External Intercom");
	for (const handler of handlers.get("before_agent_start") ?? []) {
		await handler({ systemPrompt: "child" });
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
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		argument === "--extension" && built.args[index + 1] ? [built.args[index + 1] as string] : [],
	);

	expect(extensionPaths[0]).toBe(baseExtension);
	expect(extensionPaths[1]).toBe(configuredExtension);
	expect(extensionPaths.at(-1)?.endsWith("subagent-prompt-runtime.ts")).toBeTrue();
	expect(built.args).toContain("--no-extensions");
	expect(built.toolDiagnosticPath).toBeTruthy();
	expect(built.env[CHILD_TOOL_DIAGNOSTIC_PATH_ENV]).toBe(built.toolDiagnosticPath);

	const explicitlyEmpty = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "Inspect the project.",
		sessionEnabled: false,
		inheritProjectContext: true,
		inheritSkills: true,
		extensions: [],
	});
	if (explicitlyEmpty.tempDir) temporaryDirectories.push(explicitlyEmpty.tempDir);
	expect(explicitlyEmpty.args).toContain(baseExtension);

	const denied = resolvePiLaunchToolPlan({
		extensions: [configuredExtension],
		childBaseExtensionPath: baseExtension,
		capabilityCeiling: {
			version: 1,
			denyExtensions: true,
			sources: ["test"],
		},
	});
	expect(denied.configuredExtensions).toEqual([]);
	expect(denied.extensionArgs).not.toContain(baseExtension);
	expect(denied.extensionArgs).not.toContain(configuredExtension);
	expect(denied.extensionArgs.at(-1)?.endsWith("subagent-prompt-runtime.ts")).toBeTrue();
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
	expect(built.env[SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV]).toBe(
		createHash("sha256").update("Inspect the project.").digest("hex"),
	);
	expect(built.args).toContain(baseExtension);
});

test("passes the frozen Code Mode state through a distinct child environment override", () => {
	const parentValue = process.env[PI_STUFF_CODE_MODE_FROZEN_ENV];
	for (const [codeModeEnabled, expected] of [
		[true, "on"],
		[false, "off"],
	] as const) {
		const built = buildPiArgs({
			baseArgs: ["--mode", "json", "-p"],
			task: "Inspect the project.",
			sessionEnabled: false,
			inheritProjectContext: true,
			inheritSkills: true,
			codeModeEnabled,
		});
		if (built.tempDir) temporaryDirectories.push(built.tempDir);
		expect(built.env[PI_STUFF_CODE_MODE_FROZEN_ENV]).toBe(expected);
	}
	expect(process.env[PI_STUFF_CODE_MODE_FROZEN_ENV]).toBe(parentValue);
});

test("keeps Code Mode carrier Tools available under a strict Agent allowlist and capability ceiling", () => {
	const built = buildPiArgs({
		baseArgs: ["--mode", "json", "-p"],
		task: "Inspect the project.",
		systemPrompt: "Research using the available tools.",
		sessionEnabled: false,
		inheritProjectContext: true,
		inheritSkills: true,
		codeModeEnabled: true,
		codeModeProviderTools: ["codemode", "tool_search"],
		tools: ["read", "web_search", "fetch_content", "get_search_content", "bash"],
		capabilityCeiling: {
			version: 1,
			allowedTools: ["read", "web_search", "fetch_content", "get_search_content"],
			denyExtensions: false,
			sources: ["test"],
		},
	});
	if (built.tempDir) temporaryDirectories.push(built.tempDir);

	expect(built.args).toContain("read,web_search,fetch_content,get_search_content,codemode,tool_search");
	expect(JSON.parse(built.env[REQUIRED_CHILD_TOOLS_ENV] ?? "[]")).toEqual([
		"read",
		"web_search",
		"fetch_content",
		"get_search_content",
		"codemode",
		"tool_search",
	]);
	const promptFlag = built.args.indexOf("--append-system-prompt");
	expect(promptFlag).toBeGreaterThanOrEqual(0);
	const promptPath = built.args[promptFlag + 1];
	expect(promptPath).toBeDefined();
	const prompt = readFileSync(promptPath ?? "", "utf8");
	expect(prompt).toContain("Available tools for this Agent: read, web_search, fetch_content, get_search_content.");
	expect(prompt).not.toContain("Available tools for this Agent: bash");
});

test("forces and verifies read for every skill-enabled explicit Tool shape", () => {
	for (const tools of [[], ["/tmp/child-tool.ts"], ["edit"]]) {
		const plan = resolvePiLaunchToolPlan(
			Object.assign(
				{ tools, requireReadTool: true },
				tools.includes("edit")
					? {
							capabilityCeiling: {
								version: 1 as const,
								allowedTools: ["edit", "read"],
								denyExtensions: false,
								sources: ["test"],
							},
						}
					: undefined,
			),
		);
		expect(plan.effectiveToolAllowlist).toContain("read");
		expect(plan.requiredChildTools).toContain("read");
	}
	const implicit = resolvePiLaunchToolPlan({ requireReadTool: true });
	expect(implicit.requiredChildTools).toContain("read");
});

test("keeps the certified Host grep hang outside explicit child Tool allowlists", () => {
	const plan = resolvePiLaunchToolPlan({ tools: ["read", "grep", "find", "ls", "bash"] });
	expect(plan.effectiveToolAllowlist).toEqual(["read", "find", "ls", "bash"]);
	expect(plan.requiredChildTools).toEqual(["read", "find", "ls", "bash"]);
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
	const handlers = new Map<string, (event: { toolName?: string }) => LifecycleResult>();
	const pi = createExtensionApi({
		on: lifecycleHandler(handlers),
		sendUserMessage: () => Promise.reject(new Error("injected advisory transport failure")),
	});
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
	const handlers = new Map<string, LifecycleHandler[]>();
	const pi = createExtensionApi({
		events: { emit: () => {}, on: () => () => {} },
		getAllTools: () => [],
		on: lifecycleHandlers(handlers),
		registerTool: () => {},
		sendMessage: () => {},
	});
	registerSubagentPromptRuntime(pi);
	let aborts = 0;
	for (const handler of handlers.get("before_provider_request") ?? []) {
		await handler(
			{ payload: { input: "𠮷".repeat(2_000), tools: [{ description: "x".repeat(10_000) }] } },
			{
				model: { contextWindow: 8_000, maxTokens: 2_000 },
				abort: () => {
					aborts += 1;
				},
			},
		);
	}

	expect(aborts).toBe(1);
	expect(readChildToolDiagnosticError(diagnosticPath)).toContain("final child payload");
	expect(validateFinalProviderPayload({ input: "small" }, { contextWindow: 8_000, maxTokens: 2_000 })).toEqual({
		ok: true,
	});
});

test("aborts before the first provider request when a required child Tool is unavailable", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-child-tool-preflight-"));
	temporaryDirectories.push(root);
	const diagnosticPath = join(root, "child-diagnostic.json");
	setEnvironment(CHILD_TOOL_DIAGNOSTIC_PATH_ENV, diagnosticPath);
	setEnvironment(REQUIRED_CHILD_TOOLS_ENV, JSON.stringify(["project_search"]));
	const handlers = new Map<string, LifecycleHandler[]>();
	const pi = createExtensionApi({
		events: { emit: () => {}, on: () => () => {} },
		getAllTools: () => [],
		on: lifecycleHandlers(handlers),
		registerTool: () => {},
		sendMessage: () => {},
	});
	registerSubagentPromptRuntime(pi);
	let aborts = 0;
	for (const handler of handlers.get("before_provider_request") ?? []) {
		await handler(
			{ payload: { input: "Inspect the project." } },
			{
				model: { contextWindow: 8_000, maxTokens: 2_000 },
				abort: () => {
					aborts += 1;
				},
			},
		);
	}

	expect(aborts).toBe(1);
	expect(readChildToolDiagnosticError(diagnosticPath)).toContain("project_search");
});

test("projects long child Tool history before a continuation request while preserving task and steering authority", async () => {
	const handlers = new Map<string, LifecycleHandler[]>();
	const activeTool = {
		name: "read",
		description: "Read bounded project files.",
		parameters: { type: "object", properties: { path: { type: "string" } } },
	};
	const pi = createExtensionApi({
		events: { emit: () => {}, on: () => () => {} },
		getActiveTools: () => ["read"],
		getAllTools: () => [toolInfo(activeTool)],
		on: lifecycleHandlers(handlers),
		registerTool: () => {},
		sendMessage: () => {},
	});
	registerSubagentPromptRuntime(pi);

	const delegatedTask = "DELEGATED_TASK_AUTHORITY: inspect every fixture and finish the requested audit.";
	setEnvironment(SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV, createHash("sha256").update(delegatedTask).digest("hex"));
	const latestSteering = [
		'<pi-stuff-steer request="c3RlZXItYXV0aG9yaXR5">',
		"LATEST_STEERING_AUTHORITY: keep the regression test and report the exact final count.",
		"</pi-stuff-steer>",
	].join("\n");
	const messages: FixtureMessage[] = [
		{ role: "user", content: [{ type: "text", text: `§1§ Task: ${delegatedTask}` }], timestamp: 1 },
	];
	for (const [index, output] of [
		`ASCII_RESULT_START\n${"alpha-0123456789/+= ".repeat(2_500)}\nASCII_RESULT_END`,
		`CJK_RESULT_START\n${"上下文稳定性验证𠮷".repeat(3_000)}\nCJK_RESULT_END`,
		`ENTROPY_RESULT_START\n${"AP6Zz9+/0f3cD7aQ".repeat(3_000)}\nENTROPY_RESULT_END`,
	].entries()) {
		messages.push({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: `Inspecting fixture ${index}. `.repeat(800) },
				{
					type: "toolCall",
					id: `call-${index}`,
					name: "read",
					arguments: { path: `/fixture/${index}.txt`, note: "argument-data-".repeat(800) },
				},
			],
			stopReason: "toolUse",
			timestamp: index * 2 + 2,
		});
		messages.push({
			role: "toolResult",
			toolCallId: `call-${index}`,
			toolName: "read",
			content: [{ type: "text", text: output }],
			isError: false,
			timestamp: index * 2 + 3,
		});
	}
	messages.push({ role: "user", content: [{ type: "text", text: latestSteering }], timestamp: 20 });
	const original = structuredClone(messages);
	const model = {
		provider: "openai-codex",
		id: "fixture-model",
		contextWindow: 120_000,
		maxTokens: 48_000,
	};
	// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
	const ctx = {
		model,
		getSystemPrompt: () => "Child system prompt. ".repeat(300),
	} as never;
	let projected = messages;
	for (const handler of handlers.get("context") ?? []) {
		projected = projectedMessages(await handler({ messages: projected }, ctx), projected);
	}

	expect(messages).toEqual(original);
	const projectedTexts = projected.flatMap((message) => {
		const content = message.content;
		return Array.isArray(content)
			? content.flatMap((part) =>
					part && isRuntimeObject(part) && "text" in part && isRuntimeString(part.text) ? [part.text] : [],
				)
			: isRuntimeString(content)
				? [content]
				: [];
	});
	expect(projectedTexts.some((text) => text.includes(delegatedTask))).toBeTrue();
	expect(projectedTexts).toContain(latestSteering);
	expect(projectedTexts.some((text) => text.includes("compacted for child continuation safety"))).toBeTrue();
	expect(JSON.stringify(projected)).toContain('"id":"call-2"');
	expect(JSON.stringify(projected)).toContain('"toolCallId":"call-2"');
	expect(JSON.stringify(projected)).not.toContain('"id":"call-0"');
	const recentAssistantIndex = projected.findIndex(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some((part) => part && isRuntimeObject(part) && "id" in part && part.id === "call-2"),
	);
	const recentResultIndex = projected.findIndex((message) => message.toolCallId === "call-2");
	expect(recentResultIndex).toBe(recentAssistantIndex + 1);
	const providerPayload = {
		instructions: "Child system prompt. ".repeat(300),
		tools: [activeTool],
		input: projected,
	};
	expect(validateFinalProviderPayload(providerPayload, model)).toEqual({ ok: true });

	let aborts = 0;
	for (const handler of handlers.get("before_provider_request") ?? []) {
		await handler({ payload: providerPayload }, { model, abort: () => (aborts += 1) });
	}
	expect(aborts).toBe(0);
});

test("falls back to a bounded authority-and-recent-Tool continuation when old outputs are extreme", async () => {
	const handlers = new Map<string, LifecycleHandler[]>();
	const activeTool = {
		name: "bash",
		description: "Execute a bounded command.",
		parameters: { type: "object", properties: { command: { type: "string" } } },
	};
	const pi = createExtensionApi({
		events: { emit: () => {}, on: () => () => {} },
		getActiveTools: () => ["bash"],
		getAllTools: () => [toolInfo(activeTool)],
		on: lifecycleHandlers(handlers),
		registerTool: () => {},
		sendMessage: () => {},
	});
	registerSubagentPromptRuntime(pi);
	const task = "EXTREME_TASK_AUTHORITY: complete the long audit.";
	const steering = "EXTREME_STEERING_AUTHORITY: finish with a verification count.";
	setEnvironment(SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV, createHash("sha256").update(task).digest("hex"));
	const messages: FixtureMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: "PARENT_FORK_HISTORY: unrelated earlier user authority." }],
			timestamp: 0,
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "Earlier parent answer." }],
			stopReason: "stop",
			timestamp: 0,
		},
		{ role: "user", content: [{ type: "text", text: `§3§ Task: ${task}` }], timestamp: 1 },
	];
	for (let index = 0; index < 12; index += 1) {
		messages.push({
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "reasoning ".repeat(1_000),
					thinkingSignature: `SIGNED_REASONING_${index}`,
				},
				{ type: "toolCall", id: `extreme-${index}`, name: "bash", arguments: { command: `step-${index}` } },
			],
			stopReason: "toolUse",
			timestamp: index * 2 + 2,
		});
		messages.push({
			role: "toolResult",
			toolCallId: `extreme-${index}`,
			toolName: "bash",
			content: [{ type: "text", text: `RESULT_${index}\n${"AP6Zz9+/0f3cD7aQ".repeat(7_000)}` }],
			isError: false,
			timestamp: index * 2 + 3,
		});
	}
	messages.push({ role: "user", content: [{ type: "text", text: steering }], timestamp: 50 });
	const original = structuredClone(messages);
	const latestAssistant = original.find(
		(message) =>
			message.role === "assistant" &&
			Array.isArray(message.content) &&
			message.content.some((part) => part && isRuntimeObject(part) && "id" in part && part.id === "extreme-11"),
	);
	const model = { provider: "openai-codex", contextWindow: 100_000, maxTokens: 40_000 };
	let projected = messages;
	for (const handler of handlers.get("context") ?? []) {
		projected = projectedMessages(
			await handler({ messages: projected }, { model, getSystemPrompt: () => "Child prompt. ".repeat(200) }),
			projected,
		);
	}
	const serialized = JSON.stringify(projected);
	expect(messages).toEqual(original);
	expect(serialized).toContain(task);
	expect(serialized).toContain(steering);
	expect(serialized).not.toContain("PARENT_FORK_HISTORY");
	expect(serialized).toContain("omitted");
	expect(serialized).toContain("Do not rerun completed verification solely because older evidence was omitted.");
	expect(serialized).toContain('"id":"extreme-11"');
	expect(serialized).toContain('"toolCallId":"extreme-11"');
	const projectedLatestAssistant = projected.find(
		(message) =>
			message.role === "assistant" &&
			Array.isArray(message.content) &&
			message.content.some((part) => part && isRuntimeObject(part) && "id" in part && part.id === "extreme-11"),
	);
	expect(projectedLatestAssistant).toEqual(latestAssistant);
	const latestAssistantIndex = projectedLatestAssistant ? projected.indexOf(projectedLatestAssistant) : -1;
	const latestResultIndex = projected.findIndex((message) => message.toolCallId === "extreme-11");
	expect(latestAssistantIndex).toBeGreaterThanOrEqual(0);
	expect(latestResultIndex).toBe(latestAssistantIndex + 1);
	expect(
		validateFinalProviderPayload(
			{ instructions: "Child prompt. ".repeat(200), tools: [activeTool], input: projected },
			model,
		),
	).toEqual({ ok: true });
});

test("projects oversized non-text Tool evidence without breaking the signed recent Tool exchange", async () => {
	const handlers = new Map<string, LifecycleHandler[]>();
	const activeTool = {
		name: "screenshot",
		description: "Capture the current screen.",
		parameters: { type: "object", properties: {} },
	};
	const pi = createExtensionApi({
		events: { emit: () => {}, on: () => () => {} },
		getActiveTools: () => ["screenshot"],
		getAllTools: () => [toolInfo(activeTool)],
		on: lifecycleHandlers(handlers),
		registerTool: () => {},
		sendMessage: () => {},
	});
	registerSubagentPromptRuntime(pi);
	const task = "Inspect the captured screen and continue.";
	setEnvironment(SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV, createHash("sha256").update(task).digest("hex"));
	const signedAssistant = {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Inspect visually.", thinkingSignature: "SIGNED_SCREEN_REASONING" },
			{ type: "toolCall", id: "screenshot-call", name: "screenshot", arguments: {} },
		],
		stopReason: "toolUse",
		timestamp: 2,
	};
	const messages: FixtureMessage[] = [
		{ role: "user", content: [{ type: "text", text: `§1§ Task: ${task}` }], timestamp: 1 },
		signedAssistant,
		{
			role: "toolResult",
			toolCallId: "screenshot-call",
			toolName: "screenshot",
			content: [{ type: "image", mimeType: "image/png", data: "AP6Zz9+/0f3cD7aQ".repeat(4_000) }],
			isError: false,
			timestamp: 3,
		},
	];
	const model = { provider: "openai", id: "unknown-azure-deployment", contextWindow: 100_000, maxTokens: 40_000 };
	let projected = messages;
	for (const handler of handlers.get("context") ?? []) {
		projected = projectedMessages(
			await handler({ messages: projected }, { model, getSystemPrompt: () => "Child prompt." }),
			projected,
		);
	}

	expect(projected).not.toBe(messages);
	expect(projected[1]).toEqual(signedAssistant);
	expect(JSON.stringify(projected[2])).toContain("image Tool content omitted");
	expect(projected[2]?.toolCallId).toBe("screenshot-call");
	expect(
		validateFinalProviderPayload({ instructions: "Child prompt.", tools: [activeTool], input: projected }, model),
	).toEqual({ ok: true });
});

test("labels an irreducible oversized request as a continuation after a resumed child session", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-stuff-child-continuation-guard-"));
	temporaryDirectories.push(root);
	const diagnosticPath = join(root, "child-diagnostic.json");
	setEnvironment(CHILD_TOOL_DIAGNOSTIC_PATH_ENV, diagnosticPath);
	const handlers = new Map<string, LifecycleHandler[]>();
	const pi = createExtensionApi({
		events: { emit: () => {}, on: () => () => {} },
		getActiveTools: () => [],
		getAllTools: () => [],
		on: lifecycleHandlers(handlers),
		registerTool: () => {},
		sendMessage: () => {},
	});
	registerSubagentPromptRuntime(pi);
	for (const handler of handlers.get("session_start") ?? []) {
		await handler({ reason: "resume" }, {});
	}
	let aborts = 0;
	for (const handler of handlers.get("before_provider_request") ?? []) {
		await handler(
			{ payload: { input: "AP6Zz9+/0f3cD7aQ".repeat(4_000) } },
			{
				model: { provider: "openai-codex", contextWindow: 80_000, maxTokens: 32_000 },
				abort: () => (aborts += 1),
			},
		);
	}

	expect(aborts).toBe(1);
	const diagnostic = readChildToolDiagnosticError(diagnosticPath) ?? "";
	expect(diagnostic).toContain("Agent continuation stopped");
	expect(diagnostic).not.toContain("Agent launch stopped");
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

	const unknownEncoding = validateFinalProviderPayload(
		{ input: "A".repeat(30_000) },
		{ provider: "openai", id: "unknown-deployment", contextWindow: 80_000, maxTokens: 32_000 },
	);
	expect(unknownEncoding.ok).toBeFalse();
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
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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

	const handlers = new Map<string, (event: LifecycleEvent) => LifecycleResult>();
	const delivered: string[] = [];
	const pi = createExtensionApi({
		on: lifecycleHandler(handlers),
		sendUserMessage: (content: string) => delivered.push(content),
	});
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
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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

	const handlers = new Map<string, (event: LifecycleEvent) => LifecycleResult>();
	const delivered: string[] = [];
	const pi = createExtensionApi({
		on: lifecycleHandler(handlers),
		sendUserMessage: (content: string) => delivered.push(content),
	});
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
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
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

	const handlers = new Map<string, (event: LifecycleEvent) => LifecycleResult>();
	const delivered: string[] = [];
	registerSteeringInbox(
		createExtensionApi({
			on: lifecycleHandler(handlers),
			sendUserMessage: (content: string) => delivered.push(content),
		}),
	);
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
	const firstHandlers = new Map<string, (event: LifecycleEvent) => LifecycleResult>();
	const firstDeliveries: string[] = [];
	registerSteeringInbox(
		createExtensionApi({
			on: lifecycleHandler(firstHandlers),
			sendUserMessage: (content: string) => firstDeliveries.push(content),
		}),
	);
	firstHandlers.get("session_start")?.({});
	writeSteerRequestToDir(inbox, request);
	firstHandlers.get("agent_start")?.({});
	expect(firstDeliveries).toHaveLength(1);
	expect(readdirSync(inbox).some((entry) => entry.includes(".pi-stuff-inflight."))).toBeTrue();
	firstHandlers.get("session_shutdown")?.({});

	const replacementHandlers = new Map<string, (event: LifecycleEvent) => LifecycleResult>();
	const replacementDeliveries: string[] = [];
	registerSteeringInbox(
		createExtensionApi({
			on: lifecycleHandler(replacementHandlers),
			sendUserMessage: (content: string) => replacementDeliveries.push(content),
		}),
	);
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

	const handlers = new Map<string, (event: LifecycleEvent) => LifecycleResult>();
	const delivered: string[] = [];
	registerSteeringInbox(
		createExtensionApi({
			on: lifecycleHandler(handlers),
			sendUserMessage: (content: string) => delivered.push(content),
		}),
	);
	handlers.get("session_start")?.({});
	handlers.get("agent_start")?.({});
	expect(delivered).toEqual([]);
	expect(
		readdirSync(inbox).filter((entry) => entry.endsWith(".json") || entry.includes(".pi-stuff-inflight.")),
	).toEqual([]);
	handlers.get("session_shutdown")?.({});
});
