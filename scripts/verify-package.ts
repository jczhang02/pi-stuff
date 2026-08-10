import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CERTIFIED_PI_HOST_PROFILE, CERTIFIED_PI_SOURCE_COMMIT, CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";
import {
	createReleaseArtifacts,
	packPackageArchive,
	RELEASE_MANIFEST_FILENAME,
	type ReleaseManifest,
	readReleaseManifest,
	resolveReleaseArchive,
	sha256File,
	verifyReleaseArchivePaths,
	verifyReleaseArtifactHash,
	writeReleaseVerification,
} from "./release-artifacts.ts";
import { runPiRpcSmoke } from "./smoke-pi.ts";
import { verifyAgentsExecutionMatrix } from "./verify-agents-execution-matrix.ts";
import { verifyAgentsPty } from "./verify-agents-pty.ts";
import { verifyBtwPty } from "./verify-btw-pty.ts";
import { verifyContextPty } from "./verify-context-pty.ts";
import { verifyGoalLifecycle } from "./verify-goal-lifecycle.ts";
import { verifyGoalPty } from "./verify-goal-pty.ts";
import { verifyMcpPty } from "./verify-mcp-pty.ts";
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.ts";
import { verifyRtkPty } from "./verify-rtk-pty.ts";
import { verifyToolsPty } from "./verify-tools-pty.ts";
import { verifyToolsResumePty } from "./verify-tools-resume-pty.ts";
import { verifyUiPty } from "./verify-ui-pty.ts";
import { verifyWebIntegration } from "./verify-web-integration.ts";
import { verifyWorkMonitorMatrix } from "./verify-work-monitor-matrix.ts";
import { verifyWorkPty } from "./verify-work-pty.ts";

export { CERTIFIED_PI_HOST_PROFILE, CERTIFIED_PI_SOURCE_COMMIT, CERTIFIED_PI_VERSION };

const DEVELOPMENT_ARCHIVE_FILE = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|tsconfig(?:\.[^/]+)?\.json)$/;
const root = resolve(import.meta.dir, "..");
const aggregateDirectory = join(root, "packages", "pi-stuff");
const uiPackageName = "@jczhang02/pi-stuff-ui";
const uiRuntimeFiles = [
	"index.ts",
	"settings.ts",
	"ui-settings-dialog.ts",
	"live-thought.ts",
	"input-enhancement.ts",
	"statusline.ts",
	"welcome-header.ts",
	"session-presentation.ts",
] as const;
const codexRuntimeFiles = [
	"native/apply-patch/linux-x64/apply_patch",
	"native/imagegen/linux-x64/imagegen",
	"native/view-image/linux-x64/view_image",
	"THIRD_PARTY_NOTICES.md",
	"LICENSES/Apache-2.0.txt",
] as const;
const PACKED_AGGREGATE_SMOKE_TIMEOUT_MS = 60_000;
const codexNativeSha256: Readonly<Record<(typeof codexRuntimeFiles)[number], string>> = {
	"native/apply-patch/linux-x64/apply_patch": "9ded1c635a4e0e2aae2dd09d7f676b24fc4b377016f74c1a51d8b3b22ed6bb55",
	"native/imagegen/linux-x64/imagegen": "7822c5d5eced5b0f6ef4763e7d85209ff87be6342d793c1ef308a0908c1122a5",
	"native/view-image/linux-x64/view_image": "5b58243a8a64d926b6175b463017cdbbdda771ffc6da136eedeebeba80a33c23",
	"THIRD_PARTY_NOTICES.md": "",
	"LICENSES/Apache-2.0.txt": "",
};
const todoToolInspector = join(root, "test/fixtures/assert-todo-tools.ts");
const goalToolInspector = join(root, "test/fixtures/assert-goal-tools.ts");
const webToolInspector = join(root, "test/fixtures/assert-web-tools.ts");
const mcpToolInspector = join(root, "test/fixtures/assert-mcp-tools.ts");
const workToolInspector = join(root, "test/fixtures/assert-work-tools.ts");
const forkLicenseSha256 = "25d0d5e4e54033f939a9657109044f1d71a0b6e8db9adc400456ca9190df3fb1";
const agentsLicenseSha256 = "2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c";
const rtkLicenseSha256 = "7d9473dcd84975a7191bc13dcc744f3b4d6578c937c879cc73e31e0107fa4d46";
const codexLicenseSha256 = "ad600d98577a0949ad30c81867bd86f08f872ff12f6a7a519af14edc6f997ee9";
const toolsLicenseSha256 = "e6b72a9973ccabb20d8bef65a366a9b2357d6cea6cdd1eee4f2c3c69e61fb11c";
const goalLicenseSha256 = "5293e92f073f47012e723990a8605431b438757e9c6eb00c89868b1203e157da";
const webLicenseSha256 = "871b3c6c64e030c0647ca33543716bdae9511ae2d6a85d6f4ce63783bab52c8f";
const workLicenseSha256 = "5b9bdcc9d1c8ff25c560200695de042b12052573cb1224af4d735fba06d30b65";
const agentsRuntimeVersions = {
	typebox: "1.3.7",
} as const;
const embeddedForkVersions = {
	"@jczhang02/pi-mcp-adapter": "2.19.0-pi-stuff.7",
	"@jczhang02/pi-web-access": "0.18.0-pi-stuff.4",
} as const;
const internalForkSourceFiles = {
	"@jczhang02/pi-mcp-adapter": {
		directory: "packages/pi-mcp-adapter",
		sourceFileCount: 58,
		sourceSha256: "64e60f2e34cd8c73e1349158e92e8ba8d2e0ae017e3a3092d8c6c3d69c8d1a7d",
	},
	"@jczhang02/pi-web-access": {
		directory: "packages/pi-web-access",
		sourceFileCount: 52,
		sourceSha256: "541df6c01bc2c685d66a8dc847e5545148567837c208193e64a6f1b857cba736",
	},
} as const;
const officialMagicContextDependencies = {
	"@huggingface/transformers": "^4.1.0",
	"@jitl/quickjs-singlefile-cjs-release-asyncify": "0.32.0",
	"ai-tokenizer": "^1.0.6",
	"comment-json": "^5.0.0",
	"quickjs-emscripten": "^0.32.0",
	typebox: "^1.3.1",
	zod: "^4.1.8",
} as const;
const officialMagicContextFiles: Readonly<Record<string, string>> = {
	"README.md": "2ca9cac6865bd1eb88358096a55dbe9b55ab966c4f9b2907caa2fdada49fbcc4",
	"dist/emscripten-module-682pfzaa.js": "b5c6af4c698b69e986182ec56a92b2502f87fa899813c23a46df46b458eddec1",
	"dist/emscripten-module-ap8t3st0.js": "e33c4fb2d0b46d911a11c10258aa7978d89ea9b426661a08ae1512eb70658fb5",
	"dist/emscripten-module-bkktz927.js": "6705947ff622298e39a60ee44c16f0495b004fddce84829efaf40b2b70f98b18",
	"dist/emscripten-module-r5h7aghp.js": "2050ffc3ddffdc7a57541e323ff448ab4b5767bdc1577dbfae097f9d0b65df99",
	"dist/ffi-04jzypzk.js": "24cc46c5c570f4276acd1cbc48b1221870e3759f9e14a92aa0de2ba1e4e48d68",
	"dist/ffi-9wvt2wwz.js": "63b175632bc6830713eea54b97c91eede12719b05aad9be71295a30bee4ce714",
	"dist/ffi-d8pnn3mn.js": "874fe3811b211a7c4b3e9cbdf3ec55c728a1a3264b10b4a28ef3339f9edd9b5d",
	"dist/ffi-t8b862vx.js": "387846d74a8fb4c0933583e5dd9905be40a80eb81f88695a432650d3a0b4ae40",
	"dist/index-9xexf8s7.js": "fa35479d9c383a16f5b2523ee9e51a9e75022236b2fdd4771c732ccb3e6fb42f",
	"dist/index-ayd60xnw.js": "7d0ef19eed5388f8819fcc0d018dc3f3be570f92ff325e21e985f7b7ea303ec4",
	"dist/index-dynqfgx1.js": "546d985fce781f0ddbbf3c3cfa9886c10555e4cc683d35a37a72437ab74a572e",
	"dist/index-e3kftg52.js": "3930f85dd4f688c60e5fc97a57f272dcb7e3e4f9e3f1dfef911fbc1f81173532",
	"dist/index-ss632za9.js": "46b33fb960c71a2faca1ff2e7bdd295447ffa0782cebca734f04035788725550",
	"dist/index-v7fmc1s2.js": "4787d103f62cd603fed43d0769463971047ccf0b08923859e2fbd3a719053ab7",
	"dist/index-wckvcay0.js": "9ec69a527ea19d0bad4ca6c93f13130677a5a588440d072be4613167aa7767f1",
	"dist/index-zmyx6nf5.js": "bcdbe25bcc22d2a64e343fc430ebe400cedf3f8d1e2c5213bdd0eda6a19a43e4",
	"dist/index.js": "1ae220672eaa565e77fb6749ff9d6ee0d485cdd1789a36e7c73bc92b1a937943",
	"dist/module-ES6BEMUI-atfbtnbp.js": "3e4799bec136f7484350e0b6630bebf302e6c67ec84b605189a0bbcea3927968",
	"dist/module-asyncify-2EFITU5U-7xckhw8w.js": "877bc12c3d31cd7d76bdfc3008388ccae4f963f642d79c675c223f2025acf95b",
	"dist/prompt-context-602yq94t.js": "597aa8b3734a83c3816cedaff6b95d8ad7eb2afc1db351a50c5915960ec59c56",
	"dist/rpc-notifications-td0amw6w.js": "9ecdd36468e61b7b69006fcd7e88f033625cc9c3d3f62fd57acab79f8f0d42bd",
	"dist/safe-notification-target-ng8ygena.js": "20718f23358636ea77c36a22c4fb043d59f2a8c1a64cc8e6aacbc9a5d99d0fe7",
	"dist/subagent-entry.js": "db2a09bb328255ec56d29bc263f92b03932c95ce1523c89f42c28d8ea14b8ea8",
	"package.json": "06f05bfa8ece9db57343fb1e31daa5d9f8d7791c0121499987b40be9bc1227a6",
};
const expectedPiPeers: Readonly<Record<string, readonly string[]>> = {
	"@jczhang02/pi-stuff": ["@earendil-works/pi-coding-agent"],
	"@jczhang02/pi-stuff-agents": [
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
	],
	"@jczhang02/pi-stuff-btw": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-context": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-rtk": [
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
	],
	"@jczhang02/pi-stuff-codex": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-goal": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-todo": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-tools": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-ui": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-web": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-mcp": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-work": [
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
	],
};

export interface PackageArchiveManifest {
	bundledDependencies?: unknown;
	files?: unknown;
}

function readStringArray(value: unknown, field: string, allowEmpty: boolean): string[] {
	if (
		!Array.isArray(value) ||
		(!allowEmpty && value.length === 0) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new Error(`Package manifest ${field} must be ${allowEmpty ? "an" : "a non-empty"} array of strings`);
	}
	return value as string[];
}

function normalizedFilesEntry(entry: string): string {
	const normalized = entry.replace(/^\.\//, "");
	if (
		normalized.length === 0 ||
		normalized.startsWith("/") ||
		normalized.includes("\\") ||
		normalized.split("/").includes("..")
	) {
		throw new Error(`Invalid Package files entry: ${entry}`);
	}
	return normalized;
}

function matchesFilesEntry(entry: string, path: string): boolean {
	const normalized = normalizedFilesEntry(entry);
	if (normalized.endsWith("/")) return path.startsWith(normalized);
	if (!/[*?[\]{}]/.test(normalized)) return path === normalized || path.startsWith(`${normalized}/`);
	return new Bun.Glob(normalized).match(path);
}

function isAllowedPackageFile(path: string, files: readonly string[]): boolean {
	const included = files.some((entry) => !entry.startsWith("!") && matchesFilesEntry(entry, path));
	const excluded = files.some((entry) => entry.startsWith("!") && matchesFilesEntry(entry.slice(1), path));
	return included && !excluded;
}

function readBundledDependencies(value: unknown): string[] {
	const dependencies = value === undefined ? [] : readStringArray(value, "bundledDependencies", true);
	const packageName = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/;
	if (new Set(dependencies).size !== dependencies.length || dependencies.some((entry) => !packageName.test(entry))) {
		throw new Error("Package manifest bundledDependencies contains an invalid or duplicate package name");
	}
	return dependencies;
}

export function verifyPackageArchive(
	manifest: PackageArchiveManifest,
	archiveFiles: readonly string[],
	additionalBundledDependencies: readonly string[] = [],
): void {
	verifyReleaseArchivePaths(archiveFiles);
	const files = readStringArray(manifest.files, "files", false);
	if (!files.some((entry) => !entry.startsWith("!"))) {
		throw new Error("Package manifest files must contain at least one included entry");
	}
	for (const entry of files) {
		normalizedFilesEntry(entry.startsWith("!") ? entry.slice(1) : entry);
	}
	const bundledDependencies = [
		...readBundledDependencies(manifest.bundledDependencies),
		...readBundledDependencies(additionalBundledDependencies),
	];
	if (new Set(bundledDependencies).size !== bundledDependencies.length) {
		throw new Error("Package archive dependency allowlist contains duplicates");
	}
	const archiveSet = new Set(archiveFiles);
	if (!archiveSet.has("package/package.json")) {
		throw new Error("Package archive is missing package/package.json");
	}

	for (const entry of files) {
		if (entry.startsWith("!")) continue;
		const normalized = normalizedFilesEntry(entry);
		if (!normalized.endsWith("/") && !/[*?[\]{}]/.test(normalized)) {
			const expectedPath = `package/${normalized}`;
			if (!archiveSet.has(expectedPath) && !archiveFiles.some((path) => path.startsWith(`${expectedPath}/`))) {
				throw new Error(`Package archive is missing declared file: ${expectedPath}`);
			}
		}
	}

	const bundledPrefixes = bundledDependencies.map((dependency) => `node_modules/${dependency}/`);
	const firstPartyBundledPrefixes = bundledDependencies
		.filter((dependency) => dependency.startsWith("@jczhang02/pi-"))
		.map((dependency) => `node_modules/${dependency}/`);
	for (const prefix of bundledPrefixes) {
		const packageManifest = `package/${prefix}package.json`;
		if (!archiveSet.has(packageManifest)) {
			throw new Error(`Package archive is missing bundled dependency manifest: ${packageManifest}`);
		}
	}
	const bundledDevelopmentFiles = archiveFiles.filter((archivePath) => {
		if (!archivePath.startsWith("package/")) return false;
		const relativePath = archivePath.slice("package/".length);
		return (
			firstPartyBundledPrefixes.some(
				(prefix) =>
					relativePath.startsWith(prefix) && !relativePath.slice(prefix.length).startsWith("node_modules/"),
			) && DEVELOPMENT_ARCHIVE_FILE.test(relativePath)
		);
	});
	if (bundledDevelopmentFiles.length > 0) {
		throw new Error(`Bundled Package contains development-only files:\n${bundledDevelopmentFiles.sort().join("\n")}`);
	}

	const unexpected = archiveFiles.filter((archivePath) => {
		if (!archivePath.startsWith("package/")) return true;
		const relativePath = archivePath.slice("package/".length);
		if (relativePath === "package.json") return false;
		if (bundledPrefixes.some((prefix) => relativePath.startsWith(prefix))) return false;
		return !isAllowedPackageFile(relativePath, files);
	});
	if (unexpected.length > 0) {
		throw new Error(`Unexpected Package archive files:\n${[...unexpected].sort().join("\n")}`);
	}
}

function verifyUiRuntimeArchive(archiveFiles: readonly string[]): void {
	const archiveSet = new Set(archiveFiles);
	const missing = uiRuntimeFiles.map((path) => `package/${path}`).filter((path) => !archiveSet.has(path));
	if (missing.length > 0) {
		throw new Error(`Packed UI Package is missing runtime files:\n${missing.join("\n")}`);
	}
}

function verifyCodexRuntimeArchive(archiveFiles: readonly string[]): void {
	const archiveSet = new Set(archiveFiles);
	const missing = codexRuntimeFiles.map((path) => `package/${path}`).filter((path) => !archiveSet.has(path));
	if (missing.length > 0) throw new Error(`Packed Codex Package is missing runtime files:\n${missing.join("\n")}`);
}

function verifyWorkRuntimeArchive(archiveFiles: readonly string[]): void {
	const archiveSet = new Set(archiveFiles);
	for (const runtimePath of ["package/src/process-supervisor.mjs", "package/UPSTREAM.md", "package/LICENSE"]) {
		if (!archiveSet.has(runtimePath)) throw new Error(`Packed Work Package is missing ${runtimePath}`);
	}
}

function run(command: readonly string[], cwd: string, env: Record<string, string | undefined> = process.env): string {
	const result = Bun.spawnSync([...command], { cwd, env, stdout: "pipe", stderr: "pipe" });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(`${command[0]} failed with ${result.exitCode}: ${stderr.trim() || stdout.trim()}`);
	}
	return stdout;
}

async function resolvePackageDirectory(
	resolver: { resolve(specifier: string): string },
	packageName: string,
): Promise<string> {
	let resolved: string;
	try {
		resolved = resolver.resolve(`${packageName}/package.json`);
	} catch {
		resolved = resolver.resolve(packageName);
	}
	let directory = dirname(resolved);
	while (true) {
		const manifest = await readFile(join(directory, "package.json"), "utf8")
			.then((contents) => JSON.parse(contents) as { name?: unknown })
			.catch(() => undefined);
		if (manifest?.name === packageName) return directory;
		const parent = dirname(directory);
		if (parent === directory) throw new Error(`Cannot resolve Package root for ${packageName}`);
		directory = parent;
	}
}

async function verifyRuntimeDependencyClosure(packageDirectory: string): Promise<void> {
	const pending = [packageDirectory];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		if (visited.size > 2_000)
			throw new Error(`Runtime dependency closure is unexpectedly large: ${packageDirectory}`);
		const manifest = JSON.parse(await readFile(join(current, "package.json"), "utf8")) as {
			dependencies?: Record<string, unknown>;
			name?: unknown;
		};
		const resolver = createRequire(join(current, "package.json"));
		for (const dependency of Object.keys(manifest.dependencies ?? {})) {
			try {
				pending.push(await resolvePackageDirectory(resolver, dependency));
			} catch (error) {
				throw new Error(`${String(manifest.name ?? current)} cannot resolve runtime dependency ${dependency}`, {
					cause: error,
				});
			}
		}
	}
}

async function linkCertifiedHostPeers(installDirectory: string, packageName: string): Promise<void> {
	const peers = expectedPiPeers[packageName];
	if (!peers) throw new Error(`No certified Pi peer set for ${packageName}`);
	const peerScope = join(installDirectory, "node_modules", "@earendil-works");
	await mkdir(peerScope, { recursive: true });
	for (const dependency of peers) {
		await symlink(
			join(root, "node_modules", dependency),
			join(peerScope, dependency.slice("@earendil-works/".length)),
			"dir",
		);
	}
}

async function verifyPackageIdentity(
	packageDirectory: string,
	expectedName: string,
	expectedVersion: string,
): Promise<void> {
	const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
	};
	if (manifest.name !== expectedName || manifest.version !== expectedVersion) {
		throw new Error(
			`Expected ${expectedName}@${expectedVersion}, found ${String(manifest.name)}@${String(manifest.version)}`,
		);
	}
}

async function verifyInternalForkIdentity(
	packageDirectory: string,
	expectedName: keyof typeof internalForkSourceFiles,
	expectedVersion: string,
): Promise<void> {
	await verifyPackageIdentity(packageDirectory, expectedName, expectedVersion);
	const expected = internalForkSourceFiles[expectedName];
	const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")) as {
		private?: unknown;
		repository?: { directory?: unknown; url?: unknown };
	};
	if (
		manifest.private !== true ||
		manifest.repository?.url !== "git+https://github.com/jczhang02/pi-stuff.git" ||
		manifest.repository.directory !== expected.directory
	) {
		throw new Error(`${expectedName} is not bound to its private Pi Stuff monorepo source`);
	}
	const sourceFiles = (await readdir(packageDirectory)).filter((path) => /\.(?:cjs|js|mjs|ts)$/u.test(path)).sort();
	const sourceHash = createHash("sha256");
	for (const path of sourceFiles) {
		sourceHash
			.update(path)
			.update("\0")
			.update(await readFile(join(packageDirectory, path)))
			.update("\0");
	}
	if (sourceFiles.length !== expected.sourceFileCount || sourceHash.digest("hex") !== expected.sourceSha256) {
		throw new Error(`${expectedName} internal source snapshot drifted`);
	}
}

function verifyPiVersion(piBinary: string): void {
	const version = run([piBinary, "--version"], root).trim();
	if (version !== CERTIFIED_PI_VERSION) {
		throw new Error(`Expected Pi ${CERTIFIED_PI_VERSION}, received ${version || "no version"}`);
	}
}

function verifyPiDependencyContract(
	packageName: string,
	peerDependencies: Record<string, unknown> | undefined,
	devDependencies: Record<string, unknown> | undefined,
): void {
	const expected = expectedPiPeers[packageName];
	if (!expected) throw new Error(`No certified Pi dependency contract for ${packageName}`);
	const peers = Object.keys(peerDependencies ?? {})
		.filter((name) => name.startsWith("@earendil-works/pi-"))
		.sort();
	const development = Object.keys(devDependencies ?? {})
		.filter((name) => name.startsWith("@earendil-works/pi-"))
		.sort();
	if (peers.join("\n") !== [...expected].sort().join("\n") || development.join("\n") !== peers.join("\n")) {
		throw new Error(`${packageName} does not declare the exact certified Pi peer set`);
	}
	for (const dependency of expected) {
		if (peerDependencies?.[dependency] !== "*" || devDependencies?.[dependency] !== CERTIFIED_PI_VERSION) {
			throw new Error(`${packageName} has an invalid Pi contract for ${dependency}`);
		}
	}
}

async function verifyStandaloneInstalls(
	temporaryDirectory: string,
	piBinary: string,
	bunEnvironment: Record<string, string | undefined>,
	releaseDirectory: string,
	releaseManifest: ReleaseManifest,
): Promise<void> {
	const packsDirectory = join(temporaryDirectory, "standalone-packs");
	const agentsInstallDirectory = join(temporaryDirectory, "standalone-agents");
	const agentsNpmCacheDirectory = join(temporaryDirectory, "npm-cache-agents");
	const contextInstallDirectory = join(temporaryDirectory, "standalone-context");
	const contextNpmCacheDirectory = join(temporaryDirectory, "npm-cache-context");
	const btwInstallDirectory = join(temporaryDirectory, "standalone-btw");
	const btwNpmCacheDirectory = join(temporaryDirectory, "npm-cache-btw");
	const rtkInstallDirectory = join(temporaryDirectory, "standalone-rtk");
	const rtkNpmCacheDirectory = join(temporaryDirectory, "npm-cache-rtk");
	const codexInstallDirectory = join(temporaryDirectory, "standalone-codex");
	const codexNpmCacheDirectory = join(temporaryDirectory, "npm-cache-codex");
	const goalInstallDirectory = join(temporaryDirectory, "standalone-goal");
	const goalNpmCacheDirectory = join(temporaryDirectory, "npm-cache-goal");
	const todoInstallDirectory = join(temporaryDirectory, "standalone-todo");
	const todoNpmCacheDirectory = join(temporaryDirectory, "npm-cache-todo");
	const toolsInstallDirectory = join(temporaryDirectory, "standalone-tools");
	const toolsNpmCacheDirectory = join(temporaryDirectory, "npm-cache-tools");
	const webInstallDirectory = join(temporaryDirectory, "standalone-web");
	const webNpmCacheDirectory = join(temporaryDirectory, "npm-cache-web");
	const mcpInstallDirectory = join(temporaryDirectory, "standalone-mcp");
	const mcpNpmCacheDirectory = join(temporaryDirectory, "npm-cache-mcp");
	const workInstallDirectory = join(temporaryDirectory, "standalone-work");
	const workNpmCacheDirectory = join(temporaryDirectory, "npm-cache-work");
	await Promise.all([
		mkdir(packsDirectory),
		mkdir(agentsInstallDirectory),
		mkdir(agentsNpmCacheDirectory),
		mkdir(contextInstallDirectory),
		mkdir(contextNpmCacheDirectory),
		mkdir(btwInstallDirectory),
		mkdir(btwNpmCacheDirectory),
		mkdir(rtkInstallDirectory),
		mkdir(rtkNpmCacheDirectory),
		mkdir(codexInstallDirectory),
		mkdir(codexNpmCacheDirectory),
		mkdir(goalInstallDirectory),
		mkdir(goalNpmCacheDirectory),
		mkdir(todoInstallDirectory),
		mkdir(todoNpmCacheDirectory),
		mkdir(toolsInstallDirectory),
		mkdir(toolsNpmCacheDirectory),
		mkdir(webInstallDirectory),
		mkdir(webNpmCacheDirectory),
		mkdir(mcpInstallDirectory),
		mkdir(mcpNpmCacheDirectory),
		mkdir(workInstallDirectory),
		mkdir(workNpmCacheDirectory),
	]);

	const releaseArchive = (name: string): string => {
		const artifact = releaseManifest.artifacts.find((candidate) => candidate.name === name);
		if (!artifact) throw new Error(`Release manifest is missing ${name}`);
		return resolveReleaseArchive(releaseDirectory, artifact);
	};
	const rootRequire = createRequire(join(root, "package.json"));
	const runtimeDirectories: Record<string, string> = {
		typebox: await resolvePackageDirectory(rootRequire, "typebox"),
	};
	const runtimeArchives = Object.fromEntries(
		await Promise.all(
			Object.keys(runtimeDirectories).map(async (name) => {
				const directory = runtimeDirectories[name];
				if (!directory) throw new Error(`Cannot resolve standalone runtime dependency ${name}`);
				return [
					name,
					(await packPackageArchive(directory, join(packsDirectory, name), bunEnvironment)).archivePath,
				] as const;
			}),
		),
	) as Record<string, string>;
	const agentsRequire = createRequire(join(root, "packages", "pi-stuff-agents", "package.json"));
	const agentsRuntimeArchives = Object.fromEntries(
		await Promise.all(
			Object.keys(agentsRuntimeVersions).map(
				async (name) =>
					[
						name,
						(
							await packPackageArchive(
								await resolvePackageDirectory(agentsRequire, name),
								join(packsDirectory, `agents-${name}`),
								bunEnvironment,
							)
						).archivePath,
					] as const,
			),
		),
	) as Record<string, string>;
	// biome-ignore lint/complexity/useLiteralKeys: this record is deliberately index-signature-only under noPropertyAccessFromIndexSignature
	const typeboxArchive = runtimeArchives["typebox"];
	if (!typeboxArchive) throw new Error("Standalone dependency archive is missing typebox");
	const install = (installDirectory: string, npmCacheDirectory: string, archive: string): void => {
		run(
			[
				"npm",
				"install",
				"--prefix",
				installDirectory,
				"--ignore-scripts",
				"--legacy-peer-deps",
				"--no-audit",
				"--no-fund",
				"--offline",
				archive,
			],
			root,
			{
				...process.env,
				npm_config_cache: npmCacheDirectory,
				npm_config_update_notifier: "false",
			},
		);
	};

	const releaseNames = new Set(releaseManifest.artifacts.map(({ name }) => name));
	const externalArchives: Readonly<Record<string, string>> = { ...runtimeArchives, ...agentsRuntimeArchives };
	const archiveManifests = new Map<
		string,
		{
			bundledDependencies?: unknown;
			dependencies?: Record<string, unknown>;
			peerDependencies?: Record<string, unknown>;
		}
	>();
	const readArchiveManifest = (name: string) => {
		const existing = archiveManifests.get(name);
		if (existing) return existing;
		const manifest = JSON.parse(run(["tar", "-xOzf", releaseArchive(name), "package/package.json"], root)) as {
			bundledDependencies?: unknown;
			dependencies?: Record<string, unknown>;
			peerDependencies?: Record<string, unknown>;
		};
		archiveManifests.set(name, manifest);
		return manifest;
	};
	const extractRelease = (name: string, installDirectory: string): void => {
		const target = join(installDirectory, "node_modules", ...name.split("/"));
		mkdirSync(target, { recursive: true });
		run(
			["tar", "--extract", "--gzip", "--file", releaseArchive(name), "--directory", target, "--strip-components=1"],
			root,
		);
	};
	const installReleaseClosure = (name: string, installDirectory: string, npmCacheDirectory: string): void => {
		const installed = new Set<string>();
		const visiting = new Set<string>();
		const visit = (dependency: string): void => {
			if (installed.has(dependency)) return;
			if (visiting.has(dependency)) throw new Error(`Circular standalone release dependency at ${dependency}`);
			if (!releaseNames.has(dependency)) {
				const archive = externalArchives[dependency];
				if (!archive) throw new Error(`Standalone release dependency has no offline archive: ${dependency}`);
				install(installDirectory, npmCacheDirectory, archive);
				installed.add(dependency);
				return;
			}
			visiting.add(dependency);
			const manifest = readArchiveManifest(dependency);
			const bundled = new Set(readBundledDependencies(manifest.bundledDependencies));
			for (const child of Object.keys(manifest.dependencies ?? {}).sort()) {
				if (!bundled.has(child)) visit(child);
			}
			// Context intentionally preserves the audited upstream manifest byte-for-byte.
			// Its published build embeds every dependency used by the certified lexical
			// profile, while the disabled local-embedding branch remains a dynamic
			// Transformers import. Extracting this one release mirrors the certified
			// Aggregate install and prevents npm's offline reifier from fetching that
			// deliberately unused branch merely because upstream declares it as required.
			if (dependency === "@jczhang02/pi-stuff-context") extractRelease(dependency, installDirectory);
			else install(installDirectory, npmCacheDirectory, releaseArchive(dependency));
			const releasePeers = Object.keys(manifest.peerDependencies ?? {})
				.filter((peer) => releaseNames.has(peer))
				.sort((left, right) => {
					if (left === "@jczhang02/pi-stuff-context") return 1;
					if (right === "@jczhang02/pi-stuff-context") return -1;
					return left.localeCompare(right);
				});
			for (const peer of releasePeers) visit(peer);
			visiting.delete(dependency);
			installed.add(dependency);
		};
		visit(name);
	};

	// Install every exact internal dependency from this release set before its
	// consumer. Unknown unbundled dependencies fail instead of reaching a registry.
	installReleaseClosure("@jczhang02/pi-stuff-context", contextInstallDirectory, contextNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-btw", btwInstallDirectory, btwNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-rtk", rtkInstallDirectory, rtkNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-codex", codexInstallDirectory, codexNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-goal", goalInstallDirectory, goalNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-agents", agentsInstallDirectory, agentsNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-todo", todoInstallDirectory, todoNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-tools", toolsInstallDirectory, toolsNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-web", webInstallDirectory, webNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-mcp", mcpInstallDirectory, mcpNpmCacheDirectory);
	installReleaseClosure("@jczhang02/pi-stuff-work", workInstallDirectory, workNpmCacheDirectory);
	await Promise.all([
		linkCertifiedHostPeers(webInstallDirectory, "@jczhang02/pi-stuff-web"),
		linkCertifiedHostPeers(mcpInstallDirectory, "@jczhang02/pi-stuff-mcp"),
		linkCertifiedHostPeers(workInstallDirectory, "@jczhang02/pi-stuff-work"),
	]);

	const verifyUiDependency = async (installDirectory: string, capability: string): Promise<void> => {
		const installedRoot = join(installDirectory, "node_modules");
		const uiManifest = JSON.parse(await readFile(join(installedRoot, uiPackageName, "package.json"), "utf8")) as {
			version?: unknown;
		};
		const manifest = JSON.parse(
			await readFile(join(installedRoot, "@jczhang02", capability, "package.json"), "utf8"),
		) as { dependencies?: Record<string, unknown> };
		if (typeof uiManifest.version !== "string" || manifest.dependencies?.[uiPackageName] !== uiManifest.version) {
			throw new Error(`${capability} must install ${uiPackageName} as an exact runtime dependency`);
		}
	};
	await verifyUiDependency(btwInstallDirectory, "pi-stuff-btw");
	await verifyUiDependency(rtkInstallDirectory, "pi-stuff-rtk");
	await verifyUiDependency(codexInstallDirectory, "pi-stuff-codex");
	await verifyUiDependency(goalInstallDirectory, "pi-stuff-goal");
	await verifyUiDependency(agentsInstallDirectory, "pi-stuff-agents");
	await verifyUiDependency(todoInstallDirectory, "pi-stuff-todo");
	await verifyUiDependency(toolsInstallDirectory, "pi-stuff-tools");
	await verifyUiDependency(mcpInstallDirectory, "pi-stuff-mcp");
	await verifyUiDependency(workInstallDirectory, "pi-stuff-work");

	const verifyContextDependency = async (installDirectory: string, capability: string): Promise<void> => {
		const installedRoot = join(installDirectory, "node_modules");
		const contextManifest = JSON.parse(
			await readFile(join(installedRoot, "@jczhang02/pi-stuff-context/package.json"), "utf8"),
		) as { version?: unknown };
		const manifest = JSON.parse(
			await readFile(join(installedRoot, "@jczhang02", capability, "package.json"), "utf8"),
		) as { peerDependencies?: Record<string, unknown> };
		if (
			typeof contextManifest.version !== "string" ||
			manifest.peerDependencies?.["@jczhang02/pi-stuff-context"] !== contextManifest.version
		) {
			throw new Error(`${capability} must declare Context as an exact shared-runtime peer`);
		}
	};
	await verifyContextDependency(btwInstallDirectory, "pi-stuff-btw");
	await verifyContextDependency(agentsInstallDirectory, "pi-stuff-agents");

	const todoInstalledRoot = join(todoInstallDirectory, "node_modules");
	const goalInstalledRoot = join(goalInstallDirectory, "node_modules");
	const goalManifest = JSON.parse(
		await readFile(join(goalInstalledRoot, "@jczhang02/pi-stuff-goal/package.json"), "utf8"),
	) as { dependencies?: Record<string, unknown> };
	const goalTypeboxManifest = JSON.parse(await readFile(join(goalInstalledRoot, "typebox/package.json"), "utf8")) as {
		version?: unknown;
	};
	if (
		goalTypeboxManifest.version !== "1.3.7" ||
		goalManifest.dependencies?.["typebox"] !== goalTypeboxManifest.version
	) {
		throw new Error("Standalone Goal must install the certified exact typebox runtime dependency");
	}
	const todoManifest = JSON.parse(
		await readFile(join(todoInstalledRoot, "@jczhang02/pi-stuff-todo/package.json"), "utf8"),
	) as { dependencies?: Record<string, unknown> };
	const typeboxManifest = JSON.parse(await readFile(join(todoInstalledRoot, "typebox/package.json"), "utf8")) as {
		version?: unknown;
	};
	// biome-ignore lint/complexity/useLiteralKeys: this record is deliberately index-signature-only under noPropertyAccessFromIndexSignature
	if (typeboxManifest.version !== "1.3.7" || todoManifest.dependencies?.["typebox"] !== typeboxManifest.version) {
		throw new Error("Standalone Todo must install the certified exact typebox runtime dependency");
	}
	const installedTodoToolsManifest = JSON.parse(
		await readFile(join(todoInstalledRoot, "@jczhang02/pi-stuff-tools/package.json"), "utf8"),
	) as { version?: unknown };
	if (
		typeof installedTodoToolsManifest.version !== "string" ||
		todoManifest.dependencies?.["@jczhang02/pi-stuff-tools"] !== installedTodoToolsManifest.version
	) {
		throw new Error("Standalone Todo must install Tools as an exact runtime dependency");
	}

	const agentsInstalledRoot = join(agentsInstallDirectory, "node_modules");
	const agentsManifest = JSON.parse(
		await readFile(join(agentsInstalledRoot, "@jczhang02/pi-stuff-agents/package.json"), "utf8"),
	) as { dependencies?: Record<string, unknown>; peerDependencies?: Record<string, unknown> };
	const installedAgentsToolsManifest = JSON.parse(
		await readFile(join(agentsInstalledRoot, "@jczhang02/pi-stuff-tools/package.json"), "utf8"),
	) as { version?: unknown };
	if (
		typeof installedAgentsToolsManifest.version !== "string" ||
		agentsManifest.dependencies?.["@jczhang02/pi-stuff-tools"] !== installedAgentsToolsManifest.version
	) {
		throw new Error("Standalone Agents must install Tools as an exact runtime dependency");
	}
	const installedAgentsWorkManifest = JSON.parse(
		await readFile(join(agentsInstalledRoot, "@jczhang02/pi-stuff-work/package.json"), "utf8"),
	) as { version?: unknown };
	if (
		typeof installedAgentsWorkManifest.version !== "string" ||
		agentsManifest.peerDependencies?.["@jczhang02/pi-stuff-work"] !== installedAgentsWorkManifest.version
	) {
		throw new Error("Standalone Agents must share Work as an exact peer dependency");
	}
	const workInstalledRoot = join(workInstallDirectory, "node_modules");
	const workManifest = JSON.parse(
		await readFile(join(workInstalledRoot, "@jczhang02/pi-stuff-work/package.json"), "utf8"),
	) as { dependencies?: Record<string, unknown> };
	const installedWorkToolsManifest = JSON.parse(
		await readFile(join(workInstalledRoot, "@jczhang02/pi-stuff-tools/package.json"), "utf8"),
	) as { version?: unknown };
	const installedWorkTypeboxManifest = JSON.parse(
		await readFile(join(workInstalledRoot, "typebox/package.json"), "utf8"),
	) as { version?: unknown };
	if (
		workManifest.dependencies?.["@jczhang02/pi-stuff-tools"] !== installedWorkToolsManifest.version ||
		workManifest.dependencies?.["typebox"] !== installedWorkTypeboxManifest.version ||
		installedWorkTypeboxManifest.version !== "1.3.7"
	) {
		throw new Error("Standalone Work must install exact Tools and typebox runtime dependencies");
	}
	const installedWebFork = join(
		webInstallDirectory,
		"node_modules/@jczhang02/pi-stuff-web/node_modules/@jczhang02/pi-web-access",
	);
	const installedMcpFork = join(
		mcpInstallDirectory,
		"node_modules/@jczhang02/pi-stuff-mcp/node_modules/@jczhang02/pi-mcp-adapter",
	);
	await verifyInternalForkIdentity(
		installedWebFork,
		"@jczhang02/pi-web-access",
		embeddedForkVersions["@jczhang02/pi-web-access"],
	);
	await verifyRuntimeDependencyClosure(installedWebFork);
	await verifyInternalForkIdentity(
		installedMcpFork,
		"@jczhang02/pi-mcp-adapter",
		embeddedForkVersions["@jczhang02/pi-mcp-adapter"],
	);
	await verifyRuntimeDependencyClosure(installedMcpFork);
	for (const [name, expectedVersion] of Object.entries(agentsRuntimeVersions)) {
		const dependencyManifest = JSON.parse(
			await readFile(join(agentsInstalledRoot, name, "package.json"), "utf8"),
		) as { version?: unknown };
		if (dependencyManifest.version !== expectedVersion || agentsManifest.dependencies?.[name] !== expectedVersion) {
			throw new Error(`Standalone Agents must install exact ${name} ${expectedVersion}`);
		}
	}

	const installedBtw = join(btwInstallDirectory, "node_modules/@jczhang02/pi-stuff-btw");
	const installedContext = join(contextInstallDirectory, "node_modules/@jczhang02/pi-stuff-context");
	const installedContextManifest = JSON.parse(await readFile(join(installedContext, "package.json"), "utf8")) as {
		dependencies?: Record<string, unknown>;
	};
	const installedContextToolsManifest = JSON.parse(
		await readFile(join(contextInstallDirectory, "node_modules/@jczhang02/pi-stuff-tools/package.json"), "utf8"),
	) as { version?: unknown };
	if (
		typeof installedContextToolsManifest.version !== "string" ||
		installedContextManifest.dependencies?.["@jczhang02/pi-stuff-tools"] !== installedContextToolsManifest.version
	) {
		throw new Error("Standalone Context must install Tools as an exact runtime dependency");
	}
	const installedMagicContext = join(installedContext, "node_modules/@cortexkit/pi-magic-context");
	await verifyPackageIdentity(installedMagicContext, "@cortexkit/pi-magic-context", "0.33.1");
	const installedMagicContextManifest = JSON.parse(
		await readFile(join(installedMagicContext, "package.json"), "utf8"),
	) as { dependencies?: Record<string, unknown> };
	if (
		JSON.stringify(Object.entries(installedMagicContextManifest.dependencies ?? {}).sort()) !==
		JSON.stringify(Object.entries(officialMagicContextDependencies).sort())
	) {
		throw new Error("Standalone Context changed the audited official Magic Context dependency contract");
	}
	if (
		await stat(join(installedMagicContext, "node_modules/@huggingface/transformers")).then(
			() => true,
			() => false,
		)
	) {
		throw new Error("Standalone Context unexpectedly installed the disabled local-embedding runtime");
	}
	if (installedContextManifest.dependencies?.["@cortexkit/pi-magic-context"] !== "0.33.1") {
		throw new Error("Standalone Context must install the exact official Magic Context runtime");
	}
	const contextSmoke = await runPiRpcSmoke({
		piBinary,
		packages: [installedContext],
		cwd: contextInstallDirectory,
	});
	if (contextSmoke.commandNames.some((name) => name.startsWith("ctx-") || name.includes("magic"))) {
		throw new Error("Standalone Context Package exposed Magic Context's removed command surface at startup");
	}
	const btwSmoke = await runPiRpcSmoke({ piBinary, packages: [installedBtw], cwd: btwInstallDirectory });
	if (!btwSmoke.commandNames.includes("btw")) throw new Error("Standalone BTW Package did not register /btw");
	const installedRtk = join(rtkInstallDirectory, "node_modules/@jczhang02/pi-stuff-rtk");
	const rtkSmoke = await runPiRpcSmoke({ piBinary, packages: [installedRtk], cwd: rtkInstallDirectory });
	if (!rtkSmoke.commandNames.includes("rtk")) throw new Error("Standalone RTK Package did not register /rtk");
	if (rtkSmoke.commandNames.includes("ui")) {
		throw new Error("Standalone RTK Package claimed the presentation-only /ui surface");
	}
	if (rtkSmoke.createdFiles.some((path) => path.endsWith("pi-stuff-rtk.json"))) {
		throw new Error("Standalone RTK Package wrote settings during startup");
	}
	const codexInstalledRoot = join(codexInstallDirectory, "node_modules");
	const codexManifest = JSON.parse(
		await readFile(join(codexInstalledRoot, "@jczhang02/pi-stuff-codex/package.json"), "utf8"),
	) as { dependencies?: Record<string, unknown> };
	const installedCodexToolsManifest = JSON.parse(
		await readFile(join(codexInstalledRoot, "@jczhang02/pi-stuff-tools/package.json"), "utf8"),
	) as { version?: unknown };
	const installedCodexTypeboxManifest = JSON.parse(
		await readFile(join(codexInstalledRoot, "typebox/package.json"), "utf8"),
	) as { version?: unknown };
	if (
		codexManifest.dependencies?.["@jczhang02/pi-stuff-tools"] !== installedCodexToolsManifest.version ||
		codexManifest.dependencies?.["typebox"] !== installedCodexTypeboxManifest.version ||
		installedCodexTypeboxManifest.version !== "1.3.7"
	) {
		throw new Error("Standalone Codex must install exact Tools and typebox runtime dependencies");
	}
	const codexSmoke = await runPiRpcSmoke({
		piBinary,
		packages: [join(codexInstalledRoot, "@jczhang02/pi-stuff-codex")],
		cwd: codexInstallDirectory,
	});
	if (!codexSmoke.commandNames.includes("codex")) {
		throw new Error("Standalone Codex Package did not register /codex");
	}
	for (const excluded of ["codex-settings", "image-generation", "voice", "web"]) {
		if (codexSmoke.commandNames.includes(excluded)) {
			throw new Error(`Standalone Codex retained removed command /${excluded}`);
		}
	}
	if (codexSmoke.createdFiles.includes("agent/pi-stuff-codex.json")) {
		throw new Error("Standalone Codex wrote settings during startup");
	}
	const goalSmoke = await runPiRpcSmoke({
		piBinary,
		extensions: [goalToolInspector],
		packages: [join(goalInstalledRoot, "@jczhang02/pi-stuff-goal")],
		cwd: goalInstallDirectory,
	});
	if (!goalSmoke.commandNames.includes("goal") || !goalSmoke.commandNames.includes("goal-tools-certified")) {
		throw new Error("Standalone Goal did not register /goal and both terminal tools");
	}
	const agentsSmoke = await runPiRpcSmoke({
		piBinary,
		packages: [join(agentsInstalledRoot, "@jczhang02/pi-stuff-agents")],
		cwd: agentsInstallDirectory,
	});
	if (!agentsSmoke.commandNames.includes("agents")) {
		throw new Error("Standalone Agents Package did not register /agents");
	}
	const todoSmoke = await runPiRpcSmoke({
		piBinary,
		extensions: [todoToolInspector],
		packages: [join(todoInstalledRoot, "@jczhang02/pi-stuff-todo")],
		cwd: todoInstallDirectory,
	});
	if (!todoSmoke.commandNames.includes("todo-tools-certified")) {
		throw new Error("Standalone Todo did not register and activate all four Task tools");
	}
	const toolsSmoke = await runPiRpcSmoke({
		piBinary,
		packages: [join(toolsInstallDirectory, "node_modules/@jczhang02/pi-stuff-tools")],
		cwd: toolsInstallDirectory,
	});
	if (!toolsSmoke.commandNames.includes("tools")) {
		throw new Error("Standalone Tools Package did not register /tools");
	}
	if (!toolsSmoke.commandNames.includes("ui")) {
		throw new Error("Standalone Tools Package did not register the shared /ui settings surface");
	}
	if (toolsSmoke.commandNames.includes("tool-settings")) {
		throw new Error("Standalone Tools Package retained the removed /tool-settings entry point");
	}
	const webSmoke = await runPiRpcSmoke({
		piBinary,
		extensions: [webToolInspector],
		packages: [join(webInstallDirectory, "node_modules/@jczhang02/pi-stuff-web")],
		cwd: webInstallDirectory,
	});
	if (!webSmoke.commandNames.includes("web-tools-certified")) {
		throw new Error("Standalone Web Package did not register its three bounded Tools");
	}
	await verifyWebIntegration({ packagePath: join(webInstallDirectory, "node_modules/@jczhang02/pi-stuff-web") });
	const mcpSmoke = await runPiRpcSmoke({
		piBinary,
		extensions: [mcpToolInspector],
		packages: [join(mcpInstallDirectory, "node_modules/@jczhang02/pi-stuff-mcp")],
		cwd: mcpInstallDirectory,
	});
	if (!mcpSmoke.commandNames.includes("mcp") || !mcpSmoke.commandNames.includes("mcp-auth")) {
		throw new Error("Standalone MCP Package did not register /mcp and /mcp-auth");
	}
	if (!mcpSmoke.commandNames.includes("mcp-tools-certified")) {
		throw new Error("Standalone MCP Package did not expose exactly one gateway Tool");
	}
	const workSmoke = await runPiRpcSmoke({
		piBinary,
		extensions: [workToolInspector],
		packages: [join(workInstalledRoot, "@jczhang02/pi-stuff-work")],
		cwd: workInstallDirectory,
	});
	if (!workSmoke.commandNames.includes("tasks") || !workSmoke.commandNames.includes("work-tools-certified")) {
		throw new Error("Standalone Work did not expose /tasks and the certified active Tool surface");
	}
	if (workSmoke.createdFiles.some((path) => path.includes("pi-stuff-work") || path.includes("tasks"))) {
		throw new Error("Standalone Work eagerly wrote runtime state during startup");
	}
}

async function verifySharedCoordinatorIdentity(
	extractDirectory: string,
	archiveFiles: readonly string[],
): Promise<void> {
	const entries = archiveFiles.filter((path) => path.endsWith("node_modules/@jczhang02/pi-stuff-ui/index.ts"));
	if (entries.length === 0) throw new Error("Package archive contains no pi-stuff-ui runtime");
	const peerPrefix = "package/node_modules/@earendil-works/";
	if (archiveFiles.some((path) => path.startsWith(peerPrefix))) {
		throw new Error("Aggregate Package must not bundle Host-supplied Pi peers");
	}
	const peerScope = join(extractDirectory, peerPrefix);
	await mkdir(peerScope, { recursive: true });
	for (const dependency of expectedPiPeers[uiPackageName] ?? []) {
		const packageName = dependency.slice("@earendil-works/".length);
		await symlink(join(root, "node_modules", dependency), join(peerScope, packageName), "dir");
	}

	try {
		const events = {};
		let shared: unknown;
		for (const [index, entry] of entries.entries()) {
			const moduleUrl = `${pathToFileURL(join(extractDirectory, entry)).href}?identity=${index}`;
			const uiModule = (await import(moduleUrl)) as {
				getCommandDialogCoordinator(pi: { events: object; on(event: string, handler: () => void): void }): unknown;
			};
			const coordinator = uiModule.getCommandDialogCoordinator({ events, on: () => {} });
			shared ??= coordinator;
			if (coordinator !== shared) {
				throw new Error("Physical pi-stuff-ui copies do not share one logical coordinator");
			}
		}
	} finally {
		await rm(peerScope, { recursive: true, force: true });
	}
}

async function verifyBundledSuiteMetadata(extractDirectory: string, archiveFiles: readonly string[]): Promise<void> {
	const aggregate = JSON.parse(await readFile(join(extractDirectory, "package/package.json"), "utf8")) as {
		dependencies?: Record<string, unknown>;
		devDependencies?: Record<string, unknown>;
		name?: unknown;
		peerDependencies?: Record<string, unknown>;
	};
	if (typeof aggregate.name !== "string") throw new Error("Aggregate Package has no name");
	verifyPiDependencyContract(aggregate.name, aggregate.peerDependencies, aggregate.devDependencies);
	const manifests = archiveFiles.filter((path) =>
		/(?:^|\/)node_modules\/@jczhang02\/pi-stuff-[^/]+\/package\.json$/.test(path),
	);
	if (manifests.length === 0) throw new Error("Package archive contains no Pi Stuff Capability manifests");
	for (const path of manifests) {
		const manifest = JSON.parse(await readFile(join(extractDirectory, path), "utf8")) as {
			devDependencies?: Record<string, unknown>;
			license?: unknown;
			name?: unknown;
			peerDependencies?: Record<string, unknown>;
			version?: unknown;
		};
		const expectedLicense = manifest.name === "@jczhang02/pi-stuff-work" ? "ISC" : "MIT";
		if (manifest.license !== expectedLicense) throw new Error(`${path} must declare the ${expectedLicense} license`);
		if (typeof manifest.name !== "string" || aggregate.dependencies?.[manifest.name] !== manifest.version) {
			throw new Error(`${path} does not match the Aggregate's exact dependency version`);
		}
		verifyPiDependencyContract(manifest.name, manifest.peerDependencies, manifest.devDependencies);
		const licensePath = path.replace(/package\.json$/, "LICENSE");
		if (!archiveFiles.includes(licensePath)) throw new Error(`${path} is missing its LICENSE file`);
		if (
			(manifest.name === "@jczhang02/pi-stuff-btw" || manifest.name === "@jczhang02/pi-stuff-todo") &&
			(await sha256File(join(extractDirectory, licensePath))) !== forkLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-agents" &&
			(await sha256File(join(extractDirectory, licensePath))) !== agentsLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-codex" &&
			(await sha256File(join(extractDirectory, licensePath))) !== codexLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (manifest.name === "@jczhang02/pi-stuff-codex") {
			const packageRoot = dirname(join(extractDirectory, path));
			for (const runtimePath of codexRuntimeFiles) {
				const archivePath = path.replace(/package\.json$/u, runtimePath);
				if (!archiveFiles.includes(archivePath)) throw new Error(`Codex runtime is missing ${runtimePath}`);
				const expectedHash = codexNativeSha256[runtimePath];
				if (expectedHash && (await sha256File(join(packageRoot, runtimePath))) !== expectedHash) {
					throw new Error(`Codex native helper hash changed: ${runtimePath}`);
				}
				if (runtimePath.startsWith("native/")) {
					const mode = (await stat(join(packageRoot, runtimePath))).mode;
					if ((mode & 0o111) === 0) throw new Error(`Codex native helper is not executable: ${runtimePath}`);
				}
			}
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-tools" &&
			(await sha256File(join(extractDirectory, licensePath))) !== toolsLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-rtk" &&
			(await sha256File(join(extractDirectory, licensePath))) !== rtkLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-goal" &&
			(await sha256File(join(extractDirectory, licensePath))) !== goalLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-web" &&
			(await sha256File(join(extractDirectory, licensePath))) !== webLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-mcp" &&
			(await sha256File(join(extractDirectory, licensePath))) !== agentsLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
		if (
			manifest.name === "@jczhang02/pi-stuff-work" &&
			(await sha256File(join(extractDirectory, licensePath))) !== workLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream ISC notice`);
		}
	}
	const expectedCapabilities = [
		"@jczhang02/pi-stuff-context",
		"@jczhang02/pi-stuff-web",
		"@jczhang02/pi-stuff-mcp",
		"@jczhang02/pi-stuff-work",
	];
	for (const capability of expectedCapabilities) {
		const suffix = `node_modules/${capability}/package.json`;
		const copies = manifests.filter((path) => path.endsWith(suffix));
		if (copies.length !== 1) {
			throw new Error(
				`Aggregate must contain exactly one physical ${capability}; received ${String(copies.length)}`,
			);
		}
	}
	const magicContextManifests = archiveFiles.filter((path) =>
		path.endsWith("node_modules/@cortexkit/pi-magic-context/package.json"),
	);
	if (magicContextManifests.length !== 1) {
		throw new Error(
			`Aggregate must contain exactly one physical Magic Context runtime; received ${String(magicContextManifests.length)}`,
		);
	}
	const magicContextManifestPath = magicContextManifests[0] as string;
	const magicContextRoot = dirname(magicContextManifestPath);
	const magicContextManifest = JSON.parse(
		await readFile(join(extractDirectory, magicContextManifestPath), "utf8"),
	) as { license?: unknown; name?: unknown; repository?: { url?: unknown }; version?: unknown };
	if (
		magicContextManifest.name !== "@cortexkit/pi-magic-context" ||
		magicContextManifest.version !== "0.33.1" ||
		magicContextManifest.license !== "MIT" ||
		magicContextManifest.repository?.url !== "https://github.com/cortexkit/magic-context"
	) {
		throw new Error("Aggregate contains an uncertified official Magic Context runtime");
	}
	const actualMagicContextFiles = archiveFiles
		.filter((path) => path.startsWith(`${magicContextRoot}/`))
		.map((path) => path.slice(magicContextRoot.length + 1))
		.filter((path) => !path.startsWith("node_modules/"))
		.sort();
	const expectedMagicContextFiles = Object.keys(officialMagicContextFiles).sort();
	if (JSON.stringify(actualMagicContextFiles) !== JSON.stringify(expectedMagicContextFiles)) {
		throw new Error("The official Magic Context runtime file inventory does not match the audited npm tarball");
	}
	for (const [path, expectedHash] of Object.entries(officialMagicContextFiles)) {
		if ((await sha256File(join(extractDirectory, magicContextRoot, path))) !== expectedHash) {
			throw new Error(`The official Magic Context runtime file changed: ${path}`);
		}
	}

	const provenance = [
		{
			capability: "pi-stuff-agents",
			deltaHeading: "Major removed upstream areas include",
			required: [
				"pi-subagents",
				"0.38.0",
				"89de10e4bc8895e7948704c38620a5b35ddcd17e",
				"d7c3ce31cf71c0b96d02f2d48c1a715c07868dd1",
				"b44d87afc519f96c627fe56320c7c405e7b48cd22791c7526759b6c10a061b4f",
				"sha512-8wGQiX6rkR5J4V+AnWtQg3+LmC+cHnZIM1f/VWTjCTkVmcoKdeLsTAYG6BS2yKAugyEUjNUGj3vE5d9nj9m61A==",
				"2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c",
			],
		},
		{
			capability: "pi-stuff-btw",
			deltaHeading: "## Pi Stuff changes",
			required: [
				"@juicesharp/rpiv-btw",
				"2.3.1",
				"75823a68024a0a649cc28087976074be791ca554",
				"568af4a3235b344a4f91d354cc0d1c967977cc06",
				"5318bbf4256b83825cb56a314bdbfa605e495e68043d83a169a65dd35ceabf59",
			],
		},
		{
			capability: "pi-stuff-context",
			deltaHeading: "## Pi Stuff adapter policy",
			required: [
				"cortexkit/magic-context",
				"v0.33.1",
				"@cortexkit/pi-magic-context@0.33.1",
				"075e21f77c671781b25de9440c1a727f5fa4413d",
				"sha512-mybLPirFtUqVb+7cTS2Bpg/h33NbSSQvUOSfeP1C5QrxMVptQjGeNnSTLLrkfH5i5BUVY3D/r3OGE3PhzWsX0A==",
				"b0792c428cb1238ba33302403f6e13be3c865d77",
				"106a276b631bbff324d17091ceb82959779678945596d17fd75d3b23abb6f261",
			],
		},
		{
			capability: "pi-stuff-rtk",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"pi-rtk-optimizer",
				"0.9.0",
				"v0.9.0",
				"d155d253cb2f1358e34e717d47a82ebccb08cb8e",
				"489bf5f3c7ce619071c00fb0275cd4123e52a439",
				"8a7dd7e5570d7744d4b6508479a3674fe8c49286",
				"4f7c6d98ed90a999deee7b5a4f8315bd0fd17f99d21022b0d0b64f77bc11d3c8",
				"34975116da11e09e502501daf758143e0b22ed3a42a10eb67fb693a6270d9e36",
				"1d8bf5f1861f5ce33236400b1d93b967aec30b6a456e9a0b43b1584c5200119a",
				"5a5b40cd6807cec980af2e3caa2cdff1fc17d101befb287d9c207a1bfbc9d250",
				"sha512-yj5DEdutRco5WvYEMEO0krZJP5Z6CpuNZoxlXSGmHEi2srB5Gao1xah/RnmVDn2se1FcqlmtS8+K/nzzkq0Pug==",
				"7d9473dcd84975a7191bc13dcc744f3b4d6578c937c879cc73e31e0107fa4d46",
			],
		},
		{
			capability: "pi-stuff-todo",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"@juicesharp/rpiv-todo",
				"2.3.1",
				"75823a68024a0a649cc28087976074be791ca554",
				"8797586bad201f4b2153505347c3b997c320eaa2",
				"b0ae0f1f4245f471c3fa724dc50425cfa241eb37e399c4948d393fe7965d1fa8",
			],
		},
		{
			capability: "pi-stuff-codex",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"@howaboua/pi-codex-conversion",
				"3.0.7",
				"@howaboua/pi-codex-conversion@3.0.7",
				"b3591d996efbf6df293e426dea2bb2dd17fcbfe6",
				"https://github.com/jczhang02/pi-codex-conversion",
				"b545c94041017d000e2c8b2f6272705d21b85dfb",
			],
		},
		{
			capability: "pi-stuff-goal",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"@narumitw/pi-goal",
				"0.48.0",
				"f0963e4c343124a6f1419163b0425f571282c9b0",
				"https://github.com/jczhang02/pi-extensions",
				"pi-stuff-goal-v0.48.0",
				"2b8a6ec48afb4f1f5d7139b7ae42adc58c338bcf",
				"sha512-IOvGEPvqCwuHCNN+hAAGG1B4IzlC8QUj/clPq3E3G5iRHdNip6nsqWnTFCBnLHEiNrMFJkJw0L14n4ugjSft1Q==",
				"5293e92f073f47012e723990a8605431b438757e9c6eb00c89868b1203e157da",
			],
		},
		{
			capability: "pi-stuff-tools",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"@mobrienv/pi-tidy-tools",
				"0.4.1",
				"pi-tidy-tools-v0.4.1",
				"4b251377f1b64f904704e7f760e8947688d12a9a",
				"3412d29d584f9226b02a13279d88a3ea03a1422e",
				"59bf767e047a0799257af3c510a92f0841db2791e8e11aceca14fc2f7221f71a",
			],
		},
		{
			capability: "pi-stuff-web",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"nicobailon/pi-web-access",
				"0.18.0",
				"d2aab00dcf0547572276d9de4bc4a2a49d640e13",
				"8e11f1a41547a9415b6d36742a04e3ee2896bcea",
				"pi-stuff-v0.18.0-4",
				"7030811f8c4b0e75a1e5fc60f72916ebec2add2d9d615cf5a01fbde349eaa638",
			],
		},
		{
			capability: "pi-stuff-mcp",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"nicobailon/pi-mcp-adapter",
				"2.19.0",
				"cde58793327b15d65f86e59ec9025d649cb8c300",
				"2333b79429ea28f6a7d24ca7ad7a169e07b7cf7d",
				"pi-stuff-v2.19.0-7",
				"b0fbbcdcca56c28c49884b69002f1519504ab538afd1abf86e00247aeb441478",
			],
		},
		{
			capability: "pi-stuff-work",
			deltaHeading: "## Pi Stuff delta",
			required: [
				"pi-background-tasks",
				"2.0.0",
				"db632653682c00852a38c0972a761fb1e9f24dc3",
				"7b0b1220bacc3fa2516cf9d7cdb1933d90b12b2b3dcd36c56c882ab41e6cfaf0",
				"sha512-LyTFnuPbL2BhzNQaq7l7KN3neV2WyQbH1uEiSTM4cpyAw7489SATqQDoZ9SCqkRIBH/zktP7xvk/VNerpU3QPQ==",
				workLicenseSha256,
			],
		},
	] as const;
	for (const record of provenance) {
		const { capability } = record;
		const upstream = `package/node_modules/@jczhang02/${capability}/UPSTREAM.md`;
		if (!archiveFiles.includes(upstream)) throw new Error(`${capability} is missing fork provenance`);
		const contents = await readFile(join(extractDirectory, upstream), "utf8");
		for (const required of [...record.required, record.deltaHeading]) {
			if (!contents.includes(required)) throw new Error(`${capability} provenance is missing ${required}`);
		}
		if (!contents.slice(contents.indexOf(record.deltaHeading) + record.deltaHeading.length).includes("\n- ")) {
			throw new Error(`${capability} provenance has no local change record`);
		}
	}
}

export async function certifyReleaseArtifacts(
	releaseDirectory: string,
	piBinary = "/opt/pi-coding-agent/pi",
): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-package-"));

	try {
		verifyPiVersion(piBinary);
		await verifyPiHostProvenance(piBinary);
		const bunTemporaryDirectory = join(temporaryDirectory, "bun-tmp");
		const bunInstallDirectory = join(temporaryDirectory, "bun-install");
		const bunCacheDirectory = join(temporaryDirectory, "bun-cache");
		await Promise.all([mkdir(bunTemporaryDirectory), mkdir(bunInstallDirectory), mkdir(bunCacheDirectory)]);
		const bunEnvironment = {
			...process.env,
			BUN_INSTALL: bunInstallDirectory,
			BUN_INSTALL_CACHE_DIR: bunCacheDirectory,
			BUN_TMPDIR: bunTemporaryDirectory,
			TEMP: bunTemporaryDirectory,
			TMP: bunTemporaryDirectory,
			TMPDIR: bunTemporaryDirectory,
		};
		const releaseManifest = await readReleaseManifest(join(releaseDirectory, RELEASE_MANIFEST_FILENAME));
		const expectedReleaseFiles = new Set([
			RELEASE_MANIFEST_FILENAME,
			...releaseManifest.artifacts.map((artifact) => artifact.archive),
		]);
		const unexpectedReleaseFiles = (await readdir(releaseDirectory)).filter(
			(entry) => !expectedReleaseFiles.has(entry),
		);
		if (unexpectedReleaseFiles.length > 0) {
			throw new Error(`Unexpected release artifact files:\n${unexpectedReleaseFiles.sort().join("\n")}`);
		}
		await Promise.all(
			releaseManifest.artifacts.map((artifact) => verifyReleaseArtifactHash(releaseDirectory, artifact)),
		);
		for (const artifact of releaseManifest.artifacts) {
			const archivePath = resolveReleaseArchive(releaseDirectory, artifact);
			const archiveFiles = run(["tar", "-tzf", archivePath], root).trim().split("\n").sort();
			const archiveManifest = JSON.parse(
				run(["tar", "-xOzf", archivePath, "package/package.json"], root),
			) as PackageArchiveManifest;
			verifyPackageArchive(archiveManifest, archiveFiles);
			if (artifact.name === uiPackageName) verifyUiRuntimeArchive(archiveFiles);
			if (artifact.name === "@jczhang02/pi-stuff-codex") verifyCodexRuntimeArchive(archiveFiles);
			if (artifact.name === "@jczhang02/pi-stuff-work") verifyWorkRuntimeArchive(archiveFiles);
			run([process.execPath, "publish", "--dry-run", "--ignore-scripts", "--access", "public", archivePath], root, {
				...bunEnvironment,
				NPM_CONFIG_TOKEN: "pi-stuff-offline-certification",
			});
		}
		await verifyStandaloneInstalls(temporaryDirectory, piBinary, bunEnvironment, releaseDirectory, releaseManifest);
		const aggregateArtifact = releaseManifest.artifacts.find((artifact) => artifact.name === "@jczhang02/pi-stuff");
		if (!aggregateArtifact) throw new Error("Release manifest is missing the Aggregate Package");
		const archivePath = resolveReleaseArchive(releaseDirectory, aggregateArtifact);
		const archiveFiles = run(["tar", "-tzf", archivePath], root).trim().split("\n").sort();
		const manifest = JSON.parse(
			run(["tar", "-xOzf", archivePath, "package/package.json"], root),
		) as PackageArchiveManifest;
		verifyPackageArchive(manifest, archiveFiles);

		const extractDirectory = join(temporaryDirectory, "extract");
		await mkdir(extractDirectory);
		run(["tar", "-xzf", archivePath, "-C", extractDirectory], root);
		await verifyBundledSuiteMetadata(extractDirectory, archiveFiles);
		await verifySharedCoordinatorIdentity(extractDirectory, archiveFiles);
		const extractedPackage = join(extractDirectory, "package");
		const extractedWebFork = join(
			extractedPackage,
			"node_modules/@jczhang02/pi-stuff-web/node_modules/@jczhang02/pi-web-access",
		);
		const extractedMcpFork = join(
			extractedPackage,
			"node_modules/@jczhang02/pi-stuff-mcp/node_modules/@jczhang02/pi-mcp-adapter",
		);
		await verifyInternalForkIdentity(
			extractedWebFork,
			"@jczhang02/pi-web-access",
			embeddedForkVersions["@jczhang02/pi-web-access"],
		);
		await verifyRuntimeDependencyClosure(extractedWebFork);
		await verifyInternalForkIdentity(
			extractedMcpFork,
			"@jczhang02/pi-mcp-adapter",
			embeddedForkVersions["@jczhang02/pi-mcp-adapter"],
		);
		await verifyRuntimeDependencyClosure(extractedMcpFork);
		const extractedSmoke = await runPiRpcSmoke({
			piBinary,
			extensions: [goalToolInspector, webToolInspector, mcpToolInspector, workToolInspector],
			packages: [extractedPackage],
			timeoutMs: PACKED_AGGREGATE_SMOKE_TIMEOUT_MS,
		});
		if (
			!extractedSmoke.commandNames.includes("ui") ||
			!extractedSmoke.commandNames.includes("goal") ||
			!extractedSmoke.commandNames.includes("goal-tools-certified") ||
			extractedSmoke.commandNames.includes("tool-settings")
		) {
			throw new Error("Packed Aggregate did not expose the required /ui and /goal surfaces");
		}
		if (
			!extractedSmoke.commandNames.includes("web-tools-certified") ||
			!extractedSmoke.commandNames.includes("mcp-tools-certified") ||
			!extractedSmoke.commandNames.includes("mcp") ||
			!extractedSmoke.commandNames.includes("mcp-auth")
		) {
			throw new Error("Packed Aggregate did not expose the certified Web and MCP surfaces");
		}
		if (
			!extractedSmoke.commandNames.includes("tasks") ||
			!extractedSmoke.commandNames.includes("work-tools-certified")
		) {
			throw new Error("Packed Aggregate did not expose the certified Background Work surfaces");
		}
		await verifyGoalLifecycle({ piBinary, packagePath: extractedPackage });
		await verifyUiPty({ piBinary, packagePath: extractedPackage });
		await verifyGoalPty({ piBinary, packagePath: extractedPackage, columns: 56, rows: 24 });
		await verifyAgentsPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyAgentsExecutionMatrix({ piBinary, packagePath: extractedPackage });
		await verifyBtwPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyContextPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyRtkPty({ piBinary, packagePath: extractedPackage });
		await verifyMcpPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyToolsPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyToolsResumePty({ piBinary, packagePath: extractedPackage });
		await verifyWorkMonitorMatrix({ piBinary, packagePath: extractedPackage });
		await verifyWorkPty({ piBinary, packagePath: extractedPackage, columns: 96, rows: 30 });
		await writeReleaseVerification(releaseDirectory, CERTIFIED_PI_HOST_PROFILE);
		console.log(`Certified @jczhang02/pi-stuff with Pi Host ${CERTIFIED_PI_HOST_PROFILE}`);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-package-artifacts-"));
	try {
		verifyPiVersion(PI_BIN);
		await verifyPiHostProvenance(PI_BIN);
		const aggregateSmoke = await runPiRpcSmoke({
			piBinary: PI_BIN,
			extensions: [goalToolInspector, webToolInspector, mcpToolInspector, workToolInspector],
			packages: [aggregateDirectory],
		});
		if (
			!aggregateSmoke.commandNames.includes("ui") ||
			!aggregateSmoke.commandNames.includes("goal") ||
			!aggregateSmoke.commandNames.includes("goal-tools-certified") ||
			aggregateSmoke.commandNames.includes("tool-settings")
		) {
			throw new Error("Source Aggregate did not expose the required /ui and /goal surfaces");
		}
		if (
			!aggregateSmoke.commandNames.includes("web-tools-certified") ||
			!aggregateSmoke.commandNames.includes("mcp-tools-certified") ||
			!aggregateSmoke.commandNames.includes("mcp") ||
			!aggregateSmoke.commandNames.includes("mcp-auth")
		) {
			throw new Error("Source Aggregate did not expose the certified Web and MCP surfaces");
		}
		if (
			!aggregateSmoke.commandNames.includes("tasks") ||
			!aggregateSmoke.commandNames.includes("work-tools-certified")
		) {
			throw new Error("Source Aggregate did not expose the certified Background Work surfaces");
		}
		const releaseDirectory = join(temporaryDirectory, "release");
		await createReleaseArtifacts(releaseDirectory);
		await certifyReleaseArtifacts(releaseDirectory, PI_BIN);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	await main();
}
