import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { CERTIFIED_RTK_LINUX_X64_SHA256S, CERTIFIED_RTK_VERSION } from "../packages/pi-stuff/src/rtk/runtime.js";
import { isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/rtk-pty-provider.ts");
const runner = join(root, "test/fixtures/rtk-pty-runner.sh");
const LONG_RESULT_ID = "rtk-pty-long-output";
const SESSION_TOOL_RESULT_SCHEMA = Type.Object(
	{
		message: Type.Object(
			{
				content: Type.Array(
					Type.Object(
						{ text: Type.Optional(Type.String()), type: Type.Optional(Type.String()) },
						{ additionalProperties: true },
					),
				),
				role: Type.Literal("toolResult"),
				toolCallId: Type.String(),
			},
			{ additionalProperties: true },
		),
	},
	{ additionalProperties: true },
);

interface ContextRecord {
	readonly bashCommands?: unknown;
	readonly phase?: unknown;
	readonly toolResults?: unknown;
}

interface ProjectedToolResult {
	readonly id?: unknown;
	readonly text?: unknown;
}

function fail(message: string): never {
	throw new Error(`RTK PTY verification failed: ${message}`);
}

function freshExpectProgram(): string {
	return `
set timeout 25

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

spawn -noecho script -qefc $env(PI_STUFF_RTK_PTY_RUNNER) /dev/null
must_expect "RTK_FRESH_DONE"
after 200
send -- "/rtk\\r"
must_expect "RTK"
must_expect "ready"
must_expect "0.42.4"
must_expect "/rtk settings"
send -- "\\033"
after 100
send -- "/rtk settings\\r"
must_expect "RTK settings"
must_expect "Command rewriting"
must_expect "Model projection"
send -- "\\033"
after 100
send -- "\\004"
expect {
    eof {}
    timeout {
        puts stderr "Timed out waiting for fresh Pi to exit"
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

spawn -noecho script -qefc $env(PI_STUFF_RTK_PTY_RUNNER) /dev/null
must_expect "RTK_RESUME_DONE"
after 150
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

function run(command: readonly string[], cwd: string): string {
	const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		fail(`${command[0]} exited ${String(result.exitCode)}: ${result.stderr.toString().trim()}`);
	}
	return result.stdout.toString().trim();
}

function verifyHostVersion(piBinary: string): void {
	const version = run([piBinary, "--version"], root);
	if (version !== CERTIFIED_PI_VERSION) fail(`expected Pi ${CERTIFIED_PI_VERSION}, received ${version || "nothing"}`);
}

async function resolveCertifiedRtk(): Promise<string> {
	let path = process.env["RTK_BIN"]?.trim();
	if (!path) {
		for (const discovery of [
			["mise", "which", "rtk"],
			["which", "rtk"],
		] as const) {
			const result = Bun.spawnSync([...discovery], { cwd: root, stdout: "pipe", stderr: "pipe" });
			if (result.exitCode !== 0) continue;
			path = result.stdout.toString().trim();
			if (path) break;
		}
	}
	if (!path) fail("RTK_BIN, mise, and PATH could not resolve RTK");
	const version = run([path, "--version"], root);
	if (version !== `rtk ${CERTIFIED_RTK_VERSION}`) {
		fail(`expected RTK ${CERTIFIED_RTK_VERSION}, received ${version || "nothing"}`);
	}
	const digest = createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
	if (!(CERTIFIED_RTK_LINUX_X64_SHA256S as readonly string[]).includes(digest)) {
		fail("local RTK executable does not match a certified SHA-256");
	}
	return path;
}

function stripTerminalControls(output: string): string {
	let visible = "";
	for (let index = 0; index < output.length; index += 1) {
		const code = output.charCodeAt(index);
		if (code === 13) continue;
		if (code !== 27) {
			visible += output[index];
			continue;
		}
		const introducer = output[index + 1];
		if (introducer === "[") {
			index += 2;
			while (index < output.length) {
				const finalCode = output.charCodeAt(index);
				if (finalCode >= 0x40 && finalCode <= 0x7e) break;
				index += 1;
			}
			continue;
		}
		if (introducer === "]") {
			index += 2;
			while (index < output.length) {
				if (output.charCodeAt(index) === 7) break;
				if (output.charCodeAt(index) === 27 && output[index + 1] === "\\") {
					index += 1;
					break;
				}
				index += 1;
			}
			continue;
		}
		if (introducer !== undefined) index += 1;
	}
	return visible;
}

function runPty(
	phase: "fresh" | "resume",
	options: {
		readonly configDirectory: string;
		readonly logPath: string;
		readonly packagePath: string;
		readonly path: string;
		readonly piBinary: string;
		readonly projectDirectory: string;
		readonly sessionDirectory: string;
		readonly sessionFile?: string;
	},
): string {
	const result = Bun.spawnSync(["expect", "-c", phase === "fresh" ? freshExpectProgram() : resumeExpectProgram()], {
		cwd: options.projectDirectory,
		env: {
			...process.env,
			PATH: options.path,
			PI_CODING_AGENT_DIR: options.configDirectory,
			PI_STUFF_RTK_PTY_BIN: options.piBinary,
			PI_STUFF_RTK_PTY_LOG: options.logPath,
			PI_STUFF_RTK_PTY_PACKAGE: resolve(options.packagePath),
			PI_STUFF_RTK_PTY_PHASE: phase,
			PI_STUFF_RTK_PTY_PROVIDER_EXTENSION: providerExtension,
			PI_STUFF_RTK_PTY_RUNNER: runner,
			PI_STUFF_RTK_PTY_SESSIONS: options.sessionDirectory,
			PI_STUFF_RTK_PTY_SESSION: options.sessionFile ?? "",
			SHELL: "/bin/sh",
			TERM: "xterm-256color",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = result.stdout.toString();
	if (result.exitCode !== 0) {
		fail(
			`${phase} Pi failed: ${result.stderr.toString().trim() || `expect exited ${String(result.exitCode)}`}\nPTY tail:\n${output.slice(-12_000)}`,
		);
	}
	return output;
}

function parseContextRecords(contents: string): ContextRecord[] {
	return contents
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ContextRecord);
}

function recordForPhase(records: readonly ContextRecord[], phase: string): ContextRecord {
	for (let index = records.length - 1; index >= 0; index -= 1) {
		const record = records[index];
		if (record?.phase === phase) return record;
	}
	return fail(`provider did not record the ${phase} model context`);
}

function projectedResult(record: ContextRecord): string {
	if (!Array.isArray(record.toolResults)) fail("provider record has no projected Tool results");
	const result = (record.toolResults as ProjectedToolResult[]).find((candidate) => candidate.id === LONG_RESULT_ID);
	if (!result || !isRuntimeString(result.text)) fail("provider record has no projected long Bash result");
	return result.text;
}

function verifyCommandHistory(record: ContextRecord): void {
	if (!Array.isArray(record.bashCommands)) fail("provider record has no Bash command history");
	if (!record.bashCommands.includes("git status")) {
		fail(`model context did not retain the original Bash command: ${JSON.stringify(record.bashCommands)}`);
	}
}

function rawResult(sessionContents: string, toolCallId: string): string {
	for (const line of sessionContents.split("\n")) {
		if (!line) continue;
		const entry = JSON.parse(line);
		if (!Check(SESSION_TOOL_RESULT_SCHEMA, entry) || entry.message.toolCallId !== toolCallId) continue;
		return entry.message.content
			.filter((part) => part.type === "text")
			.flatMap((part) => (part.text === undefined ? [] : [part.text]))
			.join("\n");
	}
	fail(`raw session has no Bash Tool result for ${toolCallId}`);
}

function verifyProjection(raw: string, projected: string, label: string): void {
	if (raw.length <= 12_000) fail("raw Bash result was not large enough to exercise projection");
	if (!raw.includes("\u001b[31mRAW_RTK_RESULT_MARKER\u001b[0m") || !raw.includes("RAW_RTK_LONG_LINE_1599")) {
		fail("raw session did not retain the original ANSI and tail markers");
	}
	if (projected === raw || projected.length > 12_100) fail(`${label} context did not bound the long Bash result`);
	if (projected.includes("\u001b") || !projected.includes("RAW_RTK_RESULT_MARKER")) {
		fail(`${label} context did not sanitize ANSI while retaining useful output`);
	}
}

export async function verifyRtkPty(options: {
	readonly packagePath: string;
	readonly piBinary: string;
}): Promise<void> {
	verifyHostVersion(options.piBinary);
	const rtkBinary = await resolveCertifiedRtk();
	const inheritedPath = process.env["PATH"];
	if (!inheritedPath) fail("PATH is required to run the RTK PTY verification");
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-rtk-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const projectDirectory = join(temporaryDirectory, "project");
	const logPath = join(temporaryDirectory, "provider.jsonl");
	await Promise.all([mkdir(configDirectory), mkdir(sessionDirectory), mkdir(projectDirectory)]);
	await Promise.all([
		writeFile(
			join(configDirectory, "settings.json"),
			`${JSON.stringify({ defaultProjectTrust: "always" }, null, "\t")}\n`,
			{ mode: 0o600 },
		),
		writeFile(join(projectDirectory, "untracked.txt"), "RTK fixture\n", { mode: 0o600 }),
	]);
	run(["git", "-c", "init.defaultBranch=fixture", "init", "-q"], projectDirectory);

	try {
		const shared = {
			configDirectory,
			logPath,
			packagePath: options.packagePath,
			path: `${dirname(rtkBinary)}:${inheritedPath}`,
			piBinary: options.piBinary,
			projectDirectory,
			sessionDirectory,
		};
		const freshOutput = runPty("fresh", shared);
		const visibleFresh = stripTerminalControls(freshOutput);
		for (const required of [
			"RTK_FRESH_DONE",
			"RTK",
			"ready",
			CERTIFIED_RTK_VERSION,
			"/rtk settings",
			"RTK settings",
			"Command rewriting",
			"Model projection",
		]) {
			if (!visibleFresh.includes(required)) fail(`fresh TUI is missing ${required}`);
		}
		const sessions = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		if (sessions.length !== 1 || !sessions[0]) fail("fresh Pi did not create exactly one isolated session");
		const sessionFile = join(sessionDirectory, sessions[0]);
		const sessionBeforeResume = await readFile(sessionFile, "utf8");
		const rawGitStatus = rawResult(sessionBeforeResume, "rtk-pty-git-status");
		if (!rawGitStatus.includes("* No commits yet on fixture") || !rawGitStatus.includes("?? untracked.txt")) {
			fail(`real Host did not execute the RTK-rewritten git status command: ${rawGitStatus}`);
		}
		if (rawGitStatus.includes("On branch fixture")) fail("real Host executed raw git status instead of RTK");
		const rawBeforeResume = rawResult(sessionBeforeResume, LONG_RESULT_ID);
		const freshRecord = recordForPhase(parseContextRecords(await readFile(logPath, "utf8")), "fresh");
		verifyCommandHistory(freshRecord);
		const projectedFresh = projectedResult(freshRecord);
		verifyProjection(rawBeforeResume, projectedFresh, "fresh");

		const resumeOutput = runPty("resume", { ...shared, sessionFile });
		if (!stripTerminalControls(resumeOutput).includes("RTK_RESUME_DONE")) fail("resumed TUI did not complete");
		const rawAfterResume = rawResult(await readFile(sessionFile, "utf8"), LONG_RESULT_ID);
		if (rawAfterResume !== rawBeforeResume) fail("session reload changed the original raw Bash result");
		const resumeRecord = recordForPhase(parseContextRecords(await readFile(logPath, "utf8")), "resume");
		verifyCommandHistory(resumeRecord);
		const projectedResume = projectedResult(resumeRecord);
		verifyProjection(rawAfterResume, projectedResume, "resumed");
		if (projectedResume !== projectedFresh)
			fail("fresh and resumed model contexts projected the same result differently");
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	await verifyRtkPty({ packagePath: join(root, "packages/pi-stuff"), piBinary: PI_BIN });
	console.log("Certified RTK rewrite and projection across fresh/resumed real Pi TUI sessions");
}
