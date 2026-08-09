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
import { activityKey, classifyBashActivity, singleActivity } from "./activity.js";
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
	selectedNames?: ReadonlySet<string>,
): void {
	if (!selectedNames || selectedNames.has("read")) {
		const read = (factories.read ?? createReadToolDefinition)(cwd, {
			autoResizeImages: hostSettings.autoResizeImages,
		});
		registerSuiteOwnedTool(pi, read, {
			activity: {
				categories: ["read-file"],
				classify: ({ args }) => singleActivity("read-file", { key: resolve(cwd, args.path), target: args.path }),
			},
			label: "Read",
			runningSummary: "reading",
			summarize: (args, result, state, durationMs) => summarizeBuiltin("read", args, result, state, durationMs),
			target: (args) => describeBuiltinTarget("read", args),
		});
	}

	if (!selectedNames || selectedNames.has("write")) {
		const write = createWriteToolDefinition(cwd);
		registerSuiteOwnedTool(pi, write, {
			activity: {
				categories: ["change-file"],
				classify: ({ args }) => singleActivity("change-file", { key: resolve(cwd, args.path), target: args.path }),
			},
			label: "Write",
			runningSummary: "writing",
			summarize: (args, result, state, durationMs) => summarizeBuiltin("write", args, result, state, durationMs),
			target: (args) => describeBuiltinTarget("write", args),
		});
	}

	if (!selectedNames || selectedNames.has("edit")) {
		const edit = createEditToolDefinition(cwd);
		registerSuiteOwnedTool(pi, edit, {
			activity: {
				categories: ["change-file"],
				classify: ({ args }) => singleActivity("change-file", { key: resolve(cwd, args.path), target: args.path }),
			},
			label: "Edit",
			runningSummary: "editing",
			summarize: (args, result, state, durationMs) => summarizeBuiltin("edit", args, result, state, durationMs),
			target: (args) => describeBuiltinTarget("edit", args),
		});
	}

	if (!selectedNames || selectedNames.has("bash")) {
		const bash = (factories.bash ?? createBashToolDefinition)(cwd, {
			...(hostSettings.shellCommandPrefix !== undefined ? { commandPrefix: hostSettings.shellCommandPrefix } : {}),
			...(hostSettings.shellPath !== undefined ? { shellPath: hostSettings.shellPath } : {}),
		});
		registerSuiteOwnedTool(pi, bash, {
			activity: {
				categories: ["commit", "push", "merge", "rebase", "create-pr", "launch-background", "run-command"],
				classify: classifyBashActivity,
			},
			label: "Bash",
			runningSummary: (_args, durationMs) => `running ${formatElapsed(durationMs ?? 0)}`,
			summarize: (args, result, state, durationMs) => summarizeBuiltin("bash", args, result, state, durationMs),
			target: (args) => describeBuiltinTarget("bash", args),
			tracksElapsed: true,
		});
	}

	if (!selectedNames || selectedNames.has("grep")) {
		const grep = createGrepToolDefinition(cwd);
		registerSuiteOwnedTool(pi, grep, {
			activity: {
				categories: ["search-pattern"],
				classify: ({ args }) =>
					singleActivity("search-pattern", {
						key: activityKey(args.pattern, resolve(cwd, args.path ?? "."), args.glob ?? ""),
						target: args.pattern,
					}),
			},
			label: "Grep",
			runningSummary: "searching",
			summarize: (args, result, state, durationMs) => summarizeBuiltin("grep", args, result, state, durationMs),
			target: (args) => describeBuiltinTarget("grep", args),
		});
	}

	if (!selectedNames || selectedNames.has("find")) {
		const find = createFindToolDefinition(cwd);
		registerSuiteOwnedTool(pi, find, {
			activity: {
				categories: ["search-pattern"],
				classify: ({ args }) =>
					singleActivity("search-pattern", {
						key: activityKey(args.pattern, resolve(cwd, args.path ?? ".")),
						target: args.pattern,
					}),
			},
			label: "Find",
			runningSummary: "searching",
			summarize: (args, result, state, durationMs) => summarizeBuiltin("find", args, result, state, durationMs),
			target: (args) => describeBuiltinTarget("find", args),
		});
	}

	if (!selectedNames || selectedNames.has("ls")) {
		const ls = createLsToolDefinition(cwd);
		registerSuiteOwnedTool(pi, ls, {
			activity: {
				categories: ["list-directory"],
				classify: ({ args }) => {
					const path = args.path ?? ".";
					return singleActivity("list-directory", { key: resolve(cwd, path), target: path });
				},
			},
			label: "List",
			runningSummary: "listing",
			summarize: (args, result, state, durationMs) => summarizeBuiltin("ls", args, result, state, durationMs),
			target: (args) => describeBuiltinTarget("ls", args),
		});
	}
}

import { resolve } from "node:path";
