import {
	isJsonInputObject,
	type JsonInputObject,
	type JsonInputValue,
	parseJsonObject,
	requireJsonInputValue,
} from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { activityMonitor } from "./activity.ts";
import { readWebConfig } from "./config.ts";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.ts";
import type { SearchOptions, SearchResponse, SearchResult } from "./perplexity.ts";
import { getWebSearchConfigPath } from "./utils.ts";

const DEFAULT_API_HOST = "https://generativelanguage.googleapis.com";
const GROUNDING_REDIRECT_ORIGIN = "https://vertexaisearch.cloud.google.com";
const GROUNDING_REDIRECT_PATH = "/grounding-api-redirect";
const API_VERSION = "v1beta";
export const API_BASE = `${DEFAULT_API_HOST}/${API_VERSION}`;
const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;
export const DEFAULT_MODEL = "gemini-3.6-flash";

function loadConfig() {
	return readWebConfig() ?? {};
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function normalizeApiKey(value: JsonInputValue): string | null {
	if (!isRuntimeString(value)) return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeBaseUrl(value: JsonInputValue): string | null {
	if (!isRuntimeString(value)) return null;
	const normalized = value.trim().replace(/\/+$/, "");
	return normalized.length > 0 ? normalized : null;
}

function isCloudflareGateway(): boolean {
	return getApiHost().includes("gateway.ai.cloudflare.com");
}

export async function getApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "Gemini",
		configuredValue: loadConfig()["geminiApiKey"],
		environmentValue: process.env["GEMINI_API_KEY"],
		signal,
	});
}

export function getApiHost(): string {
	return (
		normalizeBaseUrl(process.env["GOOGLE_GEMINI_BASE_URL"]) ??
		normalizeBaseUrl(loadConfig()["geminiBaseUrl"]) ??
		DEFAULT_API_HOST
	);
}

export function getVersionedApiBase(): string {
	return `${getApiHost()}/${API_VERSION}`;
}

function getLegacyCloudflareApiKey(): string | null {
	return normalizeApiKey(process.env["CLOUDFLARE_API_KEY"]) ?? normalizeApiKey(loadConfig()["cloudflareApiKey"]);
}

async function resolveCloudflareApiKey(signal?: AbortSignal): Promise<string | null> {
	return resolveCredential({
		provider: "Cloudflare",
		configuredValue: loadConfig()["cloudflareApiKey"],
		environmentValue: process.env["CLOUDFLARE_API_KEY"],
		signal,
	});
}

export function getCloudflareApiKey(): string | null {
	return getLegacyCloudflareApiKey();
}

export function isGatewayConfigured(): boolean {
	return (
		isCloudflareGateway() &&
		hasCredentialSource({
			provider: "Cloudflare",
			configuredValue: loadConfig()["cloudflareApiKey"],
			environmentValue: process.env["CLOUDFLARE_API_KEY"],
		})
	);
}

export function buildAuthHeaders(
	apiKey: string | null = null,
	cloudflareApiKey: string | null = getLegacyCloudflareApiKey(),
): Record<string, string> {
	if (!isCloudflareGateway()) return apiKey ? { "x-goog-api-key": apiKey } : {};
	return cloudflareApiKey ? { "cf-aig-authorization": `Bearer ${cloudflareApiKey}` } : {};
}

function redactGeminiCredentials(
	text: string,
	apiKey: string | null | undefined,
	cloudflareApiKey: string | null | undefined,
): string {
	return redactCredential(redactCredential(text, apiKey), cloudflareApiKey);
}

const responseCredentials = new WeakMap<
	Response,
	{
		apiKey: string | null | undefined;
		cloudflareApiKey: string | null | undefined;
	}
>();

export function redactGeminiApiResponse(response: Response, text: string, apiKey?: string | null): string {
	const credentials = responseCredentials.get(response);
	return redactGeminiCredentials(text, credentials?.apiKey ?? apiKey, credentials?.cloudflareApiKey);
}

export async function fetchGeminiApi(
	url: string | URL,
	init: RequestInit = {},
	apiKey?: string | null,
): Promise<Response> {
	const parsedUrl = new URL(url);
	for (const name of parsedUrl.searchParams.keys()) {
		if (["key", "api_key"].includes(name.toLowerCase())) {
			throw new Error("Gemini API credential query parameters are not allowed");
		}
	}
	const resolvedApiKey = apiKey === undefined ? await getApiKey(init.signal ?? undefined) : apiKey;
	const cloudflareApiKey = isCloudflareGateway() ? await resolveCloudflareApiKey(init.signal ?? undefined) : null;
	const allowedOrigins = new Set([new URL(getApiHost()).origin, new URL(DEFAULT_API_HOST).origin]);
	if ((resolvedApiKey || isGatewayConfigured()) && !allowedOrigins.has(parsedUrl.origin)) {
		throw new Error("Gemini API request host is not allowed");
	}
	const headers = new Headers(init.headers);
	headers.delete("x-goog-api-key");
	headers.delete("cf-aig-authorization");
	for (const [name, value] of Object.entries(buildAuthHeaders(resolvedApiKey, cloudflareApiKey))) {
		headers.set(name, value);
	}
	try {
		const response = await fetch(parsedUrl, { ...init, headers });
		responseCredentials.set(response, { apiKey: resolvedApiKey, cloudflareApiKey });
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const redactedMessage = redactGeminiCredentials(message, resolvedApiKey, cloudflareApiKey);
		if (redactedMessage === message) throw error;
		const redactedError = new Error(redactedMessage);
		if (error instanceof Error) redactedError.name = error.name;
		throw redactedError;
	}
}

export function isGeminiApiAvailable(): boolean {
	return (
		hasCredentialSource({
			provider: "Gemini",
			configuredValue: loadConfig()["geminiApiKey"],
			environmentValue: process.env["GEMINI_API_KEY"],
		}) || isGatewayConfigured()
	);
}

export async function searchWithGeminiApi(query: string, options: SearchOptions = {}): Promise<SearchResponse | null> {
	const requestSignal = withTimeout(options.signal, 60_000);
	const apiKey = await getApiKey(requestSignal);
	if (!apiKey && !isGatewayConfigured()) return null;
	const activityId = activityMonitor.logStart({ type: "api", query });

	try {
		const configuredModel = loadConfig()["searchModel"];
		const model = isRuntimeString(configuredModel) && configuredModel.trim() ? configuredModel.trim() : DEFAULT_MODEL;
		const res = await fetchGeminiApi(
			`${getVersionedApiBase()}/models/${model}:generateContent`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ role: "user", parts: [{ text: query }] }],
					tools: [{ google_search: {} }],
				}),
				signal: requestSignal,
			},
			apiKey,
		);
		if (!res.ok) {
			const errorText = redactGeminiApiResponse(res, await res.text(), apiKey);
			throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
		}

		const data = parseGeminiSearchPayload(parseJsonObject(await res.text()));
		activityMonitor.logComplete(activityId, res.status);
		const answer = data.parts
			.map((part) => part.text)
			.filter(Boolean)
			.join("\n");
		const results = await resolveGroundingChunks(data.groundingChunks, options.signal);
		return answer || results.length > 0 ? { answer, results } : null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		throw error;
	}
}

interface GeminiSearchPayload {
	parts: Array<{ text: string }>;
	groundingChunks: GroundingChunk[];
}

interface GroundingChunk {
	web: { uri: string; title: string } | undefined;
}

async function resolveGroundingChunks(chunks: GroundingChunk[], signal?: AbortSignal): Promise<SearchResult[]> {
	const results: SearchResult[] = [];
	for (const chunk of chunks) {
		if (!chunk.web) continue;
		const title = chunk.web.title || "";
		let url = chunk.web.uri || "";
		const resolved = await resolveRedirect(url, signal);
		if (resolved) url = resolved;
		if (url) results.push({ title, url, snippet: "" });
	}
	return results;
}

async function resolveRedirect(proxyUrl: string, signal?: AbortSignal): Promise<string | null> {
	try {
		const url = new URL(proxyUrl);
		if (
			url.origin !== GROUNDING_REDIRECT_ORIGIN ||
			(url.pathname !== GROUNDING_REDIRECT_PATH && !url.pathname.startsWith(`${GROUNDING_REDIRECT_PATH}/`))
		) {
			return null;
		}
		const res = await fetch(url, {
			method: "HEAD",
			redirect: "manual",
			signal: withTimeout(signal, 5_000),
		});
		return res.headers.get("location");
	} catch {
		return null;
	}
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
	const candidates = readOptionalArray(value["candidates"], "candidates");
	const candidate = readOptionalObject(candidates[0], "candidates[0]");
	const content = readOptionalObject(candidate?.["content"], "candidates[0].content");
	const parts = readOptionalArray(content?.["parts"], "candidates[0].content.parts").map((part, index) => {
		const entry = readOptionalObject(part, `candidates[0].content.parts[${index}]`);
		if (!entry) throw new Error(`Gemini API returned invalid candidates[0].content.parts[${index}]`);
		return { text: readOptionalString(entry["text"], `candidates[0].content.parts[${index}].text`) };
	});

	const metadata = readOptionalObject(candidate?.["groundingMetadata"], "candidates[0].groundingMetadata");
	const groundingChunks = readOptionalArray(
		metadata?.["groundingChunks"],
		"candidates[0].groundingMetadata.groundingChunks",
	).map((chunk, index) => {
		const entry = readOptionalObject(chunk, `groundingChunks[${index}]`);
		if (!entry) throw new Error(`Gemini API returned invalid groundingChunks[${index}]`);
		const web = readOptionalObject(entry["web"], `groundingChunks[${index}].web`);
		return {
			web: web
				? {
						uri: readOptionalString(web["uri"], `groundingChunks[${index}].web.uri`),
						title: readOptionalString(web["title"], `groundingChunks[${index}].web.title`),
					}
				: undefined,
		};
	});

	return { parts, groundingChunks };
}

export interface GeminiApiOptions {
	apiKey?: string;
	model?: string;
	mimeType?: string;
	signal?: AbortSignal | undefined;
	timeoutMs?: number;
}

export interface GeminiGenerateContentResult {
	text: string;
	finishReason?: string;
	blockReason?: string;
}

interface GeminiFileData {
	fileUri: string;
	mimeType?: string;
}

function parseGenerateContentResponse(value: JsonInputValue): GeminiGenerateContentResult {
	if (!isJsonInputObject(value)) throw new Error("Gemini API returned an invalid response");
	const candidate =
		Array.isArray(value["candidates"]) && isJsonInputObject(value["candidates"][0])
			? value["candidates"][0]
			: undefined;
	const content = isJsonInputObject(candidate?.content) ? candidate.content : undefined;
	const parts: readonly JsonInputValue[] = Array.isArray(content?.parts) ? content.parts : [];
	const text = parts
		.flatMap((part) =>
			isJsonInputObject(part) && isRuntimeString(part["text"]) && part["text"].length > 0 ? [part["text"]] : [],
		)
		.join("\n");
	const promptFeedback = isJsonInputObject(value["promptFeedback"]) ? value["promptFeedback"] : undefined;
	const result: GeminiGenerateContentResult = { text };
	if (isRuntimeString(candidate?.finishReason)) result.finishReason = candidate.finishReason;
	if (isRuntimeString(promptFeedback?.["blockReason"])) result.blockReason = promptFeedback["blockReason"];
	return result;
}

export async function queryGeminiApiWithInlineData(
	prompt: string,
	data: string,
	mimeType: string,
	options: GeminiApiOptions = {},
): Promise<GeminiGenerateContentResult> {
	const signal = withTimeout(options.signal, options.timeoutMs ?? 120000);
	const apiKey = options.apiKey ?? (await getApiKey(signal));
	if (!apiKey && !isGatewayConfigured()) {
		throw new Error(
			"Gemini API not configured. Either:\n" +
				`  1. Configure geminiApiKey in ${CONFIG_PATH} or set GEMINI_API_KEY\n` +
				"  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for Cloudflare AI Gateway routing",
		);
	}

	const model = options.model ?? DEFAULT_MODEL;
	const url = `${getVersionedApiBase()}/models/${model}:generateContent`;
	const body = {
		contents: [
			{
				role: "user",
				parts: [{ inlineData: { mimeType, data } }, { text: prompt }],
			},
		],
	};

	const res = await fetchGeminiApi(
		url,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
		},
		apiKey,
	);

	if (!res.ok) {
		const errorText = redactGeminiApiResponse(res, await res.text(), apiKey);
		throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
	}

	return parseGenerateContentResponse(requireJsonInputValue(await res.json(), "Gemini response"));
}

export async function queryGeminiApiWithVideo(
	prompt: string,
	videoUri: string,
	options: GeminiApiOptions = {},
): Promise<string> {
	const signal = withTimeout(options.signal, options.timeoutMs ?? 120000);
	const apiKey = options.apiKey ?? (await getApiKey(signal));
	if (!apiKey && !isGatewayConfigured()) {
		throw new Error(
			"Gemini API not configured. Either:\n" +
				`  1. Configure geminiApiKey in ${CONFIG_PATH} or set GEMINI_API_KEY\n` +
				"  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for Cloudflare AI Gateway routing",
		);
	}

	const model = options.model ?? DEFAULT_MODEL;
	const url = `${getVersionedApiBase()}/models/${model}:generateContent`;

	const fileData: GeminiFileData = { fileUri: videoUri };
	if (options.mimeType) fileData.mimeType = options.mimeType;

	const body = {
		contents: [
			{
				role: "user",
				parts: [{ fileData }, { text: prompt }],
			},
		],
	};

	const res = await fetchGeminiApi(
		url,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
		},
		apiKey,
	);

	if (!res.ok) {
		const errorText = redactGeminiApiResponse(res, await res.text(), apiKey);
		throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
	}

	const { text } = parseGenerateContentResponse(requireJsonInputValue(await res.json(), "Gemini response"));

	if (!text) throw new Error("Gemini API returned empty response");
	return text;
}
