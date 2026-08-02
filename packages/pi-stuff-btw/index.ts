import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type CommandDialogView, getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
import { BTW_COMMAND_NAME, executeBtw } from "./btw.js";
import {
	btwSessionKey,
	clearBtwHistory,
	clearEarlierBtwHistory,
	readBtwHistory,
	recordBtwExchange,
} from "./btw-history.js";
import { BtwDialogController } from "./btw-ui.js";

function runBtw(question: string | undefined, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	if (ctx.mode !== "tui") return Promise.resolve();

	const coordinator = getCommandDialogCoordinator(pi);
	const sessionKey = btwSessionKey(ctx);
	const history = readBtwHistory(sessionKey);
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
					if (currentId === undefined) clearBtwHistory(sessionKey);
					else clearEarlierBtwHistory(sessionKey, currentId);
				},
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
				const exchange = recordBtwExchange(sessionKey, {
					question,
					answer: result.answer,
					timestamp: result.userMessage.timestamp,
					contextTrimmed: result.contextTrimmed,
				});
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
}
