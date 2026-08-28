import { expect, test } from "bun:test";
import { extractContent } from "../../packages/pi-stuff/src/web/runtime/extract.ts";

test("bounds Jina reader responses without following redirects", async () => {
	const originalFetch = globalThis.fetch;
	const abortController = new AbortController();
	let cancelled = false;
	let jinaRedirect: string | undefined;
	let jinaRequests = 0;
	let pulls = 0;
	const prefix = "Markdown Content:\n# Title\n";
	const firstChunk = new TextEncoder().encode(`${prefix}${"a".repeat(5 * 1024 * 1024 - prefix.length)}`);

	// SAFETY: This test exercises only fetch's request/response call signature; preconnect is never used.
	const mockFetch = (async (input, init) => {
		if (!String(input).startsWith("https://r.jina.ai/")) return new Response(null, { status: 503 });
		jinaRedirect = init?.redirect;
		jinaRequests += 1;
		return new Response(
			new ReadableStream<Uint8Array>(
				{
					cancel() {
						cancelled = true;
						abortController.abort();
					},
					pull(controller) {
						pulls += 1;
						if (pulls === 1) controller.enqueue(firstChunk);
						else if (pulls === 2) controller.enqueue(new Uint8Array([1]));
						else controller.close();
					},
				},
				{ highWaterMark: 0 },
			),
			{ headers: { "content-type": "text/markdown" } },
		);
	}) as typeof fetch;
	globalThis.fetch = mockFetch;

	try {
		const result = await extractContent("https://example.com/article", abortController.signal, {
			lookup: async () => [{ address: "93.184.216.34", family: 4 }],
		});
		expect(jinaRequests).toBe(1);
		expect(jinaRedirect).toBe("error");
		expect(cancelled).toBe(true);
		expect(result.error).toBe("Aborted");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
