import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, cp, mkdtemp, open, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
	CERTIFIED_PI_BUN_RUNTIME_MARKER,
	CERTIFIED_PI_BUN_RUNTIME_MARKER_OFFSET,
	CERTIFIED_PI_BUN_VERSION,
	CERTIFIED_PI_HOST_PROFILE,
	CERTIFIED_PI_RELEASE_BINARY_SHA256,
	CERTIFIED_PI_RELEASE_BINARY_SIZE,
	CERTIFIED_PI_SOURCE_REPOSITORY,
	CERTIFIED_PI_VERSION,
} from "./pi-host-contract.ts";

export interface PiHostProvenance {
	readonly kind: "release-binary-allowlist";
	readonly profile: string;
}

function provenance(): PiHostProvenance {
	return { kind: "release-binary-allowlist", profile: CERTIFIED_PI_HOST_PROFILE };
}

function uncertifiedHostError(): Error {
	return new Error(
		`PI_BIN is not the certified ${CERTIFIED_PI_HOST_PROFILE} release binary. Download v${CERTIFIED_PI_VERSION} from ${CERTIFIED_PI_SOURCE_REPOSITORY}/releases.`,
	);
}

async function readCertifiedPiHost(piBinary: string): Promise<Uint8Array> {
	let bytes: Uint8Array;
	try {
		const file = await open(piBinary, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const metadata = await file.stat();
			if (!metadata.isFile()) throw new Error("PI_BIN must be a regular file");
			if (metadata.size !== CERTIFIED_PI_RELEASE_BINARY_SIZE) throw uncertifiedHostError();
			const expectedBunMarker = Buffer.from(CERTIFIED_PI_BUN_RUNTIME_MARKER);
			const actualBunMarker = Buffer.alloc(expectedBunMarker.length);
			const { bytesRead } = await file.read(
				actualBunMarker,
				0,
				actualBunMarker.length,
				CERTIFIED_PI_BUN_RUNTIME_MARKER_OFFSET,
			);
			if (bytesRead !== expectedBunMarker.length || !actualBunMarker.equals(expectedBunMarker)) {
				throw new Error(`PI_BIN does not embed certified Bun ${CERTIFIED_PI_BUN_VERSION}`);
			}
			bytes = await file.readFile();
		} finally {
			await file.close();
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("PI_BIN ")) throw error;
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot read PI_BIN for ${CERTIFIED_PI_HOST_PROFILE}: ${detail}`);
	}
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== CERTIFIED_PI_RELEASE_BINARY_SHA256) throw uncertifiedHostError();
	return bytes;
}

/** Verifies the exact reviewed upstream release binary instead of trusting its version string. */
export async function verifyPiHostProvenance(piBinary: string): Promise<PiHostProvenance> {
	await readCertifiedPiHost(piBinary);
	return provenance();
}

/** Copies the release tree with verified executable bytes into a private acceptance-run directory. */
export async function stageCertifiedPiHost(
	piBinary: string,
	stagingRoot: string,
): Promise<PiHostProvenance & { readonly binaryPath: string }> {
	const bytes = await readCertifiedPiHost(piBinary);
	const sourceBinary = resolve(piBinary);
	const directory = await mkdtemp(join(stagingRoot, "pi-host-"));
	await cp(dirname(sourceBinary), directory, {
		filter: (source) => resolve(source) !== sourceBinary,
		recursive: true,
	});
	await chmod(directory, 0o700);
	const binaryPath = join(directory, basename(sourceBinary));
	await writeFile(binaryPath, bytes, { flag: "wx", mode: 0o500 });
	await chmod(binaryPath, 0o500);
	return { ...provenance(), binaryPath };
}
