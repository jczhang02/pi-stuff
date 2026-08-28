import { afterEach, expect, test } from "bun:test";
import {
	type BackgroundRunnerConfig,
	cleanupBackgroundEngineFixtures,
	fixtureRoot,
	fs,
	path,
	requestAsyncSteer,
	requestAsyncStop,
	runConfiguredBackground,
	task,
	waitForFile,
} from "./background-engine-fixtures.js";

afterEach(cleanupBackgroundEngineFixtures);

test("persists manager provenance and reaps a writer that ignores graceful termination", async () => {
	if (process.platform === "win32") return;
	const root = fixtureRoot();
	const readyMarker = path.join(root, "stubborn-writer-ready");
	const writer = path.join(root, "stubborn-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
import * as fs from "node:fs";
process.on("SIGTERM", () => {});
fs.writeFileSync(${JSON.stringify(readyMarker)}, "ready");
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-stubborn-writer");
	const resultPath = path.join(asyncDir, "result.json");
	let supervisorPid: number | undefined;
	const running = runConfiguredBackground(
		{
			version: 2,
			id: "stubborn-writer",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		},
		{
			afterWriterProcessUpdate: (_index, writerState) => {
				if (writerState.state === "running") supervisorPid = writerState.pid;
			},
		},
	);
	await waitForFile(readyMarker);
	requestAsyncStop(asyncDir, { source: "test" });
	await running;

	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		results: Array<{ writerProcesses?: Array<{ childPid?: number; terminationOrigin?: string }> }>;
	};
	expect(completion).toMatchObject({
		state: "stopped",
		results: [{ writerProcesses: [{ terminationOrigin: "manager-request" }] }],
	});
	for (const pid of [supervisorPid, completion.results[0]?.writerProcesses?.[0]?.childPid]) {
		if (pid !== undefined) expect(() => process.kill(pid, 0)).toThrow();
	}
}, 12_000);

test("bounds writer output drain when an escaped descendant inherits its pipes", async () => {
	if (process.platform === "win32") return;
	const root = fixtureRoot();
	const escapedPidPath = path.join(root, "escaped-writer-descendant.pid");
	const writer = path.join(root, "escaped-writer-descendant.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
import { spawn } from "node:child_process";
import * as fs from "node:fs";
const escaped = spawn("/bin/sh", ["-c", "sleep 30"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
escaped.unref();
fs.writeFileSync(${JSON.stringify(escapedPidPath)}, String(escaped.pid));
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "ESCAPED_PIPE_RESULT" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n", () => process.exit(0));
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-escaped-writer-descendant");
	const resultPath = path.join(asyncDir, "result.json");
	let escapedPid: number | undefined;

	try {
		const startedAt = Date.now();
		await runConfiguredBackground({
			version: 2,
			id: "escaped-writer-descendant",
			cwd: root,
			asyncDir,
			resultPath,
			work: { mode: "single", task: { ...task(0), cwd: root } },
		});
		expect(Date.now() - startedAt).toBeLessThan(6_000);
		escapedPid = Number(fs.readFileSync(escapedPidPath, "utf8"));
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
			state: string;
			results: Array<{ output?: string; success: boolean }>;
		};
		expect(completion).toMatchObject({
			state: "complete",
			results: [{ output: "ESCAPED_PIPE_RESULT", success: true }],
		});
	} finally {
		if (escapedPid === undefined && fs.existsSync(escapedPidPath)) {
			escapedPid = Number(fs.readFileSync(escapedPidPath, "utf8"));
		}
		if (escapedPid !== undefined && Number.isSafeInteger(escapedPid) && escapedPid > 0) {
			try {
				process.kill(-escapedPid, "SIGKILL");
			} catch {
				// The detached fixture may already have exited.
			}
		}
	}
}, 8_000);

test("treats a manager-owned final-drain exit 143 from the Host as completion", async () => {
	const root = fixtureRoot();
	const writer = path.join(root, "host-exit-143-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
process.on("SIGTERM", () => process.exit(143));
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_HOST_EXIT_143" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-143-manager");
	const resultPath = path.join(asyncDir, "result.json");

	await runConfiguredBackground({
		version: 2,
		id: "manager-owned-host-exit-143",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{
			exitCode: number | null;
			success: boolean;
			writerProcesses?: Array<{
				exitCode: number | null;
				signal: string | null;
				terminationOrigin?: string;
			}>;
		}>;
	};

	expect(completion).toMatchObject({
		state: "complete",
		success: true,
		results: [
			{
				exitCode: 0,
				success: true,
				writerProcesses: [{ exitCode: 143, signal: null, terminationOrigin: "manager-final-drain" }],
			},
		],
	});
}, 5_000);

test("keeps manager final-drain provenance when steering races a wrapper exit 143", async () => {
	const root = fixtureRoot();
	const signalMarker = path.join(root, "manager-term-observed");
	const writer = path.join(root, "steer-after-manager-term.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
import * as fs from "node:fs";
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(signalMarker)}, "term");
  setTimeout(() => process.exit(143), 400);
});
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_STEER_RACE" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-steer-drain-race");
	const resultPath = path.join(asyncDir, "result.json");
	const running = runConfiguredBackground({
		version: 2,
		id: "steer-drain-race",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	});

	await waitForFile(signalMarker, 3_000);
	requestAsyncSteer(asyncDir, {
		id: "late-steer",
		message: "Add one more check before finishing.",
		source: "test",
		targetIndex: 0,
	});
	await running;
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		results: Array<{ writerProcesses?: Array<{ terminationOrigin?: string }> }>;
	};
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")) as {
		steering?: { failed?: number; pending?: number };
	};

	expect(completion).toMatchObject({
		state: "complete",
		results: [{ writerProcesses: [{ terminationOrigin: "manager-final-drain" }] }],
	});
	expect(status.steering).toMatchObject({ failed: 1, pending: 0 });
}, 5_000);

test("does not forgive an external exit 143 before the manager final drain", async () => {
	const root = fixtureRoot();
	const writer = path.join(root, "external-exit-143-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BUT_EXTERNAL_EXIT_143" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => process.exit(143), 25);
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async-143-external");
	const resultPath = path.join(asyncDir, "result.json");

	await runConfiguredBackground({
		version: 2,
		id: "external-host-exit-143",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	});
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{
			exitCode: number | null;
			success: boolean;
			writerProcesses?: Array<{ terminationOrigin?: string }>;
		}>;
	};

	expect(completion).toMatchObject({
		state: "failed",
		success: false,
		results: [
			{
				exitCode: 143,
				success: false,
				writerProcesses: [{ terminationOrigin: "external" }],
			},
		],
	});
}, 5_000);

test("does not forgive an external signal after a clean terminal report", async () => {
	const root = fixtureRoot();
	const writer = path.join(root, "externally-terminated-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BUT_EXTERNALLY_TERMINATED" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => process.kill(process.pid, "SIGTERM"), 25);
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async");
	const resultPath = path.join(asyncDir, "result.json");
	const config: BackgroundRunnerConfig = {
		version: 2,
		id: "external-signal-after-report",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	};

	await runConfiguredBackground(config);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{
			exitCode: number | null;
			success: boolean;
			writerProcesses: Array<{
				exitCode: number | null;
				signal: string | null;
				terminationOrigin?: string;
			}>;
		}>;
	};

	expect(completion).toMatchObject({
		state: "failed",
		success: false,
		results: [
			{
				exitCode: 1,
				success: false,
				writerProcesses: [{ exitCode: null, signal: "SIGTERM", terminationOrigin: "external" }],
			},
		],
	});
}, 5_000);

test("does not forgive an external SIGKILL after the manager sent its final-drain SIGTERM", async () => {
	const root = fixtureRoot();
	const writer = path.join(root, "externally-killed-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
process.on("SIGTERM", () => {});
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_EXTERNAL_SIGKILL" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setTimeout(() => process.kill(process.pid, "SIGKILL"), 1_500);
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async");
	const resultPath = path.join(asyncDir, "result.json");
	const config: BackgroundRunnerConfig = {
		version: 2,
		id: "external-sigkill-after-final-drain-term",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	};

	await runConfiguredBackground(config);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{
			exitCode: number | null;
			success: boolean;
			writerProcesses: Array<{ exitCode: number | null; signal: string | null }>;
		}>;
	};

	expect(completion).toMatchObject({
		state: "failed",
		success: false,
		results: [
			{
				exitCode: 1,
				success: false,
				writerProcesses: [{ exitCode: null, signal: "SIGKILL" }],
			},
		],
	});
}, 5_000);

test("records a manager-owned final-drain SIGKILL as semantic completion", async () => {
	const root = fixtureRoot();
	const writer = path.join(root, "manager-killed-writer.ts");
	fs.writeFileSync(
		writer,
		`#!/usr/bin/env bun
process.on("SIGTERM", () => {});
const event = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "VALID_BEFORE_MANAGER_SIGKILL" }],
    stopReason: "stop",
    timestamp: Date.now(),
  },
};
process.stdout.write(JSON.stringify(event) + "\\n");
setInterval(() => {}, 1_000);
`,
		{ mode: 0o700 },
	);
	process.env["PI_SUBAGENT_PI_BINARY"] = writer;
	const asyncDir = path.join(root, "async");
	const resultPath = path.join(asyncDir, "result.json");
	const config: BackgroundRunnerConfig = {
		version: 2,
		id: "manager-owned-final-drain-sigkill",
		cwd: root,
		asyncDir,
		resultPath,
		work: { mode: "single", task: { ...task(0), cwd: root } },
	};

	await runConfiguredBackground(config);
	// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
	const completion = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
		state: string;
		success: boolean;
		results: Array<{
			exitCode: number | null;
			success: boolean;
			writerProcesses: Array<{ exitCode: number | null; signal: string | null }>;
		}>;
	};

	expect(completion).toMatchObject({
		state: "complete",
		success: true,
		results: [
			{
				exitCode: 0,
				success: true,
				writerProcesses: [{ exitCode: null, signal: "SIGKILL" }],
			},
		],
	});
}, 6_000);
