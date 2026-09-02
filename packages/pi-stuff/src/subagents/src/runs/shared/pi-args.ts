import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { THINKING_LEVELS } from "../../shared/model-info.ts";
import { type JsonSchemaObject, type ResolvedToolBudget, TEMP_ROOT_DIR } from "../../shared/types.ts";
import { PI_CODING_AGENT_PACKAGE_ROOT_ENV } from "../../shared/utils.ts";
import {
	decodeSubagentCapabilityCeiling,
	encodeSubagentCapabilityCeiling,
	intersectSubagentCapabilityCeilings,
	type ResolvedSubagentCapabilityCeiling,
	SUBAGENT_CAPABILITY_CEILING_ENV,
	type SubagentCapabilityAudit,
} from "./capability-ceiling.ts";
import { type ResolvedMcpDirectToolSelection, resolveMcpDirectToolSelections } from "./mcp-direct-tool-allowlist.ts";
import { encodeNestedPathEnv, type NestedPathEntry, parseNestedPathEnv } from "./nested-path.ts";
import { resolvePiPackageRoot } from "./pi-spawn.ts";
import { STRUCTURED_OUTPUT_CAPTURE_ENV, STRUCTURED_OUTPUT_SCHEMA_ENV } from "./structured-output.ts";
import {
	CHILD_TOOL_DIAGNOSTIC_PATH_ENV,
	MCP_DIRECT_CHILD_TOOLS_ENV,
	REQUIRED_CHILD_TOOLS_ENV,
} from "./tool-availability.ts";
import { encodeToolBudgetEnv, TOOL_BUDGET_ENV, TOOL_BUDGET_ZERO_AUTH_ENV } from "./tool-budget.ts";

const TASK_ARG_LIMIT = 8000;
const PROMPT_RUNTIME_EXTENSION_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"subagent-prompt-runtime.ts",
);
const FANOUT_CHILD_EXTENSION_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"extension",
	"fanout-child.ts",
);
const STANDALONE_AGENTS_EXTENSION_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"index.ts",
);
export const PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV = "PI_STUFF_CHILD_BASE_EXTENSION_PATH";
export const PI_STUFF_CODE_MODE_FROZEN_ENV = "PI_STUFF_CODE_MODE_FROZEN";
export const SUBAGENT_CHILD_ENV = "PI_SUBAGENT_CHILD";
export const SUBAGENT_ORCHESTRATOR_TARGET_ENV = "PI_SUBAGENT_ORCHESTRATOR_TARGET";
export const SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV = "PI_SUBAGENT_ORCHESTRATOR_SESSION_ID";
export const SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV = "PI_SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID";
export const SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV = "PI_SUBAGENT_SUPERVISOR_CHANNEL_DIR";
export const SUBAGENT_RUN_ID_ENV = "PI_SUBAGENT_RUN_ID";
export const SUBAGENT_CHILD_AGENT_ENV = "PI_SUBAGENT_CHILD_AGENT";
export const SUBAGENT_CHILD_INDEX_ENV = "PI_SUBAGENT_CHILD_INDEX";
export const SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV = "PI_SUBAGENT_DELEGATED_TASK_FINGERPRINT";
export const SUBAGENT_FANOUT_CHILD_ENV = "PI_SUBAGENT_FANOUT_CHILD";
export const SUBAGENT_PARENT_EVENT_SINK_ENV = "PI_SUBAGENT_PARENT_EVENT_SINK";
export const SUBAGENT_PARENT_CONTROL_INBOX_ENV = "PI_SUBAGENT_PARENT_CONTROL_INBOX";
export const SUBAGENT_PARENT_ROOT_RUN_ID_ENV = "PI_SUBAGENT_PARENT_ROOT_RUN_ID";
export const SUBAGENT_PARENT_RUN_ID_ENV = "PI_SUBAGENT_PARENT_RUN_ID";
export const SUBAGENT_PARENT_CHILD_INDEX_ENV = "PI_SUBAGENT_PARENT_CHILD_INDEX";
export const SUBAGENT_PARENT_DEPTH_ENV = "PI_SUBAGENT_PARENT_DEPTH";
export const SUBAGENT_PARENT_PATH_ENV = "PI_SUBAGENT_PARENT_PATH";
export const SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV = "PI_SUBAGENT_PARENT_CAPABILITY_TOKEN";
export const SUBAGENT_PARENT_SESSION_ENV = "PI_SUBAGENT_PARENT_SESSION";
export const SUBAGENT_PARENT_PHYSICAL_SESSION_ENV = "PI_SUBAGENT_PARENT_PHYSICAL_SESSION";
export const PI_STUFF_AGENT_PATH_ENV = "PI_STUFF_AGENT_PATH";
export const SUBAGENT_STEER_INBOX_ENV = "PI_SUBAGENT_STEER_INBOX";
export const SUBAGENT_STEER_CAPABILITY_ENV = "PI_SUBAGENT_STEER_CAPABILITY";
export const SUBAGENT_STEER_ACK_DIR_ENV = "PI_SUBAGENT_STEER_ACK_DIR";
export const PI_INTERCOM_STABLE_ID_ENV = "PI_INTERCOM_STABLE_ID";
export const PI_INTERCOM_SESSION_ID_ENV = "PI_INTERCOM_SESSION_ID";

export interface BuildPiArgsInput {
	/** Ledger namespace. It may temporarily remain v1 during an in-flight upgrade. */
	governorSessionId?: string | undefined;
	/** Physical v2 session identity written to lifecycle and supervisor artifacts. */
	physicalSessionId?: string | undefined;
	parentSessionId?: string | undefined;
	baseArgs: string[];
	task: string;
	sessionEnabled: boolean;
	sessionDir?: string | undefined;
	sessionFile?: string | undefined;
	model?: string | undefined;
	thinking?: string | false | undefined;
	systemPromptMode?: "append" | "replace" | undefined;
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	codeModeEnabled?: boolean | undefined;
	codeModeProviderTools?: readonly string[] | undefined;
	childBaseExtensionPath?: string | undefined;
	requireReadTool?: boolean | undefined;
	tools?: string[] | undefined;
	excludeTools?: string[] | undefined;
	extensions?: string[] | undefined;
	subagentOnlyExtensions?: string[] | undefined;
	systemPrompt?: string | null | undefined;
	mcpDirectTools?: string[] | undefined;
	cwd?: string | undefined;
	promptFileStem?: string | undefined;
	intercomSessionName?: string | undefined;
	orchestratorIntercomTarget?: string | undefined;
	/** Enable the native supervisor channel only when the parent turn is not owner-blocking. */
	enableNativeSupervisor?: boolean | undefined;
	runId?: string | undefined;
	logicalAgentPathComponent?: string | undefined;
	childAgentName?: string | undefined;
	childIndex?: number | undefined;
	parentEventSink?: string | undefined;
	parentControlInbox?: string | undefined;
	parentRootRunId?: string | undefined;
	parentRunId?: string | undefined;
	parentChildIndex?: number | undefined;
	parentDepth?: number | undefined;
	parentPath?: NestedPathEntry[] | undefined;
	parentCapabilityToken?: string | undefined;
	steerInboxDir?: string | undefined;
	steerCapabilityPath?: string | undefined;
	steerAckDir?: string | undefined;
	structuredOutput?:
		| {
				schema: JsonSchemaObject;
				schemaPath: string;
				outputPath: string;
		  }
		| undefined;
	toolBudget?: ResolvedToolBudget | undefined;
	allowZeroToolBudget?: boolean | undefined;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling | undefined;
}

export interface BuildPiArgsResult {
	args: string[];
	env: Record<string, string | undefined>;
	tempDir?: string;
	toolDiagnosticPath?: string;
	capabilityAudit?: SubagentCapabilityAudit | undefined;
}

function sanitizeSupervisorChannelSegment(value: string): string {
	return (
		value
			.trim()
			.replace(/[^A-Za-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown"
	);
}

export function supervisorChannelDir(
	physicalSessionId: string,
	runId: string,
	agent: string,
	childIndex: number,
): string {
	const namespace = createHash("sha256").update(physicalSessionId).digest("hex").slice(0, 16);
	return path.join(
		TEMP_ROOT_DIR,
		"supervisor-channels",
		`${namespace}-${sanitizeSupervisorChannelSegment(runId)}-${sanitizeSupervisorChannelSegment(agent)}-${childIndex}`,
	);
}

export function applyThinkingSuffix(
	model: string | undefined,
	thinking: string | false | undefined,
	replaceExisting = false,
): string | undefined {
	if (!model || !thinking) return model;
	const colonIdx = model.lastIndexOf(":");
	if (colonIdx !== -1 && THINKING_LEVELS.some((level) => level === model.substring(colonIdx + 1))) {
		return replaceExisting ? `${model.slice(0, colonIdx)}:${thinking}` : model;
	}
	return `${model}:${thinking}`;
}

export interface ResolvePiLaunchToolPlanInput {
	tools?: string[] | undefined;
	excludeTools?: string[] | undefined;
	extensions?: string[] | undefined;
	subagentOnlyExtensions?: string[] | undefined;
	mcpDirectTools?: string[] | undefined;
	cwd?: string | undefined;
	requireReadTool?: boolean | undefined;
	structuredOutput?: boolean | undefined;
	nativeSupervisor?: boolean | undefined;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling | undefined;
	inheritedCapabilityCeiling?: ResolvedSubagentCapabilityCeiling | undefined;
	childBaseExtensionPath?: string | undefined;
}

export interface PiLaunchToolPlan {
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	requestedBuiltinTools: string[];
	declaredBuiltinTools: string[];
	excludeTools: string[];
	resolvedMcpSelections: ResolvedMcpDirectToolSelection[];
	effectiveMcpSelections: ResolvedMcpDirectToolSelection[];
	effectiveMcpTools: string[];
	explicitToolAllowlist: boolean;
	internalTools: string[];
	effectiveToolAllowlist: string[];
	requiredChildTools: string[];
	fanoutAuthorized: boolean;
	configuredExtensions: string[];
	extensionArgs: string[];
	baseExtensionPath?: string;
	capabilityAudit?: SubagentCapabilityAudit;
}

function childBaseExtensionPath(configured?: string): string {
	const inherited = configured?.trim() || process.env[PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV]?.trim();
	if (inherited && path.isAbsolute(inherited)) {
		try {
			const resolved = fs.realpathSync(inherited);
			const stat = fs.lstatSync(resolved);
			if (stat.isFile() && !stat.isSymbolicLink()) return resolved;
		} catch {
			// A stale inherited path must not make every child unlaunchable.
		}
	}
	return STANDALONE_AGENTS_EXTENSION_PATH;
}

function isExtensionTool(tool: string): boolean {
	return tool.includes("/") || tool.endsWith(".ts") || tool.endsWith(".js");
}

function auditLaunchCapability(
	input: ResolvePiLaunchToolPlanInput,
	plan: PiLaunchToolPlan,
): SubagentCapabilityAudit | undefined {
	const ceiling = plan.capabilityCeiling;
	if (!ceiling) return undefined;
	const requestedTools =
		input.tools === undefined
			? undefined
			: [...new Set([...plan.requestedBuiltinTools, ...plan.resolvedMcpSelections.map(({ name }) => name)])];
	const audit = {
		ceiling,
		effectiveTools: plan.effectiveToolAllowlist,
		removedTools: requestedTools?.filter((tool) => !plan.effectiveToolAllowlist.includes(tool)) ?? [],
		internalTools: plan.internalTools,
		extensionsDenied: ceiling.denyExtensions,
		removedExtensionCount: ceiling.denyExtensions
			? (input.extensions?.length ?? 0) +
				(input.subagentOnlyExtensions?.length ?? 0) +
				(input.tools ?? []).filter(isExtensionTool).length
			: 0,
		requestedMcpToolCount: input.mcpDirectTools?.length ?? 0,
		effectiveMcpTools: plan.effectiveMcpTools,
	} satisfies SubagentCapabilityAudit;
	if (requestedTools) Object.assign(audit, { requestedTools });
	return audit;
}

export function resolvePiLaunchToolPlan(input: ResolvePiLaunchToolPlanInput): PiLaunchToolPlan {
	const capabilityCeiling = intersectSubagentCapabilityCeilings(
		input.capabilityCeiling,
		input.inheritedCapabilityCeiling,
	);
	const allowedToolSet =
		capabilityCeiling?.allowedTools === undefined ? undefined : new Set(capabilityCeiling.allowedTools);
	const excludeTools = [...new Set((input.excludeTools ?? []).map((tool) => tool.trim()).filter(Boolean))];
	const excludedToolSet = new Set(excludeTools);
	const requestedBuiltinTools = input.tools?.filter((tool) => !isExtensionTool(tool)) ?? [];
	if (input.requireReadTool && excludedToolSet.has("read")) {
		throw new Error("Agent excludeTools removes required tool 'read' for lazy skill loading.");
	}
	if (input.requireReadTool && allowedToolSet && !allowedToolSet.has("read")) {
		throw new Error(
			`Capability ceiling from ${capabilityCeiling?.sources.join(", ") || "unknown source"} excludes required tool 'read' for lazy skill loading.`,
		);
	}
	const declaredBuiltinTools =
		input.tools === undefined
			? allowedToolSet
				? [...allowedToolSet]
				: []
			: (input.requireReadTool && !requestedBuiltinTools.includes("read")
					? ["read", ...requestedBuiltinTools]
					: requestedBuiltinTools
				)
					.filter((tool) => !allowedToolSet || allowedToolSet.has(tool))
					// Host 0.84.1 can leave limit-killed rg children unreaped and freeze a parallel child Tool batch.
					.filter((tool) => tool !== "grep");
	const effectiveDeclaredBuiltinTools = declaredBuiltinTools.filter((tool) => !excludedToolSet.has(tool));
	const fanoutAuthorized =
		!excludedToolSet.has("subagent") &&
		((input.tools === undefined && allowedToolSet === undefined) ||
			effectiveDeclaredBuiltinTools.includes("subagent"));
	const toolExtensionPaths: string[] = capabilityCeiling?.denyExtensions
		? []
		: (input.tools ?? []).filter((tool) => !requestedBuiltinTools.includes(tool) && isExtensionTool(tool));
	const resolvedMcpSelections = capabilityCeiling?.denyExtensions
		? []
		: resolveMcpDirectToolSelections(input.mcpDirectTools, input.cwd);
	const effectiveMcpSelections = resolvedMcpSelections.filter(
		(selection) => (!allowedToolSet || allowedToolSet.has(selection.name)) && !excludedToolSet.has(selection.name),
	);
	const effectiveMcpTools = effectiveMcpSelections.map((selection) => selection.name);
	const explicitToolAllowlist =
		input.tools !== undefined || (input.mcpDirectTools?.length ?? 0) > 0 || allowedToolSet !== undefined;
	const internalTools = [
		...(input.structuredOutput ? ["structured_output"] : []),
		...(input.nativeSupervisor ? ["contact_supervisor"] : []),
	].filter((tool) => !excludedToolSet.has(tool));
	const effectiveToolAllowlist = [
		...new Set([...effectiveDeclaredBuiltinTools, ...effectiveMcpTools, ...internalTools]),
	];
	const requiredChildTools = explicitToolAllowlist
		? [
				...new Set([
					...(input.tools !== undefined ? effectiveDeclaredBuiltinTools : []),
					...(input.mcpDirectTools?.length ? effectiveMcpTools : []),
					...(input.requireReadTool ? ["read"] : []),
					...internalTools,
				]),
			]
		: input.requireReadTool
			? ["read"]
			: [];
	const runtimeExtensions = fanoutAuthorized
		? [FANOUT_CHILD_EXTENSION_PATH, PROMPT_RUNTIME_EXTENSION_PATH]
		: [PROMPT_RUNTIME_EXTENSION_PATH];
	// Pi loads temporary CLI extensions before ambient package/project extensions.
	// A child payload gate passed only through --extension could therefore run too
	// early. Make the child extension surface deterministic instead: reload the
	// parent Suite (or the standalone Agents package) explicitly, opt in Agent
	// extensions, disable ambient discovery, and keep the runtime guard last.
	const resolvedBaseExtension = childBaseExtensionPath(input.childBaseExtensionPath);
	const runtimeExtensionSet = new Set(runtimeExtensions);
	const configuredExtensions = capabilityCeiling?.denyExtensions
		? []
		: [
				// Agent-specific extensions are additive. Even an explicit empty list
				// must not silently turn off the owning Suite and its Context runtime.
				...(resolvedBaseExtension ? [resolvedBaseExtension] : []),
				...toolExtensionPaths,
				...(input.extensions ?? []),
				...(input.subagentOnlyExtensions ?? []),
			].filter((extension) => !runtimeExtensionSet.has(extension));
	const extensionArgs = [...new Set(configuredExtensions), ...runtimeExtensions];
	const plan: PiLaunchToolPlan = {
		requestedBuiltinTools,
		declaredBuiltinTools,
		excludeTools,
		resolvedMcpSelections,
		effectiveMcpSelections,
		effectiveMcpTools,
		explicitToolAllowlist,
		internalTools,
		effectiveToolAllowlist,
		requiredChildTools,
		fanoutAuthorized,
		configuredExtensions,
		extensionArgs,
		baseExtensionPath: resolvedBaseExtension,
	};
	if (capabilityCeiling) plan.capabilityCeiling = capabilityCeiling;
	const capabilityAudit = auditLaunchCapability(input, plan);
	if (capabilityAudit) plan.capabilityAudit = capabilityAudit;
	return plan;
}

function appendCodeModeToolGuidance(prompt: string | null | undefined, tools: readonly string[]): string {
	const available = tools.length > 0 ? tools.join(", ") : "none";
	const guidance = `Available tools for this Agent: ${available}.\nIn Code Mode, call only these through tools.*; use codemode.describe("tools.name") for signatures.`;
	return prompt?.trim() ? `${prompt.trimEnd()}\n\n${guidance}` : guidance;
}

function appendChildLaunchArgs(
	args: string[],
	input: BuildPiArgsInput,
	toolPlan: PiLaunchToolPlan,
	codeModeProviderTools: readonly string[],
	systemPrompt: string | null | undefined,
): string | undefined {
	const hostToolAllowlist = [
		...new Set(
			[...toolPlan.effectiveToolAllowlist, ...codeModeProviderTools].filter(
				(tool) => !toolPlan.excludeTools.includes(tool),
			),
		),
	];
	if (toolPlan.explicitToolAllowlist) {
		args.push(hostToolAllowlist.length > 0 ? "--tools" : "--no-tools");
		if (hostToolAllowlist.length > 0) args.push(hostToolAllowlist.join(","));
	} else if (toolPlan.excludeTools.length > 0) {
		args.push("--exclude-tools", toolPlan.excludeTools.join(","));
	}
	args.push("--no-extensions");
	for (const extPath of toolPlan.extensionArgs) args.push("--extension", extPath);
	if (!input.inheritProjectContext) args.push("--no-context-files");
	if (!input.inheritSkills) args.push("--no-skills");

	let tempDir: string | undefined;
	if (systemPrompt !== undefined && systemPrompt !== null) {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		const stem = (input.promptFileStem ?? "prompt").replace(/[^\w.-]/g, "_");
		const promptPath = path.join(tempDir, `${stem}.md`);
		fs.writeFileSync(promptPath, systemPrompt, { mode: 0o600 });
		args.push(input.systemPromptMode === "replace" ? "--system-prompt" : "--append-system-prompt", promptPath);
	}
	if (input.task.length > TASK_ARG_LIMIT) {
		tempDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		const taskFilePath = path.join(tempDir, "task.md");
		fs.writeFileSync(taskFilePath, `Task: ${input.task}`, { mode: 0o600 });
		args.push(`@${taskFilePath}`);
	} else {
		args.push(`Task: ${input.task}`);
	}
	return tempDir;
}

function applyNestedRouteEnv(
	env: Record<string, string | undefined>,
	input: BuildPiArgsInput,
	fanoutAuthorized: boolean,
): void {
	const inheritedNestedRoute = Boolean(
		process.env[SUBAGENT_PARENT_EVENT_SINK_ENV] &&
			process.env[SUBAGENT_PARENT_ROOT_RUN_ID_ENV] &&
			process.env[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV],
	);
	const parentRunId =
		input.parentRunId ??
		input.runId ??
		(inheritedNestedRoute ? process.env[SUBAGENT_RUN_ID_ENV] : undefined) ??
		process.env[SUBAGENT_PARENT_RUN_ID_ENV] ??
		"";
	const parentChildIndex =
		input.parentChildIndex !== undefined
			? String(input.parentChildIndex)
			: input.childIndex !== undefined
				? String(input.childIndex)
				: (process.env[SUBAGENT_PARENT_CHILD_INDEX_ENV] ?? "");
	const inheritedDepth = Number(process.env[SUBAGENT_PARENT_DEPTH_ENV]);
	const parentDepth =
		input.parentDepth ?? (inheritedNestedRoute && Number.isFinite(inheritedDepth) ? inheritedDepth + 1 : 1);
	let parentPathEntry: NestedPathEntry | undefined;
	if (parentRunId) {
		parentPathEntry = { runId: parentRunId };
		if (parentChildIndex && /^\d+$/.test(parentChildIndex)) parentPathEntry.stepIndex = Number(parentChildIndex);
		if (input.childAgentName) parentPathEntry.agent = input.childAgentName;
	}
	const parentPath = input.parentPath ?? [
		...parseNestedPathEnv(process.env[SUBAGENT_PARENT_PATH_ENV]),
		...(parentPathEntry ? [parentPathEntry] : []),
	];
	env[SUBAGENT_PARENT_EVENT_SINK_ENV] = fanoutAuthorized
		? (input.parentEventSink ?? process.env[SUBAGENT_PARENT_EVENT_SINK_ENV] ?? "")
		: "";
	env[SUBAGENT_PARENT_CONTROL_INBOX_ENV] = fanoutAuthorized
		? (input.parentControlInbox ?? process.env[SUBAGENT_PARENT_CONTROL_INBOX_ENV] ?? "")
		: "";
	env[SUBAGENT_PARENT_ROOT_RUN_ID_ENV] = fanoutAuthorized
		? (input.parentRootRunId ?? process.env[SUBAGENT_PARENT_ROOT_RUN_ID_ENV] ?? input.runId ?? "")
		: "";
	env[SUBAGENT_PARENT_RUN_ID_ENV] = fanoutAuthorized ? parentRunId : "";
	env[SUBAGENT_PARENT_CHILD_INDEX_ENV] = fanoutAuthorized ? parentChildIndex : "";
	env[SUBAGENT_PARENT_DEPTH_ENV] = fanoutAuthorized ? String(parentDepth) : "";
	env[SUBAGENT_PARENT_PATH_ENV] = fanoutAuthorized ? encodeNestedPathEnv(parentPath) : "";
	env[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV] = fanoutAuthorized
		? (input.parentCapabilityToken ?? process.env[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV] ?? "")
		: "";
}

function buildChildEnv(
	input: BuildPiArgsInput,
	toolPlan: PiLaunchToolPlan,
	codeModeProviderTools: readonly string[],
	nativeSupervisor: boolean,
	physicalSessionId: string | undefined,
	tempDir: string | undefined,
) {
	const env: Record<string, string | undefined> = {};
	if (input.codeModeEnabled !== undefined) {
		env[PI_STUFF_CODE_MODE_FROZEN_ENV] = input.codeModeEnabled ? "on" : "off";
	}
	const piPackageRoot = process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] ?? resolvePiPackageRoot();
	if (piPackageRoot) env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] = piPackageRoot;
	tempDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
	const toolDiagnosticPath = path.join(tempDir, "child-diagnostic.json");
	env[CHILD_TOOL_DIAGNOSTIC_PATH_ENV] = toolDiagnosticPath;
	const requiredChildTools = [
		...new Set(
			[...toolPlan.requiredChildTools, ...codeModeProviderTools].filter(
				(tool) => !toolPlan.excludeTools.includes(tool),
			),
		),
	];
	if (requiredChildTools.length > 0) env[REQUIRED_CHILD_TOOLS_ENV] = JSON.stringify(requiredChildTools);
	env[MCP_DIRECT_CHILD_TOOLS_ENV] =
		toolPlan.effectiveMcpTools.length > 0 ? JSON.stringify(toolPlan.effectiveMcpTools) : undefined;
	env[PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV] = toolPlan.baseExtensionPath;
	env[SUBAGENT_CHILD_ENV] = "1";
	env[SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV] = createHash("sha256").update(input.task.trim()).digest("hex");
	env[SUBAGENT_FANOUT_CHILD_ENV] = toolPlan.fanoutAuthorized ? "1" : "0";
	applyNestedRouteEnv(env, input, toolPlan.fanoutAuthorized);
	env["PI_SUBAGENT_INHERIT_PROJECT_CONTEXT"] = input.inheritProjectContext ? "1" : "0";
	env["PI_SUBAGENT_INHERIT_SKILLS"] = input.inheritSkills ? "1" : "0";
	env[PI_INTERCOM_STABLE_ID_ENV] = input.intercomSessionName || undefined;
	env[PI_INTERCOM_SESSION_ID_ENV] = undefined;
	env[SUBAGENT_ORCHESTRATOR_TARGET_ENV] = input.orchestratorIntercomTarget || undefined;
	env[SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV] = input.parentSessionId || undefined;
	env[SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV] = undefined;
	env[SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV] = undefined;
	if (input.intercomSessionName) env["PI_SUBAGENT_INTERCOM_SESSION_NAME"] = input.intercomSessionName;
	if (nativeSupervisor && physicalSessionId && input.parentSessionId && input.runId && input.childAgentName) {
		const childIndex = input.childIndex ?? 0;
		env[SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV] = supervisorChannelDir(
			physicalSessionId,
			input.runId,
			input.childAgentName,
			childIndex,
		);
		env[SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV] = physicalSessionId;
	}
	if (input.runId) env[SUBAGENT_RUN_ID_ENV] = input.runId;
	if (input.childAgentName) env[SUBAGENT_CHILD_AGENT_ENV] = input.childAgentName;
	const parentAgentPath = process.env[PI_STUFF_AGENT_PATH_ENV]?.trim();
	if (input.runId) {
		const childPathComponent = input.logicalAgentPathComponent ?? `${input.runId}:${input.childIndex ?? 0}`;
		env[PI_STUFF_AGENT_PATH_ENV] = parentAgentPath
			? `${parentAgentPath} › ${childPathComponent}`
			: childPathComponent;
	} else if (parentAgentPath) {
		// Agent names can repeat, so retain the parent path instead of appending an ambiguous child identity.
		env[PI_STUFF_AGENT_PATH_ENV] = parentAgentPath;
	}
	if (input.childIndex !== undefined) env[SUBAGENT_CHILD_INDEX_ENV] = String(input.childIndex);
	if (!toolPlan.capabilityCeiling && input.mcpDirectTools?.length)
		env["MCP_DIRECT_TOOLS"] = input.mcpDirectTools.join(",");
	else if (
		toolPlan.capabilityCeiling &&
		toolPlan.effectiveMcpSelections.length &&
		!toolPlan.capabilityCeiling.denyExtensions
	)
		env["MCP_DIRECT_TOOLS"] = toolPlan.effectiveMcpSelections.map(({ selector }) => selector).join(",");
	else env["MCP_DIRECT_TOOLS"] = "__none__";
	const encodedCapabilityCeiling = encodeSubagentCapabilityCeiling(toolPlan.capabilityCeiling);
	if (encodedCapabilityCeiling) env[SUBAGENT_CAPABILITY_CEILING_ENV] = encodedCapabilityCeiling;
	if (input.structuredOutput) {
		env[STRUCTURED_OUTPUT_CAPTURE_ENV] = input.structuredOutput.outputPath;
		env[STRUCTURED_OUTPUT_SCHEMA_ENV] = input.structuredOutput.schemaPath;
	}
	if (input.steerInboxDir) env[SUBAGENT_STEER_INBOX_ENV] = input.steerInboxDir;
	if (input.steerCapabilityPath) env[SUBAGENT_STEER_CAPABILITY_ENV] = input.steerCapabilityPath;
	if (input.steerAckDir) env[SUBAGENT_STEER_ACK_DIR_ENV] = input.steerAckDir;
	const encodedToolBudget = encodeToolBudgetEnv(input.toolBudget);
	if (encodedToolBudget) env[TOOL_BUDGET_ENV] = encodedToolBudget;
	env[TOOL_BUDGET_ZERO_AUTH_ENV] = input.allowZeroToolBudget ? "1" : undefined;
	// These values were captured during launch preparation; never read the mutable Host session here.
	env[SUBAGENT_PARENT_SESSION_ENV] = input.governorSessionId ?? input.parentSessionId ?? "";
	env[SUBAGENT_PARENT_PHYSICAL_SESSION_ENV] =
		input.physicalSessionId ?? input.governorSessionId ?? input.parentSessionId ?? "";
	return { env, tempDir, toolDiagnosticPath };
}

export function buildPiArgs(input: BuildPiArgsInput): BuildPiArgsResult {
	const args = [...input.baseArgs];
	const physicalSessionId = input.physicalSessionId ?? input.governorSessionId;
	const nativeSupervisor = Boolean(
		input.enableNativeSupervisor && physicalSessionId && input.parentSessionId && input.runId && input.childAgentName,
	);

	if (input.sessionFile) {
		fs.mkdirSync(path.dirname(input.sessionFile), { recursive: true });
		args.push("--session", input.sessionFile);
	} else {
		if (!input.sessionEnabled) {
			args.push("--no-session");
		}
		if (input.sessionDir) {
			fs.mkdirSync(input.sessionDir, { recursive: true });
			args.push("--session-dir", input.sessionDir);
		}
	}

	const modelArg = applyThinkingSuffix(input.model, input.thinking);
	if (modelArg) {
		args.push("--model", modelArg);
	}

	const toolPlan = resolvePiLaunchToolPlan({
		tools: input.tools,
		excludeTools: input.excludeTools,
		extensions: input.extensions,
		subagentOnlyExtensions: input.subagentOnlyExtensions,
		mcpDirectTools: input.mcpDirectTools,
		cwd: input.cwd,
		childBaseExtensionPath: input.childBaseExtensionPath,
		requireReadTool: input.requireReadTool,
		structuredOutput: input.structuredOutput !== undefined,
		nativeSupervisor,
		capabilityCeiling: input.capabilityCeiling,
		inheritedCapabilityCeiling: decodeSubagentCapabilityCeiling(process.env[SUBAGENT_CAPABILITY_CEILING_ENV]),
	});
	const codeModeProviderTools =
		input.codeModeEnabled && toolPlan.explicitToolAllowlist ? (input.codeModeProviderTools ?? []) : [];
	const systemPrompt =
		input.codeModeEnabled && toolPlan.explicitToolAllowlist
			? appendCodeModeToolGuidance(input.systemPrompt, toolPlan.effectiveToolAllowlist)
			: input.systemPrompt;
	const initialTempDir = appendChildLaunchArgs(args, input, toolPlan, codeModeProviderTools, systemPrompt);
	const { env, tempDir, toolDiagnosticPath } = buildChildEnv(
		input,
		toolPlan,
		codeModeProviderTools,
		nativeSupervisor,
		physicalSessionId,
		initialTempDir,
	);

	return { args, env, tempDir, toolDiagnosticPath, capabilityAudit: toolPlan.capabilityAudit };
}

export function cleanupTempDir(tempDir: string | null | undefined): void {
	if (!tempDir) return;
	try {
		fs.rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// Temp cleanup is best effort.
	}
}
