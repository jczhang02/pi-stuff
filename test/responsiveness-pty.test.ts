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

test("continuous Suite observation follows a foreground Agent through child Tool execution and process exit", async () => {
	const child = Bun.spawn(
		[
			"unshare",
			"--user",
			"--map-root-user",
			"--net",
			process.execPath,
			resolve("scripts/benchmark-responsiveness.ts"),
			"--pi",
			process.env["PI_BIN"] ?? "/opt/bin/pi",
			"--suite",
			"--agent",
			"foreground",
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
			agentMode: Type.Literal("foreground"),
			completedChildTools: Type.Literal(1),
			reapedChildProcesses: Type.Literal(1),
			agentRowObserved: Type.Literal(true),
			automaticUsageRefreshes: Type.Literal(1),
		});
		expect(Check(schema, sample)).toBe(true);
	} finally {
		if (child.exitCode === null) child.kill("SIGTERM");
	}
}, 65_000);
