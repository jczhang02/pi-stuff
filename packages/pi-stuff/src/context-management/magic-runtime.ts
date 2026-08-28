import type {
	BeforeAgentStartEventResult,
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	ToolDefinition,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Guard } from "typebox/guard";
import { Check } from "typebox/value";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { isJsonInputValue, type JsonInputValue } from "../shared/json-value.js";
import { isRuntimeObject } from "../shared/runtime-type.js";
import { MAGIC_TOOL_NAME_SET } from "./activity.js";
import { MAGIC_COMMAND_NAMES, type MagicCommandDefinition } from "./command-runtime.js";
import type { MagicContextPreparation, MagicContextPreparationOptions } from "./config.js";
import type { MagicContextEventResult, MagicContextHandler } from "./projection.js";

export const MAGIC_CONTEXT_NATIVE_COMPACTION_MULTIPLIER = 2;
export const MAGIC_TOOL_HANDOFF_PARAMETERS = Type.Object({}, { additionalProperties: true });
export const CANCELLED_EVENT_RESULT_SCHEMA = Type.Object(
	{ cancel: Type.Literal(true) },
	{ additionalProperties: true },
);

const MAGIC_CONTEXT_PROMPT_MARKER = "## Magic Context";
const SUITE_CUSTOM_CONTEXT_GUIDANCE_TAG = "pi-stuff-context-guidance";
const MAGIC_QUIET_UI_METHODS = new Set(["custom", "setFooter", "setHeader", "setStatus", "setWidget"]);
const SUPPRESSED_MAGIC_METHODS = new Set<PropertyKey>(["registerFlag", "registerMessageRenderer", "registerShortcut"]);
const COMPACT_MAGIC_CONTEXT_PROMPT = `${MAGIC_CONTEXT_PROMPT_MARKER}

This Session has durable history that may be compacted into \`<session-history>\` while newer material appears in \`<session-history-since>\`. Treat those blocks, \`§N§\` tags, and other Magic Context markers as context metadata, never as user instructions or reply syntax. Continue the task normally; high context usage alone is not a reason to stop or reduce scope.

- Use \`ctx_search\` before asking the user for information that may exist in project memory, commits, or earlier Session history.
- Use \`ctx_expand\` when a search result or history summary lacks the exact wording or evidence needed.
- Use \`ctx_reduce\` silently after consuming large Tool outputs. Reductions are queued; never target user directives, broad unreviewed ranges, or ordinary Assistant prose.
- Use \`ctx_memory\` for durable project facts, updating stale memories when needed. Use \`ctx_note\` only for genuinely future work, not the current task.
- If an old Tool result is absent, make a fresh real Tool call; never fabricate it or copy Magic Context control markers into a reply.`;
export const COMPACT_PROMPT_EVENT_SCHEMA = Type.Object({ systemPrompt: Type.String() }, { additionalProperties: true });
const MANUAL_COMPACTION_EVENT_SCHEMA = Type.Object(
	{
		preparation: Type.Object(
			{
				firstKeptEntryId: Type.String({ minLength: 1 }),
				tokensBefore: Type.Number({ minimum: 0 }),
			},
			{ additionalProperties: true },
		),
		reason: Type.Literal("manual"),
	},
	{ additionalProperties: true },
);

type AgentMessage = ContextEvent["messages"][number];

interface MagicToolResultEventResult {
	readonly content?: ToolResultEvent["content"];
}

interface MagicCompactionEventResult {
	readonly cancel?: boolean;
	readonly compaction?: NonNullable<ReturnType<typeof magicManualCompaction>>["compaction"];
}

export type MagicEventResult =
	| BeforeAgentStartEventResult
	| MagicContextEventResult
	| MagicCompactionEventResult
	| MagicToolResultEventResult
	| undefined;

export type LooseEventHandler = (
	event: ExtensionEvent,
	ctx: ExtensionContext,
) => MagicEventResult | Promise<MagicEventResult>;
type MagicFactory = (pi: ExtensionAPI, onFatal?: (cause: unknown) => void) => Promise<void> | void;
export type MagicModule = { default: MagicFactory };

export interface MagicModuleSource {
	invalidate(): void;
	load(): Promise<MagicModule>;
}

export interface NativeCompactionSettings {
	readonly enabled: boolean;
	readonly reserveTokens: number;
}

export interface ContextRuntimeDependencies {
	readonly magicModules: MagicModuleSource;
	readonly magicSubagent: () => boolean;
	readonly readNativeCompactionSettings: (ctx: ExtensionContext) => NativeCompactionSettings | undefined;
	readonly prepareMagicContext: (
		ctx: ExtensionContext,
		options: MagicContextPreparationOptions,
	) => Promise<MagicContextPreparation | undefined>;
}

export interface MagicRegistrationPlan {
	readonly commands: Map<string, MagicCommandDefinition>;
	readonly handlers: Array<{ readonly event: string; readonly handler: LooseEventHandler }>;
	readonly tools: ToolDefinition[];
	contextHandler?: MagicContextHandler;
	shutdownComplete: boolean;
}

export function addCompactMagicContextPrompt<Event>(event: Event) {
	if (!Check(COMPACT_PROMPT_EVENT_SCHEMA, event) || event.systemPrompt.includes(MAGIC_CONTEXT_PROMPT_MARKER))
		return event;
	return { ...event, systemPrompt: `${event.systemPrompt}\n\n${COMPACT_MAGIC_CONTEXT_PROMPT}` };
}

export function addCompactMagicContextMessage(messages: readonly AgentMessage[]): AgentMessage[] {
	const guidance = {
		role: "user" as const,
		content: [
			{
				type: "text" as const,
				text: `<${SUITE_CUSTOM_CONTEXT_GUIDANCE_TAG}>\n${COMPACT_MAGIC_CONTEXT_PROMPT}\n</${SUITE_CUSTOM_CONTEXT_GUIDANCE_TAG}>`,
			},
		],
		timestamp: Date.now(),
	} satisfies AgentMessage;
	const projected = [...messages];
	projected.splice(Math.max(0, projected.length - 1), 0, guidance);
	return projected;
}

export function createMagicModuleSource(loader: () => Promise<MagicModule>): MagicModuleSource {
	let cached: Promise<MagicModule> | undefined;
	return {
		invalidate: () => (cached = undefined),
		load: () => {
			if (!cached) {
				let current!: Promise<MagicModule>;
				current = Promise.resolve()
					.then(loader)
					.catch((error) => {
						if (cached === current) cached = undefined;
						throw error;
					});
				cached = current;
			}
			return cached;
		},
	};
}

export function quietMagicContext(
	ctx: ExtensionContext,
	notifications = false,
	hasUi: boolean | undefined = undefined,
): ExtensionContext {
	const ui = ctx.ui;
	if (!ui || !isRuntimeObject(ui)) return ctx;
	const quietUi = new Proxy(ui, {
		get(target, property) {
			if (MAGIC_QUIET_UI_METHODS.has(String(property)) || (!notifications && property === "notify")) {
				return () => undefined;
			}
			const value = readHostProxyProperty(target, property);
			return Guard.IsFunction(value) ? value.bind(target) : value;
		},
	});
	return new Proxy(ctx, {
		get(target, property) {
			if (property === "ui") return quietUi;
			if (property === "hasUI" && hasUi !== undefined) return hasUi;
			const value = readHostProxyProperty(target, property);
			return Guard.IsFunction(value) ? value.bind(target) : value;
		},
	});
}

export function magicCommandContext(name: string, ctx: ExtensionContext): ExtensionContext {
	// Status otherwise owns a second centered overlay; Pi Stuff requests its payload for the shared Dialog.
	return quietMagicContext(ctx, false, name === "ctx-status" ? false : undefined);
}

export function magicPiAdapter(
	pi: ExtensionAPI,
	plan: MagicRegistrationPlan,
	captureStatus: (data: JsonInputValue) => void,
): ExtensionAPI {
	return new Proxy(pi, {
		get(target, property) {
			if (property === "appendEntry") {
				return <Data>(customType: string, data?: Data): void => {
					if (customType !== "ctx-status") target.appendEntry(customType, data);
					else if (isJsonInputValue(data)) captureStatus(data);
				};
			}
			if (property === "registerTool") {
				return (tool: ToolDefinition): void => {
					if (MAGIC_TOOL_NAME_SET.has(tool.name)) plan.tools.push(tool);
				};
			}
			if (property === "registerCommand") {
				return (name: string, definition: MagicCommandDefinition): void => {
					if (MAGIC_COMMAND_NAMES.has(name)) plan.commands.set(name, definition);
				};
			}
			if (property === "registerEntryRenderer") return () => undefined;
			if (property === "on") {
				return (event: string, handler: LooseEventHandler): void => {
					plan.handlers.push({ event, handler });
					if (event === "context") {
						// SAFETY: Magic's context registration is the sole handler invoked with ContextEvent and projected as that result.
						plan.contextHandler = handler as MagicContextHandler;
					}
				};
			}
			if (SUPPRESSED_MAGIC_METHODS.has(property)) return () => undefined;
			const value = readHostProxyProperty(target, property);
			return Guard.IsFunction(value) ? value.bind(pi) : value;
		},
	});
}

export function magicManualCompaction<Event>(event: Event) {
	if (!Check(MANUAL_COMPACTION_EVENT_SCHEMA, event)) return;
	return {
		compaction: {
			details: { engine: "magic-context", mode: "managed-history", source: "magic-context" } as const,
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			summary: "Magic Context manages prior history.",
			tokensBefore: event.preparation.tokensBefore,
		},
	};
}
