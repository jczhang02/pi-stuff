import { normalizeProviderDomain as normalizeDomain } from "../provider-domain-filter.ts";
import type { JsonInputValue } from "../../shared/json-value.js";
import { isJsonInputObject, parseJsonObject, type JsonInputObject } from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { readWebConfigText, webConfigExists } from "../settings.ts";

import { activityMonitor } from "./activity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const SEARCH1API_SEARCH_URL = "https://api.search1api.com/search";
const SEARCH1API_CRAWL_URL = "https://api.search1api.com/crawl";
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const SEARCH_TIMEOUT_MS = 60_000;
const CRAWL_TIMEOUT_MS = 60_000;

interface WebSearchConfig extends JsonInputObject {
	search1apiApiKey?: JsonInputValue;
}

interface Search1APISearchOptions extends SearchOptions {
	includeContent?: boolean;
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
	if (!webConfigExists()) {
		cachedConfig = {};
		return cachedConfig;
	}

	const raw = readWebConfigText();
	let parsed: JsonInputValue;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
	if (!isJsonInputObject(parsed)) {
		throw new Error(`Invalid config in ${CONFIG_PATH}: expected a JSON object`);
	}
	cachedConfig = parsed;
	return cachedConfig;
}

async function getApiKey(signal?: AbortSignal): Promise<string> {
	const key = await resolveCredential({
		provider: "Search1API",
		configuredValue: loadConfig().search1apiApiKey,
		environmentValue: process.env.SEARCH1API_KEY,
		signal,
	});
	if (!key) {
		throw new Error(
			"Search1API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "search1apiApiKey": "your-key" }\n` +
			"  2. Set SEARCH1API_KEY environment variable\n" +
			"Create a key at https://dashboard.search1api.com",
		);
	}
	return key;
}

export function isSearch1APIAvailable(): boolean {
	return hasCredentialSource({
		provider: "Search1API",
		configuredValue: loadConfig().search1apiApiKey,
		environmentValue: process.env.SEARCH1API_KEY,
	});
}

function errorMessage(err: JsonInputValue): string {
	return err instanceof Error ? err.message : String(err);
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function normalizeNumResults(value: number | undefined): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function mapDomainFilter(domainFilter: string[] | undefined) {
	const includeSites: string[] = [];
	const excludeSites: string[] = [];
	for (const raw of domainFilter ?? []) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? excludeSites : includeSites;
		if (!target.includes(domain)) target.push(domain);
	}
	return { includeSites, excludeSites };
}

function buildSearchBody(query: string, options: Search1APISearchOptions): JsonInputObject {
	const numResults = normalizeNumResults(options.numResults);
	const { includeSites, excludeSites } = mapDomainFilter(options.domainFilter);
	const body: JsonInputObject = {
		query,
		max_results: numResults,
		crawl_results: options.includeContent ? numResults : 0,
	};
	if (includeSites.length > 0) body.include_sites = includeSites;
	if (excludeSites.length > 0) body.exclude_sites = excludeSites;
	if (options.recencyFilter) body.time_range = options.recencyFilter;
	return body;
}

async function search1APIJsonRequest(
	label: "Search" | "Crawl",
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
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: requestSignal(signal, timeoutMs),
		});
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}

	const raw = await response.text();
	if (!response.ok) {
		throw new Error(`Search1API ${label} API error ${response.status}: ${redactCredential(raw, apiKey).slice(0, 300)}`);
	}
	try {
		return parseJsonObject(raw);
	} catch (err) {
		throw new Error(`Search1API ${label} API returned invalid JSON: ${errorMessage(err)}`);
	}
}

function mapSearchResults(results: JsonInputValue): SearchResponse["results"] {
	if (!Array.isArray(results)) {
		throw new Error("Search1API Search API returned an unexpected response shape");
	}
	return results.flatMap((item) => {
		if (!isJsonInputObject(item) || !isRuntimeString(item.link) || item.link.trim().length === 0) return [];
		const url = item.link.trim();
		return [{
			title: isRuntimeString(item.title) && item.title.trim() ? item.title.trim() : url,
			url,
			snippet: isRuntimeString(item.snippet) ? item.snippet.replace(/\s+/g, " ").trim() : "",
		}];
	});
}

function mapInlineContent(results: JsonInputValue): ExtractedContent[] {
	if (!Array.isArray(results)) return [];
	return results.flatMap((item) => {
		if (!isJsonInputObject(item) || !isRuntimeString(item.link) || item.link.trim().length === 0) return [];
		if (!isRuntimeString(item.content) || item.content.trim().length === 0) return [];
		return [{
			url: item.link.trim(),
			title: isRuntimeString(item.title) ? item.title.trim() : "",
			content: item.content,
			error: null,
		}];
	});
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => {
		if (result.snippet) return `${result.snippet}\nSource: ${result.title} (${result.url})`;
		return `Source: ${result.title} (${result.url})`;
	}).join("\n\n");
}

export async function searchWithSearch1API(
	query: string,
	options: Search1APISearchOptions = {},
): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const activityId = activityMonitor.logStart({ type: "api", query });
	try {
		const data = await search1APIJsonRequest(
			"Search",
			SEARCH1API_SEARCH_URL,
			apiKey,
			buildSearchBody(query, options),
			SEARCH_TIMEOUT_MS,
			options.signal,
		);
		const results = mapSearchResults(data.results);
		const response: SearchResponse = { answer: buildAnswer(results), results };
		if (options.includeContent) {
			const inlineContent = mapInlineContent(data.results);
			if (inlineContent.length > 0) response.inlineContent = inlineContent;
		}
		activityMonitor.logComplete(activityId, 200);
		return response;
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}

export async function extractWithSearch1API(
	url: string,
	signal?: AbortSignal,
	options: ExtractOptions = {},
): Promise<ExtractedContent | null> {
	const apiKey = await getApiKey(signal);
	const activityId = activityMonitor.logStart({ type: "fetch", url });
	try {
		const data = await search1APIJsonRequest(
			"Crawl",
			SEARCH1API_CRAWL_URL,
			apiKey,
			{ url },
			isRuntimeNumber(options.timeoutMs) && Number.isFinite(options.timeoutMs)
				? Math.max(1, Math.floor(options.timeoutMs))
				: CRAWL_TIMEOUT_MS,
			signal,
		);
		const result = data.results;
		if (!isJsonInputObject(result)) {
			throw new Error("Search1API Crawl API returned an unexpected response shape");
		}
		const content = isRuntimeString(result.content) ? result.content.trim() : "";
		if (!content) {
			activityMonitor.logComplete(activityId, 200);
			return null;
		}
		activityMonitor.logComplete(activityId, 200);
		return {
			url,
			title: isRuntimeString(result.title) ? result.title.trim() : "",
			content,
			error: null,
		};
	} catch (err) {
		const message = errorMessage(err);
		const redactedMessage = redactCredential(message, apiKey);
		if (redactedMessage.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, redactedMessage);
		if (redactedMessage === message) throw err;
		const redactedError = new Error(redactedMessage);
		if (err instanceof Error) redactedError.name = err.name;
		throw redactedError;
	}
}
