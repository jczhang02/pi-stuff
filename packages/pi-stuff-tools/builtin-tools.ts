import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { registerSuiteOwnedTool } from "./contract.js";
import { describeBuiltinTarget, formatElapsed, summarizeBuiltin } from "./render.js";

export interface BuiltinHostSettings {
	readonly autoResizeImages: boolean;
	readonly shellCommandPrefix: string | undefined;
	readonly shellPath: string | undefined;
}

export interface BuiltinFactoryOverrides {
	readonly bash?: typeof createBashToolDefinition;
	readonly read?: typeof createReadToolDefinition;
}

export function resolveBuiltinHostSettings(
	cwd: string,
	projectTrusted: boolean,
	agentDir = getAgentDir(),
): BuiltinHostSettings {
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted });
	return {
		autoResizeImages: settings.getImageAutoResize(),
		shellCommandPrefix: settings.getShellCommandPrefix(),
		shellPath: settings.getShellPath(),
	};
}

export function registerBuiltins(
	pi: ExtensionAPI,
	cwd: string,
	hostSettings: BuiltinHostSettings,
	factories: BuiltinFactoryOverrides = {},
): void {
	const read = (factories.read ?? createReadToolDefinition)(cwd, {
		autoResizeImages: hostSettings.autoResizeImages,
	});
	registerSuiteOwnedTool(pi, read, {
		label: "Read",
		runningSummary: "reading",
		summarize: (args, result, state, durationMs) => summarizeBuiltin("read", args, result, state, durationMs),
		target: (args) => describeBuiltinTarget("read", args),
	});

	const write = createWriteToolDefinition(cwd);
	registerSuiteOwnedTool(pi, write, {
		label: "Write",
		runningSummary: "writing",
		summarize: (args, result, state, durationMs) => summarizeBuiltin("write", args, result, state, durationMs),
		target: (args) => describeBuiltinTarget("write", args),
	});

	const edit = createEditToolDefinition(cwd);
	registerSuiteOwnedTool(pi, edit, {
		label: "Edit",
		runningSummary: "editing",
		summarize: (args, result, state, durationMs) => summarizeBuiltin("edit", args, result, state, durationMs),
		target: (args) => describeBuiltinTarget("edit", args),
	});

	const bash = (factories.bash ?? createBashToolDefinition)(cwd, {
		...(hostSettings.shellCommandPrefix !== undefined ? { commandPrefix: hostSettings.shellCommandPrefix } : {}),
		...(hostSettings.shellPath !== undefined ? { shellPath: hostSettings.shellPath } : {}),
	});
	registerSuiteOwnedTool(pi, bash, {
		label: "Bash",
		runningSummary: (_args, durationMs) => `running ${formatElapsed(durationMs)}`,
		summarize: (args, result, state, durationMs) => summarizeBuiltin("bash", args, result, state, durationMs),
		target: (args) => describeBuiltinTarget("bash", args),
		tracksElapsed: true,
	});

	const grep = createGrepToolDefinition(cwd);
	registerSuiteOwnedTool(pi, grep, {
		label: "Grep",
		runningSummary: "searching",
		summarize: (args, result, state, durationMs) => summarizeBuiltin("grep", args, result, state, durationMs),
		target: (args) => describeBuiltinTarget("grep", args),
	});

	const find = createFindToolDefinition(cwd);
	registerSuiteOwnedTool(pi, find, {
		label: "Find",
		runningSummary: "searching",
		summarize: (args, result, state, durationMs) => summarizeBuiltin("find", args, result, state, durationMs),
		target: (args) => describeBuiltinTarget("find", args),
	});

	const ls = createLsToolDefinition(cwd);
	registerSuiteOwnedTool(pi, ls, {
		label: "List",
		runningSummary: "listing",
		summarize: (args, result, state, durationMs) => summarizeBuiltin("ls", args, result, state, durationMs),
		target: (args) => describeBuiltinTarget("ls", args),
	});
}
