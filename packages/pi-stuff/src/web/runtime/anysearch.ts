import type { JsonInputValue } from "../../shared/json-value.js";
import type { JsonInputObject } from "../../shared/json-value.js";
import { isJsonInputObject } from "../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../shared/runtime-type.js";
import { readWebConfigText, webConfigExists } from "../settings.ts";

import { activityMonitor } from "./activity.ts";
import type { ExtractedContent } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const ANYSEARCH_API_URL = "https://api.anysearch.com/v1/search";
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const SEARCH_TIMEOUT_MS = 30_000;

interface WebSearchConfig extends JsonInputObject {
	anysearchApiKey?: JsonInputValue;
}

interface AnySearchResult {
	title: string;
	url: string;
	snippet: string;
	content: string;
}

interface AnySearchSearchOptions extends SearchOptions {
	includeContent?: boolean;
}

interface AnySearchResponse {
	code: 0;
	data: {
		results: AnySearchResult[];
		metadata: JsonInputObject;
	};
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
		provider: "AnySearch",
		configuredValue: loadConfig().anysearchApiKey,
		environmentValue: process.env.ANYSEARCH_API_KEY,
		signal,
	});
}

function normalizeCount(value: number | undefined): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}

function errorMessage(err: JsonInputValue): string {
	return err instanceof Error ? err.message : String(err);
}

function invalidResponse(message: string): Error {
	return new Error(`AnySearch API returned invalid response: ${message}`);
}

function parseResponse(value: JsonInputValue): AnySearchResponse {
	if (!isJsonInputObject(value)) {
		throw invalidResponse("expected an object envelope");
	}
	if (value.code !== 0) throw invalidResponse("expected code 0");
	if (!isJsonInputObject(value.data)) {
		throw invalidResponse("expected data object");
	}
	const data = value.data;
	if (!Array.isArray(data.results)) throw invalidResponse("expected data.results array");
	if (!isJsonInputObject(data.metadata)) {
		throw invalidResponse("expected data.metadata object");
	}

	const results: AnySearchResult[] = [];
	for (const [index, value] of data.results.entries()) {
		if (!isJsonInputObject(value)) {
			throw invalidResponse(`expected data.results[${index}] object`);
		}
		const { title, url, snippet, content } = value;
		if (!isRuntimeString(title)) throw invalidResponse(`expected data.results[${index}].title string`);
		if (!isRuntimeString(url)) throw invalidResponse(`expected data.results[${index}].url string`);
		if (!isRuntimeString(snippet)) throw invalidResponse(`expected data.results[${index}].snippet string`);
		if (!isRuntimeString(content)) throw invalidResponse(`expected data.results[${index}].content string`);
		if (!url) throw invalidResponse(`expected data.results[${index}].url to be non-empty`);
		results.push({ title, url, snippet, content });
	}

	return { code: 0, data: { results, metadata: data.metadata } };
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results
		.map((result) => result.snippet
			? `${result.snippet}\nSource: ${result.title} (${result.url})`
			: `Source: ${result.title} (${result.url})`)
		.join("\n\n");
}

export function isAnySearchAvailable(): boolean {
	return true;
}

export async function searchWithAnySearch(query: string, options: AnySearchSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await getApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const body = { query, max_results: numResults };
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;

	try {
		const headers = new Headers({ "Content-Type": "application/json" });
		if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
		response = await fetch(ANYSEARCH_API_URL, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: options.signal
				? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
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
		throw new Error(`AnySearch API error ${response.status}: ${errorText.slice(0, 300)}`);
	}

	let rawData: JsonInputValue;
	try {
		rawData = await response.json();
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`AnySearch API returned invalid JSON: ${errorMessage(err)}`);
	}

	let data: AnySearchResponse;
	try {
		data = parseResponse(rawData);
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw err;
	}

	activityMonitor.logComplete(activityId, response.status);
	const results = data.data.results.slice(0, numResults).map((result) => ({
		title: result.title,
		url: result.url,
		snippet: result.snippet,
	}));
	const mapped: SearchResponse = { answer: buildAnswer(results), results };
	if (options.includeContent) {
		const inlineContent: ExtractedContent[] = data.data.results.slice(0, numResults)
			.filter(result => result.content.length > 0)
			.map(result => ({ url: result.url, title: result.title, content: result.content, error: null }));
		if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
	}
	return mapped;
}
