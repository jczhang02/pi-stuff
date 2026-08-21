import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import {
	CERTIFIED_PI_HOST_PROFILE,
	CERTIFIED_PI_RELEASE_BINARY_SHA256,
	CERTIFIED_PI_SOURCE_REPOSITORY,
	CERTIFIED_PI_VERSION,
} from "./pi-host-contract.ts";

export interface PiHostProvenance {
	readonly kind: "release-binary-allowlist";
	readonly profile: string;
}

/** Verifies the exact reviewed upstream release binary instead of trusting its version string. */
export async function verifyPiHostProvenance(piBinary: string): Promise<PiHostProvenance> {
	let actual: string;
	try {
		actual = createHash("sha256")
			.update(await readFile(await realpath(piBinary)))
			.digest("hex");
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot read PI_BIN for ${CERTIFIED_PI_HOST_PROFILE}: ${detail}`);
	}
	if (actual !== CERTIFIED_PI_RELEASE_BINARY_SHA256) {
		throw new Error(
			`PI_BIN is not the certified ${CERTIFIED_PI_HOST_PROFILE} release binary. Download v${CERTIFIED_PI_VERSION} from ${CERTIFIED_PI_SOURCE_REPOSITORY}/releases.`,
		);
	}
	return { kind: "release-binary-allowlist", profile: CERTIFIED_PI_HOST_PROFILE };
}
