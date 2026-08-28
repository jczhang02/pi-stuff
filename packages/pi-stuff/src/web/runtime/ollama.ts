import type { JsonInputValue } from "../../shared/json-value.js";
import { isJsonInputObject, requireJsonInputValue } from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { activityMonitor, throwRedactedActivityError } from "./activity.ts";
import { readWebConfig } from "./config.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import {
	fetchRemoteUrl,
	loadFetchContentDomainPolicy,
	loadSsrfConfig,
	type SsrfConfig,
	validateRemoteUrl,
} from "./ssrf-protection.ts";
import { errorMessage, getWebSearchConfigPath, normalizeCount } from "./utils.ts";

const OLLAMA_SEARCH_URL = "https://ollama.com/api/web_search";
const OLLAMA_FETCH_URL = "https://ollama.com/api/web_fetch";
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const SEARCH_TIMEOUT_MS = 60_000;

interface OllamaSearchResult {
	title: string;
	url: string;
	content: string;
}

interface OllamaSearchResponse {
	results: OllamaSearchResult[];
}

interface OllamaFetchResponse {
	title: string;
	content: string;
	links?: JsonInputValue;
}

interface OllamaSearchOptions extends SearchOptions {
	includeContent?: boolean;
}

export interface OllamaExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
	ssrf?: SsrfConfig;
}

function loadConfig() {
	return readWebConfig() ?? {};
}

async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "Ollama",
		configuredValue: loadConfig()["ollamaApiKey"],
		environmentValue: process.env["OLLAMA_API_KEY"],
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"Ollama API key not found. Either:\n" +
				`  1. Create ${CONFIG_PATH} with { "ollamaApiKey": "your-key" }\n` +
				"  2. Set OLLAMA_API_KEY environment variable\n" +
				"Create a key at https://ollama.com/settings/keys",
		);
	}
	return apiKey;
}

function invalidResponse(message: string): Error {
	return new Error(`Ollama API returned invalid response: ${message}`);
}

function parseSearchResponse(value: JsonInputValue): OllamaSearchResponse {
	if (!isJsonInputObject(value)) throw invalidResponse("expected an object envelope");
	if (!Array.isArray(value["results"])) throw invalidResponse("expected results array");
	const results: OllamaSearchResult[] = [];
	for (const [index, item] of value["results"].entries()) {
		if (!isJsonInputObject(item)) throw invalidResponse(`expected results[${index}] object`);
		if (!isRuntimeString(item.title)) throw invalidResponse(`expected results[${index}].title string`);
		if (!isRuntimeString(item.url) || !item.url)
			throw invalidResponse(`expected results[${index}].url non-empty string`);
		if (!isRuntimeString(item.content)) throw invalidResponse(`expected results[${index}].content string`);
		results.push({ title: item.title, url: item.url, content: item.content });
	}
	return { results };
}

function parseFetchResponse(value: JsonInputValue): OllamaFetchResponse {
	if (!isJsonInputObject(value)) throw invalidResponse("expected fetch object envelope");
	if (!isRuntimeString(value["title"])) throw invalidResponse("expected title string");
	if (!isRuntimeString(value["content"])) throw invalidResponse("expected content string");
	return { title: value["title"], content: value["content"], links: value["links"] };
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

export function isOllamaAvailable(): boolean {
	return hasCredentialSource({
		provider: "Ollama",
		configuredValue: loadConfig()["ollamaApiKey"],
		environmentValue: process.env["OLLAMA_API_KEY"],
	});
}

export async function searchWithOllama(query: string, options: OllamaSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults, 5, 10);
	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;
	try {
		response = await fetch(OLLAMA_SEARCH_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify({ query, max_results: numResults }),
			signal: options.signal
				? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});
	} catch (error) {
		throwRedactedActivityError(activityId, error, apiKey);
	}

	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = redactCredential(await response.text(), apiKey);
		throw new Error(`Ollama API error ${response.status}: ${errorText.slice(0, 300)}`);
	}

	let rawData: JsonInputValue;
	try {
		rawData = requireJsonInputValue(await response.json(), "Ollama search response");
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Ollama API returned invalid JSON: ${errorMessage(err)}`);
	}

	const data = parseSearchResponse(rawData);
	activityMonitor.logComplete(activityId, response.status);
	const results = data.results
		.slice(0, numResults)
		.map((result) => ({ title: result.title, url: result.url, snippet: result.content }));
	const mapped: SearchResponse = { answer: buildAnswer(results), results };
	if (options.includeContent) {
		const inlineContent: ExtractedContent[] = data.results
			.slice(0, numResults)
			.filter((result) => result.content.trim().length > 0)
			.map((result) => ({ url: result.url, title: result.title, content: result.content, error: null }));
		if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
	}
	return mapped;
}

export function isOllamaFetchAvailable(): boolean {
	return isOllamaAvailable();
}

export async function extractWithOllama(
	url: string,
	signal?: AbortSignal,
	options: OllamaExtractOptions = {},
): Promise<ExtractedContent | null> {
	const ssrf = options.ssrf ?? loadSsrfConfig();
	const domainPolicy = loadFetchContentDomainPolicy();
	const validationOptions = {
		allowRanges: ssrf.allowRanges,
		trustEnvProxy: ssrf.trustEnvProxy,
		domainPolicy,
	};
	if (options.lookup) Object.assign(validationOptions, { lookup: options.lookup });
	await validateRemoteUrl(url, validationOptions);
	const apiKey = await requireApiKey(signal);
	const activityId = activityMonitor.logStart({ type: "api", query: `ollama fetch: ${url}` });
	let response: Response;
	try {
		const remoteOptions = {
			allowRanges: ssrf.allowRanges,
			trustEnvProxy: ssrf.trustEnvProxy,
			onRedirect: ({ from, to, init }: { from: URL; to: URL; init: RequestInit }) =>
				to.origin === from.origin ? init : { ...init, headers: { "Content-Type": "application/json" } },
		};
		if (options.lookup) Object.assign(remoteOptions, { lookup: options.lookup });
		response = await fetchRemoteUrl(
			OLLAMA_FETCH_URL,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
				body: JSON.stringify({ url }),
				signal: signal
					? AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? SEARCH_TIMEOUT_MS), signal])
					: AbortSignal.timeout(options.timeoutMs ?? SEARCH_TIMEOUT_MS),
			},
			remoteOptions,
		);
	} catch (error) {
		throwRedactedActivityError(activityId, error, apiKey);
	}

	if (!response.ok) {
		activityMonitor.logComplete(activityId, response.status);
		const errorText = redactCredential(await response.text(), apiKey);
		throw new Error(`Ollama Web Fetch error ${response.status}: ${errorText.slice(0, 300)}`);
	}
	let rawData: JsonInputValue;
	try {
		rawData = requireJsonInputValue(await response.json(), "Ollama fetch response");
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`Ollama Web Fetch returned invalid JSON: ${errorMessage(err)}`);
	}
	const data = parseFetchResponse(rawData);
	activityMonitor.logComplete(activityId, response.status);
	const content = data.content.trim();
	if (!content) return null;
	return { url, title: data.title, content, error: null };
}
