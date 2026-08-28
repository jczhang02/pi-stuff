import { access, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import ts from "typescript";
import { isRuntimeObject, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";

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
const JAVASCRIPT_SOURCE_PATTERN = /\.[cm]?[jt]sx?$/u;
const REPOSITORY_CODE_PATTERN = /\.(?:css|html|jsonc?|tape|ya?ml)$/u;
const MAX_SOURCE_FILE_LINES = 800;
const MAX_SOURCE_FUNCTION_LINES = 120;
const HOST_CONSOLE_ALLOWLIST = new Set<string>();
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
	"packages/pi-stuff/src/mcp/runtime/implementation.ts",
	"packages/pi-stuff/src/mcp/runtime/mcp-callback-server.ts",
	"packages/pi-stuff/src/web/runtime/implementation.ts",
]);
const INTERNAL_MODULES = [
	"conversation-ui",
	"session-naming",
	"tool-display",
	"context-management",
	"ponytail",
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
interface InternalDependencyTable {
	readonly [module: string]: ReadonlySet<InternalModule>;
}

const ALLOWED_INTERNAL_DEPENDENCIES: InternalDependencyTable = {
	"conversation-ui": new Set(["ponytail"]),
	"session-naming": new Set(["conversation-ui"]),
	"tool-display": new Set(["conversation-ui"]),
	"context-management": new Set(SHARED_MODULE_DEPENDENCIES),
	ponytail: new Set([...SHARED_MODULE_DEPENDENCIES, "context-management"]),
	rtk: new Set(SHARED_MODULE_DEPENDENCIES),
	codex: new Set(SHARED_MODULE_DEPENDENCIES),
	goal: new Set(SHARED_MODULE_DEPENDENCIES),
	web: new Set(SHARED_MODULE_DEPENDENCIES),
	mcp: new Set(SHARED_MODULE_DEPENDENCIES),
	"background-work": new Set(SHARED_MODULE_DEPENDENCIES),
	subagents: new Set([...SHARED_MODULE_DEPENDENCIES, "context-management", "ponytail", "background-work"]),
	todo: new Set(SHARED_MODULE_DEPENDENCIES),
	btw: new Set([...SHARED_MODULE_DEPENDENCIES, "context-management"]),
	notification: new Set(SHARED_MODULE_DEPENDENCIES),
	"code-mode": new Set(SHARED_MODULE_DEPENDENCIES),
};
export interface SafetyFinding {
	path: string;
	rule: string;
}

interface ParsedSourceFile extends ts.SourceFile {
	readonly parseDiagnostics?: readonly ts.Diagnostic[];
}

const PACKAGE_MANIFEST_SCHEMA = Type.Object(
	{
		dependencies: Type.Optional(Type.Unknown()),
		devDependencies: Type.Optional(Type.Unknown()),
		files: Type.Optional(Type.Unknown()),
		optionalDependencies: Type.Optional(Type.Unknown()),
		packageManager: Type.Optional(Type.Unknown()),
		peerDependencies: Type.Optional(Type.Unknown()),
		pi: Type.Optional(Type.Unknown()),
		private: Type.Optional(Type.Unknown()),
		scripts: Type.Optional(Type.Unknown()),
		trustedDependencies: Type.Optional(Type.Unknown()),
		workspaces: Type.Optional(Type.Unknown()),
	},
	{ additionalProperties: true },
);
const SUITE_MANIFEST_SCHEMA = Type.Object(
	{ capabilities: Type.Optional(Type.Unknown()) },
	{ additionalProperties: true },
);
const SUITE_SCHEMA_SCHEMA = Type.Object(
	{
		properties: Type.Optional(
			Type.Object(
				{
					capabilities: Type.Optional(
						Type.Object(
							{ items: Type.Optional(Type.Object({ enum: Type.Optional(Type.Unknown()) })) },
							{ additionalProperties: true },
						),
					),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);
const STRING_ARRAY_SCHEMA = Type.Array(Type.String());
type PackageManifest = Static<typeof PACKAGE_MANIFEST_SCHEMA>;

function isLocalPiPackageManifest(path: string): boolean {
	return path === "packages/pi-stuff/package.json";
}

function hasExplicitFilesAllowlist(files: readonly string[] | undefined): boolean {
	if (files === undefined || files.length === 0 || !files.some((entry) => !entry.startsWith("!"))) {
		return false;
	}
	return files.every((entry) => {
		if (entry.length === 0) return false;
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
	return module && isInternalModule(module) ? module : undefined;
}

function isInternalModule(value: string): value is InternalModule {
	return INTERNAL_MODULE_SET.has(value);
}

function isUnownedInternalSource(path: string): boolean {
	const prefix = "packages/pi-stuff/src/";
	if (!path.startsWith(prefix) || !JAVASCRIPT_SOURCE_PATTERN.test(path)) return false;
	return !SUITE_COMPOSITION_SOURCE_FILES.has(path) && !path.slice(prefix.length).includes("/");
}

async function auditInternalModuleImports(root: string, path: string): Promise<SafetyFinding[]> {
	const sourceModule = internalModuleFromPath(path);
	if (!sourceModule || !JAVASCRIPT_SOURCE_PATTERN.test(path)) return [];
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
			ALLOWED_INTERNAL_DEPENDENCIES[sourceModule]?.has(targetModule) !== true
		) {
			findings.push({
				path,
				rule: `forbidden-internal-module-dependency:${sourceModule}->${targetModule}`,
			});
		}
	}
	return findings;
}

function isRepositoryCode(path: string): boolean {
	if (JAVASCRIPT_SOURCE_PATTERN.test(path) || path.endsWith(".sh")) return true;
	return !path.startsWith("docs/reports/") && REPOSITORY_CODE_PATTERN.test(path);
}

function countPhysicalLines(source: string): number {
	if (source.length === 0) return 0;
	const trailingBreak = source.endsWith("\n") || source.endsWith("\r") ? 1 : 0;
	return source.split(/\r\n|\r|\n/u).length - trailingBreak;
}

function isSourceFunction(node: ts.Node): boolean {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isConstructorDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function auditSourceLimits(path: string, source: string): SafetyFinding[] {
	if (!isRepositoryCode(path)) return [];
	const findings: SafetyFinding[] = [];
	const fileLines = countPhysicalLines(source);
	if (fileLines > MAX_SOURCE_FILE_LINES) {
		findings.push({ path, rule: `source-file-over-800-lines:${String(fileLines)}` });
	}
	if (!JAVASCRIPT_SOURCE_PATTERN.test(path)) return findings;

	const sourceFile: ParsedSourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
	const parseError = sourceFile.parseDiagnostics?.find(
		(diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
	);
	if (parseError) {
		const line = sourceFile.getLineAndCharacterOfPosition(parseError.start ?? 0).line + 1;
		findings.push({ path, rule: `source-parse-error:${String(line)}` });
		return findings;
	}
	const visit = (node: ts.Node): void => {
		if (isSourceFunction(node)) {
			const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
			const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
			const functionLines = end - start + 1;
			if (functionLines > MAX_SOURCE_FUNCTION_LINES) {
				findings.push({
					path,
					rule: `source-function-over-120-lines:${String(start)}:${String(functionLines)}`,
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return findings;
}

async function auditTextFile(root: string, path: string): Promise<SafetyFinding[]> {
	const content = await readFile(join(root, path));
	if (content.includes(0)) {
		return [];
	}
	const text = content.toString("utf8");
	const findings = auditSourceLimits(path, text);
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
			isRuntimeObject(section) &&
			section !== null &&
			Object.values(section).some((version) => !isRuntimeString(version) || !exactVersion.test(version))
		) {
			return true;
		}
	}
	if (
		isRuntimeObject(manifest.peerDependencies) &&
		manifest.peerDependencies !== null &&
		Object.values(manifest.peerDependencies).some(
			(version) => !isRuntimeString(version) || (version !== "*" && !exactVersion.test(version)),
		)
	) {
		return true;
	}
	return false;
}

async function auditPackageManifest(root: string, path: string): Promise<SafetyFinding[]> {
	const manifest = JSON.parse(await readFile(join(root, path), "utf8"));
	if (!Check(PACKAGE_MANIFEST_SCHEMA, manifest)) throw new Error(`${path}: package manifest must be an object`);
	const findings: SafetyFinding[] = [];
	if (hasInexactDependency(manifest)) {
		findings.push({ path, rule: "direct-dependency-must-be-exact" });
	}
	if (path === "package.json") {
		if (manifest.packageManager !== "bun@1.4.0") {
			findings.push({ path, rule: "package-manager-must-be-bun-1.4.0" });
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
		const files = Check(STRING_ARRAY_SCHEMA, manifest.files) ? manifest.files : undefined;
		if (!hasExplicitFilesAllowlist(files)) {
			findings.push({ path, rule: "package-files-allowlist" });
		}
		const expectedPiManifest = JSON.stringify({
			extensions: ["./index.ts"],
			skills: ["./src/ponytail/skills"],
			themes: ["./themes/*.json"],
		});
		if (JSON.stringify(manifest.pi) !== expectedPiManifest) {
			findings.push({ path, rule: "package-pi-manifest" });
		}
		if (
			isRuntimeObject(manifest.scripts) &&
			manifest.scripts !== null &&
			Object.keys(manifest.scripts).some((script) => LIFECYCLE_SCRIPTS.has(script))
		) {
			findings.push({ path, rule: "package-lifecycle-script" });
		}
	}
	return findings;
}

async function auditSuiteManifest(root: string, path: string): Promise<SafetyFinding[]> {
	const manifest = JSON.parse(await readFile(join(root, path), "utf8"));
	if (!Check(SUITE_MANIFEST_SCHEMA, manifest) || !Check(STRING_ARRAY_SCHEMA, manifest.capabilities)) {
		return [{ path, rule: "suite-capabilities-must-be-string-array" }];
	}
	const capabilities = new Set(manifest.capabilities);
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
	const schema = JSON.parse(await readFile(join(root, path), "utf8"));
	if (!Check(SUITE_SCHEMA_SCHEMA, schema)) {
		return [{ path, rule: "suite-schema-capabilities-must-be-unique-string-array" }];
	}
	const declared = schema.properties?.capabilities?.items?.enum;
	if (!Check(STRING_ARRAY_SCHEMA, declared) || new Set(declared).size !== declared.length) {
		return [{ path, rule: "suite-schema-capabilities-must-be-unique-string-array" }];
	}
	const capabilities = new Set(declared);
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
