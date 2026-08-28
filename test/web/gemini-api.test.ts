import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchWithGeminiApi } from "../../packages/pi-stuff/src/web/runtime/gemini-api.ts";

const originalAgentDirectory = process.env["PI_CODING_AGENT_DIR"];
const originalApiKey = process.env["GEMINI_API_KEY"];
const originalBaseUrl = process.env["GOOGLE_GEMINI_BASE_URL"];
const originalFetch = globalThis.fetch;
let agentDirectory: string | undefined;

afterEach(async () => {
	globalThis.fetch = originalFetch;
	if (originalAgentDirectory === undefined) delete process.env["PI_CODING_AGENT_DIR"];
	else process.env["PI_CODING_AGENT_DIR"] = originalAgentDirectory;
	if (originalApiKey === undefined) delete process.env["GEMINI_API_KEY"];
	else process.env["GEMINI_API_KEY"] = originalApiKey;
	if (originalBaseUrl === undefined) delete process.env["GOOGLE_GEMINI_BASE_URL"];
	else process.env["GOOGLE_GEMINI_BASE_URL"] = originalBaseUrl;
	if (agentDirectory) await rm(agentDirectory, { force: true, recursive: true });
});

test("fetches only exact Gemini grounding redirect URLs", async () => {
	agentDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-gemini-api-"));
	process.env["PI_CODING_AGENT_DIR"] = agentDirectory;
	process.env["GEMINI_API_KEY"] = "test-key";
	delete process.env["GOOGLE_GEMINI_BASE_URL"];
	const maliciousUrl = "http://127.0.0.1/admin?next=vertexaisearch.cloud.google.com/grounding-api-redirect";
	const trustedUrl = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/token";
	const requests: string[] = [];
	// SAFETY: This test exercises only fetch's request/response call signature; preconnect is never used.
	globalThis.fetch = (async (input) => {
		const url = String(input);
		requests.push(url);
		if (url === trustedUrl) return new Response(null, { headers: { location: "https://example.com" }, status: 302 });
		return new Response(
			JSON.stringify({
				candidates: [
					{
						content: { parts: [{ text: "answer" }] },
						groundingMetadata: {
							groundingChunks: [
								{ web: { title: "lookalike", uri: maliciousUrl } },
								{ web: { title: "trusted", uri: trustedUrl } },
							],
						},
					},
				],
			}),
			{ headers: { "content-type": "application/json" } },
		);
	}) as typeof fetch;

	const result = await searchWithGeminiApi("query");

	expect(requests.slice(1)).toEqual([trustedUrl]);
	expect(result?.results).toEqual([
		{ snippet: "", title: "lookalike", url: maliciousUrl },
		{ snippet: "", title: "trusted", url: "https://example.com" },
	]);
});
