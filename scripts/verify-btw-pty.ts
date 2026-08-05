import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/btw-pty-provider.ts");
const runner = join(root, "test/fixtures/btw-pty-runner.sh");

export interface BtwPtyVerificationOptions {
	readonly piBinary: string;
	readonly packagePath: string;
	readonly columns: number;
	readonly rows: number;
}

interface RequestRecord {
	readonly lastUser?: unknown;
	readonly messageCount?: unknown;
	readonly tools?: unknown;
}

interface PersistedLine {
	readonly type?: unknown;
	readonly customType?: unknown;
	readonly parentSession?: unknown;
	readonly message?: unknown;
}

interface PersistedSession {
	readonly path: string;
	readonly lines: readonly PersistedLine[];
	readonly messageText: readonly string[];
}

function textPart(value: unknown): { readonly type?: unknown; readonly text?: unknown } | undefined {
	return typeof value === "object" && value !== null
		? (value as { readonly type?: unknown; readonly text?: unknown })
		: undefined;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map(textPart)
		.filter((part): part is { readonly type?: unknown; readonly text?: unknown } => part !== undefined)
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

function messageText(line: PersistedLine): string | undefined {
	if (line.type !== "message") return undefined;
	if (typeof line.message !== "object" || line.message === null) return undefined;
	const message = line.message as { readonly role?: unknown; readonly content?: unknown };
	if (message.role !== "user" && message.role !== "assistant") return undefined;
	return contentText(message.content);
}

async function readSession(path: string): Promise<PersistedSession> {
	const lines = (await readFile(path, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as PersistedLine);
	return {
		path,
		lines,
		messageText: lines.map(messageText).filter((text): text is string => text !== undefined),
	};
}

function expectProgram(): string {
	return `
set timeout 20

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout {
            puts stderr "Timed out waiting for: $pattern"
            exit 2
        }
        eof {
            puts stderr "Reached EOF while waiting for: $pattern"
            exit 3
        }
    }
}

spawn -noecho script -qefc $env(PI_STUFF_PTY_RUNNER) /dev/null
must_expect "Working..."
after 200
send -- "/btw side question\\r"
must_expect "BTW_STREAM"
must_expect "BTW_DONE"
for {set index 0} {$index < 8} {incr index} {
    send -- "\\033\\[A"
    after 50
}
must_expect "scroll line 10"
for {set index 0} {$index < 8} {incr index} {
    send -- "\\033\\[B"
    after 50
}
must_expect "BTW_DONE"
after 2100
send -- "\\033"
after 200
send -- "DRAFT_RESTORED"
after 100
send -- "\\033\\[24~"
must_expect "DRAFT_SURFACE"
send -- "\\033"
must_expect "DRAFT_RESTORED"
send -- "\\025"
after 200
send -- "/btw second question\\r"
must_expect "second question"
must_expect "BTW_STREAM"
must_expect "BTW_DONE"
send -- "\\033"
after 150
send -- "/btw\\r"
must_expect "side question"
must_expect "second question"
must_expect "BTW_DONE"
send -- "x"
must_expect "Clear earlier BTW history?"
send -- "\\033"
after 150
send -- "x"
must_expect "Clear earlier BTW history?"
send -- "y"
must_expect "Cleared BTW history"
send -- "f"
after 700
foreach close_key {" " "\\r" "\\033"} {
    send -- "/btw\\r"
    must_expect "No previous /btw exchange in this session."
    send -- $close_key
    after 150
}
send -- "\\003"
after 200
send -- "\\004"
expect {
    eof {}
    timeout {
        puts stderr "Timed out waiting for Pi to exit"
        exit 4
    }
}
`;
}

function resumeExpectProgram(): string {
	return `
set timeout 20

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout {
            puts stderr "Timed out waiting for: $pattern"
            exit 2
        }
        eof {
            puts stderr "Reached EOF while waiting for: $pattern"
            exit 3
        }
    }
}

spawn -noecho script -qefc $env(PI_STUFF_PTY_RUNNER) /dev/null
must_expect "MAIN_DONE"
after 200
send -- "/btw\\r"
must_expect "second question"
must_expect "BTW_DONE"
send -- "\\033"
after 150
send -- "\\003"
after 200
send -- "\\004"
expect {
    eof {}
    timeout {
        puts stderr "Timed out waiting for resumed Pi to exit"
        exit 4
    }
}
`;
}

function fail(message: string): never {
	throw new Error(`BTW PTY verification failed: ${message}`);
}

export async function verifyBtwPty(options: BtwPtyVerificationOptions): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-btw-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	await Promise.all([mkdir(configDirectory), mkdir(sessionDirectory)]);

	try {
		const baseEnvironment = {
			...process.env,
			MAGIC_CONTEXT_PI_SUBAGENT: "1",
			PI_CODING_AGENT_DIR: configDirectory,
			PI_STUFF_PTY_BIN: options.piBinary,
			PI_STUFF_PTY_COLUMNS: String(options.columns),
			PI_STUFF_PTY_LOG: requestLog,
			PI_STUFF_PTY_PACKAGE: resolve(options.packagePath),
			PI_STUFF_PTY_PROVIDER_EXTENSION: providerExtension,
			PI_STUFF_PTY_ROWS: String(options.rows),
			PI_STUFF_PTY_RUNNER: runner,
			PI_STUFF_PTY_SESSIONS: sessionDirectory,
			PI_STUFF_PTY_SESSION_ID: `btw-pty-${options.columns}x${options.rows}`,
			TERM: "xterm-256color",
		};
		const result = Bun.spawnSync(["expect", "-c", expectProgram()], {
			cwd: root,
			env: baseEnvironment,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) {
			const diagnostic = [result.stderr.toString().trim(), result.stdout.toString().trim()]
				.filter((text) => text.length > 0)
				.join("\n");
			fail(diagnostic || `expect exited ${result.exitCode}`);
		}

		const requests = (await readFile(requestLog, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as RequestRecord);
		if (requests.length !== 3) fail(`expected three model requests, received ${requests.length}`);
		const [main, side, secondSide] = requests;
		if (main?.lastUser !== "main request") fail("main request was not observed");
		if (!Array.isArray(main.tools) || !main.tools.includes("TaskCreate"))
			fail("Aggregate Todo tools were not active");
		if (side?.lastUser !== "side question") fail("side request was not observed");
		if (side.messageCount !== 2) fail("side request included the pending main assistant or missed the main user");
		if (!Array.isArray(side.tools) || side.tools.length !== 0) fail("side request exposed tools");
		if (secondSide?.lastUser !== "second question") fail("second side request was not observed");
		if (secondSide.messageCount !== 3)
			fail("second side request did not include the completed main turn exactly once");
		if (!Array.isArray(secondSide.tools) || secondSide.tools.length !== 0) fail("second side request exposed tools");

		const sessionFiles = (await readdir(sessionDirectory))
			.filter((entry) => entry.endsWith(".jsonl"))
			.map((entry) => join(sessionDirectory, entry));
		if (sessionFiles.length !== 2) fail(`expected original and promoted sessions, received ${sessionFiles.length}`);
		const sessions = await Promise.all(sessionFiles.map(readSession));
		const original = sessions.find((session) => session.messageText.includes("main request"));
		const promoted = sessions.find((session) => session.messageText.includes("second question"));
		if (!original || !promoted || original === promoted) fail("could not distinguish original and promoted sessions");
		if (!original.messageText.includes("MAIN_START MAIN_DONE")) {
			fail("the main turn did not finish while BTW was open");
		}
		for (const forbidden of ["side question", "second question", "BTW_STREAM", "BTW_DONE", "DRAFT_RESTORED"]) {
			if (original.messageText.some((text) => text.includes(forbidden))) {
				fail(`ephemeral text leaked into the original formal transcript: ${forbidden}`);
			}
		}
		const originalHistory = original.lines.filter(
			(line) => line.type === "custom" && line.customType === "@jczhang02/pi-stuff-btw/history/v1",
		);
		if (
			originalHistory.length !== 3 ||
			!originalHistory.some((line) => JSON.stringify(line).includes('"operation":"retain"')) ||
			!JSON.stringify(originalHistory).includes("second question")
		) {
			fail("the original session did not retain the confirmed BTW history reduction");
		}
		if (
			!promoted.messageText.includes("second question") ||
			!promoted.messageText.some((text) => text.includes("BTW_DONE"))
		) {
			fail("the selected BTW question and answer were not promoted as formal turns");
		}
		if (
			promoted.lines.some(
				(line) => line.type === "custom" && line.customType === "@jczhang02/pi-stuff-btw/history/v1",
			)
		) {
			fail("the promoted session inherited BTW display history");
		}
		const promotedHeader = promoted.lines.find((line) => line.type === "session");
		if (promotedHeader?.parentSession !== original.path)
			fail("the promoted session lost its original-session lineage");

		const resume = Bun.spawnSync(["expect", "-c", resumeExpectProgram()], {
			cwd: root,
			env: { ...baseEnvironment, PI_STUFF_PTY_RESUME_SESSION: original.path },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (resume.exitCode !== 0) {
			fail(
				resume.stderr.toString().trim() ||
					resume.stdout.toString().trim() ||
					`resumed expect exited ${resume.exitCode}`,
			);
		}
		const requestsAfterResume = (await readFile(requestLog, "utf8")).trim().split("\n");
		if (requestsAfterResume.length !== 3) fail("reopening durable BTW history made an unexpected model request");
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyBtwPty({ piBinary: PI_BIN, packagePath: join(root, "packages/pi-stuff"), columns, rows });
	}
	console.log("Certified BTW in 100x32 and 64x28 PTYs");
}
