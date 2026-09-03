import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	CONTEXT_RESUME_DONE,
	CONTEXT_RESUME_REQUEST,
	createBuiltinOpenAiServer,
	PROVIDER_CONTEXT_WINDOW,
} from "./context-input-frame-provider-fixture.ts";
import { disableSessionNamingForTest } from "./session-naming-test-settings.ts";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/context-pty-provider.ts");
const runner = join(root, "test/fixtures/context-pty-runner.sh");
const INPUT_FRAME_LATENCY_LIMIT_MS = 150;
const WORKING_STALL_LIMIT_MS = 500;
const HISTORY_MARKER = "CONTEXT_INPUT_HISTORY_499";
type PtyEnvironment = Record<string, string | undefined>;

const ZERO_USAGE = {
	cacheRead: 0,
	cacheWrite: 0,
	cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
	input: 0,
	output: 0,
	totalTokens: 0,
};

export interface ContextInputFramePtyVerificationOptions {
	readonly columns?: number;
	readonly piBinary: string;
	readonly packagePath: string;
	readonly rows?: number;
}

function fail(message: string): never {
	throw new Error(`Context input-frame PTY verification failed: ${message}`);
}

function runCommand(args: readonly string[], environment?: PtyEnvironment): string {
	const result = environment
		? Bun.spawnSync([...args], { env: environment, stderr: "pipe", stdout: "pipe" })
		: Bun.spawnSync([...args], { stderr: "pipe", stdout: "pipe" });
	if (result.exitCode !== 0) {
		fail(`${args.join(" ")} exited ${String(result.exitCode)}: ${result.stderr.toString().trim()}`);
	}
	return result.stdout.toString();
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function editorContains(frame: string, text: string): boolean {
	const lines = frame.split("\n");
	for (let index = 0; index + 2 < lines.length; index += 1) {
		if (
			/^─+$/u.test(lines[index] ?? "") &&
			(lines[index + 1] ?? "").includes(text) &&
			/^─+$/u.test(lines[index + 2] ?? "")
		) {
			return true;
		}
	}
	return false;
}

function transcriptContainsUserMessage(frame: string, text: string): boolean {
	const lines = frame.split("\n");
	for (let index = 1; index + 1 < lines.length; index += 1) {
		if (
			(lines[index] ?? "").trim() === text &&
			(lines[index - 1] ?? "").trim() === "" &&
			(lines[index + 1] ?? "").trim() === ""
		) {
			return true;
		}
	}
	return false;
}

async function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

function seedSession(sessionDirectory: string, cwd: string): string {
	const manager = SessionManager.create(cwd, sessionDirectory, { id: "context-input-frame" });
	manager.appendModelChange("pi-stuff-context-pty", "fixture-model");
	const timestamp = Date.now();
	for (let index = 0; index < 500; index += 1) {
		manager.appendMessage({
			content:
				index === 0
					? [
							{ text: `CONTEXT_INPUT_HISTORY_${String(index)}`, type: "text" },
							{ data: "%".repeat(4 * 1024 * 1024), mimeType: "image/png", type: "image" },
						]
					: `CONTEXT_INPUT_HISTORY_${String(index)}`,
			role: "user",
			timestamp: timestamp + index * 2,
		} satisfies UserMessage);
		manager.appendMessage({
			api: "openai-completions",
			content: [
				{
					text: index === 499 ? "CONTEXT_SEARCH_AGAIN_DONE" : `CONTEXT_INPUT_HISTORY_DONE_${String(index)}`,
					type: "text",
				},
			],
			model: "fixture-model",
			provider: "pi-stuff-context-pty",
			role: "assistant",
			stopReason: "stop",
			timestamp: timestamp + index * 2 + 1,
			usage: ZERO_USAGE,
		} satisfies AssistantMessage);
	}
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) fail("target Session was not persisted");
	return sessionFile;
}

function isValidRetryRequestBody(request: string | undefined): boolean {
	return Boolean(
		request?.includes(HISTORY_MARKER) &&
			request.includes("session-history-since") &&
			request.includes("Magic Context") &&
			Buffer.byteLength(request, "utf8") <= Math.floor(Number(PROVIDER_CONTEXT_WINDOW) * 0.95),
	);
}

function requestBodyDiagnostic(requestBodies: readonly string[]): string {
	return JSON.stringify(
		requestBodies.map((body) => ({
			bytes: Buffer.byteLength(body, "utf8"),
			hasHistoryMarker: body.includes(HISTORY_MARKER),
			hasMagicContext: body.includes("Magic Context"),
			hasSessionHistorySince: body.includes("session-history-since"),
		})),
	);
}

async function verifySubmittedPromptFrame(capture: () => string, submit: () => void, prompt: string): Promise<void> {
	const captureOverheads = Array.from({ length: 5 }, () => {
		const startedAt = performance.now();
		capture();
		return performance.now() - startedAt;
	}).sort((left, right) => left - right);
	const captureOverheadMs = captureOverheads[Math.floor(captureOverheads.length / 2)] ?? 0;
	const submittedAt = performance.now();
	submit();
	const workingFrames = new Set<string>();
	const workingDeadline = Date.now() + 2_000;
	let workingFrame: string | undefined;
	let workingFrameChangedAt: number | undefined;
	let transcriptVisibleMs: number | undefined;
	while (Date.now() < workingDeadline) {
		const frame = capture();
		if (transcriptVisibleMs === undefined && transcriptContainsUserMessage(frame, prompt)) {
			transcriptVisibleMs = Math.max(0, performance.now() - submittedAt - captureOverheadMs);
		}
		const indicator = /([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])\s+Working/u.exec(frame)?.[1];
		const observedAt = performance.now();
		if (indicator) {
			workingFrames.add(indicator);
			if (indicator !== workingFrame) {
				workingFrame = indicator;
				workingFrameChangedAt = observedAt;
			}
			if (workingFrameChangedAt !== undefined && observedAt - workingFrameChangedAt > WORKING_STALL_LIMIT_MS) {
				fail(
					`Vibe Line Working animation stalled for more than ${String(WORKING_STALL_LIMIT_MS)}ms: ${JSON.stringify([...workingFrames])}`,
				);
			}
		} else {
			workingFrame = undefined;
			workingFrameChangedAt = undefined;
		}
		await Bun.sleep(50);
	}
	if (transcriptVisibleMs === undefined) {
		fail("the submitted prompt did not appear in the Conversation Transcript during the 2s observation window");
	}
	if (transcriptVisibleMs > INPUT_FRAME_LATENCY_LIMIT_MS) {
		fail(`submitted prompt took ${transcriptVisibleMs.toFixed(1)}ms to appear in the Conversation Transcript`);
	}
	if (workingFrames.size < 2) {
		fail(`Vibe Line Working animation did not advance: ${JSON.stringify([...workingFrames])}`);
	}
}

async function verifySubmittedFrame(environment: PtyEnvironment, cwd: string, requestBodies: string[]): Promise<void> {
	const socket = join(environment["HOME"] ?? cwd, "context-input-frame-tmux.sock");
	const terminalOutputPath = join(environment["HOME"] ?? cwd, "context-input-frame-terminal.log");
	const terminalOutputDonePath = `${terminalOutputPath}.done`;
	const session = `context-input-frame-${String(process.pid)}`;
	const tmux = (args: readonly string[]): string => runCommand(["tmux", "-S", socket, ...args]);
	const sessionExists = (): boolean =>
		Bun.spawnSync(["tmux", "-S", socket, "has-session", "-t", session], {
			stderr: "ignore",
			stdout: "ignore",
		}).exitCode === 0;
	const capture = (history = false): string =>
		tmux(["capture-pane", "-p", "-N", ...(history ? ["-S", "-"] : []), "-t", session]);
	const waitFor = async (
		predicate: (frame: string) => boolean,
		label: string,
		timeoutMs = 20_000,
		history = true,
	): Promise<string> => {
		const deadline = Date.now() + timeoutMs;
		let frame = "";
		while (Date.now() < deadline) {
			frame = capture(history);
			if (predicate(frame)) return frame;
			await Bun.sleep(10);
		}
		fail(`timed out waiting for ${label}\nCurrent frame:\n${frame}`);
	};
	const send = (text: string): void => {
		tmux(["send-keys", "-t", session, "-l", "--", text]);
		tmux(["send-keys", "-t", session, "Enter"]);
	};

	runCommand(["tmux", "-V"]);
	try {
		runCommand(
			[
				"tmux",
				"-S",
				socket,
				"-f",
				"/dev/null",
				"new-session",
				"-d",
				"-s",
				session,
				"-x",
				environment["PI_STUFF_CONTEXT_PTY_COLUMNS"] ?? "64",
				"-y",
				environment["PI_STUFF_CONTEXT_PTY_ROWS"] ?? "28",
				"-c",
				cwd,
				environment["PI_STUFF_CONTEXT_PTY_RUNNER"] ?? runner,
				";",
				"set-option",
				"-t",
				session,
				"remain-on-exit",
				"on",
			],
			environment,
		);
		await waitFor((frame) => frame.includes("CONTEXT_SEARCH_AGAIN_DONE"), "resumed editor readiness", 40_000);
		await writeFile(terminalOutputPath, "");
		tmux([
			"pipe-pane",
			"-t",
			session,
			`cat >> ${shellQuote(terminalOutputPath)}; touch ${shellQuote(terminalOutputDonePath)}`,
		]);

		const prompt = CONTEXT_RESUME_REQUEST;
		tmux(["send-keys", "-t", session, "-l", "--", prompt]);
		await waitFor((frame) => editorContains(frame, prompt), "the typed resumed prompt");
		await verifySubmittedPromptFrame(capture, () => tmux(["send-keys", "-t", session, "Enter"]), prompt);

		await waitFor((frame) => frame.includes(CONTEXT_RESUME_DONE), "resumed Context response", 40_000);
		const modelRequests = requestBodies.filter((body) => body.includes(prompt));
		const [firstRequest, secondRequest] = modelRequests;
		if (
			modelRequests.length !== 2 ||
			!isValidRetryRequestBody(firstRequest) ||
			!isValidRetryRequestBody(secondRequest) ||
			firstRequest !== secondRequest
		) {
			send("/ctx status");
			await Bun.sleep(100);
			tmux(["send-keys", "-t", session, "Enter"]);
			await Bun.sleep(500);
			const magicLogPath = environment["MAGIC_CONTEXT_LOG_PATH"];
			const magicLog = magicLogPath
				? await readFile(magicLogPath, "utf8").catch(() => "<Magic Context log unavailable>")
				: "<Magic Context log path unavailable>";
			fail(
				`input-frame retry did not produce exactly two stable bounded HTTP requests: ${requestBodyDiagnostic(modelRequests)}\n${capture(true)}\nMagic Context log:\n${magicLog.slice(-20_000)}`,
			);
		}

		send("CONTEXT_DRAIN");
		await waitFor((frame) => frame.includes("CONTEXT_DRAIN_DONE"), "Context marker drain");
		tmux(["pipe-pane", "-t", session]);
		const pipeDeadline = Date.now() + 5_000;
		while (!(await exists(terminalOutputDonePath)) && Date.now() < pipeDeadline) await Bun.sleep(5);
		if (!(await exists(terminalOutputDonePath))) fail("timed out waiting for the raw terminal capture to close");
		const terminalOutput = await readFile(terminalOutputPath, "utf8");
		if (terminalOutput.includes("\u001b[2J") || terminalOutput.includes("\u001b[3J")) {
			fail("ordinary input submission cleared the terminal instead of committing a differential frame");
		}
		tmux(["set-option", "-t", session, "remain-on-exit", "off"]);
		tmux(["send-keys", "-t", session, "C-c"]);
		await Bun.sleep(150);
		tmux(["send-keys", "-t", session, "C-d"]);
		const exitDeadline = Date.now() + 5_000;
		while (sessionExists() && Date.now() < exitDeadline) await Bun.sleep(10);
		if (sessionExists()) fail("resumed Pi did not exit");
	} finally {
		Bun.spawnSync(["tmux", "-S", socket, "kill-server"], { stderr: "ignore", stdout: "ignore" });
	}
}

export async function verifyContextInputFramePty(options: ContextInputFramePtyVerificationOptions): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-context-input-frame-"));
	const configDirectory = join(temporaryDirectory, "agent");
	const xdgConfigDirectory = join(temporaryDirectory, "config");
	const cortexConfigDirectory = join(xdgConfigDirectory, "cortexkit");
	const dataDirectory = join(temporaryDirectory, "data");
	const cacheDirectory = join(temporaryDirectory, "cache");
	const projectDirectory = join(temporaryDirectory, "项目隔离", "context-input-frame");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	const magicLog = join(temporaryDirectory, "magic-context.log");
	const requestBodies: string[] = [];
	const server = createBuiltinOpenAiServer(requestBodies);
	try {
		await Promise.all(
			[
				configDirectory,
				cortexConfigDirectory,
				dataDirectory,
				cacheDirectory,
				projectDirectory,
				sessionDirectory,
			].map((path) => mkdir(path, { recursive: true })),
		);
		await disableSessionNamingForTest(configDirectory);
		await Promise.all([
			writeFile(requestLog, ""),
			writeFile(
				join(configDirectory, "settings.json"),
				`${JSON.stringify({ defaultProjectTrust: "always", quietStartup: true, tuiMode: "fullscreen", retry: { enabled: true, maxRetries: 1, baseDelayMs: 0, provider: { maxRetries: 0 } } })}\n`,
			),
			writeFile(
				join(cortexConfigDirectory, "magic-context.jsonc"),
				`${JSON.stringify({
					dreamer: { disable: true },
					embedding: { provider: "off" },
					fail_closed_blocking: false,
					historian: {
						opencode: { model: "pi-stuff-context-pty/fixture-model" },
						pi: { model: "pi-stuff-context-pty/fixture-model", thinking_level: "off" },
					},
					historian_timeout_ms: 30_000,
					pi: { subagent_extensions: [providerExtension] },
					sidekick: { disable: true },
					toast_duration_ms: 0,
					todowrite: { enabled: false, overlay: false },
				})}\n`,
			),
		]);
		const sessionFile = seedSession(sessionDirectory, projectDirectory);
		const columns = options.columns ?? 64;
		const rows = options.rows ?? 28;
		await verifySubmittedFrame(
			{
				...process.env,
				HF_HOME: cacheDirectory,
				HF_HUB_OFFLINE: "1",
				HOME: temporaryDirectory,
				MAGIC_CONTEXT_LOG_PATH: magicLog,
				MAGIC_CONTEXT_TEST_DATA_DIR: dataDirectory,
				PI_STUFF_CONTEXT_PTY_BUILTIN_OPENAI: "1",
				PI_STUFF_CONTEXT_PTY_BASE_URL: `http://127.0.0.1:${String(server.port)}`,
				PI_STUFF_CONTEXT_PTY_MODEL: "fixture-model",
				PI_STUFF_CONTEXT_PTY_CONTEXT_WINDOW: PROVIDER_CONTEXT_WINDOW,
				PI_CODING_AGENT_DIR: configDirectory,
				PI_OFFLINE: "1",
				PI_STUFF_CONTEXT_PTY_BIN: options.piBinary,
				PI_STUFF_CONTEXT_PTY_COLUMNS: String(columns),
				PI_STUFF_CONTEXT_PTY_LOG: requestLog,
				PI_STUFF_CONTEXT_PTY_PACKAGE: resolve(options.packagePath),
				PI_STUFF_CONTEXT_PTY_PROVIDER_EXTENSION: providerExtension,
				PI_STUFF_CONTEXT_PTY_RESUME_SESSION: sessionFile,
				PI_STUFF_CONTEXT_PTY_ROWS: String(rows),
				PI_STUFF_CONTEXT_PTY_RUNNER: runner,
				PI_STUFF_CONTEXT_PTY_SESSIONS: sessionDirectory,
				PI_STUFF_CONTEXT_PTY_SESSION_ID: `context-input-frame-${String(columns)}x${String(rows)}`,
				PI_TELEMETRY: "0",
				SHELL: "/bin/sh",
				TERM: "xterm-256color",
				TRANSFORMERS_OFFLINE: "1",
				XDG_CACHE_HOME: cacheDirectory,
				XDG_CONFIG_HOME: xdgConfigDirectory,
				XDG_DATA_HOME: undefined,
			},
			projectDirectory,
			requestBodies,
		);
	} finally {
		server.stop(true);
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}
