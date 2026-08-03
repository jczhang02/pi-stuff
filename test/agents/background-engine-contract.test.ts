import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "../../packages/pi-stuff-agents/src/agents/agents.js";
import {
	buildAsyncParallelRunnerWork,
	buildAsyncSingleRunnerWork,
} from "../../packages/pi-stuff-agents/src/runs/background/async-execution.js";
import { readAsyncRecoveryDescriptor } from "../../packages/pi-stuff-agents/src/runs/background/async-resume.js";
import {
	buildWriterProcessEnv,
	createBackgroundCompletion,
	createInitialStatus,
	runBackgroundWork,
	runConfiguredBackground,
} from "../../packages/pi-stuff-agents/src/runs/background/subagent-runner.js";
import type {
	BackgroundRunnerConfig,
	RunnerAgentTask,
} from "../../packages/pi-stuff-agents/src/runs/shared/parallel-utils.js";
import {
	projectAgentDefinition,
	projectLaunchBinding,
} from "../../packages/pi-stuff-agents/src/shared/launch-contract.js";

const temporaryDirectories: string[] = [];
const originalPiBinary = process.env.PI_SUBAGENT_PI_BINARY;

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
	if (originalPiBinary === undefined) delete process.env.PI_SUBAGENT_PI_BINARY;
	else process.env.PI_SUBAGENT_PI_BINARY = originalPiBinary;
});

function fixtureRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-background-contract-"));
	temporaryDirectories.push(root);
	fs.mkdirSync(path.join(root, "skills", "review"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "skills", "review", "SKILL.md"),
		"---\nname: review\ndescription: Review a change\n---\nReview the implementation carefully.\n",
	);
	fs.mkdirSync(path.join(root, "packages", "core"), { recursive: true });
	return root;
}

function agent(root: string, name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: `${name} fixture`,
		systemPrompt: `You are ${name}.`,
		systemPromptMode: "append",
		inheritProjectContext: true,
		inheritSkills: false,
		source: "project",
		filePath: path.join(root, `${name}.md`),
		skillPath: [path.join(root, "skills")],
		...overrides,
	};
}

function buildContext(root: string) {
	return {
		pi: { events: { emit() {} } } as never,
		cwd: root,
		currentSessionId: "parent-session",
		parentSessionId: "parent-session",
		currentModelProvider: "provider",
		currentModel: { provider: "provider", id: "parent" },
	};
}

describe("background runner configuration", () => {
	test("launch evidence contains current limits but ignores retired Agent features", () => {
		const root = fixtureRoot();
		const configured = {
			...agent(root, "writer"),
			memory: { scope: "project", path: "/retired" },
			completionGuard: true,
			output: "/retired/output",
		} as AgentConfig & Record<string, unknown>;

		const definition = projectAgentDefinition(configured);
		const binding = projectLaunchBinding({
			definitionDigest: "definition",
			inheritProjectContext: true,
			inheritSkills: false,
			turnBudget: { maxTurns: 8, graceTurns: 2 },
			toolBudget: { hard: 12, soft: 9, block: ["read"] },
			maxSubagentDepth: 2,
			capabilityCeiling: { version: 1, allowedTools: ["read"] },
		});

		expect(definition.version).toBe(2);
		expect(definition).not.toHaveProperty("memory");
		expect(definition).not.toHaveProperty("completionGuard");
		expect(definition).not.toHaveProperty("output");
		expect(binding).toMatchObject({
			version: 2,
			turnBudget: { maxTurns: 8, graceTurns: 2 },
			toolBudget: { hard: 12, soft: 9, block: ["read"] },
			maxSubagentDepth: 2,
			capabilityCeiling: { version: 1, allowedTools: ["read"] },
		});
	});

	test("increments nested depth without leaking detached-runner identity", () => {
		const writerEnv = buildWriterProcessEnv(
			{
				PATH: "/bin",
				PI_SUBAGENT_DEPTH: "1",
				PI_SUBAGENT_MAX_DEPTH: "9",
				PI_STUFF_BACKGROUND_RUNNER: "1",
				PI_STUFF_BACKGROUND_RUNNER_CONFIG: "/tmp/runner.json",
			},
			{
				CHILD_SETTING: "enabled",
				PI_SUBAGENT_DEPTH: "99",
				PI_SUBAGENT_MAX_DEPTH: "99",
				PI_STUFF_BACKGROUND_RUNNER: "1",
				PI_STUFF_BACKGROUND_RUNNER_CONFIG: "/tmp/override.json",
			},
			3,
		);

		expect(writerEnv.PATH).toBe("/bin");
		expect(writerEnv.CHILD_SETTING).toBe("enabled");
		expect(writerEnv.PI_SUBAGENT_DEPTH).toBe("2");
		expect(writerEnv.PI_SUBAGENT_MAX_DEPTH).toBe("3");
		expect(writerEnv.PI_STUFF_BACKGROUND_RUNNER).toBeUndefined();
		expect(writerEnv.PI_STUFF_BACKGROUND_RUNNER_CONFIG).toBeUndefined();
	});

	test("creates a runnable lifecycle status before child launch", () => {
		const root = fixtureRoot();
		const startedAt = 123_456;
		const task: RunnerAgentTask = {
			agent: "writer",
			description: "Implement parser change",
			task: "Implement",
			cwd: root,
			context: "fresh",
			systemPrompt: "You are writer.",
			systemPromptMode: "append",
			inheritProjectContext: true,
			inheritSkills: false,
			maxSubagentDepth: 1,
		};
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "runtime-status",
			cwd: root,
			asyncDir: path.join(root, "async"),
			resultPath: path.join(root, "result.json"),
			work: { mode: "single", task },
		};

		const status = createInitialStatus(config, startedAt);

		expect(status.lifecycleArtifactVersion).toBe(3);
		expect(status.runId).toBe("runtime-status");
		expect(status.state).toBe("running");
		expect(status.steps).toHaveLength(1);
		expect(status.steps[0]).toMatchObject({
			agent: "writer",
			label: "Implement parser change",
			status: "pending",
			task: "Implement",
		});
	});

	test("keeps the detached runner independent from Host UI description fallback", () => {
		const root = fixtureRoot();
		const task: RunnerAgentTask = {
			agent: "legacy-writer",
			task: "Inspect /tmp/deep/sample.txt without changing it",
			cwd: root,
			inheritProjectContext: true,
			inheritSkills: false,
		};
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "legacy-runtime-status",
			cwd: root,
			asyncDir: path.join(root, "async"),
			resultPath: path.join(root, "result.json"),
			work: { mode: "single", task },
		};

		const [step] = createInitialStatus(config, 123_456).steps;

		expect(step).toMatchObject({ agent: "legacy-writer", task: task.task, status: "pending" });
		expect(step).not.toHaveProperty("label");
	});

	test("builds one parallel group and resolves every task override before persistence", () => {
		const root = fixtureRoot();
		const agents = [
			agent(root, "writer", {
				model: "provider/writer-default",
				defaultTurnBudget: { maxTurns: 20, graceTurns: 3 },
				toolBudget: { hard: 30, soft: 20 },
			}),
			agent(root, "reviewer", {
				model: "provider/reviewer-default",
				defaultTurnBudget: { maxTurns: 18, graceTurns: 2 },
				toolBudget: { hard: 15 },
			}),
		];

		const built = buildAsyncParallelRunnerWork("run-parallel", {
			tasks: [
				{
					agent: "writer",
					description: "Implement core change",
					task: "Implement",
					cwd: "packages/core",
					model: "provider/fast",
					skill: "review",
					turnBudget: { maxTurns: 7, graceTurns: 1 },
					toolBudget: { hard: 9, soft: 6, block: ["browser"] },
				},
				{ agent: "reviewer", description: "Review core change", task: "Review", skill: ["review"] },
			],
			agents,
			ctx: buildContext(root),
			cwd: root,
			contextForAgent: () => "fork",
			thinking: "high",
			turnBudget: { maxTurns: 12, graceTurns: 2 },
			toolBudget: { hard: 14, soft: 10, block: ["read"] },
			configToolBudget: { hard: 40, block: ["read"] },
			concurrency: 2,
			worktree: false,
			maxSubagentDepth: 3,
		});

		expect("error" in built).toBe(false);
		if ("error" in built) throw new Error(built.error);
		expect(built.work.mode).toBe("parallel");
		if (built.work.mode !== "parallel") throw new Error("Expected parallel work");
		expect(built.work.group.concurrency).toBe(2);
		expect(built.work.group.tasks).toHaveLength(2);
		expect(built.work.group.tasks[0]).toMatchObject({
			agent: "writer",
			description: "Implement core change",
			task: "Implement",
			cwd: path.join(root, "packages", "core"),
			context: "fork",
			model: "provider/fast",
			thinking: "high",
			skills: ["review"],
			turnBudget: { maxTurns: 7, graceTurns: 1 },
			toolBudget: { hard: 9, soft: 6, block: ["browser"] },
		});
		expect(built.work.group.tasks[1]).toMatchObject({
			agent: "reviewer",
			description: "Review core change",
			task: "Review",
			cwd: root,
			context: "fork",
			model: "provider/reviewer-default",
			thinking: "high",
			skills: ["review"],
			turnBudget: { maxTurns: 12, graceTurns: 2 },
			toolBudget: { hard: 14, soft: 10, block: ["read"] },
		});
	});

	test("single recovery data retains the child session and limits without retired features", () => {
		const root = fixtureRoot();
		const built = buildAsyncSingleRunnerWork("run-single", {
			agent: "writer",
			task: "Continue the implementation",
			agentConfig: agent(root, "writer"),
			ctx: buildContext(root),
			cwd: root,
			context: "fork",
			sessionFile: path.join(root, "child.jsonl"),
			turnBudget: { maxTurns: 8, graceTurns: 2 },
			toolBudget: { hard: 11, block: ["read"] },
			maxSubagentDepth: 2,
			capabilityCeiling: {
				version: 1,
				allowedTools: ["read", "edit"],
				denyExtensions: false,
				sources: ["test"],
			},
		});

		expect("error" in built).toBe(false);
		if ("error" in built) throw new Error(built.error);
		expect(built.work.mode).toBe("single");
		expect(built.recovery).toMatchObject({
			version: 2,
			sourceRunId: "run-single",
			agent: "writer",
			sessionFile: path.join(root, "child.jsonl"),
			context: "fork",
			initialTurnBudget: { maxTurns: 8, graceTurns: 2 },
			initialToolBudget: { hard: 11, block: ["read"] },
			capabilityCeiling: {
				version: 1,
				allowedTools: ["read", "edit"],
				denyExtensions: false,
				sources: ["test"],
			},
		});
		for (const retired of [
			"acceptance",
			"agentContract",
			"completionGuard",
			"memory",
			"outputMode",
			"outputPath",
			"share",
			"structuredOutputSchema",
		]) {
			expect(retired in built.recovery).toBe(false);
		}
	});

	test("reads the selected child from a version 2 parallel recovery collection", () => {
		const root = fixtureRoot();
		const built = buildAsyncParallelRunnerWork("recover-parallel", {
			tasks: [
				{ agent: "writer", task: "Write" },
				{ agent: "reviewer", task: "Review" },
			],
			agents: [agent(root, "writer"), agent(root, "reviewer")],
			ctx: buildContext(root),
			maxSubagentDepth: 2,
		});
		expect("error" in built).toBe(false);
		if ("error" in built) throw new Error(built.error);
		const asyncDir = path.join(root, "async", "recover-parallel");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(
			path.join(asyncDir, "recovery-descriptors.json"),
			JSON.stringify({ version: 2, children: built.recoveries }),
		);

		const descriptor = readAsyncRecoveryDescriptor(asyncDir, 1);

		expect(descriptor).toMatchObject({
			version: 2,
			sourceRunId: "recover-parallel",
			childIndex: 1,
			agent: "reviewer",
			cwd: root,
			maxSubagentDepth: 2,
		});
		expect(readAsyncRecoveryDescriptor(asyncDir)).toBeUndefined();
	});
});

describe("background runner execution", () => {
	function task(index: number): RunnerAgentTask {
		return {
			agent: `agent-${index}`,
			task: `task-${index}`,
			cwd: "/tmp",
			inheritProjectContext: true,
			inheritSkills: false,
		};
	}

	test("honors group concurrency and produces direct parallel children", async () => {
		let active = 0;
		let peak = 0;
		const work = {
			mode: "parallel" as const,
			group: { tasks: [task(0), task(1), task(2)], concurrency: 2, worktree: false },
		};
		const results = await runBackgroundWork(work, async (child, index) => {
			active++;
			peak = Math.max(peak, active);
			await Bun.sleep(5);
			active--;
			return { agent: child.agent, output: `done-${index}`, success: true, exitCode: 0 };
		});
		expect(peak).toBe(2);
		expect(results.map((result) => result.output)).toEqual(["done-0", "done-1", "done-2"]);

		const config = {
			version: 2,
			id: "run-parallel",
			work,
			resultPath: "/tmp/result.json",
			cwd: "/tmp",
			asyncDir: "/tmp/run-parallel",
			sessionId: "parent-session",
		} satisfies BackgroundRunnerConfig;
		const completion = createBackgroundCompletion(config, results, 100, 200);
		expect(completion).toMatchObject({
			id: "run-parallel",
			runId: "run-parallel",
			mode: "parallel",
			state: "complete",
			success: true,
			results: [
				{ agent: "agent-0", output: "done-0", success: true },
				{ agent: "agent-1", output: "done-1", success: true },
				{ agent: "agent-2", output: "done-2", success: true },
			],
		});
		expect(completion).not.toHaveProperty("chain");
		expect(completion).not.toHaveProperty("workflowGraph");
	});

	test("does not start queued children after a stop and records a stopped completion", async () => {
		const controller = new AbortController();
		const started: number[] = [];
		const work = {
			mode: "parallel" as const,
			group: { tasks: [task(0), task(1), task(2)], concurrency: 1, worktree: false },
		};
		const results = await runBackgroundWork(
			work,
			async (child, index) => {
				started.push(index);
				controller.abort("stopped");
				return { agent: child.agent, output: "stopped", success: false, exitCode: 1, stopped: true };
			},
			{ signal: controller.signal },
		);
		expect(started).toEqual([0]);
		expect(results).toHaveLength(3);
		expect(results.every((result) => result.stopped)).toBe(true);

		const config = {
			version: 2,
			id: "run-stopped",
			work,
			resultPath: "/tmp/result.json",
			cwd: "/tmp",
			asyncDir: "/tmp/run-stopped",
		} satisfies BackgroundRunnerConfig;
		expect(createBackgroundCompletion(config, results, 100, 200)).toMatchObject({
			state: "stopped",
			success: false,
			stopped: true,
		});
	});

	test("keeps a steered writer alive when new input follows a valid terminal report", async () => {
		const root = fixtureRoot();
		const writer = path.join(root, "steered-writer.ts");
		fs.writeFileSync(
			writer,
			`#!/usr/bin/env bun
const assistant = (text) => ({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
});
const user = (text) => ({
  type: "message_end",
  message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
});
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
process.on("SIGTERM", () => process.exit(143));
emit(assistant("VALID_COMPLETED_REVIEW"));
setTimeout(() => emit(user("Late correlated steering input")), 25);
setTimeout(() => emit(assistant("VALID_COMPLETED_REVIEW_AFTER_STEERING")), 1_200);
setTimeout(() => process.exit(0), 1_225);
`,
			{ mode: 0o700 },
		);
		process.env.PI_SUBAGENT_PI_BINARY = writer;
		const asyncDir = path.join(root, "async");
		const resultPath = path.join(asyncDir, "result.json");
		const config: BackgroundRunnerConfig = {
			version: 2,
			id: "steered-terminal-report",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: task(0) },
		};

		await runConfiguredBackground(config);
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			success: boolean;
			results: Array<{ exitCode: number | null; output: string; success: boolean }>;
		};

		expect(completion).toMatchObject({
			state: "complete",
			success: true,
			results: [
				{
					exitCode: 0,
					output: "VALID_COMPLETED_REVIEW_AFTER_STEERING",
					success: true,
				},
			],
		});
	}, 5_000);
});
