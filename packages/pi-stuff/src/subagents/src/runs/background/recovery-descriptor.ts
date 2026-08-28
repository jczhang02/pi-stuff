/** Validate and load durable background recovery descriptors. */

import * as fs from "node:fs";
import * as path from "node:path";
import { type JsonObject, type JsonValue, parseJsonValue } from "../../../../shared/json-value.js";
import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
} from "../../../../shared/runtime-type.js";
import { readBoundedOwnedFile } from "../../shared/private-directory.ts";
import type { ArtifactConfig, ResolvedControlConfig } from "../../shared/types.ts";
import { getErrorMessage } from "../../shared/utils.ts";
import {
	parseSubagentCapabilityCeiling,
	type ResolvedSubagentCapabilityCeiling,
} from "../shared/capability-ceiling.ts";
import { MAX_MODEL_CANDIDATES_PER_CHILD } from "../shared/model-fallback.ts";
import { validateToolBudgetConfig } from "../shared/tool-budget.ts";
import { resolveTurnBudgetConfig } from "../shared/turn-budget.ts";
import type { BackgroundRecoveryDescriptor } from "./async-execution.ts";

export type LegacyRecoveryDescriptor = Omit<BackgroundRecoveryDescriptor, "version" | "childIndex" | "context"> & {
	version: 1;
};
export type AsyncRecoveryDescriptor = LegacyRecoveryDescriptor | BackgroundRecoveryDescriptor;

const MAX_RECOVERY_DESCRIPTOR_BYTES = 2 * 1024 * 1024;
const RECOVERY_DESCRIPTOR_FIELDS = [
	"version sourceRunId launchContractDigest agent sessionFile cwd model fallbackModels thinking",
	"tools extensions subagentOnlyExtensions mcpDirectTools systemPrompt systemPromptMode inheritProjectContext inheritSkills",
	"skills skillPath agentFilePath controlConfig absoluteDeadlineAt initialTurnBudget initialToolBudget maxSubagentDepth",
	"capabilityCeiling sessionDir artifactsDir artifactConfig",
].flatMap((fields) => fields.split(" "));
const V2_RECOVERY_DESCRIPTOR_FIELDS = new Set([...RECOVERY_DESCRIPTOR_FIELDS, "childIndex", "context"]);
const LEGACY_RECOVERY_DESCRIPTOR_FIELDS = new Set([
	...RECOVERY_DESCRIPTOR_FIELDS,
	..."agentContract completionGuard outputPath outputMode structuredOutputSchema acceptance maxOutput".split(" "),
]);

function parseRecoveryJson(descriptorPath: string): JsonValue {
	try {
		return parseJsonValue(readBoundedOwnedFile(descriptorPath, MAX_RECOVERY_DESCRIPTOR_BYTES));
	} catch (error) {
		throw new Error(`Failed to parse async recovery descriptor '${descriptorPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
}

function recoveryStringArray(
	value: JsonValue | undefined,
	field: string,
	descriptorPath: string,
): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((entry) => !isRuntimeString(entry) || !entry.trim())) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': ${field} must contain non-empty strings.`,
		);
	}
	return value.flatMap((entry) => (isRuntimeString(entry) ? [entry] : []));
}

function recoveryNonemptyString(
	value: JsonValue | undefined,
	field: string,
	descriptorPath: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (!isRuntimeString(value) || !value.trim()) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a non-empty string.`);
	}
	return value;
}

function requiredRecoveryString(value: JsonValue | undefined, field: string, descriptorPath: string): string {
	const parsed = recoveryNonemptyString(value, field, descriptorPath);
	if (parsed === undefined) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a non-empty string.`);
	}
	return parsed;
}

function requiredRecoveryBoolean(value: JsonValue | undefined, field: string, descriptorPath: string): boolean {
	if (!isRuntimeBoolean(value)) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a boolean.`);
	}
	return value;
}

function recoveryInteger(value: JsonValue | undefined, field: string, descriptorPath: string, minimum: number): number {
	if (!isRuntimeNumber(value) || !Number.isInteger(value) || value < minimum) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': ${field} must be a ${minimum === 0 ? "non-negative" : "positive"} integer.`,
		);
	}
	return value;
}

function recoveryDeadline(value: JsonValue | undefined, descriptorPath: string): number | undefined {
	if (value === undefined) return undefined;
	if (!isRuntimeNumber(value) || !Number.isFinite(value) || value <= 0) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': absoluteDeadlineAt must be a positive timestamp.`,
		);
	}
	return value;
}

function recoveryObject(value: JsonValue | undefined, field: string, descriptorPath: string): JsonObject {
	if (value && isRuntimeObject(value) && !Array.isArray(value)) return value;
	throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${field} must be an object.`);
}

function rejectUnknownConfigFields(
	config: JsonObject,
	allowed: readonly string[],
	field: string,
	descriptorPath: string,
): void {
	const unknown = Object.keys(config).find((name) => !allowed.includes(name));
	if (unknown) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': unknown ${field} field '${unknown}'.`);
	}
}

function validateArtifactConfig(value: JsonValue | undefined, descriptorPath: string, version: 1 | 2): ArtifactConfig {
	const artifact = recoveryObject(value, "artifactConfig", descriptorPath);
	if (version === 2) {
		rejectUnknownConfigFields(
			artifact,
			[
				"enabled",
				"dir",
				"includeInput",
				"includeOutput",
				"includeJsonl",
				"includeTranscript",
				"includeMetadata",
				"cleanupDays",
			],
			"artifactConfig",
			descriptorPath,
		);
	}
	const config: ArtifactConfig = {
		cleanupDays: recoveryInteger(artifact["cleanupDays"], "artifactConfig.cleanupDays", descriptorPath, 0),
		enabled: requiredRecoveryBoolean(artifact["enabled"], "artifactConfig.enabled", descriptorPath),
		includeInput: requiredRecoveryBoolean(artifact["includeInput"], "artifactConfig.includeInput", descriptorPath),
		includeJsonl: requiredRecoveryBoolean(artifact["includeJsonl"], "artifactConfig.includeJsonl", descriptorPath),
		includeMetadata: requiredRecoveryBoolean(
			artifact["includeMetadata"],
			"artifactConfig.includeMetadata",
			descriptorPath,
		),
		includeOutput: requiredRecoveryBoolean(artifact["includeOutput"], "artifactConfig.includeOutput", descriptorPath),
	};
	if (artifact["includeTranscript"] !== undefined) {
		config.includeTranscript = requiredRecoveryBoolean(
			artifact["includeTranscript"],
			"artifactConfig.includeTranscript",
			descriptorPath,
		);
	}
	if (artifact["dir"] === "project" || artifact["dir"] === "session" || artifact["dir"] === "temp") {
		config.dir = artifact["dir"];
	} else if (version === 2 && artifact["dir"] !== undefined) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': artifactConfig.dir is invalid.`);
	}
	return config;
}

function validateControlNotifications(
	control: JsonObject,
	descriptorPath: string,
): Pick<ResolvedControlConfig, "notifyOn" | "notifyChannels"> {
	if (
		!Array.isArray(control["notifyOn"]) ||
		control["notifyOn"].some((item) => item !== "active_long_running" && item !== "needs_attention")
	) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': controlConfig.notifyOn is invalid.`);
	}
	if (
		!Array.isArray(control["notifyChannels"]) ||
		control["notifyChannels"].some((item) => item !== "event" && item !== "async" && item !== "intercom")
	) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': controlConfig.notifyChannels is invalid.`,
		);
	}
	const notifyOn: ResolvedControlConfig["notifyOn"] = [];
	for (const item of control["notifyOn"]) {
		if (item === "active_long_running" || item === "needs_attention") notifyOn.push(item);
	}
	const notifyChannels: ResolvedControlConfig["notifyChannels"] = [];
	for (const item of control["notifyChannels"]) {
		if (item === "event" || item === "async" || item === "intercom") notifyChannels.push(item);
	}
	return { notifyOn, notifyChannels };
}

function validateControlConfig(
	value: JsonValue | undefined,
	descriptorPath: string,
	version: 1 | 2,
): ResolvedControlConfig {
	const control = recoveryObject(value, "controlConfig", descriptorPath);
	if (version === 2) {
		rejectUnknownConfigFields(
			control,
			[
				"enabled",
				"needsAttentionAfterMs",
				"activeNoticeAfterMs",
				"activeNoticeAfterTurns",
				"activeNoticeAfterTokens",
				"failedToolAttemptsBeforeAttention",
				"notifyOn",
				"notifyChannels",
			],
			"controlConfig",
			descriptorPath,
		);
	}
	const activeNoticeAfterTurns =
		control["activeNoticeAfterTurns"] === undefined
			? undefined
			: recoveryInteger(
					control["activeNoticeAfterTurns"],
					"controlConfig.activeNoticeAfterTurns",
					descriptorPath,
					1,
				);
	const activeNoticeAfterTokens =
		control["activeNoticeAfterTokens"] === undefined
			? undefined
			: recoveryInteger(
					control["activeNoticeAfterTokens"],
					"controlConfig.activeNoticeAfterTokens",
					descriptorPath,
					1,
				);
	const config: ResolvedControlConfig = {
		activeNoticeAfterMs: recoveryInteger(
			control["activeNoticeAfterMs"],
			"controlConfig.activeNoticeAfterMs",
			descriptorPath,
			1,
		),
		enabled: requiredRecoveryBoolean(control["enabled"], "controlConfig.enabled", descriptorPath),
		failedToolAttemptsBeforeAttention: recoveryInteger(
			control["failedToolAttemptsBeforeAttention"],
			"controlConfig.failedToolAttemptsBeforeAttention",
			descriptorPath,
			1,
		),
		needsAttentionAfterMs: recoveryInteger(
			control["needsAttentionAfterMs"],
			"controlConfig.needsAttentionAfterMs",
			descriptorPath,
			1,
		),
		...validateControlNotifications(control, descriptorPath),
	};
	if (activeNoticeAfterTurns !== undefined) config.activeNoticeAfterTurns = activeNoticeAfterTurns;
	if (activeNoticeAfterTokens !== undefined) config.activeNoticeAfterTokens = activeNoticeAfterTokens;
	return config;
}

function parseV2RecoveryDescriptor(
	parsed: JsonObject,
	descriptorPath: string,
	configVersion: 1 | 2 = 2,
): BackgroundRecoveryDescriptor {
	const sourceRunId = requiredRecoveryString(parsed["sourceRunId"], "sourceRunId", descriptorPath);
	const agent = requiredRecoveryString(parsed["agent"], "agent", descriptorPath);
	const cwd = requiredRecoveryString(parsed["cwd"], "cwd", descriptorPath);
	const childIndex = recoveryInteger(parsed["childIndex"], "childIndex", descriptorPath, 0);
	const context = parsed["context"];
	if (context !== undefined && context !== "fresh" && context !== "fork") {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': context must be fresh or fork.`);
	}
	const systemPromptMode = parsed["systemPromptMode"];
	if (systemPromptMode !== "append" && systemPromptMode !== "replace") {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': systemPromptMode is invalid.`);
	}
	const inheritProjectContext = requiredRecoveryBoolean(
		parsed["inheritProjectContext"],
		"inheritProjectContext",
		descriptorPath,
	);
	const inheritSkills = requiredRecoveryBoolean(parsed["inheritSkills"], "inheritSkills", descriptorPath);
	const maxSubagentDepth = recoveryInteger(parsed["maxSubagentDepth"], "maxSubagentDepth", descriptorPath, 0);
	const fallbackModels = recoveryStringArray(parsed["fallbackModels"], "fallbackModels", descriptorPath);
	const tools = recoveryStringArray(parsed["tools"], "tools", descriptorPath);
	const extensions = recoveryStringArray(parsed["extensions"], "extensions", descriptorPath);
	const subagentOnlyExtensions = recoveryStringArray(
		parsed["subagentOnlyExtensions"],
		"subagentOnlyExtensions",
		descriptorPath,
	);
	const mcpDirectTools = recoveryStringArray(parsed["mcpDirectTools"], "mcpDirectTools", descriptorPath);
	const skills = recoveryStringArray(parsed["skills"], "skills", descriptorPath);
	const skillPath = recoveryStringArray(parsed["skillPath"], "skillPath", descriptorPath);
	if (fallbackModels && fallbackModels.length >= MAX_MODEL_CANDIDATES_PER_CHILD) {
		throw new Error(
			`Invalid async recovery descriptor '${descriptorPath}': fallbackModels must contain fewer than ${MAX_MODEL_CANDIDATES_PER_CHILD} entries.`,
		);
	}
	const systemPrompt = parsed["systemPrompt"];
	if (systemPrompt !== undefined && !isRuntimeString(systemPrompt)) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': systemPrompt must be a string.`);
	}
	const launchContractDigest = recoveryNonemptyString(
		parsed["launchContractDigest"],
		"launchContractDigest",
		descriptorPath,
	);
	const sessionFile = recoveryNonemptyString(parsed["sessionFile"], "sessionFile", descriptorPath);
	const model = recoveryNonemptyString(parsed["model"], "model", descriptorPath);
	const thinking = recoveryNonemptyString(parsed["thinking"], "thinking", descriptorPath);
	const agentFilePath = recoveryNonemptyString(parsed["agentFilePath"], "agentFilePath", descriptorPath);
	const sessionDir = recoveryNonemptyString(parsed["sessionDir"], "sessionDir", descriptorPath);
	const artifactsDir = recoveryNonemptyString(parsed["artifactsDir"], "artifactsDir", descriptorPath);
	const absoluteDeadlineAt = recoveryDeadline(parsed["absoluteDeadlineAt"], descriptorPath);
	let initialTurnBudget: BackgroundRecoveryDescriptor["initialTurnBudget"];
	if (parsed["initialTurnBudget"] !== undefined) {
		const result = resolveTurnBudgetConfig(parsed["initialTurnBudget"], "recoveryDescriptor.initialTurnBudget");
		if (result.error) throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${result.error}`);
		initialTurnBudget = result.turnBudget;
	}
	let initialToolBudget: BackgroundRecoveryDescriptor["initialToolBudget"];
	if (parsed["initialToolBudget"] !== undefined) {
		const result = validateToolBudgetConfig(parsed["initialToolBudget"], "recoveryDescriptor.initialToolBudget");
		if (result.error) throw new Error(`Invalid async recovery descriptor '${descriptorPath}': ${result.error}`);
		initialToolBudget = result.budget;
	}
	let capabilityCeiling: ResolvedSubagentCapabilityCeiling | undefined;
	if (parsed["capabilityCeiling"] !== undefined) {
		capabilityCeiling = parseSubagentCapabilityCeiling(
			parsed["capabilityCeiling"],
			`async recovery descriptor '${descriptorPath}' capabilityCeiling`,
		);
	}
	const artifactConfig =
		parsed["artifactConfig"] === undefined
			? undefined
			: validateArtifactConfig(parsed["artifactConfig"], descriptorPath, configVersion);
	const controlConfig =
		parsed["controlConfig"] === undefined
			? undefined
			: validateControlConfig(parsed["controlConfig"], descriptorPath, configVersion);
	const descriptor: BackgroundRecoveryDescriptor = {
		agent,
		childIndex,
		cwd,
		inheritProjectContext,
		inheritSkills,
		maxSubagentDepth,
		sourceRunId,
		systemPromptMode,
		version: 2,
	};
	if (launchContractDigest) descriptor.launchContractDigest = launchContractDigest;
	if (context) descriptor.context = context;
	if (sessionFile) descriptor.sessionFile = sessionFile;
	if (model) descriptor.model = model;
	if (fallbackModels) descriptor.fallbackModels = fallbackModels;
	if (thinking) descriptor.thinking = thinking;
	if (tools) descriptor.tools = tools;
	if (extensions) descriptor.extensions = extensions;
	if (subagentOnlyExtensions) descriptor.subagentOnlyExtensions = subagentOnlyExtensions;
	if (mcpDirectTools) descriptor.mcpDirectTools = mcpDirectTools;
	if (systemPrompt !== undefined) descriptor.systemPrompt = systemPrompt;
	if (skills) descriptor.skills = skills;
	if (skillPath) descriptor.skillPath = skillPath;
	if (agentFilePath) descriptor.agentFilePath = agentFilePath;
	if (controlConfig) descriptor.controlConfig = controlConfig;
	if (absoluteDeadlineAt !== undefined) descriptor.absoluteDeadlineAt = absoluteDeadlineAt;
	if (initialTurnBudget) descriptor.initialTurnBudget = initialTurnBudget;
	if (initialToolBudget) descriptor.initialToolBudget = initialToolBudget;
	if (capabilityCeiling) descriptor.capabilityCeiling = capabilityCeiling;
	if (sessionDir) descriptor.sessionDir = sessionDir;
	if (artifactsDir) descriptor.artifactsDir = artifactsDir;
	if (artifactConfig) descriptor.artifactConfig = artifactConfig;
	return descriptor;
}

function validateV2RecoveryDescriptor(value: JsonValue, descriptorPath: string): BackgroundRecoveryDescriptor {
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': expected an object.`);
	}
	const parsed = value;
	for (const field of Object.keys(parsed)) {
		if (!V2_RECOVERY_DESCRIPTOR_FIELDS.has(field)) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': unknown field '${field}'.`);
		}
	}
	if (parsed["version"] !== 2) {
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': version must be 2.`);
	}
	return parseV2RecoveryDescriptor(parsed, descriptorPath);
}

function parseLegacyRecoveryDescriptor(parsed: JsonObject, descriptorPath: string): LegacyRecoveryDescriptor {
	for (const field of Object.keys(parsed)) {
		if (!LEGACY_RECOVERY_DESCRIPTOR_FIELDS.has(field))
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': unknown field '${field}'.`);
	}
	if (parsed["version"] !== 1)
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': version must be 1.`);
	const {
		sourceRunId,
		agent,
		cwd,
		systemPromptMode,
		inheritProjectContext,
		inheritSkills,
		maxSubagentDepth,
		capabilityCeiling,
	} = parseV2RecoveryDescriptor({ ...parsed, version: 2, childIndex: 0 }, descriptorPath, 1);
	const descriptor = Object.assign({}, parsed, {
		version: 1 as const,
		sourceRunId,
		agent,
		cwd,
		systemPromptMode,
		inheritProjectContext,
		inheritSkills,
		maxSubagentDepth,
	});
	return capabilityCeiling ? Object.assign(descriptor, { capabilityCeiling }) : descriptor;
}

export function readAsyncRecoveryDescriptor(
	asyncDir: string | undefined,
	childIndex?: number,
): AsyncRecoveryDescriptor | undefined {
	if (!asyncDir) return undefined;
	const collectionPath = path.join(asyncDir, "recovery-descriptors.json");
	let descriptorPath = path.join(asyncDir, "recovery-descriptor.json");
	let value: JsonValue | undefined;
	if (fs.existsSync(collectionPath)) {
		const collection = parseRecoveryJson(collectionPath);
		if (!collection || !isRuntimeObject(collection) || Array.isArray(collection)) {
			throw new Error(`Invalid async recovery descriptor '${collectionPath}': expected an object.`);
		}
		const wrapper = collection;
		if (wrapper["version"] !== 2 || !Array.isArray(wrapper["children"])) {
			throw new Error(
				`Invalid async recovery descriptor '${collectionPath}': expected version 2 with a children array.`,
			);
		}
		for (const field of Object.keys(wrapper)) {
			if (field !== "version" && field !== "children") {
				throw new Error(`Invalid async recovery descriptor '${collectionPath}': unknown field '${field}'.`);
			}
		}
		if (childIndex === undefined) {
			if (wrapper["children"].length !== 1) return undefined;
			value = wrapper["children"][0];
		} else {
			value = wrapper["children"].find((child) => {
				if (!child || !isRuntimeObject(child) || Array.isArray(child)) return false;
				return child["childIndex"] === childIndex;
			});
			if (value === undefined) {
				throw new Error(`Invalid async recovery descriptor '${collectionPath}': child ${childIndex} is missing.`);
			}
		}
		descriptorPath = `${collectionPath} children[${childIndex ?? 0}]`;
	} else {
		if (!fs.existsSync(descriptorPath)) return undefined;
		value = parseRecoveryJson(descriptorPath);
	}
	if (!value || !isRuntimeObject(value) || Array.isArray(value))
		throw new Error(`Invalid async recovery descriptor '${descriptorPath}': expected an object.`);
	const parsed = value;
	if (parsed["version"] === 2) {
		const descriptor = validateV2RecoveryDescriptor(parsed, descriptorPath);
		if (childIndex !== undefined && descriptor.childIndex !== childIndex) {
			throw new Error(`Invalid async recovery descriptor '${descriptorPath}': expected childIndex ${childIndex}.`);
		}
		return descriptor;
	}
	return parseLegacyRecoveryDescriptor(parsed, descriptorPath);
}
