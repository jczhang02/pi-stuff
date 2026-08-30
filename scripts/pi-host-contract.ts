/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.84.4";

/** Reviewed upstream release source that satisfies the complete Suite contract. */
export const CERTIFIED_PI_SOURCE_COMMIT = "b79e4cc834970cca69daebffab7df1da7d1e52c4";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Audited upstream Linux x64 release binary. */
export const CERTIFIED_PI_RELEASE_BINARY_SHA256 = "ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a";
export const CERTIFIED_PI_RELEASE_BINARY_SIZE = 104_511_616;

export const CERTIFIED_PI_BUN_VERSION = "1.3.14";
export const CERTIFIED_PI_BUN_RUNTIME_MARKER = `Bun v${CERTIFIED_PI_BUN_VERSION} (0d9b296a) Linux x64 (baseline)`;
export const CERTIFIED_PI_BUN_RUNTIME_MARKER_OFFSET = 2_995_056;

/** Reviewed upstream release identity used by every real-Host acceptance check. */
export const CERTIFIED_PI_HOST_PROFILE = `${CERTIFIED_PI_VERSION}+${[
	`source.${CERTIFIED_PI_SOURCE_COMMIT.slice(0, 12)}`,
	`binary.${CERTIFIED_PI_RELEASE_BINARY_SHA256.slice(0, 12)}`,
	`bun.${CERTIFIED_PI_BUN_VERSION}`,
].join(".")}`;

if (import.meta.main) process.stdout.write(CERTIFIED_PI_VERSION);
