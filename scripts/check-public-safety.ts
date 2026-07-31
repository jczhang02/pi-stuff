import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const AGGREGATE_MANIFEST = "packages/pi-stuff/package.json";
const EXPECTED_PACKAGE_FILES = ["index.ts", "README.md", "LICENSE"] as const;
const FORBIDDEN_HOST_FILES = new Set(["auth.json", "models-store.json"]);
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
const PRIVATE_PATH_PATTERNS = [/\/home\/[^/\s]+\//, /\/Users\/[^/\s]+\//, /[A-Za-z]:\\Users\\[^\\\s]+\\/];
const CREDENTIAL_PATTERNS = [
	/-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
	/\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
	/\bsk-[A-Za-z0-9_-]{24,}\b/,
];

export interface SafetyFinding {
	path: string;
	rule: string;
}

interface AggregateManifest {
	files?: unknown;
	pi?: unknown;
	scripts?: unknown;
}

interface PackageManifest {
	dependencies?: unknown;
	devDependencies?: unknown;
	optionalDependencies?: unknown;
	packageManager?: unknown;
	peerDependencies?: unknown;
	trustedDependencies?: unknown;
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
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
	return findings;
}

function hasInexactDependency(manifest: PackageManifest): boolean {
	const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
	for (const section of [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]) {
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
	}
	return findings;
}

async function auditAggregateManifest(root: string): Promise<SafetyFinding[]> {
	const manifest = JSON.parse(await readFile(join(root, AGGREGATE_MANIFEST), "utf8")) as AggregateManifest;
	const findings: SafetyFinding[] = [];
	if (!Array.isArray(manifest.files) || !arraysEqual(manifest.files, EXPECTED_PACKAGE_FILES)) {
		findings.push({ path: AGGREGATE_MANIFEST, rule: "package-files-allowlist" });
	}
	const expectedPiManifest = JSON.stringify({ extensions: ["./index.ts"] });
	if (JSON.stringify(manifest.pi) !== expectedPiManifest) {
		findings.push({ path: AGGREGATE_MANIFEST, rule: "package-pi-manifest" });
	}
	if (
		typeof manifest.scripts === "object" &&
		manifest.scripts !== null &&
		Object.keys(manifest.scripts).some((script) => LIFECYCLE_SCRIPTS.has(script))
	) {
		findings.push({ path: AGGREGATE_MANIFEST, rule: "package-lifecycle-script" });
	}
	return findings;
}

export async function auditPublicFiles(rootDirectory: string): Promise<SafetyFinding[]> {
	const root = resolve(rootDirectory);
	const paths = await listPublicFiles(root);
	const findings: SafetyFinding[] = [];
	for (const path of paths) {
		if (isForbiddenHostState(path)) {
			findings.push({ path, rule: "forbidden-host-state" });
			continue;
		}
		findings.push(...(await auditTextFile(root, path)));
		if (path.endsWith("package.json")) {
			findings.push(...(await auditPackageManifest(root, path)));
		}
	}
	if (paths.includes(AGGREGATE_MANIFEST)) {
		findings.push(...(await auditAggregateManifest(root)));
	}
	return findings;
}

if (import.meta.main) {
	const findings = await auditPublicFiles(resolve(import.meta.dir, ".."));
	if (findings.length > 0) {
		for (const finding of findings) {
			console.error(`${finding.path}: ${finding.rule}`);
		}
		process.exitCode = 1;
	} else {
		console.log("Public repository safety checks passed");
	}
}
