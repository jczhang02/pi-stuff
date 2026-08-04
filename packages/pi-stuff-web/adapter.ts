import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerSuiteOwnedTool } from "@jczhang02/pi-stuff-tools";
import { createPiWebAccess } from "@jczhang02/pi-web-access";
import { type TSchema, Type } from "typebox";
import { FakeIpCompatibility } from "./fake-ip.js";
import { WEB_CONTENT_PRESENTATION, WEB_FETCH_PRESENTATION, WEB_SEARCH_PRESENTATION } from "./presentation.js";
import { validateWebFetchInput } from "./url-policy.js";

type CapturedTool = ToolDefinition<TSchema, unknown, unknown>;

export interface WebAdapterOptions {
	readonly fakeIpCompatibility?: Pick<FakeIpCompatibility, "prepare">;
}

const piWebAccess = createPiWebAccess({
	githubClone: false,
	youtubeSpecialization: false,
});

const WEB_SEARCH_PARAMETERS = Type.Object({
	query: Type.Optional(Type.String({ maxLength: 1_000, minLength: 1 })),
	queries: Type.Optional(Type.Array(Type.String({ maxLength: 1_000, minLength: 1 }), { maxItems: 4, minItems: 1 })),
	numResults: Type.Optional(Type.Integer({ maximum: 20, minimum: 1 })),
	recencyFilter: Type.Optional(
		Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")]),
	),
	domainFilter: Type.Optional(Type.Array(Type.String({ maxLength: 253, minLength: 1 }), { maxItems: 20 })),
	provider: Type.Optional(
		Type.Union([
			Type.String({ maxLength: 64, minLength: 1 }),
			Type.Array(Type.String({ maxLength: 64, minLength: 1 }), { maxItems: 8, minItems: 1 }),
		]),
	),
});

const WEB_FETCH_PARAMETERS = Type.Object({
	url: Type.Optional(Type.String({ maxLength: 8_192, minLength: 1 })),
	urls: Type.Optional(Type.Array(Type.String({ maxLength: 8_192, minLength: 1 }), { maxItems: 10, minItems: 1 })),
	mode: Type.Optional(Type.Union([Type.Literal("readable"), Type.Literal("raw")])),
});

const WEB_CONTENT_PARAMETERS = Type.Object({
	responseId: Type.String({ maxLength: 256, minLength: 1 }),
	query: Type.Optional(Type.String({ maxLength: 1_000, minLength: 1 })),
	queryIndex: Type.Optional(Type.Integer({ maximum: 100, minimum: 0 })),
	url: Type.Optional(Type.String({ maxLength: 8_192, minLength: 1 })),
	urlIndex: Type.Optional(Type.Integer({ maximum: 100, minimum: 0 })),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
	limit: Type.Optional(Type.Integer({ maximum: 30_000, minimum: 1 })),
	findText: Type.Optional(
		Type.Union([
			Type.String({ maxLength: 500, minLength: 1 }),
			Type.Array(Type.String({ maxLength: 500, minLength: 1 }), { maxItems: 10, minItems: 1 }),
		]),
	),
	findMode: Type.Optional(
		Type.Union([Type.Literal("exact"), Type.Literal("case-insensitive"), Type.Literal("fuzzy")]),
	),
});

function errorResult(error: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: `Error: ${error}` }],
		details: { error },
	};
}

function sharedToolFields(upstream: CapturedTool) {
	return {
		...(upstream.constrainedSampling !== undefined ? { constrainedSampling: upstream.constrainedSampling } : {}),
		...(upstream.executionMode !== undefined ? { executionMode: upstream.executionMode } : {}),
		label: upstream.label,
		name: upstream.name,
	};
}

function registerSearch(pi: ExtensionAPI, upstream: CapturedTool): void {
	const tool: ToolDefinition<typeof WEB_SEARCH_PARAMETERS, unknown> = {
		...sharedToolFields(upstream),
		description:
			"Search the web with one to four focused queries. Returns synthesized answers and source URLs. Provider may be selected explicitly; omit it to use configured routing.",
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			upstream.execute(toolCallId, { ...params, includeContent: false, workflow: "none" }, signal, onUpdate, ctx),
		parameters: WEB_SEARCH_PARAMETERS,
		promptSnippet: "Search current public web sources; use 2-4 distinct queries when multiple angles matter.",
	};
	registerSuiteOwnedTool(pi, tool, WEB_SEARCH_PRESENTATION);
}

function registerFetch(
	pi: ExtensionAPI,
	upstream: CapturedTool,
	fakeIpCompatibility: Pick<FakeIpCompatibility, "prepare">,
): void {
	const tool: ToolDefinition<typeof WEB_FETCH_PARAMETERS, unknown> = {
		...sharedToolFields(upstream),
		description:
			"Read one or more public HTTP(S) pages as bounded text. PDFs are converted to a temporary Markdown file whose path is returned for the read Tool. Use raw only for exact textual HTTP response bodies.",
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const validation = validateWebFetchInput(params);
			if (!validation.ok) return errorResult(validation.error);
			await fakeIpCompatibility.prepare(validation.input);
			return upstream.execute(toolCallId, validation.input, signal, onUpdate, ctx);
		},
		parameters: WEB_FETCH_PARAMETERS,
		promptSnippet:
			"Read public HTTP(S) pages and PDFs; use read on a returned PDF Markdown path, or get_search_content for later page slices.",
	};
	registerSuiteOwnedTool(pi, tool, WEB_FETCH_PRESENTATION);
}

function registerContinuation(pi: ExtensionAPI, upstream: CapturedTool): void {
	const tool: ToolDefinition<typeof WEB_CONTENT_PARAMETERS, unknown> = {
		...sharedToolFields(upstream),
		description: "Retrieve one bounded slice or matching passage from a previous web search or document read result.",
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			upstream.execute(toolCallId, params, signal, onUpdate, ctx),
		parameters: WEB_CONTENT_PARAMETERS,
		promptSnippet: "Continue a previous web result by responseId; prefer findText over manual paging.",
	};
	registerSuiteOwnedTool(pi, tool, WEB_CONTENT_PRESENTATION);
}

function registerSelectedTool(
	pi: ExtensionAPI,
	tool: CapturedTool,
	fakeIpCompatibility: Pick<FakeIpCompatibility, "prepare">,
): void {
	switch (tool.label) {
		case "Web Search":
			registerSearch(pi, tool);
			break;
		case "Fetch Content":
			registerFetch(pi, tool, fakeIpCompatibility);
			break;
		case "Get Search Content":
			registerContinuation(pi, tool);
			break;
		default:
			// Source Check and future broad surfaces are intentionally not Suite Tools.
			break;
	}
}

/** Build the narrow host facade supplied to the pinned fork. */
export function createWebAdapterApi(pi: ExtensionAPI, options: WebAdapterOptions = {}): ExtensionAPI {
	const fakeIpCompatibility = options.fakeIpCompatibility ?? new FakeIpCompatibility();
	const registerTool = ((tool: CapturedTool) =>
		registerSelectedTool(pi, tool, fakeIpCompatibility)) as ExtensionAPI["registerTool"];
	const ignoreCommand = (() => undefined) as ExtensionAPI["registerCommand"];
	const ignoreShortcut = (() => undefined) as ExtensionAPI["registerShortcut"];
	return new Proxy(pi, {
		get(target, property, receiver) {
			if (property === "registerTool") return registerTool;
			if (property === "registerCommand") return ignoreCommand;
			if (property === "registerShortcut") return ignoreShortcut;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
}

/** Installation performs configuration reads only; all external work stays Tool-triggered. */
export function installWebCapability(pi: ExtensionAPI): void {
	piWebAccess(createWebAdapterApi(pi));
}
