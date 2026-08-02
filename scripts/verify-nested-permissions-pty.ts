import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/nested-permissions-pty-provider.ts");
const runner = join(root, "test/fixtures/nested-permissions-pty-runner.sh");
const CERTIFIED_PI_VERSION = "0.83.0";

export interface NestedPermissionsPtyVerificationOptions {
	readonly piBinary: string;
	readonly packagePath: string;
}

interface LogRecord {
	readonly denied?: unknown;
	readonly depth?: unknown;
	readonly kind?: unknown;
	readonly text?: unknown;
}

function expectProgram(): string {
	return `
set timeout 45

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

spawn -noecho script -qefc $env(PI_STUFF_NESTED_PERMISSIONS_PTY_RUNNER) /dev/null
must_expect "NESTED_MAIN_NOT_BLOCKED"
send -- "NESTED_DRAFT_RESTORED"
must_expect "NESTED_DRAFT_RESTORED"
must_expect "Bash command · from"
must_expect "Allow this exact call once"
must_expect "Deny"
send -- "n"
must_expect "NESTED_DRAFT_RESTORED"
must_expect "Agent permission-child completed."
must_expect "CHILD_SAW_DENIAL"
must_expect "GRANDCHILD_DENIED"
must_expect "NESTED_MAIN_SAW_DENIAL"
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
	throw new Error(`Nested permissions PTY verification failed: ${message}`);
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
			/(?:status|result|events|output|stderr|transcript|request|review).*\.(?:json|jsonl|log|txt)$/i.test(entry),
		)
		.sort()
		.slice(0, 32);
	const sections: string[] = [];
	let remaining = 30_000;
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

function verifyTerminalOutput(output: string): void {
	const visible = stripTerminalControls(output);
	for (const required of [
		"NESTED_MAIN_NOT_BLOCKED",
		"NESTED_DRAFT_RESTORED",
		"Bash command · from",
		"Allow this exact call once",
		"Deny",
		"Agent permission-child completed.",
		"CHILD_SAW_DENIAL",
		"GRANDCHILD_DENIED",
		"NESTED_MAIN_SAW_DENIAL",
	]) {
		if (!visible.includes(required)) fail(`terminal output is missing ${required}`);
	}
	if (!visible.includes("─".repeat(64))) fail("root permission Command Dialog did not render a 64-column divider");
	for (const forbidden of [
		"GRANDCHILD_MISSING_DENIAL",
		"CHILD_MISSING_DENIAL",
		"Fleet",
		"statusline",
		"╭",
		"╮",
		"╰",
		"╯",
	]) {
		if (visible.includes(forbidden)) fail(`terminal output exposed forbidden state: ${forbidden}`);
	}
}

function verifyProviderLog(records: readonly LogRecord[]): void {
	const grandchild = records.find((record) => record.kind === "grandchild-result");
	const child = records.find((record) => record.kind === "child-result");
	const main = records.find((record) => record.kind === "main-result");
	if (grandchild?.denied !== true || child?.denied !== true || main?.denied !== true) {
		fail("grandchild, child, and main did not all observe the explicit denial");
	}
	if (typeof grandchild.text !== "string" || !/\b(?:denied|blocked|rejected|not approved)\b/i.test(grandchild.text)) {
		fail("the grandchild bash tool result did not contain a concrete denial");
	}
	const depths = records
		.filter((record) => record.kind === "request" && typeof record.depth === "number")
		.map((record) => record.depth);
	if (!depths.includes(0) || !depths.includes(1) || !depths.includes(2)) {
		fail("provider did not observe root, child, and grandchild model turns");
	}
}

export async function verifyNestedPermissionsPty(options: NestedPermissionsPtyVerificationOptions): Promise<void> {
	verifyHostVersion(options.piBinary);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-nested-permissions-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const agentsDirectory = join(configDirectory, "agents");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const projectDirectory = join(temporaryDirectory, "project");
	const outsideTarget = join(temporaryDirectory, "outside-victim");
	const protectedFile = join(outsideTarget, "protected.txt");
	const sentinel = join(temporaryDirectory, "destructive-command-executed");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	const command = `rm -rf -- ${outsideTarget} && printf executed > ${sentinel}`;
	await Promise.all([
		mkdir(agentsDirectory, { recursive: true }),
		mkdir(sessionDirectory),
		mkdir(projectDirectory),
		mkdir(outsideTarget),
	]);
	await Promise.all([
		writeFile(protectedFile, "protected\n", { mode: 0o600 }),
		writeFile(
			join(agentsDirectory, "permission-child.md"),
			`---
name: permission-child
description: Launch the deterministic permission grandchild.
model: pi-stuff-nested-permissions-pty/fixture-model
tools: subagent
extensions: ${providerExtension}
systemPromptMode: append
inheritProjectContext: false
inheritSkills: false
maxSubagentDepth: 3
---
Launch the permission-grandchild Agent and report its denial.
`,
			{ mode: 0o600 },
		),
		writeFile(
			join(agentsDirectory, "permission-grandchild.md"),
			`---
name: permission-grandchild
description: Trigger the deterministic destructive bash permission.
model: pi-stuff-nested-permissions-pty/fixture-model
tools: bash
extensions: ${providerExtension}
systemPromptMode: append
inheritProjectContext: false
inheritSkills: false
---
Attempt the supplied destructive command and report its denial.
`,
			{ mode: 0o600 },
		),
	]);

	try {
		const result = Bun.spawnSync(["expect", "-c", expectProgram()], {
			cwd: projectDirectory,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: configDirectory,
				PI_SUBAGENT_PI_BINARY: options.piBinary,
				PI_STUFF_NESTED_PERMISSIONS_PTY_BIN: options.piBinary,
				PI_STUFF_NESTED_PERMISSIONS_PTY_COLUMNS: "64",
				PI_STUFF_NESTED_PERMISSIONS_PTY_COMMAND: command,
				PI_STUFF_NESTED_PERMISSIONS_PTY_LOG: requestLog,
				PI_STUFF_NESTED_PERMISSIONS_PTY_PACKAGE: resolve(options.packagePath),
				PI_STUFF_NESTED_PERMISSIONS_PTY_PROVIDER_EXTENSION: providerExtension,
				PI_STUFF_NESTED_PERMISSIONS_PTY_ROWS: "28",
				PI_STUFF_NESTED_PERMISSIONS_PTY_RUNNER: runner,
				PI_STUFF_NESTED_PERMISSIONS_PTY_SESSIONS: sessionDirectory,
				PI_STUFF_NESTED_PERMISSIONS_PTY_SESSION_ID: "nested-permissions-pty-64x28",
				TERM: "xterm-256color",
				TMPDIR: temporaryDirectory,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = result.stdout.toString();
		if (result.exitCode !== 0) {
			const diagnostics = await readFailureDiagnostics(temporaryDirectory);
			const reason = result.stderr.toString().trim() || `expect exited ${result.exitCode}`;
			fail(`${reason}\nRuntime diagnostics:\n${diagnostics || "(none)"}\nPTY tail:\n${output.slice(-14_000)}`);
		}
		verifyTerminalOutput(output);

		const records = (await readFile(requestLog, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LogRecord);
		verifyProviderLog(records);
		const transcripts = (await readdir(sessionDirectory, { recursive: true }))
			.filter((entry) => entry.endsWith(".jsonl"))
			.map((entry) => join(sessionDirectory, entry));
		for (const transcript of transcripts) {
			const content = await readFile(transcript, "utf8");
			if (content.includes("NESTED_DRAFT_RESTORED")) fail("the restored editor draft leaked into a transcript");
			if (content.includes("ROOT_WAKE")) fail("the verification relied on a submitted wake-up message");
		}
		if (await pathExists(sentinel)) fail("the denied destructive command created its execution sentinel");
		if ((await readFile(protectedFile, "utf8")) !== "protected\n") {
			fail("the denied destructive command modified its outside-cwd target");
		}
		const forwardingRoot = join(configDirectory, "sessions", "permission-forwarding");
		const forwardingArtifacts = (
			await readdir(forwardingRoot, { recursive: true }).catch(() => [] as string[])
		).filter((entry) => entry.endsWith(".json"));
		if (forwardingArtifacts.length > 0) fail("permission forwarding request artifacts were not cleaned up");
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
		if (await pathExists(temporaryDirectory)) fail("temporary verification directory was not removed");
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	await verifyNestedPermissionsPty({ piBinary: PI_BIN, packagePath: join(root, "packages/pi-stuff") });
	console.log("Certified nested permission denial in a 64x28 PTY");
}
