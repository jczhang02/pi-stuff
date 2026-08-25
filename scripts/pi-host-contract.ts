/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.84.3";

/** Reviewed upstream release source that satisfies the complete Suite contract. */
export const CERTIFIED_PI_SOURCE_COMMIT = "4e58f324fae8ebfa98a3d45181fb248072a2afac";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Audited upstream Linux x64 release binary. */
export const CERTIFIED_PI_RELEASE_BINARY_SHA256 = "ca858fde375ab91531353b22fac6ebdf29c0a153efe754f5f9b8a72a7423ed08";
export const CERTIFIED_PI_RELEASE_BINARY_SIZE = 104_487_040;

export const CERTIFIED_PI_BUN_VERSION = "1.3.14";

/** Reviewed upstream release identity used by every real-Host acceptance check. */
export const CERTIFIED_PI_HOST_PROFILE = `${CERTIFIED_PI_VERSION}+${[
	`source.${CERTIFIED_PI_SOURCE_COMMIT.slice(0, 12)}`,
	`binary.${CERTIFIED_PI_RELEASE_BINARY_SHA256.slice(0, 12)}`,
	`bun.${CERTIFIED_PI_BUN_VERSION}`,
].join(".")}`;

if (import.meta.main) process.stdout.write(CERTIFIED_PI_VERSION);
