import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

export const CERTIFIED_BUN_VERSION = "1.3.14";
if (Bun.version !== CERTIFIED_BUN_VERSION) {
	throw new Error(`Release tooling requires Bun ${CERTIFIED_BUN_VERSION}, received ${Bun.version}`);
}

const RELEASE_PACKAGES = [
	{ name: "@jczhang02/pi-stuff-ui", path: "packages/pi-stuff-ui" },
	{ name: "@jczhang02/pi-stuff-permissions", path: "packages/pi-stuff-permissions" },
	{ name: "@jczhang02/pi-stuff-agents", path: "packages/pi-stuff-agents" },
	{ name: "@jczhang02/pi-stuff-todo", path: "packages/pi-stuff-todo" },
	{ name: "@jczhang02/pi-stuff-btw", path: "packages/pi-stuff-btw" },
	{ name: "@jczhang02/pi-stuff", path: "packages/pi-stuff" },
] as const;

export const RELEASE_MANIFEST_FILENAME = "release-manifest.json";
export const RELEASE_VERIFICATION_FILENAME = "release-verification.json";
export const RELEASE_PACKAGE_NAMES = RELEASE_PACKAGES.map(({ name }) => name);

export interface PackedPackageArchive {
	readonly archivePath: string;
	readonly archivePaths: readonly string[];
	readonly integrity: string;
	readonly name: string;
	readonly sha256: string;
	readonly version: string;
}

export interface ReleaseArtifact {
	readonly archive: string;
	readonly integrity: string;
	readonly name: string;
	readonly sha256: string;
	readonly version: string;
}

export interface ReleaseManifest {
	readonly artifacts: readonly ReleaseArtifact[];
	readonly bunVersion: string;
	readonly packer: "bun pm pack";
	readonly schemaVersion: 1;
}

export interface ReleaseVerification {
	readonly bunVersion: string;
	readonly manifestSha256: string;
	readonly piVersion: string;
	readonly schemaVersion: 1;
	readonly verifier: "scripts/verify-package.ts";
}

export interface ReleaseArtifactSnapshot {
	readonly archivePaths: readonly string[];
	readonly directory: string;
}

interface PackageManifest {
	readonly name?: unknown;
	readonly version?: unknown;
}

function run(command: readonly string[], cwd: string, env: Record<string, string | undefined>): string {
	const result = Bun.spawnSync([...command], { cwd, env, stdout: "pipe", stderr: "pipe" });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(`${command[0]} failed with ${result.exitCode}: ${stderr.trim() || stdout.trim()}`);
	}
	return stdout;
}

function parsePackageManifest(value: PackageManifest, packageDirectory: string): { name: string; version: string } {
	if (typeof value.name !== "string" || value.name.length === 0) {
		throw new Error(`${packageDirectory} has no Package name`);
	}
	if (typeof value.version !== "string" || value.version.length === 0) {
		throw new Error(`${packageDirectory} has no Package version`);
	}
	return { name: value.name, version: value.version };
}

export function verifyReleaseArchivePaths(archivePaths: readonly string[]): void {
	if (archivePaths.length === 0) throw new Error("Release archive is empty");
	const seen = new Set<string>();
	for (const archivePath of archivePaths) {
		const segments = archivePath.split("/");
		if (
			segments.length < 2 ||
			segments[0] !== "package" ||
			archivePath.includes("\\") ||
			segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
		) {
			throw new Error(`Unsafe release archive path: ${archivePath}`);
		}
		if (seen.has(archivePath)) throw new Error(`Duplicate release archive path: ${archivePath}`);
		seen.add(archivePath);
	}
}

function hashesBytes(bytes: Uint8Array): { integrity: string; sha256: string } {
	return {
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

async function hashes(path: string): Promise<{ integrity: string; sha256: string }> {
	return hashesBytes(await readFile(path));
}

export async function sha256File(path: string): Promise<string> {
	return (await hashes(path)).sha256;
}

export async function packPackageArchive(
	packageDirectory: string,
	destination: string,
	environment: Record<string, string | undefined> = process.env,
): Promise<PackedPackageArchive> {
	await mkdir(destination, { recursive: true });
	const existing = await readdir(destination);
	if (existing.length > 0) throw new Error(`Package archive destination is not empty: ${destination}`);

	const manifest = parsePackageManifest(
		JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")) as PackageManifest,
		packageDirectory,
	);
	run(
		[process.execPath, "pm", "pack", "--ignore-scripts", "--destination", destination, "--quiet"],
		packageDirectory,
		environment,
	);
	const archives = (await readdir(destination)).filter((entry) => entry.endsWith(".tgz"));
	if (archives.length !== 1 || !archives[0]) {
		throw new Error(`Expected one archive for ${manifest.name}, found ${archives.length}`);
	}
	const archivePath = join(destination, archives[0]);
	const archivePaths = run(["tar", "-tzf", archivePath], root, environment).trim().split("\n").filter(Boolean);
	verifyReleaseArchivePaths(archivePaths);
	const archiveHashes = await hashes(archivePath);
	return {
		archivePath,
		archivePaths,
		integrity: archiveHashes.integrity,
		name: manifest.name,
		sha256: archiveHashes.sha256,
		version: manifest.version,
	};
}

export async function createReleaseArtifacts(
	destination: string,
	environment: Record<string, string | undefined> = process.env,
): Promise<ReleaseManifest> {
	const resolvedDestination = resolve(destination);
	await mkdir(resolvedDestination, { recursive: true });
	const existing = await readdir(resolvedDestination);
	if (existing.length > 0) throw new Error(`Release artifact destination is not empty: ${resolvedDestination}`);

	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-release-pack-"));
	const artifacts: ReleaseArtifact[] = [];
	try {
		for (const [index, expected] of RELEASE_PACKAGES.entries()) {
			const packed = await packPackageArchive(
				join(root, expected.path),
				join(temporaryDirectory, String(index)),
				environment,
			);
			if (packed.name !== expected.name) {
				throw new Error(`Release Package order mismatch: expected ${expected.name}, received ${packed.name}`);
			}
			const archive = basename(packed.archivePath);
			await copyFile(packed.archivePath, join(resolvedDestination, archive));
			artifacts.push({
				archive,
				integrity: packed.integrity,
				name: packed.name,
				sha256: packed.sha256,
				version: packed.version,
			});
		}
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}

	const manifest: ReleaseManifest = {
		artifacts,
		bunVersion: Bun.version,
		packer: "bun pm pack",
		schemaVersion: 1,
	};
	await writeFile(join(resolvedDestination, RELEASE_MANIFEST_FILENAME), `${JSON.stringify(manifest, null, "\t")}\n`, {
		flag: "wx",
	});
	return manifest;
}

function invalidManifest(message: string): never {
	throw new Error(`Invalid release manifest: ${message}`);
}

export async function readReleaseManifest(manifestPath: string): Promise<ReleaseManifest> {
	const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
	if (typeof value !== "object" || value === null) invalidManifest("expected an object");
	const manifest = value as Partial<ReleaseManifest>;
	if (manifest.schemaVersion !== 1 || manifest.packer !== "bun pm pack") {
		invalidManifest("unsupported schema or packer");
	}
	if (manifest.bunVersion !== Bun.version) {
		invalidManifest(`expected Bun ${Bun.version}, received ${String(manifest.bunVersion)}`);
	}
	if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== RELEASE_PACKAGE_NAMES.length) {
		invalidManifest(`expected ${RELEASE_PACKAGE_NAMES.length} artifacts`);
	}
	const archives = new Set<string>();
	for (const [index, expectedName] of RELEASE_PACKAGE_NAMES.entries()) {
		const artifact = manifest.artifacts[index];
		if (!artifact || artifact.name !== expectedName) invalidManifest(`artifact ${index} must be ${expectedName}`);
		if (typeof artifact.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(artifact.version)) {
			invalidManifest(`${expectedName} has an invalid version`);
		}
		if (
			typeof artifact.archive !== "string" ||
			basename(artifact.archive) !== artifact.archive ||
			!artifact.archive.endsWith(".tgz") ||
			archives.has(artifact.archive)
		) {
			invalidManifest(`${expectedName} has an invalid or duplicate archive name`);
		}
		if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) invalidManifest(`${expectedName} has an invalid SHA-256`);
		if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity)) {
			invalidManifest(`${expectedName} has an invalid integrity value`);
		}
		archives.add(artifact.archive);
	}
	return manifest as ReleaseManifest;
}

export function resolveReleaseArchive(destination: string, artifact: ReleaseArtifact): string {
	if (basename(artifact.archive) !== artifact.archive || !artifact.archive.endsWith(".tgz")) {
		throw new Error(`Invalid release archive name: ${artifact.archive}`);
	}
	const archivePath = resolve(destination, artifact.archive);
	if (relative(resolve(destination), archivePath).startsWith("..")) {
		throw new Error(`Release archive escapes its destination: ${artifact.archive}`);
	}
	return archivePath;
}

export async function verifyReleaseArtifactHash(destination: string, artifact: ReleaseArtifact): Promise<string> {
	const archivePath = resolveReleaseArchive(destination, artifact);
	const actual = await hashes(archivePath);
	if (actual.sha256 !== artifact.sha256 || actual.integrity !== artifact.integrity) {
		throw new Error(`Release artifact hash mismatch: ${artifact.archive}`);
	}
	return archivePath;
}

export async function createVerifiedReleaseSnapshot(
	destination: string,
	manifest: ReleaseManifest,
): Promise<ReleaseArtifactSnapshot> {
	const snapshotDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-release-publish-"));
	const archivePaths: string[] = [];
	try {
		for (const artifact of manifest.artifacts) {
			const sourcePath = resolveReleaseArchive(destination, artifact);
			const bytes = await readFile(sourcePath);
			const actual = hashesBytes(bytes);
			if (actual.sha256 !== artifact.sha256 || actual.integrity !== artifact.integrity) {
				throw new Error(`Release artifact hash mismatch: ${artifact.archive}`);
			}
			const snapshotPath = join(snapshotDirectory, artifact.archive);
			await writeFile(snapshotPath, bytes, { flag: "wx", mode: 0o400 });
			archivePaths.push(snapshotPath);
		}
		return { archivePaths, directory: snapshotDirectory };
	} catch (error) {
		await rm(snapshotDirectory, { recursive: true, force: true });
		throw error;
	}
}

export async function writeReleaseVerification(destination: string, piVersion: string): Promise<void> {
	const manifestPath = join(resolve(destination), RELEASE_MANIFEST_FILENAME);
	await readReleaseManifest(manifestPath);
	const verification: ReleaseVerification = {
		bunVersion: Bun.version,
		manifestSha256: await sha256File(manifestPath),
		piVersion,
		schemaVersion: 1,
		verifier: "scripts/verify-package.ts",
	};
	await writeFile(
		join(resolve(destination), RELEASE_VERIFICATION_FILENAME),
		`${JSON.stringify(verification, null, "\t")}\n`,
		{ flag: "wx" },
	);
}

export async function readVerifiedRelease(destination: string, piVersion: string): Promise<ReleaseManifest> {
	const resolvedDestination = resolve(destination);
	const manifestPath = join(resolvedDestination, RELEASE_MANIFEST_FILENAME);
	const manifest = await readReleaseManifest(manifestPath);
	const value: unknown = JSON.parse(await readFile(join(resolvedDestination, RELEASE_VERIFICATION_FILENAME), "utf8"));
	if (typeof value !== "object" || value === null) throw new Error("Invalid release verification: expected an object");
	const verification = value as Partial<ReleaseVerification>;
	if (
		verification.schemaVersion !== 1 ||
		verification.verifier !== "scripts/verify-package.ts" ||
		verification.bunVersion !== Bun.version ||
		verification.piVersion !== piVersion ||
		verification.manifestSha256 !== (await sha256File(manifestPath))
	) {
		throw new Error("Invalid release verification: certification does not match the manifest or toolchain");
	}
	const expectedFiles = new Set([
		RELEASE_MANIFEST_FILENAME,
		RELEASE_VERIFICATION_FILENAME,
		...manifest.artifacts.map((artifact) => artifact.archive),
	]);
	const actualFiles = await readdir(resolvedDestination);
	if (actualFiles.length !== expectedFiles.size || actualFiles.some((entry) => !expectedFiles.has(entry))) {
		throw new Error("Invalid release verification: artifact directory contains missing or unexpected files");
	}
	await Promise.all(manifest.artifacts.map((artifact) => verifyReleaseArtifactHash(resolvedDestination, artifact)));
	return manifest;
}
