import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { SuiteToolPresentation } from "@jczhang02/pi-stuff-tools";

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

export const MCP_PRESENTATION: SuiteToolPresentation<Arguments, unknown> = {
	label: "MCP",
	resultIsError,
	runningSummary: "working",
	summarize,
	target,
};
