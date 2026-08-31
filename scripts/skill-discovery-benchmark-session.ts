import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { JsonSourceObject, JsonSourceValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { PiRpcClient, PiRpcTimeoutError } from "./pi-rpc-client.js";
import type {
	SkillDiscoveryArm,
	SkillDiscoveryFailureClass,
	SkillDiscoveryManifestTask,
	SkillDiscoveryObservation,
	SkillDiscoveryTimeoutPhase,
} from "./skill-discovery-benchmark-core.js";
import {
	analyzeSkillDiscoveryMessages,
	type SkillDiscoveryMessageAnalysis,
} from "./skill-discovery-benchmark-evidence.js";

const DIRECT_PROVIDER_TOOLS = ["bash", "find", "grep", "ls", "read"] as const;
const CODE_MODE_PROVIDER_TOOLS = ["codemode", "tool_search"] as const;
export const SKILL_DISCOVERY_TOOL_ALLOWLIST = [...DIRECT_PROVIDER_TOOLS, ...CODE_MODE_PROVIDER_TOOLS] as const;
export const SKILL_DISCOVERY_TIMEOUTS = {
	commandMs: 60_000,
	settlementMs: 15 * 60_000,
	startupMs: 5 * 60_000,
} as const;
const COMMAND_TIMEOUT_PHASES = {
	get_last_assistant_text: "evidence",
	get_messages: "evidence",
	get_session_stats: "evidence",
	get_state: "setup",
	prompt: "prompt-preflight",
	set_auto_compaction: "setup",
	set_auto_retry: "setup",
} as const satisfies Readonly<Record<string, SkillDiscoveryTimeoutPhase>>;

function isKnownCommand(command: string | undefined): command is keyof typeof COMMAND_TIMEOUT_PHASES {
	return command !== undefined && Object.hasOwn(COMMAND_TIMEOUT_PHASES, command);
}

const PROVIDER_OBSERVATION_SCHEMA = Type.Object({
	catalogBlocks: Type.Integer(),
	configurationValid: Type.Boolean(),
	entryCounts: Type.Tuple([Type.Integer(), Type.Integer(), Type.Integer()]),
	toolNames: Type.Array(Type.String()),
	type: Type.Literal("provider-request"),
});
const STATE_SCHEMA = Type.Object(
	{
		model: Type.Object({ id: Type.String(), provider: Type.String() }, { additionalProperties: true }),
		thinkingLevel: Type.String(),
	},
	{ additionalProperties: true },
);
const STATS_SCHEMA = Type.Object(
	{ tokens: Type.Object({ total: Type.Number() }, { additionalProperties: true }) },
	{ additionalProperties: true },
);
const FINAL_TEXT_SCHEMA = Type.Object(
	{ text: Type.Union([Type.Null(), Type.String()]) },
	{ additionalProperties: true },
);

type ProviderObservation = Static<typeof PROVIDER_OBSERVATION_SCHEMA>;

interface ParsedProviderObservations {
	readonly records: readonly ProviderObservation[];
	readonly valid: boolean;
}

interface SessionDirectories {
	readonly agent: string;
	readonly cache: string;
	readonly config: string;
	readonly data: string;
	readonly project: string;
	readonly runtime: string;
	readonly sessions: string;
	readonly state: string;
	readonly temporary: string;
}

interface PreparedSession {
	readonly directories: SessionDirectories;
	readonly observerLog: string;
	readonly projectBefore: Readonly<Record<string, string>>;
	readonly skillsBefore: Readonly<Record<string, string>>;
}

interface SessionCapture {
	readonly caughtProviderFailure: boolean;
	readonly events: readonly JsonSourceObject[];
	readonly finalText: JsonSourceValue | undefined;
	readonly messages: JsonSourceValue | undefined;
	readonly processFailure: boolean;
	readonly state: JsonSourceValue | undefined;
	readonly stats: JsonSourceValue | undefined;
	readonly timedOut: boolean;
	readonly timeoutPhase: SkillDiscoveryTimeoutPhase;
}

interface FailureInput {
	readonly answerExact: boolean;
	readonly catalogExact: boolean;
	readonly detourFree: boolean;
	readonly instrumentationViolation: boolean;
	readonly processFailure: boolean;
	readonly protectedFileViolation: boolean;
	readonly providerFailure: boolean;
	readonly readExact: boolean;
	readonly resourceReadExact: boolean;
	readonly safetyViolation: boolean;
	readonly skillHashExact: boolean;
	readonly timedOut: boolean;
}

export interface RunSkillDiscoverySessionOptions {
	readonly arm: SkillDiscoveryArm;
	readonly authFile: string;
	readonly caseRoot: string;
	readonly codeModeHost: string;
	readonly model: string;
	readonly observerExtension: string;
	readonly packageExtension: string;
	readonly piBinary: string;
	readonly provider: string;
	readonly reasoning: string;
	readonly sequence: number;
	readonly task: SkillDiscoveryManifestTask;
}

function jsonObject(value: JsonSourceValue | undefined): JsonSourceObject | undefined {
	return isSourceObject(value) ? value : undefined;
}

function isSourceObject(value: JsonSourceValue | undefined): value is JsonSourceObject {
	return (
		value !== undefined &&
		value !== null &&
		!Array.isArray(value) &&
		!isRuntimeBoolean(value) &&
		!isRuntimeNumber(value) &&
		!isRuntimeString(value)
	);
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

async function snapshotDirectory(root: string, current = root): Promise<Record<string, string>> {
	const snapshot: Record<string, string> = {};
	for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const path = join(current, entry.name);
		const name = relative(root, path);
		const metadata = await lstat(path);
		if (metadata.isDirectory()) {
			snapshot[`${name}/`] = "<directory>";
			Object.assign(snapshot, await snapshotDirectory(root, path));
		} else if (metadata.isFile()) snapshot[name] = sha256(await readFile(path));
		else snapshot[name] = "<non-regular>";
	}
	return snapshot;
}

async function directoryMatches(snapshot: Readonly<Record<string, string>>, root: string): Promise<boolean> {
	try {
		return JSON.stringify(snapshot) === JSON.stringify(await snapshotDirectory(root));
	} catch {
		return false;
	}
}

function parseProviderObservations(text: string): ParsedProviderObservations {
	const records: ProviderObservation[] = [];
	if (!text.trim()) return { records, valid: true };
	try {
		for (const line of text.trim().split("\n")) {
			const value: unknown = JSON.parse(line);
			if (!Check(PROVIDER_OBSERVATION_SCHEMA, value)) return { records: [], valid: false };
			records.push(value);
		}
		return { records, valid: true };
	} catch {
		return { records: [], valid: false };
	}
}

function benchmarkEnvironment(
	base: NodeJS.ProcessEnv,
	directories: SessionDirectories,
	arm: SkillDiscoveryArm,
	observerLog: string,
	entries: string,
	codeModeHost: string,
): NodeJS.ProcessEnv {
	const environment = { ...base };
	for (const key of Object.keys(environment)) {
		if (
			key.startsWith("MAGIC_CONTEXT_") ||
			key.startsWith("PONYTAIL_") ||
			key.startsWith("PI_SUBAGENT_PARENT_") ||
			key.startsWith("PI_STUFF_")
		)
			delete environment[key];
	}
	const result: NodeJS.ProcessEnv = {
		...environment,
		MAGIC_CONTEXT_PI_SUBAGENT: "1",
		PI_CODING_AGENT_DIR: directories.agent,
		PI_STUFF_CODE_MODE_DEFAULT: "off",
		PI_STUFF_CODE_MODE_HOST: codeModeHost,
		PI_STUFF_SKILL_DISCOVERY_BENCHMARK_ENTRIES: entries,
		PI_STUFF_SKILL_DISCOVERY_BENCHMARK_LOG: observerLog,
		PI_TELEMETRY: "0",
		PONYTAIL_DEFAULT_MODE: "off",
		PONYTAIL_HIDE_STATUS: "1",
		PONYTAIL_QUIET_STARTUP: "1",
		TMPDIR: directories.temporary,
		XDG_CACHE_HOME: directories.cache,
		XDG_CONFIG_HOME: directories.config,
		XDG_DATA_HOME: directories.data,
		XDG_RUNTIME_DIR: directories.runtime,
		XDG_STATE_HOME: directories.state,
	};
	if (arm !== "raw") result["PI_STUFF_CODE_MODE_FROZEN"] = arm === "on" ? "on" : "off";
	return result;
}

function failureClass(input: FailureInput): SkillDiscoveryFailureClass {
	if (input.protectedFileViolation) return "safety";
	if (input.safetyViolation) return "safety";
	if (input.timedOut) return "timeout";
	if (input.processFailure) return "process";
	if (input.providerFailure) return "provider";
	if (input.instrumentationViolation) return "instrumentation";
	if (!input.catalogExact) return "catalog";
	if (!input.readExact) return "selection";
	if (!input.detourFree) return "detour";
	if (!input.skillHashExact) return "read";
	if (!input.resourceReadExact) return "resource";
	if (!input.answerExact) return "answer";
	return "none";
}

function providerFailed(messages: JsonSourceValue | undefined): boolean {
	return (
		Array.isArray(messages) &&
		messages.some((message) => {
			const record = jsonObject(message);
			return (
				record?.["role"] === "assistant" &&
				(record["stopReason"] === "error" || isRuntimeString(record["errorMessage"]))
			);
		})
	);
}

async function prepareSession(options: RunSkillDiscoverySessionOptions): Promise<PreparedSession> {
	const directories: SessionDirectories = {
		agent: join(options.caseRoot, "agent"),
		cache: join(options.caseRoot, "cache"),
		config: join(options.caseRoot, "config"),
		data: join(options.caseRoot, "data"),
		project: join(options.caseRoot, "project"),
		runtime: join(options.caseRoot, "runtime"),
		sessions: join(options.caseRoot, "sessions"),
		state: join(options.caseRoot, "state"),
		temporary: join(options.caseRoot, "tmp"),
	};
	await Promise.all(
		Object.values(directories).map(async (directory) => {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			await chmod(directory, 0o700);
		}),
	);
	const agent = directories.agent;
	const project = directories.project;
	const observerLog = join(options.caseRoot, "provider.jsonl");
	await writeFile(join(project, "fixture.txt"), "Skill Discovery benchmark fixture\n", { mode: 0o600 });
	await writeFile(join(agent, "settings.json"), "{}\n", { mode: 0o600 });
	await copyFile(options.authFile, join(agent, "auth.json"));
	await chmod(join(agent, "auth.json"), 0o600);
	await writeFile(observerLog, "", { mode: 0o600 });
	for (const file of options.task.files) {
		const destination = join(agent, file.path);
		await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
		await writeFile(destination, file.content, { mode: 0o600 });
	}
	const projectBefore = await snapshotDirectory(project);
	const skillsBefore = await snapshotDirectory(join(agent, "skills"));
	return { directories, observerLog, projectBefore, skillsBefore };
}

async function captureSession(
	options: RunSkillDiscoverySessionOptions,
	prepared: PreparedSession,
): Promise<SessionCapture> {
	const { directories, observerLog } = prepared;
	const skills = [options.task.target, ...options.task.decoys];
	const entries = JSON.stringify(
		skills.map((skill) => ({ ...skill, location: join(directories.agent, skill.skillPath) })),
	);
	const arguments_ = [
		"--mode",
		"rpc",
		"--approve",
		"--no-extensions",
		"--no-context-files",
		"--no-prompt-templates",
		"--no-themes",
		...(options.arm === "raw" ? [] : ["--extension", options.packageExtension]),
		"--extension",
		options.observerExtension,
		"--tools",
		SKILL_DISCOVERY_TOOL_ALLOWLIST.join(","),
		"--provider",
		options.provider,
		"--model",
		options.model,
		"--thinking",
		options.reasoning,
		"--session-dir",
		directories.sessions,
	];
	const rpc = new PiRpcClient({
		arguments: arguments_,
		commandTimeoutMs: SKILL_DISCOVERY_TIMEOUTS.commandMs,
		cwd: directories.project,
		environment: benchmarkEnvironment(
			process.env,
			directories,
			options.arm,
			observerLog,
			entries,
			options.codeModeHost,
		),
		executable: options.piBinary,
		failurePrefix: "Skill Discovery benchmark failed",
		settleTimeoutMs: SKILL_DISCOVERY_TIMEOUTS.settlementMs,
		startupTimeoutMs: SKILL_DISCOVERY_TIMEOUTS.startupMs,
	});
	let messages: JsonSourceValue | undefined;
	let finalText: JsonSourceValue | undefined;
	let state: JsonSourceValue | undefined;
	let stats: JsonSourceValue | undefined;
	let processFailure = false;
	let timedOut = false;
	let timeoutPhase: SkillDiscoveryTimeoutPhase = "none";
	let caughtProviderFailure = false;
	try {
		state = (await rpc.getInitialState())["data"];
		await rpc.command({ type: "set_auto_retry", enabled: false });
		await rpc.command({ type: "set_auto_compaction", enabled: false });
		await rpc.promptAndSettle(options.task.prompt);
		messages = (await rpc.command({ type: "get_messages" }))["data"];
		finalText = (await rpc.command({ type: "get_last_assistant_text" }))["data"];
		stats = (await rpc.command({ type: "get_session_stats" }))["data"];
	} catch (error) {
		const detail = `${error instanceof Error ? error.message : String(error)}\n${rpc.stderr()}`;
		timedOut = error instanceof PiRpcTimeoutError || /timed out|timeout/iu.test(detail);
		if (error instanceof PiRpcTimeoutError) {
			if (error.phase === "settlement") timeoutPhase = "settlement";
			else if (isKnownCommand(error.command)) timeoutPhase = COMMAND_TIMEOUT_PHASES[error.command];
			else timeoutPhase = "unknown";
		} else if (timedOut) {
			timeoutPhase = "unknown";
		}
		caughtProviderFailure = /provider|rate.?limit|authentication|oauth|\b401\b|\b429\b/iu.test(detail);
		processFailure = !timedOut && !caughtProviderFailure;
	} finally {
		try {
			await rpc.close();
		} catch {
			processFailure = true;
		}
	}
	return {
		caughtProviderFailure,
		events: [...rpc.events],
		finalText,
		messages,
		processFailure,
		state,
		stats,
		timedOut,
		timeoutPhase,
	};
}

function analyzeFixtureReads(
	options: RunSkillDiscoverySessionOptions,
	agent: string,
	messages: JsonSourceValue | undefined,
): SkillDiscoveryMessageAnalysis {
	const targetFile = options.task.files.find((file) => file.kind === "target-skill");
	if (!targetFile) throw new Error("Skill Discovery manifest omitted its target file");
	const resourceFile = options.task.files.find((file) => file.kind === "resource");
	const base = {
		arm: options.arm,
		messages,
		targetPath: join(agent, options.task.target.skillPath),
		targetSha256: targetFile.sha256,
	};
	return options.task.resourcePath && resourceFile
		? analyzeSkillDiscoveryMessages({
				...base,
				resourcePath: join(agent, options.task.resourcePath),
				resourceSha256: resourceFile.sha256,
			})
		: analyzeSkillDiscoveryMessages(base);
}

async function measureSession(
	options: RunSkillDiscoverySessionOptions,
	prepared: PreparedSession,
	capture: SessionCapture,
	startedAt: number,
): Promise<SkillDiscoveryObservation> {
	const { agent, project } = prepared.directories;
	const provider = parseProviderObservations(await readFile(prepared.observerLog, "utf8"));
	const expectedTools = options.arm === "on" ? CODE_MODE_PROVIDER_TOOLS : DIRECT_PROVIDER_TOOLS;
	const providerToolsExact =
		provider.records.length > 0 &&
		provider.records.every((record) => JSON.stringify(record.toolNames) === JSON.stringify(expectedTools));
	const promptBoundaryViolation =
		!provider.valid ||
		provider.records.length === 0 ||
		provider.records.some(
			(record) =>
				!record.configurationValid || record.catalogBlocks !== 1 || record.entryCounts.some((count) => count !== 1),
		);
	const catalogExact =
		provider.records[0]?.configurationValid === true &&
		provider.records[0]?.catalogBlocks === 1 &&
		provider.records[0]?.entryCounts[0] === 1;
	const messageData = jsonObject(capture.messages)?.["messages"];
	const analysis = analyzeFixtureReads(options, agent, messageData);
	const stateExact =
		Check(STATE_SCHEMA, capture.state) &&
		capture.state.model.provider === options.provider &&
		capture.state.model.id === options.model &&
		capture.state.thinkingLevel === options.reasoning;
	const tokenTotal = Check(STATS_SCHEMA, capture.stats) ? capture.stats.tokens.total : 0;
	const extensionError = capture.events.some((event) => event["type"] === "extension_error");
	const instrumentationViolation =
		!analysis.instrumentationValid ||
		!provider.valid ||
		provider.records.length === 0 ||
		!stateExact ||
		!Number.isFinite(tokenTotal) ||
		extensionError;
	const protectedFileViolation =
		!(await directoryMatches(prepared.projectBefore, project)) ||
		!(await directoryMatches(prepared.skillsBefore, join(agent, "skills")));
	const answer = Check(FINAL_TEXT_SCHEMA, capture.finalText) ? capture.finalText.text : undefined;
	const answerExact = isRuntimeString(answer) && answer.trim() === options.task.expectedToken;
	const observedProviderFailure = capture.caughtProviderFailure || providerFailed(messageData);
	const primarySuccess =
		!promptBoundaryViolation &&
		!protectedFileViolation &&
		!instrumentationViolation &&
		!capture.processFailure &&
		!capture.timedOut &&
		!observedProviderFailure &&
		!analysis.safetyViolation &&
		catalogExact &&
		providerToolsExact &&
		analysis.automaticSelection &&
		analysis.readExact &&
		analysis.detourFree &&
		analysis.skillHashExact &&
		analysis.resourceReadExact &&
		answerExact;
	const classification = failureClass({
		answerExact,
		catalogExact,
		detourFree: analysis.detourFree,
		instrumentationViolation: instrumentationViolation || !providerToolsExact,
		processFailure: capture.processFailure,
		protectedFileViolation,
		providerFailure: observedProviderFailure,
		readExact: analysis.readExact,
		resourceReadExact: analysis.resourceReadExact,
		safetyViolation: analysis.safetyViolation,
		skillHashExact: analysis.skillHashExact,
		timedOut: capture.timedOut,
	});
	return {
		answerExact,
		arm: options.arm,
		automaticSelection: analysis.automaticSelection,
		catalogExact,
		detourFree: analysis.detourFree,
		durationMs: Date.now() - startedAt,
		failureClass: classification,
		family: options.task.family,
		instrumentationViolation,
		nestedOperations: analysis.nestedOperations,
		primarySuccess,
		processFailure: capture.processFailure,
		promptBoundaryViolation,
		protectedFileViolation,
		providerRequests: provider.records.length,
		providerToolNames: [...new Set(provider.records.flatMap((record) => record.toolNames))].sort(),
		providerToolsExact,
		readExact: analysis.readExact,
		resourceReadExact: analysis.resourceReadExact,
		safetyViolation: analysis.safetyViolation,
		sequence: options.sequence,
		skillHashExact: analysis.skillHashExact,
		taskId: options.task.id,
		timedOut: capture.timedOut,
		timeoutPhase: capture.timeoutPhase,
		tokenTotal,
		toolCalls: analysis.toolCalls,
	};
}

export async function runSkillDiscoverySession(
	options: RunSkillDiscoverySessionOptions,
): Promise<SkillDiscoveryObservation> {
	const startedAt = Date.now();
	const prepared = await prepareSession(options);
	const capture = await captureSession(options, prepared);
	return measureSession(options, prepared, capture, startedAt);
}
