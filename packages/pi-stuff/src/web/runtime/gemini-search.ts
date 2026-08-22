import { isJsonInputObject, parseJsonObject, type JsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { readWebConfigText, webConfigExists } from "../settings.ts";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activityMonitor } from "./activity.ts";
import { CredentialResolutionError } from "./credential-source.ts";
import { getApiKey, getVersionedApiBase, fetchGeminiApi, isGatewayConfigured, isGeminiApiAvailable, redactGeminiApiResponse } from "./gemini-api.ts";
import { getGeminiWebAvailabilityDiagnostic, isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import { isPerplexityAvailable, searchWithPerplexity, type SearchResult, type SearchResponse, type SearchOptions } from "./perplexity.ts";
import { isExaAvailable, searchWithExa } from "./exa.ts";
import { isBraveAvailable, searchWithBrave } from "./brave.ts";
import { isOpenAISearchAvailable, searchWithOpenAI } from "./openai-search.ts";
import { isParallelAvailable, searchWithParallel } from "./parallel.ts";
import { isTinyFishAvailable, searchWithTinyFish } from "./tinyfish.ts";
import { isSearch1APIAvailable, searchWithSearch1API } from "./search1api.ts";
import { isSearchinfinityAvailable, searchWithSearchinfinity } from "./searchinfinity.ts";
import { isQueritAvailable, searchWithQuerit } from "./querit.ts";
import { isTavilyAvailable, searchWithTavily } from "./tavily.ts";
import { isSerpdiveAvailable, searchWithSerpdive } from "./serpdive.ts";
import { isKagiAvailable, searchWithKagi } from "./kagi.ts";
import { isOllamaAvailable, searchWithOllama } from "./ollama.ts";
import { isSearXNGAvailable, searchWithSearXNG } from "./searxng.ts";
import { isAnySearchAvailable, searchWithAnySearch } from "./anysearch.ts";
import { isXaiSearchAvailable, searchWithXai } from "./xai-search.ts";
import { isBrightDataAvailable, searchWithBrightData } from "./brightdata.ts";
import { isSerpBaseAvailable, searchWithSerpBase } from "./serpbase.ts";
import { getWebSearchConfigPath } from "./utils.ts";

export const RESOLVED_SEARCH_PROVIDERS = ["openai", "brave", "parallel", "tinyfish", "search1api", "searchinfinity", "querit", "tavily", "searxng", "perplexity", "gemini", "exa", "serpdive", "kagi", "ollama", "anysearch", "xai", "brightdata", "serpbase"] as const;
export const SEARCH_PROVIDERS = ["auto", "all", ...RESOLVED_SEARCH_PROVIDERS] as const;

export type ResolvedSearchProvider = typeof RESOLVED_SEARCH_PROVIDERS[number];
export type SearchProvider = typeof SEARCH_PROVIDERS[number];
export type SearchProviderSelection = SearchProvider | ResolvedSearchProvider[];
export type SearchProviderErrorKind =
	| "transient"
	| "quota"
	| "network"
	| "credential"
	| "config"
	| "auth"
	| "invalid-request"
	| "invalid-response"
	| "aborted"
	| "unknown";

export interface SearchRoutingConfig {
	providers: ResolvedSearchProvider[];
	fallbackOn: Array<Extract<SearchProviderErrorKind, "transient" | "quota" | "network">>;
}

export class SearchProviderError extends Error {
	readonly provider: ResolvedSearchProvider;
	readonly kind: SearchProviderErrorKind;
	readonly status?: number;
	readonly causeError: JsonInputValue;

	constructor(
		provider: ResolvedSearchProvider,
		kind: SearchProviderErrorKind,
		message: string,
		status: number | undefined,
		cause: JsonInputValue,
	) {
		super(`${provider} search failed (${kind}): ${message}`);
		this.name = "SearchProviderError";
		this.provider = provider;
		this.kind = kind;
		this.status = status;
		this.causeError = cause;
	}
}

export interface ProviderSearchResponse extends SearchResponse {
	provider: ResolvedSearchProvider;
}

export interface ProviderSearchFailure {
	provider: ResolvedSearchProvider;
	error: string;
}

export interface AttributedSearchResponse extends SearchResponse {
	provider: ResolvedSearchProvider | "all";
	providerResponses?: ProviderSearchResponse[];
	providerErrors?: ProviderSearchFailure[];
}

const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const DEFAULT_SEARCH_MODEL = "gemini-3.6-flash";
// Explicit-only providers (AnySearch, xAI, Bright Data, SerpBase) are deliberately absent:
// `all` must never fan out to a paid/surprising provider without the user asking for it.
const ALL_SEARCH_PROVIDERS: ResolvedSearchProvider[] = ["searxng", "openai", "exa", "brave", "parallel", "tinyfish", "search1api", "searchinfinity", "querit", "tavily", "serpdive", "kagi", "ollama", "perplexity", "gemini"];
const VALID_ROUTING_KINDS = ["transient", "quota", "network"] as const;

type SearchConfig = {
	searchProvider: SearchProviderSelection;
	searchProviderConfigured: boolean;
	searchRouting?: SearchRoutingConfig;
	searchModel?: string;
};

let cachedSearchConfig: SearchConfig | null = null;

function getSearchConfig(): SearchConfig {
	if (!webConfigExists()) {
		cachedSearchConfig = { searchProvider: "auto", searchProviderConfigured: false };
		return cachedSearchConfig;
	}

	const rawText = readWebConfigText();
	let raw: JsonInputObject;
	try {
		raw = parseJsonObject(rawText);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}

	const searchModel = normalizeSearchModel(raw.searchModel);
	const searchProviderConfigured = Object.hasOwn(raw, "searchProvider") || Object.hasOwn(raw, "provider");
	const config: SearchConfig = {
		searchProvider: normalizeSearchProviderSelection(raw.searchProvider ?? raw.provider, `provider in ${CONFIG_PATH}`),
		searchProviderConfigured,
	};
	if (Object.hasOwn(raw, "searchRouting")) config.searchRouting = normalizeSearchRouting(raw.searchRouting);
	if (searchModel) config.searchModel = searchModel;
	cachedSearchConfig = config;
	return cachedSearchConfig;
}

function normalizeSearchRouting(value: JsonInputValue): SearchRoutingConfig {
	if (!isJsonInputObject(value)) {
		throw new Error(`searchRouting in ${CONFIG_PATH} must be an object`);
	}
	const providers = normalizeResolvedProviderList(value.providers, `searchRouting.providers in ${CONFIG_PATH}`);
	if (!Array.isArray(value.fallbackOn) || value.fallbackOn.length === 0) {
		throw new Error(`searchRouting.fallbackOn in ${CONFIG_PATH} must be a non-empty array`);
	}
	const fallbackOn: SearchRoutingConfig["fallbackOn"] = [];
	for (const kind of value.fallbackOn) {
		if (!isRoutingFallbackKind(kind)) {
			throw new Error(`searchRouting.fallbackOn in ${CONFIG_PATH} may only contain transient, quota, or network`);
		}
		if (!fallbackOn.includes(kind)) {
			fallbackOn.push(kind);
		}
	}
	return { providers, fallbackOn };
}

export function getConfiguredSearchRouting(): SearchRoutingConfig | undefined {
	const config = getSearchConfig();
	return config.searchProviderConfigured ? undefined : config.searchRouting;
}

function normalizeSearchModel(value: JsonInputValue): string | undefined {
	if (!isRuntimeString(value)) return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function isRoutingFallbackKind(value: JsonInputValue): value is SearchRoutingConfig["fallbackOn"][number] {
	return isRuntimeString(value) && VALID_ROUTING_KINDS.some((kind) => kind === value);
}

function isResolvedSearchProvider(value: string): value is ResolvedSearchProvider {
	return RESOLVED_SEARCH_PROVIDERS.some((provider) => provider === value);
}

function isSearchProvider(value: string): value is SearchProvider {
	return SEARCH_PROVIDERS.some((provider) => provider === value);
}

function normalizeResolvedProviderList(value: JsonInputValue, label: string): ResolvedSearchProvider[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} must be a non-empty array`);
	}
	const providers: ResolvedSearchProvider[] = [];
	for (const provider of value) {
		const normalized = isRuntimeString(provider) ? provider.trim().toLowerCase() : "";
		if (!isResolvedSearchProvider(normalized)) {
			throw new Error(`${label} contains an invalid provider: ${String(provider)}`);
		}
		if (providers.includes(normalized)) {
			throw new Error(`${label} must not contain duplicates: ${normalized}`);
		}
		providers.push(normalized);
	}
	return providers;
}

export function normalizeSearchProviderSelection(value: JsonInputValue, label = "provider"): SearchProviderSelection {
	if (Array.isArray(value)) return normalizeResolvedProviderList(value, label);
	const normalized = isRuntimeString(value) ? value.trim().toLowerCase() : "";
	return isSearchProvider(normalized) ? normalized : "auto";
}

export interface FullSearchOptions extends SearchOptions {
	provider?: SearchProviderSelection;
	includeContent?: boolean;
	extensionContext?: ExtensionContext;
}

function errorMessage(err: JsonInputValue): string {
	return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: JsonInputValue): boolean {
	return errorMessage(err).toLowerCase().includes("abort");
}

function shouldTryOpenAIInAuto(options: SearchOptions): boolean {
	if (options.recencyFilter) return false;
	if (isRuntimeNumber(options.numResults) && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) {
		return false;
	}
	return true;
}

async function searchWithGemini(
	query: string,
	options: SearchOptions,
	strictErrors: boolean,
): Promise<SearchResponse | null> {
	const errors: string[] = [];

	try {
		const apiResult = await searchWithGeminiApi(query, options);
		if (apiResult) return apiResult;
	} catch (err) {
		if (err instanceof CredentialResolutionError || isAbortError(err)) throw err;
		errors.push(`Gemini API: ${errorMessage(err)}`);
	}

	try {
		const webResult = await searchWithGeminiWeb(query, options);
		if (webResult) return webResult;
		const diagnostic = getGeminiWebAvailabilityDiagnostic();
		if (diagnostic) errors.push(`Gemini Web: ${diagnostic}`);
	} catch (err) {
		if (isAbortError(err)) throw err;
		errors.push(`Gemini Web: ${errorMessage(err)}`);
	}

	if (strictErrors && errors.length > 0) {
		throw new Error(`Gemini search failed:\n  - ${errors.join("\n  - ")}`);
	}

	return null;
}

function providerErrorStatus(message: string): number | undefined {
	const match = message.match(/\b(?:error|status|http)\s+(\d{3})\b/i);
	if (!match) return undefined;
	return Number(match[1]);
}

function classifyProviderError(provider: ResolvedSearchProvider, err: JsonInputValue): SearchProviderError {
	if (err instanceof SearchProviderError) return err;
	const message = errorMessage(err);
	const lower = message.toLowerCase();
	const status = providerErrorStatus(message);
	let kind: SearchProviderErrorKind = "unknown";
	if (err instanceof CredentialResolutionError || /(?:api )?key (?:not found|missing)|credential resolution/.test(lower)) {
		kind = "credential";
	} else if (isAbortError(err)) {
		kind = "aborted";
	} else if (status === 401 || status === 403) {
		kind = "auth";
	} else if (status === 400 || status === 422) {
		kind = "invalid-request";
	} else if (status === 402 || status === 429) {
		kind = "quota";
	} else if (status !== undefined && (status === 408 || status === 425 || status >= 500)) {
		kind = "transient";
	} else if (/rate limit|quota|too many requests/.test(lower)) {
		kind = "quota";
	} else if (/unauthorized|forbidden|permission denied/.test(lower)) {
		kind = "auth";
	} else if (/bad request|invalid request/.test(lower)) {
		kind = "invalid-request";
	} else if (/invalid json|no parseable response|returned invalid response|returned empty response/.test(lower)) {
		kind = "invalid-response";
	} else if (/temporar|service unavailable|server error/.test(lower)) {
		kind = "transient";
	} else if (err instanceof TypeError || /fetch failed|network|econnreset|econnrefused|enotfound|etimedout|timed out|socket/.test(lower)) {
		kind = "network";
	} else if (/invalid or missing|invalid config|failed to parse|must be an? |configuration/.test(lower)) {
		kind = "config";
	}
	return new SearchProviderError(provider, kind, message, status, err);
}

async function searchWithResolvedProvider(
	provider: ResolvedSearchProvider,
	query: string,
	options: FullSearchOptions,
): Promise<ProviderSearchResponse> {
	if (provider === "openai") {
		const result = await searchWithOpenAI(query, options, options.extensionContext);
		return { ...result, provider };
	}
	if (provider === "brave") return { ...(await searchWithBrave(query, options)), provider };
	if (provider === "parallel") return { ...(await searchWithParallel(query, options)), provider };
	if (provider === "tinyfish") return { ...(await searchWithTinyFish(query, options)), provider };
	if (provider === "search1api") return { ...(await searchWithSearch1API(query, options)), provider };
	if (provider === "searchinfinity") return { ...(await searchWithSearchinfinity(query, options)), provider };
	if (provider === "querit") return { ...(await searchWithQuerit(query, options)), provider };
	if (provider === "tavily") return { ...(await searchWithTavily(query, options)), provider };
	if (provider === "serpdive") return { ...(await searchWithSerpdive(query, options)), provider };
	if (provider === "kagi") return { ...(await searchWithKagi(query, options)), provider };
	if (provider === "ollama") return { ...(await searchWithOllama(query, options)), provider };
	if (provider === "anysearch") return { ...(await searchWithAnySearch(query, options)), provider };
	if (provider === "xai") return { ...(await searchWithXai(query, options, options.extensionContext)), provider };
	if (provider === "brightdata") return { ...(await searchWithBrightData(query, options)), provider };
	if (provider === "serpbase") return { ...(await searchWithSerpBase(query, options)), provider };
	if (provider === "perplexity") return { ...(await searchWithPerplexity(query, options)), provider };
	if (provider === "searxng") return { ...(await searchWithSearXNG(query, options)), provider };
	if (provider === "gemini") {
		const result = await searchWithGemini(query, options, true);
		if (result) return { ...result, provider };
		throw new Error(
			"Gemini search unavailable. Either:\n" +
			`  1. Configure geminiApiKey in ${CONFIG_PATH} or set GEMINI_API_KEY\n` +
			"  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for Cloudflare AI Gateway routing\n" +
			"  3. Sign into gemini.google.com in a supported Chromium-based browser",
		);
	}
	const result = await searchWithExa(query, options);
	if (result) return { ...result, provider };
	throw new Error("Exa search returned no results.");
}

async function isResolvedProviderAvailable(provider: ResolvedSearchProvider, options: FullSearchOptions): Promise<boolean> {
	if (provider === "openai") return isOpenAISearchAvailable(options.extensionContext);
	if (provider === "brave") return isBraveAvailable();
	if (provider === "parallel") return isParallelAvailable();
	if (provider === "tinyfish") return isTinyFishAvailable();
	if (provider === "search1api") return isSearch1APIAvailable();
	if (provider === "searchinfinity") return isSearchinfinityAvailable();
	if (provider === "querit") return isQueritAvailable();
	if (provider === "tavily") return isTavilyAvailable();
	if (provider === "serpdive") return isSerpdiveAvailable();
	if (provider === "kagi") return isKagiAvailable();
	if (provider === "ollama") return isOllamaAvailable();
	if (provider === "anysearch") return isAnySearchAvailable();
	if (provider === "xai") return isXaiSearchAvailable(options.extensionContext);
	if (provider === "brightdata") return isBrightDataAvailable();
	if (provider === "serpbase") return isSerpBaseAvailable();
	if (provider === "perplexity") return isPerplexityAvailable();
	if (provider === "searxng") return isSearXNGAvailable();
	if (provider === "gemini") return isGeminiApiAvailable() || !!(await isGeminiWebAvailable());
	return isExaAvailable();
}

function providerLabel(provider: ResolvedSearchProvider): string {
	if (provider === "openai") return "OpenAI";
	if (provider === "tinyfish") return "TinyFish";
	if (provider === "search1api") return "Search1API";
	if (provider === "searchinfinity") return "Searchinfinity";
	if (provider === "querit") return "Querit";
	if (provider === "serpdive") return "SERPdive";
	if (provider === "searxng") return "SearXNG";
	if (provider === "kagi") return "Kagi";
	if (provider === "ollama") return "Ollama";
	if (provider === "xai") return "xAI";
	if (provider === "brightdata") return "Bright Data";
	if (provider === "serpbase") return "SerpBase";
	return provider.charAt(0).toUpperCase() + provider.slice(1);
}

async function searchWithAllProvider(
	provider: ResolvedSearchProvider,
	query: string,
	options: FullSearchOptions,
): Promise<ProviderSearchResponse> {
	if (provider !== "gemini") return searchWithResolvedProvider(provider, query, options);
	const result = await searchWithGeminiApi(query, options);
	if (result) return { ...result, provider };
	throw new Error("Gemini API search returned no results.");
}

async function searchWithProviders(
	query: string,
	options: FullSearchOptions,
	selectedProviders?: ResolvedSearchProvider[],
): Promise<AttributedSearchResponse> {
	const providers = selectedProviders ?? (await Promise.all(ALL_SEARCH_PROVIDERS.map(async (provider) => ({
		provider,
		available: provider === "gemini"
			? isGeminiApiAvailable()
			: await isResolvedProviderAvailable(provider, options),
	})))).filter((entry) => entry.available).map((entry) => entry.provider);
	if (providers.length === 0) {
		throw new Error("No configured search provider available for provider \"all\". AnySearch, xAI, Bright Data, and SerpBase are excluded.");
	}

	const settled = await Promise.allSettled(
		providers.map((provider) => selectedProviders
			? searchWithResolvedProvider(provider, query, options)
			: searchWithAllProvider(provider, query, options)),
	);
	if (options.signal?.aborted) throw new Error("Aborted");

	const successes: ProviderSearchResponse[] = [];
	const failures: Array<{ provider: ResolvedSearchProvider; error: string }> = [];
	for (let index = 0; index < settled.length; index++) {
		const outcome = settled[index];
		if (outcome.status === "fulfilled") {
			successes.push(outcome.value);
		} else {
			failures.push({ provider: providers[index], error: errorMessage(outcome.reason) });
		}
	}
	if (successes.length === 0) {
		const label = selectedProviders ? "Selected-provider" : "All-provider";
		throw new Error(`${label} search failed:\n  - ${failures.map(({ provider, error }) => `${providerLabel(provider)}: ${error}`).join("\n  - ")}`);
	}

	const results: SearchResult[] = [];
	const seenResultUrls = new Set<string>();
	const inlineContent: NonNullable<SearchResponse["inlineContent"]> = [];
	const seenInlineUrls = new Set<string>();
	for (const response of successes) {
		for (const result of response.results) {
			if (seenResultUrls.has(result.url)) continue;
			seenResultUrls.add(result.url);
			results.push(result);
		}
		for (const content of response.inlineContent ?? []) {
			if (seenInlineUrls.has(content.url)) continue;
			seenInlineUrls.add(content.url);
			inlineContent.push(content);
		}
	}

	const answerSections = successes.map((response) =>
		`## ${providerLabel(response.provider)}\n\n${response.answer || "(No answer text returned.)"}`
	);
	if (failures.length > 0) {
		answerSections.push(
			`## Provider errors\n\n${failures.map(({ provider, error }) => `- **${providerLabel(provider)}:** ${error}`).join("\n")}`,
		);
	}

	const response: AttributedSearchResponse = {
		provider: "all",
		answer: answerSections.join("\n\n"),
		results,
		providerResponses: successes,
	};
	if (failures.length > 0) response.providerErrors = failures;
	if (inlineContent.length > 0) response.inlineContent = inlineContent;
	return response;
}

async function searchWithConfiguredRouting(
	query: string,
	options: FullSearchOptions,
	routing: SearchRoutingConfig,
): Promise<AttributedSearchResponse> {
	const diagnostics: string[] = [];
	for (const provider of routing.providers) {
		if (!(await isResolvedProviderAvailable(provider, options))) {
			diagnostics.push(`${provider}: unavailable`);
			continue;
		}
		try {
			return await searchWithResolvedProvider(provider, query, options);
		} catch (err) {
			const classified = classifyProviderError(provider, err);
			diagnostics.push(`${provider} [${classified.kind}]: ${errorMessage(err)}`);
			if (!isRoutingFallbackKind(classified.kind) || !routing.fallbackOn.includes(classified.kind)) {
				throw classified;
			}
		}
	}
	throw new Error(`Configured search routing exhausted:\n  - ${diagnostics.join("\n  - ")}`);
}

export async function search(query: string, options: FullSearchOptions = {}): Promise<AttributedSearchResponse> {
	const config = getSearchConfig();
	const provider = options.provider === undefined || options.provider === "auto"
		? config.searchProvider
		: options.provider;
	if (Array.isArray(provider)) {
		return searchWithProviders(query, options, normalizeResolvedProviderList(provider, "provider"));
	}
	if (provider === "all") return searchWithProviders(query, options);
	if (provider !== "auto") return searchWithResolvedProvider(provider, query, options);
	if (!config.searchProviderConfigured && config.searchRouting) {
		return searchWithConfiguredRouting(query, options, config.searchRouting);
	}

	const fallbackErrors: string[] = [];

	if (isSearXNGAvailable()) {
		try {
			const result = await searchWithSearXNG(query, options);
			return { ...result, provider: "searxng" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`SearXNG: ${errorMessage(err)}`);
		}
	}

	if (shouldTryOpenAIInAuto(options)) {
		try {
			if (await isOpenAISearchAvailable(options.extensionContext)) {
				const result = await searchWithOpenAI(query, options, options.extensionContext);
				return { ...result, provider: "openai" };
			}
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`OpenAI: ${errorMessage(err)}`);
		}
	}

	if (isExaAvailable()) {
		try {
			const result = await searchWithExa(query, options);
			if (result) return { ...result, provider: "exa" };
		} catch (err) {
			if (err instanceof CredentialResolutionError || isAbortError(err)) throw err;
			fallbackErrors.push(`Exa: ${errorMessage(err)}`);
		}
	}

	if (isBraveAvailable()) {
		try {
			const result = await searchWithBrave(query, options);
			return { ...result, provider: "brave" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Brave: ${errorMessage(err)}`);
		}
	}

	if (isParallelAvailable()) {
		try {
			const result = await searchWithParallel(query, options);
			return { ...result, provider: "parallel" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Parallel: ${errorMessage(err)}`);
		}
	}

	if (isTinyFishAvailable()) {
		try {
			const result = await searchWithTinyFish(query, options);
			return { ...result, provider: "tinyfish" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`TinyFish: ${errorMessage(err)}`);
		}
	}

	if (isSearch1APIAvailable()) {
		try {
			const result = await searchWithSearch1API(query, options);
			return { ...result, provider: "search1api" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Search1API: ${errorMessage(err)}`);
		}
	}

	if (isSearchinfinityAvailable()) {
		try {
			const result = await searchWithSearchinfinity(query, options);
			return { ...result, provider: "searchinfinity" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Searchinfinity: ${errorMessage(err)}`);
		}
	}

	if (isQueritAvailable()) {
		try {
			const result = await searchWithQuerit(query, options);
			return { ...result, provider: "querit" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Querit: ${errorMessage(err)}`);
		}
	}

	if (isTavilyAvailable()) {
		try {
			const result = await searchWithTavily(query, options);
			return { ...result, provider: "tavily" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Tavily: ${errorMessage(err)}`);
		}
	}

	if (isSerpdiveAvailable()) {
		try {
			const result = await searchWithSerpdive(query, options);
			return { ...result, provider: "serpdive" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`SERPdive: ${errorMessage(err)}`);
		}
	}

	if (isKagiAvailable()) {
		try {
			const result = await searchWithKagi(query, options);
			return { ...result, provider: "kagi" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Kagi: ${errorMessage(err)}`);
		}
	}

	if (isOllamaAvailable()) {
		try {
			const result = await searchWithOllama(query, options);
			return { ...result, provider: "ollama" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Ollama: ${errorMessage(err)}`);
		}
	}

	if (isPerplexityAvailable()) {
		try {
			const result = await searchWithPerplexity(query, options);
			return { ...result, provider: "perplexity" };
		} catch (err) {
			if (isAbortError(err)) throw err;
			fallbackErrors.push(`Perplexity: ${errorMessage(err)}`);
		}
	}

	try {
		const geminiResult = await searchWithGemini(query, options, false);
		if (geminiResult) return { ...geminiResult, provider: "gemini" };
	} catch (err) {
		if (isAbortError(err)) throw err;
		fallbackErrors.push(`Gemini: ${errorMessage(err)}`);
	}

	if (fallbackErrors.length > 0) {
		throw new Error(`Auto provider search failed:\n  - ${fallbackErrors.join("\n  - ")}`);
	}

	throw new Error(
		"No search provider available. Either:\n" +
		"  1. Use /login to sign in with a Codex subscription for OpenAI web search\n" +
		`  2. Set openaiApiKey, braveApiKey, parallelApiKey, tinyfishApiKey, search1apiApiKey, searchinfinityApiKey, queritApiKey, tavilyApiKey, serpdiveApiKey, kagiApiKey, ollamaApiKey, searxngBaseUrl, perplexityApiKey, exaApiKey, geminiApiKey, or cloudflareApiKey in ${CONFIG_PATH}\n` +
		"  3. Set OPENAI_API_KEY, BRAVE_API_KEY, PARALLEL_API_KEY, TINYFISH_API_KEY, SEARCH1API_KEY, SEARCHINFINITY_API_KEY, QUERIT_API_KEY, TAVILY_API_KEY, SERPDIVE_API_KEY, KAGI_API_KEY, OLLAMA_API_KEY, SEARXNG_BASE_URL, EXA_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, or CLOUDFLARE_API_KEY env vars\n" +
		"  4. Set GOOGLE_GEMINI_BASE_URL with CLOUDFLARE_API_KEY for Cloudflare AI Gateway routing\n" +
		"  5. Sign into gemini.google.com in a supported Chromium-based browser\n" +
		"  6. Explicitly select provider: \"anysearch\" for anonymous AnySearch, \"xai\" for Grok, \"brightdata\" with brightdataSerpZone for paid Bright Data SERP, or \"serpbase\" with serpbaseApiKey for paid Google SERP"
	);
}

async function searchWithGeminiApi(query: string, options: SearchOptions = {}): Promise<SearchResponse | null> {
	const requestSignal = AbortSignal.any([
		AbortSignal.timeout(60000),
		...(options.signal ? [options.signal] : []),
	]);
	const apiKey = await getApiKey(requestSignal);
	if (!apiKey && !isGatewayConfigured()) return null;

	const activityId = activityMonitor.logStart({ type: "api", query });

	try {
		const model = getSearchConfig().searchModel ?? DEFAULT_SEARCH_MODEL;
		const body = {
			contents: [{ role: "user", parts: [{ text: query }] }],
			tools: [{ google_search: {} }],
		};

		const res = await fetchGeminiApi(`${getVersionedApiBase()}/models/${model}:generateContent`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: requestSignal,
		}, apiKey);

		if (!res.ok) {
			const errorText = redactGeminiApiResponse(res, await res.text(), apiKey);
			throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
		}

		const data = parseGeminiSearchPayload(parseJsonObject(await res.text()));
		activityMonitor.logComplete(activityId, res.status);

		const answer = data.parts.map((part) => part.text).filter(Boolean).join("\n");
		const results = await resolveGroundingChunks(data.groundingChunks, options.signal);

		if (!answer && results.length === 0) return null;
		return { answer, results };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		throw err;
	}
}

async function searchWithGeminiWeb(query: string, options: SearchOptions = {}): Promise<SearchResponse | null> {
	const cookies = await isGeminiWebAvailable();
	if (!cookies) return null;

	const prompt = buildSearchPrompt(query, options);
	const activityId = activityMonitor.logStart({ type: "api", query });

	try {
		const text = await queryWithCookies(prompt, cookies, {
			signal: options.signal,
			timeoutMs: 60000,
		});

		activityMonitor.logComplete(activityId, 200);

		const results = extractSourceUrls(text);
		return { answer: text, results };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		throw err;
	}
}

function buildSearchPrompt(query: string, options: SearchOptions): string {
	let prompt = `Search the web and answer the following question. Include source URLs for your claims.\nFormat your response as:\n1. A direct answer to the question\n2. Cited sources as markdown links\n\nQuestion: ${query}`;

	if (options.recencyFilter) {
		const labels = {
			day: "past 24 hours",
			week: "past week",
			month: "past month",
			year: "past year",
		};
		prompt += `\n\nOnly include results from the ${labels[options.recencyFilter]}.`;
	}

	if (options.domainFilter?.length) {
		const includes = options.domainFilter.filter(d => !d.startsWith("-"));
		const excludes = options.domainFilter.filter(d => d.startsWith("-")).map(d => d.slice(1));
		if (includes.length) prompt += `\n\nOnly cite sources from: ${includes.join(", ")}`;
		if (excludes.length) prompt += `\n\nDo not cite sources from: ${excludes.join(", ")}`;
	}

	return prompt;
}

function extractSourceUrls(markdown: string): SearchResult[] {
	const results: SearchResult[] = [];
	const seen = new Set<string>();
	const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
	for (const match of markdown.matchAll(linkRegex)) {
		const url = match[2];
		if (seen.has(url)) continue;
		seen.add(url);
		results.push({ title: match[1], url, snippet: "" });
	}
	return results;
}

async function resolveGroundingChunks(
	chunks: GroundingChunk[] | undefined,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	if (!chunks?.length) return [];

	const results: SearchResult[] = [];
	for (const chunk of chunks) {
		if (!chunk.web) continue;
		const title = chunk.web.title || "";
		let url = chunk.web.uri || "";

		if (url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
			const resolved = await resolveRedirect(url, signal);
			if (resolved) url = resolved;
		}

		if (url) results.push({ title, url, snippet: "" });
	}
	return results;
}

async function resolveRedirect(proxyUrl: string, signal?: AbortSignal): Promise<string | null> {
	try {
		const res = await fetch(proxyUrl, {
			method: "HEAD",
			redirect: "manual",
			signal: AbortSignal.any([
				AbortSignal.timeout(5000),
				...(signal ? [signal] : []),
			]),
		});
		return res.headers.get("location") || null;
	} catch {
		return null;
	}
}

interface GeminiSearchPayload {
	parts: Array<{ text: string }>;
	groundingChunks: GroundingChunk[];
}

interface GroundingChunk {
	web: { uri: string; title: string } | undefined;
}

function readOptionalObject(value: JsonInputValue, label: string): JsonInputObject | undefined {
	if (value === undefined) return undefined;
	if (!isJsonInputObject(value)) throw new Error(`Gemini API returned invalid ${label}`);
	return value;
}

function readOptionalArray(value: JsonInputValue, label: string): JsonInputValue[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`Gemini API returned invalid ${label}`);
	return value;
}

function readOptionalString(value: JsonInputValue, label: string): string {
	if (value === undefined) return "";
	if (!isRuntimeString(value)) throw new Error(`Gemini API returned invalid ${label}`);
	return value;
}

function parseGeminiSearchPayload(value: JsonInputObject): GeminiSearchPayload {
	const candidates = readOptionalArray(value.candidates, "candidates");
	const candidate = readOptionalObject(candidates[0], "candidates[0]");
	const content = readOptionalObject(candidate?.content, "candidates[0].content");
	const parts = readOptionalArray(content?.parts, "candidates[0].content.parts").map((part, index) => {
		const entry = readOptionalObject(part, `candidates[0].content.parts[${index}]`);
		if (!entry) throw new Error(`Gemini API returned invalid candidates[0].content.parts[${index}]`);
		return { text: readOptionalString(entry.text, `candidates[0].content.parts[${index}].text`) };
	});

	const metadata = readOptionalObject(candidate?.groundingMetadata, "candidates[0].groundingMetadata");
	const groundingChunks = readOptionalArray(metadata?.groundingChunks, "candidates[0].groundingMetadata.groundingChunks")
		.map((chunk, index) => {
			const entry = readOptionalObject(chunk, `groundingChunks[${index}]`);
			if (!entry) throw new Error(`Gemini API returned invalid groundingChunks[${index}]`);
			const web = readOptionalObject(entry.web, `groundingChunks[${index}].web`);
			return {
				web: web
					? {
						uri: readOptionalString(web.uri, `groundingChunks[${index}].web.uri`),
						title: readOptionalString(web.title, `groundingChunks[${index}].web.title`),
					}
					: undefined,
			};
		});

	return { parts, groundingChunks };
}
