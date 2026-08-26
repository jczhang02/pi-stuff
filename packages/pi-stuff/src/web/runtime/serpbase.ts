import {
	hostMatchesProviderDomain as domainMatches,
	normalizeProviderDomain as normalizeDomain,
} from "../provider-domain-filter.ts";
import { isJsonInputObject, type JsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { readWebConfigText, webConfigExists } from "../settings.ts";

import { activityMonitor } from "./activity.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const SERPBASE_API_URL = "https://api.serpbase.dev/google/search";
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const SEARCH_TIMEOUT_MS = 60_000;
const RECENCY_TBS = {
	day: "qdr:d",
	week: "qdr:w",
	month: "qdr:m",
	year: "qdr:y",
} satisfies Record<NonNullable<SearchOptions["recencyFilter"]>, string>;

interface WebSearchConfig extends JsonInputObject {
	serpbaseApiKey?: JsonInputValue;
}

interface SerpBaseOrganicResult {
	title?: JsonInputValue;
	link?: JsonInputValue;
	url?: JsonInputValue;
	snippet?: JsonInputValue;
	description?: JsonInputValue;
}

interface SerpBaseResponse {
	organic_results?: SerpBaseOrganicResult[];
	organic?: SerpBaseOrganicResult[];
	results?: SerpBaseOrganicResult[];
	status?: JsonInputValue;
	error?: JsonInputValue;
	message?: JsonInputValue;
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

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "SerpBase",
		configuredValue: loadConfig().serpbaseApiKey,
		environmentValue: process.env.SERPBASE_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"SerpBase API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "serpbaseApiKey": "your-key" }\n` +
			"  2. Set SERPBASE_API_KEY environment variable\n" +
			"Get a key at https://serpbase.dev",
		);
	}
	return apiKey;
}

function normalizeCount(value: number | undefined): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return 10;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

interface DomainFilters {
	include: string[];
	exclude: string[];
}

function parseDomainFilter(domainFilter: string[] | undefined): DomainFilters {
	const filters: DomainFilters = { include: [], exclude: [] };
	if (!domainFilter?.length) return filters;
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? filters.exclude : filters.include;
		if (!target.includes(domain)) target.push(domain);
	}
	return filters;
}

function passesDomainFilters(url: string, filters: DomainFilters): boolean {
	if (filters.include.length === 0 && filters.exclude.length === 0) return true;
	let hostname: string;
	try {
		hostname = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (filters.exclude.some((domain) => domainMatches(hostname, domain))) return false;
	if (filters.include.length === 0) return true;
	return filters.include.some((domain) => domainMatches(hostname, domain));
}

function buildQuery(query: string, filters: DomainFilters): string {
	const parts = [query];
	if (filters.include.length === 1) parts.push(`site:${filters.include[0]}`);
	if (filters.include.length > 1) parts.push(`(${filters.include.map(domain => `site:${domain}`).join(" OR ")})`);
	for (const domain of filters.exclude) parts.push(`-site:${domain}`);
	return parts.join(" ");
}

function errorMessage(err: JsonInputValue): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`SerpBase API returned invalid response: ${message}`);
}

function parseResponse(value: JsonInputValue): SerpBaseResponse {
	if (!isJsonInputObject(value)) throw invalidResponse("expected an object envelope");
	if (isRuntimeString(value.error) && value.error.trim()) {
		const suffix = isRuntimeNumber(value.status) || isRuntimeString(value.status) ? ` (status ${value.status})` : "";
		throw invalidResponse(`${value.error}${suffix}`);
	}
	const organic = value.organic_results ?? value.organic ?? value.results;
	if (!Array.isArray(organic)) throw invalidResponse("expected organic_results array");
	const organicResults: SerpBaseOrganicResult[] = organic.flatMap(item => isJsonInputObject(item) ? [{
		title: item.title,
		link: item.link,
		url: item.url,
		snippet: item.snippet,
		description: item.description,
	}] : []);
	return { organic_results: organicResults };
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results.map((result) => result.snippet
		? `${result.snippet}\nSource: ${result.title} (${result.url})`
		: `Source: ${result.title} (${result.url})`).join("\n\n");
}

export function isSerpBaseAvailable(): boolean {
	return hasCredentialSource({ provider: "SerpBase", configuredValue: loadConfig().serpbaseApiKey, environmentValue: process.env.SERPBASE_API_KEY });
}

export async function searchWithSerpBase(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const filters = parseDomainFilter(options.domainFilter);
	const url = new URL(SERPBASE_API_URL);
	url.searchParams.set("q", buildQuery(query, filters));
	// SerpBase's Google Search endpoint authenticates with an `api_key` query parameter.
	url.searchParams.set("api_key", apiKey);
	url.searchParams.set("num", String(numResults));
	if (options.recencyFilter && RECENCY_TBS[options.recencyFilter]) url.searchParams.set("tbs", RECENCY_TBS[options.recencyFilter]);
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: options.signal ? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});
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
	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = redactCredential(await response.text(), apiKey);
		throw new Error(`SerpBase API error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	let rawData: JsonInputValue;
	try {
		rawData = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`SerpBase API returned invalid JSON: ${errorMessage(err)}`);
	}
	const data = parseResponse(rawData);
	activityMonitor.logComplete(activityId, response.status);
	const results: SearchResponse["results"] = [];
	for (const item of data.organic_results ?? []) {
		const url = isRuntimeString(item.link) ? item.link : isRuntimeString(item.url) ? item.url : "";
		if (!url || !passesDomainFilters(url, filters)) continue;
		results.push({
			title: isRuntimeString(item.title) && item.title.trim() ? item.title : `Source ${results.length + 1}`,
			url,
			snippet: isRuntimeString(item.snippet) ? item.snippet : isRuntimeString(item.description) ? item.description : "",
		});
		if (results.length >= numResults) break;
	}
	return { answer: buildAnswer(results), results };
}
