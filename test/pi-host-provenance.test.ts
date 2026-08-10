import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	CERTIFIED_PI_BUN_VERSION,
	CERTIFIED_PI_HOST_PROFILE,
	CERTIFIED_PI_MODEL_DATA_SHA256,
	CERTIFIED_PI_NODE_VERSION,
	CERTIFIED_PI_NPM_VERSION,
	CERTIFIED_PI_SOURCE_COMMIT,
	CERTIFIED_PI_SOURCE_REPOSITORY,
} from "../scripts/pi-host-contract.ts";
import {
	CERTIFIED_PI_MODEL_DATA_DIRECTORY,
	modelDataSnapshotSha256,
	restoreCertifiedPiModelData,
	writeContentAddressedModelDataSnapshot,
} from "../scripts/pi-host-model-data.ts";
import {
	activatePreparedPiHostGeneration,
	prepareVerifiedPiHostGeneration,
	publishVerifiedPiHost,
} from "../scripts/pi-host-publish.ts";
import { verifyPiHostProvenance } from "../scripts/verify-pi-host-provenance.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

async function createAttestedHost(
	overrides: {
		binarySha256?: string;
		modelDataSnapshotSha256?: string;
		npmVersion?: string;
		detachedAttestation?: boolean;
		sourceCommit?: string;
		sourceOnlyRecord?: boolean;
	} = {},
) {
	const directory = await mkdtemp(join(tmpdir(), "pi-host-attestation-test-"));
	temporaryDirectories.push(directory);
	const artifacts = join(directory, ".artifacts");
	const hostDirectory = join(artifacts, "pi-host");
	const generation = join(artifacts, "pi-host-generations", "fixture");
	const binary = join(hostDirectory, "linux-x64", "pi");
	const generationBinary = join(generation, "linux-x64", "pi");
	const attestation = join(artifacts, "pi-host-attestation.json");
	const bytes = Buffer.from("certified Pi fixture");
	await mkdir(join(hostDirectory, "linux-x64"), { recursive: true });
	await mkdir(join(generation, "linux-x64"), { recursive: true });
	await writeFile(generationBinary, bytes);
	const record = {
		binarySha256: overrides.binarySha256 ?? createHash("sha256").update(bytes).digest("hex"),
		modelDataSnapshotSha256: overrides.modelDataSnapshotSha256 ?? CERTIFIED_PI_MODEL_DATA_SHA256,
		repository: CERTIFIED_PI_SOURCE_REPOSITORY,
		schemaVersion: 2,
		sourceCommit: overrides.sourceCommit ?? CERTIFIED_PI_SOURCE_COMMIT,
		toolchain: {
			bun: CERTIFIED_PI_BUN_VERSION,
			node: CERTIFIED_PI_NODE_VERSION,
			npm: overrides.npmVersion ?? CERTIFIED_PI_NPM_VERSION,
		},
	};
	const recordBytes = `${JSON.stringify(
		overrides.sourceOnlyRecord
			? {
					binarySha256: record.binarySha256,
					repository: record.repository,
					schemaVersion: 1,
					sourceCommit: record.sourceCommit,
				}
			: record,
	)}\n`;
	await writeFile(join(generation, "pi-host-attestation.json"), recordBytes);
	await symlink("../pi-host-generations/fixture", join(hostDirectory, "current"));
	await symlink("../current/linux-x64/pi", binary);
	if (overrides.detachedAttestation) {
		const detached = join(artifacts, "pi-host-generations", "detached");
		await mkdir(detached);
		await writeFile(join(detached, "pi-host-attestation.json"), recordBytes);
		await symlink("pi-host-generations/detached/pi-host-attestation.json", attestation);
	} else {
		await symlink("pi-host/current/pi-host-attestation.json", attestation);
	}
	return {
		binary,
		environment: {
			CI: "true",
			GITHUB_ACTIONS: "true",
			GITHUB_WORKSPACE: directory,
			PI_HOST_ATTESTATION: attestation,
		},
	};
}

describe("Pi Host source provenance", () => {
	test("restores the repository-owned content-addressed model snapshot without a live catalog", async () => {
		const restoredDirectory = await mkdtemp(join(tmpdir(), "pi-model-data-restore-test-"));
		temporaryDirectories.push(restoredDirectory);
		expect(basename(CERTIFIED_PI_MODEL_DATA_DIRECTORY)).toBe(CERTIFIED_PI_MODEL_DATA_SHA256);
		expect(await modelDataSnapshotSha256(CERTIFIED_PI_MODEL_DATA_DIRECTORY)).toBe(CERTIFIED_PI_MODEL_DATA_SHA256);

		await restoreCertifiedPiModelData(restoredDirectory);
		expect(await modelDataSnapshotSha256(restoredDirectory)).toBe(CERTIFIED_PI_MODEL_DATA_SHA256);
	});

	test("keeps the last-good Host and record when generation verification fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-host-publish-test-"));
		temporaryDirectories.push(directory);
		const hostDirectory = join(directory, "pi-host");
		const generationsDirectory = join(directory, "pi-host-generations");
		const stagedHostDirectory = join(directory, "pi-host-stage");
		const attestationPath = join(directory, "pi-host-attestation.json");
		await mkdir(join(hostDirectory, "linux-x64"), { recursive: true });
		await mkdir(join(stagedHostDirectory, "linux-x64"), { recursive: true });
		await writeFile(join(hostDirectory, "linux-x64", "pi"), "last-good-host");
		await writeFile(join(stagedHostDirectory, "linux-x64", "pi"), "unverified-host");
		await writeFile(attestationPath, "last-good-record");
		await writeFile(join(stagedHostDirectory, "pi-host-attestation.json"), "unverified-record");

		await expect(
			publishVerifiedPiHost({
				attestationPath,
				generationsDirectory,
				hostDirectory,
				stagedHostDirectory,
				verify: () => {
					throw new Error("staged record rejected");
				},
			}),
		).rejects.toThrow("staged record rejected");
		expect(await readFile(join(hostDirectory, "linux-x64", "pi"), "utf8")).toBe("last-good-host");
		expect(await readFile(attestationPath, "utf8")).toBe("last-good-record");
	});

	test("exposes the old pair before the one-pointer activation and the new pair afterward", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-host-atomic-generation-test-"));
		temporaryDirectories.push(directory);
		const hostDirectory = join(directory, "pi-host");
		const generationsDirectory = join(directory, "pi-host-generations");
		const stagedHostDirectory = join(directory, "pi-host-stage");
		const attestationPath = join(directory, "pi-host-attestation.json");
		await mkdir(join(hostDirectory, "linux-x64"), { recursive: true });
		await mkdir(join(stagedHostDirectory, "linux-x64"), { recursive: true });
		await writeFile(join(hostDirectory, "linux-x64", "pi"), "last-good-host");
		await writeFile(join(stagedHostDirectory, "linux-x64", "pi"), "new-host");
		await writeFile(attestationPath, "last-good-record");
		await writeFile(join(stagedHostDirectory, "pi-host-attestation.json"), "new-record");

		const prepared = await prepareVerifiedPiHostGeneration({
			attestationPath,
			generationsDirectory,
			hostDirectory,
			stagedHostDirectory,
			verify: () => {},
		});
		expect(await readFile(join(hostDirectory, "linux-x64", "pi"), "utf8")).toBe("last-good-host");
		expect(await readFile(attestationPath, "utf8")).toBe("last-good-record");
		expect(await readlink(join(hostDirectory, "linux-x64", "pi"))).toBe("../current/linux-x64/pi");
		expect(await readlink(attestationPath)).toBe("pi-host/current/pi-host-attestation.json");
		const oldGeneration = await realpath(join(hostDirectory, "current"));
		const competingStage = join(directory, "pi-host-competing-stage");
		await mkdir(join(competingStage, "linux-x64"), { recursive: true });
		await writeFile(join(competingStage, "linux-x64", "pi"), "competing-host");
		await writeFile(join(competingStage, "pi-host-attestation.json"), "competing-record");
		await expect(
			prepareVerifiedPiHostGeneration({
				attestationPath,
				generationsDirectory,
				hostDirectory,
				stagedHostDirectory: competingStage,
				verify: () => {},
			}),
		).rejects.toThrow("publication is active");

		await activatePreparedPiHostGeneration(prepared);
		expect(await readFile(join(hostDirectory, "linux-x64", "pi"), "utf8")).toBe("new-host");
		expect(await readFile(attestationPath, "utf8")).toBe("new-record");
		expect(await realpath(join(hostDirectory, "current"))).not.toBe(oldGeneration);
	});

	test("content-addresses every model-data byte, including the immutable manifest", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-model-data-test-"));
		temporaryDirectories.push(directory);
		const files = {
			"a.json": '{"a":1}\n',
			"b.json": '{"b":2}\n',
		};
		for (const [filename, contents] of Object.entries(files)) await writeFile(join(directory, filename), contents);
		await writeFile(
			join(directory, ".manifest.json"),
			`${JSON.stringify({
				files: {
					"b.json": createHash("sha256").update(files["b.json"]).digest("hex"),
					"a.json": createHash("sha256").update(files["a.json"]).digest("hex"),
				},
				generatedAt: "2026-08-03T00:00:00.000Z",
				schemaVersion: 3,
				structureHash: "0".repeat(64),
			})}\n`,
		);

		expect(await modelDataSnapshotSha256(directory)).toBe(
			"3057a418eac30318b7f8733d0a7416c61a0abb6a8be6a5cc3554bf7ea824b55b",
		);

		const snapshots = join(directory, "..", `snapshots-${basename(directory)}`);
		temporaryDirectories.push(snapshots);
		const first = await writeContentAddressedModelDataSnapshot(directory, snapshots);
		const manifestPath = join(directory, ".manifest.json");
		const changedTimestamp = JSON.parse(await readFile(manifestPath, "utf8")) as { generatedAt?: unknown };
		changedTimestamp.generatedAt = "2026-08-04T00:00:00.000Z";
		await writeFile(manifestPath, `${JSON.stringify(changedTimestamp)}\n`);
		const second = await writeContentAddressedModelDataSnapshot(directory, snapshots);
		expect(second).toBe(first);
		expect(JSON.parse(await readFile(join(first, ".manifest.json"), "utf8"))).toMatchObject({
			generatedAt: "2000-01-01T00:00:00.000Z",
		});
	});

	test("rejects a source-only record that omits the fixed model snapshot and build toolchain", async () => {
		const host = await createAttestedHost({ sourceOnlyRecord: true });
		await expect(verifyPiHostProvenance(host.binary, host.environment)).rejects.toThrow("does not identify");
	});

	test("rejects a record with different model data or npm toolchain", async () => {
		const wrongModels = await createAttestedHost({ modelDataSnapshotSha256: "0".repeat(64) });
		await expect(verifyPiHostProvenance(wrongModels.binary, wrongModels.environment)).rejects.toThrow(
			"does not identify",
		);

		const wrongNpm = await createAttestedHost({ npmVersion: "0.0.0" });
		await expect(verifyPiHostProvenance(wrongNpm.binary, wrongNpm.environment)).rejects.toThrow("does not identify");
	});

	test("accepts a source-profile record bound to one binary instance", async () => {
		const host = await createAttestedHost();
		expect(await verifyPiHostProvenance(host.binary, host.environment)).toEqual({
			kind: "ci-workflow-attestation",
			profile: CERTIFIED_PI_HOST_PROFILE,
		});
	});

	test("rejects a public record link detached from the one pinned current generation", async () => {
		const host = await createAttestedHost({ detachedAttestation: true });
		await expect(verifyPiHostProvenance(host.binary, host.environment)).rejects.toThrow("current generation");
	});

	test("rejects a compatible-looking binary with the wrong source or bytes", async () => {
		const wrongSource = await createAttestedHost({ sourceCommit: "0".repeat(40) });
		await expect(verifyPiHostProvenance(wrongSource.binary, wrongSource.environment)).rejects.toThrow(
			"does not identify",
		);

		const wrongBytes = await createAttestedHost({ binarySha256: "0".repeat(64) });
		await expect(verifyPiHostProvenance(wrongBytes.binary, wrongBytes.environment)).rejects.toThrow(
			"binary hash does not match",
		);
	});

	test("rejects an arbitrary local build record outside the fixed source-build paths", async () => {
		const host = await createAttestedHost();
		await expect(
			verifyPiHostProvenance(host.binary, {
				PI_HOST_ATTESTATION: host.environment.PI_HOST_ATTESTATION,
			}),
		).rejects.toThrow("requires PI_HOST_SOURCE_CHECKOUT");
	});

	test("rejects an unallowlisted executable before trusting adjacent source maps", async () => {
		const host = await createAttestedHost();
		await expect(verifyPiHostProvenance(host.binary, {})).rejects.toThrow(
			"executable is not the certified installed binary",
		);
	});
});
