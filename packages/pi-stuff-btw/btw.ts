/**
 * One-shot BTW model call.
 *
 * This module knows nothing about commands or TUI state. It snapshots Pi's
 * effective context once, performs one independently-cancellable no-tool
 * stream, and returns a value. Display history never crosses this boundary.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Api, AssistantMessage, Message, Model, StopReason, UserMessage } from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai";
import {
	type ContextEvent,
	convertToLlm,
	type ExtensionContext,
	type SessionEntry,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { projectCurrentContext } from "@jczhang02/pi-stuff-context";
import { fitBranch } from "./btw-budget.js";
import { assistantMessageText } from "./btw-messages.js";
import { openBtwStream } from "./pi-compat.js";

export const BTW_COMMAND_NAME = "btw";

const ERR_EMPTY_RESPONSE = "/btw returned no text content.";
const ERR_PROVIDER_ABORT = "/btw was aborted by the model provider.";
const ERR_TOOL_ATTEMPT = "/btw attempted to call a tool even though tools are disabled.";
const ERR_NO_MODEL = "/btw requires an active model.";

const BTW_SYSTEM_PROMPT = readFileSync(
	fileURLToPath(new URL("./prompts/btw-system.txt", import.meta.url)),
	"utf8",
).trimEnd();

interface BtwBuiltContext {
	readonly messages: Message[];
	readonly systemPrompt: string;
	readonly branchWasTrimmed: boolean;
	readonly stubbed: boolean;
	readonly keepBudget: number;
}

export interface BtwStreamObserver {
	onTextDelta?(delta: string): void;
	onRetry?(): void;
	onFinalText?(text: string): void;
}

export type BtwExecResult =
	| {
			readonly kind: "success";
			readonly answer: string;
			readonly userMessage: UserMessage;
			readonly assistantMessage: AssistantMessage;
			readonly stopReason: StopReason;
			readonly contextTrimmed: boolean;
	  }
	| {
			readonly kind: "error";
			readonly error: string;
			readonly partial: string;
			readonly stopReason?: StopReason;
	  }
	| { readonly kind: "aborted"; readonly partial: string; readonly stopReason: "aborted" };

export type OpenBtwStream = typeof openBtwStream;

function isPendingAssistant(entry: SessionEntry | undefined): boolean {
	return entry?.type === "message" && entry.message.role === "assistant" && entry.message.stopReason === "pending";
}

/** Pi's effective active context, with compaction/branch summaries applied. */
export function readEffectiveContext(ctx: Pick<ExtensionContext, "sessionManager">): {
	entries: SessionEntry[];
	contextMessages: ContextEvent["messages"];
	messages: Message[];
} {
	const entries = ([...ctx.sessionManager.buildContextEntries()] as SessionEntry[]).filter(
		(entry) => !isPendingAssistant(entry),
	);
	const contextMessages = entries.flatMap((entry) => sessionEntryToContextMessages(entry));
	const messages = convertToLlm(contextMessages);
	return { contextMessages, entries, messages };
}

function buildBtwMessages(
	ctx: ExtensionContext,
	model: Model<Api>,
	userMessage: UserMessage,
	contextProjection: string,
	keepBudget?: number,
	effectiveContext: ReturnType<typeof readEffectiveContext> = readEffectiveContext(ctx),
): BtwBuiltContext {
	const { entries, messages } = effectiveContext;
	const systemPrompt = contextProjection ? `${BTW_SYSTEM_PROMPT}\n\n${contextProjection}` : BTW_SYSTEM_PROMPT;
	const fit = fitBranch({
		entries,
		messages,
		model,
		systemPrompt,
		question: userMessage,
		...(keepBudget === undefined ? {} : { keepBudget }),
	});
	return {
		messages: [...fit.messages, userMessage],
		systemPrompt,
		branchWasTrimmed: fit.branchWasTrimmed,
		stubbed: fit.stubbed,
		keepBudget: fit.keepBudget,
	};
}

interface AttemptResult {
	readonly response: AssistantMessage;
	readonly partial: string;
	readonly sawToolAttempt: boolean;
}

async function consumeAttempt(
	stream: Awaited<ReturnType<OpenBtwStream>>,
	signal: AbortSignal,
	observer: BtwStreamObserver,
): Promise<AttemptResult> {
	let partial = "";
	let sawToolAttempt = false;
	for await (const event of stream) {
		if (signal.aborted) continue;
		if (event.type === "text_delta") {
			partial += event.delta;
			observer.onTextDelta?.(event.delta);
		} else if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
			sawToolAttempt = true;
		}
	}
	return { response: await stream.result(), partial, sawToolAttempt };
}

function callError(message: string): string {
	return `/btw call failed: ${message}`;
}

function errorResult(error: string, partial: string, stopReason?: StopReason): BtwExecResult {
	return {
		kind: "error",
		error,
		partial,
		...(stopReason === undefined ? {} : { stopReason }),
	};
}

/**
 * Execute a side call. `signal` belongs to the Suite Command Dialog frame and
 * must not be ctx.signal; closing BTW therefore cannot cancel the main Agent.
 */
export async function executeBtw(
	question: string,
	ctx: ExtensionContext,
	signal: AbortSignal,
	observer: BtwStreamObserver = {},
	openStream: OpenBtwStream = openBtwStream,
): Promise<BtwExecResult> {
	const model = ctx.model as Model<Api> | undefined;
	if (!model) return errorResult(ERR_NO_MODEL, "");

	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: question }],
		timestamp: Date.now(),
	};
	let built: BtwBuiltContext;
	let effectiveContext: ReturnType<typeof readEffectiveContext>;
	let contextProjection: string;
	try {
		effectiveContext = readEffectiveContext(ctx);
		contextProjection = (
			await projectCurrentContext("btw", ctx, { sourceMessages: effectiveContext.contextMessages })
		).text;
		built = buildBtwMessages(ctx, model, userMessage, contextProjection, undefined, effectiveContext);
	} catch (error) {
		return errorResult(callError(error instanceof Error ? error.message : String(error)), "");
	}

	let partial = "";
	let retried = false;
	try {
		while (true) {
			if (signal.aborted) return { kind: "aborted", partial: "", stopReason: "aborted" };
			const stream = await openStream({
				ctx,
				model,
				context: { systemPrompt: built.systemPrompt, messages: built.messages, tools: [] },
				signal,
			});
			const attempt = await consumeAttempt(stream, signal, observer);
			partial = attempt.partial;
			const { response } = attempt;

			if (signal.aborted) {
				return { kind: "aborted", partial, stopReason: "aborted" };
			}
			if (response.stopReason === "aborted") return errorResult(ERR_PROVIDER_ABORT, partial, "aborted");
			if (!retried && isContextOverflow(response, model.contextWindow)) {
				retried = true;
				partial = "";
				observer.onRetry?.();
				built = buildBtwMessages(
					ctx,
					model,
					userMessage,
					contextProjection,
					Math.max(0, Math.floor(built.keepBudget / 2)),
					effectiveContext,
				);
				continue;
			}
			if (attempt.sawToolAttempt || response.stopReason === "toolUse") {
				return errorResult(ERR_TOOL_ATTEMPT, partial, response.stopReason);
			}
			if (response.stopReason === "error") {
				return errorResult(callError(response.errorMessage ?? "unknown error"), partial, response.stopReason);
			}

			const answer = assistantMessageText(response).trim();
			if (!answer) return errorResult(ERR_EMPTY_RESPONSE, partial, response.stopReason);
			observer.onFinalText?.(answer);
			return {
				kind: "success",
				answer,
				userMessage,
				assistantMessage: response,
				stopReason: response.stopReason,
				contextTrimmed: built.branchWasTrimmed || built.stubbed,
			};
		}
	} catch (error) {
		if (signal.aborted) return { kind: "aborted", partial: "", stopReason: "aborted" };
		return errorResult(callError(error instanceof Error ? error.message : String(error)), partial);
	}
}
