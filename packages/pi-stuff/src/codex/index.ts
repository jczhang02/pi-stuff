import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCodexStatusChannel, getCommandDialogCoordinator } from "../conversation-ui/index.js";
import { type CodexControls, createCodexDialogView } from "./dialog.js";
import { CodexSettingsStore } from "./settings.js";
import { registerCodexTools } from "./tools.js";
import { type CodexUsageSnapshot, fetchCodexUsage, formatCodexUsage, weeklyRemainingPercent } from "./usage.js";

function requestPayloadWithFast(payload: unknown): unknown | undefined {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
	return { ...(payload as Record<string, unknown>), service_tier: "priority" };
}

export default async function piStuffCodex(pi: ExtensionAPI): Promise<void> {
	const settings = await CodexSettingsStore.load();
	const status = getCodexStatusChannel(pi);
	const tools = registerCodexTools(pi);
	let usage: CodexUsageSnapshot | undefined;

	const publishStatus = (): void => {
		const weekly = weeklyRemainingPercent(usage);
		status.publish({
			fastEnabled: settings.get().fast,
			...(weekly === undefined ? {} : { weeklyRemainingPercent: weekly }),
		});
	};
	const controls = (ctx: ExtensionContext): CodexControls => ({
		getFast: () => settings.get().fast,
		getUsage: () => usage,
		async refreshUsage(signal) {
			usage = await fetchCodexUsage(ctx, fetch, signal);
			publishStatus();
			return usage;
		},
		async setFast(enabled) {
			await settings.setFast(enabled);
			publishStatus();
		},
	});

	publishStatus();
	pi.registerCommand("codex", {
		description: "Open Codex Fast and usage controls",
		getArgumentCompletions: (prefix) =>
			["fast", "usage"]
				.filter((value) => value.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ label: value, value })),
		handler: async (args, ctx) => {
			const argument = args.trim().toLowerCase();
			const model = controls(ctx);
			if (argument === "fast") {
				try {
					await model.setFast(!model.getFast());
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
			if (argument && argument !== "usage") {
				ctx.ui.notify("Usage: /codex [fast|usage]", "warning");
				return;
			}
			if (!ctx.hasUI) {
				try {
					ctx.ui.notify(formatCodexUsage(await model.refreshUsage(ctx.signal)), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
			await getCommandDialogCoordinator(pi).show(ctx, createCodexDialogView(model));
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== "openai-codex" || !settings.get().fast) return undefined;
		return requestPayloadWithFast(event.payload);
	});
	pi.on("session_start", (_event, ctx) => {
		tools.sync(ctx.model);
		publishStatus();
	});
	pi.on("model_select", (_event, ctx) => tools.sync(ctx.model));
	pi.on("session_shutdown", () => {
		tools.deactivate();
		status.clear();
	});
}
