import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/agents-pty-provider.ts");
const runner = join(root, "test/fixtures/agents-pty-runner.sh");
const CERTIFIED_PI_VERSION = "0.83.0";

export interface AgentsPtyVerificationOptions {
	readonly piBinary: string;
	readonly packagePath: string;
	readonly columns: number;
	readonly rows: number;
}

interface LogRecord {
	readonly at?: unknown;
	readonly completion?: unknown;
	readonly kind?: unknown;
	readonly lastUser?: unknown;
	readonly phase?: unknown;
	readonly role?: unknown;
	readonly tools?: unknown;
}

function expectProgram(): string {
	return `
set timeout 35

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

spawn -noecho script -qefc $env(PI_STUFF_AGENTS_PTY_RUNNER) /dev/null
must_expect "MAIN_NOT_BLOCKED"
must_expect "↓ to manage"
must_expect "AGENT_PTY_TASK"
after 200
send -- "/agents\\r"
must_expect "↑/↓ navigate · Enter inspect"
must_expect "x dismiss · Esc close"
send -- "\\r"
must_expect "Agents / general-purpose"
must_expect "Transcript"
send -- "\\033"
must_expect "↑/↓ navigate · Enter inspect"
send -- "\\033"
after 200
send -- "DRAFT_RESTORED"
must_expect "DRAFT_RESTORED"
send -- "\\025"
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
	throw new Error(`Agents PTY verification failed: ${message}`);
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function pathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

async function readFailureDiagnostics(directory: string): Promise<string> {
	const entries = await readdir(directory, { recursive: true }).catch(() => [] as string[]);
	const candidates = entries
		.filter((entry) =>
			/(?:status|result|events|output|stderr|transcript|work).*\.(?:json|jsonl|log|txt)$/i.test(entry),
		)
		.sort()
		.slice(0, 24);
	const sections: string[] = [];
	let remaining = 24_000;
	for (const entry of candidates) {
		if (remaining <= 0) break;
		const content = await readFile(join(directory, entry), "utf8").catch(() => undefined);
		if (content === undefined) continue;
		const excerpt = content.slice(-Math.min(remaining, 6_000));
		sections.push(`--- ${entry} ---\n${excerpt}`);
		remaining -= excerpt.length;
	}
	return sections.join("\n");
}

function verifyHostVersion(piBinary: string): void {
	const result = Bun.spawnSync([piBinary, "--version"], { stdout: "pipe", stderr: "pipe" });
	const version = result.stdout.toString().trim();
	if (result.exitCode !== 0 || version !== CERTIFIED_PI_VERSION) {
		fail(`expected Pi ${CERTIFIED_PI_VERSION}, received ${version || `exit ${result.exitCode}`}`);
	}
}

function stripTerminalControls(output: string): string {
	let visible = "";
	for (let index = 0; index < output.length; index++) {
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
				index++;
			}
			continue;
		}
		if (introducer === "]") {
			index += 2;
			while (index < output.length) {
				if (output.charCodeAt(index) === 7) break;
				if (output.charCodeAt(index) === 27 && output[index + 1] === "\\") {
					index++;
					break;
				}
				index++;
			}
			continue;
		}
		if (introducer !== undefined) index++;
	}
	return visible;
}

function verifyTerminalOutput(output: string, columns: number): void {
	const visible = stripTerminalControls(output);
	for (const required of [
		"MAIN_NOT_BLOCKED",
		"↓ to manage",
		"AGENT_PTY_TASK",
		"中文长任务",
		"Agents / general-purpose",
		"DRAFT_RESTORED",
		"Agent general-purpose completed.",
		"CHILD_FINAL_SUMMARY",
		"MAIN_SAW_DIRECT_SUMMARY",
	]) {
		if (!visible.includes(required)) fail(`terminal output is missing ${required}`);
	}
	if (!visible.includes("─".repeat(columns))) fail(`Agent dialog did not render a ${columns}-column divider`);
	for (const forbidden of ["Fleet", "latest action", "statusline", "╭", "╮", "╰", "╯"]) {
		if (visible.includes(forbidden)) fail(`terminal output exposed forbidden UI: ${forbidden}`);
	}
	if (/↓\s+\d+(?:\.\d+)?[kKmM]?\s+tokens?/.test(visible)) {
		fail("terminal output exposed the removed Agent token statusline");
	}
}

function verifyRequests(records: readonly LogRecord[]): void {
	const requests = records.filter((record) => record.kind === "request");
	const launch = requests.find((record) => record.role === "main" && record.phase === "launch");
	const continued = requests.find((record) => record.role === "main" && record.phase === "continued");
	const child = requests.find((record) => record.role === "child" && record.phase === "child");
	const completion = requests.find((record) => record.role === "main" && record.phase === "completion");
	const childFinished = records.find((record) => record.kind === "child-finished");
	if (!launch || !continued || !child || !completion || !childFinished) {
		fail("provider did not observe launch, non-blocking continuation, child, completion, and finish phases");
	}
	if (launch.lastUser !== "launch one background general-purpose Agent") {
		fail("main launch prompt was not observed");
	}
	if (!Array.isArray(launch.tools) || !launch.tools.includes("subagent")) {
		fail("the model did not receive the public subagent tool");
	}
	if (typeof child.lastUser !== "string" || !child.lastUser.includes("AGENT_PTY_TASK")) {
		fail("the general-purpose child did not receive its task");
	}
	if (completion.completion !== true) fail("the completion turn did not contain the direct child summary");
	const continuedAt = number(continued.at);
	const childFinishedAt = number(childFinished.at);
	if (continuedAt === undefined || childFinishedAt === undefined || continuedAt >= childFinishedAt) {
		fail("the main session did not continue before the background Agent finished");
	}
}

export async function verifyAgentsPty(options: AgentsPtyVerificationOptions): Promise<void> {
	verifyHostVersion(options.piBinary);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-agents-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const agentsDirectory = join(configDirectory, "agents");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	await Promise.all([mkdir(agentsDirectory, { recursive: true }), mkdir(sessionDirectory)]);
	await writeFile(
		join(agentsDirectory, "general-purpose.md"),
		`---
name: general-purpose
description: Deterministic native PTY lifecycle Agent.
model: pi-stuff-agents-pty/fixture-model
extensions: ${providerExtension}
systemPromptMode: append
inheritProjectContext: false
inheritSkills: false
---
Return the deterministic fixture result.
`,
		{ mode: 0o600 },
	);

	try {
		const result = Bun.spawnSync(["expect", "-c", expectProgram()], {
			cwd: temporaryDirectory,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: configDirectory,
				PI_SUBAGENT_PI_BINARY: options.piBinary,
				PI_STUFF_AGENTS_PTY_BIN: options.piBinary,
				PI_STUFF_AGENTS_PTY_COLUMNS: String(options.columns),
				PI_STUFF_AGENTS_PTY_LOG: requestLog,
				PI_STUFF_AGENTS_PTY_PACKAGE: resolve(options.packagePath),
				PI_STUFF_AGENTS_PTY_PROVIDER_EXTENSION: providerExtension,
				PI_STUFF_AGENTS_PTY_ROWS: String(options.rows),
				PI_STUFF_AGENTS_PTY_RUNNER: runner,
				PI_STUFF_AGENTS_PTY_SESSIONS: sessionDirectory,
				PI_STUFF_AGENTS_PTY_SESSION_ID: `agents-pty-${options.columns}x${options.rows}`,
				TERM: "xterm-256color",
				TMPDIR: temporaryDirectory,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = result.stdout.toString();
		if (result.exitCode !== 0) {
			const providerLog = await readFile(requestLog, "utf8").catch(() => "(provider log unavailable)");
			const diagnostics = await readFailureDiagnostics(temporaryDirectory);
			const reason = result.stderr.toString().trim() || `expect exited ${result.exitCode}`;
			fail(
				`${reason}\nProvider log:\n${providerLog.trim()}\nRuntime diagnostics:\n${diagnostics || "(none)"}\nPTY tail:\n${output.slice(-12_000)}`,
			);
		}
		verifyTerminalOutput(output, options.columns);

		const records = (await readFile(requestLog, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LogRecord);
		verifyRequests(records);

		const topLevelSessions = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		if (topLevelSessions.length !== 1 || !topLevelSessions[0]) fail("expected exactly one isolated main session");
		const transcript = await readFile(join(sessionDirectory, topLevelSessions[0]), "utf8");
		for (const required of [
			"subagent",
			"MAIN_NOT_BLOCKED",
			"Agent general-purpose completed.",
			"CHILD_FINAL_SUMMARY",
		]) {
			if (!transcript.includes(required)) fail(`main session transcript is missing ${required}`);
		}
		for (const forbidden of ["Fleet", "statusline", "DRAFT_RESTORED"]) {
			if (transcript.includes(forbidden)) fail(`ephemeral or removed UI leaked into the session: ${forbidden}`);
		}
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
		if (await pathExists(temporaryDirectory)) fail("temporary verification directory was not removed");
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyAgentsPty({
			piBinary: PI_BIN,
			packagePath: join(root, "packages/pi-stuff"),
			columns,
			rows,
		});
	}
	console.log("Certified Agents in 100x32 and 64x28 PTYs");
}
