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
	governorSessionId?: string;
	/** Physical v2 session identity written to lifecycle and supervisor artifacts. */
	physicalSessionId?: string;
	parentSessionId?: string;
	baseArgs: string[];
	task: string;
	sessionEnabled: boolean;
	sessionDir?: string;
	sessionFile?: string;
	model?: string;
	thinking?: string | false;
	systemPromptMode?: "append" | "replace";
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	codeModeEnabled?: boolean;
	childBaseExtensionPath?: string;
	requireReadTool?: boolean;
	tools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	systemPrompt?: string | null;
	mcpDirectTools?: string[];
	cwd?: string;
	promptFileStem?: string;
	intercomSessionName?: string;
	orchestratorIntercomTarget?: string;
	/** Enable the native supervisor channel only when the parent turn is not owner-blocking. */
	enableNativeSupervisor?: boolean;
	runId?: string;
	logicalAgentPathComponent?: string;
	childAgentName?: string;
	childIndex?: number;
	parentEventSink?: string;
	parentControlInbox?: string;
	parentRootRunId?: string;
	parentRunId?: string;
	parentChildIndex?: number;
	parentDepth?: number;
	parentPath?: NestedPathEntry[];
	parentCapabilityToken?: string;
	steerInboxDir?: string;
	steerCapabilityPath?: string;
	steerAckDir?: string;
	structuredOutput?: {
		schema: JsonSchemaObject;
		schemaPath: string;
		outputPath: string;
	};
	toolBudget?: ResolvedToolBudget;
	allowZeroToolBudget?: boolean;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
}

export interface BuildPiArgsResult {
	args: string[];
	env: Record<string, string | undefined>;
	tempDir?: string;
	toolDiagnosticPath?: string;
	capabilityAudit?: SubagentCapabilityAudit;
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
	tools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	mcpDirectTools?: string[];
	cwd?: string;
	requireReadTool?: boolean;
	structuredOutput?: boolean;
	nativeSupervisor?: boolean;
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	inheritedCapabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	childBaseExtensionPath?: string;
}

export interface PiLaunchToolPlan {
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling;
	requestedBuiltinTools: string[];
	declaredBuiltinTools: string[];
	toolExtensionPaths: string[];
	resolvedMcpSelections: ResolvedMcpDirectToolSelection[];
	effectiveMcpSelections: ResolvedMcpDirectToolSelection[];
	effectiveMcpTools: string[];
	explicitToolAllowlist: boolean;
	internalTools: string[];
	effectiveToolAllowlist: string[];
	requiredChildTools: string[];
	fanoutAuthorized: boolean;
	runtimeExtensions: string[];
	configuredExtensions: string[];
	extensionArgs: string[];
	disableAmbientExtensions: boolean;
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

export function resolvePiLaunchToolPlan(input: ResolvePiLaunchToolPlanInput): PiLaunchToolPlan {
	const capabilityCeiling = intersectSubagentCapabilityCeilings(
		input.capabilityCeiling,
		input.inheritedCapabilityCeiling,
	);
	const allowedToolSet =
		capabilityCeiling?.allowedTools === undefined ? undefined : new Set(capabilityCeiling.allowedTools);
	const requestedBuiltinTools =
		input.tools?.filter((tool) => !(tool.includes("/") || tool.endsWith(".ts") || tool.endsWith(".js"))) ?? [];
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
	const fanoutAuthorized =
		(input.tools === undefined && allowedToolSet === undefined) || declaredBuiltinTools.includes("subagent");
	const toolExtensionPaths: string[] = capabilityCeiling?.denyExtensions
		? []
		: (input.tools ?? []).filter(
				(tool) =>
					!requestedBuiltinTools.includes(tool) &&
					(tool.includes("/") || tool.endsWith(".ts") || tool.endsWith(".js")),
			);
	const resolvedMcpSelections = capabilityCeiling?.denyExtensions
		? []
		: resolveMcpDirectToolSelections(input.mcpDirectTools, input.cwd);
	const effectiveMcpSelections = resolvedMcpSelections.filter(
		(selection) => !allowedToolSet || allowedToolSet.has(selection.name),
	);
	const effectiveMcpTools = effectiveMcpSelections.map((selection) => selection.name);
	const explicitToolAllowlist =
		input.tools !== undefined || (input.mcpDirectTools?.length ?? 0) > 0 || allowedToolSet !== undefined;
	const internalTools = [
		...(input.structuredOutput ? ["structured_output"] : []),
		...(input.nativeSupervisor ? ["contact_supervisor"] : []),
	];
	const effectiveToolAllowlist = [...new Set([...declaredBuiltinTools, ...effectiveMcpTools, ...internalTools])];
	const requiredChildTools = explicitToolAllowlist
		? [
				...new Set([
					...(input.tools !== undefined ? declaredBuiltinTools : []),
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
	const disableAmbientExtensions = true;
	const requestedToolNames =
		input.tools !== undefined
			? [...new Set([...requestedBuiltinTools, ...resolvedMcpSelections.map((selection) => selection.name)])]
			: undefined;
	const capabilityAudit = capabilityCeiling
		? ({
				ceiling: capabilityCeiling,
				...(requestedToolNames ? { requestedTools: requestedToolNames } : {}),
				effectiveTools: effectiveToolAllowlist,
				removedTools: requestedToolNames?.filter((tool) => !effectiveToolAllowlist.includes(tool)) ?? [],
				internalTools,
				extensionsDenied: capabilityCeiling.denyExtensions,
				removedExtensionCount: capabilityCeiling.denyExtensions
					? (input.extensions?.length ?? 0) +
						(input.subagentOnlyExtensions?.length ?? 0) +
						(input.tools ?? []).filter(
							(tool) => tool.includes("/") || tool.endsWith(".ts") || tool.endsWith(".js"),
						).length
					: 0,
				requestedMcpToolCount: input.mcpDirectTools?.length ?? 0,
				effectiveMcpTools,
			} satisfies SubagentCapabilityAudit)
		: undefined;
	return {
		...(capabilityCeiling ? { capabilityCeiling } : {}),
		requestedBuiltinTools,
		declaredBuiltinTools,
		toolExtensionPaths,
		resolvedMcpSelections,
		effectiveMcpSelections,
		effectiveMcpTools,
		explicitToolAllowlist,
		internalTools,
		effectiveToolAllowlist,
		requiredChildTools,
		fanoutAuthorized,
		runtimeExtensions,
		configuredExtensions,
		extensionArgs,
		disableAmbientExtensions,
		baseExtensionPath: resolvedBaseExtension,
		...(capabilityAudit ? { capabilityAudit } : {}),
	};
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
	if (toolPlan.explicitToolAllowlist) {
		args.push(toolPlan.effectiveToolAllowlist.length > 0 ? "--tools" : "--no-tools");
		if (toolPlan.effectiveToolAllowlist.length > 0) args.push(toolPlan.effectiveToolAllowlist.join(","));
	}
	if (toolPlan.disableAmbientExtensions) {
		args.push("--no-extensions");
	}
	for (const extPath of toolPlan.extensionArgs) args.push("--extension", extPath);

	if (!input.inheritProjectContext) {
		args.push("--no-context-files");
	}
	if (!input.inheritSkills) {
		args.push("--no-skills");
	}

	let tempDir: string | undefined;
	if (input.systemPrompt !== undefined && input.systemPrompt !== null) {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		const stem = (input.promptFileStem ?? "prompt").replace(/[^\w.-]/g, "_");
		const promptPath = path.join(tempDir, `${stem}.md`);
		fs.writeFileSync(promptPath, input.systemPrompt, { mode: 0o600 });
		args.push(input.systemPromptMode === "replace" ? "--system-prompt" : "--append-system-prompt", promptPath);
	}

	if (input.task.length > TASK_ARG_LIMIT) {
		if (!tempDir) {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		}
		const taskFilePath = path.join(tempDir, "task.md");
		fs.writeFileSync(taskFilePath, `Task: ${input.task}`, { mode: 0o600 });
		args.push(`@${taskFilePath}`);
	} else {
		args.push(`Task: ${input.task}`);
	}

	const env: Record<string, string | undefined> = {};
	if (input.codeModeEnabled !== undefined) {
		env[PI_STUFF_CODE_MODE_FROZEN_ENV] = input.codeModeEnabled ? "on" : "off";
	}
	const piPackageRoot = process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] ?? resolvePiPackageRoot();
	if (piPackageRoot) env[PI_CODING_AGENT_PACKAGE_ROOT_ENV] = piPackageRoot;
	if (!tempDir) tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
	const toolDiagnosticPath = path.join(tempDir, "child-diagnostic.json");
	env[CHILD_TOOL_DIAGNOSTIC_PATH_ENV] = toolDiagnosticPath;
	if (toolPlan.requiredChildTools.length > 0) {
		env[REQUIRED_CHILD_TOOLS_ENV] = JSON.stringify(toolPlan.requiredChildTools);
	}
	env[MCP_DIRECT_CHILD_TOOLS_ENV] =
		toolPlan.effectiveMcpTools.length > 0 ? JSON.stringify(toolPlan.effectiveMcpTools) : undefined;
	env[PI_STUFF_CHILD_BASE_EXTENSION_PATH_ENV] = toolPlan.baseExtensionPath;
	env[SUBAGENT_CHILD_ENV] = "1";
	env[SUBAGENT_DELEGATED_TASK_FINGERPRINT_ENV] = createHash("sha256").update(input.task.trim()).digest("hex");
	env[SUBAGENT_FANOUT_CHILD_ENV] = toolPlan.fanoutAuthorized ? "1" : "0";
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
	const parentPath = input.parentPath ?? [
		...parseNestedPathEnv(process.env[SUBAGENT_PARENT_PATH_ENV]),
		...(parentRunId
			? [
					{
						runId: parentRunId,
						...(parentChildIndex && /^\d+$/.test(parentChildIndex)
							? { stepIndex: Number(parentChildIndex) }
							: {}),
						...(input.childAgentName ? { agent: input.childAgentName } : {}),
					},
				]
			: []),
	];
	env[SUBAGENT_PARENT_EVENT_SINK_ENV] = toolPlan.fanoutAuthorized
		? (input.parentEventSink ?? process.env[SUBAGENT_PARENT_EVENT_SINK_ENV] ?? "")
		: "";
	env[SUBAGENT_PARENT_CONTROL_INBOX_ENV] = toolPlan.fanoutAuthorized
		? (input.parentControlInbox ?? process.env[SUBAGENT_PARENT_CONTROL_INBOX_ENV] ?? "")
		: "";
	env[SUBAGENT_PARENT_ROOT_RUN_ID_ENV] = toolPlan.fanoutAuthorized
		? (input.parentRootRunId ?? process.env[SUBAGENT_PARENT_ROOT_RUN_ID_ENV] ?? input.runId ?? "")
		: "";
	env[SUBAGENT_PARENT_RUN_ID_ENV] = toolPlan.fanoutAuthorized ? parentRunId : "";
	env[SUBAGENT_PARENT_CHILD_INDEX_ENV] = toolPlan.fanoutAuthorized ? parentChildIndex : "";
	env[SUBAGENT_PARENT_DEPTH_ENV] = toolPlan.fanoutAuthorized ? String(parentDepth) : "";
	env[SUBAGENT_PARENT_PATH_ENV] = toolPlan.fanoutAuthorized ? encodeNestedPathEnv(parentPath) : "";
	env[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV] = toolPlan.fanoutAuthorized
		? (input.parentCapabilityToken ?? process.env[SUBAGENT_PARENT_CAPABILITY_TOKEN_ENV] ?? "")
		: "";
	env.PI_SUBAGENT_INHERIT_PROJECT_CONTEXT = input.inheritProjectContext ? "1" : "0";
	env.PI_SUBAGENT_INHERIT_SKILLS = input.inheritSkills ? "1" : "0";
	env[PI_INTERCOM_STABLE_ID_ENV] = input.intercomSessionName || undefined;
	env[PI_INTERCOM_SESSION_ID_ENV] = undefined;
	env[SUBAGENT_ORCHESTRATOR_TARGET_ENV] = input.orchestratorIntercomTarget || undefined;
	env[SUBAGENT_ORCHESTRATOR_SESSION_ID_ENV] = input.parentSessionId || undefined;
	env[SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV] = undefined;
	env[SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV] = undefined;
	if (input.intercomSessionName) {
		env.PI_SUBAGENT_INTERCOM_SESSION_NAME = input.intercomSessionName;
	}
	if (nativeSupervisor && physicalSessionId && input.parentSessionId && input.runId && input.childAgentName) {
		const childIndex = input.childIndex ?? 0;
		const channelDir = supervisorChannelDir(physicalSessionId, input.runId, input.childAgentName, childIndex);
		env[SUBAGENT_SUPERVISOR_CHANNEL_DIR_ENV] = channelDir;
		env[SUBAGENT_ORCHESTRATOR_PHYSICAL_SESSION_ID_ENV] = physicalSessionId;
	}
	if (input.runId) {
		env[SUBAGENT_RUN_ID_ENV] = input.runId;
	}
	if (input.childAgentName) {
		env[SUBAGENT_CHILD_AGENT_ENV] = input.childAgentName;
	}
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
	if (input.childIndex !== undefined) {
		env[SUBAGENT_CHILD_INDEX_ENV] = String(input.childIndex);
	}
	if (!toolPlan.capabilityCeiling && input.mcpDirectTools?.length)
		env.MCP_DIRECT_TOOLS = input.mcpDirectTools.join(",");
	else if (
		toolPlan.capabilityCeiling &&
		toolPlan.effectiveMcpSelections.length &&
		!toolPlan.capabilityCeiling.denyExtensions
	)
		env.MCP_DIRECT_TOOLS = toolPlan.effectiveMcpSelections.map((selection) => selection.selector).join(",");
	else env.MCP_DIRECT_TOOLS = "__none__";
	const encodedCapabilityCeiling = encodeSubagentCapabilityCeiling(toolPlan.capabilityCeiling);
	if (encodedCapabilityCeiling) env[SUBAGENT_CAPABILITY_CEILING_ENV] = encodedCapabilityCeiling;
	if (input.structuredOutput) {
		env[STRUCTURED_OUTPUT_CAPTURE_ENV] = input.structuredOutput.outputPath;
		env[STRUCTURED_OUTPUT_SCHEMA_ENV] = input.structuredOutput.schemaPath;
	}
	if (input.steerInboxDir) {
		env[SUBAGENT_STEER_INBOX_ENV] = input.steerInboxDir;
	}
	if (input.steerCapabilityPath) env[SUBAGENT_STEER_CAPABILITY_ENV] = input.steerCapabilityPath;
	if (input.steerAckDir) env[SUBAGENT_STEER_ACK_DIR_ENV] = input.steerAckDir;
	const encodedToolBudget = encodeToolBudgetEnv(input.toolBudget);
	if (encodedToolBudget) env[TOOL_BUDGET_ENV] = encodedToolBudget;
	env[TOOL_BUDGET_ZERO_AUTH_ENV] = input.allowZeroToolBudget ? "1" : undefined;

	// This value is captured when the launch is prepared. Never read the mutable
	// parent-process environment here: a foreground writer may spawn after the
	// root Host has already switched sessions.
	env[SUBAGENT_PARENT_SESSION_ENV] = input.governorSessionId ?? input.parentSessionId ?? "";
	env[SUBAGENT_PARENT_PHYSICAL_SESSION_ENV] =
		input.physicalSessionId ?? input.governorSessionId ?? input.parentSessionId ?? "";

	return { args, env, tempDir, toolDiagnosticPath, capabilityAudit: toolPlan.capabilityAudit };
}

export const parseParentPathEnv = parseNestedPathEnv;

export function cleanupTempDir(tempDir: string | null | undefined): void {
	if (!tempDir) return;
	try {
		fs.rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// Temp cleanup is best effort.
	}
}
