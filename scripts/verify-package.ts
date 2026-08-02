import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runPiRpcSmoke } from "./smoke-pi.ts";

const CERTIFIED_PI_VERSION = "0.83.0";
const DEVELOPMENT_ARCHIVE_FILE = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|tsconfig(?:\.[^/]+)?\.json)$/;
const root = resolve(import.meta.dir, "..");
const aggregateDirectory = join(root, "packages", "pi-stuff");

export interface PackageArchiveManifest {
	bundledDependencies?: unknown;
	files?: unknown;
}

function readStringArray(value: unknown, field: string, allowEmpty: boolean): string[] {
	if (
		!Array.isArray(value) ||
		(!allowEmpty && value.length === 0) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new Error(`Package manifest ${field} must be ${allowEmpty ? "an" : "a non-empty"} array of strings`);
	}
	return value as string[];
}

function normalizedFilesEntry(entry: string): string {
	const normalized = entry.replace(/^\.\//, "");
	if (
		normalized.length === 0 ||
		normalized.startsWith("/") ||
		normalized.includes("\\") ||
		normalized.split("/").includes("..")
	) {
		throw new Error(`Invalid Package files entry: ${entry}`);
	}
	return normalized;
}

function matchesFilesEntry(entry: string, path: string): boolean {
	const normalized = normalizedFilesEntry(entry);
	if (normalized.endsWith("/")) return path.startsWith(normalized);
	if (!/[*?[\]{}]/.test(normalized)) return path === normalized;
	return new Bun.Glob(normalized).match(path);
}

function isAllowedPackageFile(path: string, files: readonly string[]): boolean {
	const included = files.some((entry) => !entry.startsWith("!") && matchesFilesEntry(entry, path));
	const excluded = files.some((entry) => entry.startsWith("!") && matchesFilesEntry(entry.slice(1), path));
	return included && !excluded;
}

function readBundledDependencies(value: unknown): string[] {
	const dependencies = value === undefined ? [] : readStringArray(value, "bundledDependencies", true);
	const packageName = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/;
	if (new Set(dependencies).size !== dependencies.length || dependencies.some((entry) => !packageName.test(entry))) {
		throw new Error("Package manifest bundledDependencies contains an invalid or duplicate package name");
	}
	return dependencies;
}

export function verifyPackageArchive(manifest: PackageArchiveManifest, archiveFiles: readonly string[]): void {
	const files = readStringArray(manifest.files, "files", false);
	if (!files.some((entry) => !entry.startsWith("!"))) {
		throw new Error("Package manifest files must contain at least one included entry");
	}
	for (const entry of files) {
		normalizedFilesEntry(entry.startsWith("!") ? entry.slice(1) : entry);
	}
	const bundledDependencies = readBundledDependencies(manifest.bundledDependencies);
	const archiveSet = new Set(archiveFiles);
	if (!archiveSet.has("package/package.json")) {
		throw new Error("Package archive is missing package/package.json");
	}

	for (const entry of files) {
		if (entry.startsWith("!")) continue;
		const normalized = normalizedFilesEntry(entry);
		if (!normalized.endsWith("/") && !/[*?[\]{}]/.test(normalized)) {
			const expectedPath = `package/${normalized}`;
			if (!archiveSet.has(expectedPath)) {
				throw new Error(`Package archive is missing declared file: ${expectedPath}`);
			}
		}
	}

	const bundledPrefixes = bundledDependencies.map((dependency) => `node_modules/${dependency}/`);
	for (const prefix of bundledPrefixes) {
		const packageManifest = `package/${prefix}package.json`;
		if (!archiveSet.has(packageManifest)) {
			throw new Error(`Package archive is missing bundled dependency manifest: ${packageManifest}`);
		}
	}
	const bundledDevelopmentFiles = archiveFiles.filter((archivePath) => {
		if (!archivePath.startsWith("package/")) return false;
		const relativePath = archivePath.slice("package/".length);
		return (
			bundledPrefixes.some((prefix) => relativePath.startsWith(prefix)) &&
			DEVELOPMENT_ARCHIVE_FILE.test(relativePath)
		);
	});
	if (bundledDevelopmentFiles.length > 0) {
		throw new Error(`Bundled Package contains development-only files:\n${bundledDevelopmentFiles.sort().join("\n")}`);
	}

	const unexpected = archiveFiles.filter((archivePath) => {
		if (!archivePath.startsWith("package/")) return true;
		const relativePath = archivePath.slice("package/".length);
		if (relativePath === "package.json") return false;
		if (bundledPrefixes.some((prefix) => relativePath.startsWith(prefix))) return false;
		return !isAllowedPackageFile(relativePath, files);
	});
	if (unexpected.length > 0) {
		throw new Error(`Unexpected Package archive files:\n${[...unexpected].sort().join("\n")}`);
	}
}

function run(command: readonly string[], cwd: string, env: Record<string, string | undefined> = process.env): string {
	const result = Bun.spawnSync([...command], { cwd, env, stdout: "pipe", stderr: "pipe" });
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

async function main(): Promise<void> {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	const piBinary = PI_BIN;
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-package-"));

	try {
		verifyPiVersion(piBinary);
		await runPiRpcSmoke({ piBinary, packages: [aggregateDirectory] });

		const bunTemporaryDirectory = join(temporaryDirectory, "bun-tmp");
		const bunInstallDirectory = join(temporaryDirectory, "bun-install");
		const bunCacheDirectory = join(temporaryDirectory, "bun-cache");
		await Promise.all([mkdir(bunTemporaryDirectory), mkdir(bunInstallDirectory), mkdir(bunCacheDirectory)]);
		const bunEnvironment = {
			...process.env,
			BUN_INSTALL: bunInstallDirectory,
			BUN_INSTALL_CACHE_DIR: bunCacheDirectory,
			BUN_TMPDIR: bunTemporaryDirectory,
			TEMP: bunTemporaryDirectory,
			TMP: bunTemporaryDirectory,
			TMPDIR: bunTemporaryDirectory,
		};
		run(
			["bun", "pm", "pack", "--ignore-scripts", "--destination", temporaryDirectory, "--quiet"],
			aggregateDirectory,
			bunEnvironment,
		);
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
		const manifest = JSON.parse(
			await readFile(join(aggregateDirectory, "package.json"), "utf8"),
		) as PackageArchiveManifest;
		verifyPackageArchive(manifest, archiveFiles);

		const extractDirectory = join(temporaryDirectory, "extract");
		await mkdir(extractDirectory);
		run(["tar", "-xzf", archivePath, "-C", extractDirectory], root);
		await runPiRpcSmoke({ piBinary, packages: [join(extractDirectory, "package")] });
		console.log(`Certified @jczhang02/pi-stuff with Pi ${CERTIFIED_PI_VERSION}`);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	await main();
}
