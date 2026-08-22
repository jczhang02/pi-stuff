import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { JsonInputObject } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { terminateDetachedProcessGroup } from "./detached-process.js";

const PROVIDER = "pi-stuff-goal-lifecycle";
const MODEL = "fixture-model";
const TIMEOUT_MS = 30_000;

type Scenario = "blocker" | "compaction" | "normal" | "reload";

const GOAL_RECORD_SCHEMA = Type.Object(
	{
		blockerAudit: Type.Optional(
			Type.Object({ attempts: Type.Optional(Type.Array(Type.Unknown())) }, { additionalProperties: true }),
		),
		status: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);
const GOAL_STATE_SCHEMA = Type.Object(
	{ goal: Type.Optional(Type.Union([GOAL_RECORD_SCHEMA, Type.Null()])) },
	{ additionalProperties: true },
);
const SESSION_ENTRY_SCHEMA = Type.Object(
	{
		customType: Type.Optional(Type.String()),
		data: Type.Optional(Type.Unknown()),
		type: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);
const RPC_RECORD_SCHEMA = Type.Object(
	{
		aborted: Type.Optional(Type.Boolean()),
		command: Type.Optional(Type.Unknown()),
		data: Type.Optional(Type.Unknown()),
		entry: Type.Optional(SESSION_ENTRY_SCHEMA),
		error: Type.Optional(Type.Unknown()),
		event: Type.Optional(Type.Unknown()),
		extensionPath: Type.Optional(Type.Unknown()),
		id: Type.Optional(Type.String()),
		reason: Type.Optional(Type.Unknown()),
		result: Type.Optional(Type.Unknown()),
		success: Type.Optional(Type.Boolean()),
		type: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);
const ENTRIES_DATA_SCHEMA = Type.Object({ entries: Type.Array(SESSION_ENTRY_SCHEMA) }, { additionalProperties: true });

type GoalRecord = Static<typeof GOAL_RECORD_SCHEMA>;
type GoalState = Static<typeof GOAL_STATE_SCHEMA>;
type RpcRecord = Static<typeof RPC_RECORD_SCHEMA>;
type SessionEntryRecord = Static<typeof SESSION_ENTRY_SCHEMA>;

interface RpcTransport {
	records: RpcRecord[];
	send(command: JsonInputObject): Promise<RpcRecord>;
	stop(): Promise<void>;
}

export interface VerifyGoalLifecycleOptions {
	packagePath: string;
	piBinary: string;
}

interface GoalLifecycleEnvironment {
	readonly [name: string]: string;
}

function environment(temporaryDirectory: string, scenario: Scenario, logPath: string): GoalLifecycleEnvironment {
	const { PATH: path } = process.env;
	if (!path) throw new Error("PATH is required to start the Pi host");
	return {
		HOME: join(temporaryDirectory, "home"),
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		NO_COLOR: "1",
		PATH: path,
		PI_CODING_AGENT_DIR: join(temporaryDirectory, "agent"),
		PI_OFFLINE: "1",
		PI_STUFF_GOAL_LIFECYCLE_LOG: logPath,
		PI_STUFF_GOAL_LIFECYCLE_SCENARIO: scenario,
		PI_TELEMETRY: "0",
		TERM: "dumb",
		XDG_CACHE_HOME: join(temporaryDirectory, "cache"),
		XDG_CONFIG_HOME: join(temporaryDirectory, "config"),
		XDG_DATA_HOME: join(temporaryDirectory, "data"),
		XDG_STATE_HOME: join(temporaryDirectory, "state"),
	};
}

function parseRecords(stdout: string): RpcRecord[] {
	return stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const value = JSON.parse(line);
			if (!Check(RPC_RECORD_SCHEMA, value)) throw new Error(`Invalid Pi RPC record: ${line}`);
			return value;
		});
}

async function createRpcTransport(command: string[], cwd: string, env: Record<string, string>): Promise<RpcTransport> {
	const child = Bun.spawn(command, { cwd, detached: true, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	const records: RpcRecord[] = [];
	const pending = new Map<
		string,
		{ reject: (error: Error) => void; resolve: (record: RpcRecord) => void; timeout: ReturnType<typeof setTimeout> }
	>();
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let sequence = 0;
	let readError: Error | undefined;
	const consume = (line: string) => {
		if (!line) return;
		const parsed = JSON.parse(line);
		if (!Check(RPC_RECORD_SCHEMA, parsed)) throw new Error(`Invalid Pi RPC record: ${line}`);
		const record = parsed;
		records.push(record);
		if (!isRuntimeString(record.id) || record.type !== "response") return;
		const request = pending.get(record.id);
		if (!request) return;
		pending.delete(record.id);
		clearTimeout(request.timeout);
		request.resolve(record);
	};
	const reading = (async () => {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			while (buffer.includes("\n")) {
				const newline = buffer.indexOf("\n");
				const line = buffer.slice(0, newline).replace(/\r$/u, "");
				buffer = buffer.slice(newline + 1);
				consume(line);
			}
			if (done) {
				consume(buffer.replace(/\r$/u, ""));
				break;
			}
		}
	})().catch((cause: unknown) => {
		readError = cause instanceof Error ? cause : new Error(String(cause));
		for (const request of pending.values()) {
			clearTimeout(request.timeout);
			request.reject(readError);
		}
		pending.clear();
	});
	await new Promise((resolve) => setTimeout(resolve, 100));
	if (child.exitCode !== null) {
		const stderr = await new Response(child.stderr).text();
		throw new Error(`Pi exited during RPC startup: ${stderr.trim() || String(child.exitCode)}`);
	}
	return {
		records,
		async send(command_) {
			if (readError) throw readError;
			const id = `goal-lifecycle-rpc-${String(++sequence)}`;
			const result = new Promise<RpcRecord>((resolve, reject) => {
				const timeout = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`Pi RPC request timed out: ${JSON.stringify(command_)}`));
				}, TIMEOUT_MS);
				pending.set(id, { reject, resolve, timeout });
			});
			child.stdin.write(`${JSON.stringify({ ...command_, id })}\n`);
			await child.stdin.flush();
			const record = await result;
			if (record.success !== true) throw new Error(`Pi RPC request failed: ${JSON.stringify(record)}`);
			return record;
		},
		async stop() {
			await terminateDetachedProcessGroup(child);
			await reading;
		},
	};
}

function response(records: readonly RpcRecord[], id: string): RpcRecord {
	const record = records.find((candidate) => candidate.id === id && candidate.type === "response");
	if (record?.success !== true) throw new Error(`Pi RPC request ${id} failed: ${JSON.stringify(record)}`);
	return record;
}

function entries(record: RpcRecord): SessionEntryRecord[] {
	if (!Check(ENTRIES_DATA_SCHEMA, record.data)) throw new Error("Pi get_entries response has no entries");
	return record.data.entries;
}

function goalStates(records: readonly SessionEntryRecord[]): GoalState[] {
	return records
		.filter((entry) => entry.type === "custom" && entry.customType === "goal-state")
		.map((entry) => entry.data)
		.filter((data) => Check(GOAL_STATE_SCHEMA, data));
}

function goal(state: GoalState): GoalRecord | null {
	return state.goal ?? null;
}

function assertScenario(
	scenario: Scenario,
	records: readonly RpcRecord[],
	logRecords: readonly RpcRecord[],
	observedActiveGoal: boolean,
): void {
	const sessionEntries = entries(response(records, `${scenario}-entries`));
	const states = goalStates(sessionEntries);
	if (states.length === 0) throw new Error(`${scenario}: no persisted Goal states were observed`);
	const goals = states.map(goal);
	const finalGoal = goals.at(-1);
	if (scenario === "blocker") {
		if (finalGoal?.status !== "blocked") {
			throw new Error("blocker: Goal did not reach blocked status");
		}
		const attempts = finalGoal.blockerAudit?.attempts;
		if (!Array.isArray(attempts) || attempts.length !== 3) {
			throw new Error("blocker: three distinct persisted attempts were not certified");
		}
		return;
	}
	if (finalGoal !== null) throw new Error(`${scenario}: Goal was not cleared after completion`);
	if (!observedActiveGoal) {
		throw new Error(`${scenario}: active Goal state was not persisted`);
	}
	if (scenario === "reload") {
		if (!logRecords.some((record) => record.type === "session_start" && record.reason === "reload")) {
			throw new Error("reload: certified host did not emit session_start reason=reload");
		}
	}
	if (scenario === "compaction") {
		const compactionEnd = records.find((record) => record.type === "compaction_end");
		const completionBoundaries = logRecords.filter(
			(record) => record.type === "session_compact" || record.type === "context_compaction_bypassed",
		);
		if (completionBoundaries.length !== 1) {
			throw new Error(
				`compaction: expected one native or Magic completion boundary, received ${JSON.stringify(completionBoundaries)}`,
			);
		}
		if (completionBoundaries[0]?.type === "session_compact") {
			if (!compactionEnd || compactionEnd.aborted === true || !compactionEnd.result) {
				throw new Error(
					`compaction: certified host did not complete native compaction successfully: ${JSON.stringify(compactionEnd)}`,
				);
			}
		} else if (compactionEnd?.aborted !== true) {
			throw new Error(
				`compaction: Magic Context bypass did not intentionally cancel native compaction: ${JSON.stringify(compactionEnd)}`,
			);
		}
	}
}

async function runScenario(options: VerifyGoalLifecycleOptions, scenario: Scenario): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), `pi-stuff-goal-${scenario}-`));
	const agentDirectory = join(temporaryDirectory, "agent");
	const logPath = join(temporaryDirectory, "lifecycle.jsonl");
	const fixture = resolve(import.meta.dir, "..", "test", "fixtures", "goal-lifecycle-provider.ts");
	try {
		await Promise.all([
			mkdir(join(temporaryDirectory, "home"), { recursive: true }),
			mkdir(agentDirectory, { recursive: true }),
		]);
		await writeFile(
			join(agentDirectory, "settings.json"),
			`${JSON.stringify({ packages: [options.packagePath], compaction: { enabled: false }, retry: { enabled: false } }, null, "\t")}\n`,
		);
		const startMessage =
			scenario === "normal"
				? "/goal Certify packed multi-turn completion"
				: scenario === "blocker"
					? "/goal Certify packed three-turn blocker audit"
					: scenario === "compaction"
						? "/goal Certify packed active Goal compaction"
						: "/goal-lifecycle-seed";
		const transport = await createRpcTransport(
			[
				options.piBinary,
				"--mode",
				"rpc",
				"--offline",
				"--no-context-files",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				"--no-builtin-tools",
				"--no-approve",
				"--provider",
				PROVIDER,
				"--model",
				MODEL,
				"--session-dir",
				join(temporaryDirectory, "sessions"),
				"--extension",
				fixture,
			],
			temporaryDirectory,
			environment(temporaryDirectory, scenario, logPath),
		);
		try {
			if (scenario === "compaction") {
				for (const index of [1, 2, 3, 4]) {
					const settledBefore = transport.records.filter((record) => record.type === "agent_settled").length;
					await transport.send({
						type: "prompt",
						message: `Create historical compaction context ${String(index)}.`,
					});
					const deadline = Date.now() + TIMEOUT_MS;
					while (transport.records.filter((record) => record.type === "agent_settled").length === settledBefore) {
						if (Date.now() >= deadline) throw new Error("compaction: historical prompt did not settle");
						await new Promise((resolve) => setTimeout(resolve, 20));
					}
				}
			}
			await transport.send({ type: "prompt", message: startMessage });
			const deadline = Date.now() + TIMEOUT_MS;
			let finalRecords: RpcRecord[] | undefined;
			let latestGoalState: GoalRecord | null | undefined;
			let observedActiveGoal = false;
			while (!finalRecords) {
				if (Date.now() >= deadline) {
					const lifecycleLog = parseRecords(await readFile(logPath, "utf8").catch(() => ""));
					const diagnostics = transport.records
						.filter((record) => record.command !== "get_entries")
						.slice(-30)
						.map((record) => ({
							command: record.command,
							error: record.error,
							event: record.event,
							extensionPath: record.extensionPath,
							id: record.id,
							reason: record.reason,
							success: record.success,
							type: record.type,
						}));
					const appendedGoalEntries = transport.records
						.filter((record) => record.type === "entry_appended")
						.flatMap((record) => (record.entry?.customType === "goal-state" ? [record.entry] : []));
					throw new Error(
						`${scenario}: Goal lifecycle did not reach a terminal state: ${JSON.stringify({ diagnostics, latestGoalState, observedActiveGoal, appendedGoalEntries, lifecycle: lifecycleLog.slice(-50) })}`,
					);
				}
				const entryResponse = await transport.send({ type: "get_entries" });
				const sessionEntries = entries(entryResponse);
				const goals = goalStates(sessionEntries).map(goal);
				const appendedGoals = goalStates(
					transport.records
						.filter((record) => record.type === "entry_appended")
						.flatMap((record) => (record.entry ? [record.entry] : [])),
				).map(goal);
				const latest = goals.at(-1);
				latestGoalState = latest;
				observedActiveGoal ||= [...goals, ...appendedGoals].some(
					(candidate) => candidate !== null && candidate.status === "active",
				);
				const terminal =
					scenario === "blocker"
						? latest !== null && latest !== undefined && latest.status === "blocked"
						: latest === null &&
							observedActiveGoal &&
							(scenario !== "compaction" ||
								transport.records.some((record) => record.type === "compaction_end"));
				if (terminal) {
					entryResponse.id = `${scenario}-entries`;
					finalRecords = [...transport.records];
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			const extensionError = finalRecords.find((record) => record.type === "extension_error");
			if (extensionError) throw new Error(`${scenario}: Pi extension error: ${JSON.stringify(extensionError)}`);
			const logContents = await readFile(logPath, "utf8").catch(() => "");
			assertScenario(scenario, finalRecords, parseRecords(logContents), observedActiveGoal);
		} finally {
			await transport.stop();
		}
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

export async function verifyGoalLifecycle(options: VerifyGoalLifecycleOptions): Promise<void> {
	for (const scenario of ["normal", "reload", "compaction", "blocker"] as const) {
		await runScenario(options, scenario);
	}
}
