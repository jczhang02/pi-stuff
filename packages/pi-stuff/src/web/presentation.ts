import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import { activityKey, type SuiteToolPresentation } from "../tool-display/index.js";

type Arguments = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string {
	return isRuntimeString(value) ? value : "";
}

function errorResult(_args: Readonly<Arguments>, result: AgentToolResult<unknown>): boolean {
	return isRuntimeString(record(result.details)["error"]);
}

function searchResultIsError(_args: Readonly<Arguments>, result: AgentToolResult<unknown>): boolean {
	const details = record(result.details);
	if (isRuntimeString(details["error"])) return true;
	const successful = finiteNumber(details["successfulQueries"]);
	const total = finiteNumber(details["queryCount"]);
	return total !== undefined && total > 0 && successful === 0;
}

function fetchResultIsError(_args: Readonly<Arguments>, result: AgentToolResult<unknown>): boolean {
	const details = record(result.details);
	if (isRuntimeString(details["error"])) return true;
	const successful = finiteNumber(details["successful"]);
	const total = finiteNumber(details["urlCount"]);
	return total !== undefined && total > 0 && successful === 0;
}

function firstQuery(args: Readonly<Arguments>): string {
	const query = stringValue(args["query"]).trim();
	if (query) return query;
	const queries = Array.isArray(args["queries"])
		? args["queries"].filter((value): value is string => isRuntimeString(value))
		: [];
	if (queries.length === 1) return queries[0] ?? "";
	return queries.length > 1 ? `${String(queries.length)} queries` : "";
}

function hostname(raw: unknown): string {
	if (!isRuntimeString(raw)) return "";
	try {
		return new URL(raw).hostname;
	} catch {
		return raw;
	}
}

function fetchTarget(args: Readonly<Arguments>): string {
	if (isRuntimeString(args["url"])) return hostname(args["url"]);
	const urls = Array.isArray(args["urls"]) ? args["urls"] : [];
	const first = hostname(urls[0]);
	return urls.length > 1 ? `${first} +${String(urls.length - 1)}` : first;
}

function retrievalTarget(args: Readonly<Arguments>): string {
	const responseId = stringValue(args["responseId"]).slice(0, 8);
	const query = stringValue(args["query"]);
	const url = stringValue(args["url"]);
	const index = finiteNumber(args["queryIndex"]) ?? finiteNumber(args["urlIndex"]);
	const selector = query || hostname(url) || (index === undefined ? "" : `#${String(index)}`);
	return [responseId, selector].filter(Boolean).join(" ");
}

function searchSummary(args: Readonly<Arguments>, result: AgentToolResult<unknown>): string {
	const details = record(result.details);
	if (searchResultIsError(args, result)) return "failed";
	const successful = finiteNumber(details["successfulQueries"]);
	const total = finiteNumber(details["queryCount"]);
	const sources = finiteNumber(details["totalResults"]);
	if (successful !== undefined && total !== undefined) {
		return `${String(successful)}/${String(total)} queries · ${String(sources ?? 0)} sources`;
	}
	return sources === undefined ? "done" : `${String(sources)} sources`;
}

function fetchSummary(args: Readonly<Arguments>, result: AgentToolResult<unknown>): string {
	const details = record(result.details);
	if (fetchResultIsError(args, result)) return "failed";
	const successful = finiteNumber(details["successful"]);
	const total = finiteNumber(details["urlCount"]);
	if (successful !== undefined && total !== undefined) return `${String(successful)}/${String(total)} read`;
	return "done";
}

function retrievalSummary(_args: Readonly<Arguments>, result: AgentToolResult<unknown>): string {
	const details = record(result.details);
	if (isRuntimeString(details["error"])) return "failed";
	const matches = finiteNumber(details["returnedMatches"]) ?? finiteNumber(details["matchCount"]);
	if (matches !== undefined) return `${String(matches)} matches`;
	const returned = finiteNumber(details["returnedChars"]);
	if (returned !== undefined) return `${String(returned)} chars`;
	const count = finiteNumber(details["resultCount"]);
	return count === undefined ? "done" : `${String(count)} sources`;
}

export const WEB_SEARCH_PRESENTATION: SuiteToolPresentation<Arguments, unknown> = {
	activity: {
		categories: ["search-web"],
		classify: ({ args }) => {
			const queries = isRuntimeString(args["query"])
				? [args["query"]]
				: Array.isArray(args["queries"])
					? args["queries"].filter((value): value is string => isRuntimeString(value))
					: [];
			return [
				{ category: "search-web", countKeys: queries.map((query) => activityKey(query)), target: firstQuery(args) },
			];
		},
	},
	label: "Web search",
	resultIsError: searchResultIsError,
	runningSummary: "searching",
	summarize: searchSummary,
	target: firstQuery,
};

export const WEB_FETCH_PRESENTATION: SuiteToolPresentation<Arguments, unknown> = {
	activity: {
		categories: ["fetch-page"],
		classify: ({ args }) => {
			const urls = isRuntimeString(args["url"])
				? [args["url"]]
				: Array.isArray(args["urls"])
					? args["urls"].filter((value): value is string => isRuntimeString(value))
					: [];
			return [{ category: "fetch-page", countKeys: urls.map((url) => activityKey(url)), target: fetchTarget(args) }];
		},
	},
	label: "Web fetch",
	resultIsError: fetchResultIsError,
	runningSummary: "reading",
	summarize: fetchSummary,
	target: fetchTarget,
};

export const WEB_CONTENT_PRESENTATION: SuiteToolPresentation<Arguments, unknown> = {
	activity: {
		categories: ["retrieve-passage"],
		classify: ({ args }) => [
			{
				category: "retrieve-passage",
				countKeys: [
					activityKey(
						args["responseId"],
						args["query"],
						args["queryIndex"],
						args["url"],
						args["urlIndex"],
						args["offset"],
					),
				],
				target: retrievalTarget(args),
			},
		],
	},
	label: "Web content",
	resultIsError: errorResult,
	runningSummary: "retrieving",
	summarize: retrievalSummary,
	target: retrievalTarget,
};
