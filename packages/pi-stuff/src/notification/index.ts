import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type CommandDialogCoordinatorHost,
	getCommandDialogCoordinator,
	readCurrentAgentWorkOrigin,
	reportDiagnostic,
} from "../conversation-ui/index.js";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import { extractNotificationPreview, formatNotificationContent } from "./format.js";
import { createNotificationSettingsView } from "./notification-settings-dialog.js";
import { type NotificationClock, NotificationRuntime, type NotificationRuntimeEvent } from "./runtime.js";
import { type NotificationSettings, NotificationSettingsStore } from "./settings.js";
import { sendTerminalNotification, type TerminalNotificationResult } from "./transport.js";

const SYSTEM_CLOCK: NotificationClock = {
	clearTimeout: (timer) => {
		// SAFETY: this paired clock adapter only receives handles returned by its platform setTimeout implementation.
		clearTimeout(timer as ReturnType<typeof setTimeout>);
	},
	now: Date.now,
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export type NotificationHost = CommandDialogCoordinatorHost & Pick<ExtensionAPI, "registerCommand">;

function sessionLabel(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionName()?.trim() || basename(ctx.cwd) || "Pi session";
}

function notify(
	ctx: ExtensionContext,
	settings: NotificationSettings,
	title: string,
	body: string,
): TerminalNotificationResult {
	const result = sendTerminalNotification({
		body,
		delivery: settings.delivery,
		hasUI: ctx.hasUI,
		mode: ctx.mode,
		terminalBell: settings.terminalBell,
		title,
	});
	if (result === "failed") {
		reportDiagnostic({
			capability: "Notification",
			key: "transport-write",
			severity: "warning",
			summary: "The terminal notification could not be written",
		});
	}
	return result;
}

function sendTestNotification(ctx: ExtensionContext, settings: NotificationSettings): void {
	const result = notify(ctx, settings, "Pi · Notification test", "Notifications are working.");
	if (result === "sent") return;
	ctx.ui.notify(
		result === "unsupported"
			? "No supported terminal notification protocol was detected. Choose a delivery mode in /notifications."
			: "The test notification could not be sent.",
		"warning",
	);
}

export async function installNotificationCapability(
	pi: NotificationHost,
	settings: NotificationSettingsStore,
	clock: NotificationClock = SYSTEM_CLOCK,
): Promise<void> {
	const dialogs = getCommandDialogCoordinator(pi);
	let active: NotificationRuntime | undefined;
	let removeTerminalInput: (() => void) | undefined;
	let settledObserverRegistered = false;

	pi.registerCommand("notifications", {
		description: "Configure and test desktop notifications",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify("/notifications requires interactive TUI mode.", "warning");
				return;
			}
			await dialogs.show(
				ctx,
				createNotificationSettingsView(settings, {
					onPersistenceError: (message) => ctx.ui.notify(message, "error"),
					onTest: () => sendTestNotification(ctx, settings.get()),
				}),
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		active?.dispose();
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		const runtime = new NotificationRuntime({
			clock,
			getSettings: () => settings.get(),
			isQuiet: () => ctx.isIdle() && !ctx.hasPendingMessages(),
			notify: (alert) => {
				const current = settings.get();
				const notification: Parameters<typeof formatNotificationContent>[0] = {
					includeResponsePreview: current.responsePreview,
					outcome: alert.outcome,
					session: sessionLabel(ctx),
				};
				if (alert.preview) Object.assign(notification, { preview: alert.preview });
				const content = formatNotificationContent(notification);
				notify(ctx, current, content.title, content.body);
			},
		});
		active = runtime;
		if (ctx.mode === "tui" && ctx.hasUI) {
			removeTerminalInput = ctx.ui.onTerminalInput(() => {
				runtime.observe({ type: "terminal_input" });
				return undefined;
			});
		}
		if (!settledObserverRegistered) {
			settledObserverRegistered = true;
			pi.on("agent_settled", () => active?.observe({ type: "agent_settled" }));
		}
	});
	pi.on("input", () => active?.observe({ type: "input" }));
	pi.on("agent_start", () => active?.observe({ type: "agent_start" }));
	pi.on("agent_end", () => active?.observe({ type: "agent_end" }));
	pi.on("message_start", () => {
		if (active && readCurrentAgentWorkOrigin(pi) === "user") active.observe({ type: "user_work" });
	});
	pi.on("message_end", (event) => {
		if (!active || event.message.role !== "assistant") return;
		const preview = extractNotificationPreview(event.message.content);
		const observation: NotificationRuntimeEvent = {
			stopReason: event.message.stopReason,
			type: "assistant_finalized",
		};
		if (event.message.errorMessage !== undefined) {
			Object.assign(observation, { errorMessage: event.message.errorMessage });
		}
		if (preview) Object.assign(observation, { preview });
		active.observe(observation);
	});
	pi.on("session_shutdown", async () => {
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		active?.dispose();
		active = undefined;
		await settleWithin(settings.whenIdle(), HOST_SHUTDOWN_GRACE_MS);
	});
}

export default async function piStuffNotification(pi: NotificationHost): Promise<void> {
	await installNotificationCapability(pi, await NotificationSettingsStore.load());
}
