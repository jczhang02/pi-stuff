import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { codeModeHostBinaryPath } from "../packages/pi-stuff/src/code-mode/host/binary.js";
import { waitForDetachedProcess } from "./detached-process.js";

const PI_BINARY = process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi";
const TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

async function assertCertifiedPi(): Promise<void> {
	const version = (await execFileAsync(PI_BINARY, ["--version"])).stdout.trim();
	if (version !== "0.84.1") throw new Error(`Code Mode acceptance requires Pi 0.84.1, got ${version || "unknown"}`);
}

async function files(directory: string): Promise<string[]> {
	const output: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) output.push(...(await files(path)));
		else output.push(path);
	}
	return output;
}

async function runPi(
	root: string,
	temporary: string,
	sessionId: string,
	mode: "resume" | "start",
): Promise<{ stderr: string; stdout: string }> {
	const arguments_ = [
		PI_BINARY,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-themes",
		"--offline",
		"--approve",
		"--provider",
		"pi-stuff-code-mode-fixture",
		"--model",
		"fixture",
		"--session-dir",
		join(temporary, "sessions"),
		mode === "start" ? "--session-id" : "--session",
		sessionId,
		"--extension",
		join(root, "packages", "pi-stuff", "index.ts"),
		"--extension",
		join(root, "test", "fixtures", "code-mode-provider.ts"),
		"--print",
		mode === "start" ? "CODE_MODE_EXECUTE" : "CODE_MODE_RESUME",
	];
	const child = Bun.spawn(arguments_, {
		cwd: join(temporary, "project"),
		detached: true,
		env: {
			...process.env,
			PI_CODING_AGENT_DIR: join(temporary, "agent"),
			PI_OFFLINE: "1",
			PI_STUFF_CODE_MODE_DEFAULT: "on",
			PI_STUFF_CODE_MODE_FIXTURE_LOG: join(temporary, "provider.jsonl"),
			PI_STUFF_CODE_MODE_HOST: codeModeHostBinaryPath(),
			PI_TELEMETRY: "0",
			XDG_CACHE_HOME: join(temporary, "cache"),
			XDG_CONFIG_HOME: join(temporary, "config"),
			XDG_DATA_HOME: join(temporary, "data"),
			XDG_STATE_HOME: join(temporary, "state"),
		},
		stderr: "pipe",
		stdout: "pipe",
	});
	const [{ exitCode, timedOut }, stdout, stderr] = await Promise.all([
		waitForDetachedProcess(child, TIMEOUT_MS),
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (timedOut) throw new Error(`Real Code Mode Pi run timed out after ${String(TIMEOUT_MS)} ms`);
	if (exitCode !== 0) throw new Error(`Real Code Mode Pi run exited ${String(exitCode)}: ${stderr || stdout}`);
	return { stderr, stdout };
}

function unexpectedStderr(value: string): string {
	return value
		.split("\n")
		.filter((line) => line.trim() && !line.startsWith("Warning: No project session found with id"))
		.join("\n");
}

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "pi-stuff-code-mode-real-"));
const sessionId = "019fdc00-0000-7000-8000-000000000001";
try {
	await assertCertifiedPi();
	await Promise.all([
		mkdir(join(temporary, "agent"), { recursive: true }),
		mkdir(join(temporary, "project"), { recursive: true }),
		mkdir(join(temporary, "sessions"), { recursive: true }),
	]);
	await writeFile(join(temporary, "agent", "settings.json"), "{}\n");
	await writeFile(join(temporary, "project", "README.md"), '<div align="center">\nCode Mode fixture\n');
	const started = await runPi(root, temporary, sessionId, "start");
	if (!started.stdout.includes("CODE_MODE_COMPLETE")) throw new Error(`Code Mode did not complete: ${started.stdout}`);
	if (!started.stdout.includes('"firstLine":"<div align=\\"center\\">"')) {
		throw new Error(`Code Mode did not execute the real Suite read Tool: ${started.stdout}`);
	}
	if (!started.stdout.includes('"typed":true'))
		throw new Error(`Code Mode describe contract failed: ${started.stdout}`);
	if (!started.stdout.includes('"context":true'))
		throw new Error(`Code Mode did not compose with the active Magic Context Tools: ${started.stdout}`);
	if (unexpectedStderr(started.stderr)) throw new Error(`Code Mode emitted stderr: ${started.stderr}`);

	const resumed = await runPi(root, temporary, sessionId, "resume");
	if (!resumed.stdout.includes("CODE_MODE_COMPLETE"))
		throw new Error(`Code Mode session did not resume: ${resumed.stdout}`);
	if (unexpectedStderr(resumed.stderr)) throw new Error(`Code Mode resume emitted stderr: ${resumed.stderr}`);

	const providerLog = await readFile(join(temporary, "provider.jsonl"), "utf8");
	for (const line of providerLog.trim().split("\n")) {
		const record = JSON.parse(line) as { toolNames?: unknown };
		if (JSON.stringify(record.toolNames) !== '["codemode"]') {
			throw new Error(`Provider saw a non-Code-Mode Tool surface: ${line}`);
		}
	}
	const sessionFiles = await files(join(temporary, "sessions"));
	const sessionText = (await Promise.all(sessionFiles.map((path) => readFile(path, "utf8")))).join("\n");
	if (!sessionText.includes('"kind":"pi-stuff-code-mode"'))
		throw new Error("Session did not persist Code Mode details");
	if (!sessionText.includes('"name":"read"')) throw new Error("Session did not persist the nested read operation");
	if (!sessionText.includes('"name":"bash"')) throw new Error("Session did not persist the nested Bash operation");
	if (!sessionText.includes('"name":"background"'))
		throw new Error("Session did not persist the nested Background Work operation");
	if (!sessionText.includes('"name":"subagent"'))
		throw new Error("Session did not persist the nested Agent operation");
	console.log("Real Pi 0.84.1 Code Mode execution and session reload passed");
} finally {
	await rm(temporary, { force: true, recursive: true });
}
