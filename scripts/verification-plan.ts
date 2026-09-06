import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { discoverTestFiles, importsOf, testCapability } from "./test-inventory.ts";

export type VerificationPlan = {
	version: 1;
	profile: "offline";
	base: string | null;
	head: string | null;
	mode: "all" | "selected" | "none";
	reason: string;
	changedFiles: string[];
	files: string[];
};

const SHA = /^[0-9a-f]{40}$/u;
const ZERO = "0".repeat(40);

function git(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
function validRef(ref: string | undefined): ref is string {
	return !!ref && SHA.test(ref) && ref !== ZERO;
}
function allTests(root: string): string[] {
	return discoverTestFiles(resolve(root, "test"))
		.map((file) => relative(root, file))
		.filter((file) => !file.endsWith("-live.test.ts"));
}
function changedBetween(root: string, base: string, head: string): string[] {
	return git(root, ["diff", "--name-only", "--diff-filter=ACDMRTUXB", "-z", base, head]).split("\0").filter(Boolean);
}
function localChanges(root: string): string[] {
	const paths = new Set<string>();
	for (const args of [
		["diff", "--name-only", "--diff-filter=ACDMRTUXB", "-z"],
		["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB", "-z"],
	])
		for (const file of git(root, args).split("\0").filter(Boolean)) paths.add(file);
	for (const file of git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))
		paths.add(file);
	return [...paths].sort();
}
function metadataOnly(path: string): boolean {
	return (
		path.startsWith(".beads/") ||
		/^(?:[^/]+|docs\/[^/]+)\.md$/u.test(path) ||
		/^docs\/.*\.(?:md|ansi|png|gif)$/u.test(path)
	);
}
function executableDocumentation(path: string, root: string): boolean {
	if (!path.startsWith("docs/") || (!metadataOnly(path) && !/[.](?:sh|bash|ts|js|mjs|py|rb|exs|html)$/u.test(path)))
		return false;
	if (/[.](?:sh|bash|ts|js|mjs|py|rb|exs|html)$/u.test(path)) return true;
	try {
		return /```(?:bash|sh|shell|typescript|javascript|js|python|console)\b|<script\b/iu.test(
			readFileSync(resolve(root, path), "utf8"),
		);
	} catch {
		return true;
	}
}
function pureMetadata(path: string, root: string): boolean {
	return metadataOnly(path) && !executableDocumentation(path, root);
}
function sharedChange(path: string): boolean {
	return /^(?:packages\/pi-stuff\/suite\.json|packages\/pi-stuff\/src\/suite-(?:loader|runtime)\.|packages\/pi-stuff\/package\.json|scripts\/test-|scripts\/run-isolated-tests|scripts\/verification-plan|package\.json|bun\.lockb?|tsconfig|config\/|schemas\/|\.github\/|docs\/compatibility\.md|AGENTS\.md|CONTEXT\.md)/u.test(
		path,
	);
}
function sourceCapability(path: string): string | undefined {
	const match = /^packages\/pi-stuff\/src\/([^/]+)\//u.exec(path);
	return match?.[1];
}
function resolvedImport(root: string, from: string, specifier: string): string | undefined {
	if (!specifier.startsWith(".")) return undefined;
	const base = resolve(root, dirname(from), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`]) {
		try {
			if (readFileSync(candidate, "utf8") !== undefined) return relative(root, candidate);
		} catch {
			// Try the next TypeScript/JavaScript extension.
		}
	}
	return undefined;
}
function sourceInventory(root: string): string[] {
	const found: string[] = [];
	function visit(directory: string): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && /\.(?:[cm]?tsx?|[cm]?jsx?)$/u.test(entry.name)) found.push(relative(root, path));
		}
	}
	visit(resolve(root, "packages/pi-stuff/src"));
	return found;
}
function impactedCapabilities(root: string, changed: string[], all: string[]): Set<string> {
	const impacted = new Set(
		changed.flatMap((path) => {
			const capability = sourceCapability(path);
			return capability ? [capability] : [];
		}),
	);
	const changedSources = changed.filter((path) => path.startsWith("packages/pi-stuff/src/") && !path.endsWith("/"));
	if (!changedSources.length) return impacted;
	const sourceFiles = sourceInventory(root);
	const seen = new Set(changedSources);
	let progress = true;
	while (progress) {
		progress = false;
		for (const file of sourceFiles) {
			if (seen.has(file)) continue;
			if (
				importsOf(root, file).some((specifier) => {
					const target = resolvedImport(root, file, specifier);
					return target !== undefined && seen.has(target);
				})
			) {
				seen.add(file);
				const cap = sourceCapability(file);
				if (cap) impacted.add(cap);
				progress = true;
			}
		}
	}
	for (const file of all) {
		if (!file.startsWith("test/")) continue;
		if (
			importsOf(root, file).some((specifier) => {
				const target = resolvedImport(root, file, specifier);
				return target !== undefined && seen.has(target);
			})
		) {
			const cap = testCapability(file);
			if (cap) impacted.add(cap);
		}
	}
	return impacted;
}
function selectTests(root: string, changed: string[], all: string[]): { files: string[]; reason: string } {
	if (!changed.length) return { files: all, reason: "clean or empty change set; all applicable offline tests" };
	if (
		changed.some(
			(path) =>
				sharedChange(path) ||
				executableDocumentation(path, root) ||
				(!metadataOnly(path) && !existsSync(resolve(root, path))),
		)
	)
		return {
			files: all,
			reason: "shared infrastructure, executable documentation, or uncertain path; all applicable offline tests",
		};
	if (changed.every((path) => pureMetadata(path, root)))
		return { files: [], reason: "proven non-executable metadata-only change" };
	const caps = impactedCapabilities(root, changed, all);
	for (const path of changed) {
		const cap = sourceCapability(path) ?? (path.startsWith("test/") ? testCapability(path) : undefined);
		if (cap) caps.add(cap);
	}
	if (!caps.size) return { files: all, reason: "unknown impact; all applicable offline tests" };
	// Every system-level test may observe Suite composition and can accompany a production change.
	const files = all.filter((file) => {
		const level = file.split("/")[1];
		return (
			caps.has(testCapability(file) ?? "") ||
			level === "system" ||
			level === "system-integration" ||
			level === "acceptance"
		);
	});
	return {
		files: files.length ? files : all,
		reason: `selected changed Capability(s): ${[...caps].sort().join(", ")}`,
	};
}

export function buildVerificationPlan(
	root = process.cwd(),
	environment: NodeJS.ProcessEnv = process.env,
): VerificationPlan {
	const head = validRef(environment["CI_HEAD_SHA"])
		? environment["CI_HEAD_SHA"]
		: (() => {
				try {
					return git(root, ["rev-parse", "HEAD"]).trim();
				} catch {
					return null;
				}
			})();
	let base = validRef(environment["CI_BASE_SHA"]) ? environment["CI_BASE_SHA"] : null;
	let changed: string[];
	const all = allTests(root);
	if (
		(environment["CI_BASE_SHA"] && !validRef(environment["CI_BASE_SHA"])) ||
		(environment["CI_HEAD_SHA"] && !validRef(environment["CI_HEAD_SHA"])) ||
		(environment["VERIFY_BASE"] && !validRef(environment["VERIFY_BASE"]))
	)
		return {
			version: 1,
			profile: "offline",
			base,
			head,
			mode: "all",
			reason: "attempted base or head is invalid; all applicable offline tests",
			changedFiles: [],
			files: all,
		};
	if (environment["GITHUB_EVENT_NAME"] === "workflow_dispatch")
		return {
			version: 1,
			profile: "offline",
			base,
			head,
			mode: "all",
			reason: "manual dispatch always runs all applicable offline tests",
			changedFiles: [],
			files: allTests(root),
		};
	try {
		if (base && head) {
			if (environment["GITHUB_EVENT_NAME"] === "pull_request") base = git(root, ["merge-base", base, head]).trim();
			changed = changedBetween(root, base, head);
		} else {
			const main = environment["VERIFY_BASE"] ?? git(root, ["rev-parse", "--verify", "origin/main"]).trim();
			base = git(root, ["merge-base", main, "HEAD"]).trim();
			changed = localChanges(root);
		}
	} catch (error) {
		const all = allTests(root);
		return {
			version: 1,
			profile: "offline",
			base,
			head,
			mode: "all",
			reason: `could not establish a reliable change range (${String(error)}); all applicable offline tests`,
			changedFiles: [],
			files: all,
		};
	}
	const selected = selectTests(root, changed, all);
	return {
		version: 1,
		profile: "offline",
		base,
		head,
		mode: selected.files.length === 0 ? "none" : selected.files.length === all.length ? "all" : "selected",
		reason: selected.reason,
		changedFiles: changed,
		files: selected.files,
	};
}

function main(): void {
	const plan = buildVerificationPlan();
	const output = process.argv.includes("--output")
		? process.argv[process.argv.indexOf("--output") + 1]
		: ".artifacts/verification-plan.json";
	if (process.argv.includes("--help")) {
		console.log("Usage: bun scripts/verification-plan.ts [--ci] [--output <path>]");
		return;
	}
	Bun.write(output ?? ".artifacts/verification-plan.json", `${JSON.stringify(plan, null, 2)}\n`);
	if (process.env["GITHUB_OUTPUT"])
		appendFileSync(process.env["GITHUB_OUTPUT"], `tests_required=${plan.mode === "none" ? "false" : "true"}\n`);
	console.log(`${plan.mode}: ${plan.reason}`);
}
if (import.meta.main) main();
