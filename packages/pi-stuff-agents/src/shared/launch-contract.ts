import { createHash } from "node:crypto";
import * as fs from "node:fs";
import type { AgentConfig } from "../agents/agents.ts";

export const AGENT_DEFINITION_PROJECTION_VERSION = 2 as const;
export const LAUNCH_BINDING_PROJECTION_VERSION = 2 as const;

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

function fileDigest(filePath: string): string | undefined {
	try {
		return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
	} catch {
		return undefined;
	}
}

/** Public-safe, deterministic evidence for the parsed launch-affecting agent definition. */
export function projectAgentDefinition(agent: AgentConfig): Record<string, unknown> {
	return {
		version: AGENT_DEFINITION_PROJECTION_VERSION,
		name: agent.name,
		localName: agent.localName,
		packageName: agent.packageName,
		filePath: agent.filePath,
		fileContentDigest: fileDigest(agent.filePath),
		systemPrompt: agent.systemPrompt,
		systemPromptMode: agent.systemPromptMode,
		inheritProjectContext: agent.inheritProjectContext,
		inheritSkills: agent.inheritSkills,
		model: agent.model,
		fallbackModels: agent.fallbackModels,
		thinking: agent.thinking,
		tools: agent.tools,
		mcpDirectTools: agent.mcpDirectTools,
		extensions: agent.extensions,
		subagentOnlyExtensions: agent.subagentOnlyExtensions,
		skills: agent.skills,
		skillPath: agent.skillPath,
		defaultTurnBudget: agent.defaultTurnBudget,
		maxSubagentDepth: agent.maxSubagentDepth,
		toolBudget: agent.toolBudget,
	};
}

export function agentDefinitionDigest(agent: AgentConfig): string {
	return sha256(projectAgentDefinition(agent));
}

export interface LaunchBindingInput {
	definitionDigest: string;
	/** Caller task; runtime acceptance/output task annotations are explicitly outside the preflight-known subset. */
	task?: string;
	modelCandidates?: string[];
	thinking?: string;
	systemPrompt?: string | null;
	systemPromptMode?: AgentConfig["systemPromptMode"];
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	skills?: string[];
	tools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	mcpDirectTools?: string[];
	turnBudget?: AgentConfig["defaultTurnBudget"];
	toolBudget?: AgentConfig["toolBudget"];
	maxSubagentDepth?: number;
	capabilityCeiling?: unknown;
}

/** Canonical projection of the resolved inputs handed to the child. */
export function projectLaunchBinding(input: LaunchBindingInput): Record<string, unknown> {
	return {
		version: LAUNCH_BINDING_PROJECTION_VERSION,
		definitionDigest: input.definitionDigest,
		taskDigest: input.task === undefined ? undefined : sha256(input.task),
		// The ordered candidate set already contains each attempted model; keeping only
		// this set makes retries correlate to the same preflight binding.
		modelCandidates: input.modelCandidates,
		thinking: input.thinking,
		systemPromptDigest:
			input.systemPrompt === undefined || input.systemPrompt === null ? undefined : sha256(input.systemPrompt),
		systemPromptMode: input.systemPromptMode,
		inheritProjectContext: input.inheritProjectContext,
		inheritSkills: input.inheritSkills,
		skills: input.skills,
		tools: input.tools,
		extensions: input.extensions,
		subagentOnlyExtensions: input.subagentOnlyExtensions,
		mcpDirectTools: input.mcpDirectTools,
		turnBudget: input.turnBudget,
		toolBudget: input.toolBudget,
		maxSubagentDepth: input.maxSubagentDepth,
		capabilityCeiling: input.capabilityCeiling,
	};
}

export function launchBindingDigest(input: LaunchBindingInput): string {
	return sha256(projectLaunchBinding(input));
}
