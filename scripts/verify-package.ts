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
import { verifyPiHostProvenance } from "./verify-pi-host-provenance.ts";
import { verifyRtkPty } from "./verify-rtk-pty.ts";
import { verifyToolsPty } from "./verify-tools-pty.ts";
import { verifyToolsResumePty } from "./verify-tools-resume-pty.ts";
import { verifyUiPty } from "./verify-ui-pty.ts";

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
const codexNativeSha256: Readonly<Record<(typeof codexRuntimeFiles)[number], string>> = {
	"native/apply-patch/linux-x64/apply_patch": "9ded1c635a4e0e2aae2dd09d7f676b24fc4b377016f74c1a51d8b3b22ed6bb55",
	"native/imagegen/linux-x64/imagegen": "7822c5d5eced5b0f6ef4763e7d85209ff87be6342d793c1ef308a0908c1122a5",
	"native/view-image/linux-x64/view_image": "5b58243a8a64d926b6175b463017cdbbdda771ffc6da136eedeebeba80a33c23",
	"THIRD_PARTY_NOTICES.md": "",
	"LICENSES/Apache-2.0.txt": "",
};
const todoToolInspector = join(root, "test/fixtures/assert-todo-tools.ts");
const forkLicenseSha256 = "25d0d5e4e54033f939a9657109044f1d71a0b6e8db9adc400456ca9190df3fb1";
const agentsLicenseSha256 = "2d20dfacd9742706e564470dc77438608a1e54b0ed46959f080709389209093c";
const rtkLicenseSha256 = "7d9473dcd84975a7191bc13dcc744f3b4d6578c937c879cc73e31e0107fa4d46";
const codexLicenseSha256 = "ad600d98577a0949ad30c81867bd86f08f872ff12f6a7a519af14edc6f997ee9";
const toolsLicenseSha256 = "e6b72a9973ccabb20d8bef65a366a9b2357d6cea6cdd1eee4f2c3c69e61fb11c";
const magicContextLicenseSha256 = "0e3d1aa1cbe4aec50224fc6c91eb898d42949d6ff84fe515f9e2bb0663f5d483";
const agentsRuntimeVersions = {
	jiti: "2.7.0",
	typebox: "1.3.7",
} as const;
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
	"@jczhang02/pi-stuff-todo": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-tools": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-ui": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
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
	let directory = dirname(resolver.resolve(packageName));
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
	const todoInstallDirectory = join(temporaryDirectory, "standalone-todo");
	const todoNpmCacheDirectory = join(temporaryDirectory, "npm-cache-todo");
	const toolsInstallDirectory = join(temporaryDirectory, "standalone-tools");
	const toolsNpmCacheDirectory = join(temporaryDirectory, "npm-cache-tools");
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
		mkdir(todoInstallDirectory),
		mkdir(todoNpmCacheDirectory),
		mkdir(toolsInstallDirectory),
		mkdir(toolsNpmCacheDirectory),
	]);

	const releaseArchive = (name: string): string => {
		const artifact = releaseManifest.artifacts.find((candidate) => candidate.name === name);
		if (!artifact) throw new Error(`Release manifest is missing ${name}`);
		return resolveReleaseArchive(releaseDirectory, artifact);
	};
	const uiArchive = releaseArchive(uiPackageName);
	const agentsArchive = releaseArchive("@jczhang02/pi-stuff-agents");
	const btwArchive = releaseArchive("@jczhang02/pi-stuff-btw");
	const contextArchive = releaseArchive("@jczhang02/pi-stuff-context");
	const rtkArchive = releaseArchive("@jczhang02/pi-stuff-rtk");
	const codexArchive = releaseArchive("@jczhang02/pi-stuff-codex");
	const todoArchive = releaseArchive("@jczhang02/pi-stuff-todo");
	const toolsArchive = releaseArchive("@jczhang02/pi-stuff-tools");
	const rootRequire = createRequire(join(root, "package.json"));
	const runtimeDirectories: Record<string, string> = {
		typebox: await resolvePackageDirectory(rootRequire, "typebox"),
	};
	const runtimeArchives = Object.fromEntries(
		await Promise.all(
			["typebox"].map(async (name) => {
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

	// npm can satisfy exact local dependencies offline when their archives are
	// installed first. This is the same dependency shape Pi's package installer sees.
	install(contextInstallDirectory, contextNpmCacheDirectory, uiArchive);
	install(contextInstallDirectory, contextNpmCacheDirectory, typeboxArchive);
	install(contextInstallDirectory, contextNpmCacheDirectory, toolsArchive);
	install(contextInstallDirectory, contextNpmCacheDirectory, contextArchive);
	install(btwInstallDirectory, btwNpmCacheDirectory, uiArchive);
	install(btwInstallDirectory, btwNpmCacheDirectory, typeboxArchive);
	install(btwInstallDirectory, btwNpmCacheDirectory, toolsArchive);
	install(btwInstallDirectory, btwNpmCacheDirectory, contextArchive);
	install(btwInstallDirectory, btwNpmCacheDirectory, btwArchive);
	install(rtkInstallDirectory, rtkNpmCacheDirectory, uiArchive);
	install(rtkInstallDirectory, rtkNpmCacheDirectory, rtkArchive);
	install(codexInstallDirectory, codexNpmCacheDirectory, uiArchive);
	install(agentsInstallDirectory, agentsNpmCacheDirectory, uiArchive);
	for (const dependency of Object.keys(agentsRuntimeVersions)) {
		const archive = agentsRuntimeArchives[dependency];
		if (!archive) throw new Error(`Standalone Agents dependency archive is missing ${dependency}`);
		install(agentsInstallDirectory, agentsNpmCacheDirectory, archive);
	}
	install(agentsInstallDirectory, agentsNpmCacheDirectory, toolsArchive);
	install(agentsInstallDirectory, agentsNpmCacheDirectory, contextArchive);
	install(agentsInstallDirectory, agentsNpmCacheDirectory, agentsArchive);
	install(todoInstallDirectory, todoNpmCacheDirectory, uiArchive);
	install(todoInstallDirectory, todoNpmCacheDirectory, typeboxArchive);
	install(todoInstallDirectory, todoNpmCacheDirectory, toolsArchive);
	install(todoInstallDirectory, todoNpmCacheDirectory, todoArchive);
	install(toolsInstallDirectory, toolsNpmCacheDirectory, uiArchive);
	install(toolsInstallDirectory, toolsNpmCacheDirectory, typeboxArchive);
	install(toolsInstallDirectory, toolsNpmCacheDirectory, toolsArchive);
	install(codexInstallDirectory, codexNpmCacheDirectory, typeboxArchive);
	install(codexInstallDirectory, codexNpmCacheDirectory, toolsArchive);
	install(codexInstallDirectory, codexNpmCacheDirectory, codexArchive);

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
	await verifyUiDependency(agentsInstallDirectory, "pi-stuff-agents");
	await verifyUiDependency(todoInstallDirectory, "pi-stuff-todo");
	await verifyUiDependency(toolsInstallDirectory, "pi-stuff-tools");

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
	) as { dependencies?: Record<string, unknown> };
	const installedAgentsToolsManifest = JSON.parse(
		await readFile(join(agentsInstalledRoot, "@jczhang02/pi-stuff-tools/package.json"), "utf8"),
	) as { version?: unknown };
	if (
		typeof installedAgentsToolsManifest.version !== "string" ||
		agentsManifest.dependencies?.["@jczhang02/pi-stuff-tools"] !== installedAgentsToolsManifest.version
	) {
		throw new Error("Standalone Agents must install Tools as an exact runtime dependency");
	}
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
	if (!rtkSmoke.commandNames.includes("rtk") || !rtkSmoke.commandNames.includes("ui")) {
		throw new Error("Standalone RTK Package did not register /rtk and the shared /ui surface");
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
		if (manifest.license !== "MIT") throw new Error(`${path} must declare the MIT license`);
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
	}
	const expectedCapabilities = ["@jczhang02/pi-stuff-context"];
	for (const capability of expectedCapabilities) {
		const suffix = `node_modules/${capability}/package.json`;
		const copies = manifests.filter((path) => path.endsWith(suffix));
		if (copies.length !== 1) {
			throw new Error(
				`Aggregate must contain exactly one physical ${capability}; received ${String(copies.length)}`,
			);
		}
	}
	const magicContextLicenses = archiveFiles.filter((path) =>
		path.endsWith("node_modules/@jczhang02/pi-magic-context/LICENSE"),
	);
	if (magicContextLicenses.length !== 1) {
		throw new Error(
			`Aggregate must contain exactly one physical Magic Context runtime; received ${String(magicContextLicenses.length)}`,
		);
	}
	for (const magicContextLicense of magicContextLicenses) {
		if ((await sha256File(join(extractDirectory, magicContextLicense))) !== magicContextLicenseSha256) {
			throw new Error("Bundled Magic Context does not preserve the owned fork's upstream MIT notice");
		}
		const magicContextManifestPath = magicContextLicense.replace(/LICENSE$/, "package.json");
		const magicContextManifest = JSON.parse(
			await readFile(join(extractDirectory, magicContextManifestPath), "utf8"),
		) as { license?: unknown; name?: unknown; version?: unknown };
		if (
			magicContextManifest.name !== "@jczhang02/pi-magic-context" ||
			magicContextManifest.version !== "0.33.1-pi-stuff.2" ||
			magicContextManifest.license !== "MIT"
		) {
			throw new Error("Aggregate contains an uncertified Magic Context runtime");
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
			deltaHeading: "## Pi Stuff delta",
			required: [
				"cortexkit/magic-context",
				"v0.33.1",
				"dea65a94abf61b698160d14dc8b621b1387f1d2c",
				"fff20435536814cf881a5c8daf4c0fc88e8fe78f",
				"pi-stuff-v0.33.1-2",
				"0c4cadfb35ad64d90a119eb8cd2bb5dffab43f5ba8096dfb9378b74dcd99bab3",
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
		const extractedSmoke = await runPiRpcSmoke({ piBinary, packages: [extractedPackage] });
		if (!extractedSmoke.commandNames.includes("ui") || extractedSmoke.commandNames.includes("tool-settings")) {
			throw new Error("Packed Aggregate did not expose only the unified /ui settings entry point");
		}
		await verifyUiPty({ piBinary, packagePath: extractedPackage });
		await verifyAgentsPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyAgentsExecutionMatrix({ piBinary, packagePath: extractedPackage });
		await verifyBtwPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyContextPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyRtkPty({ piBinary, packagePath: extractedPackage });
		await verifyToolsPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await verifyToolsResumePty({ piBinary, packagePath: extractedPackage });
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
		const aggregateSmoke = await runPiRpcSmoke({ piBinary: PI_BIN, packages: [aggregateDirectory] });
		if (!aggregateSmoke.commandNames.includes("ui") || aggregateSmoke.commandNames.includes("tool-settings")) {
			throw new Error("Source Aggregate did not expose only the unified /ui settings entry point");
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
