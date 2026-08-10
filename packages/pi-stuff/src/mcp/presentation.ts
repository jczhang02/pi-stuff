import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { type SuiteToolPresentation, singleActivity } from "../tool-display/index.js";

type Arguments = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function target(args: Readonly<Arguments>): string {
	const tool = typeof args["tool"] === "string" ? args["tool"] : "";
	const server = typeof args["server"] === "string" ? args["server"] : "";
	if (tool) return server ? `${server}:${tool}` : tool;
	if (typeof args["connect"] === "string") return `connect ${args["connect"]}`;
	if (typeof args["describe"] === "string") return `describe ${args["describe"]}`;
	if (typeof args["search"] === "string") return `search ${args["search"]}`;
	return server || "status";
}

function resultIsError(_args: Readonly<Arguments>, result: AgentToolResult<unknown>): boolean {
	return typeof record(result.details)["error"] === "string";
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function summarize(_args: Readonly<Arguments>, result: AgentToolResult<unknown>): string {
	const details = record(result.details);
	if (typeof details["error"] === "string") return "failed";
	const mode = typeof details["mode"] === "string" ? details["mode"] : "";
	const total = count(details["count"]);
	const matches = Array.isArray(details["matches"]) ? details["matches"].length : undefined;
	const truncated = record(details["outputGuard"])["truncated"] === true;
	let summary = "done";
	if (mode === "search") summary = `${String(matches ?? total ?? 0)} matches`;
	else if (mode === "list") summary = `${String(total ?? 0)} tools`;
	else if (mode === "connect") summary = "connected";
	else if (mode === "status") summary = "status";
	return truncated ? `${summary} · clipped` : summary;
}

function issueSummary(_args: Readonly<Arguments>, result: AgentToolResult<unknown>, state: string): string {
	const details = record(result.details);
	if (typeof details["error"] === "string" && details["error"].trim()) return details["error"].trim();
	for (const item of result.content) {
		if (item.type === "text" && item.text.trim()) return item.text.trim().split(/\r?\n/u)[0] ?? state;
	}
	return state;
}

export const MCP_PRESENTATION: SuiteToolPresentation<Arguments, unknown> = {
	activity: {
		categories: ["connect-mcp", "invoke-mcp", "search-mcp"],
		classify: ({ args }) => {
			const label = target(args);
			if (typeof args["connect"] === "string") {
				return singleActivity("connect-mcp", { count: 1, target: label });
			}
			if (args["tool"] !== undefined) {
				return singleActivity("invoke-mcp", { count: 1, target: label });
			}
			return singleActivity("search-mcp", { count: 1, target: label });
		},
		summarizeIssue: issueSummary,
	},
	label: "MCP",
	resultIsError,
	runningSummary: "working",
	summarize,
	target,
};
