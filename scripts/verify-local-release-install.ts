import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installCertifiedRelease } from "./install-certified-release.ts";

const EXPECTED_COMMANDS = ["agents", "btw", "codex", "goal", "mcp", "rtk", "tools", "ui"] as const;
const RPC_REQUEST_ID = "pi-stuff-local-install";

interface RpcRecord {
	readonly command?: unknown;
	readonly data?: unknown;
	readonly id?: unknown;
	readonly success?: unknown;
	readonly type?: unknown;
}

function rpcCommands(stdout: string): string[] {
	const records = stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as RpcRecord);
	const extensionError = records.find(({ type }) => type === "extension_error");
	if (extensionError)
		throw new Error(`Installed Suite reported an Extension error: ${JSON.stringify(extensionError)}`);
	const response = records.find(({ command, id }) => command === "get_commands" && id === RPC_REQUEST_ID);
	if (response?.success !== true || typeof response.data !== "object" || response.data === null) {
		throw new Error(`Installed Suite returned no successful command inventory: ${stdout.trim()}`);
	}
	const commands = Reflect.get(response.data, "commands");
	if (!Array.isArray(commands)) throw new Error("Installed Suite command inventory is not an array");
	return commands.map((command) => {
		const name = typeof command === "object" && command !== null ? Reflect.get(command, "name") : undefined;
		if (typeof name !== "string") throw new Error("Installed Suite returned a command without a name");
		return name;
	});
}

async function startInstalledSuite(piBinary: string, agentDirectory: string, workspace: string): Promise<string[]> {
	const child = Bun.spawn(
		[
			piBinary,
			"--mode",
			"rpc",
			"--no-session",
			"--offline",
			"--no-context-files",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--no-builtin-tools",
			"--no-approve",
		],
		{
			cwd: workspace,
			env: {
				...process.env,
				HOME: join(workspace, ".home"),
				NO_COLOR: "1",
				PI_CODING_AGENT_DIR: agentDirectory,
				PI_OFFLINE: "1",
				PI_TELEMETRY: "0",
				TERM: "dumb",
			},
			stdin: new Blob([`${JSON.stringify({ id: RPC_REQUEST_ID, type: "get_commands" })}\n`]),
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const timeout = setTimeout(() => child.kill(9), 20_000);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	clearTimeout(timeout);
	if (exitCode !== 0) throw new Error(`Installed Suite startup exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
	return rpcCommands(stdout);
}

export async function verifyLocalReleaseInstall(releaseDirectory: string, piBinary: string): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-local-install-"));
	const agentDirectory = join(temporaryDirectory, "agent");
	const workspace = join(temporaryDirectory, "workspace");
	try {
		const legacyPackage = join(agentDirectory, "packages", "pi-stuff-legacy");
		await Promise.all([mkdir(workspace, { recursive: true }), mkdir(legacyPackage, { recursive: true })]);
		await Promise.all([
			writeFile(
				join(legacyPackage, "package.json"),
				`${JSON.stringify({ name: "@jczhang02/pi-stuff", version: "0.0.1" }, null, "\t")}\n`,
			),
			writeFile(
				join(agentDirectory, "settings.json"),
				`${JSON.stringify({ packages: ["packages/pi-stuff-legacy"] }, null, "\t")}\n`,
			),
		]);
		const first = await installCertifiedRelease({ agentDirectory, piBinary, releaseDirectory });
		if (!first.settingsBackup) throw new Error("Legacy Settings Layer migration created no recovery backup");
		const second = await installCertifiedRelease({ agentDirectory, piBinary, releaseDirectory });
		if ((await realpath(first.packagePath)) !== (await realpath(second.packagePath))) {
			throw new Error("Repeated installation selected different release directories");
		}
		const settings = JSON.parse(await readFile(join(agentDirectory, "settings.json"), "utf8")) as {
			packages?: unknown;
		};
		if (!Array.isArray(settings.packages) || settings.packages.length !== 1) {
			throw new Error("Repeated installation did not retain exactly one Package source");
		}
		const source = settings.packages[0];
		if (typeof source !== "string" || source.endsWith(".tgz") || !source.includes("pi-stuff-current")) {
			throw new Error(`Pi persisted an unsafe local release source: ${String(source)}`);
		}
		const commands = await startInstalledSuite(piBinary, agentDirectory, workspace);
		for (const command of EXPECTED_COMMANDS) {
			if (!commands.includes(command)) throw new Error(`Installed Suite did not register /${command}`);
		}
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	const releaseDirectory = resolve(process.argv[2] ?? resolve(import.meta.dir, "../.artifacts/release"));
	const piBinary = resolve(process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi");
	await verifyLocalReleaseInstall(releaseDirectory, piBinary);
	console.log("Certified release installed idempotently and loaded through the real Pi Settings Layer");
}
