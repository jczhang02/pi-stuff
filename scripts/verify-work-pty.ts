import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { processExists } from "../packages/pi-stuff/src/background-work/src/process.js";
import { disableSessionNamingForTest } from "./session-naming-test-settings.ts";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/work-pty-provider.ts");
const runner = join(root, "test/fixtures/work-pty-runner.sh");
const REQUEST_RECORD_SCHEMA = Type.Object(
	{
		monitorCompletedNotification: Type.Boolean(),
		monitorTimedOutNotification: Type.Boolean(),
		request: Type.Number(),
		tools: Type.Array(Type.String()),
	},
	{ additionalProperties: true },
);

function expectProgram(): string {
	return `
set timeout 25

proc must_expect {pattern} {
    expect {
        -exact $pattern {}
        timeout { puts stderr "Timed out waiting for: $pattern"; exit 2 }
        eof { puts stderr "Reached EOF while waiting for: $pattern"; exit 3 }
    }
}

spawn -noecho script -qefc $env(PI_STUFF_WORK_PTY_RUNNER) /dev/null
set work_pty $spawn_out(slave,name)
must_expect "foreground.pid; sleep 30"
after 200
send -- "\\002"
must_expect "CTRL_B_CONTINUED"
send -- "/tasks\r"
must_expect "Tasks"
must_expect "Shell"
must_expect "x stop"
send -- "x"
must_expect "No background work in this session."
send -- "\\033"
after 100
send -- "start monitor fixture\r"
must_expect "MAIN_CONTINUES"
send -- "/tasks\r"
must_expect "Tasks"
must_expect "Esc close"
send -- "\\033"
after 100
set narrow_columns 48
stty rows $env(PI_STUFF_WORK_PTY_ROWS) columns $narrow_columns < $work_pty
after 150
send -- "/tasks\r"
must_expect "Tasks"
must_expect "Esc close"
send -- "\r"
must_expect "Tasks / Shell"
must_expect "Esc back"
send -- "\\033"
must_expect "↑/↓ select"
after 100
send -- "\\033"
after 100
stty rows $env(PI_STUFF_WORK_PTY_ROWS) columns $env(PI_STUFF_WORK_PTY_COLUMNS) < $work_pty
exec touch release.flag
must_expect "MONITOR_RESUMED"
send -- "/reload\r"
must_expect "Reloaded keybindings, extensions"
must_expect "context files"
after 150
send -- "/tasks\r"
must_expect "No background work in this session."
must_expect "Esc close"
send -- "\\033"
after 100
send -- "DRAFT_AFTER_TASKS"
must_expect "DRAFT_AFTER_TASKS"
send -- "\\003"
after 100
send -- "\\004"
expect {
    eof {}
    timeout { puts stderr "Timed out waiting for Pi to exit"; exit 4 }
}
`;
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

function fail(message: string): never {
	throw new Error(`Background Work PTY verification failed: ${message}`);
}

async function processFrom(path: string): Promise<number> {
	const value = Number((await readFile(path, "utf-8")).trim());
	if (!Number.isSafeInteger(value) || value <= 0) fail(`invalid process fixture at ${path}`);
	return value;
}

export async function verifyWorkPty(options: {
	readonly columns: number;
	readonly packagePath: string;
	readonly piBinary: string;
	readonly rows: number;
}): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-work-pty-"));
	const configDirectory = join(temporaryDirectory, "config");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const requestLog = join(temporaryDirectory, "requests.jsonl");
	await Promise.all([mkdir(configDirectory), mkdir(sessionDirectory), chmod(runner, 0o755)]);
	await disableSessionNamingForTest(configDirectory);
	await writeFile(
		join(configDirectory, "settings.json"),
		`${JSON.stringify({ defaultProjectTrust: "always" }, null, "\t")}\n`,
		{ mode: 0o600 },
	);
	try {
		const result = Bun.spawnSync(["expect", "-c", expectProgram()], {
			cwd: temporaryDirectory,
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: configDirectory,
				PI_STUFF_WORK_PTY_BIN: options.piBinary,
				PI_STUFF_WORK_PTY_COLUMNS: String(options.columns),
				PI_STUFF_WORK_PTY_LOG: requestLog,
				PI_STUFF_WORK_PTY_PACKAGE: resolve(options.packagePath),
				PI_STUFF_WORK_PTY_PROVIDER_EXTENSION: providerExtension,
				PI_STUFF_WORK_PTY_ROWS: String(options.rows),
				PI_STUFF_WORK_PTY_RUNNER: runner,
				PI_STUFF_WORK_PTY_SESSIONS: sessionDirectory,
				PI_STUFF_WORK_PTY_SESSION_ID: "work-pty-session",
				SHELL: "/bin/sh",
				TERM: "xterm-256color",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		const output = result.stdout.toString();
		if (result.exitCode !== 0) {
			fail(`${result.stderr.toString().trim()}\nPTY tail:\n${output.slice(-12_000)}`);
		}
		const visible = stripTerminalControls(output);
		for (const expected of [
			"CTRL_B_CONTINUED",
			"MAIN_CONTINUES",
			"MONITOR_RESUMED",
			"Prepare monitored service",
			"Monitor",
			"Tasks",
			"Tasks / Shell",
			"No background work in this session.",
			"DRAFT_AFTER_TASKS",
		]) {
			if (!visible.includes(expected)) fail(`terminal output is missing ${expected}`);
		}
		for (const forbidden of ["<background-work-notification>", "<task id=", "UNEXPECTED_REQUEST_"]) {
			if (visible.includes(forbidden)) fail(`terminal output exposed ${forbidden}`);
		}
		const records = (await readFile(requestLog, "utf-8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const record = JSON.parse(line);
				if (!Check(REQUEST_RECORD_SCHEMA, record)) fail("provider log contains a malformed request record");
				return record;
			});
		if (records.length < 6) fail(`expected at least 6 model requests, received ${String(records.length)}`);
		for (const [index, record] of records.entries()) {
			if (record.request !== index) fail(`request sequence diverged at ${String(index)}`);
			for (const tool of ["background", "bash", "monitor"]) {
				if (!record.tools.includes(tool)) fail(`request ${String(index)} is missing ${tool}`);
			}
		}
		const resumed = [...records].reverse().find((record) => record.monitorCompletedNotification);
		if (!resumed || resumed.monitorTimedOutNotification) {
			fail(
				`Monitor resume did not carry a completed, non-timeout terminal notification: ${JSON.stringify(records)}`,
			);
		}
		for (const path of [join(temporaryDirectory, "foreground.pid"), join(temporaryDirectory, "background.pid")]) {
			const pid = await processFrom(path);
			if (processExists(pid)) fail(`Pi exit left process ${String(pid)} alive`);
		}
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	await verifyWorkPty({
		columns: 96,
		packagePath: resolve(root, "packages/pi-stuff"),
		piBinary: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
		rows: 30,
	});
}
