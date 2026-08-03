import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type CommandDialogView, getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
import { BTW_COMMAND_NAME, executeBtw } from "./btw.js";
import {
	type BtwExchange,
	btwSessionKey,
	clearBtwHistory,
	clearEarlierBtwHistory,
	evictBtwHistory,
	hydrateBtwHistory,
	readBtwHistory,
	recordBtwExchange,
} from "./btw-history.js";
import { BtwDialogController } from "./btw-ui.js";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function waitForMainIdle(ctx: ExtensionCommandContext, signal: AbortSignal): Promise<boolean> {
	if (signal.aborted) return Promise.resolve(false);
	return new Promise<boolean>((resolve, reject) => {
		let settled = false;
		const finish = (value: boolean): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abort);
			resolve(value);
		};
		const abort = (): void => finish(false);
		signal.addEventListener("abort", abort, { once: true });
		void ctx.waitForIdle().then(
			() => finish(true),
			(error: unknown) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}

function promotedAssistant(exchange: BtwExchange, ctx: ExtensionCommandContext): AssistantMessage {
	const response = exchange.response;
	const model = ctx.model;
	if (!response && !model) throw new Error("Could not fork BTW without model metadata");
	return {
		role: "assistant",
		content: [{ type: "text", text: exchange.answer }],
		api: response?.api ?? model?.api ?? "openai-completions",
		provider: response?.provider ?? model?.provider ?? "unknown",
		model: response?.model ?? model?.id ?? "unknown",
		usage: response?.usage ?? ZERO_USAGE,
		stopReason: response?.stopReason ?? "stop",
		timestamp: response?.timestamp ?? exchange.timestamp,
		...(response?.errorMessage === undefined ? {} : { errorMessage: response.errorMessage }),
	};
}

async function promoteBtwExchange(
	exchange: BtwExchange,
	ctx: ExtensionCommandContext,
	signal: AbortSignal,
): Promise<void> {
	if (!(await waitForMainIdle(ctx, signal)) || signal.aborted) return;
	const parentSession = ctx.sessionManager.getSessionFile();
	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: exchange.question }],
		timestamp: exchange.timestamp,
	};
	const assistantMessage = promotedAssistant(exchange, ctx);
	const result = await ctx.newSession({
		...(parentSession === undefined ? {} : { parentSession }),
		setup: async (sessionManager) => {
			sessionManager.appendMessage(userMessage);
			sessionManager.appendMessage(assistantMessage);
		},
	});
	if (result.cancelled) throw new Error("Could not fork BTW because the session switch was cancelled");
}

function runBtw(question: string | undefined, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	if (ctx.mode !== "tui") return Promise.resolve();

	const coordinator = getCommandDialogCoordinator(pi);
	const sessionKey = btwSessionKey(ctx);
	hydrateBtwHistory(sessionKey, ctx.sessionManager.getEntries());
	const history = readBtwHistory(sessionKey);
	const appendHistoryEntry = (customType: string, data: unknown): void => pi.appendEntry(customType, data);
	let resolveController: ((value: { controller: BtwDialogController; signal: AbortSignal }) => void) | undefined;
	const controllerReady = new Promise<{ controller: BtwDialogController; signal: AbortSignal }>((resolve) => {
		resolveController = resolve;
	});

	const view: CommandDialogView = {
		priority: "normal",
		create: ({ signal, tui, theme, close }) => {
			const controller = new BtwDialogController(theme, tui, {
				history,
				...(question === undefined ? {} : { question }),
				...(question === undefined && history.length === 0
					? { error: "No previous /btw exchange in this session." }
					: {}),
				onClose: () => close(),
				onClearEarlier: (currentId) => {
					if (currentId === undefined) clearBtwHistory(sessionKey, appendHistoryEntry);
					else clearEarlierBtwHistory(sessionKey, currentId, appendHistoryEntry);
				},
				onFork: (exchange, promotionSignal) => promoteBtwExchange(exchange, ctx, promotionSignal),
			});
			resolveController?.({ controller, signal });
			resolveController = undefined;
			return controller;
		},
	};

	const surface = coordinator.show(ctx, view);
	if (question !== undefined) {
		void controllerReady.then(async ({ controller, signal }) => {
			const result = await executeBtw(question, ctx, signal, {
				onTextDelta: (delta) => controller.appendText(delta),
				onRetry: () => controller.resetForRetry(),
			});
			if (result.kind === "success") {
				const response = result.assistantMessage;
				const exchange = recordBtwExchange(
					sessionKey,
					{
						question,
						answer: result.answer,
						timestamp: result.userMessage.timestamp,
						contextTrimmed: result.contextTrimmed,
						response: {
							api: response.api,
							provider: response.provider,
							model: response.model,
							usage: response.usage,
							stopReason: response.stopReason,
							timestamp: response.timestamp,
							...(response.errorMessage === undefined ? {} : { errorMessage: response.errorMessage }),
						},
					},
					appendHistoryEntry,
				);
				controller.setSuccess(exchange);
			} else if (result.kind === "error") {
				controller.setError(result.error, result.partial);
			}
		});
	}
	return surface.then(() => undefined);
}

export default function piStuffBtw(pi: ExtensionAPI): void {
	pi.registerCommand(BTW_COMMAND_NAME, {
		description: "Ask one side question without changing the main conversation",
		handler: (args, ctx) => runBtw(args.trim() || undefined, ctx, pi),
	});
	pi.on("session_shutdown", (_event, ctx) => {
		evictBtwHistory(btwSessionKey(ctx));
	});
}
