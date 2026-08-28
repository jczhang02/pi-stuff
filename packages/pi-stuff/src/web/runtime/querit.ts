import type { JsonInputValue } from "../../shared/json-value.js";
import { isJsonInputObject, type JsonInputObject, parseJsonObject } from "../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../shared/runtime-type.js";
import { normalizeProviderDomain as normalizeDomain } from "../provider-domain-filter.ts";
import { activityMonitor } from "./activity.ts";
import { readWebConfig } from "./config.ts";
import { hasCredentialSource, redactCredential, requireCredential } from "./credential-source.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { errorMessage, formatSearchSources, getWebSearchConfigPath, normalizeCount, requestSignal } from "./utils.ts";

const QUERIT_SEARCH_URL = "https://api.querit.ai/v1/search";
const QUERIT_CONTENTS_URL = "https://api.querit.ai/v1/contents";
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const SEARCH_TIMEOUT_MS = 60_000;
const CONTENTS_TIMEOUT_MS = 60_000;
const MAX_CONTENT_URLS = 10;

interface QueritSearchOptions extends SearchOptions {
	includeContent?: boolean;
}

function loadConfig() {
	return readWebConfig() ?? {};
}

async function getApiKey(signal?: AbortSignal): Promise<string> {
	return requireCredential(
		{
			provider: "Querit",
			configuredValue: loadConfig()["queritApiKey"],
			environmentValue: process.env["QUERIT_API_KEY"],
			signal,
		},
		"Querit API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "queritApiKey": "your-key" }\n` +
			"  2. Set QUERIT_API_KEY environment variable\n" +
			"Create a key at https://www.querit.ai/en/dashboard/api-keys",
	);
}

export function isQueritAvailable(): boolean {
	return hasCredentialSource({
		provider: "Querit",
		configuredValue: loadConfig()["queritApiKey"],
		environmentValue: process.env["QUERIT_API_KEY"],
	});
}

function mapDomainFilter(domainFilter: string[] | undefined) {
	const include: string[] = [];
	const exclude: string[] = [];
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? exclude : include;
		if (!target.includes(domain)) target.push(domain);
	}
	return { include, exclude };
}

function mapRecencyFilter(value: SearchOptions["recencyFilter"]): string | undefined {
	if (value === "day") return "d1";
	if (value === "week") return "w1";
	if (value === "month") return "m1";
	if (value === "year") return "y1";
	return undefined;
}

function buildSearchBody(query: string, options: QueritSearchOptions): JsonInputObject {
	const { include, exclude } = mapDomainFilter(options.domainFilter);
	const date = mapRecencyFilter(options.recencyFilter);
	const filters: JsonInputObject = {};
	if (include.length > 0 || exclude.length > 0) {
		const sites: JsonInputObject = {};
		if (include.length > 0) sites["include"] = include;
		if (exclude.length > 0) sites["exclude"] = exclude;
		filters["sites"] = sites;
	}
	if (date) filters["timeRange"] = { date };
	const body: JsonInputObject = {
		query,
		count: normalizeCount(options.numResults),
	};
	if (Object.keys(filters).length > 0) body["filters"] = filters;
	return body;
}

function normalizeTimeoutMs(value: number | undefined): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return CONTENTS_TIMEOUT_MS;
	return Math.max(1, Math.floor(value));
}

function crawlTimeoutSeconds(value: number | undefined): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return 10;
	return Math.max(1, Math.min(Math.ceil(value / 1_000), 60));
}

function buildContentsBody(urls: string[], options: ExtractOptions = {}): JsonInputObject {
	return {
		urls,
		format: "markdown",
		crawlTimeout: crawlTimeoutSeconds(options.timeoutMs),
		extrasMeta: true,
	};
}

async function queritJsonRequest(
	label: "Search" | "Contents",
	url: string,
	apiKey: string,
	body: JsonInputObject,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<JsonInputObject> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: requestSignal(signal, timeoutMs),
		});
	} catch (err) {
		const message = errorMessage(err);
		const isRequestAbort =
			err instanceof Error
				? err.name === "AbortError" || err.name === "TimeoutError" || /abort|timeout/i.test(message)
				: /abort|timeout/i.test(message);
		if (!signal?.aborted && isRequestAbort) {
			const timeoutError = new Error(
				`Querit ${label} API request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`,
			);
			timeoutError.name = "TimeoutError";
			throw timeoutError;
		}
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}

	const raw = await response.text();
	if (!response.ok) {
		throw new Error(`Querit ${label} API error ${response.status}: ${redactCredential(raw, apiKey).slice(0, 300)}`);
	}
	try {
		return parseJsonObject(raw);
	} catch (err) {
		throw new Error(`Querit ${label} API returned invalid JSON: ${errorMessage(err)}`);
	}
}

function assertApiSuccess(label: "Search" | "Contents", data: JsonInputObject): void {
	const code = Number(data["error_code"]);
	if (!Number.isFinite(code) || code !== 200) {
		const renderedCode = data["error_code"] === undefined ? "unknown" : String(data["error_code"]);
		const message =
			isRuntimeString(data["error_msg"]) && data["error_msg"].trim() ? `: ${data["error_msg"].trim()}` : "";
		throw new Error(`Querit ${label} API returned error ${renderedCode}${message}`);
	}
}

function mapSearchResults(data: JsonInputObject): SearchResponse["results"] {
	const resultEnvelope = isJsonInputObject(data["results"]) ? data["results"] : undefined;
	const items = resultEnvelope?.["result"];
	if (!Array.isArray(items)) {
		throw new Error("Querit Search API returned an unexpected response shape");
	}
	return items.flatMap((item) => {
		if (!isJsonInputObject(item) || !isRuntimeString(item.url) || item.url.trim().length === 0) return [];
		const url = item.url.trim();
		return [
			{
				title: isRuntimeString(item.title) && item.title.trim() ? item.title.trim() : url,
				url,
				snippet: isRuntimeString(item.snippet) ? item.snippet.replace(/\s+/g, " ").trim() : "",
			},
		];
	});
}

function mapContentResult(result: JsonInputValue, requestedUrl: string): ExtractedContent | null {
	if (!isJsonInputObject(result) || !isRuntimeString(result["content"]) || result["content"].trim().length === 0)
		return null;
	const metadata = isJsonInputObject(result["extrasMeta"]) ? result["extrasMeta"] : undefined;
	return {
		url: requestedUrl,
		title: metadata && isRuntimeString(metadata["title"]) ? metadata["title"].trim() : "",
		content: result["content"].trim(),
		error: null,
	};
}

function findContentResult(
	data: JsonInputObject,
	requestedUrl: string,
	index: number,
	requestedCount: number,
): JsonInputObject | undefined {
	if (!Array.isArray(data["results"])) return undefined;
	const exact = data["results"].find((item): item is JsonInputObject => {
		if (!isJsonInputObject(item)) return false;
		const metadata = isJsonInputObject(item.extrasMeta) ? item.extrasMeta : undefined;
		return item.url === requestedUrl || metadata?.url === requestedUrl;
	});
	if (exact) return exact;
	if (requestedCount === 1) return isJsonInputObject(data["results"][0]) ? data["results"][0] : undefined;
	const indexed = data["results"].length === requestedCount ? data["results"][index] : undefined;
	return isJsonInputObject(indexed) ? indexed : undefined;
}

function failedContentStatus(data: JsonInputObject, result: JsonInputObject | undefined, index: number): boolean {
	if (!Array.isArray(data["statuses"])) return false;
	const status = result?.["id"]
		? data["statuses"].find((item): item is JsonInputObject => isJsonInputObject(item) && item.id === result["id"])
		: data["statuses"][index];
	return isJsonInputObject(status) && status.status === "failed";
}

async function fetchContentsBatch(
	urls: string[],
	apiKey: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<JsonInputObject> {
	const data = await queritJsonRequest(
		"Contents",
		QUERIT_CONTENTS_URL,
		apiKey,
		buildContentsBody(urls, options),
		normalizeTimeoutMs(options.timeoutMs),
		signal,
	);
	assertApiSuccess("Contents", data);
	if (!Array.isArray(data["results"]) || !Array.isArray(data["statuses"])) {
		throw new Error("Querit Contents API returned an unexpected response shape");
	}
	return data;
}

async function fetchInlineContent(urls: string[], apiKey: string, signal?: AbortSignal): Promise<ExtractedContent[]> {
	const content: ExtractedContent[] = [];
	for (let offset = 0; offset < urls.length; offset += MAX_CONTENT_URLS) {
		const batch = urls.slice(offset, offset + MAX_CONTENT_URLS);
		const data = await fetchContentsBatch(batch, apiKey, signal);
		for (const [index, requestedUrl] of batch.entries()) {
			const result = findContentResult(data, requestedUrl, index, batch.length);
			const mapped = mapContentResult(result, requestedUrl);
			if (mapped) content.push(mapped);
		}
	}
	return content;
}

export async function searchWithQuerit(query: string, options: QueritSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const activityId = activityMonitor.logStart({ type: "api", query });
	try {
		const data = await queritJsonRequest(
			"Search",
			QUERIT_SEARCH_URL,
			apiKey,
			buildSearchBody(query, options),
			SEARCH_TIMEOUT_MS,
			options.signal,
		);
		assertApiSuccess("Search", data);
		const results = mapSearchResults(data);
		const response: SearchResponse = { answer: formatSearchSources(results), results };
		if (options.includeContent && results.length > 0) {
			const inlineContent = await fetchInlineContent(
				results.map((result) => result.url),
				apiKey,
				options.signal,
			);
			if (inlineContent.length > 0) response.inlineContent = inlineContent;
		}
		activityMonitor.logComplete(activityId, 200);
		return response;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (options.signal?.aborted) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}

export async function extractWithQuerit(
	url: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<ExtractedContent | null> {
	const apiKey = await getApiKey(signal);
	const activityId = activityMonitor.logStart({ type: "fetch", url });
	try {
		const data = await fetchContentsBatch([url], apiKey, signal, options);
		const result = findContentResult(data, url, 0, 1);
		const mapped = mapContentResult(result, url);
		if (mapped) {
			activityMonitor.logComplete(activityId, 200);
			return mapped;
		}
		if (failedContentStatus(data, result, 0)) {
			throw new Error(`Querit Contents API failed to crawl ${url}`);
		}
		activityMonitor.logComplete(activityId, 200);
		return null;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (signal?.aborted) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}
