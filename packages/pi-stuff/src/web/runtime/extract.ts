import { resizeImage } from "@earendil-works/pi-coding-agent";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import pLimit from "p-limit";
import TurndownService from "turndown";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { activityMonitor } from "./activity.ts";
import { extractWithBrightDataUnlocker, isBrightDataUnlockerAvailable } from "./brightdata-unlocker.ts";
import { CredentialResolutionError } from "./credential-source.ts";
import { appendDeclaredWebLinks, type DeclaredWebLink, discoverDeclaredWebLinks } from "./declared-web-links.ts";
import { extractWithFirecrawl, isFirecrawlAvailable } from "./firecrawl.ts";
import { extractWithGeminiWeb, extractWithUrlContext } from "./gemini-url-context.ts";
import { extractGitHub } from "./github-extract.ts";
import { extractWithKagi, isKagiExtractAvailable } from "./kagi.ts";
import { extractWithOllama, isOllamaFetchAvailable } from "./ollama.ts";
import { extractWithParallel, isParallelAvailable } from "./parallel.ts";
import { extractPDFToMarkdown, isPDF, loadPDFConfig, type PDFConfig } from "./pdf-extract.ts";
import { extractWithQuerit, isQueritAvailable } from "./querit.ts";
import { extractHeadingTitle, extractRSCContent } from "./rsc-extract.ts";
import { extractWithSearch1API, isSearch1APIAvailable } from "./search1api.ts";
import {
	fetchRemoteUrl,
	type Lookup,
	loadFetchContentDomainPolicy,
	loadSsrfConfig,
	validateRemoteUrl,
} from "./ssrf-protection.ts";
import { extractWithTinyFish, isTinyFishAvailable } from "./tinyfish.ts";
import { errorMessage, getWebSearchConfigPath, isAbortError } from "./utils.ts";

const DEFAULT_TIMEOUT_MS = 30000;
const CONCURRENT_LIMIT = 3;

const NON_RECOVERABLE_ERRORS = ["Unsupported content type", "Response too large"];
const MIN_USEFUL_CONTENT = 500;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();
const PAGE_REQUEST_HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
	"Cache-Control": "no-cache",
	"Sec-Fetch-Dest": "document",
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Site": "none",
	"Sec-Fetch-User": "?1",
	"Upgrade-Insecure-Requests": "1",
};

export { loadSsrfConfig } from "./ssrf-protection.ts";

export function loadSsrfAllowRanges(): string[] {
	return loadSsrfConfig().allowRanges;
}

function abortedResult(url: string): ExtractedContent {
	return { url, title: "", content: "", error: "Aborted" };
}

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

const fetchLimit = pLimit(CONCURRENT_LIMIT);

export interface ExtractedContent {
	url: string;
	title: string;
	content: string;
	error: string | null;
	thumbnail?: { data: string; mimeType: string };
	mimeType?: string;
	status?: number;
}

type HttpExtractedContent = ExtractedContent & { declaredLinks?: DeclaredWebLink[] };

export interface ExtractOptions {
	timeoutMs?: number | undefined;
	mode?: "readable" | "raw";
	/** Custom DNS resolver used for SSRF validation. Primarily a test seam. */
	lookup?: Lookup | undefined;
}

const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 30000;

async function extractWithJinaReader(
	url: string,
	signal?: AbortSignal,
	lookup?: Lookup,
): Promise<ExtractedContent | null> {
	const jinaUrl = JINA_READER_BASE + url;

	const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });

	try {
		const ssrf = loadSsrfConfig();
		const domainPolicy = loadFetchContentDomainPolicy();
		await validateRemoteUrl(url, {
			allowRanges: ssrf.allowRanges,
			trustEnvProxy: ssrf.trustEnvProxy,
			domainPolicy,
			lookup,
		});
		const res = await fetch(jinaUrl, {
			headers: {
				Accept: "text/markdown",
				"X-No-Cache": "true",
			},
			signal: AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), ...(signal ? [signal] : [])]),
		});

		if (!res.ok) {
			activityMonitor.logComplete(activityId, res.status);
			return null;
		}

		const content = await readTextResponseWithLimit(res, 5 * 1024 * 1024);
		activityMonitor.logComplete(activityId, res.status);

		const contentStart = content.indexOf("Markdown Content:");
		if (contentStart < 0) {
			return null;
		}

		const markdownPart = content.slice(contentStart + 17).trim(); // 17 = "Markdown Content:".length

		// Check for failed JS rendering or minimal content
		if (
			markdownPart.length < 100 ||
			markdownPart.startsWith("Loading...") ||
			markdownPart.startsWith("Please enable JavaScript")
		) {
			return null;
		}

		const title = extractHeadingTitle(markdownPart) ?? (new URL(url).pathname.split("/").pop() || url);
		return { url, title, content: markdownPart, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return null;
	}
}

interface ContentFallback {
	readonly available: () => boolean;
	readonly extract: () => Promise<ExtractedContent | null>;
	readonly label?: string;
}

interface ContentFallbackResult {
	readonly errors: string[];
	readonly result: ExtractedContent | null;
}

function appendLinks(result: ExtractedContent, declaredLinks: DeclaredWebLink[]): ExtractedContent {
	return { ...result, content: appendDeclaredWebLinks(result.content, declaredLinks) };
}

function contentFallbacks(url: string, signal: AbortSignal | undefined, options: ExtractOptions | undefined) {
	const ssrfOptions = () => {
		const ssrf = loadSsrfConfig();
		return { timeoutMs: options?.timeoutMs, lookup: options?.lookup, ssrf };
	};
	return [
		{
			available: isFirecrawlAvailable,
			extract: () => extractWithFirecrawl(url, signal, ssrfOptions()),
			label: "Firecrawl",
		},
		{ available: () => true, extract: () => extractWithJinaReader(url, signal, options?.lookup) },
		{
			available: isTinyFishAvailable,
			extract: () => extractWithTinyFish(url, signal, options),
			label: "TinyFish",
		},
		{
			available: isSearch1APIAvailable,
			extract: () => extractWithSearch1API(url, signal, options),
			label: "Search1API",
		},
		{
			available: isQueritAvailable,
			extract: () => extractWithQuerit(url, signal, options),
			label: "Querit",
		},
		{ available: isKagiExtractAvailable, extract: () => extractWithKagi(url, signal, ssrfOptions()), label: "Kagi" },
		{
			available: isOllamaFetchAvailable,
			extract: () => extractWithOllama(url, signal, ssrfOptions()),
			label: "Ollama",
		},
		{ available: isParallelAvailable, extract: () => extractWithParallel(url, signal), label: "Parallel" },
		{
			available: isBrightDataUnlockerAvailable,
			extract: () => extractWithBrightDataUnlocker(url, signal, ssrfOptions()),
			label: "Bright Data",
		},
	] satisfies readonly ContentFallback[];
}

async function tryContentFallbacks(
	url: string,
	signal: AbortSignal | undefined,
	options: ExtractOptions | undefined,
	declaredLinks: DeclaredWebLink[],
): Promise<ContentFallbackResult> {
	const errors: string[] = [];
	for (const fallback of contentFallbacks(url, signal, options)) {
		try {
			if (fallback.available()) {
				const result = await fallback.extract();
				if (result) return { errors, result: appendLinks(result, declaredLinks) };
			}
		} catch (err) {
			if (isAbortError(err)) return { errors, result: abortedResult(url) };
			const message = errorMessage(err);
			if (fallback.label) errors.push(`${fallback.label} fallback failed: ${message}`);
		}
		if (signal?.aborted) return { errors, result: abortedResult(url) };
	}
	return { errors, result: null };
}

function extractionGuidance(httpError: string, fallbackErrors: readonly string[]): string {
	return [
		httpError,
		...fallbackErrors,
		"",
		"Fallback options:",
		`  \u2022 Set firecrawlBaseUrl in ${WEB_SEARCH_CONFIG_PATH} to a self-hosted Firecrawl instance`,
		`  • Set tinyfishApiKey in ${WEB_SEARCH_CONFIG_PATH} or TINYFISH_API_KEY`,
		`  • Set search1apiApiKey in ${WEB_SEARCH_CONFIG_PATH} or SEARCH1API_KEY`,
		`  • Set queritApiKey in ${WEB_SEARCH_CONFIG_PATH} or QUERIT_API_KEY`,
		`  • Set kagiApiKey in ${WEB_SEARCH_CONFIG_PATH} or KAGI_API_KEY`,
		`  • Set ollamaApiKey in ${WEB_SEARCH_CONFIG_PATH} or OLLAMA_API_KEY`,
		`  • Set parallelApiKey in ${WEB_SEARCH_CONFIG_PATH} or PARALLEL_API_KEY`,
		`  • Set brightdataApiKey and brightdataUnlockerZone in ${WEB_SEARCH_CONFIG_PATH} or BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE`,
		`  \u2022 Set GEMINI_API_KEY in ${WEB_SEARCH_CONFIG_PATH}`,
		"  \u2022 Sign into gemini.google.com in Chrome",
		"  \u2022 Use web_search to find content about this topic",
	].join("\n");
}

export async function extractContent(
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent> {
	if (signal?.aborted) return abortedResult(url);
	let remoteUrl: URL | null = null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") remoteUrl = parsed;
	} catch {}
	if (remoteUrl) {
		try {
			const ssrf = loadSsrfConfig();
			await validateRemoteUrl(remoteUrl, {
				allowRanges: ssrf.allowRanges,
				trustEnvProxy: ssrf.trustEnvProxy,
				domainPolicy: loadFetchContentDomainPolicy(),
				lookup: options?.lookup,
			});
		} catch (err) {
			return { url, title: "", content: "", error: errorMessage(err) };
		}
	}
	if (options?.mode === "raw") return extractViaHttp(url, signal, options);
	try {
		if (!remoteUrl) new URL(url);
	} catch (err) {
		return { url, title: "", content: "", error: errorMessage(err) };
	}
	try {
		const ghResult = await extractGitHub(url, signal);
		if (ghResult) return ghResult;
		if (signal?.aborted) return abortedResult(url);
	} catch (err) {
		if (isAbortError(err)) return abortedResult(url);
	}
	if (signal?.aborted) return abortedResult(url);
	const { declaredLinks = [], ...httpResult } = await extractViaHttp(url, signal, options);
	if (signal?.aborted) return abortedResult(url);
	if (!httpResult.error) return httpResult;
	const httpError = httpResult.error;
	if (NON_RECOVERABLE_ERRORS.some((prefix) => httpError.startsWith(prefix))) return httpResult;
	const fallback = await tryContentFallbacks(url, signal, options, declaredLinks);
	if (fallback.result) return fallback.result;
	let geminiResult: ExtractedContent | null = null;
	try {
		geminiResult = (await extractWithUrlContext(url, signal)) ?? (await extractWithGeminiWeb(url, signal));
	} catch (err) {
		if (isAbortError(err)) return abortedResult(url);
		if (err instanceof CredentialResolutionError) {
			return { ...httpResult, error: errorMessage(err) };
		}
	}
	if (geminiResult) return appendLinks(geminiResult, declaredLinks);
	if (signal?.aborted) return abortedResult(url);
	if (declaredLinks.length > 0) return { ...httpResult, error: null };
	return { ...httpResult, error: extractionGuidance(httpError, fallback.errors) };
}

function isLikelyJSRendered(html: string): boolean {
	// Extract body content
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (!bodyMatch) return false;

	const bodyHtml = bodyMatch[1] ?? "";

	// Strip tags to get text content
	const textContent = bodyHtml
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();

	// Count scripts
	const scriptCount = (html.match(/<script/gi) || []).length;

	// Heuristic: little text content but many scripts suggests JS rendering
	return textContent.length < 500 && scriptCount > 3;
}

export async function readPDFResponseBuffer(response: Response, maxSizeMB: number): Promise<ArrayBuffer> {
	const maxBytes = maxSizeMB * 1024 * 1024;
	return readResponseBufferWithLimit(response, maxBytes, () => pdfSizeLimitError(maxSizeMB));
}

async function readTextResponseWithLimit(response: Response, maxBytes: number): Promise<string> {
	const buffer = await readResponseBufferWithLimit(response, maxBytes, () => responseSizeLimitError(maxBytes));
	const charset = response.headers.get("content-type")?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
	try {
		// SAFETY: Bun narrows TextDecoder labels to Encoding, while the runtime accepts arbitrary labels and throws below.
		return new TextDecoder((charset || "utf-8") as ConstructorParameters<typeof TextDecoder>[0]).decode(buffer);
	} catch {
		return new TextDecoder("utf-8").decode(buffer);
	}
}

function isTextContentType(contentType: string): boolean {
	const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return (
		mimeType.startsWith("text/") ||
		mimeType === "application/json" ||
		mimeType === "application/ld+json" ||
		mimeType === "application/xml" ||
		mimeType === "application/xhtml+xml" ||
		mimeType === "application/javascript" ||
		mimeType === "application/x-javascript" ||
		mimeType.endsWith("+json") ||
		mimeType.endsWith("+xml")
	);
}

async function readResponseBufferWithLimit(
	response: Response,
	maxBytes: number,
	buildError: () => Error,
): Promise<ArrayBuffer> {
	const reader = response.body?.getReader();
	if (!reader) {
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > maxBytes) throw buildError();
		return buffer;
	}

	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel();
				throw buildError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return combined.buffer;
}

function pdfSizeLimitError(maxSizeMB: number): Error {
	return new Error(`PDF exceeds configured pdf.maxSizeMB limit (${maxSizeMB} MB)`);
}

function responseSizeLimitError(maxBytes: number): Error {
	return new Error(`Response too large (${Math.round(maxBytes / 1024 / 1024)}MB)`);
}

function oversizedResponse(
	response: Response,
	url: string,
	maxResponseSize: number,
	pdfConfig: PDFConfig | null,
	activityId: string,
): HttpExtractedContent | null {
	const header = response.headers.get("content-length");
	if (!header) return null;
	const contentLength = Number.parseInt(header, 10);
	if (!Number.isFinite(contentLength) || contentLength <= maxResponseSize) return null;
	activityMonitor.logComplete(activityId, response.status);
	return {
		url,
		title: "",
		content: "",
		error: pdfConfig
			? pdfSizeLimitError(pdfConfig.maxSizeMB).message
			: `Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`,
	};
}

async function extractRawResponse(
	response: Response,
	url: string,
	contentType: string,
	mimeType: string,
	maxResponseSize: number,
	activityId: string,
): Promise<HttpExtractedContent> {
	if (!isTextContentType(contentType)) {
		activityMonitor.logComplete(activityId, response.status);
		return {
			url,
			title: "",
			content: "",
			error: `Unsupported content type in raw mode: ${mimeType || "missing"}`,
			mimeType,
			status: response.status,
		};
	}
	const text = await readTextResponseWithLimit(response, maxResponseSize);
	activityMonitor.logComplete(activityId, response.status);
	return { url, title: extractTextTitle(text, url), content: text, error: null, mimeType, status: response.status };
}

async function extractImageResponse(
	response: Response,
	url: string,
	mimeType: string,
	maxResponseSize: number,
	activityId: string,
): Promise<HttpExtractedContent> {
	try {
		const buffer = await readResponseBufferWithLimit(response, maxResponseSize, () =>
			responseSizeLimitError(maxResponseSize),
		);
		const resized = await resizeImage(new Uint8Array(buffer), mimeType, { maxWidth: 2000, maxHeight: 2000 });
		activityMonitor.logComplete(activityId, response.status);
		if (!resized) {
			return {
				url,
				title: "",
				content: "",
				error: `Could not decode image: ${mimeType}`,
				mimeType,
				status: response.status,
			};
		}
		const title = new URL(response.url || url).pathname.split("/").pop() || url;
		return {
			url,
			title,
			content: `Image fetched (${resized.width}×${resized.height}, ${resized.mimeType})`,
			error: null,
			thumbnail: { data: resized.data, mimeType: resized.mimeType },
			mimeType: resized.mimeType,
			status: response.status,
		};
	} catch (err) {
		const message = errorMessage(err);
		activityMonitor.logError(activityId, message);
		return { url, title: "", content: "", error: message, mimeType, status: response.status };
	}
}

async function extractPdfResponse(
	response: Response,
	url: string,
	signal: AbortSignal | undefined,
	pdfConfig: PDFConfig,
	activityId: string,
): Promise<HttpExtractedContent> {
	try {
		const buffer = await readPDFResponseBuffer(response, pdfConfig.maxSizeMB);
		if (signal?.aborted) return abortedResult(url);
		const result = await extractPDFToMarkdown(buffer, url, { signal });
		activityMonitor.logComplete(activityId, response.status);
		return {
			url,
			title: result.title,
			content: `PDF extracted and saved to: ${result.outputPath}\n\nPages: ${result.pages}\nCharacters: ${result.chars}`,
			error: null,
		};
	} catch (err) {
		const message = errorMessage(err);
		activityMonitor.logError(activityId, message);
		if (message.startsWith("PDF exceeds configured pdf.maxSizeMB limit")) {
			return { url, title: "", content: "", error: message };
		}
		if (err instanceof CredentialResolutionError) {
			return { url, title: "", content: "", error: message };
		}
		return { url, title: "", content: "", error: `PDF extraction failed: ${message}` };
	}
}

function isUnsupportedBinary(contentType: string): boolean {
	return (
		contentType.includes("application/octet-stream") ||
		contentType.includes("image/") ||
		contentType.includes("audio/") ||
		contentType.includes("video/") ||
		contentType.includes("application/zip")
	);
}

function extractHtmlResponse(response: Response, url: string, text: string, activityId: string): HttpExtractedContent {
	const { document } = parseHTML(text);
	const documentTitle = document.title?.trim() ?? "";
	const declaredLinks = discoverDeclaredWebLinks(document, response.headers.get("link"), response.url || url);
	const article = new Readability(document).parse();
	if (!article) {
		const rscResult = extractRSCContent(text);
		if (rscResult) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: rscResult.title,
				content: appendDeclaredWebLinks(rscResult.content, declaredLinks),
				error: null,
				declaredLinks,
			};
		}
		activityMonitor.logComplete(activityId, response.status);
		return {
			url,
			title: documentTitle,
			content: appendDeclaredWebLinks("", declaredLinks),
			error: isLikelyJSRendered(text)
				? "Page appears to be JavaScript-rendered (content loads dynamically)"
				: "Could not extract readable content from HTML structure",
			declaredLinks,
		};
	}
	if (!isRuntimeString(article.content)) throw new Error("Readability returned invalid article content");
	const markdown = turndown.turndown(article.content);
	activityMonitor.logComplete(activityId, response.status);
	return {
		url,
		title: article.title || documentTitle,
		content: appendDeclaredWebLinks(markdown, declaredLinks),
		error:
			markdown.length >= MIN_USEFUL_CONTENT
				? null
				: isLikelyJSRendered(text)
					? "Page appears to be JavaScript-rendered (content loads dynamically)"
					: "Extracted content appears incomplete",
		declaredLinks,
	};
}

async function extractHttpResponse(
	response: Response,
	url: string,
	signal: AbortSignal | undefined,
	options: ExtractOptions | undefined,
	activityId: string,
): Promise<HttpExtractedContent> {
	if (!response.ok && options?.mode !== "raw") {
		activityMonitor.logComplete(activityId, response.status);
		return {
			url,
			title: "",
			content: "",
			error: `HTTP ${response.status}: ${response.statusText}`,
			status: response.status,
		};
	}
	const contentType = response.headers.get("content-type") || "";
	const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	const pdfConfig = isPDF(url, contentType) ? loadPDFConfig() : null;
	const maxResponseSize = (pdfConfig?.maxSizeMB ?? 5) * 1024 * 1024;
	const sizeError = oversizedResponse(response, url, maxResponseSize, pdfConfig, activityId);
	if (sizeError) return sizeError;
	if (options?.mode === "raw") {
		return extractRawResponse(response, url, contentType, mimeType, maxResponseSize, activityId);
	}
	if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
		return extractImageResponse(response, url, mimeType, maxResponseSize, activityId);
	}
	if (pdfConfig) return extractPdfResponse(response, url, signal, pdfConfig, activityId);
	if (isUnsupportedBinary(contentType)) {
		activityMonitor.logComplete(activityId, response.status);
		return { url, title: "", content: "", error: `Unsupported content type: ${contentType.split(";")[0]}` };
	}
	const text = await readTextResponseWithLimit(response, maxResponseSize);
	if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
		activityMonitor.logComplete(activityId, response.status);
		return { url, title: extractTextTitle(text, url), content: text, error: null };
	}
	return extractHtmlResponse(response, url, text, activityId);
}

async function extractViaHttp(
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<HttpExtractedContent> {
	const activityId = activityMonitor.logStart({ type: "fetch", url });
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort);
	try {
		const ssrf = loadSsrfConfig();
		const response = await fetchRemoteUrl(
			url,
			{ headers: PAGE_REQUEST_HEADERS, signal: controller.signal },
			{
				allowRanges: ssrf.allowRanges,
				trustEnvProxy: ssrf.trustEnvProxy,
				domainPolicy: loadFetchContentDomainPolicy(),
				lookup: options?.lookup,
			},
		);
		return await extractHttpResponse(response, url, signal, options, activityId);
	} catch (err) {
		const message = errorMessage(err);
		if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
		else activityMonitor.logError(activityId, message);
		return { url, title: "", content: "", error: message };
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", onAbort);
	}
}

function extractTextTitle(text: string, url: string): string {
	return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}

export async function fetchAllContent(
	urls: string[],
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent[]> {
	return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}
