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
		const result = Bun.spawnSync(["expect", "-c", expectProgram()], {
			cwd: root,
			env: {
				...process.env,
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
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) {
			fail(result.stderr.toString().trim() || result.stdout.toString().trim() || `expect exited ${result.exitCode}`);
		}

		const requests = (await readFile(requestLog, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as RequestRecord);
		if (requests.length !== 2) fail(`expected two model requests, received ${requests.length}`);
		const [main, side] = requests;
		if (main?.lastUser !== "main request") fail("main request was not observed");
		if (!Array.isArray(main.tools) || !main.tools.includes("TaskCreate"))
			fail("Aggregate Todo tools were not active");
		if (side?.lastUser !== "side question") fail("side request was not observed");
		if (side.messageCount !== 2) fail("side request included the pending main assistant or missed the main user");
		if (!Array.isArray(side.tools) || side.tools.length !== 0) fail("side request exposed tools");

		const sessionFiles = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		if (sessionFiles.length !== 1 || !sessionFiles[0]) fail("expected exactly one saved session");
		const transcript = await readFile(join(sessionDirectory, sessionFiles[0]), "utf8");
		if (!transcript.includes("main request") || !transcript.includes("MAIN_START MAIN_DONE")) {
			fail("the main turn did not finish while BTW was open");
		}
		for (const forbidden of ["side question", "BTW_STREAM", "BTW_DONE", "DRAFT_RESTORED"]) {
			if (transcript.includes(forbidden)) fail(`ephemeral text leaked into the session: ${forbidden}`);
		}
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
