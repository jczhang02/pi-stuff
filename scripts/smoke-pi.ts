import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isRuntimeObject, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { waitForDetachedProcess } from "./detached-process.js";

const RPC_REQUEST_ID = "pi-stuff-smoke";
const RPC_PROBE_ID = "pi-stuff-smoke-probe";
const DEFAULT_TIMEOUT_MS = 20_000;
const DIAGNOSTIC_TAIL_CHARACTERS = 4_096;

export interface PiRpcSmokeOptions {
	piBinary: string;
	extensions?: readonly string[];
	packages?: readonly string[];
	probeCommand?: string;
	cwd?: string;
	timeoutMs?: number;
}

export interface PiRpcSmokeResult {
	commandNames: string[];
	createdFiles: string[];
	stderr: string;
}

interface RpcObject {
	command?: unknown;
	commands?: unknown;
	data?: unknown;
	id?: unknown;
	name?: unknown;
	success?: unknown;
	type?: unknown;
	[key: string]: unknown;
}

function isRpcObject(value: unknown): value is RpcObject {
	return isRuntimeObject(value) && value !== null;
}

function parseJsonLines(stdout: string): RpcObject[] {
	return stdout
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => {
			const value: unknown = JSON.parse(line);
			if (!isRpcObject(value)) {
				throw new Error(`Pi emitted a non-object RPC record: ${line}`);
			}
			return value;
		});
}

function commandNames(response: RpcObject): string[] {
	const data = response.data;
	if (!isRpcObject(data) || !Array.isArray(data.commands)) {
		throw new Error("Pi get_commands response did not contain a commands array");
	}
	return data.commands.map((command) => {
		if (!isRpcObject(command) || !isRuntimeString(command.name)) {
			throw new Error("Pi get_commands returned an invalid command entry");
		}
		return command.name;
	});
}

function diagnosticTail(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) return "<empty>";
	const tail = trimmed.slice(-DIAGNOSTIC_TAIL_CHARACTERS);
	return JSON.stringify(tail.length === trimmed.length ? tail : `…${tail}`);
}

interface SmokeEnvironment {
	readonly [name: string]: string;
}

function isolatedEnvironment(temporaryDirectory: string): SmokeEnvironment {
	const { PATH: path } = process.env;
	if (!path) {
		throw new Error("PATH is required to start the Pi host");
	}
	return {
		HOME: join(temporaryDirectory, "home"),
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		NO_COLOR: "1",
		PATH: path,
		PI_CODING_AGENT_DIR: join(temporaryDirectory, "agent"),
		PI_OFFLINE: "1",
		PI_TELEMETRY: "0",
		TERM: "dumb",
		XDG_CACHE_HOME: join(temporaryDirectory, "cache"),
		XDG_CONFIG_HOME: join(temporaryDirectory, "config"),
		XDG_DATA_HOME: join(temporaryDirectory, "data"),
		XDG_STATE_HOME: join(temporaryDirectory, "state"),
	};
}

async function listFiles(root: string, directory = root): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(root, path)));
		} else {
			files.push(path.slice(root.length + 1));
		}
	}
	return files.sort();
}

export async function runPiRpcSmoke(options: PiRpcSmokeOptions): Promise<PiRpcSmokeResult> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-host-"));
	const extensions = options.extensions ?? [];
	const arguments_ = [
		options.piBinary,
		"--mode",
		"rpc",
		"--no-session",
		"--offline",
		"--no-context-files",
		...(options.packages && options.packages.length > 0 ? [] : ["--no-extensions"]),
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-builtin-tools",
		"--no-approve",
		...extensions.flatMap((extension) => ["--extension", extension]),
	];

	try {
		await Promise.all([
			mkdir(join(temporaryDirectory, "home"), { recursive: true }),
			mkdir(join(temporaryDirectory, "agent"), { recursive: true }),
		]);
		if (options.packages && options.packages.length > 0) {
			await writeFile(
				join(temporaryDirectory, "agent", "settings.json"),
				`${JSON.stringify({ packages: options.packages }, null, "\t")}\n`,
			);
		}
		const requests = [
			{ id: RPC_REQUEST_ID, type: "get_commands" },
			...(options.probeCommand ? [{ id: RPC_PROBE_ID, message: options.probeCommand, type: "prompt" }] : []),
		];
		const child = Bun.spawn(arguments_, {
			cwd: options.cwd ?? resolve(import.meta.dir, ".."),
			detached: true,
			env: isolatedEnvironment(temporaryDirectory),
			stdin: new Blob([`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`]),
			stdout: "pipe",
			stderr: "pipe",
		});

		const [{ exitCode, timedOut }, stdout, stderr] = await Promise.all([
			waitForDetachedProcess(child, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);

		if (timedOut) {
			throw new Error(
				`Pi RPC smoke timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms; ` +
					`stdout tail=${diagnosticTail(stdout)}; stderr tail=${diagnosticTail(stderr)}`,
			);
		}
		if (exitCode !== 0) {
			throw new Error(`Pi RPC smoke exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`);
		}
		if (stdout.includes("\x1b") || stdout.includes("\x07")) {
			throw new Error("Pi RPC output contained terminal notification control bytes");
		}
		const records = parseJsonLines(stdout);
		const extensionError = records.find((record) => record.type === "extension_error");
		if (extensionError) {
			throw new Error(`Pi reported an Extension error: ${JSON.stringify(extensionError)}`);
		}
		const response = records.find((record) => record.id === RPC_REQUEST_ID && record.command === "get_commands");
		if (response?.success !== true) {
			throw new Error(`Pi did not return a successful get_commands response: ${stdout.trim()}`);
		}
		if (options.probeCommand) {
			const probe = records.find((record) => record.id === RPC_PROBE_ID && record.command === "prompt");
			if (probe?.success !== true) {
				throw new Error(`Pi did not execute the RPC command probe: ${stdout.trim()}`);
			}
		}
		return { commandNames: commandNames(response), createdFiles: await listFiles(temporaryDirectory), stderr };
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}
