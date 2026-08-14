import { Database } from "bun:sqlite";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/context-pty-provider.ts");
const runner = join(root, "test/fixtures/context-pty-runner.sh");
const MEMORY_EVIDENCE = "真实 Context 检索证据";

export interface ContextPtyVerificationOptions {
	readonly piBinary: string;
	readonly packagePath: string;
	readonly columns?: number;
	readonly rows?: number;
}

interface RecordLine {
	readonly type?: unknown;
	readonly cwd?: unknown;
	readonly sessionId?: unknown;
	readonly lastUser?: unknown;
	readonly hasContextActivityText?: unknown;
	readonly hasHistory?: unknown;
	readonly hasSince?: unknown;
	readonly hasNativeSummary?: unknown;
	readonly systemPromptChars?: unknown;
	readonly hasCompactMagicContextPrompt?: unknown;
	readonly hasVerboseMagicContextPrompt?: unknown;
	readonly commands?: unknown;
	readonly tools?: unknown;
	readonly searchResult?: unknown;
	readonly subagent?: unknown;
}

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface SessionLine {
	readonly customType?: unknown;
	readonly data?: unknown;
	readonly type?: unknown;
	readonly message?: unknown;
	readonly details?: unknown;
}

function fail(message: string): never {
	throw new Error(`Context PTY verification failed: ${message}`);
}

function expectProgram(): string {
	return `
set timeout 60

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout { puts stderr "Timed out waiting for: $pattern"; exit 2 }
        eof { puts stderr "Reached EOF waiting for: $pattern"; exit 3 }
    }
}

proc must_log {pattern} {
    global env
    for {set attempt 0} {$attempt < 200} {incr attempt} {
        if {[file exists $env(PI_STUFF_CONTEXT_PTY_LOG)]} {
            set handle [open $env(PI_STUFF_CONTEXT_PTY_LOG) r]
            set contents [read $handle]
            close $handle
            foreach line [split $contents "\n"] {
                if {[string first {"type":"request"} $line] >= 0 && [string first $pattern $line] >= 0} { return }
            }
        }
        after 25
    }
    puts stderr "Timed out waiting for provider request: $pattern"
    puts stderr "Provider log: $contents"
    exit 6
}

spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
must_expect "CONTEXT_FIRST_DONE"
send -- "/ctx "
must_expect "Open Context status"
send -- [binary format c 27]
after 100
send -- [binary format c 21]
after 100
send -- "/ctx\r"
must_expect "Wrap up history"
must_expect "Flush pending drops"
send -- "\r"
must_expect "Keep 20 recent messages"
send -- [binary format c 27]
must_expect "Rebuild compartments"
send -- [binary format c 27]
after 100
send -- "CONTEXT_DIALOG_FOCUS"
must_expect "CONTEXT_DIALOG_FOCUS"
send -- [binary format c 21]
send -- "/ctx\r"
must_expect "Wrap up history"
send -- [binary format c* {27 91 66}]
send -- "\r"
must_expect "Context flush"
must_expect "nothing queued"
send -- "CONTEXT_SECOND\r"
must_log "CONTEXT_SECOND"
must_expect "CONTEXT_SECOND_DONE"
send -- "CONTEXT_MEMORY\r"
must_expect "CONTEXT_MEMORY_DONE"
send -- "CONTEXT_SEARCH\r"
must_expect "CONTEXT_SEARCH_DONE"
send -- "CONTEXT_BULK\r"
must_expect "CONTEXT_BULK_DONE"
send -- "/compact\r"
after 600
send -- "CONTEXT_AFTER_COMPACT\r"
must_expect "CONTEXT_AFTER_COMPACT_DONE"
set historian_ready 0
for {set attempt 0} {$attempt < 120} {incr attempt} {
    if {[file exists $env(PI_STUFF_CONTEXT_PTY_HISTORIAN_MARKER)]} {
        set historian_ready 1
        break
    }
    after 250
}
if {!$historian_ready} { puts stderr "Historian provider was never reached"; exit 5 }
after 500
send -- "CONTEXT_SETTLE\r"
must_expect "CONTEXT_SETTLE_DONE"
send -- "CONTEXT_SEARCH_AGAIN\r"
must_expect "CONTEXT_SEARCH_AGAIN_DONE"
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Pi did not exit"; exit 4 } }
`;
}

function startupOnlyProgram(): string {
	return `
set timeout 30
spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
set session_ready 0
for {set attempt 0} {$attempt < 120} {incr attempt} {
    if {[file exists $env(PI_STUFF_CONTEXT_PTY_LOG)]} {
        set handle [open $env(PI_STUFF_CONTEXT_PTY_LOG) r]
        set contents [read $handle]
        close $handle
        if {[string first {"type":"session"} $contents] >= 0} { set session_ready 1; break }
    }
    after 250
}
if {!$session_ready} { puts stderr "Timed out waiting for startup session event"; exit 2 }
send -- "/context-startup-ready\\r"
expect {
    -exact "CONTEXT_STARTUP_READY" {}
    timeout { puts stderr "Timed out waiting for post-session_start readiness"; exit 5 }
    eof { puts stderr "Startup-only Pi exited before the readiness command"; exit 6 }
}
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Startup-only Pi did not exit"; exit 4 } }
`;
}

function automaticActivationProgram(): string {
	return `
set timeout 30
spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
expect {
    -exact "CONTEXT_FIRST_DONE" {}
    timeout { puts stderr "Timed out waiting for automatic Context turn"; exit 2 }
    eof { puts stderr "Automatic Context Pi exited early"; exit 3 }
}
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Automatic Context Pi did not exit"; exit 4 } }
`;
}

function directActivationProgram(): string {
	return `
set timeout 30
spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
expect {
    -exact "CONTEXT_FIRST_DONE" {}
    timeout { puts stderr "Timed out waiting for direct Context turn"; exit 2 }
    eof { puts stderr "Direct Context Pi exited early"; exit 3 }
}
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Direct Context Pi did not exit"; exit 4 } }
`;
}

function resumeProgram(): string {
	return `
set timeout 40

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout { puts stderr "Timed out waiting for: $pattern"; exit 2 }
        eof { puts stderr "Reached EOF waiting for: $pattern"; exit 3 }
    }
}

spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
must_expect "CONTEXT_SEARCH_AGAIN_DONE"
after 100
send -- "CONTEXT_RESUME\r"
expect {
    -exact "CONTEXT_RESUME_DONE" {}
    timeout { puts stderr "Timed out waiting for resumed context"; exit 2 }
    eof { puts stderr "Resumed Pi exited early"; exit 3 }
}
send -- "CONTEXT_DRAIN\r"
expect {
    -exact "CONTEXT_DRAIN_DONE" {}
    timeout { puts stderr "Timed out waiting for Context marker drain"; exit 6 }
    eof { puts stderr "Resumed Pi exited before Context marker drain"; exit 7 }
}
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Resumed Pi did not exit"; exit 4 } }
`;
}

function failOpenProgram(): string {
	return `
set timeout 30
spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
expect {
    -exact "CONTEXT_FAIL_OPEN_DONE" {}
    timeout { puts stderr "Timed out waiting for native fail-open response"; exit 2 }
    eof { puts stderr "Fail-open Pi exited early"; exit 3 }
}
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Fail-open Pi did not exit"; exit 4 } }
`;
}

function isolationProgram(): string {
	return `
set timeout 30
spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
expect {
    -exact "CONTEXT_ISOLATION_DONE" {}
    timeout { puts stderr "Timed out waiting for isolated Context search"; exit 2 }
    eof { puts stderr "Isolated Context Pi exited early"; exit 3 }
}
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Isolated Context Pi did not exit"; exit 4 } }
`;
}

function nativeCompactionProgram(): string {
	return `
set timeout 30

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout { puts stderr "Timed out waiting for: $pattern"; exit 2 }
        eof { puts stderr "Reached EOF waiting for: $pattern"; exit 3 }
    }
}

spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
must_expect "NATIVE_TAIL_DONE"
send -- "CONTEXT_NATIVE_RESUME\r"
must_expect "CONTEXT_NATIVE_RESUME_DONE"
send -- "\\003"
after 150
send -- "\\004"
expect { eof {} timeout { puts stderr "Native-compacted Context Pi did not exit"; exit 4 } }
`;
}

function runExpect(
	program: string,
	environment: Record<string, string | undefined>,
	label: string,
	cwd: string = root,
): string {
	const driver = `
set evaluation [catch {eval $env(PI_STUFF_CONTEXT_EXPECT_PROGRAM)} message options]
if {$evaluation != 0} {
    puts stderr $message
    if {[dict exists $options -errorinfo]} { puts stderr [dict get $options -errorinfo] }
    exit 1
}
set waited [catch {wait} child]
if {!$waited && [llength $child] >= 4} {
    set child_status [lindex $child 3]
    if {$child_status != 0} { exit $child_status }
}
`;
	const result = Bun.spawnSync(["expect", "-c", driver], {
		cwd,
		env: { ...environment, PI_STUFF_CONTEXT_EXPECT_PROGRAM: program },
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
	if (result.exitCode !== 0) {
		const diagnostic = output.length > 20_000 ? `[earlier PTY output omitted]\n${output.slice(-20_000)}` : output;
		fail(`${label}: ${diagnostic.trim() || `expect exited ${String(result.exitCode)}`}`);
	}
	return output;
}

function seedNativeCompactedSession(sessionDirectory: string, cwd: string): string {
	const manager = SessionManager.create(cwd, sessionDirectory, { id: "context-native-compacted" });
	manager.appendModelChange("pi-stuff-context-pty", "fixture-model");
	const oldUser: UserMessage = {
		role: "user",
		content: "NATIVE_OLD_HISTORY",
		timestamp: Date.now(),
	};
	const oldAssistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "NATIVE_OLD_DONE" }],
		api: "openai-completions",
		provider: "pi-stuff-context-pty",
		model: "fixture-model",
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: Date.now(),
	};
	manager.appendMessage(oldUser);
	manager.appendMessage(oldAssistant);
	const firstKeptEntryId = manager.appendMessage({
		role: "user",
		content: "NATIVE_TAIL_HISTORY",
		timestamp: Date.now(),
	} satisfies UserMessage);
	manager.appendMessage({
		...oldAssistant,
		content: [{ type: "text", text: "NATIVE_TAIL_DONE" }],
		timestamp: Date.now(),
	});
	manager.appendCompaction("NATIVE_COMPACTION_SUMMARY_MARKER", firstKeptEntryId, 50_000, {
		modifiedFiles: [],
		readFiles: [],
	});
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) fail("native-compacted target session was not persisted");
	return sessionFile;
}

async function readRecords(path: string): Promise<RecordLine[]> {
	const value = await readFile(path, "utf8");
	return value
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as RecordLine);
}

function sessionText(lines: readonly SessionLine[]): string {
	return lines
		.filter((line) => line.type === "message")
		.map((line) => JSON.stringify(line.message))
		.join("\n");
}

export async function verifyContextPty(options: ContextPtyVerificationOptions): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-context-pty-"));
	const configDirectory = join(temporaryDirectory, "agent");
	const xdgConfigDirectory = join(temporaryDirectory, "config");
	const cortexConfigDirectory = join(xdgConfigDirectory, "cortexkit");
	const dataDirectory = join(temporaryDirectory, "data");
	const startupDataDirectory = join(temporaryDirectory, "startup-only-data");
	const cacheDirectory = join(temporaryDirectory, "cache");
	const projectDirectory = join(temporaryDirectory, "项目隔离", "context");
	const isolatedProjectDirectory = join(temporaryDirectory, "项目隔离", "other-context");
	const nativeCompactedProjectDirectory = join(temporaryDirectory, "项目隔离", "native-compacted");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const startupSessionDirectory = join(temporaryDirectory, "startup-only-sessions");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	const startupLog = join(temporaryDirectory, "startup-only-requests.jsonl");
	const activationHome = join(temporaryDirectory, "activation-home");
	const activationAgentDirectory = join(temporaryDirectory, "activation-agent");
	const activationConfigDirectory = join(temporaryDirectory, "activation-config");
	const activationDataDirectory = join(temporaryDirectory, "activation-data");
	const activationCacheDirectory = join(temporaryDirectory, "activation-cache");
	const activationProjectDirectory = join(temporaryDirectory, "activation-project");
	const activationSessionDirectory = join(temporaryDirectory, "activation-sessions");
	const directActivationSessionDirectory = join(temporaryDirectory, "direct-activation-sessions");
	const activationLog = join(temporaryDirectory, "activation-requests.jsonl");
	const directActivationLog = join(temporaryDirectory, "direct-activation-requests.jsonl");
	const activationMagicLog = join(temporaryDirectory, "activation-magic-context.log");
	const activationLegacyDirectory = join(activationHome, ".pi", "agent");
	const activationLegacyConfig = join(activationLegacyDirectory, "magic-context.jsonc");
	const activationCanonicalConfig = join(activationConfigDirectory, "cortexkit", "magic-context.jsonc");
	const activationDatabase = join(activationDataDirectory, "cortexkit", "magic-context", "context.db");
	const magicLog = join(temporaryDirectory, "magic-context.log");
	const historianMarker = join(temporaryDirectory, "historian-ready");
	const databasePath = join(dataDirectory, "cortexkit", "magic-context", "context.db");
	const startupDatabasePath = join(startupDataDirectory, "cortexkit", "magic-context", "context.db");
	const columns = options.columns ?? 64;
	const rows = options.rows ?? 28;
	await Promise.all(
		[
			configDirectory,
			cortexConfigDirectory,
			dataDirectory,
			startupDataDirectory,
			cacheDirectory,
			projectDirectory,
			isolatedProjectDirectory,
			nativeCompactedProjectDirectory,
			sessionDirectory,
			startupSessionDirectory,
			activationHome,
			activationAgentDirectory,
			activationConfigDirectory,
			activationDataDirectory,
			activationCacheDirectory,
			activationProjectDirectory,
			activationSessionDirectory,
			directActivationSessionDirectory,
			activationLegacyDirectory,
		].map((path) => mkdir(path, { recursive: true })),
	);
	const activationConfig = `${JSON.stringify({
		dreamer: { disable: true },
		embedding: { provider: "off" },
		fail_closed_blocking: false,
		historian: { model: "pi-stuff-context-pty/fixture-model", thinking_level: "off" },
		pi: { subagent_extensions: [providerExtension] },
		sidekick: { disable: true },
		toast_duration_ms: 0,
		todowrite: { enabled: false, overlay: false },
	})}\n`;
	await Promise.all([
		writeFile(requestLog, ""),
		writeFile(startupLog, ""),
		writeFile(activationLog, ""),
		writeFile(directActivationLog, ""),
		writeFile(activationLegacyConfig, activationConfig),
		writeFile(
			join(activationAgentDirectory, "settings.json"),
			`${JSON.stringify({ defaultProjectTrust: "always", quietStartup: true, tuiMode: "fullscreen" })}\n`,
		),
		writeFile(
			join(configDirectory, "settings.json"),
			`${JSON.stringify({ defaultProjectTrust: "always", quietStartup: true, tuiMode: "fullscreen" })}\n`,
		),
		writeFile(
			join(cortexConfigDirectory, "magic-context.jsonc"),
			`${JSON.stringify({
				dreamer: { disable: true },
				embedding: { provider: "off" },
				fail_closed_blocking: false,
				historian: {
					model: "pi-stuff-context-pty/fixture-model",
					thinking_level: "off",
				},
				historian_timeout_ms: 30_000,
				pi: { subagent_extensions: [providerExtension] },
				sidekick: { disable: true },
				toast_duration_ms: 0,
				todowrite: { enabled: false, overlay: false },
			})}\n`,
		),
	]);

	try {
		const baseEnvironment = {
			...process.env,
			HOME: temporaryDirectory,
			HF_HOME: cacheDirectory,
			HF_HUB_OFFLINE: "1",
			MAGIC_CONTEXT_LOG_PATH: magicLog,
			PI_STUFF_CONTEXT_PTY_HISTORIAN_MARKER: historianMarker,
			PI_CODING_AGENT_DIR: configDirectory,
			PI_OFFLINE: "1",
			PI_STUFF_CONTEXT_PTY_BIN: options.piBinary,
			PI_STUFF_CONTEXT_PTY_COLUMNS: String(columns),
			PI_STUFF_CONTEXT_PTY_LOG: requestLog,
			PI_STUFF_CONTEXT_PTY_PACKAGE: resolve(options.packagePath),
			PI_STUFF_CONTEXT_PTY_PROVIDER_EXTENSION: providerExtension,
			PI_STUFF_CONTEXT_PTY_ROWS: String(rows),
			PI_STUFF_CONTEXT_PTY_RUNNER: runner,
			PI_STUFF_CONTEXT_PTY_SESSIONS: sessionDirectory,
			PI_STUFF_CONTEXT_PTY_SESSION_ID: `context-pty-${String(columns)}x${String(rows)}`,
			PI_TELEMETRY: "0",
			SHELL: "/bin/sh",
			TERM: "xterm-256color",
			TRANSFORMERS_OFFLINE: "1",
			XDG_CACHE_HOME: cacheDirectory,
			XDG_CONFIG_HOME: xdgConfigDirectory,
			XDG_DATA_HOME: dataDirectory,
		};
		const activationEnvironment = {
			...baseEnvironment,
			HOME: activationHome,
			MAGIC_CONTEXT_LOG_PATH: activationMagicLog,
			PI_CODING_AGENT_DIR: activationAgentDirectory,
			PI_STUFF_CONTEXT_PTY_AUTOMATIC_ONLY: "1",
			PI_STUFF_CONTEXT_PTY_INITIAL_PROMPT: undefined,
			PI_STUFF_CONTEXT_PTY_LOG: activationLog,
			PI_STUFF_CONTEXT_PTY_SESSIONS: activationSessionDirectory,
			PI_STUFF_CONTEXT_PTY_SESSION_ID: "context-automatic-activation",
			PI_STUFF_CONTEXT_PTY_STARTUP_ONLY: "1",
			XDG_CACHE_HOME: activationCacheDirectory,
			XDG_CONFIG_HOME: activationConfigDirectory,
			XDG_DATA_HOME: activationDataDirectory,
		};
		const legacyEntriesBefore = await readdir(activationLegacyDirectory);
		const legacyContentBefore = await readFile(activationLegacyConfig, "utf8");
		const automaticOutput = runExpect(
			automaticActivationProgram(),
			activationEnvironment,
			"automatic activation purity",
			activationProjectDirectory,
		);
		if (!automaticOutput.includes("CONTEXT_FIRST_DONE")) fail("automatic fixture turn did not reach the model");
		if (
			await access(activationCanonicalConfig).then(
				() => true,
				() => false,
			)
		) {
			fail("automatic Extension turn migrated the legacy Magic Context config");
		}
		if (
			await access(activationDatabase).then(
				() => true,
				() => false,
			)
		) {
			fail("deferred automatic Extension turn created Magic Context derived state");
		}
		if (JSON.stringify(await readdir(activationLegacyDirectory)) !== JSON.stringify(legacyEntriesBefore)) {
			fail("automatic Extension turn changed the legacy Magic Context config directory");
		}
		if ((await readFile(activationLegacyConfig, "utf8")) !== legacyContentBefore) {
			fail("automatic Extension turn changed the legacy Magic Context config contents");
		}
		const automaticRequests = (await readRecords(activationLog)).filter((record) => record.type === "request");
		if (automaticRequests.length !== 1 || automaticRequests[0]?.hasCompactMagicContextPrompt !== false) {
			fail("deferred automatic Extension turn did not use the native Context path");
		}

		runExpect(
			directActivationProgram(),
			{
				...activationEnvironment,
				PI_STUFF_CONTEXT_PTY_AUTOMATIC_ONLY: undefined,
				PI_STUFF_CONTEXT_PTY_INITIAL_PROMPT: "CONTEXT_DIRECT",
				PI_STUFF_CONTEXT_PTY_LOG: directActivationLog,
				PI_STUFF_CONTEXT_PTY_SESSIONS: directActivationSessionDirectory,
				PI_STUFF_CONTEXT_PTY_SESSION_ID: "context-direct-activation",
				PI_STUFF_CONTEXT_PTY_STARTUP_ONLY: undefined,
			},
			"direct activation migration",
			activationProjectDirectory,
		);
		if ((await readFile(activationCanonicalConfig, "utf8")) !== legacyContentBefore) {
			fail("direct activation did not migrate the exact legacy Magic Context config");
		}
		if (
			await access(activationLegacyConfig).then(
				() => true,
				() => false,
			)
		) {
			fail("direct activation left the migrated legacy Magic Context config active");
		}
		if (
			!(await access(`${activationLegacyConfig}.MOVED_READPLEASE`).then(
				() => true,
				() => false,
			))
		) {
			fail("direct activation did not preserve the migrated legacy config marker");
		}
		const directActivationRequests = (await readRecords(directActivationLog)).filter(
			(record) => record.type === "request",
		);
		if (directActivationRequests.length !== 1 || directActivationRequests[0]?.hasCompactMagicContextPrompt !== true) {
			fail("direct input did not activate the official Magic Context package");
		}
		const startupConfigPath = join(cortexConfigDirectory, "magic-context.jsonc");
		const startupConfigBefore = await readFile(startupConfigPath, "utf8");
		runExpect(
			startupOnlyProgram(),
			{
				...baseEnvironment,
				PI_STUFF_CONTEXT_PTY_LOG: startupLog,
				PI_STUFF_CONTEXT_PTY_SESSIONS: startupSessionDirectory,
				PI_STUFF_CONTEXT_PTY_SESSION_ID: "context-startup-only",
				PI_STUFF_CONTEXT_PTY_STARTUP_ONLY: "1",
				XDG_DATA_HOME: startupDataDirectory,
			},
			"startup readiness",
			projectDirectory,
		);
		const databaseCreatedAtStartup = await access(startupDatabasePath).then(
			() => true,
			() => false,
		);
		if (!databaseCreatedAtStartup) fail("session_start did not finish Magic Context derived-state initialization");
		if ((await readFile(startupConfigPath, "utf8")) !== startupConfigBefore) {
			fail("startup activation mutated the recognized canonical Magic Context config");
		}
		if ((await readRecords(startupLog)).some((record) => record.type === "request")) {
			fail("startup activation unexpectedly reached the model");
		}
		const freshOutput = runExpect(expectProgram(), baseEnvironment, "fresh session", projectDirectory);
		for (const forbidden of ["Magic Context", "Magic Status", "ctx-aug", "ctx-doctor", "mc:"]) {
			if (freshOutput.includes(forbidden)) fail(`fresh TUI exposed forbidden UI text ${forbidden}`);
		}

		const sessionFiles = (await readdir(sessionDirectory))
			.filter((entry) => entry.endsWith(".jsonl"))
			.map((entry) => join(sessionDirectory, entry));
		if (sessionFiles.length !== 1) fail(`expected one durable session, received ${String(sessionFiles.length)}`);
		const sessionFile = sessionFiles[0] as string;
		const rawLines = (await readFile(sessionFile, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as SessionLine);
		const persisted = sessionText(rawLines);
		const contextActivities = rawLines.filter(
			(line) => line.type === "custom" && line.customType === "pi-stuff-context-activity",
		);
		if (contextActivities.length < 2) {
			fail(`Context command activity was not durably recorded: ${JSON.stringify(contextActivities)}`);
		}
		const activitySummaries = contextActivities.map((line) =>
			typeof line.data === "object" && line.data !== null ? Reflect.get(line.data, "summary") : undefined,
		);
		if (!activitySummaries.includes("applying queued drops") || !activitySummaries.includes("nothing queued")) {
			fail(`Context command activity lost its anchor or result: ${JSON.stringify(activitySummaries)}`);
		}
		for (const required of [
			"CONTEXT_FIRST",
			"CONTEXT_SECOND",
			"CONTEXT_MEMORY",
			"CONTEXT_SEARCH",
			"CONTEXT_BULK",
			"CONTEXT_AFTER_COMPACT",
			"CONTEXT_SETTLE",
			"CONTEXT_SEARCH_AGAIN",
		]) {
			if (!persisted.includes(required)) {
				const recentRequests = (await readRecords(requestLog))
					.filter((record) => record.type === "request")
					.slice(-12)
					.map((record) => record.lastUser);
				fail(
					`raw Pi transcript lost ${required}; recent lastUser=${JSON.stringify(recentRequests)}; session tail=${JSON.stringify(rawLines.slice(-20))}`,
				);
			}
		}
		for (const forbidden of ["<session-history>", "<session-history-since>"]) {
			if (persisted.includes(forbidden)) fail(`derived Magic projection leaked into Pi JSONL: ${forbidden}`);
		}
		const pressureDatabase = new Database(databasePath, { readonly: true });
		try {
			const historianSuccess = pressureDatabase
				.query("SELECT COUNT(*) AS count FROM historian_runs WHERE session_id = ? AND status = 'success'")
				.get(`context-pty-${String(columns)}x${String(rows)}`) as { readonly count?: unknown } | null;
			if (!historianSuccess || Number(historianSuccess.count) < 1) {
				fail("high-pressure turn did not complete a successful Magic Context historian run");
			}
		} finally {
			pressureDatabase.close();
		}
		const freshNativeCompactions = rawLines.filter(
			(line) =>
				line.type === "compaction" &&
				(typeof line.details !== "object" ||
					line.details === null ||
					(line.details as { readonly source?: unknown }).source !== "magic-context"),
		);
		if (freshNativeCompactions.length > 0) {
			fail("fresh session appended a Pi-native compaction even though Magic Context owns the transformed view");
		}

		let resumeOutput: string;
		try {
			resumeOutput = runExpect(
				resumeProgram(),
				{ ...baseEnvironment, PI_STUFF_CONTEXT_PTY_RESUME_SESSION: sessionFile },
				"resume",
				projectDirectory,
			);
		} catch (error) {
			const diagnosticRecords = (await readFile(requestLog, "utf8").catch(() => "<request log unavailable>"))
				.split("\n")
				.filter(Boolean)
				.slice(-30)
				.join("\n");
			const diagnosticMagicLog = (await readFile(magicLog, "utf8").catch(() => "<Magic Context log unavailable>"))
				.split("\n")
				.filter((line) => /historian|subagent|compartment|error|failed/i.test(line))
				.slice(-120)
				.map((line) => (line.length > 1_000 ? `${line.slice(0, 1_000)}…` : line))
				.join("\n");
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\nContext request records:\n${diagnosticRecords}\nMagic Context log:\n${diagnosticMagicLog}`,
			);
		}
		if (!resumeOutput.includes("Searched 1 history query")) {
			fail("resumed ctx_search history did not retain the Tool Activity summary");
		}
		if (resumeOutput.includes("category=PROJECT_RULES")) {
			fail("resumed ctx_search history exposed the raw Magic Context result block");
		}
		const resumedRawLines = (await readFile(sessionFile, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as SessionLine);
		const records = await readRecords(requestLog);
		if (!records.some((record) => record.type === "historian")) {
			const diagnosticMagicLog = await readFile(magicLog, "utf8").catch(() => "<Magic Context log unavailable>");
			fail(`high-usage session never completed a real Magic Context historian model call\n${diagnosticMagicLog}`);
		}
		const compactions = resumedRawLines.filter((line) => line.type === "compaction");
		const magicCompactions = compactions.filter(
			(line) =>
				typeof line.details === "object" &&
				line.details !== null &&
				(line.details as { readonly source?: unknown }).source === "magic-context",
		);
		if (compactions.length !== magicCompactions.length) {
			fail("resumed high-usage session appended a Pi-native compaction instead of the Magic Context marker");
		}
		if (magicCompactions.length === 0) {
			const diagnosticDatabase = new Database(databasePath, { readonly: true });
			try {
				const runs = diagnosticDatabase.query("SELECT * FROM historian_runs ORDER BY id DESC LIMIT 3").all();
				const compartments = diagnosticDatabase.query("SELECT * FROM compartments ORDER BY id DESC LIMIT 3").all();
				const relevantMagicLog = (await readFile(magicLog, "utf8").catch(() => ""))
					.split("\n")
					.filter((line) => /historian|subagent|compartment/i.test(line))
					.slice(-120)
					.join("\n");
				fail(
					`real historian pass did not append a Magic Context compaction marker during resume; runs=${JSON.stringify(runs)} compartments=${JSON.stringify(compartments)}\n${relevantMagicLog}`,
				);
			} finally {
				diagnosticDatabase.close();
			}
		}
		const inventories = records.filter((record) => record.type === "inventory" && record.subagent !== true);
		if (inventories.length === 0) fail("provider never observed the post-activation command/tool inventory");
		const expectedCommands = ["ctx"];
		for (const inventory of inventories) {
			const commands = Array.isArray(inventory.commands) ? inventory.commands : [];
			const tools = Array.isArray(inventory.tools) ? inventory.tools : [];
			const contextCommands = commands
				.filter(
					(command): command is string =>
						typeof command === "string" && (command === "ctx" || command.startsWith("ctx-")),
				)
				.sort();
			if (JSON.stringify(contextCommands) !== JSON.stringify(expectedCommands)) {
				fail(`focused Magic diagnostics differ: ${JSON.stringify(contextCommands)}`);
			}
			for (const required of ["ctx_search", "ctx_memory", "ctx_note", "ctx_expand", "ctx_reduce"]) {
				if (!tools.includes(required)) fail(`Magic tool ${required} was not active`);
			}
			if (tools.includes("todowrite")) fail("Magic's own Todo surface leaked into Pi Stuff");
		}
		const requests = records.filter((record) => record.type === "request");
		if (requests.length < 8)
			fail(`expected the full fresh/resume request sequence, received ${String(requests.length)}`);
		for (const request of requests) {
			if (request.hasContextActivityText !== false) {
				fail(`model request received Context activity text for ${String(request.lastUser)}`);
			}
			if (request.hasHistory !== true || request.hasSince !== true) {
				fail(`Magic projection was absent for request ${String(request.lastUser)}`);
			}
			if (request.hasCompactMagicContextPrompt !== true) {
				fail(`compact Magic Context instructions were absent for request ${String(request.lastUser)}`);
			}
			if (request.hasVerboseMagicContextPrompt !== false) {
				fail(`verbose upstream Magic Context instructions leaked into request ${String(request.lastUser)}`);
			}
			if (typeof request.systemPromptChars !== "number" || request.systemPromptChars > 8_000) {
				fail(
					`provider-visible system prompt exceeded the 8,000-character budget: ${String(request.systemPromptChars)}`,
				);
			}
		}
		const searchRequest = requests.find((record) => typeof record.searchResult === "string");
		if (!searchRequest || !(searchRequest.searchResult as string).includes(MEMORY_EVIDENCE)) {
			fail("ctx_search did not retrieve the Chinese memory written through ctx_memory");
		}
		const magicLogContents = await readFile(magicLog, "utf8");
		if (magicLogContents.includes("embedding model failed to load")) {
			fail("the certified lexical-only profile still attempted to load the incompatible local embedding runtime");
		}
		const resumed = requests.find(
			(record) => typeof record.lastUser === "string" && record.lastUser.includes("CONTEXT_RESUME"),
		);
		if (!resumed) {
			fail(`resumed session did not reach the model: ${JSON.stringify(requests.map((record) => record.lastUser))}`);
		}

		const sessionRecord = records.find((record) => record.type === "session");
		if (typeof sessionRecord?.sessionId !== "string") fail("session identity was not recorded");
		const isolationSessionDirectory = join(temporaryDirectory, "isolation-sessions");
		const isolationLog = join(temporaryDirectory, "isolation.jsonl");
		await mkdir(isolationSessionDirectory);
		await writeFile(isolationLog, "");
		runExpect(
			isolationProgram(),
			{
				...baseEnvironment,
				PI_STUFF_CONTEXT_PTY_INITIAL_PROMPT: "CONTEXT_ISOLATION",
				PI_STUFF_CONTEXT_PTY_LOG: isolationLog,
				PI_STUFF_CONTEXT_PTY_SESSIONS: isolationSessionDirectory,
				PI_STUFF_CONTEXT_PTY_SESSION_ID: "context-isolation",
			},
			"project isolation",
			isolatedProjectDirectory,
		);
		const isolationRequests = (await readRecords(isolationLog)).filter((record) => record.type === "request");
		const isolationSearch = isolationRequests.find((record) => typeof record.searchResult === "string");
		if (!isolationSearch) fail("isolated project did not execute ctx_search");
		if ((isolationSearch.searchResult as string).includes(MEMORY_EVIDENCE)) {
			fail("memory from the first project leaked into the isolated project search");
		}

		const nativeSessionDirectory = join(temporaryDirectory, "native-compacted-sessions");
		const nativeLog = join(temporaryDirectory, "native-compacted.jsonl");
		await mkdir(nativeSessionDirectory);
		await writeFile(nativeLog, "");
		const nativeSession = seedNativeCompactedSession(nativeSessionDirectory, nativeCompactedProjectDirectory);
		runExpect(
			nativeCompactionProgram(),
			{
				...baseEnvironment,
				PI_STUFF_CONTEXT_PTY_LOG: nativeLog,
				PI_STUFF_CONTEXT_PTY_RESUME_SESSION: nativeSession,
				PI_STUFF_CONTEXT_PTY_SESSIONS: nativeSessionDirectory,
			},
			"native-compacted resume",
			nativeCompactedProjectDirectory,
		);
		const nativeRequests = (await readRecords(nativeLog)).filter((record) => record.type === "request");
		const nativeResume = nativeRequests.find(
			(record) => typeof record.lastUser === "string" && record.lastUser.includes("CONTEXT_NATIVE_RESUME"),
		);
		if (nativeResume?.hasHistory !== true || nativeResume.hasNativeSummary !== true) {
			fail("Magic Context did not adopt the existing Pi-native compaction summary on resume");
		}
		const nativeRaw = await readFile(nativeSession, "utf8");
		if (!nativeRaw.includes('"type":"compaction"') || !nativeRaw.includes("NATIVE_COMPACTION_SUMMARY_MARKER")) {
			fail("native compaction entry was rewritten or lost during Magic Context adoption");
		}

		const database = new Database(databasePath, { readonly: true });
		try {
			const ownership = database
				.query("SELECT project_path FROM session_projects WHERE session_id = ? AND harness = 'pi'")
				.get(sessionRecord.sessionId) as { readonly project_path?: unknown } | null;
			if (!ownership || typeof ownership.project_path !== "string") {
				fail("Magic Context did not persist a Pi-scoped project binding");
			}
			if (!ownership.project_path.startsWith("git:") && !ownership.project_path.startsWith("dir:")) {
				fail(`unexpected project identity ${ownership.project_path}`);
			}
			const isolatedOwnership = database
				.query("SELECT project_path FROM session_projects WHERE session_id = ? AND harness = 'pi'")
				.get("context-isolation") as { readonly project_path?: unknown } | null;
			if (typeof isolatedOwnership?.project_path !== "string") {
				fail("isolated Pi session did not persist its project binding");
			}
			if (isolatedOwnership.project_path === ownership.project_path) {
				fail("distinct project directories resolved to the same Magic Context identity");
			}
			const memoryOwnership = database
				.query("SELECT DISTINCT project_path FROM memories WHERE content LIKE ?")
				.all(`%${MEMORY_EVIDENCE}%`) as Array<{ readonly project_path?: unknown }>;
			if (memoryOwnership.length !== 1 || memoryOwnership[0]?.project_path !== ownership.project_path) {
				fail("written memory was not confined to the originating project identity");
			}
		} finally {
			database.close();
		}

		const failOpenDirectory = join(temporaryDirectory, "fail-open-sessions");
		const failOpenLog = join(temporaryDirectory, "fail-open.jsonl");
		await mkdir(failOpenDirectory);
		await writeFile(failOpenLog, "");
		const failOpenOutput = runExpect(
			failOpenProgram(),
			{
				...baseEnvironment,
				PI_STUFF_CONTEXT_PTY_INITIAL_PROMPT: "CONTEXT_FAIL_OPEN",
				PI_STUFF_CONTEXT_PTY_LOG: failOpenLog,
				PI_STUFF_CONTEXT_PTY_SESSIONS: failOpenDirectory,
				PI_STUFF_CONTEXT_PTY_SESSION_ID: "context-fail-open",
				XDG_DATA_HOME: "/dev/null",
			},
			"fail-open",
			projectDirectory,
		);
		if (!failOpenOutput.includes("CONTEXT_FAIL_OPEN_DONE")) fail("native fail-open response was not rendered");
		const failOpenRecords = (await readRecords(failOpenLog)).filter((record) => record.type === "request");
		if (failOpenRecords.length !== 1 || failOpenRecords[0]?.hasHistory !== false) {
			fail("storage failure did not cleanly degrade to Pi native context");
		}
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	await verifyContextPty({ piBinary: PI_BIN, packagePath: join(root, "packages/pi-stuff") });
	console.log(
		"Certified Magic Context in a real 64x28 Pi TUI, including project isolation, native-compaction adoption, lexical recall, resume, and fail-open",
	);
}
