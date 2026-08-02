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

function context(cwd: string): ExtensionContext {
	return {
		cwd,
		hasUI: true,
		model: { provider: "test", id: "model" },
		modelRegistry: { getAvailable: () => [] },
		sessionManager: {
			getSessionFile: () => path.join(cwd, "parent.jsonl"),
			getSessionId: () => "parent-session",
		},
	} as unknown as ExtensionContext;
}

function executor(cwd: string, runState: SubagentState) {
	const pi = { events: { emit: () => {} } } as unknown as ExtensionAPI;
	return createSubagentExecutor({
		pi,
		state: runState,
		config: { artifactDir: "temp", maxSubagentDepth: 3 },
		asyncByDefault: true,
		tempArtifactsDir: cwd,
		getSubagentSessionRoot: () => path.join(cwd, "sessions"),
		expandTilde: (value) => value,
		discoverAgents: () => ({ agents: [agent()] }),
		engines: {
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
