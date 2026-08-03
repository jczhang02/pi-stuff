/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.83.0";

/** Earliest verified upstream Host source that satisfies the complete daily-use UI contract. */
export const CERTIFIED_PI_SOURCE_COMMIT = "bf4a90d81985bd45052eeeae59d84fe13e0bd2c8";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Content address of every filename and byte in the repository-owned model-data snapshot. */
export const CERTIFIED_PI_MODEL_DATA_SHA256 = "676b91ad13829f58c8e92e391f116ce91a45ec878362a41ce7104e916de86e3a";

export const CERTIFIED_PI_BUN_VERSION = "1.3.14";
export const CERTIFIED_PI_NODE_VERSION = "24.16.0";
export const CERTIFIED_PI_NPM_VERSION = "11.13.0";

/**
 * Source, model-data, and compiler profile. A build record binds each produced executable separately; this profile
 * does not claim byte-for-byte reproducibility across operating-system utilities.
 */
export const CERTIFIED_PI_HOST_PROFILE = `${CERTIFIED_PI_VERSION}+${[
	`source.${CERTIFIED_PI_SOURCE_COMMIT.slice(0, 12)}`,
	`models.${CERTIFIED_PI_MODEL_DATA_SHA256.slice(0, 12)}`,
	`node.${CERTIFIED_PI_NODE_VERSION}`,
	`npm.${CERTIFIED_PI_NPM_VERSION}`,
	`bun.${CERTIFIED_PI_BUN_VERSION}`,
].join(".")}`;
