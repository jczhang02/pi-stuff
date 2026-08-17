import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/tools-pty-provider.ts");
const runner = join(root, "test/fixtures/tools-pty-runner.sh");
const activeParityRunner = join(root, "test/fixtures/tools-active-parity-runner.sh");
const BUILTINS = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
const LONG_READ_DIRECTORY = "pi-max-tools-019fc372-d606-77ef-b3d5-59ba054c8d1a/deep";

export interface ToolsPtyVerificationOptions {
	readonly piBinary: string;
	readonly packagePath: string;
	readonly columns: number;
	readonly rows: number;
}

interface RequestRecord {
	readonly completed?: unknown;
	readonly tools?: unknown;
}

function expectProgram(): string {
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

spawn -noecho script -qefc $env(PI_STUFF_TOOLS_PTY_RUNNER) /dev/null
set tool_pty $spawn_out(slave,name)
must_expect "TOOLS_DONE"
after 200
send -- "\\017"
must_expect "Tool output: expanded"
after 200
send -- "\\017"
after 100
send -- "/tools\\r"
must_expect "Tools"
must_expect "items"
must_expect "Searched 2 patterns, listed 1"
must_expect "Esc close"
send -- "\\033"
after 100
send -- "/tools tools-pty-4\\r"
must_expect "Tool activity details"
must_expect "PREFIX_CJK_工具"
must_expect "BASH_CJK_工具"
must_expect "Esc back"
send -- "r"
must_expect "Raw protocol"
must_expect "Call ID: tools-pty-4"
must_expect "Arguments"
send -- "\\033\\[6~"
must_expect "Result content"
send -- "\\033"
must_expect "Status: success"
send -- "\\033"
after 100
send -- "\\033"
after 100
send -- "/tools tools-pty-8\\r"
must_expect "Tool activity details"
must_expect "BUILTIN_FAILURE_工具"
must_expect "Esc back"
send -- "\\033"
after 100
send -- "\\033"
after 100
send -- "/ui\\r"
must_expect "UI"
must_expect "Tool running timer"
must_expect "true"
must_expect "Enter/Space to change"
send -- "timer"
after 150
send -- "\\033"
after 100
send -- "/reload\\r"
must_expect "Reloaded keybindings, extensions"
must_expect "context files"
set resized_columns [expr {$env(PI_STUFF_TOOLS_PTY_COLUMNS) + 1}]
stty rows $env(PI_STUFF_TOOLS_PTY_ROWS) columns $resized_columns < $tool_pty
must_expect "Searched 2 patterns, listed 1 directory"
stty rows $env(PI_STUFF_TOOLS_PTY_ROWS) columns $env(PI_STUFF_TOOLS_PTY_COLUMNS) < $tool_pty
after 150
send -- "/tools\\r"
must_expect "Tools"
must_expect "items"
send -- "\\033"
after 150
send -- "DRAFT_AFTER_TOOLS"
must_expect "DRAFT_AFTER_TOOLS"
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

function activeParityExpectProgram(): string {
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

spawn -noecho script -qefc $env(PI_STUFF_TOOLS_ACTIVE_RUNNER) /dev/null
must_expect "TOOLS_PROBE_DONE"
send -- "/reload\\r"
must_expect "Reloaded keybindings, extensions"
must_expect "context files"
send -- "probe after reload\\r"
must_expect "TOOLS_PROBE_DONE"
send -- "\\004"
expect {
    eof {}
    timeout {
        puts stderr "Timed out waiting for Pi parity probe to exit"
        exit 4
    }
}
`;
}

function fail(message: string): never {
	throw new Error(`Tools PTY verification failed: ${message}`);
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

function verifyOutput(output: string, columns: number): void {
	if (output.includes("\u001b]0;OWNED_TITLE") || output.includes("\u009dC1_TITLE")) {
		fail("model-visible terminal controls reached the terminal");
	}
	const visible = stripTerminalControls(output);
	verifyLifecycleFrames(visible);
	for (const required of [
		"TOOLS_DONE",
		"• TOOLS_DONE",
		"• Read 1 file",
		"• Write written.txt",
		"• Edit written.txt",
		"• Searched 2 patterns, listed 1 directory",
		"• List",
		"• Bash",
		"• Edit written.txt · +1/-1",
		"• State error · working",
		"• State error · error",
		"• Bash(printf '",
		"⎿  PREFIX_CJK_工具",
		"⎿  Error: Exit code 7",
		"BUILTIN_FAILURE_工具",
		"State error",
		"State rejected",
		"State cancelled",
		"Tools",
		"Tool activity details",
		"Raw protocol",
		"Call ID: tools-pty-4",
		"Arguments",
		"Result content",
		"PREFIX_CJK_工具",
		"BASH_CJK_工具",
		"BUILTIN_FAILURE_工具",
		"FIXTURE_ERROR",
		"FIXTURE_REJECTED",
		"FIXTURE_CANCELLED",
		"UI",
		"Tool running timer",
		"→ Tool running timer",
		"Esc back",
		"Esc close",
		"DRAFT_AFTER_TOOLS",
	]) {
		if (!visible.includes(required)) fail(`terminal output is missing ${required}`);
	}
	if (!visible.includes("─".repeat(columns))) fail(`Tool dialog did not render a ${String(columns)}-column divider`);
	if (!/• Read pi-max-tools-[^\n]* · 1 lines/u.test(visible)) {
		fail("long Tool target did not retain a semantic boundary before its settled result");
	}
	if (/pi-max-tools-[^\n]*…[ \t]+1 lines/u.test(visible)) {
		fail("long Tool target joined its ellipsis directly to the settled result");
	}
}

function verifyLifecycleFrames(visible: string): void {
	const running = "• State error · working";
	const settled = "• State error · error";
	const runningFrame = visible.indexOf(running);
	const settledFrame = visible.indexOf(settled, runningFrame + running.length);
	if (runningFrame < 0 || settledFrame < 0) {
		fail("independent Tool row did not expose its active and settled states");
	}
	const firstRetrieval = visible.indexOf("• Read 1 file");
	const modification = visible.indexOf("• Write written.txt", firstRetrieval + 1);
	const secondRetrieval = visible.indexOf("• Searched 2 patterns, listed 1 directory", modification + 1);
	if (firstRetrieval < 0 || modification < 0 || secondRetrieval < 0) {
		fail("retrieval groups and their independent modification boundary lost source order");
	}
	const activeRetrieval = visible.indexOf("• Searching 1 pattern", secondRetrieval + 1);
	const settledRetrieval = visible.indexOf("• Searched 1 pattern", activeRetrieval + 1);
	if (activeRetrieval < 0 || settledRetrieval < 0) {
		fail("retrieval group did not expose its active and settled states");
	}
	const firstBash = visible.indexOf("⎿  PREFIX_CJK_工具");
	const failedBash = visible.indexOf("⎿  Error: Exit code 7", firstBash + 1);
	if (firstBash < 0 || failedBash < 0 || firstBash >= failedBash) {
		fail("standalone Bash operation blocks did not retain source order or child output");
	}
}

function verifyRequests(records: readonly RequestRecord[]): void {
	const requestCount = 13;
	if (records.length !== requestCount) {
		fail(`expected ${String(requestCount)} model requests, received ${String(records.length)}`);
	}
	for (const [index, record] of records.entries()) {
		if (record.completed !== index) fail(`request ${String(index)} observed the wrong completion count`);
		if (!Array.isArray(record.tools)) fail(`request ${String(index)} did not expose tools`);
		for (const name of BUILTINS) {
			if (!record.tools.includes(name)) fail(`request ${String(index)} did not preserve the ${name} tool`);
		}
	}
}

function verifyHostVersion(piBinary: string): void {
	const result = Bun.spawnSync([piBinary, "--version"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const version = result.stdout.toString().trim();
	if (result.exitCode !== 0 || version !== CERTIFIED_PI_VERSION) {
		fail(`expected Pi ${CERTIFIED_PI_VERSION}, received ${version || `exit ${String(result.exitCode)}`}`);
	}
}

export async function verifyActiveToolParity(options: {
	readonly packagePath: string;
	readonly piBinary: string;
}): Promise<void> {
	verifyHostVersion(options.piBinary);
	for (const fixture of [
		{
			args: [] as string[],
			expected: ["bash", "edit", "read", "write"],
			name: "Host defaults",
		},
		{
			args: ["--no-builtin-tools"],
			expected: [],
			name: "--no-builtin-tools",
		},
		{
			args: ["--tools", "grep,find,ls"],
			expected: ["find", "grep", "ls"],
			name: "explicit allowlist",
		},
	]) {
		const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-tools-active-"));
		const configDirectory = join(temporaryDirectory, "config");
		const sessionDirectory = join(temporaryDirectory, "sessions");
		const requestLog = join(temporaryDirectory, "requests.jsonl");
		await Promise.all([mkdir(configDirectory), mkdir(sessionDirectory)]);
		await writeFile(
			join(configDirectory, "settings.json"),
			`${JSON.stringify({ defaultProjectTrust: "always" }, null, "\t")}\n`,
			{ mode: 0o600 },
		);
		try {
			const result = Bun.spawnSync(["expect", "-c", activeParityExpectProgram()], {
				cwd: temporaryDirectory,
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: configDirectory,
					PI_STUFF_TOOLS_ACTIVE_MODE:
						fixture.args.length === 0
							? "default"
							: fixture.args[0] === "--no-builtin-tools"
								? "none"
								: "allowlist",
					PI_STUFF_TOOLS_ACTIVE_RUNNER: activeParityRunner,
					PI_STUFF_TOOLS_PTY_BIN: options.piBinary,
					PI_STUFF_TOOLS_PTY_LOG: requestLog,
					PI_STUFF_TOOLS_PTY_PACKAGE: resolve(options.packagePath),
					PI_STUFF_TOOLS_PTY_PROBE_ONLY: "1",
					PI_STUFF_TOOLS_PTY_PROVIDER_EXTENSION: providerExtension,
					PI_STUFF_TOOLS_PTY_SESSIONS: sessionDirectory,
					PI_STUFF_TOOLS_PTY_SESSION_ID: `tools-active-${fixture.name.replace(/\W+/gu, "-")}`,
					SHELL: "/bin/sh",
					TERM: "xterm-256color",
				},
				stderr: "pipe",
				stdout: "pipe",
			});
			if (result.exitCode !== 0) {
				fail(
					`${fixture.name} reload parity probe failed: ${result.stderr.toString().trim()}\nPTY tail:\n${result.stdout.toString().slice(-8_000)}`,
				);
			}
			const records = (await readFile(requestLog, "utf8"))
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as RequestRecord);
			if (records.length !== 2) {
				fail(`${fixture.name} reload parity probe expected two model requests; received ${String(records.length)}`);
			}
			for (const [index, record] of records.entries()) {
				if (!Array.isArray(record.tools)) fail(`${fixture.name} request ${String(index + 1)} did not expose tools`);
				const builtins = record.tools.filter(
					(name): name is string => typeof name === "string" && (BUILTINS as readonly string[]).includes(name),
				);
				expectEqualStrings(builtins, fixture.expected, `${fixture.name} request ${String(index + 1)}`);
			}
		} finally {
			await rm(temporaryDirectory, { force: true, recursive: true });
		}
	}
}

function expectEqualStrings(actual: readonly string[], expected: readonly string[], label: string): void {
	const normalizedActual = [...actual].sort();
	const normalizedExpected = [...expected].sort();
	if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
		fail(
			`${label} changed active built-ins: expected ${normalizedExpected.join(", ") || "none"}; received ${normalizedActual.join(", ") || "none"}`,
		);
	}
}

export async function verifyToolsPty(options: ToolsPtyVerificationOptions): Promise<void> {
	verifyHostVersion(options.piBinary);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-tools-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	const shellEvidence = join(temporaryDirectory, "shell-path-used.log");
	const shellWrapper = join(temporaryDirectory, "fixture-shell.sh");
	const projectConfigDirectory = join(temporaryDirectory, ".pi");
	await Promise.all([
		mkdir(configDirectory),
		mkdir(sessionDirectory),
		mkdir(projectConfigDirectory),
		mkdir(join(temporaryDirectory, LONG_READ_DIRECTORY), { recursive: true }),
	]);
	await writeFile(join(temporaryDirectory, LONG_READ_DIRECTORY, "sample-工具.txt"), "输入内容\n", { mode: 0o600 });
	await writeFile(shellWrapper, `#!/bin/sh\nprintf 'SHELL_PATH_USED\\n' >> '${shellEvidence}'\nexec /bin/sh "$@"\n`, {
		mode: 0o700,
	});
	await chmod(shellWrapper, 0o700);
	await writeFile(
		join(configDirectory, "settings.json"),
		`${JSON.stringify({ defaultProjectTrust: "always", images: { autoResize: false }, shellPath: shellWrapper }, null, "\t")}\n`,
		{ mode: 0o600 },
	);
	await writeFile(
		join(projectConfigDirectory, "settings.json"),
		`${JSON.stringify({ shellCommandPrefix: "printf 'PREFIX_CJK_工具\\n';" }, null, "\t")}\n`,
		{ mode: 0o600 },
	);

	try {
		const result = Bun.spawnSync(["expect", "-c", expectProgram()], {
			cwd: temporaryDirectory,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: configDirectory,
				PI_STUFF_TOOLS_PTY_BIN: options.piBinary,
				PI_STUFF_TOOLS_PTY_COLUMNS: String(options.columns),
				PI_STUFF_TOOLS_PTY_LOG: requestLog,
				PI_STUFF_TOOLS_PTY_PACKAGE: resolve(options.packagePath),
				PI_STUFF_TOOLS_PTY_PROVIDER_EXTENSION: providerExtension,
				PI_STUFF_TOOLS_PTY_ROWS: String(options.rows),
				PI_STUFF_TOOLS_PTY_RUNNER: runner,
				PI_STUFF_TOOLS_PTY_SESSIONS: sessionDirectory,
				PI_STUFF_TOOLS_PTY_SESSION_ID: `tools-pty-${String(options.columns)}x${String(options.rows)}`,
				SHELL: "/bin/sh",
				TERM: "xterm-256color",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = result.stdout.toString();
		if (result.exitCode !== 0) {
			const log = await readFile(requestLog, "utf8").catch(() => "(request log unavailable)");
			fail(
				`${result.stderr.toString().trim() || `expect exited ${String(result.exitCode)}`}\nRequests:\n${log}\nPTY tail:\n${output.slice(-12_000)}`,
			);
		}
		try {
			verifyOutput(output, options.columns);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${message}\nPTY tail:\n${output.slice(-12_000)}`, {
				cause: error,
			});
		}
		const records = (await readFile(requestLog, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as RequestRecord);
		verifyRequests(records);
		if ((await readFile(join(temporaryDirectory, "written.txt"), "utf8")) !== "新内容\nsecond line\n") {
			fail("the original Host edit execution contract changed");
		}
		if (!(await readFile(shellEvidence, "utf8")).includes("SHELL_PATH_USED")) {
			fail("the configured Host shellPath was not used by Bash execution");
		}
		const sessions = (await readdir(sessionDirectory)).filter((entry) => entry.endsWith(".jsonl"));
		if (sessions.length !== 1 || !sessions[0]) fail("expected exactly one isolated session");
		const transcript = await readFile(join(sessionDirectory, sessions[0]), "utf8");
		for (const required of [
			"OWNED_TITLE",
			"PREFIX_CJK_工具",
			"BASH_CJK_工具",
			"BUILTIN_FAILURE_工具",
			"FIXTURE_SEARCH",
			"FIXTURE_ERROR",
			"FIXTURE_REJECTED",
			"FIXTURE_CANCELLED",
			...BUILTINS,
		]) {
			if (!transcript.includes(required)) fail(`model-visible transcript is missing ${required}`);
		}
		if (transcript.includes("DRAFT_AFTER_TOOLS")) fail("Command Dialog draft text leaked into the transcript");
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	await verifyActiveToolParity({
		piBinary: PI_BIN,
		packagePath: join(root, "packages/pi-stuff"),
	});
	for (const [columns, rows] of [
		[100, 32],
		[64, 28],
	] as const) {
		await verifyToolsPty({
			piBinary: PI_BIN,
			packagePath: join(root, "packages/pi-stuff"),
			columns,
			rows,
		});
	}
	console.log("Certified Tool UI in 100x32 and 64x28 PTYs");
}
