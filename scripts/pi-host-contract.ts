/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.85.0";

/** Upstream release source reference; not a Host admission requirement. */
export const CERTIFIED_PI_SOURCE_COMMIT = "107d79f11072bbc8a3a757ed7fd69596bee7d68c";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Supported Host version used by real-Host acceptance checks. */
export const CERTIFIED_PI_HOST_PROFILE = CERTIFIED_PI_VERSION;

if (import.meta.main) process.stdout.write(CERTIFIED_PI_VERSION);
