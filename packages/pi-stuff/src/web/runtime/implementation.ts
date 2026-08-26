import { type ImageContent, StringEnum, type TextContent } from "@earendil-works/pi-ai/compat";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { JsonInputObject, JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { readWebConfig, WebConfigError } from "../settings.ts";
import { type FindMode, findContent } from "./content-find.ts";
import { reportWebDiagnostic } from "./diagnostics.ts";
import type { ExtractedContent, ExtractOptions } from "./extract.ts";
import { normalizeFetchContentParams } from "./fetch-params.ts";
import {
	normalizeSearchProviderSelection,
	RESOLVED_SEARCH_PROVIDERS,
	SEARCH_PROVIDERS,
	type SearchProviderSelection,
	search,
} from "./gemini-search.ts";
import type { SearchResult } from "./perplexity.ts";
import {
	clearResults,
	generateId,
	getResult,
	type QueryResultData,
	restoreFromSession,
	type StoredSearchData,
	storeResult,
} from "./storage.ts";
import { getWebSearchConfigPath, isAbortError } from "./utils.ts";

export type PiWebAccessHost = Pick<ExtensionAPI, "appendEntry" | "on" | "registerTool">;

export { configureRuntimeSsrfDefaults, type RuntimeSsrfDefaults } from "./ssrf-protection.ts";

const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();

let extractModulePromise: Promise<typeof import("./extract.ts")> | undefined;
async function fetchAllContent(
	urls: string[],
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent[]> {
	extractModulePromise ??= import("./extract.ts");
	const extractModule = await extractModulePromise;
	return extractModule.fetchAllContent(urls, signal, options);
}

function resolveFindMode(value: JsonInputValue): FindMode {
	return value === "exact" || value === "fuzzy" ? value : "case-insensitive";
}

interface WebSearchConfig {
	anysearchApiKey?: JsonInputValue;
	brightdataApiKey?: JsonInputValue;
	brightdataSerpZone?: JsonInputValue;
	kagiApiKey?: JsonInputValue;
	ollamaApiKey?: JsonInputValue;
	serpbaseApiKey?: JsonInputValue;
	tinyfishApiKey?: JsonInputValue;
	xaiApiKey?: JsonInputValue;
	provider?: JsonInputValue;
	searchProvider?: JsonInputValue;
	webSearch?: {
		enabled?: boolean;
	};
	toolNames?: Partial<ToolNames>;
	ssrf?: {
		/** CIDR ranges exempted from the SSRF guard (e.g. fake-IP proxy ranges). */
		allowRanges?: string[];
		/** Skip local hostname DNS preflight when an HTTP(S)_PROXY env var applies. */
		trustEnvProxy?: boolean;
	};
}

function loadConfig(): WebSearchConfig {
	return readWebConfig() ?? {};
}

type ToolNames = {
	webSearch: string;
	fetchContent: string;
	getSearchContent: string;
};

const DEFAULT_TOOL_NAMES: ToolNames = {
	webSearch: "web_search",
	fetchContent: "fetch_content",
	getSearchContent: "get_search_content",
};
const TOOL_NAME_KEYS = ["webSearch", "fetchContent", "getSearchContent"] as const;
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function searchProviderSchema(description: string) {
	return Type.Union(
		[StringEnum([...SEARCH_PROVIDERS]), Type.Array(StringEnum([...RESOLVED_SEARCH_PROVIDERS]), { minItems: 1 })],
		{ description },
	);
}

function resolveToolNames(config: WebSearchConfig): ToolNames {
	if (
		config.toolNames !== undefined &&
		(!config.toolNames || !isRuntimeObject(config.toolNames) || Array.isArray(config.toolNames))
	) {
		throw new Error(`toolNames in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
	}
	const names = { ...DEFAULT_TOOL_NAMES };
	for (const key of TOOL_NAME_KEYS) {
		const value = config.toolNames?.[key];
		if (value === undefined) continue;
		if (!isRuntimeString(value)) throw new Error(`toolNames.${key} in ${WEB_SEARCH_CONFIG_PATH} must be a string`);
		const trimmed = value.trim();
		if (!TOOL_NAME_PATTERN.test(trimmed)) {
			throw new Error(
				`toolNames.${key} in ${WEB_SEARCH_CONFIG_PATH} must start with a letter and contain only letters, numbers, underscores, or hyphens`,
			);
		}
		names[key] = trimmed;
	}
	const registeredKeys: Array<keyof ToolNames> =
		config.webSearch?.enabled === false
			? ["fetchContent", "getSearchContent"]
			: ["webSearch", "fetchContent", "getSearchContent"];
	const seen = new Map<string, keyof ToolNames>();
	for (const key of registeredKeys) {
		const name = names[key];
		const previous = seen.get(name);
		if (previous) throw new Error(`toolNames.${key} duplicates toolNames.${previous} in ${WEB_SEARCH_CONFIG_PATH}`);
		seen.set(name, key);
	}
	return names;
}

function loadConfigForExtensionInit(): WebSearchConfig {
	try {
		return loadConfig();
	} catch (err) {
		if (!(err instanceof WebConfigError)) throw err;
		reportWebDiagnostic("Web settings were invalid and built-in defaults are active", err.message, {
			key: "invalid-settings",
			notice: true,
			severity: "warning",
		});
		return {};
	}
}

function normalizeProviderInput(value: JsonInputValue, label = "provider"): SearchProviderSelection | undefined {
	if (value === undefined) return undefined;
	return normalizeSearchProviderSelection(value, label);
}

function resolveRequestedProvider(requested: JsonInputValue): SearchProviderSelection {
	const normalizedRequested = normalizeProviderInput(requested);
	if (normalizedRequested && normalizedRequested !== "auto") return normalizedRequested;
	const config = loadConfig();
	return (
		normalizeProviderInput(config.searchProvider ?? config.provider, `provider in ${WEB_SEARCH_CONFIG_PATH}`) ??
		"auto"
	);
}

function normalizeRecencyFilter(value: JsonInputValue): "day" | "week" | "month" | "year" | undefined {
	return value === "day" || value === "week" || value === "month" || value === "year" ? value : undefined;
}

function normalizeQueryList(queryList: JsonInputValue[]): string[] {
	const normalized: string[] = [];
	for (const query of queryList) {
		if (!isRuntimeString(query)) continue;
		const trimmed = query.trim();
		if (trimmed.length > 0) normalized.push(trimmed);
	}
	return normalized;
}

const MAX_INLINE_CONTENT = 30000; // Content returned directly to agent
const DEFAULT_CONTENT_SLICE_LENGTH = MAX_INLINE_CONTENT;
const MAX_CONTENT_SLICE_LENGTH = MAX_INLINE_CONTENT;

function stripThumbnails(results: ExtractedContent[]): ExtractedContent[] {
	return results.map(({ thumbnail: _thumbnail, ...rest }) => rest);
}

interface InitialContentSlice {
	text: string;
	endOffset: number;
	totalBytes: number;
	totalLines: number;
	shownBytes: number;
	shownLines: number;
}

function initialContentSlice(content: string): InitialContentSlice {
	let endOffset = Math.min(content.length, MAX_INLINE_CONTENT);
	if (endOffset < content.length) {
		const lineBreak = content.lastIndexOf("\n", endOffset);
		if (lineBreak >= Math.floor(MAX_INLINE_CONTENT * 0.8)) endOffset = lineBreak + 1;
	}
	const text = content.slice(0, endOffset);
	return {
		text,
		endOffset,
		totalBytes: Buffer.byteLength(content),
		totalLines: content.length === 0 ? 0 : content.split("\n").length,
		shownBytes: Buffer.byteLength(text),
		shownLines: text.length === 0 ? 0 : text.split("\n").length,
	};
}

function normalizeFindQueries(value: string | string[]): string[] {
	const queries = (Array.isArray(value) ? value : [value]).map((query) => query.trim()).filter(Boolean);
	if (queries.length === 0) throw new Error("findText must contain at least one non-empty string");
	return queries;
}

function formatSearchSummary(results: SearchResult[], answer: string): string {
	if (results.length === 0) {
		return answer ? `${answer}\n\n---\n\n**Sources:**\nNo sources returned.` : "No results found.";
	}
	let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
	output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
	return output;
}

function formatFullResults(queryData: QueryResultData): string {
	let output = `## Results for: "${queryData.query}"\n\n`;
	if (queryData.answer) {
		output += `${queryData.answer}\n\n---\n\n`;
	}
	for (const r of queryData.results) {
		output += `### ${r.title}\n${r.url}\n\n`;
	}
	return output;
}

function handleSessionChange(ctx: ExtensionContext): void {
	restoreFromSession(ctx);
}

function installPiWebAccess(pi: PiWebAccessHost): void {
	const initConfig = loadConfigForExtensionInit();
	const toolNames = resolveToolNames(initConfig);
	const storedContentSources =
		initConfig.webSearch?.enabled === false
			? toolNames.fetchContent
			: `${toolNames.webSearch} or ${toolNames.fetchContent}`;
	const searchQueryDescription =
		initConfig.webSearch?.enabled === false
			? "Get content for a stored search query"
			: `Get content for this query (${toolNames.webSearch})`;

	function storeAndPublishSearch(results: QueryResultData[]): string {
		const id = generateId();
		const data: StoredSearchData = {
			id,
			type: "search",
			timestamp: Date.now(),
			queries: results,
		};
		storeResult(id, data);
		pi.appendEntry("web-search-results", data);
		return id;
	}

	function buildSearchReturn(queryList: string[], results: QueryResultData[]): AgentToolResult<JsonInputObject> {
		let output = "";
		for (const { query, answer, results: sources, error } of results) {
			if (queryList.length > 1) output += `## Query: "${query}"\n\n`;
			output += error ? `Error: ${error}\n\n` : `${formatSearchSummary(sources, answer)}\n\n`;
		}
		return {
			content: [{ type: "text", text: output.trim() }],
			details: {
				queries: queryList,
				queryCount: queryList.length,
				successfulQueries: results.filter((result) => !result.error).length,
				totalResults: results.reduce((sum, result) => sum + result.results.length, 0),
				searchId: storeAndPublishSearch(results),
			},
		};
	}

	pi.on("session_start", async (_event, ctx) => handleSessionChange(ctx));
	pi.on("session_tree", async (_event, ctx) => handleSessionChange(ctx));

	pi.on("session_shutdown", clearResults);

	if (initConfig.webSearch?.enabled !== false)
		pi.registerTool({
			name: toolNames.webSearch,
			label: "Web Search",
			description: `Search the web using the configured provider or an explicit provider selection. Returns synthesized answers with source URLs. Use multiple varied queries for broader coverage.`,
			promptSnippet:
				"Use for web research questions. Prefer {queries:[...]} with 2-4 varied angles over a single query for broader coverage. Omit provider unless explicitly overriding the configured default.",
			parameters: Type.Object({
				query: Type.Optional(
					Type.String({
						description:
							"Single search query. For research tasks, prefer 'queries' with multiple varied angles instead.",
					}),
				),
				queries: Type.Optional(
					Type.Array(Type.String(), {
						description:
							"Multiple queries searched in sequence, each returning its own synthesized answer. Prefer this for research — vary phrasing, scope, and angle across 2-4 queries to maximize coverage. Good: ['React vs Vue performance benchmarks 2026', 'React vs Vue developer experience comparison', 'React ecosystem size vs Vue ecosystem']. Bad: ['React vs Vue', 'React vs Vue comparison', 'React vs Vue review'] (too similar, redundant results).",
					}),
				),
				numResults: Type.Optional(Type.Number({ description: "Results per query (default: 5, max: 20)" })),
				recencyFilter: Type.Optional(
					StringEnum(["day", "week", "month", "year"], { description: "Filter by recency" }),
				),
				domainFilter: Type.Optional(
					Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)" }),
				),
				provider: Type.Optional(
					searchProviderSchema(
						"Search provider or non-empty list of providers to search simultaneously; use all to search every eligible provider except AnySearch, xAI, Bright Data, and SerpBase, omit this field to use the configured provider, or use auto when none is configured",
					),
				),
			}),

			async execute(_callId, params, signal, onUpdate, ctx) {
				const rawQueryList: JsonInputValue[] = Array.isArray(params.queries)
					? params.queries
					: params.query !== undefined
						? [params.query]
						: [];
				const queryList = normalizeQueryList(rawQueryList);
				if (queryList.length === 0) {
					return {
						content: [{ type: "text", text: "Error: No query provided. Use 'query' or 'queries' parameter." }],
						details: { error: "No query provided" },
					};
				}

				const searchResults: QueryResultData[] = [];
				const provider = resolveRequestedProvider(params.provider);
				const recencyFilter = normalizeRecencyFilter(params.recencyFilter);
				for (const [index, query] of queryList.entries()) {
					onUpdate?.({
						content: [{ type: "text", text: `Searching ${index + 1}/${queryList.length}: "${query}"...` }],
						details: { phase: "search", progress: index / queryList.length, currentQuery: query },
					});
					try {
						const response = await search(query, {
							provider,
							numResults: params.numResults,
							recencyFilter,
							domainFilter: params.domainFilter,
							signal,
							extensionContext: ctx,
						});
						searchResults.push({
							query,
							answer: response.answer,
							results: response.results,
							error: null,
							provider: response.provider,
						});
					} catch (err) {
						if (signal?.aborted || isAbortError(err)) throw err;
						searchResults.push({
							query,
							answer: "",
							results: [],
							error: err instanceof Error ? err.message : String(err),
							provider: Array.isArray(provider) ? "all" : provider,
						});
					}
				}
				return buildSearchReturn(queryList, searchResults);
			},
		});
	pi.registerTool({
		name: toolNames.fetchContent,
		label: "Fetch Content",
		description: `Fetch public HTTP(S) URL(s) as readable markdown or exact raw text. Direct images return resized image content, PDFs return temporary Markdown artifacts, and GitHub URLs use bounded API reads. Full content is stored for retrieval with ${toolNames.getSearchContent}.`,
		promptSnippet:
			"Read public HTTP(S) pages, direct images, GitHub URLs, and PDFs. Use raw only for exact textual response bodies.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single HTTP(S) URL to fetch" })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple HTTP(S) URLs to fetch in parallel" })),
			mode: Type.Optional(
				StringEnum(["readable", "raw"], {
					description: "Fetch mode: readable (default extraction) or raw (exact textual HTTP response body).",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate): Promise<AgentToolResult<JsonInputObject>> {
			let normalized: ReturnType<typeof normalizeFetchContentParams>;
			try {
				normalized = normalizeFetchContentParams(params);
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Error: ${error}` }], details: { error } };
			}
			const { urlList, options } = normalized;
			if (urlList.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No URL provided." }],
					details: { error: "No URL provided" },
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)...` }],
				details: { phase: "fetch", progress: 0 },
			});
			const results = await fetchAllContent(urlList, signal, options);
			const successful = results.filter((result) => !result.error).length;
			const totalChars = results.reduce((sum, result) => sum + result.content.length, 0);
			const responseId = generateId();
			const data: StoredSearchData = {
				id: responseId,
				type: "fetch",
				timestamp: Date.now(),
				urls: stripThumbnails(results),
			};
			storeResult(responseId, data);
			pi.appendEntry("web-search-results", data);

			if (urlList.length === 1) {
				const result = results[0];
				if (!result) {
					return {
						content: [{ type: "text", text: "Error: Fetch returned no result." }],
						details: { urls: urlList, urlCount: 1, successful: 0, responseId },
					};
				}
				if (result.error) {
					return {
						content: [{ type: "text", text: `Error: ${result.error}` }],
						details: { urls: urlList, urlCount: 1, successful: 0, error: result.error, responseId },
					};
				}

				const slice = initialContentSlice(result.content);
				const truncated = slice.endOffset < result.content.length;
				let output = slice.text;
				if (truncated) {
					output +=
						`\n\n---\nShowing ${slice.endOffset} of ${result.content.length} chars, ${slice.shownBytes} of ${slice.totalBytes} bytes, and ${slice.shownLines} of ${slice.totalLines} lines. ` +
						`Use ${toolNames.getSearchContent}({ responseId: "${responseId}", urlIndex: 0, offset: ${slice.endOffset} }) for the next slice.`;
				}
				const content: Array<TextContent | ImageContent> = [];
				if (result.thumbnail)
					content.push({ type: "image", data: result.thumbnail.data, mimeType: result.thumbnail.mimeType });
				content.push({ type: "text", text: output });
				return {
					content,
					details: {
						urls: urlList,
						urlCount: 1,
						successful: 1,
						totalChars: result.content.length,
						title: result.title,
						responseId,
						truncated,
						hasImage: Boolean(result.thumbnail),
						imageCount: result.thumbnail ? 1 : 0,
						mode: options.mode ?? "readable",
						mimeType: result.mimeType,
						status: result.status,
						totalBytes: slice.totalBytes,
						totalLines: slice.totalLines,
						shownBytes: slice.shownBytes,
						shownLines: slice.shownLines,
					},
				};
			}

			let output = "## Fetched URLs\n\n";
			for (const { url, title, content, error } of results) {
				output += error ? `- ${url}: Error - ${error}\n` : `- ${title || url} (${content.length} chars)\n`;
			}
			output += `\n---\nUse ${toolNames.getSearchContent}({ responseId: "${responseId}", urlIndex: 0 }) to retrieve bounded content slices.`;
			return {
				content: [{ type: "text", text: output }],
				details: { urls: urlList, urlCount: urlList.length, successful, totalChars, responseId },
			};
		},
	});

	pi.registerTool({
		name: toolNames.getSearchContent,
		label: "Get Search Content",
		description: `Retrieve bounded content slices or find matching passages in a previous ${storedContentSources} call.`,
		promptSnippet: `Use after ${storedContentSources} to retrieve stored content via responseId. Use findText to locate passages without paging through the full content.`,
		parameters: Type.Object({
			responseId: Type.String({ description: `The responseId from ${storedContentSources}` }),
			query: Type.Optional(Type.String({ description: searchQueryDescription })),
			queryIndex: Type.Optional(Type.Number({ description: "Get content for query at index" })),
			url: Type.Optional(Type.String({ description: "Get content for this URL" })),
			urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" })),
			offset: Type.Optional(
				Type.Number({ description: "Character offset for fetched URL content slices (default 0)" }),
			),
			limit: Type.Optional(
				Type.Number({
					description: `Maximum characters to return for fetched URL content slices (default/max ${MAX_CONTENT_SLICE_LENGTH})`,
				}),
			),
			findText: Type.Optional(
				Type.Union(
					[
						Type.String({ minLength: 1, maxLength: 500 }),
						Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 10 }),
					],
					{ description: "Text or texts to find in the selected stored content." },
				),
			),
			findMode: Type.Optional(
				StringEnum(["exact", "case-insensitive", "fuzzy"], {
					description: "Matching mode for findText (default: case-insensitive).",
				}),
			),
		}),

		async execute(_toolCallId, params): Promise<AgentToolResult<JsonInputObject>> {
			if (params.findText !== undefined && (params.offset !== undefined || params.limit !== undefined)) {
				return {
					content: [{ type: "text", text: "findText cannot be combined with offset or limit" }],
					details: { error: "Incompatible find options" },
				};
			}
			if (params.findMode !== undefined && params.findText === undefined) {
				return {
					content: [{ type: "text", text: "findMode requires findText" }],
					details: { error: "findMode requires findText" },
				};
			}
			const data = getResult(params.responseId);
			if (!data) {
				return {
					content: [{ type: "text", text: `Error: No stored results for "${params.responseId}"` }],
					details: { error: "Not found", responseId: params.responseId },
				};
			}

			if (data.type === "search" && data.queries) {
				let queryData: QueryResultData | undefined;

				if (params.query !== undefined) {
					queryData = data.queries.find((q) => q.query === params.query);
					if (!queryData) {
						const available = data.queries.map((q) => `"${q.query}"`).join(", ");
						return {
							content: [{ type: "text", text: `Query "${params.query}" not found. Available: ${available}` }],
							details: { error: "Query not found" },
						};
					}
				} else if (params.queryIndex !== undefined) {
					queryData = data.queries[params.queryIndex];
					if (!queryData) {
						return {
							content: [
								{
									type: "text",
									text: `Index ${params.queryIndex} out of range (0-${data.queries.length - 1})`,
								},
							],
							details: { error: "Index out of range" },
						};
					}
				} else {
					const available = data.queries.map((q, i) => `${i}: "${q.query}"`).join(", ");
					return {
						content: [{ type: "text", text: `Specify query or queryIndex. Available: ${available}` }],
						details: { error: "No query specified" },
					};
				}

				if (queryData.error) {
					return {
						content: [{ type: "text", text: `Error for "${queryData.query}": ${queryData.error}` }],
						details: { error: queryData.error, query: queryData.query },
					};
				}

				const fullResults = formatFullResults(queryData);
				if (params.findText !== undefined) {
					try {
						const findMode = resolveFindMode(params.findMode);
						const found = findContent(fullResults, normalizeFindQueries(params.findText), findMode);
						const { text, ...findDetails } = found;
						return {
							content: [{ type: "text", text }],
							details: {
								query: queryData.query,
								resultCount: queryData.results.length,
								findMode,
								...findDetails,
							},
						};
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						return { content: [{ type: "text", text: error }], details: { error, query: queryData.query } };
					}
				}

				return {
					content: [{ type: "text", text: fullResults }],
					details: { query: queryData.query, resultCount: queryData.results.length },
				};
			}

			if (data.type === "fetch" && data.urls) {
				let urlData: ExtractedContent | undefined;
				let selectedUrlIndex = -1;

				if (params.url !== undefined) {
					selectedUrlIndex = data.urls.findIndex((u) => u.url === params.url);
					urlData = data.urls[selectedUrlIndex];
					if (!urlData) {
						const available = data.urls.map((u) => u.url).join("\n  ");
						return {
							content: [{ type: "text", text: `URL not found. Available:\n  ${available}` }],
							details: { error: "URL not found" },
						};
					}
				} else if (params.urlIndex !== undefined) {
					selectedUrlIndex = params.urlIndex;
					urlData = data.urls[selectedUrlIndex];
					if (!urlData) {
						return {
							content: [
								{ type: "text", text: `Index ${params.urlIndex} out of range (0-${data.urls.length - 1})` },
							],
							details: { error: "Index out of range" },
						};
					}
				} else {
					const available = data.urls.map((u, i) => `${i}: ${u.url}`).join("\n  ");
					return {
						content: [{ type: "text", text: `Specify url or urlIndex. Available:\n  ${available}` }],
						details: { error: "No URL specified" },
					};
				}

				if (urlData.error) {
					return {
						content: [{ type: "text", text: `Error for ${urlData.url}: ${urlData.error}` }],
						details: { error: urlData.error, url: urlData.url },
					};
				}

				if (params.findText !== undefined) {
					try {
						const findMode = resolveFindMode(params.findMode);
						const found = findContent(urlData.content, normalizeFindQueries(params.findText), findMode);
						const { text, ...findDetails } = found;
						return {
							content: [{ type: "text", text: `# ${urlData.title || urlData.url}\n\n${text}` }],
							details: {
								url: urlData.url,
								title: urlData.title,
								contentLength: urlData.content.length,
								findMode,
								...findDetails,
							},
						};
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						return { content: [{ type: "text", text: error }], details: { error, url: urlData.url } };
					}
				}

				const offset = params.offset ?? 0;
				const limit = params.limit ?? DEFAULT_CONTENT_SLICE_LENGTH;
				if (!Number.isInteger(offset) || offset < 0) {
					return {
						content: [{ type: "text", text: "offset must be a non-negative integer" }],
						details: { error: "Invalid offset", offset },
					};
				}
				if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_CONTENT_SLICE_LENGTH) {
					return {
						content: [{ type: "text", text: `limit must be an integer from 1 to ${MAX_CONTENT_SLICE_LENGTH}` }],
						details: { error: "Invalid limit", limit, maxLimit: MAX_CONTENT_SLICE_LENGTH },
					};
				}
				if (offset > urlData.content.length) {
					return {
						content: [{ type: "text", text: `offset ${offset} is out of range (0-${urlData.content.length})` }],
						details: { error: "Offset out of range", offset, contentLength: urlData.content.length },
					};
				}

				const endOffset = Math.min(offset + limit, urlData.content.length);
				const contentSlice = urlData.content.slice(offset, endOffset);
				const hasMore = endOffset < urlData.content.length;
				let text = `# ${urlData.title || urlData.url}\n\n${contentSlice}`;
				if (hasMore || offset > 0) {
					text += `\n\n---\nShowing chars ${offset}-${endOffset} of ${urlData.content.length}.`;
					if (hasMore) {
						text += ` Use ${toolNames.getSearchContent}({ responseId: "${params.responseId}", urlIndex: ${selectedUrlIndex}, offset: ${endOffset}, limit: ${limit} }) for the next slice.`;
					}
				}

				return {
					content: [{ type: "text", text }],
					details: {
						url: urlData.url,
						title: urlData.title,
						contentLength: urlData.content.length,
						offset,
						limit,
						returnedChars: contentSlice.length,
						nextOffset: hasMore ? endOffset : null,
						truncated: hasMore,
					},
				};
			}

			return {
				content: [{ type: "text", text: "Invalid stored data format" }],
				details: { error: "Invalid data" },
			};
		},
	});
}

export function createPiWebAccess() {
	return function piWebAccess(pi: PiWebAccessHost): void {
		installPiWebAccess(pi);
	};
}

export default createPiWebAccess();
