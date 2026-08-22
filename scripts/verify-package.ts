import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { CERTIFIED_PI_HOST_PROFILE, CERTIFIED_PI_SOURCE_COMMIT, CERTIFIED_PI_VERSION } from "./pi-host-contract.ts";
import { runPiRpcSmoke } from "./smoke-pi.ts";
import { verifyAgentsExecutionMatrix } from "./verify-agents-execution-matrix.ts";
import { verifyAgentsPty } from "./verify-agents-pty.ts";
import { verifyBtwPty } from "./verify-btw-pty.ts";
import { verifyContextPty } from "./verify-context-pty.ts";
import { verifyGoalLifecycle } from "./verify-goal-lifecycle.ts";
import { verifyGoalPty } from "./verify-goal-pty.ts";
import { verifyMcpPty } from "./verify-mcp-pty.ts";
import { verifyNotificationPty } from "./verify-notification-pty.ts";
import { stageCertifiedPiHost } from "./verify-pi-host-provenance.ts";
import { verifyRtkPty } from "./verify-rtk-pty.ts";
import { verifyToolsPty } from "./verify-tools-pty.ts";
import { verifyToolsResumePty } from "./verify-tools-resume-pty.ts";
import { verifyUiPty } from "./verify-ui-pty.ts";
import { verifyWebIntegration } from "./verify-web-integration.ts";
import { verifyWorkMonitorMatrix } from "./verify-work-monitor-matrix.ts";
import { verifyWorkPty } from "./verify-work-pty.ts";

export { CERTIFIED_PI_HOST_PROFILE, CERTIFIED_PI_SOURCE_COMMIT, CERTIFIED_PI_VERSION };

const root = resolve(import.meta.dir, "..");
const packageDirectory = join(root, "packages", "pi-stuff");
const goalToolInspector = join(root, "test/fixtures/assert-goal-tools.ts");
const webToolInspector = join(root, "test/fixtures/assert-web-tools.ts");
const mcpToolInspector = join(root, "test/fixtures/assert-mcp-tools.ts");
const workToolInspector = join(root, "test/fixtures/assert-work-tools.ts");
const DEVELOPMENT_ARCHIVE_FILE = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|tsconfig(?:\.[^/]+)?\.json)$/u;
const RTK_TECHNIQUE_FILES = [
	"ansi.ts",
	"build.ts",
	"command-detection.ts",
	"git.ts",
	"index.ts",
	"linter.ts",
	"path-utils.ts",
	"search.ts",
	"source.ts",
	"test-output.ts",
	"truncate.ts",
] as const;

const REQUIRED_ARCHIVE_FILES = [
	"package/index.ts",
	"package/src/lifecycle-deadline.ts",
	"package/src/lifecycle-performance.ts",
	"package/src/suite-loader.ts",
	"package/src/suite-runtime.ts",
	"package/src/conversation-ui/index.ts",
	"package/src/conversation-ui/statusline.ts",
	"package/src/tool-display/index.ts",
	"package/src/code-mode/index.ts",
	"package/src/code-mode/extension.ts",
	"package/src/code-mode/connector.ts",
	"package/src/code-mode/ledger.ts",
	"package/src/code-mode/runtime.ts",
	"package/src/code-mode/v8-executor.ts",
	"package/src/code-mode/cloudflare/codec.ts",
	"package/src/code-mode/cloudflare/normalize.ts",
	"package/src/code-mode/host/host-client.ts",
	"package/src/code-mode/host/host-assets.ts",
	"package/src/code-mode/LICENSES/Apache-2.0.txt",
	"package/src/code-mode/LICENSES/Cloudflare-MIT.txt",
	"package/src/code-mode/THIRD_PARTY_NOTICES.md",
	"package/src/context-management/index.ts",
	"package/src/rtk/index.ts",
	"package/src/codex/index.ts",
	"package/src/codex/native/apply-patch/linux-x64/apply_patch",
	"package/src/codex/native/imagegen/linux-x64/imagegen",
	"package/src/codex/native/view-image/linux-x64/view_image",
	"package/src/codex/LICENSES/Apache-2.0.txt",
	"package/src/codex/THIRD_PARTY_NOTICES.md",
	"package/src/goal/index.ts",
	"package/src/web/index.ts",
	"package/src/web/runtime/index.js",
	"package/src/web/runtime/implementation.ts",
	"package/src/web/runtime/LICENSE",
	"package/src/web/runtime/SECURITY.md",
	"package/src/web/runtime/UPSTREAM.md",
	"package/src/web/runtime/UPSTREAM_README.md",
	"package/src/mcp/index.ts",
	"package/src/mcp/runtime/index.js",
	"package/src/mcp/runtime/implementation.ts",
	"package/src/mcp/runtime/app-bridge.bundle.js",
	"package/src/mcp/runtime/mcp-keyring-helper.cjs",
	"package/src/mcp/runtime/mcp-script-worker.mjs",
	"package/src/mcp/runtime/banner.png",
	"package/src/mcp/runtime/LICENSE",
	"package/src/mcp/runtime/UPSTREAM.md",
	"package/src/mcp/runtime/UPSTREAM_README.md",
	...RTK_TECHNIQUE_FILES.map((file) => `package/src/rtk/upstream/techniques/${file}`),
	"package/src/background-work/index.ts",
	"package/src/background-work/src/process-supervisor.mjs",
	"package/src/subagents/index.ts",
	"package/src/todo/index.ts",
	"package/src/btw/index.ts",
	"package/src/btw/prompts/btw-system.txt",
	"package/src/notification/index.ts",
	"package/src/notification/format.ts",
	"package/src/notification/notification-settings-dialog.ts",
	"package/src/notification/runtime.ts",
	"package/src/notification/settings.ts",
	"package/src/notification/transport.ts",
	"package/themes/catppuccin-frappe.json",
	"package/themes/catppuccin-latte.json",
	"package/themes/catppuccin-macchiato.json",
	"package/themes/catppuccin-mocha.json",
	"package/themes/LICENSE",
	"package/themes/README.md",
] as const;

const PROVENANCE_REQUIREMENTS = {
	"background-work": ["pi-background-tasks", "Pi Stuff delta"],
	btw: ["@juicesharp/rpiv-btw", "Pi Stuff delta"],
	"code-mode": ["@howaboua/pi-codex-conversion", "Cloudflare Code Mode", "Pi Stuff delta"],
	codex: ["@howaboua/pi-codex-conversion", "Pi Stuff delta"],
	"context-management": ["cortexkit/magic-context", "Pi Stuff adapter policy"],
	goal: ["@narumitw/pi-goal", "Pi Stuff delta"],
	mcp: ["nicobailon/pi-mcp-adapter", "Pi Stuff delta"],
	rtk: ["pi-rtk-optimizer", "Pi Stuff delta"],
	subagents: ["pi-subagents", "Pi Stuff delta"],
	todo: ["@juicesharp/rpiv-todo", "Pi Stuff delta"],
	"tool-display": ["@mobrienv/pi-tidy-tools", "Pi Stuff delta"],
	web: ["nicobailon/pi-web-access", "Pi Stuff delta"],
} satisfies Readonly<Record<string, readonly string[]>>;

export interface PackageArchiveManifest {
	dependencies?: unknown;
	files?: unknown;
	name?: unknown;
	private?: unknown;
	pi?: unknown;
	bundledDependencies?: unknown;
}

const PACKAGE_ARCHIVE_MANIFEST_SCHEMA = Type.Object(
	{
		bundledDependencies: Type.Optional(Type.Unknown()),
		dependencies: Type.Optional(Type.Unknown()),
		files: Type.Optional(Type.Unknown()),
		name: Type.Optional(Type.Unknown()),
		pi: Type.Optional(Type.Unknown()),
		private: Type.Optional(Type.Unknown()),
	},
	{ additionalProperties: true },
);
const RUNTIME_MANIFEST_SCHEMA = Type.Object(
	{ dependencies: Type.Optional(Type.Record(Type.String(), Type.Unknown())) },
	{ additionalProperties: true },
);
const INSTALLED_MANIFEST_SCHEMA = Type.Object(
	{ name: Type.Optional(Type.Unknown()), version: Type.Optional(Type.Unknown()) },
	{ additionalProperties: true },
);

function run(command: readonly string[], cwd = root): string {
	const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(`${command.join(" ")} failed with ${result.exitCode}: ${stderr.trim() || stdout.trim()}`);
	}
	return stdout;
}

function normalizedFilesEntry(entry: string): string {
	const normalized = entry.replace(/^\.\//u, "");
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

export function verifyPackageArchive(manifest: PackageArchiveManifest, archiveFiles: readonly string[]): void {
	if (manifest.name !== "@jczhang02/pi-stuff") throw new Error("Archive has the wrong Package identity");
	if (manifest.private !== true) throw new Error("Pi Stuff must remain a private local Package");
	if (JSON.stringify(manifest.pi) !== JSON.stringify({ extensions: ["./index.ts"], themes: ["./themes/*.json"] })) {
		throw new Error("Archive has an invalid Pi resource manifest");
	}
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		throw new Error("Package manifest files must be a non-empty array");
	}
	for (const entry of manifest.files) {
		if (!isRuntimeString(entry)) throw new Error("Package manifest files must contain only strings");
		normalizedFilesEntry(entry);
	}
	if (manifest.bundledDependencies !== undefined) {
		throw new Error("The local single Package must not use bundledDependencies");
	}
	if (
		!isRuntimeObject(manifest.dependencies) ||
		manifest.dependencies === null ||
		Object.keys(manifest.dependencies).some((name) => name.startsWith("@jczhang02/pi-"))
	) {
		throw new Error("The local Package must declare only external runtime dependencies");
	}

	const archiveSet = new Set(archiveFiles);
	if (!archiveSet.has("package/package.json")) throw new Error("Archive is missing package/package.json");
	const missing = REQUIRED_ARCHIVE_FILES.filter((path) => !archiveSet.has(path));
	if (missing.length > 0) throw new Error(`Archive is missing runtime files:\n${missing.join("\n")}`);
	const forbidden = archiveFiles.filter(
		(path) =>
			path.startsWith("package/node_modules/") ||
			path.startsWith("package/src/subagents/agents/") ||
			/codex-code-mode-host(?:\.exe)?$/u.test(path) ||
			path.includes("/.changeset/") ||
			path.includes("/node_modules/") ||
			(path !== "package/package.json" && path.endsWith("/package.json")) ||
			DEVELOPMENT_ARCHIVE_FILE.test(path),
	);
	if (forbidden.length > 0) throw new Error(`Archive contains forbidden files:\n${forbidden.sort().join("\n")}`);
}

async function verifySinglePackageBoundary(): Promise<void> {
	const packageEntries = (await readdir(join(root, "packages"), { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	if (packageEntries.join("\n") !== "pi-stuff") {
		throw new Error(`Expected one Package directory, found: ${packageEntries.join(", ")}`);
	}
	const nestedManifests = [...new Bun.Glob("src/**/package.json").scanSync({ cwd: packageDirectory })];
	if (nestedManifests.length > 0) {
		throw new Error(`Internal modules must not contain Package manifests:\n${nestedManifests.sort().join("\n")}`);
	}
}

export async function verifyInstalledRuntimeDependencies(baseDirectory = packageDirectory): Promise<void> {
	const manifest = await Bun.file(join(baseDirectory, "package.json")).json();
	if (!Check(RUNTIME_MANIFEST_SCHEMA, manifest)) throw new Error("Package manifest must be a JSON object");
	for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
		if (
			!isRuntimeString(version) ||
			!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(version)
		) {
			throw new Error(`Runtime dependency ${name} must use an exact version`);
		}
		const installedManifestPath = join(baseDirectory, "node_modules", name, "package.json");
		let installedManifest: Static<typeof INSTALLED_MANIFEST_SCHEMA>;
		try {
			const parsed = parseJsonValue(await readFile(installedManifestPath, "utf8"));
			if (!Check(INSTALLED_MANIFEST_SCHEMA, parsed)) throw new Error("installed manifest must be an object");
			installedManifest = parsed;
		} catch (error) {
			throw new Error(`Cannot read installed runtime dependency ${name}`, { cause: error });
		}
		if (installedManifest.name !== name || installedManifest.version !== version) {
			throw new Error(
				`Runtime dependency ${name} resolved to ${String(installedManifest.name)}@${String(installedManifest.version)}, expected ${name}@${version}`,
			);
		}
	}
}

async function verifyProvenanceAndLicenses(baseDirectory: string): Promise<void> {
	await access(join(baseDirectory, "src", "conversation-ui", "LICENSE"));
	for (const [module, required] of Object.entries(PROVENANCE_REQUIREMENTS)) {
		const moduleDirectory = join(baseDirectory, "src", module);
		await access(join(moduleDirectory, "LICENSE"));
		const provenance = await readFile(join(moduleDirectory, "UPSTREAM.md"), "utf8");
		for (const marker of required) {
			if (!provenance.includes(marker)) throw new Error(`${module}/UPSTREAM.md is missing ${marker}`);
		}
	}
	for (const adapted of ["web/runtime", "mcp/runtime"] as const) {
		await access(join(baseDirectory, "src", adapted, "LICENSE"));
		await access(join(baseDirectory, "src", adapted, "UPSTREAM.md"));
		await access(join(baseDirectory, "src", adapted, "UPSTREAM_README.md"));
	}
	await access(join(baseDirectory, "src", "web", "runtime", "SECURITY.md"));
	await access(join(baseDirectory, "src", "mcp", "runtime", "banner.png"));
	await access(join(baseDirectory, "src", "codex", "LICENSES", "Apache-2.0.txt"));
	await access(join(baseDirectory, "src", "codex", "THIRD_PARTY_NOTICES.md"));
	await access(join(baseDirectory, "src", "code-mode", "LICENSES", "Apache-2.0.txt"));
	await access(join(baseDirectory, "src", "code-mode", "LICENSES", "Cloudflare-MIT.txt"));
	await access(join(baseDirectory, "src", "code-mode", "THIRD_PARTY_NOTICES.md"));
	for (const technique of RTK_TECHNIQUE_FILES) {
		await access(join(baseDirectory, "src", "rtk", "upstream", "techniques", technique));
	}
}

function verifyPiVersion(piBinary: string): void {
	const version = run([piBinary, "--version"]).trim();
	if (version !== CERTIFIED_PI_VERSION) {
		throw new Error(`Expected Pi ${CERTIFIED_PI_VERSION}, received ${version || "no version"}`);
	}
}

async function packAndExtract(
	temporaryDirectory: string,
): Promise<{ archiveFiles: string[]; extractedPackage: string }> {
	const packsDirectory = join(temporaryDirectory, "packs");
	const extractDirectory = join(temporaryDirectory, "extract");
	await Promise.all([mkdir(packsDirectory), mkdir(extractDirectory)]);
	run(
		[process.execPath, "pm", "pack", "--ignore-scripts", "--destination", packsDirectory, "--quiet"],
		packageDirectory,
	);
	const archives = (await readdir(packsDirectory)).filter((entry) => entry.endsWith(".tgz"));
	if (archives.length !== 1 || !archives[0]) throw new Error("Bun did not produce exactly one Pi Stuff archive");
	const archivePath = join(packsDirectory, archives[0]);
	const archiveFiles = run(["tar", "-tzf", archivePath]).trim().split("\n").filter(Boolean).sort();
	const manifest = JSON.parse(run(["tar", "-xOzf", archivePath, "package/package.json"]));
	if (!Check(PACKAGE_ARCHIVE_MANIFEST_SCHEMA, manifest)) throw new Error("Archive manifest must be an object");
	verifyPackageArchive(manifest, archiveFiles);
	run(["tar", "-xzf", archivePath, "-C", extractDirectory]);
	const extractedPackage = join(extractDirectory, "package");
	await verifyProvenanceAndLicenses(extractedPackage);
	for (const binary of [
		"src/codex/native/apply-patch/linux-x64/apply_patch",
		"src/codex/native/imagegen/linux-x64/imagegen",
		"src/codex/native/view-image/linux-x64/view_image",
	]) {
		if (((await stat(join(extractedPackage, binary))).mode & 0o111) === 0) {
			throw new Error(`Packed native Tool is not executable: ${binary}`);
		}
	}
	await symlink(join(packageDirectory, "node_modules"), join(extractedPackage, "node_modules"), "dir");
	return { archiveFiles, extractedPackage };
}

async function verifySuiteSurface(piBinary: string, packagePath: string): Promise<void> {
	const smoke = await runPiRpcSmoke({
		piBinary,
		extensions: [goalToolInspector, webToolInspector, mcpToolInspector, workToolInspector],
		packages: [packagePath],
		probeCommand: "/notifications",
		timeoutMs: 60_000,
	});
	const requiredCommands = [
		"ui",
		"codemode",
		"goal",
		"goal-tools-certified",
		"web-tools-certified",
		"mcp-tools-certified",
		"mcp",
		"tasks",
		"notifications",
		"work-tools-certified",
	];
	const missing = requiredCommands.filter((command) => !smoke.commandNames.includes(command));
	if (missing.length > 0) throw new Error(`Pi Stuff is missing commands: ${missing.join(", ")}`);
	if (smoke.commandNames.includes("mcp-auth")) throw new Error("Legacy /mcp-auth must remain removed");
	if (smoke.createdFiles.includes("agent/pi-stuff-notification.json")) {
		throw new Error("/notifications created Notification settings during the RPC purity probe");
	}
	if (smoke.commandNames.includes("tool-settings")) throw new Error("Legacy /tool-settings must remain removed");
}

async function verifyRealPi(piBinary: string, packagePath: string): Promise<void> {
	await verifySuiteSurface(piBinary, packagePath);
	await verifyWebIntegration({ packagePath });
	await verifyGoalLifecycle({ piBinary, packagePath });
	await verifyUiPty({ piBinary, packagePath });
	await verifyGoalPty({ piBinary, packagePath, columns: 56, rows: 24 });
	await verifyAgentsPty({ piBinary, packagePath, columns: 64, rows: 28 });
	await verifyAgentsExecutionMatrix({ piBinary, packagePath });
	await verifyBtwPty({ piBinary, packagePath, columns: 64, rows: 28 });
	await verifyContextPty({ piBinary, packagePath, columns: 64, rows: 28 });
	await verifyRtkPty({ piBinary, packagePath });
	await verifyMcpPty({ piBinary, packagePath, columns: 64, rows: 28 });
	await verifyNotificationPty({ piBinary, packagePath, columns: 64, rows: 28 });
	await verifyToolsPty({ piBinary, packagePath, columns: 64, rows: 28 });
	await verifyToolsResumePty({ piBinary, packagePath });
	await verifyWorkMonitorMatrix({ piBinary, packagePath });
	await verifyWorkPty({ piBinary, packagePath, columns: 96, rows: 30 });
}

async function main(): Promise<void> {
	const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-local-package-"));
	try {
		const host = await stageCertifiedPiHost(PI_BIN, temporaryDirectory);
		verifyPiVersion(host.binaryPath);
		await verifySinglePackageBoundary();
		await verifyInstalledRuntimeDependencies();
		await verifyProvenanceAndLicenses(packageDirectory);
		await verifySuiteSurface(host.binaryPath, packageDirectory);
		const { archiveFiles, extractedPackage } = await packAndExtract(temporaryDirectory);
		await verifyRealPi(host.binaryPath, extractedPackage);
		console.log(
			`Certified one local @jczhang02/pi-stuff Package (${archiveFiles.length} files) with Pi Host ${CERTIFIED_PI_HOST_PROFILE}`,
		);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (import.meta.main) await main();
