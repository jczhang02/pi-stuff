import type { JsonInputValue } from "../../shared/json-value.js";
import type { JsonInputObject } from "../../shared/json-value.js";
import { isJsonInputObject, parseJsonObject } from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { readWebConfigText, webConfigExists } from "../settings.ts";

import { activityMonitor } from "./activity.ts";
import type { ExtractedContent } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const TAVILY_API_URL = "https://api.tavily.com/search";
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const SEARCH_TIMEOUT_MS = 60_000;

interface WebSearchConfig {
	tavilyApiKey?: JsonInputValue;
}

interface TavilySearchOptions extends SearchOptions {
	includeContent?: boolean;
}

let cachedConfig: WebSearchConfig | null = null;

function loadConfig(): WebSearchConfig {
	if (!webConfigExists()) {
		cachedConfig = {};
		return cachedConfig;
	}

	const raw = readWebConfigText();
	try {
		cachedConfig = parseJsonObject(raw);
		return cachedConfig;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "Tavily",
		configuredValue: loadConfig().tavilyApiKey,
		environmentValue: process.env.TAVILY_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"Tavily API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "tavilyApiKey": "your-key" }\n` +
			"  2. Set TAVILY_API_KEY environment variable\n" +
			"Get a key at https://app.tavily.com/",
		);
	}
	return apiKey;
}

function normalizeCount(value: number | undefined): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function normalizeDomain(value: string): string | null {
	let input = value.trim().toLowerCase();
	if (!input) return null;
	if (input.startsWith("-")) input = input.slice(1).trim();
	if (!input) return null;
	try {
		const parsed = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
		input = parsed.hostname;
	} catch {
		input = input.split("/")[0]?.split(":")[0] ?? "";
	}
	input = input.replace(/^\.+|\.+$/g, "");
	return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}

interface TavilyDomainFilter {
	include_domains?: string[];
	exclude_domains?: string[];
}

function mapDomainFilter(domainFilter: string[] | undefined): TavilyDomainFilter {
	if (!domainFilter?.length) return {};
	const include_domains: string[] = [];
	const exclude_domains: string[] = [];
	for (const raw of domainFilter) {
		const domain = normalizeDomain(raw);
		if (!domain) continue;
		const target = raw.trim().startsWith("-") ? exclude_domains : include_domains;
		if (!target.includes(domain)) target.push(domain);
	}
	const filter: TavilyDomainFilter = {};
	if (include_domains.length > 0) filter.include_domains = include_domains;
	if (exclude_domains.length > 0) filter.exclude_domains = exclude_domains;
	return filter;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorMessage(err: JsonInputValue): string {
	return err instanceof Error ? err.message : String(err);
}

function mapResults(results: JsonInputValue, numResults: number): SearchResponse["results"] {
	if (!Array.isArray(results)) return [];
	const mapped: SearchResponse["results"] = [];
	for (const item of results) {
		if (!isJsonInputObject(item) || !isRuntimeString(item.url)) continue;
		mapped.push({
			title: isRuntimeString(item.title) ? item.title : `Source ${mapped.length + 1}`,
			url: item.url,
			snippet: isRuntimeString(item.content) ? item.content.replace(/\s+/g, " ").trim() : "",
		});
		if (mapped.length >= numResults) break;
	}
	return mapped;
}

function mapInlineContent(results: JsonInputValue): ExtractedContent[] {
	if (!Array.isArray(results)) return [];
	return results.flatMap((item) => {
		if (!isJsonInputObject(item) || !isRuntimeString(item.url) || !isRuntimeString(item.raw_content) || item.raw_content.trim().length === 0) return [];
		return [{
			url: item.url,
			title: isRuntimeString(item.title) ? item.title : "",
			content: item.raw_content,
			error: null,
		}];
	});
}

export function isTavilyAvailable(): boolean {
	return hasCredentialSource({
		provider: "Tavily",
		configuredValue: loadConfig().tavilyApiKey,
		environmentValue: process.env.TAVILY_API_KEY,
	});
}

export async function searchWithTavily(query: string, options: TavilySearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const body: JsonInputObject = {
		query,
		search_depth: "basic",
		max_results: numResults,
		include_answer: "basic",
		include_raw_content: options.includeContent ? "markdown" : false,
	};
	if (options.recencyFilter) body.time_range = options.recencyFilter;
	Object.assign(body, mapDomainFilter(options.domainFilter));

	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;
	try {
		response = await fetch(TAVILY_API_URL, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: requestSignal(options.signal),
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
		throw new Error(`Tavily API error ${response.status}: ${errorText.slice(0, 300)}`);
	}

	let data;
	try {
		const responseBody = await response.json();
		if (!isJsonInputObject(responseBody)) throw new TypeError("expected an object");
		data = responseBody;
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Tavily API returned invalid JSON: ${errorMessage(err)}`);
	}

	activityMonitor.logComplete(activityId, response.status);
	const result: SearchResponse = {
		answer: isRuntimeString(data.answer) ? data.answer : "",
		results: mapResults(data.results, numResults),
	};
	if (options.includeContent) {
		const inlineContent = mapInlineContent(data.results);
		if (inlineContent.length > 0) result.inlineContent = inlineContent;
	}
	return result;
}
