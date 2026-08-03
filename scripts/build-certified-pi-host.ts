import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	CERTIFIED_PI_BUN_VERSION,
	CERTIFIED_PI_MODEL_DATA_SHA256,
	CERTIFIED_PI_NODE_VERSION,
	CERTIFIED_PI_NPM_VERSION,
	CERTIFIED_PI_SOURCE_COMMIT,
	CERTIFIED_PI_SOURCE_REPOSITORY,
	CERTIFIED_PI_VERSION,
} from "./pi-host-contract.ts";
import { restoreCertifiedPiModelData, verifyCertifiedPiModelData } from "./pi-host-model-data.ts";
import { publishVerifiedPiHost } from "./pi-host-publish.ts";
import { verifyPiHostBuildRecord } from "./verify-pi-host-provenance.ts";

const root = resolve(import.meta.dir, "..");
const artifactsDirectory = join(root, ".artifacts");
export const certifiedPiSourceDirectory = join(artifactsDirectory, "pi-source");
const hostDirectory = join(artifactsDirectory, "pi-host");
const generationsDirectory = join(artifactsDirectory, "pi-host-generations");
const attestationPath = join(artifactsDirectory, "pi-host-attestation.json");

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function run(command: string[], cwd = root): Promise<string> {
	const child = Bun.spawn(command, { cwd, stderr: "inherit", stdout: "pipe" });
	const stdout = await new Response(child.stdout).text();
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${String(exitCode)}`);
	return stdout.trim();
}

export async function runVisible(command: string[], cwd = root): Promise<void> {
	const child = Bun.spawn(command, { cwd, stderr: "inherit", stdout: "inherit" });
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${String(exitCode)}`);
}

export async function prepareSource(): Promise<void> {
	if (!(await exists(join(certifiedPiSourceDirectory, ".git")))) {
		if (await exists(certifiedPiSourceDirectory)) {
			throw new Error(`${certifiedPiSourceDirectory} exists but is not a Git checkout; move it aside and retry`);
		}
		await mkdir(certifiedPiSourceDirectory, { recursive: true });
		await run(["git", "init", certifiedPiSourceDirectory]);
		await run(["git", "-C", certifiedPiSourceDirectory, "remote", "add", "origin", CERTIFIED_PI_SOURCE_REPOSITORY]);
	}

	const remote = await run(["git", "-C", certifiedPiSourceDirectory, "remote", "get-url", "origin"]);
	if (remote !== CERTIFIED_PI_SOURCE_REPOSITORY && remote !== `${CERTIFIED_PI_SOURCE_REPOSITORY}.git`) {
		throw new Error(`Refusing unexpected Pi origin ${remote}`);
	}
	const dirty = await run([
		"git",
		"-C",
		certifiedPiSourceDirectory,
		"status",
		"--porcelain=v1",
		"--untracked-files=no",
	]);
	if (dirty)
		throw new Error(
			`${certifiedPiSourceDirectory} has tracked changes; preserve or discard them explicitly before retrying`,
		);

	await run(["git", "-C", certifiedPiSourceDirectory, "fetch", "--depth=1", "origin", CERTIFIED_PI_SOURCE_COMMIT]);
	await run(["git", "-C", certifiedPiSourceDirectory, "checkout", "--detach", "FETCH_HEAD"]);
	const commit = await run(["git", "-C", certifiedPiSourceDirectory, "rev-parse", "HEAD"]);
	if (commit !== CERTIFIED_PI_SOURCE_COMMIT) throw new Error(`Pi checkout resolved unexpected commit ${commit}`);
}

export async function verifyToolchain(): Promise<void> {
	const actual = {
		bun: Bun.version,
		node: (await run(["node", "--version"])).replace(/^v/, ""),
		npm: await run(["npm", "--version"]),
	};
	const expected = {
		bun: CERTIFIED_PI_BUN_VERSION,
		node: CERTIFIED_PI_NODE_VERSION,
		npm: CERTIFIED_PI_NPM_VERSION,
	};
	for (const name of ["bun", "node", "npm"] as const) {
		if (actual[name] !== expected[name]) {
			throw new Error(`Certified Pi Host requires ${name} ${expected[name]}, received ${actual[name]}`);
		}
	}
}

async function copySourceMaps(source: string, destination: string, relativeDirectory = ""): Promise<number> {
	let copied = 0;
	for (const entry of await readdir(join(source, relativeDirectory), { withFileTypes: true })) {
		const relativePath = join(relativeDirectory, entry.name);
		if (entry.isDirectory()) {
			copied += await copySourceMaps(source, destination, relativePath);
		} else if (entry.isFile() && entry.name.endsWith(".map")) {
			const destinationPath = join(destination, relativePath);
			await mkdir(dirname(destinationPath), { recursive: true });
			await copyFile(join(source, relativePath), destinationPath);
			copied++;
		}
	}
	return copied;
}

async function main(): Promise<void> {
	if (process.platform !== "linux" || process.arch !== "x64") {
		throw new Error("The certified local Pi Host build currently supports Linux x64 only");
	}
	await verifyToolchain();
	await mkdir(artifactsDirectory, { recursive: true });
	await prepareSource();
	await runVisible(["npm", "ci", "--ignore-scripts"], certifiedPiSourceDirectory);
	await restoreCertifiedPiModelData(join(certifiedPiSourceDirectory, "packages", "ai", "src", "providers", "data"));
	await runVisible(["npm", "run", "check:model-data"], certifiedPiSourceDirectory);
	await verifyCertifiedPiModelData(join(certifiedPiSourceDirectory, "packages", "ai", "src", "providers", "data"));

	const stagingDirectory = join(artifactsDirectory, `pi-host-stage-${String(process.pid)}-${randomUUID()}`);
	const stagedAttestationPath = join(stagingDirectory, "pi-host-attestation.json");
	try {
		await runVisible(
			[
				join(certifiedPiSourceDirectory, "scripts", "build-binaries.sh"),
				"--offline-model-data",
				"--skip-install",
				"--skip-deps",
				"--platform",
				"linux-x64",
				"--out",
				stagingDirectory,
			],
			certifiedPiSourceDirectory,
		);
		const stagedBinary = join(stagingDirectory, "linux-x64", "pi");
		const version = await run([stagedBinary, "--version"]);
		if (version !== CERTIFIED_PI_VERSION) throw new Error(`Built Pi reports unexpected version ${version}`);

		const copiedSourceMaps = await copySourceMaps(
			join(certifiedPiSourceDirectory, "packages", "coding-agent", "dist"),
			join(stagingDirectory, "linux-x64"),
		);
		if (copiedSourceMaps === 0) throw new Error("Built Pi produced no source maps to certify");
		const binarySha256 = createHash("sha256")
			.update(await readFile(stagedBinary))
			.digest("hex");
		await writeFile(
			stagedAttestationPath,
			`${JSON.stringify(
				{
					binarySha256,
					modelDataSnapshotSha256: CERTIFIED_PI_MODEL_DATA_SHA256,
					repository: CERTIFIED_PI_SOURCE_REPOSITORY,
					schemaVersion: 2,
					sourceCommit: CERTIFIED_PI_SOURCE_COMMIT,
					toolchain: {
						bun: CERTIFIED_PI_BUN_VERSION,
						node: CERTIFIED_PI_NODE_VERSION,
						npm: CERTIFIED_PI_NPM_VERSION,
					},
				},
				null,
				"\t",
			)}\n`,
			{ mode: 0o600 },
		);
		await publishVerifiedPiHost({
			attestationPath,
			generationsDirectory,
			hostDirectory,
			stagedHostDirectory: stagingDirectory,
			verify: () => verifyPiHostBuildRecord(stagedBinary, stagedAttestationPath, certifiedPiSourceDirectory),
		});

		const binaryPath = join(hostDirectory, "linux-x64", "pi");
		console.log(`Built certified Pi Host: ${binaryPath}`);
		console.log("Run the complete gate with:");
		console.log(
			`PI_BIN=${binaryPath} PI_HOST_ATTESTATION=${attestationPath} PI_HOST_SOURCE_CHECKOUT=${certifiedPiSourceDirectory} bun run check`,
		);
	} finally {
		await rm(stagingDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) await main();
