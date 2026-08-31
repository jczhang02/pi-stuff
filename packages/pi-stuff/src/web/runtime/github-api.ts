import { execFile } from "node:child_process";
import * as Effect from "effect/Effect";
import { reportWebDiagnostic } from "./diagnostics.ts";
import type { ExtractedContent } from "./extract.ts";
import type { GitHubUrlInfo } from "./github-extract.ts";

const MAX_TREE_ENTRIES = 200;
const MAX_INLINE_FILE_CHARS = 100_000;

let ghAvailable: boolean | null = null;
let ghHintShown = false;

function execGh(
	args: readonly string[],
	options: { readonly maxBuffer?: number; readonly timeout: number },
): Effect.Effect<string | null> {
	return Effect.callback((resume, signal) => {
		execFile("gh", args, { ...options, encoding: "utf8", signal }, (error, stdout) => {
			resume(Effect.succeed(error ? null : stdout));
		});
	});
}

export function checkGhAvailable(): Effect.Effect<boolean> {
	if (ghAvailable !== null) return Effect.succeed(ghAvailable);
	return execGh(["--version"], { timeout: 5_000 }).pipe(
		Effect.map((stdout) => {
			ghAvailable = stdout !== null;
			return ghAvailable;
		}),
	);
}

export function showGhHint(): void {
	if (!ghHintShown) {
		ghHintShown = true;
		reportWebDiagnostic("GitHub CLI is unavailable; private repository access is limited", undefined, {
			action: "Install gh to access private repositories",
			key: "missing-gh",
			notice: true,
			severity: "warning",
		});
	}
}

export function checkRepoSize(owner: string, repo: string): Effect.Effect<number | null> {
	return Effect.gen(function* () {
		if (!(yield* checkGhAvailable())) return null;
		const stdout = yield* execGh(["api", `repos/${owner}/${repo}`, "--jq", ".size"], { timeout: 10_000 });
		if (stdout === null) return null;
		const kb = Number.parseInt(stdout.trim(), 10);
		return Number.isNaN(kb) ? null : kb;
	});
}

function getDefaultBranch(owner: string, repo: string): Effect.Effect<string | null> {
	return Effect.gen(function* () {
		if (!(yield* checkGhAvailable())) return null;
		const stdout = yield* execGh(["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"], {
			timeout: 10_000,
		});
		return stdout?.trim() || null;
	});
}

function fetchTreeViaApi(owner: string, repo: string, ref: string): Effect.Effect<string | null> {
	return Effect.gen(function* () {
		if (!(yield* checkGhAvailable())) return null;
		const stdout = yield* execGh(
			["api", `repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, "--jq", ".tree[].path"],
			{ timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
		);
		if (stdout === null) return null;
		const paths = stdout.trim().split("\n").filter(Boolean);
		if (paths.length === 0) return null;
		const display = paths.slice(0, MAX_TREE_ENTRIES).join("\n");
		return paths.length > MAX_TREE_ENTRIES ? `${display}\n... (${String(paths.length)} total entries)` : display;
	});
}

function fetchReadmeViaApi(owner: string, repo: string, ref: string): Effect.Effect<string | null> {
	return Effect.gen(function* () {
		if (!(yield* checkGhAvailable())) return null;
		const stdout = yield* execGh(["api", `repos/${owner}/${repo}/readme?ref=${ref}`, "--jq", ".content"], {
			timeout: 10_000,
		});
		if (stdout === null) return null;
		try {
			const decoded = Buffer.from(stdout.trim(), "base64").toString("utf-8");
			return decoded.length > 8_192 ? `${decoded.slice(0, 8_192)}\n\n[README truncated at 8K chars]` : decoded;
		} catch {
			return null;
		}
	});
}

function fetchFileViaApi(owner: string, repo: string, path: string, ref: string): Effect.Effect<string | null> {
	return Effect.gen(function* () {
		if (!(yield* checkGhAvailable())) return null;
		const stdout = yield* execGh(["api", `repos/${owner}/${repo}/contents/${path}?ref=${ref}`, "--jq", ".content"], {
			timeout: 10_000,
			maxBuffer: 2 * 1024 * 1024,
		});
		if (stdout === null) return null;
		try {
			return Buffer.from(stdout.trim(), "base64").toString("utf-8");
		} catch {
			return null;
		}
	});
}

export function fetchViaApi(
	url: string,
	owner: string,
	repo: string,
	info: GitHubUrlInfo,
	sizeNote?: string,
): Effect.Effect<ExtractedContent | null> {
	return Effect.gen(function* () {
		const ref = info.ref || (yield* getDefaultBranch(owner, repo));
		if (!ref) return null;

		const lines: string[] = [];
		if (sizeNote) lines.push(sizeNote, "");

		if (info.type === "blob" && info.path) {
			const content = yield* fetchFileViaApi(owner, repo, info.path, ref);
			if (!content) return null;
			lines.push(`## ${info.path}`);
			if (content.length > MAX_INLINE_FILE_CHARS) {
				lines.push(content.slice(0, MAX_INLINE_FILE_CHARS), "\n[File truncated at 100K chars]");
			} else {
				lines.push(content);
			}
			return { url, title: `${owner}/${repo} - ${info.path}`, content: lines.join("\n"), error: null };
		}

		const [tree, readme] = yield* Effect.all(
			[fetchTreeViaApi(owner, repo, ref), fetchReadmeViaApi(owner, repo, ref)],
			{ concurrency: "unbounded" },
		);
		if (!tree && !readme) return null;
		if (tree) lines.push("## Structure", tree, "");
		if (readme) lines.push("## README.md", readme, "");
		lines.push("This is an API-only view. Clone the repo or use `read`/`bash` for deeper exploration.");
		return {
			url,
			title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
			content: lines.join("\n"),
			error: null,
		};
	});
}
