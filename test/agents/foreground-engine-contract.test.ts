import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../packages/pi-stuff-agents/src/agents/agents.js";
import { projectForegroundCompletion } from "../../packages/pi-stuff-agents/src/runs/foreground/execution.js";
import { createSubagentExecutor } from "../../packages/pi-stuff-agents/src/runs/foreground/subagent-executor.js";
import type { SubagentState } from "../../packages/pi-stuff-agents/src/shared/types.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function agent(): AgentConfig {
	return {
		name: "general-purpose",
		description: "General Agent",
		systemPrompt: "Complete the delegated task.",
		systemPromptMode: "append",
		inheritProjectContext: true,
		inheritSkills: true,
		source: "builtin",
		filePath: "/agents/general-purpose.md",
	};
}

function state(): SubagentState {
	return {
		baseCwd: "",
		currentSessionId: null,
		asyncJobs: new Map(),
		recentAgentJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

function context(
	cwd: string,
	models: Array<{ provider: string; id: string; contextWindow: number; maxTokens: number }> = [],
	usageTokens?: number,
): ExtensionContext {
	return {
		cwd,
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: { getAvailable: () => models },
		sessionManager: {
			buildContextEntries: () => [],
			getLeafId: () => "leaf",
			getSessionFile: () => path.join(cwd, "parent.jsonl"),
			getSessionId: () => "parent-session",
			openSession: () => ({ createBranchedSession: () => path.join(cwd, "parent.jsonl") }),
		},
		getContextUsage: () =>
			usageTokens === undefined ? undefined : { tokens: usageTokens, contextWindow: 200_000, percent: 1 },
	} as unknown as ExtensionContext;
}

function executor(
	cwd: string,
	runState: SubagentState,
	onBackgroundSingle?: (launch: { description?: string; task: string }) => void,
	options: {
		agent?: AgentConfig;
		projectContext?: Parameters<typeof createSubagentExecutor>[0]["projectContext"];
	} = {},
) {
	const pi = { events: { emit: () => {} } } as unknown as ExtensionAPI;
	return createSubagentExecutor({
		pi,
		state: runState,
		config: { artifactDir: "temp", maxSubagentDepth: 3 },
		asyncByDefault: true,
		tempArtifactsDir: cwd,
		getSubagentSessionRoot: () => path.join(cwd, "sessions"),
		expandTilde: (value) => value,
		discoverAgents: () => ({ agents: [options.agent ?? agent()] }),
		projectContext: options.projectContext,
		engines: {
			backgroundSingle: (id, launch) => {
				onBackgroundSingle?.(launch);
				return {
					content: [{ type: "text", text: `Background Agent started [${id}]` }],
					details: { asyncId: id, mode: "single", results: [], runId: id },
				};
			},
			foreground: async (config) =>
				projectForegroundCompletion(config, {
					id: config.id,
					runId: config.id,
					mode: config.work.mode,
					state: "complete",
					success: true,
					results: (config.work.mode === "single" ? [config.work.task] : config.work.group.tasks).map(
						(task, index) => ({
							agent: task.agent,
							context: task.context,
							output: `result-${index + 1}`,
							success: true,
							exitCode: 0,
							sessionFile: path.join(cwd, `child-${index}.jsonl`),
						}),
					),
				}),
		},
	});
}

describe("reduced foreground Agent engine", () => {
	test("single foreground execution completes through the shared v2 runner shape", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-single-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runState = state();
		const result = await executor(cwd, runState).execute(
			"single-call",
			{ agent: "general-purpose", task: "Inspect the parser", async: false, context: "fresh" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(result.isError).not.toBe(true);
		expect(result.details.mode).toBe("single");
		expect(result.details.results.map((child) => child.finalOutput)).toEqual(["result-1"]);
		expect(runState.foregroundControls.size).toBe(0);
		expect(runState.foregroundRuns?.size).toBe(1);
	});

	test("parallel foreground execution completes as one bounded group", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-parallel-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const runState = state();
		const result = await executor(cwd, runState).execute(
			"parallel-call",
			{
				async: false,
				context: "fresh",
				tasks: [
					{ agent: "general-purpose", task: "Implement" },
					{ agent: "general-purpose", task: "Review" },
				],
			},
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(result.isError).not.toBe(true);
		expect(result.details.mode).toBe("parallel");
		expect(result.details.results.map((child) => child.finalOutput)).toEqual(["result-1", "result-2"]);
	});

	test("fits the private Context projection to the tightest child fallback model", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let captured: { description?: string; task: string } | undefined;
		const requestedBudgets: number[] = [];
		const smallAgent = { ...agent(), model: "test/large", fallbackModels: ["test/small"] };
		await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: smallAgent,
				projectContext: async (_audience, _ctx, projectionOptions) => {
					requestedBudgets.push(projectionOptions?.maxTokens ?? -1);
					return {
						source: "magic-context",
						text: '<pi-stuff-context trust="reference-only">memory</pi-stuff-context>',
						truncated: false,
					};
				},
			},
		).execute(
			"context-call",
			{
				agent: "general-purpose",
				context: "fresh",
				task: "Inspect the parser",
			},
			new AbortController().signal,
			undefined,
			context(cwd, [
				{ provider: "test", id: "large", contextWindow: 128_000, maxTokens: 8_000 },
				{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 },
			]),
		);

		expect(requestedBudgets).toHaveLength(1);
		expect(requestedBudgets[0]).toBeGreaterThan(0);
		expect(requestedBudgets[0]).toBeLessThanOrEqual(4_000);
		expect(captured?.task).toBe(
			'<pi-stuff-context trust="reference-only">memory</pi-stuff-context>\n\nInspect the parser',
		);
	});

	test("subtracts inherited fork usage from the child projection budget", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-fork-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const requestedBudgets: number[] = [];
		await executor(cwd, state(), undefined, {
			agent: { ...agent(), model: "test/small" },
			projectContext: async (_audience, _ctx, projectionOptions) => {
				requestedBudgets.push(projectionOptions?.maxTokens ?? -1);
				return { source: "magic-context", text: "memory", truncated: false };
			},
		}).execute(
			"fork-budget-call",
			{ agent: "general-purpose", context: "fork", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }], 3_500),
		);

		expect(requestedBudgets).toHaveLength(1);
		expect(requestedBudgets[0]).toBeGreaterThan(0);
		expect(requestedBudgets[0]).toBeLessThanOrEqual(500);
	});

	test("launches without a projection when model limits are unknown", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-unknown-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let projections = 0;
		let captured: { task: string } | undefined;
		await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				projectContext: async () => {
					projections++;
					throw new Error("projection should not be requested");
				},
			},
		).execute(
			"unknown-budget-call",
			{ agent: "general-purpose", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		expect(projections).toBe(0);
		expect(captured?.task).toBe("Inspect the parser");
	});

	test("launches without a projection when Context fails open", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-context-failure-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		let projections = 0;
		let captured: { task: string } | undefined;
		await executor(
			cwd,
			state(),
			(launch) => {
				captured = launch;
			},
			{
				agent: { ...agent(), model: "test/small" },
				projectContext: async () => {
					projections++;
					throw new Error("Magic unavailable");
				},
			},
		).execute(
			"failed-projection-call",
			{ agent: "general-purpose", task: "Inspect the parser" },
			new AbortController().signal,
			undefined,
			context(cwd, [{ provider: "test", id: "small", contextWindow: 8_000, maxTokens: 2_000 }]),
		);

		expect(projections).toBe(1);
		expect(captured?.task).toBe("Inspect the parser");
	});

	test("resume labels the revived Agent from the follow-up while preserving the recovery task", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-foreground-resume-"));
		temporaryDirectories.push(cwd);
		fs.writeFileSync(path.join(cwd, "parent.jsonl"), "");
		const childSession = path.join(cwd, "child.jsonl");
		fs.writeFileSync(childSession, "");
		const runState = state();
		const sessionIdentity = path.join(cwd, "parent.jsonl");
		runState.currentSessionId = sessionIdentity;
		runState.foregroundRuns?.set("source-run", {
			children: [
				{
					agent: "general-purpose",
					index: 0,
					sessionFile: childSession,
					status: "completed",
					task: "Inspect every parser edge case in full detail",
				},
			],
			cwd,
			mode: "single",
			runId: "source-run",
			sessionId: sessionIdentity,
			updatedAt: 1_000,
		});
		let captured: { description?: string; task: string } | undefined;
		const result = await executor(cwd, runState, (launch) => {
			captured = launch;
		}).execute(
			"resume-call",
			{ action: "resume", id: "source-run", message: "复核恢复结果 🧪" },
			new AbortController().signal,
			undefined,
			context(cwd),
		);

		if (result.isError) {
			throw new Error(result.content.map((part) => ("text" in part ? part.text : "")).join("\n"));
		}
		expect(captured?.description).toBe("复核恢复结果 🧪");
		expect(captured?.task).toContain("复核恢复结果 🧪");
		expect(captured?.task).toContain("source-run");
	});

	test("the private executor contract contains no removed orchestration fields or legacy branches", () => {
		const root = path.resolve(import.meta.dir, "../..");
		const executorSource = fs.readFileSync(
			path.join(root, "packages/pi-stuff-agents/src/runs/foreground/subagent-executor.ts"),
			"utf8",
		);
		const executionSource = fs.readFileSync(
			path.join(root, "packages/pi-stuff-agents/src/runs/foreground/execution.ts"),
			"utf8",
		);
		const params = executorSource.match(/export interface SubagentParamsLike \{([\s\S]*?)\n\}/)?.[1] ?? "";
		for (const field of [
			"acceptance",
			"agentContract",
			"chain",
			"dynamic",
			"outputPath",
			"progress",
			"share",
			"structuredOutput",
			"workflow",
		]) {
			expect(params).not.toMatch(new RegExp(`\\b${field}\\??:`));
		}
		for (const removedModule of [
			"agent-memory",
			"acceptance",
			"agent-contract",
			"completion-guard",
			"dynamic-fanout",
			"intercom",
			"long-running-guard",
			"parallel-handoff",
			"single-output",
			"structured-output",
		]) {
			expect(`${executorSource}\n${executionSource}`).not.toContain(`/${removedModule}.ts`);
		}
	});
});
