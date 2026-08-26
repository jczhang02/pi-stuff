import type { JsonInputObject, JsonInputValue } from "../../shared/json-value.js";
import { isJsonInputObject, requireJsonInputValue } from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { readWebConfig } from "../settings.ts";

import { activityMonitor } from "./activity.ts";
import { redactCredential, resolveCredential } from "./credential-source.ts";
import type { ExtractedContent } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { errorMessage, normalizeCount } from "./utils.ts";

const ANYSEARCH_API_URL = "https://api.anysearch.com/v1/search";
const SEARCH_TIMEOUT_MS = 30_000;

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

function loadConfig() {
	return readWebConfig() ?? {};
}

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "AnySearch",
		configuredValue: loadConfig()["anysearchApiKey"],
		environmentValue: process.env["ANYSEARCH_API_KEY"],
		signal,
	});
}

function invalidResponse(message: string): Error {
	return new Error(`AnySearch API returned invalid response: ${message}`);
}

function parseResponse(value: JsonInputValue): AnySearchResponse {
	if (!isJsonInputObject(value)) {
		throw invalidResponse("expected an object envelope");
	}
	if (value["code"] !== 0) throw invalidResponse("expected code 0");
	if (!isJsonInputObject(value["data"])) {
		throw invalidResponse("expected data object");
	}
	const data = value["data"];
	if (!Array.isArray(data["results"])) throw invalidResponse("expected data.results array");
	if (!isJsonInputObject(data["metadata"])) {
		throw invalidResponse("expected data.metadata object");
	}

	const results: AnySearchResult[] = [];
	for (const [index, value] of data["results"].entries()) {
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

	return { code: 0, data: { results, metadata: data["metadata"] } };
}

function buildAnswer(results: SearchResponse["results"]): string {
	return results
		.map((result) =>
			result.snippet
				? `${result.snippet}\nSource: ${result.title} (${result.url})`
				: `Source: ${result.title} (${result.url})`,
		)
		.join("\n\n");
}

export function isAnySearchAvailable(): boolean {
	return true;
}

export async function searchWithAnySearch(
	query: string,
	options: AnySearchSearchOptions = {},
): Promise<SearchResponse> {
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
		rawData = requireJsonInputValue(await response.json(), "AnySearch response");
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
		const inlineContent: ExtractedContent[] = data.data.results
			.slice(0, numResults)
			.filter((result) => result.content.length > 0)
			.map((result) => ({ url: result.url, title: result.title, content: result.content, error: null }));
		if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
	}
	return mapped;
}
