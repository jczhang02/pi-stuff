import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
	CERTIFIED_PI_BUN_VERSION,
	CERTIFIED_PI_CHANGELOG_SHA256,
	CERTIFIED_PI_HOST_PROFILE,
	CERTIFIED_PI_INSTALLED_BINARY_SHA256,
	CERTIFIED_PI_MODEL_DATA_SHA256,
	CERTIFIED_PI_NODE_VERSION,
	CERTIFIED_PI_NPM_VERSION,
	CERTIFIED_PI_SOURCE_COMMIT,
	CERTIFIED_PI_SOURCE_FINGERPRINTS,
	CERTIFIED_PI_SOURCE_REPOSITORY,
} from "./pi-host-contract.ts";
import { verifyCertifiedPiModelData } from "./pi-host-model-data.ts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REPOSITORY_ROOT = resolve(import.meta.dir, "..");
const FACADE_BINARY_TARGET = "../current/linux-x64/pi";
const FACADE_ATTESTATION_TARGET = "pi-host/current/pi-host-attestation.json";

interface PiHostAttestation {
	readonly binarySha256: string;
	readonly modelDataSnapshotSha256: string;
	readonly repository: string;
	readonly schemaVersion: 2;
	readonly sourceCommit: string;
	readonly toolchain: {
		readonly bun: string;
		readonly node: string;
		readonly npm: string;
	};
}

export interface PiHostProvenance {
	readonly kind: "ci-workflow-attestation" | "installed-binary-allowlist" | "local-source-build-record";
	readonly profile: string;
}

interface ProvenanceEnvironment {
	readonly [name: string]: string | undefined;
	readonly CI?: string;
	readonly GITHUB_ACTIONS?: string;
	readonly GITHUB_WORKSPACE?: string;
	readonly PI_HOST_ATTESTATION?: string;
	readonly PI_HOST_SOURCE_CHECKOUT?: string;
}

function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function parseAttestation(value: unknown): PiHostAttestation {
	if (typeof value !== "object" || value === null) throw new Error("Pi Host attestation must be an object");
	const record = value as Partial<PiHostAttestation>;
	if (
		record.schemaVersion !== 2 ||
		record.repository !== CERTIFIED_PI_SOURCE_REPOSITORY ||
		record.sourceCommit !== CERTIFIED_PI_SOURCE_COMMIT ||
		record.modelDataSnapshotSha256 !== CERTIFIED_PI_MODEL_DATA_SHA256 ||
		record.toolchain?.bun !== CERTIFIED_PI_BUN_VERSION ||
		record.toolchain.node !== CERTIFIED_PI_NODE_VERSION ||
		record.toolchain.npm !== CERTIFIED_PI_NPM_VERSION ||
		typeof record.binarySha256 !== "string" ||
		!SHA256_PATTERN.test(record.binarySha256)
	) {
		throw new Error(`Pi Host build record does not identify ${CERTIFIED_PI_HOST_PROFILE}`);
	}
	return record as PiHostAttestation;
}

function workflowAttestationPath(environment: ProvenanceEnvironment): string | undefined {
	const attestationPath = environment.PI_HOST_ATTESTATION;
	if (!attestationPath) return undefined;
	if (environment.CI !== "true" && environment.GITHUB_ACTIONS !== "true") return undefined;
	const workspace = environment.GITHUB_WORKSPACE;
	if (environment.CI !== "true" || environment.GITHUB_ACTIONS !== "true" || !workspace) {
		throw new Error("PI_HOST_ATTESTATION requires the certified CI workflow environment");
	}
	const expectedPath = resolve(workspace, ".artifacts", "pi-host-attestation.json");
	if (resolve(attestationPath) !== expectedPath) {
		throw new Error("PI_HOST_ATTESTATION is outside the fixed CI workflow artifact path");
	}
	return expectedPath;
}

interface LocalSourceBuildPaths {
	readonly attestation: string;
	readonly binary: string;
	readonly source: string;
}

function localSourceBuildPaths(
	piBinary: string,
	environment: ProvenanceEnvironment,
): LocalSourceBuildPaths | undefined {
	const attestation = environment.PI_HOST_ATTESTATION;
	if (!attestation || environment.CI === "true" || environment.GITHUB_ACTIONS === "true") return undefined;
	const source = environment.PI_HOST_SOURCE_CHECKOUT;
	if (!source) throw new Error("Local PI_HOST_ATTESTATION requires PI_HOST_SOURCE_CHECKOUT");
	const expected = {
		attestation: join(REPOSITORY_ROOT, ".artifacts", "pi-host-attestation.json"),
		binary: join(REPOSITORY_ROOT, ".artifacts", "pi-host", "linux-x64", "pi"),
		source: join(REPOSITORY_ROOT, ".artifacts", "pi-source"),
	};
	if (
		resolve(attestation) !== expected.attestation ||
		resolve(piBinary) !== expected.binary ||
		resolve(source) !== expected.source
	) {
		throw new Error("Local Pi Host build inputs must use the fixed repository .artifacts paths");
	}
	return expected;
}

async function verifyBuildAttestation(piBinary: string, attestationPath: string): Promise<void> {
	const attestation = parseAttestation(JSON.parse(await readFile(resolve(attestationPath), "utf8")) as unknown);
	const binarySha256 = sha256(await readFile(await realpath(piBinary)));
	if (binarySha256 !== attestation.binarySha256) {
		throw new Error("Pi Host attestation binary hash does not match PI_BIN");
	}
}

interface PinnedPublishedPiHost {
	readonly attestation: string;
	readonly binary: string;
}

function isWithin(root: string, path: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}

async function requireFacadeLink(path: string, expectedTarget: string): Promise<void> {
	if (!(await lstat(path)).isSymbolicLink() || (await readlink(path)) !== expectedTarget) {
		throw new Error(`Pi Host facade is not pinned through the current generation: ${path}`);
	}
}

/** Reads current exactly once, then verifies binary and record from that immutable generation. */
async function pinPublishedPiHost(workspace: string): Promise<PinnedPublishedPiHost> {
	const artifacts = join(workspace, ".artifacts");
	const host = join(artifacts, "pi-host");
	const generations = join(artifacts, "pi-host-generations");
	const current = join(host, "current");
	await Promise.all([
		requireFacadeLink(join(host, "linux-x64", "pi"), FACADE_BINARY_TARGET),
		requireFacadeLink(join(artifacts, "pi-host-attestation.json"), FACADE_ATTESTATION_TARGET),
	]);
	if (!(await lstat(current)).isSymbolicLink()) throw new Error("Pi Host current generation pointer is not a symlink");
	const target = await readlink(current);
	if (isAbsolute(target)) throw new Error("Pi Host current generation pointer must be relative");
	const [generation, generationsRoot] = await Promise.all([realpath(resolve(host, target)), realpath(generations)]);
	if (!isWithin(generationsRoot, generation)) throw new Error("Pi Host current generation escapes immutable storage");
	return {
		attestation: join(generation, "pi-host-attestation.json"),
		binary: join(generation, "linux-x64", "pi"),
	};
}

async function sourceMapFiles(directory: string, prefix = ""): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
		const relativePath = join(prefix, entry.name);
		if (entry.isDirectory()) files.push(...(await sourceMapFiles(directory, relativePath)));
		else if (entry.isFile() && entry.name.endsWith(".map")) files.push(relativePath);
	}
	return files.sort();
}

async function verifyCompleteSourceMaps(piBinary: string, sourceCheckout: string): Promise<void> {
	const sourceDirectory = join(sourceCheckout, "packages", "coding-agent", "dist");
	const hostDirectory = dirname(await realpath(piBinary));
	const relativePaths = await sourceMapFiles(sourceDirectory);
	if (relativePaths.length === 0) throw new Error("Pi Host source build produced no source maps");
	for (const relativePath of relativePaths) {
		const [source, staged] = await Promise.all([
			readFile(join(sourceDirectory, relativePath)),
			readFile(join(hostDirectory, relativePath)),
		]);
		if (sha256(source) !== sha256(staged)) throw new Error(`Pi Host source map copy is incomplete: ${relativePath}`);
	}
}

async function verifySourceMaps(piBinary: string): Promise<void> {
	const resolvedBinary = await realpath(piBinary);
	const hostDirectory = dirname(resolvedBinary);
	const changelogSha256 = sha256(await readFile(join(hostDirectory, "CHANGELOG.md")));
	if (changelogSha256 !== CERTIFIED_PI_CHANGELOG_SHA256) {
		throw new Error("Pi Host CHANGELOG does not match the certified upstream source state");
	}
	for (const fingerprint of CERTIFIED_PI_SOURCE_FINGERPRINTS) {
		const value: unknown = JSON.parse(await readFile(join(hostDirectory, fingerprint.path), "utf8"));
		if (typeof value !== "object" || value === null)
			throw new Error(`Invalid Pi Host source map: ${fingerprint.path}`);
		const sourcesContent = (value as { sourcesContent?: unknown }).sourcesContent;
		if (!Array.isArray(sourcesContent) || typeof sourcesContent[0] !== "string") {
			throw new Error(`Pi Host source map lacks embedded source: ${fingerprint.path}`);
		}
		if (sha256(sourcesContent[0]) !== fingerprint.sha256) {
			throw new Error(`Pi Host source map does not match ${CERTIFIED_PI_HOST_PROFILE}: ${fingerprint.path}`);
		}
	}
}

async function verifyInstalledSourceMaps(piBinary: string): Promise<void> {
	const resolvedBinary = await realpath(piBinary);
	const binarySha256 = sha256(await readFile(resolvedBinary));
	if (binarySha256 !== CERTIFIED_PI_INSTALLED_BINARY_SHA256) {
		throw new Error("Pi Host executable is not the certified installed binary");
	}
	await verifySourceMaps(resolvedBinary);
}

/** Verifies a newly built record at its staging paths before it can replace the last-good Host. */
export async function verifyPiHostBuildRecord(
	piBinary: string,
	attestationPath: string,
	sourceCheckout: string,
): Promise<void> {
	await verifyBuildAttestation(piBinary, attestationPath);
	await verifySourceMaps(piBinary);
	await verifyCertifiedPiModelData(join(sourceCheckout, "packages", "ai", "src", "providers", "data"));
	await verifyCompleteSourceMaps(piBinary, sourceCheckout);
}

function gitOutput(source: string, args: readonly string[]): string {
	const result = spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(" ")} exited ${String(result.status)}`);
	}
	return result.stdout.trim();
}

async function verifyLocalSourceBuild(piBinary: string, paths: LocalSourceBuildPaths): Promise<void> {
	if ((await realpath(piBinary)) !== (await realpath(paths.binary))) {
		throw new Error("PI_BIN does not resolve to the fixed local source-build binary");
	}
	if (gitOutput(paths.source, ["rev-parse", "HEAD"]) !== CERTIFIED_PI_SOURCE_COMMIT) {
		throw new Error("Local Pi Host source checkout is not at the certified commit");
	}
	if (gitOutput(paths.source, ["status", "--porcelain=v1", "--untracked-files=no"])) {
		throw new Error("Local Pi Host source checkout has tracked changes");
	}
	const remote = gitOutput(paths.source, ["remote", "get-url", "origin"]);
	if (remote !== CERTIFIED_PI_SOURCE_REPOSITORY && remote !== `${CERTIFIED_PI_SOURCE_REPOSITORY}.git`) {
		throw new Error("Local Pi Host source checkout has an unexpected origin");
	}
	await verifyPiHostBuildRecord(piBinary, paths.attestation, paths.source);
}

/** Proves source identity instead of inferring it from a release string and compatible APIs. */
export async function verifyPiHostProvenance(
	piBinary: string,
	environment: ProvenanceEnvironment = process.env,
): Promise<PiHostProvenance> {
	const attestationPath = workflowAttestationPath(environment);
	if (attestationPath) {
		const workspace = environment.GITHUB_WORKSPACE as string;
		const expectedBinary = join(workspace, ".artifacts", "pi-host", "linux-x64", "pi");
		if (resolve(piBinary) !== expectedBinary) throw new Error("CI PI_BIN is outside the fixed Pi Host facade path");
		const pinned = await pinPublishedPiHost(workspace);
		await verifyBuildAttestation(pinned.binary, pinned.attestation);
		return { kind: "ci-workflow-attestation", profile: CERTIFIED_PI_HOST_PROFILE };
	}
	const localPaths = localSourceBuildPaths(piBinary, environment);
	if (localPaths) {
		const pinned = await pinPublishedPiHost(REPOSITORY_ROOT);
		await verifyLocalSourceBuild(pinned.binary, {
			...localPaths,
			attestation: pinned.attestation,
			binary: pinned.binary,
		});
		return { kind: "local-source-build-record", profile: CERTIFIED_PI_HOST_PROFILE };
	}
	try {
		await verifyInstalledSourceMaps(piBinary);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Cannot prove PI_BIN uses ${CERTIFIED_PI_HOST_PROFILE}: ${detail}. Use the certified installed binary, run bun run host:build, or use the pinned CI workflow build.`,
		);
	}
	return { kind: "installed-binary-allowlist", profile: CERTIFIED_PI_HOST_PROFILE };
}
