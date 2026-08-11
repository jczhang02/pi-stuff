import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { terminateDetachedProcessGroup } from "./detached-process.js";

const root = resolve(import.meta.dir, "..");
const providerExtension = join(root, "test/fixtures/work-monitor-matrix-provider.ts");
const TIMEOUT_MS = 20_000;

type Scenario = "cancel" | "command_failure" | "file_error" | "http_success" | "log_success" | "timeout";

const EXPECTED: Readonly<Record<Scenario, string>> = {
	cancel: "stopped",
	command_failure: "failed",
	file_error: "failed",
	http_success: "completed",
	log_success: "completed",
	timeout: "timed_out",
};

interface MatrixRecord {
	readonly phase?: unknown;
	readonly scenario?: unknown;
	readonly status?: unknown;
}

interface RpcRecord {
	readonly id?: unknown;
	readonly success?: unknown;
	readonly type?: unknown;
}

function fail(message: string): never {
	throw new Error(`Background Monitor matrix failed: ${message}`);
}

async function records(path: string): Promise<MatrixRecord[]> {
	const parsed: MatrixRecord[] = [];
	for (const line of (await readFile(path, "utf8").catch(() => "")).split("\n")) {
		if (!line) continue;
		try {
			parsed.push(JSON.parse(line) as MatrixRecord);
		} catch {
			// The writer may still be appending the final JSONL record while this poll runs.
		}
	}
	return parsed;
}

async function waitFor(predicate: () => Promise<boolean>, description: string): Promise<void> {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await Bun.sleep(20);
	}
	fail(`timed out waiting for ${description}`);
}

export async function verifyWorkMonitorMatrix(options: {
	readonly packagePath: string;
	readonly piBinary: string;
}): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-work-monitor-matrix-"));
	const agentDirectory = join(temporaryDirectory, "agent");
	const sessionDirectory = join(temporaryDirectory, "sessions");
	const matrixLog = join(temporaryDirectory, "matrix.jsonl");
	const monitoredLog = join(temporaryDirectory, "monitored.log");
	const server = Bun.serve({ fetch: () => new Response("READY"), hostname: "127.0.0.1", port: 0 });
	let child: ReturnType<typeof Bun.spawn> | undefined;
	try {
		await Promise.all([
			mkdir(agentDirectory),
			mkdir(sessionDirectory),
			writeFile(matrixLog, ""),
			writeFile(monitoredLog, "old\n"),
		]);
		await writeFile(
			join(agentDirectory, "settings.json"),
			`${JSON.stringify({ defaultProjectTrust: "always", packages: [resolve(options.packagePath)] }, null, "\t")}\n`,
			{ mode: 0o600 },
		);
		const spawned = Bun.spawn(
			[
				options.piBinary,
				"--mode",
				"rpc",
				"--offline",
				"--no-context-files",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				"--no-builtin-tools",
				"--no-approve",
				"--provider",
				"pi-stuff-work-monitor-matrix",
				"--model",
				"fixture-model",
				"--session-dir",
				sessionDirectory,
				"--extension",
				providerExtension,
			],
			{
				cwd: temporaryDirectory,
				detached: true,
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: agentDirectory,
					PI_OFFLINE: "1",
					PI_STUFF_WORK_MONITOR_HTTP_URL: server.url.toString(),
					PI_STUFF_WORK_MONITOR_LOG_PATH: monitoredLog,
					PI_STUFF_WORK_MONITOR_MATRIX_LOG: matrixLog,
					PI_TELEMETRY: "0",
					TERM: "dumb",
				},
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		child = spawned;
		const responses: RpcRecord[] = [];
		const reader = spawned.stdout.getReader();
		const reading = (async () => {
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const item = await reader.read();
				buffer += decoder.decode(item.value, { stream: !item.done });
				while (buffer.includes("\n")) {
					const newline = buffer.indexOf("\n");
					const line = buffer.slice(0, newline).trim();
					buffer = buffer.slice(newline + 1);
					if (line) responses.push(JSON.parse(line) as RpcRecord);
				}
				if (item.done) break;
			}
		})();

		for (const scenario of Object.keys(EXPECTED) as Scenario[]) {
			const requestId = `matrix-${scenario}`;
			spawned.stdin.write(
				`${JSON.stringify({ id: requestId, message: `WORK_MONITOR_SCENARIO:${scenario}`, type: "prompt" })}\n`,
			);
			await spawned.stdin.flush();
			await waitFor(
				async () =>
					responses.some(
						(record) => record.id === requestId && record.type === "response" && record.success === true,
					),
				`${scenario} prompt acceptance`,
			);
			await waitFor(
				async () =>
					(await records(matrixLog)).some(
						(record) => record.phase === "continued" && record.scenario === scenario,
					),
				`${scenario} non-blocking continuation`,
			);
			if (scenario === "log_success") await appendFile(monitoredLog, "READY\n");
			await waitFor(
				async () =>
					(await records(matrixLog)).some(
						(record) =>
							record.phase === "terminal" &&
							record.scenario === scenario &&
							record.status === EXPECTED[scenario],
					),
				`${scenario} terminal status ${EXPECTED[scenario]}`,
			);
			await Bun.sleep(100);
		}

		await terminateDetachedProcessGroup(spawned);
		await reading;
		const extensionError = responses.find((record) => record.type === "extension_error");
		if (extensionError) fail(`Pi reported an Extension error: ${JSON.stringify(extensionError)}`);
		const taskRoot = join(temporaryDirectory, ".pi", "tasks");
		const runtimeDirectories = (await readdir(taskRoot).catch(() => [] as string[])).filter((name) =>
			name.startsWith("pi-stuff-"),
		);
		if (runtimeDirectories.length > 0) fail(`Pi exit left runtime directories: ${runtimeDirectories.join(", ")}`);
	} finally {
		if (child) await terminateDetachedProcessGroup(child);
		server.stop(true);
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	await verifyWorkMonitorMatrix({
		packagePath: resolve(root, "packages/pi-stuff"),
		piBinary: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
	});
	console.log("Certified Background Monitor failure and success matrix in real Pi RPC");
}
