import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { isRuntimeObject, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { terminateDetachedProcessGroup } from "./detached-process.js";

const root = resolve(import.meta.dir, "..");
const DEFAULT_PI_BINARY = "/opt/pi-coding-agent/pi";
const MAIN_PROVIDER = "openai-codex";
const MAIN_MODEL = "gpt-5.3-codex-spark";
const HISTORIAN_MODEL = "openai-codex/gpt-5.6-terra";
const EXPECTED_CONTEXT_WINDOW = 128_000;
const EXECUTE_THRESHOLD_PERCENTAGE = 65;
const TARGET_PRESSURE_PERCENTAGE = 82;
const TURN_TIMEOUT_MS = 10 * 60_000;
const HISTORIAN_TIMEOUT_MS = 10 * 60_000;
const PRESSURE_FILE_BYTES = 48 * 1024;
const PRESSURE_FILE_COUNT = 12;
const TODO_SUBJECT = "Preserve Magic-only acceptance state";
const AUDIT_EXTENSION = join(root, "test/fixtures/magic-context-real-audit.ts");
const AUDIT_RESULT_SCHEMA = Type.Object(
	{
		content: Type.Array(Type.Object({ text: Type.Optional(Type.String()) }, { additionalProperties: true })),
	},
	{ additionalProperties: true },
);
const TOOL_RESULT_SCHEMA = Type.Object({ isError: Type.Optional(Type.Boolean()) }, { additionalProperties: true });
const MAGIC_COMPACTION_DETAILS_SCHEMA = Type.Object(
	{ source: Type.Literal("magic-context") },
	{ additionalProperties: true },
);
const MAGIC_BOUNDARY_DETAILS_SCHEMA = Type.Object(
	{ lastCompactedOrdinal: Type.Integer({ minimum: 0 }) },
	{ additionalProperties: true },
);
const PROVIDER_USAGE_SCHEMA = Type.Object(
	{
		cacheRead: Type.Optional(Type.Number()),
		cacheWrite: Type.Optional(Type.Number()),
		input: Type.Optional(Type.Number()),
		output: Type.Optional(Type.Number()),
		totalTokens: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);
const PROVIDER_MESSAGE_SCHEMA = Type.Object({ usage: PROVIDER_USAGE_SCHEMA }, { additionalProperties: true });
const GOAL_STATE_DATA_SCHEMA = Type.Object(
	{
		goal: Type.Object({ status: Type.String() }, { additionalProperties: true }),
	},
	{ additionalProperties: true },
);

type ProviderUsage = Static<typeof PROVIDER_USAGE_SCHEMA>;

interface Options {
	readonly archivePath?: string;
	readonly authPath: string;
	readonly packagePath: string;
	readonly piBinary: string;
	readonly reportPath: string;
}

interface RpcRecord {
	readonly [key: string]: unknown;
	readonly command?: unknown;
	readonly data?: unknown;
	readonly id?: unknown;
	readonly success?: unknown;
	readonly type?: unknown;
}

interface RpcTransport {
	readonly records: RpcRecord[];
	readonly stderr: () => string;
	promptAndWait(message: string, timeoutMs?: number): Promise<RpcRecord[]>;
	send(command: Record<string, unknown>, timeoutMs?: number): Promise<RpcRecord>;
	stop(): Promise<void>;
	waitFor(
		predicate: (record: RpcRecord) => boolean,
		options?: { readonly from?: number; readonly timeoutMs?: number },
	): Promise<RpcRecord>;
}

interface ContextUsage {
	readonly contextWindow: number;
	readonly percent: number | null;
	readonly tokens: number | null;
}

interface SessionStats {
	readonly contextUsage?: ContextUsage;
	readonly tokens?: {
		readonly cacheRead?: number;
		readonly cacheWrite?: number;
		readonly input?: number;
		readonly output?: number;
		readonly total?: number;
	};
}

interface SessionState {
	readonly autoCompactionEnabled?: unknown;
	readonly model?: { readonly contextWindow?: unknown; readonly id?: unknown; readonly provider?: unknown } | null;
	readonly sessionFile?: unknown;
	readonly sessionId?: unknown;
}

interface SessionEntry extends Record<string, unknown> {
	readonly data?: unknown;
	readonly details?: unknown;
	readonly fromHook?: unknown;
	readonly message?: unknown;
	readonly type?: unknown;
}

interface DatabaseEvidence {
	readonly compartments: number;
	readonly historianFailures: number;
	readonly historianSuccesses: number;
	readonly pendingMarker: boolean;
}

interface PressureObservation {
	readonly label: string;
	readonly percent: number;
	readonly tokens: number;
}

interface MagicPressureEvidence {
	readonly contextLimit: number;
	readonly effectivePercentage: number;
	readonly rawTokens: number;
}

interface CompartmentRange {
	readonly end: number;
	readonly start: number;
}

interface EvidenceFile {
	readonly bytes: number;
	readonly path: string;
	readonly sha256: string;
}

function fail(message: string): never {
	throw new Error(`Magic Context real-provider acceptance failed: ${message}`);
}

function parseOptions(argv: readonly string[]): Options {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || !value) {
			fail(
				"Usage: PI_STUFF_REAL_ACCEPTANCE=1 bun scripts/verify-magic-context-real.ts [--package <path> | --archive <package.tgz>] [--report <path>] [--pi <path>] [--auth <path>]",
			);
		}
		values.set(flag, value);
	}
	const archive = values.get("--archive");
	const packagePath = values.get("--package");
	if (archive && packagePath) fail("--archive and --package are mutually exclusive");
	for (const key of values.keys()) {
		if (!["--archive", "--auth", "--package", "--pi", "--report"].includes(key)) fail(`unknown option ${key}`);
	}
	return {
		...(archive ? { archivePath: resolve(archive) } : {}),
		authPath: resolve(values.get("--auth") ?? join(homedir(), ".pi/agent/auth.json")),
		packagePath: resolve(packagePath ?? join(root, "packages/pi-stuff")),
		piBinary: resolve(values.get("--pi") ?? process.env["PI_BIN"] ?? DEFAULT_PI_BINARY),
		reportPath: resolve(values.get("--report") ?? join(root, "docs/reports/magic-context-real-acceptance.json")),
	};
}

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function command(command_: readonly string[], cwd: string): string {
	const result = Bun.spawnSync([...command_], { cwd, stderr: "pipe", stdout: "pipe" });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		fail(
			`${basename(command_[0] ?? "command")} exited ${String(result.exitCode)}: ${stderr.trim() || stdout.trim()}`,
		);
	}
	return stdout;
}

function assertSafeArchiveEntries(entries: readonly string[]): void {
	if (entries.length === 0) fail("Suite Package archive is empty");
	for (const entry of entries) {
		if (!entry.startsWith("package/") || entry.includes("/../") || entry.startsWith("/") || entry.includes("\\")) {
			fail(`unsafe Suite Package archive path: ${entry}`);
		}
	}
}

async function verifyLocalPackage(packagePath: string): Promise<string> {
	const manifest = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")) as {
		name?: unknown;
		private?: unknown;
		version?: unknown;
	};
	if (manifest.name !== "@jczhang02/pi-stuff" || manifest.private !== true || !isRuntimeString(manifest.version)) {
		fail(`path is not the private local @jczhang02/pi-stuff Package: ${JSON.stringify(manifest)}`);
	}
	const resolver = createRequire(join(packagePath, "package.json"));
	const officialManifest = JSON.parse(
		await readFile(resolver.resolve("@cortexkit/pi-magic-context/package.json"), "utf8"),
	) as {
		name?: unknown;
		version?: unknown;
	};
	if (officialManifest.name !== "@cortexkit/pi-magic-context" || officialManifest.version !== "0.33.1") {
		fail(`Pi Stuff does not resolve the audited official Magic Context 0.33.1: ${JSON.stringify(officialManifest)}`);
	}
	return packagePath;
}

async function extractPackage(archivePath: string, destination: string): Promise<string> {
	const entries = command(["tar", "--list", "--gzip", "--file", archivePath], destination)
		.trim()
		.split("\n")
		.filter(Boolean);
	assertSafeArchiveEntries(entries);
	command(["tar", "--extract", "--gzip", "--file", archivePath, "--directory", destination], destination);
	const packagePath = join(destination, "package");
	const manifest = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
	};
	if (manifest.name !== "@jczhang02/pi-stuff" || !isRuntimeString(manifest.version)) {
		fail(`archive is not @jczhang02/pi-stuff: ${JSON.stringify(manifest)}`);
	}
	await symlink(join(root, "packages/pi-stuff/node_modules"), join(packagePath, "node_modules"), "dir");
	return verifyLocalPackage(packagePath);
}

function auditRecordContent(record: RpcRecord): string {
	const result = record["result"];
	if (!Check(AUDIT_RESULT_SCHEMA, result)) return "";
	return result.content.map((block) => block.text ?? "").join("\n");
}

function successfulResponse(record: RpcRecord, commandName: string): Record<string, unknown> {
	if (record.type !== "response" || record.command !== commandName || record.success !== true) {
		fail(`RPC ${commandName} failed: ${JSON.stringify(record)}`);
	}
	if (!isRuntimeObject(record.data) || record.data === null) return {};
	return record.data as Record<string, unknown>;
}

async function createRpcTransport(
	commandLine: readonly string[],
	cwd: string,
	environment: Record<string, string | undefined>,
): Promise<RpcTransport> {
	const child = Bun.spawn([...commandLine], {
		cwd,
		detached: true,
		env: environment,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const records: RpcRecord[] = [];
	const pending = new Map<
		string,
		{
			reject: (error: Error) => void;
			resolve: (record: RpcRecord) => void;
			timeout: ReturnType<typeof setTimeout>;
		}
	>();
	const waiters = new Set<{
		from: number;
		predicate: (record: RpcRecord) => boolean;
		reject: (error: Error) => void;
		resolve: (record: RpcRecord) => void;
		timeout: ReturnType<typeof setTimeout>;
	}>();
	let sequence = 0;
	let stderr = "";
	let readError: Error | undefined;
	const stderrReading = (async () => {
		stderr = await new Response(child.stderr).text();
	})();
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const consume = (line: string): void => {
		if (!line) return;
		const parsed: unknown = JSON.parse(line);
		if (!isRuntimeObject(parsed) || parsed === null) throw new Error(`Invalid Pi RPC record: ${line}`);
		const record = parsed as RpcRecord;
		records.push(record);
		if (isRuntimeString(record.id) && record.type === "response") {
			const request = pending.get(record.id);
			if (request) {
				pending.delete(record.id);
				clearTimeout(request.timeout);
				request.resolve(record);
			}
		}
		for (const waiter of waiters) {
			if (records.length - 1 < waiter.from || !waiter.predicate(record)) continue;
			waiters.delete(waiter);
			clearTimeout(waiter.timeout);
			waiter.resolve(record);
		}
	};

	const reading = (async () => {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			while (buffer.includes("\n")) {
				const newline = buffer.indexOf("\n");
				consume(buffer.slice(0, newline).replace(/\r$/u, ""));
				buffer = buffer.slice(newline + 1);
			}
			if (done) {
				consume(buffer.replace(/\r$/u, ""));
				break;
			}
		}
	})().catch((error: unknown) => {
		readError = error instanceof Error ? error : new Error(String(error));
		for (const request of pending.values()) {
			clearTimeout(request.timeout);
			request.reject(readError);
		}
		pending.clear();
		for (const waiter of waiters) {
			clearTimeout(waiter.timeout);
			waiter.reject(readError);
		}
		waiters.clear();
	});

	await Bun.sleep(150);
	if (child.exitCode !== null) {
		await stderrReading;
		fail(`Pi exited during RPC startup: ${stderr.trim() || String(child.exitCode)}`);
	}

	const waitFor: RpcTransport["waitFor"] = async (predicate, options = {}) => {
		const from = options.from ?? 0;
		const existing = records.slice(from).find(predicate);
		if (existing) return existing;
		const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
		return new Promise<RpcRecord>((resolve_, reject) => {
			const waiter = {
				from,
				predicate,
				reject,
				resolve: resolve_,
				timeout: setTimeout(() => {
					waiters.delete(waiter);
					reject(new Error(`Timed out waiting for Pi RPC event after ${String(timeoutMs)}ms`));
				}, timeoutMs),
			};
			waiters.add(waiter);
		});
	};

	const send: RpcTransport["send"] = async (command_, timeoutMs = 60_000) => {
		if (readError) throw readError;
		if (child.exitCode !== null) fail(`Pi RPC process exited ${String(child.exitCode)}: ${stderr.trim()}`);
		const id = `magic-real-rpc-${String(++sequence)}`;
		const response = new Promise<RpcRecord>((resolve_, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Pi RPC request timed out: ${JSON.stringify(command_)}`));
			}, timeoutMs);
			pending.set(id, { reject, resolve: resolve_, timeout });
		});
		child.stdin.write(`${JSON.stringify({ ...command_, id })}\n`);
		await child.stdin.flush();
		const record = await response;
		if (record.success !== true) fail(`Pi RPC request failed: ${JSON.stringify(record)}`);
		return record;
	};

	return {
		records,
		stderr: () => stderr,
		async promptAndWait(message, timeoutMs = TURN_TIMEOUT_MS) {
			const from = records.length;
			await send({ message, type: "prompt" });
			await waitFor((record) => record.type === "agent_settled", { from, timeoutMs });
			return records.slice(from);
		},
		send,
		async stop() {
			await terminateDetachedProcessGroup(child, 10_000);
			await reading;
			await stderrReading;
		},
		waitFor,
	};
}

interface MagicContextEnvironment extends NodeJS.ProcessEnv {}

function environment(paths: {
	readonly agent: string;
	readonly audit: string;
	readonly cache: string;
	readonly data: string;
	readonly home: string;
	readonly magicLog: string;
	readonly state: string;
	readonly xdgConfig: string;
}): MagicContextEnvironment {
	return {
		...process.env,
		HOME: paths.home,
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		MAGIC_CONTEXT_LOG_PATH: paths.magicLog,
		NO_COLOR: "1",
		PI_CODING_AGENT_DIR: paths.agent,
		PI_OFFLINE: "1",
		PI_STUFF_MAGIC_REAL_AUDIT: paths.audit,
		PI_TELEMETRY: "0",
		TERM: "dumb",
		XDG_CACHE_HOME: paths.cache,
		XDG_CONFIG_HOME: paths.xdgConfig,
		XDG_DATA_HOME: paths.data,
		XDG_STATE_HOME: paths.state,
	};
}

function rpcCommand(options: {
	readonly packagePath: string;
	readonly piBinary: string;
	readonly sessionDirectory: string;
	readonly sessionId?: string;
	readonly sessionPath?: string;
}): string[] {
	const commandLine = [
		options.piBinary,
		"--mode",
		"rpc",
		"--offline",
		"--approve",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-themes",
		"--extension",
		join(options.packagePath, "index.ts"),
		"--extension",
		AUDIT_EXTENSION,
		"--provider",
		MAIN_PROVIDER,
		"--model",
		MAIN_MODEL,
		"--thinking",
		"low",
		"--session-dir",
		options.sessionDirectory,
		"--tools",
		"read,TaskCreate,TaskGet,TaskList,TaskUpdate,ctx_memory,ctx_search,goal_complete,goal_blocked",
		"--system-prompt",
		[
			"You are executing a deterministic Pi Stuff acceptance run.",
			"When asked to call named tools, call every named tool exactly as requested; parallel calls are allowed.",
			"When asked to read files, use the read tool once for every listed path and do not summarize file contents.",
			"After requested tools finish, reply only with the requested completion marker unless the prompt explicitly requests continuity values.",
		].join(" "),
	];
	if (options.sessionPath) commandLine.push("--session", options.sessionPath);
	else if (options.sessionId) commandLine.push("--session-id", options.sessionId);
	else fail("RPC launch requires sessionId or sessionPath");
	return commandLine;
}

async function writePressureFiles(projectDirectory: string): Promise<string[]> {
	const vocabulary = [
		"boundary",
		"historian",
		"compartment",
		"pressure",
		"continuity",
		"session",
		"marker",
		"cache",
		"project",
		"retrieval",
		"tool",
		"context",
		"evidence",
		"resume",
		"durable",
		"verification",
	];
	const paths: string[] = [];
	for (let fileIndex = 1; fileIndex <= PRESSURE_FILE_COUNT; fileIndex += 1) {
		const lines: string[] = [];
		let bytes = 0;
		for (let lineIndex = 1; bytes < PRESSURE_FILE_BYTES; lineIndex += 1) {
			const words = Array.from(
				{ length: 14 },
				(_, wordIndex) => vocabulary[(fileIndex * 7 + lineIndex * 3 + wordIndex) % vocabulary.length],
			);
			const line = `pressure-${String(fileIndex).padStart(2, "0")}-${String(lineIndex).padStart(4, "0")} ${words.join(" ")}`;
			lines.push(line);
			bytes += Buffer.byteLength(`${line}\n`);
		}
		const path = join(projectDirectory, `pressure-${String(fileIndex).padStart(2, "0")}.txt`);
		await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
		paths.push(path);
	}
	return paths;
}

async function initializeIsolatedProject(projectDirectory: string, identity: string): Promise<void> {
	await writeFile(join(projectDirectory, "acceptance-project.txt"), `${identity}\n`, { mode: 0o600 });
	command(["git", "init", "--quiet"], projectDirectory);
	command(["git", "config", "user.email", "pi-stuff-acceptance@example.invalid"], projectDirectory);
	command(["git", "config", "user.name", "Pi Stuff Acceptance"], projectDirectory);
	command(["git", "add", "acceptance-project.txt"], projectDirectory);
	command(
		["git", "-c", "commit.gpgsign=false", "commit", "--quiet", "--message", `Initialize ${identity}`],
		projectDirectory,
	);
}

function toolEvents(records: readonly RpcRecord[], name: string): RpcRecord[] {
	return records.filter((record) => record.type === "tool_execution_end" && record["toolName"] === name);
}

function assertToolSuccess(records: readonly RpcRecord[], name: string, expectedMinimum = 1): void {
	const events = toolEvents(records, name);
	if (events.length < expectedMinimum) {
		fail(`expected at least ${String(expectedMinimum)} successful ${name} calls, received ${String(events.length)}`);
	}
	for (const event of events) {
		const result = event["result"];
		if (!Check(TOOL_RESULT_SCHEMA, result) || result.isError === true) {
			fail(`${name} returned an error: ${JSON.stringify(event)}`);
		}
	}
}

async function lastAssistantText(rpc: RpcTransport): Promise<string> {
	const data = successfulResponse(await rpc.send({ type: "get_last_assistant_text" }), "get_last_assistant_text");
	return isRuntimeString(data["text"]) ? data["text"] : "";
}

async function sessionState(rpc: RpcTransport): Promise<SessionState> {
	return successfulResponse(await rpc.send({ type: "get_state" }), "get_state") as SessionState;
}

async function sessionStats(rpc: RpcTransport): Promise<SessionStats> {
	return successfulResponse(await rpc.send({ type: "get_session_stats" }), "get_session_stats") as SessionStats;
}

async function sessionEntries(rpc: RpcTransport): Promise<SessionEntry[]> {
	const data = successfulResponse(await rpc.send({ type: "get_entries" }), "get_entries");
	if (!Array.isArray(data["entries"])) fail("get_entries returned no entries array");
	return data["entries"] as SessionEntry[];
}

function observePressure(observations: PressureObservation[], label: string, stats: SessionStats): void {
	const usage = stats.contextUsage;
	if (!usage || usage.tokens === null || usage.percent === null) return;
	observations.push({ label, percent: usage.percent, tokens: usage.tokens });
}

async function runReadTurn(
	rpc: RpcTransport,
	paths: readonly string[],
	marker: string,
	observations: PressureObservation[],
): Promise<RpcRecord[]> {
	const prompt = `Use read exactly once for each of these files: ${paths.map((path) => basename(path)).join(", ")}. After all reads finish, reply exactly ${marker}.`;
	const records = await rpc.promptAndWait(prompt);
	assertToolSuccess(records, "read", paths.length);
	const answer = await lastAssistantText(rpc);
	if (answer.trim() !== marker) fail(`read turn ${marker} returned ${JSON.stringify(answer)}`);
	observePressure(observations, marker, await sessionStats(rpc));
	return records;
}

function parseSession(path: string): Promise<SessionEntry[]> {
	return readFile(path, "utf8").then((contents) =>
		contents
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as SessionEntry),
	);
}

function magicCompactions(entries: readonly SessionEntry[]): SessionEntry[] {
	return entries.filter((entry) => {
		return entry.type === "compaction" && Check(MAGIC_COMPACTION_DETAILS_SCHEMA, entry.details);
	});
}

function nativeCompactions(entries: readonly SessionEntry[]): SessionEntry[] {
	return entries.filter((entry) => entry.type === "compaction" && !magicCompactions([entry]).length);
}

async function waitForCondition<T>(
	read: () => Promise<T | undefined>,
	options: { readonly intervalMs?: number; readonly label: string; readonly timeoutMs: number },
): Promise<T> {
	const deadline = Date.now() + options.timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const result = await read();
			if (result !== undefined) return result;
		} catch (error) {
			lastError = error;
		}
		await Bun.sleep(options.intervalMs ?? 500);
	}
	fail(
		`timed out waiting for ${options.label}${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`,
	);
}

function readDatabaseEvidence(databasePath: string, sessionId: string): DatabaseEvidence {
	const database = new Database(databasePath, { readonly: true });
	try {
		const count = (sql: string): number => {
			const row = database.query(sql).get(sessionId) as { readonly count?: unknown } | null;
			return Number(row?.count ?? 0);
		};
		const marker = database
			.query("SELECT pending_pi_compaction_marker_state AS marker FROM session_meta WHERE session_id = ?")
			.get(sessionId) as { readonly marker?: unknown } | null;
		return {
			compartments: count("SELECT COUNT(*) AS count FROM compartments WHERE session_id = ? AND harness = 'pi'"),
			historianFailures: count(
				"SELECT COUNT(*) AS count FROM historian_runs WHERE session_id = ? AND status NOT IN ('success', 'noop')",
			),
			historianSuccesses: count(
				"SELECT COUNT(*) AS count FROM historian_runs WHERE session_id = ? AND status = 'success'",
			),
			pendingMarker: isRuntimeString(marker?.marker) && marker.marker.length > 0,
		};
	} finally {
		database.close();
	}
}

function readProjectIdentity(databasePath: string, sessionId: string): string {
	const database = new Database(databasePath, { readonly: true });
	try {
		const row = database
			.query("SELECT project_path AS projectIdentity FROM session_projects WHERE session_id = ? AND harness = 'pi'")
			.get(sessionId) as { readonly projectIdentity?: unknown } | null;
		if (!isRuntimeString(row?.projectIdentity) || !row.projectIdentity) {
			fail(`Magic Context stored no project identity for ${sessionId}`);
		}
		return row.projectIdentity;
	} finally {
		database.close();
	}
}

function readCompartmentRanges(databasePath: string, sessionId: string): CompartmentRange[] {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database
			.query(
				"SELECT start_message AS start, end_message AS end FROM compartments WHERE session_id = ? AND harness = 'pi' ORDER BY sequence",
			)
			.all(sessionId) as CompartmentRange[];
	} finally {
		database.close();
	}
}

function magicBoundaryOrdinals(entries: readonly SessionEntry[]): number[] {
	return magicCompactions(entries).map((entry) => {
		if (!Check(MAGIC_BOUNDARY_DETAILS_SCHEMA, entry.details)) {
			fail(`Magic boundary has no valid lastCompactedOrdinal: ${JSON.stringify(entry)}`);
		}
		return entry.details.lastCompactedOrdinal;
	});
}

function assertStrictlyAdvancing(values: readonly number[], label: string): void {
	for (let index = 1; index < values.length; index += 1) {
		if ((values[index] ?? 0) <= (values[index - 1] ?? 0)) {
			fail(`${label} did not advance strictly: ${JSON.stringify(values)}`);
		}
	}
}

function readMagicPressure(log: string): MagicPressureEvidence {
	const matches = [...log.matchAll(/usage=(\d+(?:\.\d+)?)% \((\d+) tokens, limit=(\d+)\)/gu)].map((match) => ({
		contextLimit: Number(match[3]),
		effectivePercentage: Number(match[1]),
		rawTokens: Number(match[2]),
	}));
	const maximum = matches.reduce<MagicPressureEvidence | undefined>(
		(current, candidate) =>
			!current || candidate.effectivePercentage > current.effectivePercentage ? candidate : current,
		undefined,
	);
	if (!maximum) fail("official Magic Context log contained no context-pressure measurements");
	return maximum;
}

function maximumProviderPromptTokens(entries: readonly SessionEntry[]): number {
	return entries.reduce((maximum, entry) => {
		if (entry.type !== "message" || !Check(PROVIDER_MESSAGE_SCHEMA, entry.message)) {
			return maximum;
		}
		const usage = entry.message.usage;
		const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
		return Math.max(maximum, promptTokens);
	}, 0);
}

function latestGoalStatus(entries: readonly SessionEntry[]): string | undefined {
	const goalEntry = entries.filter((entry) => entry.type === "custom" && entry["customType"] === "goal-state").at(-1);
	return goalEntry && Check(GOAL_STATE_DATA_SCHEMA, goalEntry.data) ? goalEntry.data.goal.status : undefined;
}

function countAuditRecords(records: readonly RpcRecord[], type: string): number {
	return records.filter((record) => record.type === type).length;
}

async function readAudit(path: string): Promise<RpcRecord[]> {
	const contents = await readFile(path, "utf8");
	return contents
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as RpcRecord);
}

async function preserveEvidence(
	workspace: string,
	evidenceDirectory: string,
	paths: {
		readonly audit: string;
		readonly database: string;
		readonly magicConfig: string;
		readonly magicLog: string;
		readonly session: string;
		readonly settings: string;
	},
): Promise<Record<string, EvidenceFile>> {
	await mkdir(evidenceDirectory, { mode: 0o700, recursive: true });
	const evidence: Record<string, EvidenceFile> = {};
	for (const [name, source] of Object.entries(paths)) {
		const extension = name === "database" ? ".db" : name === "session" || name === "audit" ? ".jsonl" : ".txt";
		const target = join(evidenceDirectory, `${name}${extension}`);
		await copyFile(source, target);
		const contents = await readFile(target);
		evidence[name] = {
			bytes: contents.byteLength,
			path: relative(root, target),
			sha256: sha256(contents),
		};
	}
	await rm(workspace, { force: true, recursive: true });
	return evidence;
}

async function main(): Promise<void> {
	if (process.env["PI_STUFF_REAL_ACCEPTANCE"] !== "1") {
		fail("set PI_STUFF_REAL_ACCEPTANCE=1 to acknowledge that this verification makes real provider calls");
	}
	const options = parseOptions(process.argv.slice(2));
	const runId = new Date().toISOString().replaceAll(/[:.]/gu, "-");
	const acceptanceRoot = join(root, ".artifacts/acceptance");
	await mkdir(acceptanceRoot, { mode: 0o700, recursive: true });
	const workspace = await mkdtemp(join(acceptanceRoot, ".magic-context-real-work-"));
	const evidenceDirectory = join(acceptanceRoot, `magic-context-real-${runId}`);
	const paths = {
		agent: join(workspace, "agent"),
		audit: join(workspace, "audit.jsonl"),
		cache: join(workspace, "cache"),
		data: join(workspace, "data"),
		home: join(workspace, "home"),
		magicConfig: join(workspace, "config/cortexkit/magic-context.jsonc"),
		magicLog: join(workspace, "magic-context.log"),
		packageRoot: join(workspace, "aggregate"),
		projectA: join(workspace, "projects/project-a"),
		projectB: join(workspace, "projects/project-b"),
		sessions: join(workspace, "sessions"),
		settings: join(workspace, "agent/settings.json"),
		state: join(workspace, "state"),
		xdgConfig: join(workspace, "config"),
	};
	await Promise.all(
		[
			paths.agent,
			paths.cache,
			paths.data,
			paths.home,
			dirname(paths.magicConfig),
			paths.packageRoot,
			paths.projectA,
			paths.projectB,
			paths.sessions,
			paths.state,
		].map((path) => mkdir(path, { mode: 0o700, recursive: true })),
	);
	await Promise.all([
		copyFile(options.authPath, join(paths.agent, "auth.json")),
		writeFile(paths.audit, "", { mode: 0o600 }),
		writeFile(paths.magicLog, "", { mode: 0o600 }),
		writeFile(
			paths.settings,
			`${JSON.stringify({
				compaction: { enabled: false },
				defaultProjectTrust: "always",
				quietStartup: true,
				retry: { enabled: true, maxRetries: 3 },
				tuiMode: "fullscreen",
			})}\n`,
			{ mode: 0o600 },
		),
		writeFile(
			paths.magicConfig,
			`${JSON.stringify({
				compressor: { enabled: false },
				dreamer: { disable: true },
				embedding: { provider: "off" },
				execute_threshold_percentage: EXECUTE_THRESHOLD_PERCENTAGE,
				fail_closed_blocking: false,
				historian: { model: HISTORIAN_MODEL, thinking_level: "medium" },
				historian_timeout_ms: HISTORIAN_TIMEOUT_MS,
				memory: {
					auto_promote: false,
					auto_search: { enabled: false },
					enabled: true,
					git_commit_indexing: { enabled: false },
				},
				sidekick: { disable: true },
				toast_duration_ms: 0,
				todowrite: { enabled: false, overlay: false },
			})}\n`,
			{ mode: 0o600 },
		),
	]);
	await initializeIsolatedProject(paths.projectA, "Magic Context acceptance project A");
	await initializeIsolatedProject(paths.projectB, "Magic Context acceptance project B");
	const packagePath = options.archivePath
		? await extractPackage(options.archivePath, paths.packageRoot)
		: await verifyLocalPackage(options.packagePath);
	const pressureFiles = await writePressureFiles(paths.projectA);
	const env = environment({
		agent: paths.agent,
		audit: paths.audit,
		cache: paths.cache,
		data: paths.data,
		home: paths.home,
		magicLog: paths.magicLog,
		state: paths.state,
		xdgConfig: paths.xdgConfig,
	});
	const canary = `MC_REAL_${randomUUID().replaceAll("-", "").toUpperCase()}`;
	const canaryHash = sha256(canary);
	const mainSessionId = `magic-real-${randomUUID()}`;
	const isolatedSessionId = `magic-isolated-${randomUUID()}`;
	const observations: PressureObservation[] = [];
	let primary: RpcTransport | undefined;
	let resumed: RpcTransport | undefined;
	let isolated: RpcTransport | undefined;
	let sessionFile = "";
	let sessionId = "";
	let databaseEvidence: DatabaseEvidence | undefined;
	const allRpcRecords: RpcRecord[] = [];
	try {
		primary = await createRpcTransport(
			rpcCommand({
				packagePath,
				piBinary: options.piBinary,
				sessionDirectory: paths.sessions,
				sessionId: mainSessionId,
			}),
			paths.projectA,
			env,
		);
		const initialState = await sessionState(primary);
		if (initialState.autoCompactionEnabled !== false) fail("Pi native auto-compaction was not disabled");
		if (
			initialState.model?.provider !== MAIN_PROVIDER ||
			initialState.model.id !== MAIN_MODEL ||
			initialState.model.contextWindow !== EXPECTED_CONTEXT_WINDOW
		) {
			fail(`unexpected real model contract: ${JSON.stringify(initialState.model)}`);
		}
		if (!isRuntimeString(initialState.sessionFile) || !isRuntimeString(initialState.sessionId)) {
			fail(`Pi did not expose a durable real session: ${JSON.stringify(initialState)}`);
		}
		sessionFile = initialState.sessionFile;
		sessionId = initialState.sessionId;

		const setupRecords = await primary.promptAndWait(
			`The early acceptance canary is ${canary}. Call TaskCreate with subject ${JSON.stringify(TODO_SUBJECT)} and description ${JSON.stringify("A pending task that must survive Magic Context compaction and cold resume.")}. Also call ctx_memory with action write, category WORKFLOW_RULES, and content ${JSON.stringify(`Durable acceptance recall rule: the exact canary is ${canary}`)}. After both tools succeed, reply exactly MAGIC_SETUP_DONE.`,
		);
		assertToolSuccess(setupRecords, "TaskCreate");
		assertToolSuccess(setupRecords, "ctx_memory");
		if ((await lastAssistantText(primary)).trim() !== "MAGIC_SETUP_DONE")
			fail("setup marker was not returned exactly");
		observePressure(observations, "setup", await sessionStats(primary));

		const goalFrom = primary.records.length;
		await primary.send({
			message:
				"/goal Keep the Magic-only acceptance continuity marker active until the maintainer explicitly resumes it",
			type: "prompt",
		});
		await primary.waitFor((record) => record.type === "agent_start", { from: goalFrom, timeoutMs: 60_000 });
		await primary.send({ message: "/goal pause", type: "prompt" });
		await primary.waitFor((record) => record.type === "agent_settled", { from: goalFrom, timeoutMs: 120_000 });
		if (latestGoalStatus(await sessionEntries(primary)) !== "paused")
			fail("Goal did not persist a paused continuity state");

		await runReadTurn(primary, pressureFiles.slice(0, 2), "MAGIC_SINGLE_TURN_DONE", observations);
		await runReadTurn(primary, pressureFiles.slice(2, 3), "MAGIC_MULTI_TURN_1_DONE", observations);
		const beforeLong = await sessionStats(primary);
		const currentTokens = beforeLong.contextUsage?.tokens ?? 0;
		const earlier = observations.find((observation) => observation.label === "MAGIC_SINGLE_TURN_DONE")?.tokens ?? 0;
		const setupTokens = observations.find((observation) => observation.label === "setup")?.tokens ?? 0;
		const perFileEstimate = Math.max(5_000, Math.round((earlier - setupTokens) / 2));
		const targetTokens = Math.round((EXPECTED_CONTEXT_WINDOW * TARGET_PRESSURE_PERCENTAGE) / 100);
		const requestedLongReads = Math.max(2, Math.min(7, Math.ceil((targetTokens - currentTokens) / perFileEstimate)));
		let nextFile = 3;
		await runReadTurn(
			primary,
			pressureFiles.slice(nextFile, nextFile + requestedLongReads),
			"MAGIC_CRITICAL_SINGLE_TURN_DONE",
			observations,
		);
		nextFile += requestedLongReads;
		while (
			nextFile < pressureFiles.length &&
			Math.max(...observations.map((observation) => observation.percent)) < 75 &&
			magicCompactions(await parseSession(sessionFile)).length === 0
		) {
			await runReadTurn(
				primary,
				pressureFiles.slice(nextFile, nextFile + 1),
				`MAGIC_PRESSURE_${String(nextFile + 1)}_DONE`,
				observations,
			);
			nextFile += 1;
		}

		const databasePath = join(paths.data, "cortexkit/magic-context/context.db");
		let historianObserved = false;
		for (let drive = 1; drive <= 3 && !historianObserved; drive += 1) {
			const driveRecords = await primary.promptAndWait(
				`Continue the same acceptance task without reading another file. Reply exactly MAGIC_HISTORIAN_DRIVE_${String(drive)}_DONE.`,
			);
			if (toolEvents(driveRecords, "read").length > 0) fail("historian drive unexpectedly read another file");
			observePressure(observations, `historian-drive-${String(drive)}`, await sessionStats(primary));
			try {
				await waitForCondition(
					async () => {
						const evidence = readDatabaseEvidence(databasePath, sessionId);
						return evidence.historianSuccesses > 0 || evidence.compartments > 0 ? evidence : undefined;
					},
					{ label: "a real historian publication", timeoutMs: drive === 3 ? HISTORIAN_TIMEOUT_MS : 15_000 },
				);
				historianObserved = true;
			} catch (error) {
				if (drive === 3) throw error;
			}
		}
		databaseEvidence = await waitForCondition(
			async () => {
				const evidence = readDatabaseEvidence(databasePath, sessionId);
				return evidence.historianSuccesses > 0 && evidence.compartments > 0 ? evidence : undefined;
			},
			{ label: "successful historian run and compartment", timeoutMs: HISTORIAN_TIMEOUT_MS },
		);

		let compactions = magicCompactions(await parseSession(sessionFile));
		for (let drive = 1; drive <= 4 && compactions.length === 0; drive += 1) {
			await primary.promptAndWait(
				`Consume the published Magic Context history without reading files. Reply exactly MAGIC_MARKER_DRIVE_${String(drive)}_DONE.`,
			);
			observePressure(observations, `marker-drive-${String(drive)}`, await sessionStats(primary));
			compactions = magicCompactions(await parseSession(sessionFile));
		}
		if (compactions.length === 0) fail("Magic Context published no boundary");
		if (compactions.some((entry) => entry.fromHook !== true)) {
			fail("a Magic boundary was not attributed to the extension hook");
		}
		const afterMarkerEntries = await parseSession(sessionFile);
		if (nativeCompactions(afterMarkerEntries).length !== 0)
			fail("Pi-native compaction appeared in the authoritative JSONL");

		const continuityRecords = await primary.promptAndWait(
			"Call TaskList, then call ctx_search with query 'durable acceptance recall rule'. Return exactly two lines: CANARY=<the exact early canary> and TODO=<the pending task subject>.",
		);
		assertToolSuccess(continuityRecords, "TaskList");
		assertToolSuccess(continuityRecords, "ctx_search");
		const continuityText = await lastAssistantText(primary);
		if (!continuityText.includes(canary) || !continuityText.includes(TODO_SUBJECT)) {
			fail(`post-boundary continuity failed: ${JSON.stringify(continuityText)}`);
		}
		if (latestGoalStatus(await sessionEntries(primary)) !== "paused")
			fail("Goal state changed across Magic boundary");
		allRpcRecords.push(...primary.records);
		await primary.stop();
		primary = undefined;

		resumed = await createRpcTransport(
			rpcCommand({
				packagePath,
				piBinary: options.piBinary,
				sessionDirectory: paths.sessions,
				sessionPath: sessionFile,
			}),
			paths.projectA,
			env,
		);
		const resumedState = await sessionState(resumed);
		if (resumedState.autoCompactionEnabled !== false || resumedState.sessionId !== sessionId) {
			fail(`cold resume changed compaction ownership or session identity: ${JSON.stringify(resumedState)}`);
		}
		const resumeRecords = await resumed.promptAndWait(
			"This is a cold resume. Call TaskList and ctx_search with query 'durable acceptance recall rule'. Return exactly two lines: CANARY=<the exact early canary> and TODO=<the pending task subject>.",
		);
		assertToolSuccess(resumeRecords, "TaskList");
		assertToolSuccess(resumeRecords, "ctx_search");
		const resumeText = await lastAssistantText(resumed);
		if (!resumeText.includes(canary) || !resumeText.includes(TODO_SUBJECT)) {
			fail(`cold-resume continuity failed: ${JSON.stringify(resumeText)}`);
		}
		if (latestGoalStatus(await sessionEntries(resumed)) !== "paused") fail("cold resume lost the paused Goal state");
		allRpcRecords.push(...resumed.records);
		await resumed.stop();
		resumed = undefined;

		isolated = await createRpcTransport(
			rpcCommand({
				packagePath,
				piBinary: options.piBinary,
				sessionDirectory: paths.sessions,
				sessionId: isolatedSessionId,
			}),
			paths.projectB,
			env,
		);
		const isolationRecords = await isolated.promptAndWait(
			"Call ctx_search with query 'durable acceptance recall rule'. If the project has no matching memory, reply exactly MAGIC_PROJECT_ISOLATED.",
		);
		assertToolSuccess(isolationRecords, "ctx_search");
		const isolationToolText = toolEvents(isolationRecords, "ctx_search").map(auditRecordContent).join("\n");
		if (isolationToolText.includes(canary)) fail("a second project retrieved the first project's canary");
		if ((await lastAssistantText(isolated)).trim() !== "MAGIC_PROJECT_ISOLATED") {
			fail("the isolated project did not report an empty project-scoped search");
		}
		allRpcRecords.push(...isolated.records);
		await isolated.stop();
		isolated = undefined;

		const finalEntries = await parseSession(sessionFile);
		const finalMagicCompactions = magicCompactions(finalEntries);
		const finalNativeCompactions = nativeCompactions(finalEntries);
		if (finalMagicCompactions.length === 0) fail("no Magic boundary survived cold resume");
		if (finalMagicCompactions.some((entry) => entry.fromHook !== true)) {
			fail("a final Magic boundary was not attributed to the extension hook");
		}
		const boundaryOrdinals = magicBoundaryOrdinals(finalEntries);
		assertStrictlyAdvancing(boundaryOrdinals, "Magic boundary ordinals");
		const rawSession = await readFile(sessionFile);
		const rawSessionText = rawSession.toString("utf8");
		for (const required of ["MAGIC_SETUP_DONE", "MAGIC_SINGLE_TURN_DONE", TODO_SUBJECT, canary]) {
			if (!rawSessionText.includes(required))
				fail(`authoritative JSONL lost ${required === canary ? "the canary" : required}`);
		}
		const audit = await readAudit(paths.audit);
		const maximumContextCharacters = audit
			.filter((record) => record.type === "context_projection")
			.reduce((maximum, record) => Math.max(maximum, Number(record["characters"] ?? 0)), 0);
		if (maximumContextCharacters < PRESSURE_FILE_BYTES * 4) {
			fail(
				`instrumented context never contained substantial Tool output: ${String(maximumContextCharacters)} chars`,
			);
		}
		if (audit.some((record) => record.type === "tool_result" && record["isError"] === true)) {
			fail("a real acceptance Tool result failed");
		}
		if (
			countAuditRecords(audit, "session_before_compact") !== 0 ||
			countAuditRecords(audit, "session_compact") !== 0
		) {
			fail("Pi native compaction lifecycle events fired despite compaction.enabled=false");
		}
		for (const forbidden of [
			"compaction_start",
			"compaction_end",
			"auto_retry_start",
			"auto_retry_end",
			"summarization_retry_scheduled",
		]) {
			if (countAuditRecords(allRpcRecords, forbidden) > 0) fail(`unexpected Pi event ${forbidden} occurred`);
		}
		const extensionErrors = allRpcRecords.filter((record) => record.type === "extension_error");
		if (extensionErrors.length > 0) fail(`extension errors occurred: ${JSON.stringify(extensionErrors)}`);
		const visibleMagicUi = allRpcRecords.filter(
			(record) =>
				record.type === "extension_ui_request" &&
				/Context full|Magic Context|ctx-flush/iu.test(JSON.stringify(record)),
		);
		if (visibleMagicUi.length > 0) {
			fail(
				`Magic Context leaked a user-visible emergency or duplicate UI request: ${JSON.stringify(visibleMagicUi)}`,
			);
		}
		if (!databaseEvidence || databaseEvidence.historianSuccesses < 1 || databaseEvidence.compartments < 1) {
			fail(`historian evidence is incomplete: ${JSON.stringify(databaseEvidence)}`);
		}
		databaseEvidence = readDatabaseEvidence(join(paths.data, "cortexkit/magic-context/context.db"), sessionId);
		if (databaseEvidence.historianFailures > 0) {
			fail(`the real historian recorded failures: ${JSON.stringify(databaseEvidence)}`);
		}
		if (databaseEvidence.pendingMarker) fail("Magic deferred compaction marker remained undrained");
		if (databaseEvidence.historianSuccesses !== finalMagicCompactions.length) {
			fail(
				`successful Magic publications and boundaries differ: ${JSON.stringify({ boundaries: finalMagicCompactions.length, historianSuccesses: databaseEvidence.historianSuccesses })}`,
			);
		}
		const compartmentRanges = readCompartmentRanges(databasePath, sessionId);
		if (compartmentRanges.length !== databaseEvidence.compartments) {
			fail(`compartment range evidence is incomplete: ${JSON.stringify(compartmentRanges)}`);
		}
		for (let index = 1; index < compartmentRanges.length; index += 1) {
			if ((compartmentRanges[index]?.start ?? 0) <= (compartmentRanges[index - 1]?.end ?? 0)) {
				fail(`Magic compartments overlap or repeat history: ${JSON.stringify(compartmentRanges)}`);
			}
		}
		const mainProjectIdentity = readProjectIdentity(databasePath, sessionId);
		const isolatedProjectIdentity = readProjectIdentity(databasePath, isolatedSessionId);
		if (mainProjectIdentity === isolatedProjectIdentity) fail("the two real projects resolved to the same identity");
		const maximumPressure = observations.reduce(
			(maximum, observation) => (observation.percent > maximum.percent ? observation : maximum),
			{ label: "none", percent: 0, tokens: 0 },
		);
		const magicPressure = readMagicPressure(await readFile(paths.magicLog, "utf8"));
		if (magicPressure.contextLimit !== EXPECTED_CONTEXT_WINDOW || magicPressure.effectivePercentage < 80) {
			fail(
				`official Magic Context never observed the real window's critical region: ${JSON.stringify(magicPressure)}`,
			);
		}
		const providerPromptTokens = maximumProviderPromptTokens(finalEntries);
		if (providerPromptTokens < EXPECTED_CONTEXT_WINDOW * 0.3) {
			fail(
				`real provider prompts never carried a substantial long-session context: ${String(providerPromptTokens)}`,
			);
		}
		if (providerPromptTokens >= EXPECTED_CONTEXT_WINDOW) {
			fail(`a provider request reached or exceeded the real context window: ${String(providerPromptTokens)}`);
		}
		const finalStats = await (async (): Promise<SessionStats> => {
			const assistantUsage = finalEntries.flatMap((entry) =>
				entry.type === "message" && Check(PROVIDER_MESSAGE_SCHEMA, entry.message) ? [entry.message.usage] : [],
			);
			const sum = (field: keyof ProviderUsage): number =>
				assistantUsage.reduce((total, usage) => total + (usage[field] ?? 0), 0);
			return {
				tokens: {
					cacheRead: sum("cacheRead"),
					cacheWrite: sum("cacheWrite"),
					input: sum("input"),
					output: sum("output"),
					total: sum("totalTokens"),
				},
			};
		})();
		const cacheRead = finalStats.tokens?.cacheRead ?? 0;
		const uncachedInput = finalStats.tokens?.input ?? 0;
		if (cacheRead <= 0) fail("real provider never reported a Prompt Cache hit");

		const evidence = await preserveEvidence(workspace, evidenceDirectory, {
			audit: paths.audit,
			database: join(paths.data, "cortexkit/magic-context/context.db"),
			magicConfig: paths.magicConfig,
			magicLog: paths.magicLog,
			session: sessionFile,
			settings: paths.settings,
		});
		const artifact = options.archivePath
			? {
					archive: basename(options.archivePath),
					sha256: sha256(await readFile(options.archivePath)),
				}
			: {
					package: relative(root, options.packagePath),
					sha256: sha256(
						`${await readFile(join(options.packagePath, "package.json"), "utf8")}\n${await readFile(join(options.packagePath, "index.ts"), "utf8")}`,
					),
				};
		const report = {
			artifact,
			cache: {
				cacheRead,
				hitPercentage: Number(((cacheRead / Math.max(1, cacheRead + uncachedInput)) * 100).toFixed(2)),
				uncachedInput,
			},
			continuity: {
				canarySha256: canaryHash,
				coldResume: true,
				goalStatus: "paused",
				projectIsolation: {
					distinct: true,
					isolatedIdentitySha256: sha256(isolatedProjectIdentity),
					mainIdentitySha256: sha256(mainProjectIdentity),
				},
				todoSubjectSha256: sha256(TODO_SUBJECT),
			},
			database: databaseEvidence,
			evidence,
			host: {
				piVersion: command([options.piBinary, "--version"], root).trim(),
			},
			magicContext: {
				executeThresholdPercentage: EXECUTE_THRESHOLD_PERCENTAGE,
				historianModel: HISTORIAN_MODEL,
				package: "@cortexkit/pi-magic-context@0.33.1",
			},
			model: {
				contextWindow: EXPECTED_CONTEXT_WINDOW,
				id: MAIN_MODEL,
				provider: MAIN_PROVIDER,
			},
			ownership: {
				compartmentRanges,
				magicBoundaries: finalMagicCompactions.length,
				magicBoundaryOrdinals: boundaryOrdinals,
				nativeAutoCompactionEnabled: false,
				nativeBoundaries: finalNativeCompactions.length,
				nativeLifecycleEvents: 0,
			},
			passed: true,
			pressure: {
				maximumContextCharacters,
				maximumObservedAfterTurn: maximumPressure,
				maximumProviderPrompt: {
					percent: Number(((providerPromptTokens / EXPECTED_CONTEXT_WINDOW) * 100).toFixed(2)),
					tokens: providerPromptTokens,
				},
				officialMagicMaximum: magicPressure,
				observations,
			},
			runAt: new Date().toISOString(),
			schemaVersion: 1,
			session: {
				entries: finalEntries.length,
				sha256: sha256(rawSession),
			},
		};
		await mkdir(dirname(options.reportPath), { recursive: true });
		await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
		console.log(`Magic-only real-provider acceptance passed; report: ${options.reportPath}`);
		console.log(`Retained credential-free evidence: ${evidenceDirectory}`);
	} catch (error) {
		const diagnostics = [primary, resumed, isolated]
			.filter((transport): transport is RpcTransport => transport !== undefined)
			.map((transport) => transport.stderr().trim())
			.filter(Boolean)
			.join("\n");
		console.error(`Raw diagnostic workspace retained until manual cleanup: ${workspace}`);
		if (diagnostics) console.error(diagnostics.slice(-20_000));
		throw error;
	} finally {
		for (const transport of [primary, resumed, isolated]) {
			if (!transport) continue;
			await transport.stop().catch(() => undefined);
		}
		await rm(join(paths.agent, "auth.json"), { force: true }).catch(() => undefined);
	}
}

await main();
