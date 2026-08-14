/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.84.2";

/** Verified upstream Host release source that satisfies the complete Suite contract. */
export const CERTIFIED_PI_SOURCE_COMMIT = "914cf1472e715297caa30db4b9535d534a9eb718";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Content address of every filename and byte in the repository-owned model-data snapshot. */
export const CERTIFIED_PI_MODEL_DATA_SHA256 = "299c882258d4714113aab6531eb1d00ec4c7d2e95a303951715bd182799475ef";

/** Audited installed Linux x64 binary accepted without a local build record. */
export const CERTIFIED_PI_INSTALLED_BINARY_SHA256 = "014493e5c8b079db2e5aa8b1aaea020ce7782bbd6f890c83680cc8d3b34e04fc";

/** Release assets that bind an installed binary to the reviewed upstream source. */
export const CERTIFIED_PI_CHANGELOG_SHA256 = "7e9e91204ee1f002052070a90332d24a166e0cbc433095cebe4136651e8d91c8";
export const CERTIFIED_PI_SOURCE_FINGERPRINTS = [
	{
		path: "cli/args.js.map",
		sha256: "d8907d9c2a039d571664009f7eac69789ae585b7f675bcd88d30781c854ad951",
	},
	{
		path: "modes/interactive/interactive-mode.js.map",
		sha256: "ccc403e24d005b47632460c249cf154cdc576448ab32f7001fb6a9d562014b37",
	},
	{
		path: "core/settings-manager.js.map",
		sha256: "2a1a01cbbc6c04b7593611a8ae71e8d182444417ac50d31d63a86294673c2a31",
	},
	{
		path: "modes/interactive/components/settings-selector.js.map",
		sha256: "b803beca2d660ee1abe8b28f0d3c5a43a84b366862e0bff3b88e65ead64de06c",
	},
] as const;

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

if (import.meta.main) process.stdout.write(CERTIFIED_PI_VERSION);
