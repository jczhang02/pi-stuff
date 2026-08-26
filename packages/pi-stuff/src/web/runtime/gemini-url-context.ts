import { isJsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { activityMonitor } from "./activity.ts";
import { CredentialResolutionError } from "./credential-source.ts";
import type { ExtractedContent } from "./extract.ts";
import { DEFAULT_MODEL, fetchGeminiApi, getApiKey, getVersionedApiBase, isGatewayConfigured } from "./gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import { extractHeadingTitle } from "./rsc-extract.ts";

const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown.
Include the page title, all text content, code blocks, and tables.
Do not summarize — extract the full content.

URL: `;

function shouldRethrow<ErrorValue>(err: ErrorValue): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return err instanceof CredentialResolutionError || message.startsWith("Failed to parse ");
}

export async function extractWithUrlContext(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
	const requestSignal = AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]);
	const apiKey = await getApiKey(requestSignal);
	if (!apiKey && !isGatewayConfigured()) return null;

	const activityId = activityMonitor.logStart({ type: "api", query: `url_context: ${url}` });

	try {
		const model = DEFAULT_MODEL;
		const body = {
			contents: [{ role: "user", parts: [{ text: EXTRACTION_PROMPT + url }] }],
			tools: [{ url_context: {} }],
		};

		const res = await fetchGeminiApi(
			`${getVersionedApiBase()}/models/${model}:generateContent`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: requestSignal,
			},
			apiKey,
		);

		if (!res.ok) {
			activityMonitor.logComplete(activityId, res.status);
			return null;
		}

		const data = await res.json();
		if (!isJsonInputObject(data)) throw new Error("Gemini URL context returned an invalid response");
		activityMonitor.logComplete(activityId, res.status);

		const candidate =
			Array.isArray(data["candidates"]) && isJsonInputObject(data["candidates"][0])
				? data["candidates"][0]
				: undefined;
		const metadata = isJsonInputObject(candidate?.url_context_metadata) ? candidate.url_context_metadata : undefined;
		const urlMetadata = Array.isArray(metadata?.url_metadata) ? metadata.url_metadata : [];
		if (isJsonInputObject(urlMetadata[0])) {
			const status = urlMetadata[0].url_retrieval_status;
			if (status === "URL_RETRIEVAL_STATUS_UNSAFE" || status === "URL_RETRIEVAL_STATUS_ERROR") {
				return null;
			}
		}

		const candidateContent = isJsonInputObject(candidate?.content) ? candidate.content : undefined;
		const parts: readonly JsonInputValue[] = Array.isArray(candidateContent?.parts) ? candidateContent.parts : [];
		const content = parts
			.map((part) => (isJsonInputObject(part) && isRuntimeString(part["text"]) ? part["text"] : ""))
			.filter(Boolean)
			.join("\n");

		if (!content || content.length < 50) return null;

		const title = extractTitleFromContent(content, url);
		return { url, title, content, error: null };
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return null;
	}
}

export async function extractWithGeminiWeb(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
	const cookies = await isGeminiWebAvailable();
	if (!cookies) return null;

	const activityId = activityMonitor.logStart({ type: "api", query: `gemini_web: ${url}` });

	try {
		const text = await queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
			signal,
			timeoutMs: 60000,
		});

		activityMonitor.logComplete(activityId, 200);

		if (!text || text.length < 50) return null;

		const title = extractTitleFromContent(text, url);
		return { url, title, content: text, error: null };
	} catch (err) {
		if (shouldRethrow(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return null;
	}
}

function extractTitleFromContent(text: string, url: string): string {
	return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}
