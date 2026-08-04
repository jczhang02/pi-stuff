import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/context-pty-provider.ts");
const runner = join(root, "test/fixtures/context-pty-runner.sh");

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
	readonly hasHistory?: unknown;
	readonly hasSince?: unknown;
	readonly commands?: unknown;
	readonly tools?: unknown;
	readonly searchResult?: unknown;
	readonly subagent?: unknown;
}

interface SessionLine {
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

spawn -noecho script -qefc $env(PI_STUFF_CONTEXT_PTY_RUNNER) /dev/null
must_expect "CONTEXT_FIRST_DONE"
send -- "CONTEXT_SECOND\r"
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

function runExpect(program: string, environment: Record<string, string | undefined>, label: string): string {
	const result = Bun.spawnSync(["expect", "-c", program], {
		cwd: root,
		env: environment,
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
	const cacheDirectory = join(temporaryDirectory, "cache");
	const projectDirectory = join(temporaryDirectory, "项目隔离", "context");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	const magicLog = join(temporaryDirectory, "magic-context.log");
	const historianMarker = join(temporaryDirectory, "historian-ready");
	const databasePath = join(dataDirectory, "cortexkit", "magic-context", "context.db");
	const columns = options.columns ?? 64;
	const rows = options.rows ?? 28;
	await Promise.all(
		[configDirectory, cortexConfigDirectory, dataDirectory, cacheDirectory, projectDirectory, sessionDirectory].map(
			(path) => mkdir(path, { recursive: true }),
		),
	);
	await Promise.all([
		writeFile(requestLog, ""),
		writeFile(
			join(configDirectory, "settings.json"),
			`${JSON.stringify({ defaultProjectTrust: "always", quietStartup: true, uiMode: "fullscreen" })}\n`,
		),
		writeFile(
			join(cortexConfigDirectory, "magic-context.jsonc"),
			`${JSON.stringify({
				historian: {
					model: "pi-stuff-context-pty/fixture-model",
					thinking_level: "off",
				},
				historian_timeout_ms: 30_000,
				pi: { subagent_extensions: [providerExtension] },
			})}\n`,
		),
	]);

	try {
		const baseEnvironment = {
			...process.env,
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
			TERM: "xterm-256color",
			TRANSFORMERS_OFFLINE: "1",
			XDG_CACHE_HOME: cacheDirectory,
			XDG_CONFIG_HOME: xdgConfigDirectory,
			XDG_DATA_HOME: dataDirectory,
		};
		const freshOutput = runExpect(expectProgram(), baseEnvironment, "fresh session");
		for (const forbidden of ["╭", "╮", "╰", "╯", "Magic Context", "ctx-aug", "ctx-doctor"]) {
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
			if (!persisted.includes(required)) fail(`raw Pi transcript lost ${required}`);
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
		if (!resumeOutput.includes("Context search")) {
			fail("resumed ctx_search history did not retain the compact Pi Stuff Tool renderer");
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
		for (const inventory of inventories) {
			const commands = Array.isArray(inventory.commands) ? inventory.commands : [];
			const tools = Array.isArray(inventory.tools) ? inventory.tools : [];
			for (const command of commands) {
				if (typeof command === "string" && command.startsWith("ctx-")) fail(`Magic command leaked: /${command}`);
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
			if (request.hasHistory !== true || request.hasSince !== true) {
				fail(`Magic projection was absent for request ${String(request.lastUser)}`);
			}
		}
		const searchRequest = requests.find((record) => typeof record.searchResult === "string");
		if (!searchRequest || !(searchRequest.searchResult as string).includes("中文检索标记")) {
			fail("ctx_search did not retrieve the Chinese memory written through ctx_memory");
		}
		const resumed = requests.find(
			(record) => typeof record.lastUser === "string" && record.lastUser.includes("CONTEXT_RESUME"),
		);
		if (!resumed) {
			fail(`resumed session did not reach the model: ${JSON.stringify(requests.map((record) => record.lastUser))}`);
		}

		const sessionRecord = records.find((record) => record.type === "session");
		if (typeof sessionRecord?.sessionId !== "string") fail("session identity was not recorded");
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
	console.log("Certified Magic Context in a real 64x28 Pi TUI, including resume and fail-open");
}
