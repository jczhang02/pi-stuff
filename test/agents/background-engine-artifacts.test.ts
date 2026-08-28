import { afterEach, expect, test } from "bun:test";
import {
	type BackgroundRunnerConfig,
	cleanupBackgroundEngineFixtures,
	fixtureRoot,
	fs,
	path,
	runConfiguredBackground,
	task,
} from "./background-engine-fixtures.js";

afterEach(cleanupBackgroundEngineFixtures);

test("keeps a valid Agent result when its optional artifact directory disappears", async () => {
	const root = fixtureRoot();
	const artifactsDir = path.join(root, "artifacts");
	const writer = path.join(root, "artifact-loss-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
import * as fs from "node:fs";
fs.rmSync(${JSON.stringify(artifactsDir)}, { recursive: true, force: true });
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_AFTER_ARTIFACT_LOSS" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async");
	const resultPath = path.join(asyncDir, "result.json");
	const config: BackgroundRunnerConfig = {
		version: 2,
		id: "artifact-directory-loss",
		cwd: root,
		asyncDir,
		resultPath,
		artifactsDir,
		artifactConfig: { enabled: true },
		work: { mode: "single", task: { ...task(0), cwd: root } },
	};

	await runConfiguredBackground(config);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{
			artifactPaths?: { outputPath: string; metadataPath: string };
			output: string;
			success: boolean;
			transcriptError?: string;
		}>;
	};
	const child = completion.results[0];
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
		steps: Array<{ finalOutput?: string; savedOutputPath?: string }>;
	};

	expect(completion).toMatchObject({
		state: "complete",
		success: true,
		results: [{ output: "VALID_AFTER_ARTIFACT_LOSS", success: true }],
	});
	expect(child?.transcriptError).toContain("Failed to write child transcript");
	expect(status.steps[0]).toMatchObject({
		finalOutput: "VALID_AFTER_ARTIFACT_LOSS",
		savedOutputPath: child?.artifactPaths?.outputPath,
	});
	expect(child?.artifactPaths && fs.existsSync(child.artifactPaths.outputPath)).toBe(true);
	expect(child?.artifactPaths && fs.existsSync(child.artifactPaths.metadataPath)).toBe(true);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const metadata = JSON.parse(fs.readFileSync(child?.artifactPaths?.metadataPath ?? "", "utf8")) as {
		state?: string;
	};
	expect(metadata.state).toBe("complete");
}, 5_000);

test("bounds aggregate newline-delimited child protocol output and reaps the writer", async () => {
	const root = fixtureRoot();
	process.env["PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES"] = "4096";
	const writer = path.join(root, "aggregate-protocol-limit.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
const lines = [];
for (let index = 0; index < 100; index++) {
  lines.push(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ROW-" + index + "-" + "x".repeat(240) }],
      stopReason: "toolUse",
      timestamp: Date.now(),
    },
  }));
}
process.stdout.write(lines.join("\\n") + "\\n");
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-aggregate-protocol");
	const resultPath = path.join(asyncDir, "result.json");

	await runConfiguredBackground({
		version: 2,
		id: "aggregate-protocol",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		results: Array<{
			error?: string;
			protocolError?: { scope?: string; limitBytes?: number };
			writerProcesses?: Array<{ terminationOrigin?: string }>;
		}>;
	};
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
		steps: Array<{ recentOutput?: string[] }>;
	};

	expect(completion).toMatchObject({
		state: "failed",
		results: [
			{
				error: expect.stringContaining("aggregate protocol limit"),
				protocolError: { scope: "aggregate", limitBytes: 4096 },
				writerProcesses: [{ terminationOrigin: "manager-request" }],
			},
		],
	});
	expect(Buffer.byteLength((status.steps[0]?.recentOutput ?? []).join("\n"), "utf8")).toBeLessThanOrEqual(64 * 1024);
}, 5_000);

test("compacts redundant Pi lifecycle payloads before applying the aggregate protocol limit", async () => {
	const root = fixtureRoot();
	process.env["PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES"] = "4096";
	const writer = path.join(root, "redundant-protocol-payloads.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
const toolResult = {
  role: "toolResult",
  toolCallId: "call-1",
  toolName: "read",
  content: [{ type: "text", text: "x".repeat(1700) }],
  isError: false,
  timestamp: Date.now(),
};
const assistant = {
  role: "assistant",
  content: [{ type: "text", text: "PROTOCOL_COMPACTED" }],
  stopReason: "stop",
  timestamp: Date.now(),
};
const events = [
  { type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "fixture" } },
  { type: "message_start", message: toolResult },
  { type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: { content: toolResult.content }, isError: false },
  { type: "message_end", message: toolResult },
  { type: "turn_end", message: assistant, toolResults: [toolResult] },
  { type: "message_end", message: assistant },
];
process.stdout.write(events.map((event) => JSON.stringify(event)).join("\\n") + "\\n");
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-redundant-protocol");
	const resultPath = path.join(asyncDir, "result.json");

	await runConfiguredBackground({
		version: 2,
		id: "redundant-protocol",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{ output?: string; protocolError?: unknown; success: boolean }>;
	};

	expect(completion).toMatchObject({
		state: "complete",
		success: true,
		results: [{ output: "PROTOCOL_COMPACTED", success: true }],
	});
	expect(completion.results[0]?.protocolError).toBeUndefined();
}, 5_000);

test("enforces aggregate protocol and turn budgets on a final record without a newline", async () => {
	const root = fixtureRoot();
	const cases = [
		{
			id: "aggregate-final-line",
			protocolLimit: "512",
			script: `
const event = (text) => JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "toolUse", timestamp: Date.now() } });
process.stdout.write(event("a".repeat(240)) + "\\n" + event("b".repeat(240)), () => process.exit(0));
`,
			task: { ...task(0), cwd: root },
			expected: "aggregate protocol limit",
		},
		{
			id: "turn-budget-final-line",
			protocolLimit: "4096",
			script: `
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "OVER_BUDGET_WITHOUT_NEWLINE" }], stopReason: "toolUse", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event), () => process.exit(0));
`,
			task: { ...task(0), cwd: root, turnBudget: { maxTurns: 1, graceTurns: 0 } },
			expected: "turn budget",
		},
	] as const;

	for (const fixture of cases) {
		process.env["PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES"] = fixture.protocolLimit;
		const writer = path.join(root, `${fixture.id}.ts`);
		fs.writeFileSync(writer, `#!/usr/bin/env bun\n${fixture.script}`, { mode: 0o700 });
		process.env["PI_SUBAGENT_PI_BINARY"] = writer;
		const asyncDir = path.join(root, fixture.id);
		const resultPath = path.join(asyncDir, "result.json");
		await runConfiguredBackground({
			version: 2,
			id: fixture.id,
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: fixture.task },
		});
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ error?: string; turnBudgetExceeded?: boolean }>;
		};
		expect(completion.state).toBe("failed");
		expect(completion.results[0]?.error?.toLowerCase()).toContain(fixture.expected);
		if (fixture.id === "turn-budget-final-line") {
			expect(completion.results[0]?.turnBudgetExceeded).toBe(true);
		}
	}
});

test("bounds recent status output by UTF-8 bytes without changing the full result", async () => {
	const root = fixtureRoot();
	const writer = path.join(root, "large-recent-output.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
const text = "BEGIN-" + "界".repeat(40_000) + "-END";
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-large-recent");
	const resultPath = path.join(asyncDir, "result.json");
	await runConfiguredBackground({
		version: 2,
		id: "large-recent",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		results: Array<{ output: string }>;
	};
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
		steps: Array<{ recentOutput?: string[] }>;
	};
	const recent = (status.steps[0]?.recentOutput ?? []).join("\n");
	expect(Buffer.byteLength(recent, "utf8")).toBeLessThanOrEqual(64 * 1024);
	expect(recent).not.toContain("�");
	expect(completion.results[0]?.output).toStartWith("BEGIN-");
	expect(completion.results[0]?.output).toEndWith("-END");
});

test("fairly bounds multi-Agent result projections while preserving full output artifacts", async () => {
	const root = fixtureRoot();
	process.env["PI_SUBAGENT_TASK_RESULT_MAX_BYTES"] = "1024";
	process.env["PI_SUBAGENT_RUN_RESULT_MAX_BYTES"] = "2048";
	const writer = path.join(root, "bounded-run-results.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
const index = process.env.PI_SUBAGENT_CHILD_INDEX ?? "unknown";
const text = "BEGIN-" + index + "-" + "界".repeat(2_000) + "-END-" + index;
const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() } };
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-bounded-run-results");
	const resultPath = path.join(asyncDir, "result.json");
	await runConfiguredBackground({
		version: 2,
		id: "bounded-run-results",
		cwd: root,
		asyncDir,
		resultPath,
		work: {
			mode: "parallel",
			group: {
				tasks: Array.from({ length: 4 }, (_, index) => ({ ...task(index), cwd: root })),
				concurrency: 4,
				worktree: false,
			},
		},
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		results: Array<{ output: string }>;
	};
	const totalBytes = completion.results.reduce((sum, result) => sum + Buffer.byteLength(result.output, "utf8"), 0);
	expect(totalBytes).toBeLessThanOrEqual(2048);
	for (const [index, result] of completion.results.entries()) {
		expect(Buffer.byteLength(result.output, "utf8")).toBeGreaterThan(0);
		expect(result.output).toContain("output truncated");
		expect(result.output).not.toContain("�");
		const fullOutput = fs.readFileSync(path.join(asyncDir, `output-${String(index)}.log`), "utf8");
		expect(fullOutput).toStartWith(`BEGIN-${String(index)}-`);
		expect(fullOutput).toEndWith(`-END-${String(index)}`);
		expect(Buffer.byteLength(fullOutput, "utf8")).toBeGreaterThan(Buffer.byteLength(result.output, "utf8"));
	}
}, 5_000);

test("hard-kills a writer that ignores protocol-limit termination", async () => {
	const root = fixtureRoot();
	const writer = path.join(root, "protocol-limit-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
process.on("SIGTERM", () => {});
process.stdout.write("x".repeat(17 * 1024 * 1024));
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async");
	const resultPath = path.join(asyncDir, "result.json");
	const config: BackgroundRunnerConfig = {
		version: 2,
		id: "protocol-limit-hard-kill",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: task(0) },
	};

	await runConfiguredBackground(config);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{
			error?: string;
			success: boolean;
			writerProcesses: Array<{ exitCode: number | null; signal: string | null }>;
		}>;
	};

	expect(completion).toMatchObject({
		state: "failed",
		success: false,
		results: [
			{
				error: expect.stringContaining("protocol_output_limit"),
				success: false,
				writerProcesses: [{ exitCode: null, signal: "SIGKILL" }],
			},
		],
	});
}, 7_000);
