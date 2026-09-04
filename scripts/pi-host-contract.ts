/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.85.0";

/** Reviewed upstream release source that satisfies the complete Suite contract. */
export const CERTIFIED_PI_SOURCE_COMMIT = "107d79f11072bbc8a3a757ed7fd69596bee7d68c";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Audited upstream Linux x64 release binary. */
export const CERTIFIED_PI_RELEASE_BINARY_SHA256 = "0cfd1bf3e9468f1052d172502fa388e8e8e53dcdeb9fa97f1ef828fdd7757072";
export const CERTIFIED_PI_RELEASE_BINARY_SIZE = 105_764_992;

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
