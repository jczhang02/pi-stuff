import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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
const IMMUTABLE_OWNED_RELEASE_DEPENDENCIES: Readonly<Record<string, string>> = {
	"@jczhang02/pi-magic-context":
		"https://github.com/jczhang02/magic-context/releases/download/pi-stuff-v0.33.1-2/pi-magic-context-0.33.1-pi-stuff.2-sha256-0c4cadfb35ad64d90a119eb8cd2bb5dffab43f5ba8096dfb9378b74dcd99bab3.tgz",
	"@jczhang02/pi-mcp-adapter":
		"https://github.com/jczhang02/pi-mcp-adapter/releases/download/pi-stuff-v2.19.0-7/jczhang02-pi-mcp-adapter-2.19.0-pi-stuff.7-2333b79-sha256-b0fbbcdcca56c28c49884b69002f1519504ab538afd1abf86e00247aeb441478.tgz",
	"@jczhang02/pi-web-access":
		"https://github.com/jczhang02/pi-web-access/releases/download/pi-stuff-v0.18.0-3/jczhang02-pi-web-access-0.18.0-pi-stuff.3-9209f76-sha256-83c4a158a43360daf4e513d89f4942cd6eba360118529d0f30b8ca4f06c3b33f.tgz",
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
}

function isPublishableWorkspaceManifest(path: string, manifest: PackageManifest): boolean {
	return /^packages\/[^/]+\/package\.json$/.test(path) && manifest.private !== true;
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
	for (const [section, allowOwnedRelease] of [
		[manifest.dependencies, true],
		[manifest.devDependencies, false],
		[manifest.optionalDependencies, false],
	] as const) {
		if (
			typeof section === "object" &&
			section !== null &&
			Object.entries(section).some(
				([name, version]) =>
					typeof version !== "string" ||
					(!exactVersion.test(version) &&
						(!allowOwnedRelease || IMMUTABLE_OWNED_RELEASE_DEPENDENCIES[name] !== version)),
			)
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
	if (isPublishableWorkspaceManifest(path, manifest)) {
		if (!hasExplicitFilesAllowlist(manifest.files)) {
			findings.push({ path, rule: "package-files-allowlist" });
		}
		const expectedPiManifest = JSON.stringify({ extensions: ["./index.ts"] });
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

export async function auditPublicFiles(rootDirectory: string): Promise<SafetyFinding[]> {
	const root = resolve(rootDirectory);
	const paths = await listPublicFiles(root);
	const findings: SafetyFinding[] = [];
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
		findings.push(...(await auditTextFile(root, path)));
		if (path.endsWith("package.json")) {
			findings.push(...(await auditPackageManifest(root, path)));
		}
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
