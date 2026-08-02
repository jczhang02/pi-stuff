import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
import { verifyBtwPty } from "./verify-btw-pty.ts";

export const CERTIFIED_PI_VERSION = "0.83.0";
const DEVELOPMENT_ARCHIVE_FILE = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|tsconfig(?:\.[^/]+)?\.json)$/;
const root = resolve(import.meta.dir, "..");
const aggregateDirectory = join(root, "packages", "pi-stuff");
const uiPackageName = "@jczhang02/pi-stuff-ui";
const todoToolInspector = join(root, "test/fixtures/assert-todo-tools.ts");
const forkLicenseSha256 = "25d0d5e4e54033f939a9657109044f1d71a0b6e8db9adc400456ca9190df3fb1";
const permissionLicenseSha256 = "220a81ab89687aa207c1b9257a7f3636c8c78b5c1092b7563ad662950d21dd00";
const permissionRuntimeVersions = {
	"tree-sitter-bash": "0.25.1",
	"web-tree-sitter": "0.26.11",
	zod: "4.4.3",
} as const;
const expectedPiPeers: Readonly<Record<string, readonly string[]>> = {
	"@jczhang02/pi-stuff": ["@earendil-works/pi-coding-agent"],
	"@jczhang02/pi-stuff-btw": ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-permissions": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-todo": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
	"@jczhang02/pi-stuff-ui": ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
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
	if (!/[*?[\]{}]/.test(normalized)) return path === normalized;
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

export function verifyPackageArchive(manifest: PackageArchiveManifest, archiveFiles: readonly string[]): void {
	verifyReleaseArchivePaths(archiveFiles);
	const files = readStringArray(manifest.files, "files", false);
	if (!files.some((entry) => !entry.startsWith("!"))) {
		throw new Error("Package manifest files must contain at least one included entry");
	}
	for (const entry of files) {
		normalizedFilesEntry(entry.startsWith("!") ? entry.slice(1) : entry);
	}
	const bundledDependencies = readBundledDependencies(manifest.bundledDependencies);
	const archiveSet = new Set(archiveFiles);
	if (!archiveSet.has("package/package.json")) {
		throw new Error("Package archive is missing package/package.json");
	}

	for (const entry of files) {
		if (entry.startsWith("!")) continue;
		const normalized = normalizedFilesEntry(entry);
		if (!normalized.endsWith("/") && !/[*?[\]{}]/.test(normalized)) {
			const expectedPath = `package/${normalized}`;
			if (!archiveSet.has(expectedPath)) {
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

function run(command: readonly string[], cwd: string, env: Record<string, string | undefined> = process.env): string {
	const result = Bun.spawnSync([...command], { cwd, env, stdout: "pipe", stderr: "pipe" });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(`${command[0]} failed with ${result.exitCode}: ${stderr.trim() || stdout.trim()}`);
	}
	return stdout;
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
	const peers = Object.keys(peerDependencies ?? {}).sort();
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
	const btwInstallDirectory = join(temporaryDirectory, "standalone-btw");
	const btwNpmCacheDirectory = join(temporaryDirectory, "npm-cache-btw");
	const permissionsInstallDirectory = join(temporaryDirectory, "standalone-permissions");
	const permissionsNpmCacheDirectory = join(temporaryDirectory, "npm-cache-permissions");
	const todoInstallDirectory = join(temporaryDirectory, "standalone-todo");
	const todoNpmCacheDirectory = join(temporaryDirectory, "npm-cache-todo");
	await Promise.all([
		mkdir(packsDirectory),
		mkdir(btwInstallDirectory),
		mkdir(btwNpmCacheDirectory),
		mkdir(permissionsInstallDirectory),
		mkdir(permissionsNpmCacheDirectory),
		mkdir(todoInstallDirectory),
		mkdir(todoNpmCacheDirectory),
	]);

	const releaseArchive = (name: string): string => {
		const artifact = releaseManifest.artifacts.find((candidate) => candidate.name === name);
		if (!artifact) throw new Error(`Release manifest is missing ${name}`);
		return resolveReleaseArchive(releaseDirectory, artifact);
	};
	const uiArchive = releaseArchive(uiPackageName);
	const btwArchive = releaseArchive("@jczhang02/pi-stuff-btw");
	const permissionsArchive = releaseArchive("@jczhang02/pi-stuff-permissions");
	const todoArchive = releaseArchive("@jczhang02/pi-stuff-todo");
	const treeSitterManifest = await realpath(join(root, "node_modules", "tree-sitter-bash", "package.json"));
	const treeSitterRequire = createRequire(treeSitterManifest);
	const transitiveRuntimeDirectories = Object.fromEntries(
		["node-addon-api", "node-gyp-build"].map((name) => [
			name,
			dirname(treeSitterRequire.resolve(`${name}/package.json`)),
		]),
	) as Record<string, string>;
	const runtimeArchives = Object.fromEntries(
		await Promise.all(
			["node-addon-api", "node-gyp-build", ...Object.keys(permissionRuntimeVersions), "typebox"].map(
				async (name) =>
					[
						name,
						(
							await packPackageArchive(
								transitiveRuntimeDirectories[name] ?? join(root, "node_modules", name),
								join(packsDirectory, name),
								bunEnvironment,
							)
						).archivePath,
					] as const,
			),
		),
	) as Record<string, string>;
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
	install(btwInstallDirectory, btwNpmCacheDirectory, uiArchive);
	install(btwInstallDirectory, btwNpmCacheDirectory, btwArchive);
	install(permissionsInstallDirectory, permissionsNpmCacheDirectory, uiArchive);
	for (const dependency of ["node-addon-api", "node-gyp-build", ...Object.keys(permissionRuntimeVersions)]) {
		const archive = runtimeArchives[dependency];
		if (!archive) throw new Error(`Standalone dependency archive is missing ${dependency}`);
		install(permissionsInstallDirectory, permissionsNpmCacheDirectory, archive);
	}
	install(permissionsInstallDirectory, permissionsNpmCacheDirectory, permissionsArchive);
	install(todoInstallDirectory, todoNpmCacheDirectory, uiArchive);
	// biome-ignore lint/complexity/useLiteralKeys: this record is deliberately index-signature-only under noPropertyAccessFromIndexSignature
	const typeboxArchive = runtimeArchives["typebox"];
	if (!typeboxArchive) throw new Error("Standalone dependency archive is missing typebox");
	install(todoInstallDirectory, todoNpmCacheDirectory, typeboxArchive);
	install(todoInstallDirectory, todoNpmCacheDirectory, todoArchive);

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
	await verifyUiDependency(permissionsInstallDirectory, "pi-stuff-permissions");
	await verifyUiDependency(todoInstallDirectory, "pi-stuff-todo");

	const permissionsInstalledRoot = join(permissionsInstallDirectory, "node_modules");
	const permissionsManifest = JSON.parse(
		await readFile(join(permissionsInstalledRoot, "@jczhang02/pi-stuff-permissions/package.json"), "utf8"),
	) as { dependencies?: Record<string, unknown> };
	for (const [name, expectedVersion] of Object.entries(permissionRuntimeVersions)) {
		const dependencyManifest = JSON.parse(
			await readFile(join(permissionsInstalledRoot, name, "package.json"), "utf8"),
		) as { version?: unknown };
		if (
			dependencyManifest.version !== expectedVersion ||
			permissionsManifest.dependencies?.[name] !== expectedVersion
		) {
			throw new Error(`Standalone Permissions must install exact ${name} ${expectedVersion}`);
		}
	}

	const todoInstalledRoot = join(todoInstallDirectory, "node_modules");
	const todoManifest = JSON.parse(
		await readFile(join(todoInstalledRoot, "@jczhang02/pi-stuff-todo/package.json"), "utf8"),
	) as { dependencies?: { typebox?: unknown } };
	const typeboxManifest = JSON.parse(await readFile(join(todoInstalledRoot, "typebox/package.json"), "utf8")) as {
		version?: unknown;
	};
	if (typeboxManifest.version !== "1.3.7" || todoManifest.dependencies?.typebox !== typeboxManifest.version) {
		throw new Error("Standalone Todo must install the certified exact typebox runtime dependency");
	}

	const installedBtw = join(btwInstallDirectory, "node_modules/@jczhang02/pi-stuff-btw");
	const btwSmoke = await runPiRpcSmoke({ piBinary, packages: [installedBtw], cwd: btwInstallDirectory });
	if (!btwSmoke.commandNames.includes("btw")) throw new Error("Standalone BTW Package did not register /btw");
	const permissionsSmoke = await runPiRpcSmoke({
		piBinary,
		packages: [join(permissionsInstalledRoot, "@jczhang02/pi-stuff-permissions")],
		cwd: permissionsInstallDirectory,
	});
	if (!permissionsSmoke.commandNames.includes("permissions")) {
		throw new Error("Standalone Permissions Package did not register /permissions");
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
}

async function verifySharedCoordinatorIdentity(
	extractDirectory: string,
	archiveFiles: readonly string[],
): Promise<void> {
	const entries = archiveFiles.filter((path) => path.endsWith("node_modules/@jczhang02/pi-stuff-ui/index.ts"));
	if (entries.length === 0) throw new Error("Package archive contains no pi-stuff-ui runtime");

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
			manifest.name === "@jczhang02/pi-stuff-permissions" &&
			(await sha256File(join(extractDirectory, licensePath))) !== permissionLicenseSha256
		) {
			throw new Error(`${manifest.name} does not preserve the upstream MIT notice`);
		}
	}

	const provenance = [
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
			capability: "pi-stuff-permissions",
			deltaHeading: "Major product changes in this fork:",
			required: [
				"@gotgenes/pi-permission-system@24.0.0",
				"776ebcc764ca6c720b1f7eb430007de06f145b5f",
				"ebfe84ad3ac0946577a665473966f5c6385c362b",
				"0698d8b61ef1bcb197fae5987709e46a12290fb7bb07b4f35db369efcfcf0d32",
				"sha512-4WncumJPPDDs8Ulrjk7qvU3kHjQSjGyZnpLx1Nu9EkxWQZQi+qvVOpGpPGbHwlXt6rg8AjvI8zSl2Aj2bo5lfA==",
				"220a81ab89687aa207c1b9257a7f3636c8c78b5c1092b7563ad662950d21dd00",
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
		await runPiRpcSmoke({ piBinary, packages: [extractedPackage] });
		await verifyBtwPty({ piBinary, packagePath: extractedPackage, columns: 64, rows: 28 });
		await writeReleaseVerification(releaseDirectory, CERTIFIED_PI_VERSION);
		console.log(`Certified @jczhang02/pi-stuff with Pi ${CERTIFIED_PI_VERSION}`);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-package-artifacts-"));
	try {
		verifyPiVersion(PI_BIN);
		await runPiRpcSmoke({ piBinary: PI_BIN, packages: [aggregateDirectory] });
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
