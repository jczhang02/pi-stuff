import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { CERTIFIED_PI_HOST_PROFILE, CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";
import {
	type ReleaseArtifact,
	readVerifiedRelease,
	resolveReleaseArchive,
	verifyReleaseArchivePaths,
} from "./release-artifacts.ts";
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.ts";

const AGGREGATE_PACKAGE_NAME = "@jczhang02/pi-stuff";
const DEFAULT_PI_BINARY = "/opt/pi-coding-agent/pi";

interface SettingsDocument {
	readonly packages?: unknown;
}

export interface CertifiedReleaseInstallOptions {
	readonly agentDirectory?: string;
	readonly piBinary?: string;
	readonly releaseDirectory: string;
}

export interface CertifiedReleaseInstallResult {
	readonly packagePath: string;
	readonly settingsBackup?: string;
	readonly settingsSource: string;
	readonly version: string;
}

function commandOutput(command: readonly string[], cwd: string, environment = process.env): string {
	const result = Bun.spawnSync([...command], { cwd, env: environment, stderr: "pipe", stdout: "pipe" });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(
			`${basename(command[0] ?? "command")} exited ${result.exitCode}: ${stderr.trim() || stdout.trim()}`,
		);
	}
	return stdout;
}

function missing(error: unknown): boolean {
	return error instanceof Error && "code" in error && Reflect.get(error, "code") === "ENOENT";
}

function assertSafeAgentDirectory(agentDirectory: string): void {
	const resolved = resolve(agentDirectory);
	if (resolved === parse(resolved).root || resolved === resolve(homedir())) {
		throw new Error(`Refusing broad Pi agent directory: ${resolved}`);
	}
}

function packageSource(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value !== "object" || value === null) return undefined;
	const source = Reflect.get(value, "source");
	return typeof source === "string" ? source : undefined;
}

async function localPackageName(source: string, agentDirectory: string): Promise<string | undefined> {
	if (/^(?:npm|git):/u.test(source) || /^https?:/u.test(source) || /^ssh:/u.test(source)) return undefined;
	try {
		const manifest = JSON.parse(await readFile(join(resolve(agentDirectory, source), "package.json"), "utf8")) as {
			name?: unknown;
		};
		return typeof manifest.name === "string" ? manifest.name : undefined;
	} catch {
		return undefined;
	}
}

async function configuredAggregateSources(settingsPath: string, agentDirectory: string): Promise<string[]> {
	let document: SettingsDocument;
	try {
		document = JSON.parse(await readFile(settingsPath, "utf8")) as SettingsDocument;
	} catch (error) {
		if (missing(error)) return [];
		throw new Error(`Cannot read existing Pi settings: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (document.packages === undefined) return [];
	if (!Array.isArray(document.packages)) throw new Error("Existing Pi settings packages must be an array");
	const sources: string[] = [];
	for (const entry of document.packages) {
		const source = packageSource(entry);
		if (!source) continue;
		if (/^npm:@jczhang02\/pi-stuff(?:@|$)/u.test(source)) {
			sources.push(source);
			continue;
		}
		if ((await localPackageName(source, agentDirectory)) === AGGREGATE_PACKAGE_NAME) sources.push(source);
	}
	return sources;
}

async function verifyExtractedPackage(packagePath: string, artifact: ReleaseArtifact): Promise<void> {
	const manifest = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
	};
	if (manifest.name !== AGGREGATE_PACKAGE_NAME || manifest.version !== artifact.version) {
		throw new Error(`Extracted Aggregate identity mismatch: ${String(manifest.name)}@${String(manifest.version)}`);
	}
}

async function treeDigest(root: string, directory = root): Promise<string> {
	const digest = createHash("sha256");
	for (const name of (await readdir(directory)).sort()) {
		const path = join(directory, name);
		const metadata = await lstat(path);
		const entry = relative(root, path);
		if (metadata.isDirectory()) {
			digest.update(`directory\0${entry}\0${String(metadata.mode & 0o111)}\0${await treeDigest(root, path)}\0`);
			continue;
		}
		if (metadata.isSymbolicLink()) {
			digest.update(`symlink\0${entry}\0${await readlink(path)}\0`);
			continue;
		}
		if (!metadata.isFile()) throw new Error(`Release contains unsupported filesystem entry: ${path}`);
		digest.update(`file\0${entry}\0${String(metadata.mode & 0o111)}\0`);
		digest.update(await readFile(path));
		digest.update("\0");
	}
	return digest.digest("hex");
}

async function verifyExistingRelease(
	releasesDirectory: string,
	releaseDirectory: string,
	archivePath: string,
	artifact: ReleaseArtifact,
): Promise<string> {
	const comparisonDirectory = await mkdtemp(join(releasesDirectory, ".pi-stuff-compare-"));
	try {
		commandOutput(
			["tar", "--extract", "--gzip", "--file", archivePath, "--directory", comparisonDirectory],
			releasesDirectory,
		);
		const expectedPackage = join(comparisonDirectory, "package");
		const packagePath = join(releaseDirectory, "package");
		await verifyExtractedPackage(expectedPackage, artifact);
		await verifyExtractedPackage(packagePath, artifact);
		if ((await treeDigest(expectedPackage)) !== (await treeDigest(packagePath))) {
			throw new Error(`Existing release content does not match its certified archive: ${releaseDirectory}`);
		}
		return packagePath;
	} finally {
		await rm(comparisonDirectory, { force: true, recursive: true });
	}
}

async function ensureExtractedRelease(
	releasesDirectory: string,
	archivePath: string,
	artifact: ReleaseArtifact,
): Promise<string> {
	const releaseName = `${artifact.version}-${artifact.sha256.slice(0, 12)}`;
	const releaseDirectory = join(releasesDirectory, releaseName);
	const packagePath = join(releaseDirectory, "package");
	try {
		const existing = await lstat(releaseDirectory);
		if (!existing.isDirectory()) throw new Error(`Release target is not a directory: ${releaseDirectory}`);
		return verifyExistingRelease(releasesDirectory, releaseDirectory, archivePath, artifact);
	} catch (error) {
		if (!missing(error)) throw error;
	}

	const stagingDirectory = await mkdtemp(join(releasesDirectory, ".pi-stuff-install-"));
	try {
		commandOutput(
			["tar", "--extract", "--gzip", "--file", archivePath, "--directory", stagingDirectory],
			releasesDirectory,
		);
		await verifyExtractedPackage(join(stagingDirectory, "package"), artifact);
		await rename(stagingDirectory, releaseDirectory);
		return packagePath;
	} catch (error) {
		await rm(stagingDirectory, { force: true, recursive: true });
		throw error;
	}
}

async function replaceSymlink(path: string, target: string): Promise<void> {
	const temporaryLink = join(dirname(path), `.pi-stuff-link-${String(process.pid)}-${String(Date.now())}`);
	await symlink(target, temporaryLink);
	try {
		await rename(temporaryLink, path);
	} catch (error) {
		await rm(temporaryLink, { force: true });
		throw error;
	}
}

async function restoreSettings(settingsPath: string, backupPath: string | undefined): Promise<void> {
	if (!backupPath) {
		await rm(settingsPath, { force: true });
		return;
	}
	const temporaryPath = `${settingsPath}.pi-stuff-rollback-${String(process.pid)}`;
	await copyFile(backupPath, temporaryPath);
	await rename(temporaryPath, settingsPath);
}

function piEnvironment(agentDirectory: string): Record<string, string | undefined> {
	return {
		...process.env,
		PI_CODING_AGENT_DIR: agentDirectory,
		PI_OFFLINE: "1",
		PI_TELEMETRY: "0",
	};
}

async function settingsBackup(settingsPath: string, agentDirectory: string): Promise<string | undefined> {
	try {
		await lstat(settingsPath);
	} catch (error) {
		if (missing(error)) return undefined;
		throw error;
	}
	const backupDirectory = join(agentDirectory, ".pi-stuff-backups");
	await mkdir(backupDirectory, { mode: 0o700, recursive: true });
	const path = join(backupDirectory, `settings-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.json`);
	await copyFile(settingsPath, path);
	return path;
}

function verifyPiVersion(piBinary: string, cwd: string): void {
	const version = commandOutput([piBinary, "--version"], cwd).trim();
	if (version !== CERTIFIED_PI_VERSION) {
		throw new Error(`Certified release requires Pi ${CERTIFIED_PI_VERSION}, received ${version}`);
	}
}

/** Explicit maintainer action: install one already-certified Aggregate through Pi's own Settings Layer. */
export async function installCertifiedRelease(
	options: CertifiedReleaseInstallOptions,
): Promise<CertifiedReleaseInstallResult> {
	const releaseDirectory = resolve(options.releaseDirectory);
	const agentDirectory = resolve(
		options.agentDirectory ?? process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent"),
	);
	const piBinary = resolve(options.piBinary ?? process.env["PI_BIN"] ?? DEFAULT_PI_BINARY);
	assertSafeAgentDirectory(agentDirectory);
	await mkdir(agentDirectory, { mode: 0o700, recursive: true });
	verifyPiVersion(piBinary, agentDirectory);
	await verifyPiHostProvenance(piBinary);

	const manifest = await readVerifiedRelease(releaseDirectory, CERTIFIED_PI_HOST_PROFILE);
	const artifact = manifest.artifacts.find(({ name }) => name === AGGREGATE_PACKAGE_NAME);
	if (!artifact) throw new Error("Certified release has no Aggregate Package");
	const archivePath = resolveReleaseArchive(releaseDirectory, artifact);
	const archivePaths = commandOutput(["tar", "--list", "--gzip", "--file", archivePath], releaseDirectory)
		.trim()
		.split("\n")
		.filter(Boolean);
	verifyReleaseArchivePaths(archivePaths);

	const packagesDirectory = join(agentDirectory, "packages");
	const releasesDirectory = join(packagesDirectory, "pi-stuff-releases");
	await mkdir(releasesDirectory, { mode: 0o700, recursive: true });
	const packagePath = await ensureExtractedRelease(releasesDirectory, archivePath, artifact);
	const stablePath = join(packagesDirectory, "pi-stuff-current");
	let previousLink: string | undefined;
	try {
		const current = await lstat(stablePath);
		if (!current.isSymbolicLink()) throw new Error(`Refusing to replace non-symlink path: ${stablePath}`);
		previousLink = await readlink(stablePath);
	} catch (error) {
		if (!missing(error)) throw error;
	}

	const settingsPath = join(agentDirectory, "settings.json");
	const priorSources = await configuredAggregateSources(settingsPath, agentDirectory);
	const backupPath = await settingsBackup(settingsPath, agentDirectory);
	const relativeTarget = relative(packagesDirectory, packagePath);
	await replaceSymlink(stablePath, relativeTarget);

	try {
		const environment = piEnvironment(agentDirectory);
		commandOutput([piBinary, "install", stablePath, "--no-approve"], agentDirectory, environment);
		for (const source of priorSources) {
			if (resolve(agentDirectory, source) === stablePath) continue;
			commandOutput([piBinary, "remove", source, "--no-approve"], agentDirectory, environment);
		}
		const installedSources = await configuredAggregateSources(settingsPath, agentDirectory);
		if (installedSources.length !== 1 || resolve(agentDirectory, installedSources[0] ?? "") !== stablePath) {
			throw new Error(`Pi did not persist exactly one stable Aggregate source: ${installedSources.join(", ")}`);
		}
		return {
			packagePath,
			...(backupPath ? { settingsBackup: backupPath } : {}),
			settingsSource: installedSources[0] ?? "",
			version: artifact.version,
		};
	} catch (error) {
		await restoreSettings(settingsPath, backupPath);
		if (previousLink === undefined) await rm(stablePath, { force: true });
		else await replaceSymlink(stablePath, previousLink);
		throw error;
	}
}

function parseArguments(arguments_: readonly string[]): CertifiedReleaseInstallOptions {
	let agentDirectory: string | undefined;
	let piBinary: string | undefined;
	let releaseDirectory: string | undefined;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument !== "--agent-dir" && argument !== "--pi-bin") {
			if (releaseDirectory)
				throw new Error("Usage: install-certified-release [release-dir] [--agent-dir path] [--pi-bin path]");
			releaseDirectory = argument;
			continue;
		}
		const value = arguments_[index + 1];
		if (!value) throw new Error(`${argument} requires a path`);
		if (argument === "--agent-dir") agentDirectory = value;
		else piBinary = value;
		index += 1;
	}
	return {
		...(agentDirectory ? { agentDirectory } : {}),
		...(piBinary ? { piBinary } : {}),
		releaseDirectory: releaseDirectory ?? resolve(import.meta.dir, "../.artifacts/release"),
	};
}

if (import.meta.main) {
	const result = await installCertifiedRelease(parseArguments(process.argv.slice(2)));
	console.log(`Installed ${AGGREGATE_PACKAGE_NAME}@${result.version} at ${result.packagePath}`);
	console.log(`Pi settings source: ${result.settingsSource}`);
	if (result.settingsBackup) console.log(`Previous settings backup: ${result.settingsBackup}`);
}
