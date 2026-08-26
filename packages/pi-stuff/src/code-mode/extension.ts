import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getCommandDialogCoordinator } from "../conversation-ui/index.js";
import type { SuiteAgentMessageHost } from "../conversation-ui/suite-agent-message.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import type { ToolArguments } from "../tool-display/activity.js";
import {
	registerSuiteToolEnvelope,
	registerSuiteToolEnvelopeCompanion,
	type SuiteToolDefinitionRegistry,
	type SuiteToolEnvelopeOperation,
	type SuiteToolPresentation,
	type SuiteToolRegistrationHost,
	type SuiteToolSurfaceController,
	sendSuiteAgentMessage,
	withAgentWorkOrigin,
	withDirectUserActivation,
} from "../tool-display/contract.js";
import { stringifyForStorage } from "./cloudflare/codec.js";
import { isControlOnlyProgram } from "./cloudflare/normalize.js";
import { SuiteCodeModeConnector } from "./connector.js";
import { createCodeModeDialogView } from "./dialog.js";
import { INVALID_CODE_MODE_IMAGE_MESSAGE, sanitizeCodeModeContent } from "./image-content.js";
import { CodeModeSessionLedger } from "./ledger.js";
import {
	captureCodeModeModelContent,
	decodeCodeModeMediaSegments,
	isCodeModeModelContentOwner,
	isCodeModeToolContent,
	rehydrateCodeModeMessages,
	separateCodeModeMediaForUi,
} from "./presentation.js";
import { CODE_MODE_NO_OUTPUT_MESSAGE, CodeModeRuntime, type PiStuffCodeModeDetails } from "./runtime.js";
import { projectCodeModeSearchResponse } from "./search-response.js";
import {
	readCodeModeGlobalEnabled,
	readCodeModeProjectEnabled,
	writeCodeModeGlobalEnabled,
	writeCodeModeProjectEnabled,
} from "./settings.js";
import { V8CodeModeExecutor } from "./v8-executor.js";

export const CODE_MODE_TOOL_NAME = "codemode";
export const CODE_MODE_SEARCH_TOOL_NAME = "tool_search";
export const CODE_MODE_PROVIDER_TOOL_NAMES = [CODE_MODE_TOOL_NAME, CODE_MODE_SEARCH_TOOL_NAME] as const;
const CODE_MODE_DECISION_MESSAGE_TYPE = "pi-stuff-code-mode-decision";
const CODE_MODE_FROZEN_ENV = "PI_STUFF_CODE_MODE_FROZEN";

const CODE_MODE_PARAMETERS = Type.Object(
	{
		code: Type.String({ description: "JavaScript source only; no JSON wrapper or Markdown fence" }),
	},
	{ additionalProperties: false },
);

const CODE_MODE_SEARCH_PARAMETERS = Type.Object(
	{ query: Type.String({ description: 'Short intent phrase, e.g. "view image"' }) },
	{ additionalProperties: false },
);

const CODE_MODE_DESCRIPTION = `Run JavaScript in isolated V8 and compose eligible Pi Stuff Tools through tools.*.
Rules:
- Write plain JavaScript with top-level await and await every tools.* call.
- Call only listed or searched methods, e.g. codemode.search("view image"); inspect unfamiliar methods with codemode.describe("tools.name"). Do not guess Tool names.
- Tool results are unwrapped to structured JSON when available, parsed JSON when valid, or text.
- Structured results are already unwrapped; do not pass them to JSON.parse. Example: const pkg = await tools.read({ path: "package.json" }); text(pkg.packageManager);
- Await ordinary Tool work normally. For one concrete observable command, file, log, or HTTP condition with a deadline, call tools.monitor(...) once; continue useful work and do not poll with Bash, sleep, status checks, or repeated turns.
- For an image Tool result, return await tools.view_image(...); never call image(result). image(...) is only for generated data URLs, image_url objects, or raw image blocks. Do not pass image Base64 through Bash.
Cloudflare-style async arrow functions with return and the legacy suite.* alias are accepted. tools.* and explicit helpers for non-Tool output are canonical. console is unavailable. The sandbox has no direct filesystem, network, process, Node, Bun, require, fetch, or credentials; I/O is only through tools.*. Other helpers include generatedImage, store, load, notify, exit, setTimeout, and clearTimeout.`;

export interface PiStuffCodeModeOptions {
	readonly registry: SuiteToolDefinitionRegistry;
	readonly surface: SuiteToolSurfaceController;
}

export type CodeModeHost = SuiteToolRegistrationHost &
	SuiteAgentMessageHost &
	Pick<ExtensionAPI, "appendEntry" | "registerCommand">;

export interface CodeModeSearchDetails {
	readonly paths: readonly string[];
	readonly query: string;
	readonly total: number;
	readonly truncated: boolean;
}

function environmentMode(name: string): boolean | undefined {
	const value = process.env[name]?.trim().toLowerCase();
	if (value === "on") return true;
	if (value === "off") return false;
	return undefined;
}

function matchSummary(total: number): string {
	return total === 1 ? "1 match" : `${String(total)} matches`;
}

export const CODE_MODE_SEARCH_PRESENTATION: SuiteToolPresentation<{ readonly query: string }, CodeModeSearchDetails> = {
	activity: {
		categories: ["search-tool"],
		classify: ({ args }) => [{ category: "search-tool", countKeys: [args.query], target: args.query }],
	},
	detailLines: (_args, result) => {
		const paths = result.details.paths;
		const omitted = Math.max(0, result.details.total - paths.length);
		return [matchSummary(result.details.total), ...paths, ...(omitted > 0 ? [`… ${String(omitted)} more`] : [])];
	},
	label: "Tool search",
	runningSummary: "searching",
	summarize: (_args, result) => matchSummary(result.details.total),
	target: (args) => args.query,
};

type ToolUsage = NonNullable<AgentToolResult<unknown>["usage"]>;

function decodeToolUsage<Value>(value: Value): ToolUsage | undefined {
	if (
		!isRuntimeObject(value) ||
		value === null ||
		!("input" in value) ||
		!isRuntimeNumber(value.input) ||
		!("output" in value) ||
		!isRuntimeNumber(value.output) ||
		!("cacheRead" in value) ||
		!isRuntimeNumber(value.cacheRead) ||
		!("cacheWrite" in value) ||
		!isRuntimeNumber(value.cacheWrite) ||
		!("totalTokens" in value) ||
		!isRuntimeNumber(value.totalTokens) ||
		!("cost" in value) ||
		!isRuntimeObject(value.cost) ||
		value.cost === null ||
		!("input" in value.cost) ||
		!isRuntimeNumber(value.cost.input) ||
		!("output" in value.cost) ||
		!isRuntimeNumber(value.cost.output) ||
		!("cacheRead" in value.cost) ||
		!isRuntimeNumber(value.cost.cacheRead) ||
		!("cacheWrite" in value.cost) ||
		!isRuntimeNumber(value.cost.cacheWrite) ||
		!("total" in value.cost) ||
		!isRuntimeNumber(value.cost.total)
	) {
		return undefined;
	}
	const usage: ToolUsage = {
		cacheRead: value.cacheRead,
		cacheWrite: value.cacheWrite,
		cost: {
			cacheRead: value.cost.cacheRead,
			cacheWrite: value.cost.cacheWrite,
			input: value.cost.input,
			output: value.cost.output,
			total: value.cost.total,
		},
		input: value.input,
		output: value.output,
		totalTokens: value.totalTokens,
	};
	if ("cacheWrite1h" in value && value.cacheWrite1h !== undefined) {
		if (!isRuntimeNumber(value.cacheWrite1h)) return undefined;
		Object.assign(usage, { cacheWrite1h: value.cacheWrite1h });
	}
	if ("reasoning" in value && value.reasoning !== undefined) {
		if (!isRuntimeNumber(value.reasoning)) return undefined;
		Object.assign(usage, { reasoning: value.reasoning });
	}
	return usage;
}

function decodeToolResult<Value>(value: Value): AgentToolResult<unknown> | undefined {
	if (!isRuntimeObject(value) || value === null || !("content" in value) || !isCodeModeToolContent(value.content)) {
		return undefined;
	}
	const result: AgentToolResult<unknown> = {
		content: [...value.content],
		details: "details" in value ? value.details : undefined,
	};
	if ("usage" in value && value.usage !== undefined) {
		const usage = decodeToolUsage(value.usage);
		if (usage) Object.assign(result, { usage });
	}
	if ("addedToolNames" in value && value.addedToolNames !== undefined) {
		if (Array.isArray(value.addedToolNames) && value.addedToolNames.every(isRuntimeString)) {
			Object.assign(result, { addedToolNames: [...value.addedToolNames] });
		}
	}
	if ("terminate" in value && value.terminate !== undefined) {
		if (isRuntimeBoolean(value.terminate)) Object.assign(result, { terminate: value.terminate });
	}
	return result;
}

function decodeOperationState<Value>(value: Value): SuiteToolEnvelopeOperation["state"] | undefined {
	if (!isRuntimeString(value)) return undefined;
	switch (value) {
		case "cancelled":
			return "cancelled";
		case "error":
			return "error";
		case "rejected":
			return "rejected";
		case "running":
			return "running";
		case "success":
			return "success";
		default:
			return undefined;
	}
}

function decodeOperation<Value>(value: Value): SuiteToolEnvelopeOperation | undefined {
	if (
		!isRuntimeObject(value) ||
		value === null ||
		!("args" in value) ||
		!isRuntimeObject(value.args) ||
		value.args === null ||
		Array.isArray(value.args) ||
		!("id" in value) ||
		!isRuntimeString(value.id) ||
		!("name" in value) ||
		!isRuntimeString(value.name) ||
		!("state" in value)
	) {
		return undefined;
	}
	const state = decodeOperationState(value.state);
	if (!state) return undefined;
	const operation: SuiteToolEnvelopeOperation = {
		args: Object.fromEntries(Object.entries(value.args)),
		id: value.id,
		name: value.name,
		state,
	};
	if ("attempt" in value && value.attempt !== undefined) {
		if (isRuntimeNumber(value.attempt)) Object.assign(operation, { attempt: value.attempt });
	}
	if ("executionId" in value && value.executionId !== undefined) {
		if (isRuntimeString(value.executionId)) Object.assign(operation, { executionId: value.executionId });
	}
	if ("mediaPlacements" in value && value.mediaPlacements !== undefined) {
		if (Array.isArray(value.mediaPlacements)) {
			const mediaPlacements: Array<{ readonly afterContentIndex: number; readonly mediaIndex: number }> = [];
			for (const placement of value.mediaPlacements) {
				if (
					!isRuntimeObject(placement) ||
					placement === null ||
					!("afterContentIndex" in placement) ||
					!isRuntimeNumber(placement.afterContentIndex) ||
					!("mediaIndex" in placement) ||
					!isRuntimeNumber(placement.mediaIndex)
				) {
					continue;
				}
				mediaPlacements.push({
					afterContentIndex: placement.afterContentIndex,
					mediaIndex: placement.mediaIndex,
				});
			}
			if (mediaPlacements.length > 0) Object.assign(operation, { mediaPlacements });
		}
	}
	if ("replayed" in value && value.replayed !== undefined) {
		if (isRuntimeBoolean(value.replayed)) Object.assign(operation, { replayed: value.replayed });
	}
	if ("result" in value && value.result !== undefined) {
		const result = decodeToolResult(value.result);
		if (result) Object.assign(operation, { result });
	}
	if ("sequence" in value && value.sequence !== undefined) {
		if (isRuntimeNumber(value.sequence)) Object.assign(operation, { sequence: value.sequence });
	}
	return operation;
}

export function decodeCodeModeOperations<Value>(details: Value): readonly SuiteToolEnvelopeOperation[] {
	if (
		!isRuntimeObject(details) ||
		details === null ||
		!("kind" in details) ||
		details.kind !== "pi-stuff-code-mode" ||
		!("operations" in details) ||
		!Array.isArray(details.operations)
	) {
		return [];
	}
	return details.operations.flatMap((value) => {
		const operation = decodeOperation(value);
		return operation ? [operation] : [];
	});
}

function showCodeModeFallback(
	args: ToolArguments,
	result: AgentToolResult<unknown>,
	state: "cancelled" | "error" | "rejected" | "running" | "success",
): boolean {
	if (state !== "running" && state !== "success") return true;
	if (isRuntimeString(args["code"]) && isControlOnlyProgram(args["code"])) return false;
	return !(
		state === "success" &&
		(result.content.length === 0 ||
			(result.content.length === 1 &&
				result.content[0]?.type === "text" &&
				result.content[0].text === CODE_MODE_NO_OUTPUT_MESSAGE))
	);
}

export function createCodeModeDefinition(
	runtime: CodeModeRuntime,
): ToolDefinition<typeof CODE_MODE_PARAMETERS, PiStuffCodeModeDetails> {
	return {
		description: CODE_MODE_DESCRIPTION,
		executionMode: "sequential",
		async execute(toolCallId, input, signal, onUpdate, context) {
			return runtime.execute(toolCallId, input.code, context, signal, onUpdate);
		},
		label: "Code Mode",
		name: CODE_MODE_TOOL_NAME,
		parameters: CODE_MODE_PARAMETERS,
		promptSnippet: "Use codemode to compose Pi Stuff Tools with JavaScript while returning only needed output",
	};
}

export function createCodeModeSearchDefinition(
	connector: Pick<SuiteCodeModeConnector, "describe" | "search">,
	ledger?: CodeModeSessionLedger,
): ToolDefinition<typeof CODE_MODE_SEARCH_PARAMETERS, CodeModeSearchDetails> {
	return {
		description:
			"Search Code Mode's active programmatic Tool catalog. Returns ranked matches and TypeScript signatures from the same catalog used by codemode.search/describe.",
		executionMode: "sequential",
		async execute(_toolCallId, input, _signal, _onUpdate, context) {
			const snippets = ledger?.snippets(context) ?? [];
			const search = connector.search(input.query, snippets);
			const projection = projectCodeModeSearchResponse(search, (result) =>
				connector.describe(result.path, snippets),
			);
			return {
				content: [
					{
						text: projection.text,
						type: "text",
					},
				],
				details: {
					paths: projection.paths,
					query: input.query,
					total: search.total,
					truncated: projection.truncated,
				},
			};
		},
		label: "Tool Search",
		name: CODE_MODE_SEARCH_TOOL_NAME,
		parameters: CODE_MODE_SEARCH_PARAMETERS,
		promptSnippet: "Use tool_search for Code Mode Tool discovery; call returned methods through codemode",
	};
}

export async function compensateCodeModeExecution(
	registry: SuiteToolDefinitionRegistry,
	ledger: CodeModeSessionLedger,
	context: Parameters<CodeModeSessionLedger["history"]>[0],
	executionId: string,
	signal?: AbortSignal,
): Promise<{ readonly compensated: number; readonly failures: readonly string[] }> {
	let compensated = 0;
	const failures: string[] = [];
	for (const target of ledger.compensationTargets(context, executionId)) {
		try {
			const invocation: Parameters<SuiteToolDefinitionRegistry["compensate"]>[0] = {
				context,
				executionId,
				input: target.input,
				name: target.name,
				result: target.value,
				sequence: target.sequence,
			};
			if (signal) Object.assign(invocation, { signal });
			const didCompensate = await registry.compensate(invocation);
			if (!didCompensate) continue;
			ledger.markCompensated(context, executionId, target.callId);
			compensated += 1;
		} catch (error) {
			failures.push(`${target.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (compensated > 0) ledger.markCompensationComplete(context, executionId);
	return { compensated, failures };
}

async function deliverCodeModeDecision(
	pi: SuiteAgentMessageHost,
	action: "approved" | "rejected",
	executionId: string,
	result?: AgentToolResult<PiStuffCodeModeDetails>,
): Promise<void> {
	const status = result?.details.status ?? "rejected";
	const message = withDirectUserActivation(
		withAgentWorkOrigin(
			{
				content: [
					{
						text: `Code Mode execution ${executionId} was ${action}; current status: ${status}.`,
						type: "text" as const,
					},
					...(result?.content ?? []),
				],
				customType: CODE_MODE_DECISION_MESSAGE_TYPE,
				details: result?.details ?? { executionId, status },
				display: true,
			},
			"user",
		),
	);
	await sendSuiteAgentMessage(pi, message, { deliverAs: "followUp", triggerTurn: true });
}

/** Register before context managers so they receive the provider-visible result, not the TUI projection. */
export function registerCodeModeContextProjection(pi: Pick<ExtensionAPI, "on">): void {
	pi.on("context", (event) => {
		const messages = rehydrateCodeModeMessages(event.messages);
		return messages ? { messages } : undefined;
	});
}

export default function piStuffCodeMode(pi: CodeModeHost, options: PiStuffCodeModeOptions): void {
	const connector = new SuiteCodeModeConnector(options.registry);
	const ledger = new CodeModeSessionLedger(pi);
	const runtime = new CodeModeRuntime(connector, new V8CodeModeExecutor(), ledger);
	const environmentDefault = environmentMode("PI_STUFF_CODE_MODE_DEFAULT");
	const defaultEnabled = environmentDefault ?? false;
	const frozenEnabled = environmentMode(CODE_MODE_FROZEN_ENV);
	let enabled = frozenEnabled ?? defaultEnabled;
	let effectiveSource: "frozen" | "project" | "global" | "environment" | "default" =
		frozenEnabled !== undefined ? "frozen" : environmentDefault !== undefined ? "environment" : "default";
	let projectEnabled: boolean | undefined;
	let globalEnabled: boolean | undefined;
	let projectBinding: string | undefined;
	let settingsOperation = Promise.resolve();
	registerSuiteToolEnvelope(pi, createCodeModeDefinition(runtime), {
		decode: decodeCodeModeOperations,
		media: decodeCodeModeMediaSegments,
		registry: options.registry,
		showFallback: showCodeModeFallback,
	});
	registerSuiteToolEnvelopeCompanion(
		pi,
		CODE_MODE_TOOL_NAME,
		createCodeModeSearchDefinition(connector, ledger),
		CODE_MODE_SEARCH_PRESENTATION,
	);

	const apply = (): void => {
		if (enabled) options.surface.enableEnvelope(CODE_MODE_TOOL_NAME);
		else options.surface.disableEnvelope(CODE_MODE_TOOL_NAME);
	};
	const applySettings = (): void => {
		enabled = frozenEnabled ?? projectEnabled ?? globalEnabled ?? defaultEnabled;
		effectiveSource =
			frozenEnabled !== undefined
				? "frozen"
				: projectEnabled !== undefined
					? "project"
					: globalEnabled !== undefined
						? "global"
						: environmentDefault !== undefined
							? "environment"
							: "default";
		apply();
	};
	const serializeSettings = <Value>(operation: () => Promise<Value>): Promise<Value> => {
		const result = settingsOperation.then(operation, operation);
		settingsOperation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	const bindingKey = (context: ExtensionContext): string =>
		`${context.isProjectTrusted() ? "trusted" : "untrusted"}\0${context.cwd}`;
	const loadProject = async (context: ExtensionContext, force = false): Promise<void> => {
		const key = bindingKey(context);
		if (!force && projectBinding === key) return;
		const previousBinding = projectBinding;
		try {
			const nextProjectEnabled =
				frozenEnabled === undefined && context.isProjectTrusted()
					? await readCodeModeProjectEnabled(context.cwd)
					: undefined;
			const nextGlobalEnabled = frozenEnabled === undefined ? await readCodeModeGlobalEnabled() : undefined;
			projectBinding = key;
			projectEnabled = nextProjectEnabled;
			globalEnabled = nextGlobalEnabled;
			applySettings();
		} catch (error) {
			if (previousBinding !== key) {
				projectBinding = undefined;
				enabled = frozenEnabled ?? defaultEnabled;
				projectEnabled = undefined;
				globalEnabled = undefined;
				effectiveSource =
					frozenEnabled !== undefined ? "frozen" : environmentDefault !== undefined ? "environment" : "default";
				apply();
			}
			throw error;
		}
	};
	const bindProject = (context: ExtensionContext, force = false): Promise<void> =>
		serializeSettings(() => loadProject(context, force));
	const persistProjectEnabled = (context: ExtensionContext, value: boolean | undefined): Promise<void> =>
		serializeSettings(async () => {
			if (!context.isProjectTrusted()) {
				throw new Error("Code Mode cannot persist settings for an untrusted project.");
			}
			await loadProject(context);
			await writeCodeModeProjectEnabled(context.cwd, value);
			projectEnabled = value;
			applySettings();
		});
	const persistGlobalEnabled = (context: ExtensionContext, value: boolean): Promise<void> =>
		serializeSettings(async () => {
			await loadProject(context);
			await writeCodeModeGlobalEnabled(value);
			globalEnabled = value;
			applySettings();
		});
	pi.registerCommand("codemode", {
		description: "Open Code Mode controls or manage its Session ledger",
		getArgumentCompletions: (prefix) => {
			if (/\s/u.test(prefix.trim())) return null;
			return [
				"on",
				"off",
				"global",
				"history",
				"pending",
				"approve",
				"reject",
				"snippets",
				"save",
				"delete",
				"abandon",
				"rollback",
				"compensate",
				"expire",
			]
				.filter((value) => value.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ label: value, value }));
		},
		handler: async (args, context) => {
			const parts = args.trim().split(/\s+/u).filter(Boolean);
			if (parts.length === 0) {
				if (!context.hasUI) {
					context.ui.notify(
						"/codemode requires interactive TUI mode; use /codemode on or /codemode off.",
						"warning",
					);
					return;
				}
				try {
					await bindProject(context);
					await getCommandDialogCoordinator(pi).show(
						context,
						createCodeModeDialogView({
							getSnapshot: () => ({
								effectiveSource,
								enabled,
								executionCount: ledger.history(context).length,
								fallbackEnabled: defaultEnabled,
								frozen: frozenEnabled !== undefined,
								globalEnabled,
								pendingCount: runtime.pending(context).length,
								projectEnabled,
								projectTrusted: context.isProjectTrusted(),
								snippetCount: ledger.snippets(context).length,
								toolCount: connector.catalog().length,
							}),
							setGlobalEnabled: (value) => persistGlobalEnabled(context, value),
							setProjectEnabled: (value) => persistProjectEnabled(context, value),
						}),
					);
				} catch (error) {
					context.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
			const [rawAction = "", ...rest] = parts;
			const action = rawAction.toLowerCase();
			try {
				if (action === "on" || action === "off") {
					await persistProjectEnabled(context, action === "on");
					context.ui.notify(`Code Mode ${enabled ? "on" : "off"}`, "info");
					return;
				}
				if (action === "global" && (rest[0] === "on" || rest[0] === "off")) {
					const value = rest[0] === "on";
					await persistGlobalEnabled(context, value);
					context.ui.notify(`Code Mode global default ${rest[0]}`, "info");
					return;
				}
				if (action === "history") {
					const history = ledger.history(context);
					context.ui.notify(
						history.length === 0
							? "No Code Mode executions in this Session."
							: history
									.map(
										(item) => `${item.executionId} · ${item.status} · ${String(item.toolCalls)} Tool call(s)`,
									)
									.join("\n"),
						"info",
					);
					return;
				}
				if (action === "pending") {
					const pending = runtime.pending(context);
					context.ui.notify(
						pending.length === 0
							? "No Code Mode action is awaiting approval."
							: pending
									.map(
										(action) =>
											`${action.executionId} · ${String(action.seq)} · tools.${action.method} · ${stringifyForStorage(action.args) ?? "undefined"}`,
									)
									.join("\n"),
						"info",
					);
					return;
				}
				if (action === "approve" && rest[0]) {
					await context.waitForIdle();
					const result = await runtime.approve(rest[0], context, context.signal);
					if (
						result.details.status === "error" &&
						result.details.operations.length === 0 &&
						result.details.error?.includes("is not paused")
					) {
						context.ui.notify(result.details.error, "warning");
						return;
					}
					await deliverCodeModeDecision(pi, "approved", rest[0], result);
					context.ui.notify(`Code Mode execution ${rest[0]} resumed: ${result.details.status}.`, "info");
					return;
				}
				if (action === "reject" && rest[0] && rest[1]) {
					const sequence = Number(rest[1]);
					if (!Number.isSafeInteger(sequence) || sequence < 0) {
						throw new Error("Code Mode rejection sequence must be a non-negative integer");
					}
					await context.waitForIdle();
					if (!(await runtime.reject(rest[0], sequence, context))) {
						context.ui.notify(
							"That Code Mode action is no longer pending; refresh the approval list.",
							"warning",
						);
						return;
					}
					await deliverCodeModeDecision(pi, "rejected", rest[0]);
					context.ui.notify(`Rejected Code Mode execution ${rest[0]} at step ${String(sequence)}.`, "info");
					return;
				}
				if (action === "snippets") {
					const snippets = ledger.snippets(context);
					context.ui.notify(
						snippets.length === 0
							? "No saved Code Mode snippets."
							: snippets
									.map(
										(snippet) =>
											`${JSON.stringify(snippet.name)}${snippet.description ? ` · ${snippet.description}` : ""}`,
									)
									.join("\n"),
						"info",
					);
					return;
				}
				if (action === "save" && rest[0] && rest[1]) {
					const snippet = ledger.saveSnippet(context, rest[0], rest[1], rest.slice(2).join(" "));
					context.ui.notify(`Saved Code Mode snippet ${JSON.stringify(snippet.name)}.`, "info");
					return;
				}
				if (action === "delete" && rest[0]) {
					context.ui.notify(
						ledger.deleteSnippet(context, rest[0])
							? `Deleted Code Mode snippet ${JSON.stringify(rest[0])}.`
							: `No Code Mode snippet ${JSON.stringify(rest[0])} exists.`,
						"info",
					);
					return;
				}
				if (action === "abandon" && rest[0]) {
					context.ui.notify(
						ledger.abandon(context, rest[0])
							? `Abandoned Code Mode execution ${rest[0]}. No Tool was repeated.`
							: `Execution ${rest[0]} is missing or no longer incomplete.`,
						"info",
					);
					return;
				}
				if (action === "expire") {
					const expired = ledger.expire(context);
					for (const executionId of expired) {
						const status = ledger.history(context, 100).find((item) => item.executionId === executionId)?.status;
						await connector.disposeExecution(executionId, status === "rejected" ? "rejected" : "error");
					}
					context.ui.notify(
						expired.length > 0
							? `Expired ${String(expired.length)} stale Code Mode execution(s).`
							: "No Code Mode execution is old enough to expire.",
						"info",
					);
					return;
				}
				if ((action === "rollback" || action === "compensate") && rest[0]) {
					const outcome = await compensateCodeModeExecution(
						options.registry,
						ledger,
						context,
						rest[0],
						context.signal,
					);
					if (outcome.failures.length > 0) {
						context.ui.notify(
							`Compensated ${String(outcome.compensated)} call(s); ${String(outcome.failures.length)} failed: ${outcome.failures.join("; ")}`,
							"error",
						);
					} else {
						if (outcome.compensated > 0) await connector.disposeExecution(rest[0], "rolled_back");
						context.ui.notify(
							outcome.compensated > 0
								? `Compensated ${String(outcome.compensated)} call(s) in reverse order.`
								: "No applied Tool in that execution declares a compensating operation.",
							"info",
						);
					}
					return;
				}
				context.ui.notify(
					"Usage: /codemode [on|off|global on|global off|history|pending|approve <execution-id>|reject <execution-id> <seq>|snippets|save <execution-id> <name> [description]|delete <name>|abandon <execution-id>|rollback <execution-id>|expire]",
					"warning",
				);
			} catch (error) {
				context.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
	pi.on("session_start", async (_event, context) => {
		await bindProject(context, true);
	});
	pi.on("model_select", apply);
	pi.on("before_agent_start", async (_event, context) => {
		await bindProject(context);
		apply();
	});
	pi.on("tool_result", (event) => {
		if (event.toolName !== CODE_MODE_TOOL_NAME) return undefined;
		const details = event.details;
		if (!isCodeModeModelContentOwner(details)) return undefined;
		const sanitized = sanitizeCodeModeContent(event.content);
		if (sanitized.rejected > 0) {
			const failedDetails = {
				...details,
				error: INVALID_CODE_MODE_IMAGE_MESSAGE,
				status: "error" as const,
			};
			captureCodeModeModelContent(failedDetails, sanitized.content);
			return { content: sanitized.content, details: failedDetails, isError: true };
		}
		captureCodeModeModelContent(details, event.content);
		if (
			"status" in details &&
			(details.status === "error" || details.status === "cancelled" || details.status === "incomplete")
		) {
			return { isError: true };
		}
		return undefined;
	});
	pi.on("tool_execution_end", (event) => {
		if (event.toolName !== CODE_MODE_TOOL_NAME) return;
		const separated = separateCodeModeMediaForUi(event.result);
		if (!separated) return;
		event.result.content = separated.content;
		event.result.details = separated.details;
	});
	pi.on("session_shutdown", async () => {
		await runtime.shutdown();
	});
}
