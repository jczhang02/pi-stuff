import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DIRECT_PROVIDER_API_FILES = [
	"anysearch.ts",
	"brave.ts",
	"brightdata.ts",
	"exa.ts",
	"kagi.ts",
	"ollama.ts",
	"openai-search.ts",
	"parallel.ts",
	"perplexity.ts",
	"querit.ts",
	"search1api.ts",
	"searchinfinity.ts",
	"serpbase.ts",
	"serpdive.ts",
	"tavily.ts",
	"tinyfish.ts",
	"xai-search.ts",
] as const;

function count(source: string, fragment: string): number {
	return source.split(fragment).length - 1;
}

test("rejects redirects from every direct provider API request", async () => {
	const runtime = join(import.meta.dir, "../../packages/pi-stuff/src/web/runtime");
	for (const file of DIRECT_PROVIDER_API_FILES) {
		const source = await readFile(join(runtime, file), "utf8");
		const fetchCalls = count(source, "fetch(");
		expect({ file, fetchCalls, redirectErrors: count(source, 'redirect: "error"') }).toEqual({
			file,
			fetchCalls,
			redirectErrors: fetchCalls,
		});
	}
});
