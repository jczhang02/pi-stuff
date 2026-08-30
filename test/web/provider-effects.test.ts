import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { extractWithFirecrawl } from "../../packages/pi-stuff/src/web/runtime/firecrawl.ts";
import { search } from "../../packages/pi-stuff/src/web/runtime/gemini-search.ts";
import { searchWithSearch1API } from "../../packages/pi-stuff/src/web/runtime/search1api.ts";
import { searchWithTavily } from "../../packages/pi-stuff/src/web/runtime/tavily.ts";

const originalFetch = globalThis.fetch;
const originalAgentDirectory = process.env["PI_CODING_AGENT_DIR"];
const originalCredentials = {
	firecrawlApiKey: process.env["FIRECRAWL_API_KEY"],
	firecrawlBaseUrl: process.env["FIRECRAWL_BASE_URL"],
	search1api: process.env["SEARCH1API_KEY"],
	serpdive: process.env["SERPDIVE_API_KEY"],
	tavily: process.env["TAVILY_API_KEY"],
};
const roots: string[] = [];

function installFetchMock(mock: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
	// SAFETY: Provider tests exercise only fetch's request/response call signature; preconnect is never used.
	globalThis.fetch = mock as typeof fetch;
}

async function expectTavilyAbort<Result>(start: (signal: AbortSignal) => Promise<Result>): Promise<void> {
	process.env["TAVILY_API_KEY"] = "tavily-secret";
	let requestSignal: AbortSignal | undefined;
	let started!: () => void;
	const requestStarted = new Promise<void>((resolve) => {
		started = resolve;
	});
	installFetchMock((_input, init) => {
		requestSignal = init?.signal ?? undefined;
		started();
		return new Promise<Response>((_resolve, reject) => {
			requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
		});
	});

	const controller = new AbortController();
	const operation = start(controller.signal);
	await requestStarted;
	controller.abort();
	await expect(operation).rejects.toThrow();
	expect(requestSignal?.aborted).toBe(true);
}

function restoreEnvironment(name: keyof typeof originalCredentials, variable: string): void {
	const value = originalCredentials[name];
	if (value === undefined) delete process.env[variable];
	else process.env[variable] = value;
}

afterEach(async () => {
	globalThis.fetch = originalFetch;
	if (originalAgentDirectory === undefined) delete process.env["PI_CODING_AGENT_DIR"];
	else process.env["PI_CODING_AGENT_DIR"] = originalAgentDirectory;
	restoreEnvironment("firecrawlApiKey", "FIRECRAWL_API_KEY");
	restoreEnvironment("firecrawlBaseUrl", "FIRECRAWL_BASE_URL");
	restoreEnvironment("search1api", "SEARCH1API_KEY");
	restoreEnvironment("serpdive", "SERPDIVE_API_KEY");
	restoreEnvironment("tavily", "TAVILY_API_KEY");
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("Search1API preserves request shaping and result projection through Effect", async () => {
	process.env["SEARCH1API_KEY"] = "search1-secret";
	let request: RequestInit | undefined;
	installFetchMock(async (_input, init) => {
		request = init;
		return new Response(
			JSON.stringify({
				results: [
					{ content: "full text", link: "https://example.com/a", snippet: "  useful   result ", title: "A" },
				],
			}),
		);
	});

	const result = await Effect.runPromise(
		searchWithSearch1API("effect search", {
			domainFilter: ["example.com", "-blocked.example"],
			includeContent: true,
			numResults: 2,
			recencyFilter: "week",
		}),
	);

	expect(new Headers(request?.headers).get("authorization")).toBe("Bearer search1-secret");
	expect(request?.redirect).toBe("error");
	expect(request?.signal).toBeInstanceOf(AbortSignal);
	expect(JSON.parse(String(request?.body))).toEqual({
		query: "effect search",
		max_results: 2,
		crawl_results: 2,
		include_sites: ["example.com"],
		exclude_sites: ["blocked.example"],
		time_range: "week",
	});
	expect(result.results).toEqual([{ title: "A", url: "https://example.com/a", snippet: "useful result" }]);
	expect(result.inlineContent?.[0]?.content).toBe("full text");
});

test("selected standard providers retain partial-success aggregation", async () => {
	const agentDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-web-provider-"));
	roots.push(agentDirectory);
	process.env["PI_CODING_AGENT_DIR"] = agentDirectory;
	process.env["TAVILY_API_KEY"] = "tavily-secret";
	process.env["SERPDIVE_API_KEY"] = "serpdive-secret";
	installFetchMock(async (input) => {
		const url = String(input);
		if (url.includes("tavily")) {
			return Response.json({
				answer: "Tavily answer",
				results: [{ title: "Tavily", url: "https://example.com/tavily", content: "source" }],
			});
		}
		return new Response("temporarily unavailable", { status: 503 });
	});

	const result = await Effect.runPromise(search("effect", { provider: ["tavily", "serpdive"] }));

	expect(result.provider).toBe("all");
	expect(result.providerResponses?.map((response) => response.provider)).toEqual(["tavily"]);
	expect(result.providerErrors?.[0]?.provider).toBe("serpdive");
	expect(result.results[0]?.url).toBe("https://example.com/tavily");
});

test("interrupting a provider Effect aborts its native request", async () => {
	await expectTavilyAbort((signal) => Effect.runPromise(searchWithTavily("cancel me"), { signal }));
});

test("a provider's caller signal still aborts its native request", async () => {
	await expectTavilyAbort((signal) => Effect.runPromise(searchWithTavily("cancel me", { signal })));
});

test("Firecrawl keeps SSRF validation and extraction projection inside the Effect path", async () => {
	process.env["FIRECRAWL_BASE_URL"] = "https://firecrawl.example";
	process.env["FIRECRAWL_API_KEY"] = "firecrawl-secret";
	let request: RequestInit | undefined;
	installFetchMock(async (_input, init) => {
		request = init;
		return Response.json({ success: true, data: { markdown: "# Extracted\n\nBody", metadata: { title: "Page" } } });
	});

	const result = await Effect.runPromise(
		extractWithFirecrawl("https://target.example/page", undefined, {
			lookup: async () => [{ address: "93.184.216.34", family: 4 }],
			ssrf: { allowRanges: [], trustEnvProxy: false },
		}),
	);

	expect(new Headers(request?.headers).get("authorization")).toBe("Bearer firecrawl-secret");
	expect(request?.signal).toBeInstanceOf(AbortSignal);
	expect(result).toEqual({
		url: "https://target.example/page",
		title: "Page",
		content: "# Extracted\n\nBody",
		error: null,
	});
});
