/** Released type surface used for development dependencies and version checks. */
export const CERTIFIED_PI_VERSION = "0.84.1";

/** Verified upstream Host release source that satisfies the complete Suite contract. */
export const CERTIFIED_PI_SOURCE_COMMIT = "53fa77ccd8a279eb87e92294ef3687b03ff80112";

export const CERTIFIED_PI_SOURCE_REPOSITORY = "https://github.com/earendil-works/pi";

/** Content address of every filename and byte in the repository-owned model-data snapshot. */
export const CERTIFIED_PI_MODEL_DATA_SHA256 = "299c882258d4714113aab6531eb1d00ec4c7d2e95a303951715bd182799475ef";

/** Audited installed Linux x64 binary accepted without a local build record. */
export const CERTIFIED_PI_INSTALLED_BINARY_SHA256 = "ddb904494b83da17f7d34448a218a7ed0df9f513e7b929a981bf417f5db62fc7";

/** Release assets that bind an installed binary to the reviewed upstream source. */
export const CERTIFIED_PI_CHANGELOG_SHA256 = "890d61c16f30a2f1235546edbd8630cad82be16e400b1a35ca42aa364114b579";
export const CERTIFIED_PI_SOURCE_FINGERPRINTS = [
	{
		path: "cli/args.js.map",
		sha256: "feb423762f6e5e64e1df1d46b661c23c5709b976c8e0ccf50002dc304df517fb",
	},
	{
		path: "modes/interactive/interactive-mode.js.map",
		sha256: "18cf8a7a34f1b9476f2db1e9a322dd428f5d71f070f4ad01ee0d07c385476f59",
	},
	{
		path: "core/settings-manager.js.map",
		sha256: "2bd534db40d6fd002876b6a3622f584915b42117a0bc3c6c8ad538e2d300e3ea",
	},
	{
		path: "modes/interactive/components/settings-selector.js.map",
		sha256: "3e172ef9158a8b8904c23a899d38fe08e898bb197379b4dd6448dc29ef1b1d59",
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
