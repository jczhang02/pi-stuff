import { isJsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import type { JsonInputObject } from "../../shared/json-value.js";
import { parseJsonObject } from "../../shared/json-value.js";
import { isRuntimeNumber, isRuntimeString } from "../../shared/runtime-type.js";
import { readWebConfigText, webConfigExists } from "../settings.ts";

import { activityMonitor } from "./activity.ts";
import type { ExtractedContent } from "./extract.ts";
import type { SearchOptions, SearchResponse } from "./perplexity.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const SERPDIVE_API_URL = "https://api.serpdive.com/v1/search";
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
const SEARCH_TIMEOUT_MS = 60_000;

// Retrieval depth. The default is deliberately the free tier: this provider
// ships inside someone else's framework, and installing it must never start
// spending on a user's behalf without them choosing it.
//   krill — free, fair use, no synthesized answer (see buildAnswer below)
//   mako  — the fact-carrying sentences of each page, 1 credit
//   moby  — the full readable content of every page, 1.5 credits
// Pricing: https://serpdive.com/pricing
const MODELS = ["krill", "mako", "moby"] as const;
type SerpdiveModel = (typeof MODELS)[number];
const DEFAULT_MODEL: SerpdiveModel = "krill";

interface WebSearchConfig {
	serpdiveApiKey?: JsonInputValue;
	serpdiveModel?: JsonInputValue;
}

interface SerpdiveSearchOptions extends SearchOptions {
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
		provider: "SERPdive",
		configuredValue: loadConfig().serpdiveApiKey,
		environmentValue: process.env.SERPDIVE_API_KEY,
		signal,
	});
}

async function requireApiKey(signal?: AbortSignal): Promise<string> {
	const apiKey = await getApiKey(signal);
	if (!apiKey) {
		throw new Error(
			"SERPdive API key not found. Either:\n" +
			`  1. Create ${CONFIG_PATH} with { "serpdiveApiKey": "your-key" }\n` +
			"  2. Set SERPDIVE_API_KEY environment variable\n" +
			"Get a key at https://serpdive.com/dashboard/keys",
		);
	}
	return apiKey;
}

// An unknown value falls back to the free default rather than failing: a typo
// in a config file must not cost the user money, and must not break search.
function resolveModel(): SerpdiveModel {
	const raw = process.env.SERPDIVE_MODEL ?? loadConfig().serpdiveModel;
	if (!isRuntimeString(raw)) return DEFAULT_MODEL;
	const value = raw.trim().toLowerCase();
	return value === "krill" || value === "mako" || value === "moby" ? value : DEFAULT_MODEL;
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

function domainMatches(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

// SERPdive exposes no include/exclude domain parameter, so the filter is applied
// here, on what came back. It can therefore only ever narrow a page of results —
// it cannot ask the engine for more pages from a given domain.
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

// SERPdive has NO time-range parameter. Recency is expressed inside the question
// and read by the engine, which biases ranking toward recent pages — it is a
// hint, never a guaranteed freshness filter, and results outside the window can
// still come back.
function applyRecencyHint(query: string, recencyFilter: SearchOptions["recencyFilter"]): string {
	if (!recencyFilter) return query;
	const hints = {
		day: "past 24 hours",
		week: "past week",
		month: "past month",
		year: "past year",
	} satisfies Record<NonNullable<SearchOptions["recencyFilter"]>, string>;
	const hint = hints[recencyFilter];
	return hint ? `${query} ${hint}` : query;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorMessage(err: JsonInputValue): string {
	return err instanceof Error ? err.message : String(err);
}

function mapResults(
	results: JsonInputValue,
	numResults: number,
	filters: DomainFilters,
): SearchResponse["results"] {
	if (!Array.isArray(results)) return [];
	const mapped: SearchResponse["results"] = [];
	for (const item of results) {
		if (!isJsonInputObject(item) || !isRuntimeString(item.url) || !passesDomainFilters(item.url, filters)) continue;
		mapped.push({
			title: isRuntimeString(item.title) ? item.title : `Source ${mapped.length + 1}`,
			url: item.url,
			snippet: isRuntimeString(item.content) ? item.content.replace(/\s+/g, " ").trim() : "",
		});
		if (mapped.length >= numResults) break;
	}
	return mapped;
}

function mapInlineContent(results: JsonInputValue, filters: DomainFilters): ExtractedContent[] {
	if (!Array.isArray(results)) return [];
	return results.flatMap((item) => {
		if (!isJsonInputObject(item) || !isRuntimeString(item.url) || !passesDomainFilters(item.url, filters)) return [];
		if (!isRuntimeString(item.content) || item.content.trim().length === 0) return [];
		return [{
			url: item.url,
			title: isRuntimeString(item.title) ? item.title : "",
			content: item.content,
			error: null,
		}];
	});
}

// The free krill tier returns extracted content but no synthesized answer, so
// one is assembled from the sources — the same shape brave.ts and searxng.ts
// produce for providers that do not synthesize. mako and moby ask the API for a
// real answer and use it when it comes back.
function buildAnswer(apiAnswer: JsonInputValue, results: SearchResponse["results"]): string {
	if (isRuntimeString(apiAnswer) && apiAnswer.trim().length > 0) return apiAnswer;
	return results
		.map((result) => {
			if (result.snippet) return `${result.snippet}\nSource: ${result.title} (${result.url})`;
			return `Source: ${result.title} (${result.url})`;
		})
		.join("\n\n");
}

export function isSerpdiveAvailable(): boolean {
	return hasCredentialSource({
		provider: "SERPdive",
		configuredValue: loadConfig().serpdiveApiKey,
		environmentValue: process.env.SERPDIVE_API_KEY,
	});
}

export async function searchWithSerpdive(query: string, options: SerpdiveSearchOptions = {}): Promise<SearchResponse> {
	const apiKey = await requireApiKey(options.signal);
	const numResults = normalizeCount(options.numResults);
	const filters = parseDomainFilter(options.domainFilter);
	const model = resolveModel();
	const body: JsonInputObject = {
		query: applyRecencyHint(query, options.recencyFilter),
		model,
		// max_results is a CAP, never a minimum: the engine returns what it
		// judges relevant, up to this many. Asking for more does not produce more.
		max_results: Math.min(numResults, 10),
	};
	// krill has no answer synthesis — asking for one there is silently ignored
	// by the API, so it is not asked for at all.
	if (model !== "krill") body.answer = true;

	const activityId = activityMonitor.logStart({ type: "api", query });
	let response: Response;
	try {
		response = await fetch(SERPDIVE_API_URL, {
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
		throw new Error(`SERPdive API error ${response.status}: ${errorText.slice(0, 300)}`);
	}

	let data;
	try {
		const responseBody = await response.json();
		if (!isJsonInputObject(responseBody)) throw new TypeError("expected an object");
		data = responseBody;
	} catch (err) {
		activityMonitor.logComplete(activityId, response.status);
		throw new Error(`SERPdive API returned invalid JSON: ${errorMessage(err)}`);
	}

	activityMonitor.logComplete(activityId, response.status);
	const results = mapResults(data.results, numResults, filters);
	const result: SearchResponse = {
		answer: buildAnswer(data.answer, results),
		results,
	};
	if (options.includeContent) {
		const inlineContent = mapInlineContent(data.results, filters);
		if (inlineContent.length > 0) result.inlineContent = inlineContent;
	}
	return result;
}
