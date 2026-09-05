import { expect, test } from "bun:test";
import { readlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";

const SAMPLE_SCHEMA = Type.Object({
	directory: Type.String(),
	maximumSpinnerFrameMs: Type.Number(),
});
const EVIDENCE_SCHEMA = Type.Object({
	actions: Type.Array(Type.Object({ phase: Type.String(), visibleMs: Type.Number() })),
});

test.each(["startup", "pre-tool", "settlement"])(
	"continuous native PTY observation detects an injected %s stall",
	async (phase) => {
		const child = Bun.spawn(
			[
				process.execPath,
				resolve("scripts/benchmark-responsiveness.ts"),
				"--pi",
				process.env["PI_BIN"] ?? "/opt/bin/pi",
				"--block-ms",
				"350",
				"--block-phase",
				phase,
			],
			{ stderr: "pipe", stdout: "pipe" },
		);
		try {
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			const sample = parseJsonValue(stdout);
			if (!Check(SAMPLE_SCHEMA, sample)) throw new Error("Missing native observation summary");
			const evidence = parseJsonValue(await readFile(join(sample.directory, "evidence.json"), "utf8"));
			if (!Check(EVIDENCE_SCHEMA, evidence)) throw new Error("Missing continuous interaction evidence");
			// Negative-control detection floors, not product acceptance limits.
			const observedPhase = phase === "pre-tool" ? "active" : phase;
			const latencies = evidence.actions
				.filter((action) => action.phase === observedPhase)
				.map((action) => action.visibleMs);
			expect(Math.max(...latencies)).toBeGreaterThan(100);
			if (phase === "pre-tool") expect(sample.maximumSpinnerFrameMs).toBeGreaterThan(350);
		} finally {
			if (child.exitCode === null) child.kill("SIGTERM");
		}
	},
	45_000,
);

test.each(["foreground", "background", "context", "goal"])(
	"continuous Suite observation verifies %s work through its public results",
	async (mode) => {
		const agent = mode === "foreground" || mode === "background";
		const child = Bun.spawn(
			[
				"unshare",
				"--user",
				"--map-root-user",
				"--net",
				"--pid",
				"--fork",
				"--kill-child",
				"--mount-proc",
				// Keep PID > 1 and a namespace-local process group for the existing birth-identity watchdog.
				"setsid",
				"sh",
				"-c",
				'"$@"; exit $?',
				"psyon-pid-init",
				process.execPath,
				resolve("scripts/benchmark-responsiveness.ts"),
				"--pi",
				process.env["PI_BIN"] ?? "/opt/bin/pi",
				"--suite",
				...(agent ? ["--agent", mode] : [`--${mode}`]),
			],
			{
				stderr: "pipe",
				stdout: "pipe",
				env: { ...process.env, PSYON_PARENT_NETNS: readlinkSync("/proc/self/ns/net") },
			},
		);
		try {
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			const sample = parseJsonValue(stdout);
			const schema = Type.Object({
				completedChildTools: Type.Literal(agent ? 1 : 0),
				reapedChildProcesses: Type.Literal(agent ? 1 : 0),
				agentRowObserved: Type.Literal(agent),
				automaticUsageRefreshes: Type.Literal(1),
				backgroundOutcomes: Type.Literal(mode === "background" ? 1 : 0),
				parentCompletedWhileChildRunning: Type.Literal(mode === "background"),
				contextProjectionRequests: Type.Literal(mode === "context" ? 3 : 0),
				contextRetrievals: Type.Literal(mode === "context" ? 1 : 0),
			});
			if (agent) expect(Check(Type.Object({ agentMode: Type.Literal(mode) }), sample)).toBe(true);
			if (mode === "goal")
				expect(
					Check(
						Type.Object({ goalCompleted: Type.Literal(true), goalContinuationRequests: Type.Literal(1) }),
						sample,
					),
				).toBe(true);
			expect(Check(schema, sample)).toBe(true);
		} finally {
			if (child.exitCode === null) child.kill("SIGTERM");
		}
	},
	65_000,
);
