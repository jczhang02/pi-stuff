import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runPiRpcSmoke } from "./smoke-pi.ts";

const CERTIFIED_PI_VERSION = "0.83.0";
const EXPECTED_ARCHIVE_FILES = [
	"package/LICENSE",
	"package/README.md",
	"package/index.ts",
	"package/package.json",
] as const;
const root = resolve(import.meta.dir, "..");
const aggregateDirectory = join(root, "packages", "pi-stuff");

function run(command: readonly string[], cwd: string): string {
	const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(`${command[0]} failed with ${result.exitCode}: ${stderr.trim() || stdout.trim()}`);
	}
	return stdout;
}

function verifyPiVersion(piBinary: string): void {
	const version = run([piBinary, "--version"], root).trim();
	if (version !== CERTIFIED_PI_VERSION) {
		throw new Error(`Expected Pi ${CERTIFIED_PI_VERSION}, received ${version || "no version"}`);
	}
}

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
const piBinary = PI_BIN;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-package-"));

try {
	verifyPiVersion(piBinary);
	await runPiRpcSmoke({ piBinary, packages: [aggregateDirectory] });

	run(["bun", "pm", "pack", "--ignore-scripts", "--destination", temporaryDirectory, "--quiet"], aggregateDirectory);
	const archives = (await readdir(temporaryDirectory)).filter((entry) => entry.endsWith(".tgz"));
	if (archives.length !== 1) {
		throw new Error(`Expected one Package archive, found ${archives.length}`);
	}
	const archiveName = archives[0];
	if (!archiveName) {
		throw new Error("Package archive name was unavailable");
	}
	const archivePath = join(temporaryDirectory, archiveName);
	const archiveFiles = run(["tar", "-tzf", archivePath], root).trim().split("\n").sort();
	if (JSON.stringify(archiveFiles) !== JSON.stringify(EXPECTED_ARCHIVE_FILES)) {
		throw new Error(`Unexpected Package archive files:\n${archiveFiles.join("\n")}`);
	}

	const extractDirectory = join(temporaryDirectory, "extract");
	await mkdir(extractDirectory);
	run(["tar", "-xzf", archivePath, "-C", extractDirectory], root);
	await runPiRpcSmoke({ piBinary, packages: [join(extractDirectory, "package")] });
	console.log(`Certified @jczhang02/pi-stuff with Pi ${CERTIFIED_PI_VERSION}`);
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
