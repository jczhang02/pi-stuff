import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ZERO_SHA = "0".repeat(40);
const FAST_ONLY_PATH_PATTERNS = [/^\.beads\//u, /^[^/]+\.md$/u, /^docs\/.*\.(?:ansi|gif|html|md|png)$/u];

export function requiresFullAcceptance(paths: readonly string[]): boolean {
	if (paths.length === 0) return true;
	return paths.some((path) => !FAST_ONLY_PATH_PATTERNS.some((pattern) => pattern.test(path)));
}

function validRangeEndpoint(value: string | undefined): value is string {
	return value !== undefined && SHA_PATTERN.test(value) && value !== ZERO_SHA;
}

function changedPaths(base: string, head: string): string[] {
	const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB", "-z", base, head], {
		encoding: "utf8",
	});
	return output.split("\0").filter(Boolean);
}

function resolveAcceptanceRequirement(environment: NodeJS.ProcessEnv): {
	paths: readonly string[];
	required: boolean;
	reason: string;
} {
	if (environment["GITHUB_EVENT_NAME"] === "workflow_dispatch") {
		return { paths: [], required: true, reason: "manual dispatch always runs full acceptance" };
	}

	const base = environment["CI_BASE_SHA"];
	const head = environment["CI_HEAD_SHA"];
	if (!validRangeEndpoint(base) || !validRangeEndpoint(head)) {
		return { paths: [], required: true, reason: "change range is unavailable; failing open to full acceptance" };
	}

	try {
		const paths = changedPaths(base, head);
		return {
			paths,
			required: requiresFullAcceptance(paths),
			reason: paths.length === 0 ? "empty change set; failing open to full acceptance" : "classified changed paths",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`::warning::Could not classify the CI change range: ${message}`);
		return { paths: [], required: true, reason: "change classification failed; running full acceptance" };
	}
}

function main(): void {
	const result = resolveAcceptanceRequirement(process.env);
	const value = String(result.required);
	console.log(`Full acceptance required: ${value} (${result.reason})`);
	if (result.paths.length > 0) console.log(result.paths.map((path) => `- ${path}`).join("\n"));

	const outputPath = process.env["GITHUB_OUTPUT"];
	if (outputPath) appendFileSync(outputPath, `acceptance_required=${value}\n`, "utf8");
	else process.stdout.write(`${value}\n`);
}

if (import.meta.main) main();
