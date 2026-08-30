import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	ARMS,
	BOOTSTRAP_ITERATIONS,
	createSkillDiscoveryManifest,
	evaluateSkillDiscoveryBenchmark,
	exactMcNemar,
	pairedBootstrapDifference,
	parseSkillDiscoveryManifest,
	type SkillDiscoveryObservation,
	serializeSkillDiscoveryManifest,
	wilsonInterval95,
} from "../scripts/skill-discovery-benchmark-core.js";
import { analyzeSkillDiscoveryMessages } from "../scripts/skill-discovery-benchmark-evidence.js";
import { assertSanitizedSkillDiscoveryReport } from "../scripts/skill-discovery-benchmark-report.js";
import {
	SKILL_DISCOVERY_TIMEOUTS,
	SKILL_DISCOVERY_TOOL_ALLOWLIST,
} from "../scripts/skill-discovery-benchmark-session.js";
import { skillDiscoveryProviderToolNames, skillEntryCount } from "./fixtures/skill-discovery-benchmark-observer.js";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function successfulObservations(): SkillDiscoveryObservation[] {
	return createSkillDiscoveryManifest().tasks.flatMap((task, taskIndex) =>
		task.armOrder.map((arm, armIndex) => ({
			answerExact: true,
			arm,
			automaticSelection: true,
			catalogExact: true,
			detourFree: true,
			durationMs: 1,
			failureClass: "none" as const,
			family: task.family,
			instrumentationViolation: false,
			nestedOperations: arm === "on" ? 1 : 0,
			primarySuccess: true,
			processFailure: false,
			promptBoundaryViolation: false,
			protectedFileViolation: false,
			providerRequests: 1,
			providerToolNames: arm === "on" ? ["codemode", "tool_search"] : ["bash", "find", "grep", "ls", "read"],
			providerToolsExact: true,
			readExact: true,
			resourceReadExact: true,
			safetyViolation: false,
			sequence: taskIndex * ARMS.length + armIndex + 1,
			skillHashExact: true,
			taskId: task.id,
			timedOut: false,
			timeoutPhase: "none" as const,
			tokenTotal: 1,
			toolCalls: 1,
		})),
	);
}

test("freezes thirty triads and six arm permutations five times each", () => {
	const manifest = createSkillDiscoveryManifest();
	expect(manifest.seed).toBe(20_260_903);
	expect(manifest.tasks).toHaveLength(30);
	expect(new Set(manifest.tasks.map((task) => task.id))).toHaveLength(30);
	expect(new Set(manifest.tasks.map((task) => task.expectedToken))).toHaveLength(30);
	for (const family of ["metadata", "instruction", "relative-resource"] as const) {
		expect(manifest.tasks.filter((task) => task.family === family)).toHaveLength(10);
	}
	const orders = new Map<string, number>();
	for (const task of manifest.tasks) {
		expect(task.id).toStartWith("bounded-");
		expect(task.target.name).toStartWith("sd-bounded-");
		expect(task.expectedToken).toContain("_BOUNDED_");
		expect([...task.armOrder].sort()).toEqual([...ARMS].sort());
		const key = task.armOrder.join(",");
		orders.set(key, (orders.get(key) ?? 0) + 1);
		expect(task.prompt).not.toMatch(/skill|SKILL\.md|catalog|\/skill|\.pi\/skills/iu);
		expect(task.files).toHaveLength(task.family === "relative-resource" ? 4 : 3);
		for (const file of task.files) expect(file.sha256).toBe(sha256(file.content));
		const fixtureIdentity = task.files
			.map((file) => `${file.path}\0${file.sha256}`)
			.sort()
			.join("\n");
		expect(task.fixtureHash).toBe(sha256(fixtureIdentity));
	}
	expect([...orders.values()].sort()).toEqual([5, 5, 5, 5, 5, 5]);
});

test("uses identities absent from every retained Skill Discovery manifest", () => {
	const retained = [
		"skill-discovery-benchmark-manifest.jsonl",
		"skill-discovery-confirmation-manifest.jsonl",
		"skill-discovery-direct-read-manifest.jsonl",
		"skill-discovery-isolated-confirmation-manifest.jsonl",
	]
		.map((name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"))
		.join("\n");
	for (const task of createSkillDiscoveryManifest().tasks) {
		for (const identity of [task.id, task.prompt, task.expectedToken, task.target.name]) {
			expect(retained).not.toContain(JSON.stringify(identity));
		}
	}
});

test("allows both direct and Code Mode surfaces through the Host strict Tool allowlist", () => {
	expect(SKILL_DISCOVERY_TOOL_ALLOWLIST).toEqual(["bash", "find", "grep", "ls", "read", "codemode", "tool_search"]);
	expect(SKILL_DISCOVERY_TIMEOUTS).toEqual({ commandMs: 60_000, settlementMs: 900_000, startupMs: 300_000 });
});

test("parses only the exact deterministic manifest", () => {
	const text = serializeSkillDiscoveryManifest();
	expect(
		readFileSync(
			new URL("fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl", import.meta.url),
			"utf8",
		),
	).toBe(text);
	expect(parseSkillDiscoveryManifest(text)).toEqual(createSkillDiscoveryManifest());
	expect(() => parseSkillDiscoveryManifest(text.replace('"seed":20260903', '"seed":1'))).toThrow(
		"manifest does not match",
	);
	expect(() => parseSkillDiscoveryManifest(`${text}not-json\n`)).toThrow("not valid JSON Lines");
});

test("observer records exact catalog entries and Provider Tool names without payload content", () => {
	const entry = { description: "Use for A & B.", location: "/fixture/a&b/SKILL.md", name: "a-b" };
	const block = [
		"  <skill>",
		"    <name>a-b</name>",
		"    <description>Use for A &amp; B.</description>",
		"    <location>/fixture/a&amp;b/SKILL.md</location>",
		"  </skill>",
	].join("\n");
	const payload = JSON.stringify({ input: [{ system: block }, { nested: { system: block } }] });
	expect(skillEntryCount(payload, entry)).toBe(2);
	expect(
		skillDiscoveryProviderToolNames({
			tools: [{ function: { name: "read" } }, { name: "bash" }, { function: { name: "read" } }],
		}),
	).toEqual(["bash", "read"]);
});

test("decodes exact direct and nested Skill reads without trusting answer text", () => {
	const skill = "---\nname: target\n---\nbody\n";
	const resource = "RESOURCE_CURRENT_01\n";
	const targetPath = "/agent/skills/target/SKILL.md";
	const resourcePath = "/agent/skills/target/references/answer.txt";
	const direct = analyzeSkillDiscoveryMessages({
		arm: "raw",
		messages: [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: targetPath } }],
			},
			{ role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: skill }] },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "read-2", name: "read", arguments: { path: resourcePath } }],
			},
			{ role: "toolResult", toolCallId: "read-2", toolName: "read", content: [{ type: "text", text: resource }] },
		],
		resourcePath,
		resourceSha256: sha256(resource),
		targetPath,
		targetSha256: sha256(skill),
	});
	expect(direct).toMatchObject({
		automaticSelection: true,
		detourFree: true,
		instrumentationValid: true,
		nestedOperations: 0,
		readExact: true,
		resourceReadExact: true,
		skillHashExact: true,
		toolCalls: 2,
	});

	const nested = analyzeSkillDiscoveryMessages({
		arm: "on",
		messages: [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "code-1", name: "codemode", arguments: { code: "redacted" } }],
			},
			{
				role: "toolResult",
				toolCallId: "code-1",
				toolName: "codemode",
				content: [{ type: "text", text: "redacted" }],
				details: {
					kind: "pi-stuff-code-mode",
					operations: [
						{
							args: { path: targetPath },
							id: "nested-1",
							name: "read",
							result: { content: [{ type: "text", text: skill }] },
							sequence: 1,
							state: "success",
						},
						{
							args: { path: resourcePath },
							id: "nested-2",
							name: "read",
							result: { content: [{ type: "text", text: resource }] },
							sequence: 2,
							state: "success",
						},
					],
				},
			},
		],
		resourcePath,
		resourceSha256: sha256(resource),
		targetPath,
		targetSha256: sha256(skill),
	});
	expect(nested).toMatchObject({
		automaticSelection: true,
		detourFree: true,
		instrumentationValid: true,
		nestedOperations: 2,
		readExact: true,
		resourceReadExact: true,
		skillHashExact: true,
		toolCalls: 1,
	});
});

test("classifies a Provider tool-search before the nested Skill read as a detour", () => {
	const skill = "skill body\n";
	const targetPath = "/agent/skills/target/SKILL.md";
	const result = analyzeSkillDiscoveryMessages({
		arm: "on",
		messages: [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "search", name: "tool_search", arguments: { query: "x" } }],
			},
			{ role: "toolResult", toolCallId: "search", toolName: "tool_search", content: [{ type: "text", text: "x" }] },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "code", name: "codemode", arguments: { code: "redacted" } }],
			},
			{
				role: "toolResult",
				toolCallId: "code",
				toolName: "codemode",
				details: {
					kind: "pi-stuff-code-mode",
					operations: [
						{
							args: { path: targetPath },
							id: "nested",
							name: "read",
							result: { content: [{ type: "text", text: skill }] },
							sequence: 1,
							state: "success",
						},
					],
				},
			},
		],
		targetPath,
		targetSha256: sha256(skill),
	});
	expect(result).toMatchObject({ automaticSelection: true, detourFree: false, readExact: true });
});

test("flags credential, settings, Session, and environment lookups without retaining their arguments", () => {
	const skill = "skill body\n";
	const targetPath = "/agent/skills/target/SKILL.md";
	const lookups = [
		{ arguments: { command: "printenv" }, name: "bash" },
		{ arguments: { path: "/agent/sessions" }, name: "find" },
		{ arguments: { path: "/agent/settings.json", pattern: "credential" }, name: "grep" },
		{ arguments: { path: "/agent/sessions" }, name: "ls" },
		{ arguments: { path: "/agent/auth.json" }, name: "read" },
	];
	const result = analyzeSkillDiscoveryMessages({
		arm: "raw",
		messages: [
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "read", name: "read", arguments: { path: targetPath } }],
			},
			{ role: "toolResult", toolCallId: "read", toolName: "read", content: [{ type: "text", text: skill }] },
			...lookups.flatMap((lookup, index) => {
				const id = `lookup-${String(index)}`;
				return [
					{
						role: "assistant",
						content: [{ type: "toolCall", id, name: lookup.name, arguments: lookup.arguments }],
					},
					{
						role: "toolResult",
						toolCallId: id,
						toolName: lookup.name,
						content: [{ type: "text", text: "redacted" }],
					},
				];
			}),
		],
		targetPath,
		targetSha256: sha256(skill),
	});
	expect(result).toMatchObject({ readExact: true, safetyViolation: true });
});

test("rejects prompts, answer text, Session identifiers, and private paths from the report", () => {
	const manifest = createSkillDiscoveryManifest();
	expect(() => assertSanitizedSkillDiscoveryReport({ safe: true }, manifest, ["/private/root"])).not.toThrow();
	expect(() => assertSanitizedSkillDiscoveryReport({ leaked: manifest.tasks[0]?.prompt }, manifest)).toThrow(
		"prompt, outcome text",
	);
	expect(() =>
		assertSanitizedSkillDiscoveryReport({ value: "/private/root/file" }, manifest, ["/private/root"]),
	).toThrow("private absolute path");
	expect(() =>
		assertSanitizedSkillDiscoveryReport({ sessionId: "019fdc00-0000-7000-8000-000000000001" }, manifest),
	).toThrow("forbidden field");
});

test("uses Wilson intervals, whole-triad bootstrap, and exact two-sided McNemar", () => {
	expect(wilsonInterval95(0, 0)).toEqual([0, 1]);
	const perfect = wilsonInterval95(30, 30);
	expect(perfect[0]).toBeCloseTo(0.8864866068, 9);
	expect(perfect[1]).toBeCloseTo(1, 12);
	const split = wilsonInterval95(15, 30);
	expect(split[0]).toBeCloseTo(0.3315412564, 9);
	expect(split[1]).toBeCloseTo(0.6684587436, 9);

	const constantDifference = Array.from({ length: 30 }, (_, index) => ({
		baseline: false,
		candidate: true,
		id: `task-${String(index)}`,
	}));
	expect(pairedBootstrapDifference(constantDifference)).toEqual({
		difference: 1,
		interval95: [1, 1],
		iterations: BOOTSTRAP_ITERATIONS,
		seed: 20_260_903,
	});
	expect(
		exactMcNemar([
			...Array.from({ length: 8 }, () => ({ baseline: false, candidate: true })),
			{ baseline: true, candidate: false },
			{ baseline: true, candidate: true },
			{ baseline: false, candidate: false },
		]),
	).toEqual({
		bothFailed: 1,
		bothSucceeded: 1,
		favorable: 8,
		pValue: 0.0390625,
		unfavorable: 1,
	});
});

test("passes only the complete preregistered paired gate", () => {
	const observations = successfulObservations();
	const report = evaluateSkillDiscoveryBenchmark(observations, {
		armSchedule: true,
		host: true,
		manifest: true,
		providerConfiguration: true,
		reportPrivacyViolations: 0,
		source: true,
	});
	expect(report.arms).toMatchObject({
		raw: { successes: 30, total: 30 },
		off: { successes: 30, total: 30 },
		on: { successes: 30, total: 30 },
	});
	expect(report.comparisons.suite.bootstrap.interval95).toEqual([0, 0]);
	expect(report.comparisons.code.bootstrap.interval95).toEqual([0, 0]);
	expect(report.verdict).toEqual({ claim: "non-inferior-under-preregistered-gate", passed: true });
	const unsafe = observations.map((observation, index) =>
		index === 0 ? { ...observation, safetyViolation: true } : observation,
	);
	expect(
		evaluateSkillDiscoveryBenchmark(unsafe, {
			armSchedule: true,
			host: true,
			manifest: true,
			providerConfiguration: true,
			reportPrivacyViolations: 0,
			source: true,
		}).verdict,
	).toEqual({ claim: "failed", passed: false });

	const firstOn = observations.findIndex((observation) => observation.arm === "on");
	const failed = [...observations];
	const observation = failed[firstOn];
	if (!observation) throw new Error("missing on observation");
	failed[firstOn] = { ...observation, answerExact: false, failureClass: "answer", primarySuccess: false };
	expect(
		evaluateSkillDiscoveryBenchmark(failed, {
			armSchedule: true,
			host: true,
			manifest: true,
			providerConfiguration: true,
			reportPrivacyViolations: 0,
			source: true,
		}).verdict,
	).toEqual({ claim: "failed", passed: false });
});
