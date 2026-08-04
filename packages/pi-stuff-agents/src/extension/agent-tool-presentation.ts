import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SuiteToolPresentation } from "@jczhang02/pi-stuff-tools";
import { resolveDisplayDescription } from "../shared/display-description.ts";
import type { Details } from "../shared/types.ts";
import type { PublicAgentParams } from "./product-executor.ts";

type PresentationParams = Record<string, unknown>;
const PRESENTATION_PREVIEW_CODE_UNITS = 8 * 1024;

function firstText(result: AgentToolResult<Details>): string {
	for (const entry of result.content) {
		if (entry.type !== "text") continue;
		const preview = entry.text.slice(0, PRESENTATION_PREVIEW_CODE_UNITS).trim();
		if (preview) return preview;
	}
	return "";
}

function label(params: PublicAgentParams): string {
	if (params.action) return `Agent ${params.action}`;
	if (params.tasks?.length) return `Agents ×${String(params.tasks.length)}`;
	return "Agent";
}

function target(params: PublicAgentParams): string {
	if (params.action) return params.id ?? "";
	if (params.tasks?.length)
		return params.tasks
			.slice(0, 32)
			.map((task) => `${task.agent} · ${resolveDisplayDescription(task.description, task.task)}`)
			.filter(Boolean)
			.join(", ");
	return [params.agent, params.task ? resolveDisplayDescription(params.description, params.task) : undefined]
		.filter(Boolean)
		.join(" · ");
}

/** One shared row grammar for root and nested public Agent tools. */
export function createAgentToolPresentation(): SuiteToolPresentation<PresentationParams, Details> {
	return {
		label: (params) => label(params as PublicAgentParams),
		runningSummary: "working",
		summarize: (_params, result, state) => {
			if (state === "success") return "done";
			if (state === "cancelled") return "cancelled";
			if (state === "rejected") return "rejected";
			return firstText(result) || "failed";
		},
		target: (params) => target(params as PublicAgentParams),
	};
}
