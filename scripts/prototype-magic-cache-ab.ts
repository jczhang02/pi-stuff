/**
 * PROTOTYPE — compare Pi Stuff's displayed prompt-cache hit rate with and
 * without Magic Context under one matched, real-provider long-session load.
 *
 * This is deliberately an experiment harness, not production code. It copies
 * auth into a private temporary directory, removes that directory afterward,
 * and writes only credential-free aggregate results under .artifacts/.
 */
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const PI_BINARY = resolve(process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi");
const PROVIDER = "openai-codex";
const MODEL = "gpt-5.3-codex-spark";
const CONTEXT_WINDOW = 128_000;
const MAGIC_THRESHOLD_PERCENT = 65;
const PRESSURE_BYTES = 48 * 1024;
const MAX_PRESSURE_FILES = 14;
const TURN_TIMEOUT_MS = 10 * 60_000;
const AUTH_PATH = join(homedir(), ".pi/agent/auth.json");
const INSTALLED_AGGREGATE = join(homedir(), ".pi/agent/packages/pi-stuff-current");
const CONTEXT_EXTENSION = join(INSTALLED_AGGREGATE, "node_modules/@jczhang02/pi-stuff-context/index.ts");

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

interface Usage {
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly input: number;
}

interface TurnResult extends Usage {
	readonly boundaryCount: number;
	readonly contextPercent: number | null;
	readonly contextTokens: number | null;
	readonly cumulativeCacheHitRate: number;
	readonly label: string;
	readonly turn: number;
	readonly turnCacheHitRate: number;
}

interface ExperimentAction {
	readonly files?: readonly number[];
	readonly kind: "prompt";
	readonly label: string;
}

interface ArmResult {
	readonly actions: readonly ExperimentAction[];
	readonly boundaryTurn: number | null;
	readonly final: Usage & { readonly cacheHitRate: number };
	readonly forcedManualCompaction: false;
	readonly magicBoundaries: number;
	readonly name: "magic" | "plain";
	readonly turns: readonly TurnResult[];
}

interface ArmPaths {
	readonly agent: string;
	readonly cache: string;
	readonly config: string;
	readonly data: string;
	readonly home: string;
	readonly magicLog: string;
	readonly project: string;
	readonly sessions: string;
	readonly state: string;
}

interface ArmRuntime {
	accountedUsage: Usage;
	readonly name: "magic" | "plain";
	readonly paths: ArmPaths;
	readonly pressureFiles: readonly string[];
	readonly rpc: RpcTransport;
}

function fail(message: string): never {
	throw new Error(`Magic cache A/B prototype failed: ${message}`);
}

function finite(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function cacheHitRate(usage: Usage): number {
	const denominator = usage.input + usage.cacheRead + usage.cacheWrite;
	return denominator > 0 ? (usage.cacheRead / denominator) * 100 : 0;
}

function rounded(value: number): number {
	return Number(value.toFixed(2));
}

function successfulData(record: RpcRecord, command: string): Record<string, unknown> {
	if (record.type !== "response" || record.command !== command || record.success !== true) {
		fail(`RPC ${command} failed: ${JSON.stringify(record)}`);
	}
	return typeof record.data === "object" && record.data !== null ? (record.data as Record<string, unknown>) : {};
}

async function createRpcTransport(
	commandLine: readonly string[],
	cwd: string,
	environment: Record<string, string | undefined>,
): Promise<RpcTransport> {
	const child = Bun.spawn([...commandLine], {
		cwd,
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
		if (typeof parsed !== "object" || parsed === null) fail(`invalid RPC record: ${line.slice(0, 200)}`);
		const record = parsed as RpcRecord;
		records.push(record);
		if (typeof record.id === "string" && record.type === "response") {
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

	await Bun.sleep(200);
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
					reject(new Error(`timed out waiting for RPC event after ${String(timeoutMs)} ms`));
				}, timeoutMs),
			};
			waiters.add(waiter);
		});
	};

	const send: RpcTransport["send"] = async (command, timeoutMs = 90_000) => {
		if (readError) throw readError;
		if (child.exitCode !== null) fail(`Pi exited ${String(child.exitCode)}: ${stderr.trim()}`);
		const id = `cache-ab-${String(++sequence)}`;
		const response = new Promise<RpcRecord>((resolve_, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`RPC request timed out: ${JSON.stringify(command)}`));
			}, timeoutMs);
			pending.set(id, { reject, resolve: resolve_, timeout });
		});
		child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
		await child.stdin.flush();
		const record = await response;
		if (record.success !== true) fail(`RPC command failed: ${JSON.stringify(record)}`);
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
			child.kill("SIGTERM");
			await Promise.race([child.exited, Bun.sleep(10_000)]);
			if (child.exitCode === null) child.kill("SIGKILL");
			await child.exited;
			await reading;
			await stderrReading;
		},
		waitFor,
	};
}

function rpcCommand(name: "magic" | "plain", paths: ArmPaths, sessionId: string): string[] {
	const commandLine = [
		PI_BINARY,
		"--mode",
		"rpc",
		"--offline",
		"--approve",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-themes",
	];
	if (name === "magic") commandLine.push("--extension", CONTEXT_EXTENSION);
	commandLine.push(
		"--provider",
		PROVIDER,
		"--model",
		MODEL,
		"--thinking",
		"low",
		"--session-dir",
		paths.sessions,
		"--session-id",
		sessionId,
		"--tools",
		"read",
		"--system-prompt",
		`You are running cache arm ${name === "magic" ? "MAGIC" : "PLAIN"}. When asked to read files, call read exactly once for every listed path. After all requested reads finish, reply with only the requested marker. Otherwise never call tools.`,
	);
	return commandLine;
}

function armEnvironment(paths: ArmPaths): Record<string, string | undefined> {
	return {
		...process.env,
		HOME: paths.home,
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		MAGIC_CONTEXT_LOG_PATH: paths.magicLog,
		NO_COLOR: "1",
		PI_CODING_AGENT_DIR: paths.agent,
		PI_OFFLINE: "1",
		PI_TELEMETRY: "0",
		TERM: "dumb",
		XDG_CACHE_HOME: paths.cache,
		XDG_CONFIG_HOME: paths.config,
		XDG_DATA_HOME: paths.data,
		XDG_STATE_HOME: paths.state,
	};
}

async function writePressureFiles(project: string, arm: "magic" | "plain"): Promise<string[]> {
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
	const files: string[] = [];
	for (let fileIndex = 1; fileIndex <= MAX_PRESSURE_FILES; fileIndex++) {
		const lines: string[] = [];
		let bytes = 0;
		for (let lineIndex = 1; bytes < PRESSURE_BYTES; lineIndex++) {
			const words = Array.from(
				{ length: 14 },
				(_, wordIndex) => vocabulary[(fileIndex * 7 + lineIndex * 3 + wordIndex) % vocabulary.length],
			);
			const line = `${arm}-pressure-${String(fileIndex).padStart(2, "0")}-${String(lineIndex).padStart(4, "0")} ${words.join(" ")}`;
			lines.push(line);
			bytes += Buffer.byteLength(`${line}\n`);
		}
		const path = join(project, `pressure-${String(fileIndex).padStart(2, "0")}.txt`);
		await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
		files.push(path);
	}
	return files;
}

async function setupArm(root: string, name: "magic" | "plain"): Promise<ArmRuntime> {
	const armRoot = join(root, name);
	const paths: ArmPaths = {
		agent: join(armRoot, "agent"),
		cache: join(armRoot, "cache"),
		config: join(armRoot, "config"),
		data: join(armRoot, "data"),
		home: join(armRoot, "home"),
		magicLog: join(armRoot, "magic-context.log"),
		project: join(armRoot, "project"),
		sessions: join(armRoot, "sessions"),
		state: join(armRoot, "state"),
	};
	await Promise.all(
		[
			paths.agent,
			paths.cache,
			join(paths.config, "cortexkit"),
			paths.data,
			paths.home,
			paths.project,
			paths.sessions,
			paths.state,
		].map((path) => mkdir(path, { mode: 0o700, recursive: true })),
	);
	await copyFile(AUTH_PATH, join(paths.agent, "auth.json"));
	await chmod(join(paths.agent, "auth.json"), 0o600);
	await writeFile(
		join(paths.agent, "settings.json"),
		`${JSON.stringify({
			compaction: { enabled: false },
			defaultProjectTrust: "always",
			quietStartup: true,
			retry: { enabled: true, maxRetries: 3 },
			uiMode: "fullscreen",
		})}\n`,
		{ mode: 0o600 },
	);
	await writeFile(paths.magicLog, "", { mode: 0o600 });
	await writeFile(
		join(paths.config, "cortexkit/magic-context.jsonc"),
		`${JSON.stringify({
			compressor: { enabled: false },
			dreamer: { disable: true },
			embedding: { provider: "off" },
			execute_threshold_percentage: MAGIC_THRESHOLD_PERCENT,
			fail_closed_blocking: false,
			historian: { model: "openai-codex/gpt-5.6-terra", thinking_level: "low" },
			historian_timeout_ms: TURN_TIMEOUT_MS,
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
	);
	const pressureFiles = await writePressureFiles(paths.project, name);
	const rpc = await createRpcTransport(
		rpcCommand(name, paths, `cache-ab-${name}-${crypto.randomUUID()}`),
		paths.project,
		armEnvironment(paths),
	);
	const state = successfulData(await rpc.send({ type: "get_state" }), "get_state");
	const model = state["model"];
	if (
		typeof model !== "object" ||
		model === null ||
		Reflect.get(model, "provider") !== PROVIDER ||
		Reflect.get(model, "id") !== MODEL ||
		Reflect.get(model, "contextWindow") !== CONTEXT_WINDOW ||
		state["autoCompactionEnabled"] !== false
	) {
		fail(`${name} arm has an unexpected host contract: ${JSON.stringify(state)}`);
	}
	return {
		accountedUsage: { cacheRead: 0, cacheWrite: 0, input: 0 },
		name,
		paths,
		pressureFiles,
		rpc,
	};
}

function entryUsage(entry: unknown): Usage | undefined {
	if (typeof entry !== "object" || entry === null || Reflect.get(entry, "type") !== "message") return undefined;
	const message = Reflect.get(entry, "message");
	if (typeof message !== "object" || message === null || Reflect.get(message, "role") !== "assistant")
		return undefined;
	const stopReason = Reflect.get(message, "stopReason");
	if (stopReason === "error" || stopReason === "aborted" || stopReason === "pending") return undefined;
	const usage = Reflect.get(message, "usage");
	if (typeof usage !== "object" || usage === null) return undefined;
	return {
		cacheRead: finite(Reflect.get(usage, "cacheRead")),
		cacheWrite: finite(Reflect.get(usage, "cacheWrite")),
		input: finite(Reflect.get(usage, "input")),
	};
}

function addUsage(left: Usage, right: Usage): Usage {
	return {
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		input: left.input + right.input,
	};
}

function subtractUsage(total: Usage, previous: Usage): Usage {
	return {
		cacheRead: Math.max(0, total.cacheRead - previous.cacheRead),
		cacheWrite: Math.max(0, total.cacheWrite - previous.cacheWrite),
		input: Math.max(0, total.input - previous.input),
	};
}

async function entries(rpc: RpcTransport): Promise<unknown[]> {
	const data = successfulData(await rpc.send({ type: "get_entries" }, 120_000), "get_entries");
	if (!Array.isArray(data["entries"])) fail("get_entries returned no entries");
	return data["entries"];
}

function magicBoundaryCount(values: readonly unknown[]): number {
	return values.filter((entry) => {
		if (typeof entry !== "object" || entry === null || Reflect.get(entry, "type") !== "compaction") return false;
		const details = Reflect.get(entry, "details");
		return typeof details === "object" && details !== null && Reflect.get(details, "source") === "magic-context";
	}).length;
}

async function snapshot(runtime: ArmRuntime, label: string, turn: number): Promise<TurnResult> {
	const values = await entries(runtime.rpc);
	const assistantUsage = values.map(entryUsage).filter((value): value is Usage => value !== undefined);
	const cumulative = assistantUsage.reduce(addUsage, { cacheRead: 0, cacheWrite: 0, input: 0 });
	const latest = subtractUsage(cumulative, runtime.accountedUsage);
	runtime.accountedUsage = cumulative;
	if (latest.input + latest.cacheRead + latest.cacheWrite === 0)
		fail(`${runtime.name} turn ${String(turn)} produced no successful assistant usage`);
	const stats = successfulData(await runtime.rpc.send({ type: "get_session_stats" }), "get_session_stats");
	const contextUsage = stats["contextUsage"];
	const contextTokens =
		typeof contextUsage === "object" &&
		contextUsage !== null &&
		typeof Reflect.get(contextUsage, "tokens") === "number"
			? Number(Reflect.get(contextUsage, "tokens"))
			: null;
	const contextPercent =
		typeof contextUsage === "object" &&
		contextUsage !== null &&
		typeof Reflect.get(contextUsage, "percent") === "number"
			? Number(Reflect.get(contextUsage, "percent"))
			: null;
	const result: TurnResult = {
		...latest,
		boundaryCount: magicBoundaryCount(values),
		contextPercent,
		contextTokens,
		cumulativeCacheHitRate: rounded(cacheHitRate(cumulative)),
		label,
		turn,
		turnCacheHitRate: rounded(cacheHitRate(latest)),
	};
	console.log(
		`[${runtime.name}] turn=${String(turn)} ${label} context=${contextPercent === null ? "n/a" : `${contextPercent.toFixed(1)}%`} cache(turn)=${result.turnCacheHitRate.toFixed(2)}% cache(total)=${result.cumulativeCacheHitRate.toFixed(2)}% boundaries=${String(result.boundaryCount)}`,
	);
	return result;
}

async function prompt(
	runtime: ArmRuntime,
	label: string,
	turn: number,
	files: readonly number[] = [],
): Promise<TurnResult> {
	const marker = `CACHE_${label.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, "_")}_DONE`;
	const paths = files.map((file) => {
		const path = runtime.pressureFiles[file - 1];
		if (!path) fail(`missing pressure file ${String(file)}`);
		return basename(path);
	});
	const records = await runtime.rpc.promptAndWait(
		paths.length > 0
			? `Use read exactly once for each of these files: ${paths.join(", ")}. After all reads finish, reply exactly ${marker}.`
			: `Reply exactly ${marker}. Do not call tools.`,
	);
	const readResults = records.filter(
		(record) => record.type === "tool_execution_end" && record["toolName"] === "read" && record["isError"] !== true,
	);
	if (readResults.length !== paths.length) {
		fail(
			`${runtime.name} ${label} expected ${String(paths.length)} successful reads, observed ${String(readResults.length)}`,
		);
	}
	return snapshot(runtime, label, turn);
}

async function executeAction(runtime: ArmRuntime, action: ExperimentAction, turns: TurnResult[]): Promise<void> {
	turns.push(await prompt(runtime, action.label, turns.length + 1, action.files));
}

function finalUsage(turns: readonly TurnResult[]): Usage & { readonly cacheHitRate: number } {
	const totals = turns.reduce<Usage>((total, turn) => addUsage(total, turn), {
		cacheRead: 0,
		cacheWrite: 0,
		input: 0,
	});
	return { ...totals, cacheHitRate: rounded(cacheHitRate(totals)) };
}

async function runMagic(runtime: ArmRuntime): Promise<ArmResult> {
	const actions: ExperimentAction[] = [];
	const turns: TurnResult[] = [];
	const candidates: ExperimentAction[] = [
		{ files: [1, 2], kind: "prompt", label: "pressure-1" },
		{ files: [3], kind: "prompt", label: "pressure-2" },
		{ files: [4, 5, 6, 7, 8, 9, 10], kind: "prompt", label: "pressure-3" },
		{ files: [11], kind: "prompt", label: "pressure-4" },
		{ files: [12], kind: "prompt", label: "pressure-5" },
	];
	for (let drive = 1; drive <= 3; drive++) candidates.push({ kind: "prompt", label: `drive-${String(drive)}` });
	candidates.push({ files: [13], kind: "prompt", label: "pressure-6" });
	candidates.push({ files: [14], kind: "prompt", label: "pressure-7" });
	for (let drive = 4; drive <= 8; drive++) candidates.push({ kind: "prompt", label: `drive-${String(drive)}` });

	let boundaryTurn: number | null = null;
	for (const action of candidates) {
		actions.push(action);
		await executeAction(runtime, action, turns);
		if ((turns.at(-1)?.boundaryCount ?? 0) > 0) {
			boundaryTurn = turns.length;
			break;
		}
		if (action.label.startsWith("drive-")) await Bun.sleep(5_000);
	}
	if (boundaryTurn === null) {
		const magicLog = await readFile(runtime.paths.magicLog, "utf8").catch(() => "");
		const extensionErrors = runtime.rpc.records.filter((record) => record.type === "extension_error");
		fail(
			`Magic Context did not publish an automatic boundary under the accepted 65% threshold. extensionErrors=${JSON.stringify(extensionErrors)} logTail=${JSON.stringify(magicLog.slice(-4_000))}`,
		);
	}
	for (let probe = 1; probe <= 2; probe++) {
		const action = { kind: "prompt", label: `post-boundary-${String(probe)}` } as const;
		actions.push(action);
		await executeAction(runtime, action, turns);
	}
	return {
		actions,
		boundaryTurn,
		final: finalUsage(turns),
		forcedManualCompaction: false,
		magicBoundaries: turns.at(-1)?.boundaryCount ?? 0,
		name: "magic",
		turns,
	};
}

async function runPlain(
	runtime: ArmRuntime,
	actions: readonly ExperimentAction[],
	boundaryTurn: number,
): Promise<ArmResult> {
	const turns: TurnResult[] = [];
	for (const action of actions) await executeAction(runtime, action, turns);
	return {
		actions,
		boundaryTurn,
		final: finalUsage(turns),
		forcedManualCompaction: false,
		magicBoundaries: 0,
		name: "plain",
		turns,
	};
}

function windowUsage(turns: readonly TurnResult[], startTurn: number): Usage & { readonly cacheHitRate: number } {
	const selected = turns.filter((turn) => turn.turn >= startTurn);
	return finalUsage(selected);
}

async function commandOutput(command: readonly string[]): Promise<string> {
	const result = Bun.spawnSync([...command], { stderr: "pipe", stdout: "pipe" });
	if (result.exitCode !== 0) fail(`${basename(command[0] ?? "command")} failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString().trim();
}

async function main(): Promise<void> {
	if ((await commandOutput([PI_BINARY, "--version"])) !== "0.83.0") fail("the certified Pi 0.83.0 host is required");
	const installed = await realpath(INSTALLED_AGGREGATE);
	const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
	};
	if (manifest.name !== "@jczhang02/pi-stuff" || manifest.version !== "0.3.3") {
		fail(`expected installed Pi Stuff 0.3.3, found ${JSON.stringify(manifest)}`);
	}
	const workspace = await mkdtemp(join(tmpdir(), "pi-stuff-magic-cache-ab-"));
	let magic: ArmRuntime | undefined;
	let plain: ArmRuntime | undefined;
	try {
		console.log(`Question: what cache hit rate does Pi Stuff display with and without Magic Context?`);
		console.log(
			`Model: ${PROVIDER}/${MODEL}; context=${String(CONTEXT_WINDOW)}; Magic threshold=${String(MAGIC_THRESHOLD_PERCENT)}%`,
		);
		magic = await setupArm(workspace, "magic");
		console.log("Running Magic arm until one automatic Magic boundary, then two warm-cache probes…");
		const magicResult = await runMagic(magic);
		await magic.rpc.stop();
		magic = undefined;

		plain = await setupArm(workspace, "plain");
		console.log("Running matched no-Magic arm with the exact same pressure and prompt sequence…");
		const plainResult = await runPlain(plain, magicResult.actions, magicResult.boundaryTurn ?? 1);
		await plain.rpc.stop();
		plain = undefined;

		const boundaryTurn = magicResult.boundaryTurn ?? 1;
		const report = {
			comparison: {
				cumulativePercentagePointDelta: rounded(magicResult.final.cacheHitRate - plainResult.final.cacheHitRate),
				matchedWindow: {
					magic: windowUsage(magicResult.turns, boundaryTurn),
					plain: windowUsage(plainResult.turns, boundaryTurn),
					startTurn: boundaryTurn,
				},
			},
			formula: "cacheRead / (input + cacheRead + cacheWrite)",
			host: { pi: "0.83.0", piStuff: "0.3.3" },
			magic: magicResult,
			model: { contextWindow: CONTEXT_WINDOW, id: MODEL, provider: PROVIDER },
			plain: plainResult,
			runAt: new Date().toISOString(),
			schemaVersion: 1,
		};
		const reportPath = join(
			process.cwd(),
			`.artifacts/prototypes/magic-cache-ab-${report.runAt.replaceAll(/[:.]/gu, "-")}.json`,
		);
		await mkdir(dirname(reportPath), { recursive: true });
		await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
		console.log("\nRESULT");
		console.log(
			JSON.stringify(
				{
					boundaryTurn,
					magicCacheHitRate: magicResult.final.cacheHitRate,
					matchedPostBoundaryMagic: report.comparison.matchedWindow.magic.cacheHitRate,
					matchedPostBoundaryPlain: report.comparison.matchedWindow.plain.cacheHitRate,
					percentagePointDelta: report.comparison.cumulativePercentagePointDelta,
					plainCacheHitRate: plainResult.final.cacheHitRate,
					reportPath,
				},
				null,
				2,
			),
		);
	} finally {
		for (const runtime of [magic, plain]) {
			if (!runtime) continue;
			await runtime.rpc.stop().catch(() => undefined);
		}
		if (!workspace.startsWith(`${tmpdir()}/pi-stuff-magic-cache-ab-`)) fail(`unsafe temporary path: ${workspace}`);
		await rm(workspace, { force: true, recursive: true });
	}
}

await main();
