import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { registerSuiteOwnedTool, type SuiteToolRegistrationHost } from "../tool-display/index.js";
import { FakeIpCompatibility } from "./fake-ip.js";
import { WEB_CONTENT_PRESENTATION, WEB_FETCH_PRESENTATION, WEB_SEARCH_PRESENTATION } from "./presentation.js";
import piWebAccess, { type PiWebAccessHost } from "./runtime/index.js";
import { WEB_CONTENT_PARAMETERS, WEB_FETCH_PARAMETERS, WEB_SEARCH_PARAMETERS } from "./tool-contracts.js";
import { validateWebFetchInput } from "./url-policy.js";

type CapturedTool = ToolDefinition<TSchema, unknown, unknown>;
type SharedToolFields = Pick<CapturedTool, "label" | "name"> &
	Partial<Pick<CapturedTool, "constrainedSampling" | "executionMode">>;
export type WebAdapterHost = SuiteToolRegistrationHost;
export type WebCapabilityHost = WebAdapterHost & PiWebAccessHost;

export interface WebAdapterOptions {
	readonly fakeIpCompatibility?: Pick<FakeIpCompatibility, "prepare">;
}

function errorResult(error: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: `Error: ${error}` }],
		details: { error },
	};
}

function sharedToolFields(upstream: CapturedTool) {
	const fields: SharedToolFields = {
		label: upstream.label,
		name: upstream.name,
	};
	if (upstream.constrainedSampling !== undefined) fields.constrainedSampling = upstream.constrainedSampling;
	if (upstream.executionMode !== undefined) fields.executionMode = upstream.executionMode;
	return fields;
}

function registerSearch(pi: SuiteToolRegistrationHost, upstream: CapturedTool): void {
	const tool: ToolDefinition<typeof WEB_SEARCH_PARAMETERS, unknown> = {
		...sharedToolFields(upstream),
		description:
			"Search the web with one to four focused queries. Returns synthesized answers and source URLs. Provider may be selected explicitly; omit it to use configured routing.",
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			upstream.execute(toolCallId, params, signal, onUpdate, ctx),
		parameters: WEB_SEARCH_PARAMETERS,
		promptSnippet: "Search current public web sources; use 2-4 distinct queries when multiple angles matter.",
	};
	registerSuiteOwnedTool(pi, tool, WEB_SEARCH_PRESENTATION);
}

function registerFetch(
	pi: SuiteToolRegistrationHost,
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

function registerContinuation(pi: SuiteToolRegistrationHost, upstream: CapturedTool): void {
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
	pi: SuiteToolRegistrationHost,
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
export function createWebAdapterApi<Host extends WebAdapterHost>(pi: Host, options: WebAdapterOptions = {}): Host {
	const fakeIpCompatibility = options.fakeIpCompatibility ?? new FakeIpCompatibility();
	// SAFETY: the fork calls registerTool with ToolDefinition values; this facade only narrows which labels are installed.
	const registerTool = ((tool: CapturedTool) =>
		registerSelectedTool(pi, tool, fakeIpCompatibility)) as ExtensionAPI["registerTool"];
	return new Proxy(pi, {
		get(target, property) {
			if (property === "registerTool") return registerTool;
			return readHostProxyProperty(target, property);
		},
	});
}

/** Installation performs configuration reads only; all external work stays Tool-triggered. */
export function installWebCapability(pi: WebCapabilityHost): void {
	piWebAccess(createWebAdapterApi(pi));
}
