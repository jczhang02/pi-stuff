/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.84.2";

/** Reviewed upstream release source that satisfies the complete Suite contract. */
export const CERTIFIED_PI_SOURCE_COMMIT = "914cf1472e715297caa30db4b9535d534a9eb718";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Audited upstream Linux x64 release binary. */
export const CERTIFIED_PI_RELEASE_BINARY_SHA256 = "9a2d20fab3caacbe3517d91e59d495ccc49fd4b51a1a72dcec6e8c1f4b7d6ab2";

export const CERTIFIED_PI_BUN_VERSION = "1.3.14";

/** Reviewed upstream release identity used by every real-Host acceptance check. */
export const CERTIFIED_PI_HOST_PROFILE = `${CERTIFIED_PI_VERSION}+${[
	`source.${CERTIFIED_PI_SOURCE_COMMIT.slice(0, 12)}`,
	`binary.${CERTIFIED_PI_RELEASE_BINARY_SHA256.slice(0, 12)}`,
	`bun.${CERTIFIED_PI_BUN_VERSION}`,
].join(".")}`;

if (import.meta.main) process.stdout.write(CERTIFIED_PI_VERSION);
