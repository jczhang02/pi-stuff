import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RPC_REQUEST_ID = "pi-stuff-smoke";
const DEFAULT_TIMEOUT_MS = 20_000;

export interface PiRpcSmokeOptions {
	piBinary: string;
	extensions?: readonly string[];
	packages?: readonly string[];
	cwd?: string;
	timeoutMs?: number;
}

export interface PiRpcSmokeResult {
	commandNames: string[];
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
	return typeof value === "object" && value !== null;
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
		if (!isRpcObject(command) || typeof command.name !== "string") {
			throw new Error("Pi get_commands returned an invalid command entry");
		}
		return command.name;
	});
}

function isolatedEnvironment(temporaryDirectory: string): Record<string, string> {
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
		const child = Bun.spawn(arguments_, {
			cwd: options.cwd ?? resolve(import.meta.dir, ".."),
			env: isolatedEnvironment(temporaryDirectory),
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		child.stdin.write(`${JSON.stringify({ id: RPC_REQUEST_ID, type: "get_commands" })}\n`);
		child.stdin.end();

		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill(9);
		}, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		clearTimeout(timeout);

		if (timedOut) {
			throw new Error(`Pi RPC smoke timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`);
		}
		if (exitCode !== 0) {
			throw new Error(`Pi RPC smoke exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`);
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
		return { commandNames: commandNames(response), stderr };
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}
