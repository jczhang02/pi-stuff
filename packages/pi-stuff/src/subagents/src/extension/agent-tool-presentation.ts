import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	activityKey,
	boundTerminalLine,
	type SuiteToolPresentation,
	singleActivity,
} from "../../../tool-display/index.js";
import { boundedTerminalLine, resolveDisplayDescription } from "../shared/display-description.ts";
import type { Details } from "../shared/types.ts";
import type { PublicAgentParams } from "./product-executor.ts";

type PresentationParams = Record<string, unknown>;
const PRESENTATION_PREVIEW_WIDTH = 160;
const AGENT_ACTION_PRESENTATION = {
	resume: { category: "resume-agent", summary: "resumed" },
	status: { category: "check-agent", summary: "checked" },
	steer: { category: "steer-agent", summary: "sent" },
	stop: { category: "stop-agent", summary: "stopped" },
} as const;

function firstText(result: AgentToolResult<Details>): string {
	for (const entry of result.content) {
		if (entry.type !== "text") continue;
		const preview = boundTerminalLine(entry.text, PRESENTATION_PREVIEW_WIDTH);
		if (preview) return preview;
	}
	return "";
}

function action(params: PublicAgentParams): keyof typeof AGENT_ACTION_PRESENTATION | undefined {
	return typeof params.action === "string" && Object.hasOwn(AGENT_ACTION_PRESENTATION, params.action)
		? params.action
		: undefined;
}

function launchTarget(agent: unknown, description: unknown, task: unknown): string {
	const safeAgent = boundedTerminalLine(agent);
	const safeTask = boundedTerminalLine(description) || boundedTerminalLine(task);
	return [safeAgent, safeTask ? resolveDisplayDescription(description, task) : ""].filter(Boolean).join(" · ");
}

function requestedLaunchCount(params: PublicAgentParams): number {
	if (Array.isArray(params.tasks)) {
		return params.tasks.filter((task) => boundedTerminalLine(task?.agent) && boundedTerminalLine(task?.task)).length;
	}
	return boundedTerminalLine(params.agent) && boundedTerminalLine(params.task) ? 1 : 0;
}

function launchedCount(params: PublicAgentParams, result?: AgentToolResult<Details>): number {
	if (!result) return 0;
	if (params.foreground === true) return Array.isArray(result.details?.results) ? result.details.results.length : 0;
	return typeof result.details?.asyncId === "string" && result.details.asyncId.trim()
		? requestedLaunchCount(params)
		: 0;
}

function label(params: PublicAgentParams): string {
	const operation = action(params);
	if (operation) return `Agent ${operation}`;
	return Array.isArray(params.tasks) ? "Agents" : "Agent";
}

function target(params: PublicAgentParams): string {
	if (action(params)) return boundedTerminalLine(params.id);
	if (Array.isArray(params.tasks) && params.tasks.length > 0)
		return params.tasks
			.slice(0, 32)
			.map((task) => launchTarget(task?.agent, task?.description, task?.task))
			.filter(Boolean)
			.join(", ");
	return launchTarget(params.agent, params.description, params.task);
}

function successSummary(params: PublicAgentParams, result: AgentToolResult<Details>): string {
	const operation = action(params);
	if (operation) return AGENT_ACTION_PRESENTATION[operation].summary;
	if (params.foreground === true) return "finished";
	const count = launchedCount(params, result);
	return count > 1 ? `${String(count)} launched` : "launched";
}

/** One shared row grammar for root and nested public Agent tools. */
export function createAgentToolPresentation(): SuiteToolPresentation<PresentationParams, Details> {
	return {
		activity: {
			categories: ["check-agent", "launch-agent", "resume-agent", "run-agent", "steer-agent", "stop-agent"],
			classify: ({ args, result }) => {
				const params = args as PublicAgentParams;
				const operation = action(params);
				if (operation) {
					return singleActivity(AGENT_ACTION_PRESENTATION[operation].category, {
						key: activityKey(params.id, operation),
						target: target(params),
					});
				}
				const count = launchedCount(params, result);
				if (count === 0) return [];
				const category = params.foreground === true ? "run-agent" : "launch-agent";
				return singleActivity(category, { count, target: target(params) });
			},
			summarizeIssue: (_args, result, state) => firstText(result) || state,
		},
		label: (params) => label(params as PublicAgentParams),
		resultIsError: (params, result) => {
			const publicParams = params as PublicAgentParams;
			if (Reflect.get(result, "isError") === true) return true;
			return action(publicParams) ? false : launchedCount(publicParams, result) === 0;
		},
		runningSummary: "working",
		summarize: (params, result, state) => {
			if (state === "success") return successSummary(params as PublicAgentParams, result);
			if (state === "cancelled") return "cancelled";
			if (state === "rejected") return "rejected";
			return firstText(result) || "failed";
		},
		target: (params) => target(params as PublicAgentParams),
	};
}
