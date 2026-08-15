import { access, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import ts from "typescript";

const FORBIDDEN_HOST_FILES = new Set(["auth.json", "models-store.json"]);
const FORBIDDEN_PACKAGE_FILES = new Set(["AGENTS.md", "CONTEXT.md"]);
const LIFECYCLE_SCRIPTS = new Set([
	"preinstall",
	"install",
	"postinstall",
	"prepare",
	"prepack",
	"postpack",
	"prepublish",
	"prepublishOnly",
]);
const PRIVATE_PATH_PATTERNS = [
	/\/home\/[^/\s]+\//,
	/\/Users\/(?!me\/)[^/\s]+\//,
	/[A-Za-z]:\\Users\\(?!me\\)[^\\\s]+\\/,
];
const CREDENTIAL_PATTERNS = [
	/-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
	/\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
	/\bsk-[A-Za-z0-9_-]{24,}\b/,
];
const HOST_CONSOLE_CALL_PATTERN = /\bconsole\s*\.\s*(?:debug|error|info|log|warn)\s*\(/u;
const HOST_STREAM_WRITE_PATTERN = /\bprocess\s*\.\s*(?:stderr|stdout)\s*\.\s*write\s*\(/u;
const HOST_LITERAL_COLOR_PATTERN = /(?:#[0-9a-f]{6}\b|(?:38|48);(?:2|5);|\\x1b\[(?:3[0-7]|4[0-7]|9[0-7]|10[0-7])m)/iu;
const HOST_DYNAMIC_SGR_PATTERN = /\\x1b\[\$\{[^}\r\n]+\}m/u;
const HOST_SHORT_COLOR_LITERAL_PATTERN = /["'`](?:3[0-7]|4[0-7]|9[0-7]|10[0-7])["'`]/u;
const HOST_CONSOLE_ALLOWLIST = new Set([
	// These run inside browser/sandbox surfaces rather than Pi's Host TUI.
	"packages/pi-stuff/src/mcp/runtime/app-bridge.bundle.js",
	"packages/pi-stuff/src/mcp/runtime/host-html-template.ts",
	"packages/pi-stuff/src/mcp/runtime/mcp-script-worker.mjs",
	"packages/pi-stuff/src/web/runtime/curator-page.ts",
]);
const HOST_STREAM_WRITE_ALLOWLIST = new Set([
	// Explicit subprocess protocols and detached-runner logs; none execute in Pi's Host TUI path.
	"packages/pi-stuff/src/mcp/runtime/mcp-keyring-helper.cjs",
	"packages/pi-stuff/src/subagents/src/runs/background/writer-process-supervisor.mjs",
	"packages/pi-stuff/src/subagents/src/shared/detached-runner-diagnostics.ts",
	// Terminal-native notifications are guarded by both TUI mode and Host UI availability.
	"packages/pi-stuff/src/notification/transport.ts",
]);
const HOST_LITERAL_COLOR_ALLOWLIST = new Set([
	// Browser documents cannot consume Pi's terminal Theme API.
	"packages/pi-stuff/src/mcp/runtime/app-bridge.bundle.js",
	"packages/pi-stuff/src/mcp/runtime/host-html-template.ts",
	"packages/pi-stuff/src/mcp/runtime/implementation.ts",
	"packages/pi-stuff/src/mcp/runtime/mcp-callback-server.ts",
	"packages/pi-stuff/src/web/runtime/curator-page.ts",
	"packages/pi-stuff/src/web/runtime/implementation.ts",
]);
const INTERNAL_MODULES = [
	"conversation-ui",
	"tool-display",
	"context-management",
	"rtk",
	"codex",
	"goal",
	"web",
	"mcp",
	"background-work",
	"subagents",
	"todo",
	"btw",
	"notification",
	"code-mode",
] as const;
type InternalModule = (typeof INTERNAL_MODULES)[number];
const INTERNAL_MODULE_SET = new Set<string>(INTERNAL_MODULES);
const SUITE_COMPOSITION_SOURCE_FILES = new Set([
	"packages/pi-stuff/src/lifecycle-deadline.ts",
	"packages/pi-stuff/src/lifecycle-performance.ts",
	"packages/pi-stuff/src/suite-loader.ts",
	"packages/pi-stuff/src/suite-runtime.ts",
]);
const SHARED_MODULE_DEPENDENCIES = ["conversation-ui", "tool-display"] as const;
const ALLOWED_INTERNAL_DEPENDENCIES: Readonly<Record<InternalModule, ReadonlySet<InternalModule>>> = {
	"conversation-ui": new Set(),
	"tool-display": new Set(["conversation-ui"]),
	"context-management": new Set(SHARED_MODULE_DEPENDENCIES),
	rtk: new Set(SHARED_MODULE_DEPENDENCIES),
	codex: new Set(SHARED_MODULE_DEPENDENCIES),
	goal: new Set(SHARED_MODULE_DEPENDENCIES),
	web: new Set(SHARED_MODULE_DEPENDENCIES),
	mcp: new Set(SHARED_MODULE_DEPENDENCIES),
	"background-work": new Set(SHARED_MODULE_DEPENDENCIES),
	subagents: new Set([...SHARED_MODULE_DEPENDENCIES, "context-management", "background-work"]),
	todo: new Set(SHARED_MODULE_DEPENDENCIES),
	btw: new Set([...SHARED_MODULE_DEPENDENCIES, "context-management"]),
	notification: new Set(SHARED_MODULE_DEPENDENCIES),
	"code-mode": new Set(["tool-display"]),
};
export interface SafetyFinding {
	path: string;
	rule: string;
}

interface PackageManifest {
	dependencies?: unknown;
	devDependencies?: unknown;
	files?: unknown;
	optionalDependencies?: unknown;
	packageManager?: unknown;
	peerDependencies?: unknown;
	pi?: unknown;
	private?: unknown;
	scripts?: unknown;
	trustedDependencies?: unknown;
	workspaces?: unknown;
}

interface SuiteManifest {
	capabilities?: unknown;
}

interface SuiteSchema {
	properties?: {
		capabilities?: {
			items?: {
				enum?: unknown;
			};
		};
	};
}

function isLocalPiPackageManifest(path: string): boolean {
	return path === "packages/pi-stuff/package.json";
}

function hasExplicitFilesAllowlist(files: unknown): boolean {
	if (
		!Array.isArray(files) ||
		files.length === 0 ||
		!files.some((entry) => typeof entry === "string" && !entry.startsWith("!"))
	) {
		return false;
	}
	return files.every((entry) => {
		if (typeof entry !== "string" || entry.length === 0) return false;
		const normalized = entry.startsWith("!") ? entry.slice(1) : entry;
		if (normalized.length === 0 || normalized.startsWith("/") || normalized.includes("\\")) return false;
		const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
		return (
			segments.length > 0 &&
			!segments.includes("..") &&
			!segments.some((segment) => FORBIDDEN_PACKAGE_FILES.has(segment))
		);
	});
}

async function listPublicFiles(root: string): Promise<string[]> {
	const process = Bun.spawn(["git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [status, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).arrayBuffer(),
		new Response(process.stderr).text(),
	]);
	if (status !== 0) {
		throw new Error(`Unable to list public files: ${stderr.trim()}`);
	}
	return new TextDecoder()
		.decode(stdout)
		.split("\0")
		.filter((path) => path.length > 0)
		.sort();
}

function isForbiddenHostState(path: string): boolean {
	const segments = path.split("/");
	const basename = segments.at(-1);
	return (basename !== undefined && FORBIDDEN_HOST_FILES.has(basename)) || segments.includes("sessions");
}

function internalModuleFromPath(path: string): InternalModule | undefined {
	const prefix = "packages/pi-stuff/src/";
	if (!path.startsWith(prefix)) return undefined;
	const module = path.slice(prefix.length).split("/", 1)[0];
	return module && INTERNAL_MODULE_SET.has(module) ? (module as InternalModule) : undefined;
}

function isUnownedInternalSource(path: string): boolean {
	const prefix = "packages/pi-stuff/src/";
	if (!path.startsWith(prefix) || !/\.[cm]?[jt]sx?$/u.test(path)) return false;
	return !SUITE_COMPOSITION_SOURCE_FILES.has(path) && !path.slice(prefix.length).includes("/");
}

async function auditInternalModuleImports(root: string, path: string): Promise<SafetyFinding[]> {
	const sourceModule = internalModuleFromPath(path);
	if (!sourceModule || !/\.[cm]?[jt]sx?$/u.test(path)) return [];
	const source = await readFile(join(root, path), "utf8");
	const imports = ts.preProcessFile(source, true, true).importedFiles;
	const findings: SafetyFinding[] = [];
	for (const imported of imports) {
		if (!imported.fileName.startsWith(".")) continue;
		const targetPath = posix.normalize(posix.join(posix.dirname(path), imported.fileName));
		const targetModule = internalModuleFromPath(targetPath);
		if (
			targetModule &&
			targetModule !== sourceModule &&
			!ALLOWED_INTERNAL_DEPENDENCIES[sourceModule].has(targetModule)
		) {
			findings.push({
				path,
				rule: `forbidden-internal-module-dependency:${sourceModule}->${targetModule}`,
			});
		}
	}
	return findings;
}

async function auditTextFile(root: string, path: string): Promise<SafetyFinding[]> {
	const content = await readFile(join(root, path));
	if (content.includes(0)) {
		return [];
	}
	const text = content.toString("utf8");
	const findings: SafetyFinding[] = [];
	if (PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(text))) {
		findings.push({ path, rule: "private-absolute-path" });
	}
	if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
		findings.push({ path, rule: "credential-pattern" });
	}
	if (
		path.startsWith("packages/pi-stuff/src/") &&
		!HOST_CONSOLE_ALLOWLIST.has(path) &&
		HOST_CONSOLE_CALL_PATTERN.test(text)
	) {
		findings.push({ path, rule: "raw-host-console-output" });
	}
	if (
		path.startsWith("packages/pi-stuff/src/") &&
		!HOST_STREAM_WRITE_ALLOWLIST.has(path) &&
		HOST_STREAM_WRITE_PATTERN.test(text)
	) {
		findings.push({ path, rule: "raw-host-stream-output" });
	}
	if (
		path.startsWith("packages/pi-stuff/src/") &&
		!HOST_LITERAL_COLOR_ALLOWLIST.has(path) &&
		(HOST_LITERAL_COLOR_PATTERN.test(text) ||
			(HOST_DYNAMIC_SGR_PATTERN.test(text) && HOST_SHORT_COLOR_LITERAL_PATTERN.test(text)))
	) {
		findings.push({ path, rule: "hard-coded-host-color" });
	}
	return findings;
}

function hasInexactDependency(manifest: PackageManifest): boolean {
	const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
	for (const section of [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies] as const) {
		if (
			typeof section === "object" &&
			section !== null &&
			Object.values(section).some((version) => typeof version !== "string" || !exactVersion.test(version))
		) {
			return true;
		}
	}
	if (
		typeof manifest.peerDependencies === "object" &&
		manifest.peerDependencies !== null &&
		Object.values(manifest.peerDependencies).some(
			(version) => typeof version !== "string" || (version !== "*" && !exactVersion.test(version)),
		)
	) {
		return true;
	}
	return false;
}

async function auditPackageManifest(root: string, path: string): Promise<SafetyFinding[]> {
	const manifest = JSON.parse(await readFile(join(root, path), "utf8")) as PackageManifest;
	const findings: SafetyFinding[] = [];
	if (hasInexactDependency(manifest)) {
		findings.push({ path, rule: "direct-dependency-must-be-exact" });
	}
	if (path === "package.json") {
		if (manifest.packageManager !== "bun@1.3.14") {
			findings.push({ path, rule: "package-manager-must-be-bun-1.3.14" });
		}
		if (!Array.isArray(manifest.trustedDependencies) || manifest.trustedDependencies.length !== 0) {
			findings.push({ path, rule: "trusted-dependencies-must-be-empty" });
		}
		if (JSON.stringify(manifest.workspaces) !== JSON.stringify(["packages/pi-stuff"])) {
			findings.push({ path, rule: "single-package-workspace" });
		}
	}
	if (path.startsWith("packages/") && path.endsWith("/package.json") && !isLocalPiPackageManifest(path)) {
		findings.push({ path, rule: "unexpected-package-manifest" });
	}
	if (isLocalPiPackageManifest(path)) {
		if (manifest.private !== true) {
			findings.push({ path, rule: "local-package-must-be-private" });
		}
		if (!hasExplicitFilesAllowlist(manifest.files)) {
			findings.push({ path, rule: "package-files-allowlist" });
		}
		const expectedPiManifest = JSON.stringify({
			extensions: ["./index.ts"],
			themes: ["./themes/*.json"],
		});
		if (JSON.stringify(manifest.pi) !== expectedPiManifest) {
			findings.push({ path, rule: "package-pi-manifest" });
		}
		if (
			typeof manifest.scripts === "object" &&
			manifest.scripts !== null &&
			Object.keys(manifest.scripts).some((script) => LIFECYCLE_SCRIPTS.has(script))
		) {
			findings.push({ path, rule: "package-lifecycle-script" });
		}
	}
	return findings;
}

async function auditSuiteManifest(root: string, path: string): Promise<SafetyFinding[]> {
	const manifest = JSON.parse(await readFile(join(root, path), "utf8")) as SuiteManifest;
	if (!Array.isArray(manifest.capabilities) || manifest.capabilities.some((name) => typeof name !== "string")) {
		return [{ path, rule: "suite-capabilities-must-be-string-array" }];
	}
	const capabilities = new Set(manifest.capabilities as string[]);
	const findings: SafetyFinding[] = [];
	for (const capability of capabilities) {
		if (!INTERNAL_MODULE_SET.has(capability)) {
			findings.push({ path, rule: `suite-capability-without-import-policy:${capability}` });
		}
	}
	for (const module of INTERNAL_MODULES) {
		if (!capabilities.has(module)) findings.push({ path, rule: `import-policy-module-missing-from-suite:${module}` });
	}
	return findings;
}

async function auditSuiteSchema(root: string, path: string): Promise<SafetyFinding[]> {
	const schema = JSON.parse(await readFile(join(root, path), "utf8")) as SuiteSchema;
	const declared = schema.properties?.capabilities?.items?.enum;
	if (
		!Array.isArray(declared) ||
		declared.some((name) => typeof name !== "string") ||
		new Set(declared).size !== declared.length
	) {
		return [{ path, rule: "suite-schema-capabilities-must-be-unique-string-array" }];
	}
	const capabilities = new Set(declared as string[]);
	const findings: SafetyFinding[] = [];
	for (const capability of capabilities) {
		if (!INTERNAL_MODULE_SET.has(capability)) {
			findings.push({ path, rule: `suite-schema-capability-without-import-policy:${capability}` });
		}
	}
	for (const module of INTERNAL_MODULES) {
		if (!capabilities.has(module)) {
			findings.push({ path, rule: `import-policy-module-missing-from-suite-schema:${module}` });
		}
	}
	return findings;
}

export async function auditRepositoryFiles(rootDirectory: string): Promise<SafetyFinding[]> {
	const root = resolve(rootDirectory);
	const paths = await listPublicFiles(root);
	const findings: SafetyFinding[] = [];
	const suiteSchemaPath = "schemas/suite.schema.json";
	if (paths.includes(suiteSchemaPath)) {
		findings.push(...(await auditSuiteSchema(root, suiteSchemaPath)));
	}
	const suiteManifestPath = "packages/pi-stuff/suite.json";
	if (paths.includes(suiteManifestPath)) {
		findings.push(...(await auditSuiteManifest(root, suiteManifestPath)));
	}
	for (const path of paths) {
		try {
			await access(join(root, path));
		} catch {
			// `git ls-files --cached` also reports tracked files deleted in the
			// working tree. They cannot be published and need no content audit.
			continue;
		}
		if (isForbiddenHostState(path)) {
			findings.push({ path, rule: "forbidden-host-state" });
			continue;
		}
		if (isUnownedInternalSource(path)) {
			findings.push({ path, rule: "unowned-internal-source-module" });
		}
		findings.push(...(await auditInternalModuleImports(root, path)));
		findings.push(...(await auditTextFile(root, path)));
		if (path.endsWith("package.json")) {
			findings.push(...(await auditPackageManifest(root, path)));
		}
	}
	return findings;
}

if (import.meta.main) {
	const findings = await auditRepositoryFiles(resolve(import.meta.dir, ".."));
	if (findings.length > 0) {
		for (const finding of findings) {
			console.error(`${finding.path}: ${finding.rule}`);
		}
		process.exitCode = 1;
	} else {
		console.log("Repository safety checks passed");
	}
}
