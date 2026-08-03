import { createHash, randomUUID } from "node:crypto";
import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { CERTIFIED_PI_MODEL_DATA_SHA256 } from "./pi-host-contract.ts";

const MODEL_DATA_MANIFEST = ".manifest.json";
const CANONICAL_GENERATED_AT = "2000-01-01T00:00:00.000Z";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const CERTIFIED_PI_MODEL_DATA_DIRECTORY = resolve(
	import.meta.dir,
	"..",
	"vendor",
	"pi-host-model-data",
	CERTIFIED_PI_MODEL_DATA_SHA256,
);

interface ModelDataManifest {
	readonly files: Readonly<Record<string, string>>;
	readonly generatedAt: string;
	readonly schemaVersion: number;
	readonly structureHash: string;
}

interface ModelDataManifestCandidate {
	readonly files?: unknown;
	readonly generatedAt?: unknown;
	readonly schemaVersion?: unknown;
	readonly structureHash?: unknown;
}

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function parseManifest(value: unknown): ModelDataManifest {
	if (!isRecord(value)) throw new Error("Pi model-data manifest must be an object");
	const candidate = value as ModelDataManifestCandidate;
	if (!isRecord(candidate.files)) throw new Error("Pi model-data manifest must contain file hashes");
	if (!Number.isInteger(candidate.schemaVersion)) throw new Error("Pi model-data manifest has no schema version");
	if (typeof candidate.generatedAt !== "string" || Number.isNaN(Date.parse(candidate.generatedAt))) {
		throw new Error("Pi model-data manifest has an invalid generation timestamp");
	}
	if (typeof candidate.structureHash !== "string" || !SHA256_PATTERN.test(candidate.structureHash)) {
		throw new Error("Pi model-data manifest has an invalid structure hash");
	}
	for (const [filename, digest] of Object.entries(candidate.files)) {
		if (!filename.endsWith(".json") || filename === MODEL_DATA_MANIFEST) {
			throw new Error(`Pi model-data manifest contains an invalid filename: ${filename}`);
		}
		if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) {
			throw new Error(`Pi model-data manifest contains an invalid hash: ${filename}`);
		}
	}
	return candidate as ModelDataManifest;
}

/** Hashes every filename and byte in a validated model-data snapshot, including its immutable manifest. */
export async function modelDataSnapshotSha256(directory: string): Promise<string> {
	const manifestBytes = await readFile(join(directory, MODEL_DATA_MANIFEST));
	const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown);
	const entries = await readdir(directory, { withFileTypes: true });
	const actualFiles = entries
		.map((entry) => {
			if (!entry.isFile()) throw new Error(`Pi model-data snapshot contains a non-file entry: ${entry.name}`);
			return entry.name;
		})
		.sort();
	const expectedFiles = [MODEL_DATA_MANIFEST, ...Object.keys(manifest.files)].sort();
	if (
		actualFiles.length !== expectedFiles.length ||
		actualFiles.some((file, index) => file !== expectedFiles[index])
	) {
		throw new Error("Pi model-data files do not match the complete manifest");
	}

	const files: Record<string, string> = {};
	for (const filename of expectedFiles) {
		const digest = sha256(
			filename === MODEL_DATA_MANIFEST ? manifestBytes : await readFile(join(directory, filename)),
		);
		if (filename !== MODEL_DATA_MANIFEST && digest !== manifest.files[filename])
			throw new Error(`Pi model-data file does not match manifest: ${filename}`);
		files[filename] = digest;
	}
	return sha256(JSON.stringify(files));
}

export async function verifyCertifiedPiModelData(directory: string): Promise<void> {
	const digest = await modelDataSnapshotSha256(directory);
	if (digest !== CERTIFIED_PI_MODEL_DATA_SHA256) {
		throw new Error(
			`Hydrated Pi model-data snapshot ${digest} does not match certified snapshot ${CERTIFIED_PI_MODEL_DATA_SHA256}`,
		);
	}
}

export async function restoreCertifiedPiModelData(destination: string): Promise<void> {
	await verifyCertifiedPiModelData(CERTIFIED_PI_MODEL_DATA_DIRECTORY);
	const parent = dirname(destination);
	const staging = join(parent, `.${basename(destination)}.snapshot-${randomUUID()}`);
	const backup = join(parent, `.${basename(destination)}.previous-${randomUUID()}`);
	await mkdir(parent, { recursive: true });
	await cp(CERTIFIED_PI_MODEL_DATA_DIRECTORY, staging, { recursive: true });
	await verifyCertifiedPiModelData(staging);
	const hadPrevious = await exists(destination);
	if (hadPrevious) await rename(destination, backup);
	try {
		await rename(staging, destination);
	} catch (error) {
		if (hadPrevious) await rename(backup, destination);
		throw error;
	}
	if (hadPrevious) await rm(backup, { force: true, recursive: true });
}

/** Writes a reviewed live hydration as a new immutable generation without changing the certified profile. */
export async function writeContentAddressedModelDataSnapshot(source: string, snapshotsRoot: string): Promise<string> {
	await modelDataSnapshotSha256(source);
	await mkdir(snapshotsRoot, { recursive: true });
	const staging = join(snapshotsRoot, `.snapshot-${randomUUID()}`);
	await cp(source, staging, { recursive: true });
	const manifest = parseManifest(JSON.parse(await readFile(join(staging, MODEL_DATA_MANIFEST), "utf8")) as unknown);
	await writeFile(
		join(staging, MODEL_DATA_MANIFEST),
		`${JSON.stringify({
			schemaVersion: manifest.schemaVersion,
			generatedAt: CANONICAL_GENERATED_AT,
			structureHash: manifest.structureHash,
			files: manifest.files,
		})}\n`,
	);
	const digest = await modelDataSnapshotSha256(staging);
	const destination = join(snapshotsRoot, digest);
	if (await exists(destination)) {
		if ((await modelDataSnapshotSha256(destination)) !== digest) {
			throw new Error(`Existing Pi model-data generation does not match its content address: ${destination}`);
		}
		await rm(staging, { force: true, recursive: true });
		return destination;
	}
	await rename(staging, destination);
	return destination;
}
