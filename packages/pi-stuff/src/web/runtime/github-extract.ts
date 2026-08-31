import * as Effect from "effect/Effect";
import type { ExtractedContent } from "./extract.ts";
import { fetchViaApi } from "./github-api.ts";

const NON_CODE_SEGMENTS = new Set([
	"issues",
	"pull",
	"pulls",
	"discussions",
	"releases",
	"wiki",
	"actions",
	"settings",
	"security",
	"projects",
	"graphs",
	"compare",
	"commits",
	"tags",
	"branches",
	"stargazers",
	"watchers",
	"network",
	"forks",
	"milestone",
	"labels",
	"packages",
	"codespaces",
	"contribute",
	"community",
	"sponsors",
	"invitations",
	"notifications",
	"insights",
]);

export interface GitHubUrlInfo {
	owner: string;
	repo: string;
	ref?: string;
	refIsFullSha: boolean;
	path?: string;
	type: "root" | "blob" | "tree";
}

export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;

	const segments = parsed.pathname
		.split("/")
		.filter(Boolean)
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		});
	if (segments.length < 2 || NON_CODE_SEGMENTS.has(segments[2]?.toLowerCase() ?? "")) return null;

	const [owner, rawRepo] = segments;
	if (!owner || !rawRepo) return null;
	const repo = rawRepo.replace(/\.git$/, "");
	if (segments.length === 2) return { owner, repo, refIsFullSha: false, type: "root" };

	const type = segments[2];
	if ((type !== "blob" && type !== "tree") || segments.length < 4) return null;
	const ref = segments[3];
	if (!ref) return null;
	const path = segments.slice(4).join("/");
	const info: GitHubUrlInfo = {
		owner,
		repo,
		ref,
		refIsFullSha: /^[0-9a-f]{40}$/.test(ref),
		type,
	};
	if (path) info.path = path;
	return info;
}

export function extractGitHub(url: string): Effect.Effect<ExtractedContent | null> {
	const info = parseGitHubUrl(url);
	if (!info) return Effect.succeed(null);
	return fetchViaApi(url, info.owner, info.repo, info);
}
