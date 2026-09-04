import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { reportDiagnostic } from "../conversation-ui/index.js";
import type { ContextStatusChannel } from "../conversation-ui/statusline-channels.js";
import { boundedContextInputCapacity, estimateProviderPayloadTokens } from "../shared/provider-payload.js";
import { applyContextPromptContributionsToProvider } from "./prompt-contributions.js";
import type { ContextCapabilityRuntime } from "./runtime.js";

export function registerContextProviderBoundary(
	pi: ExtensionAPI,
	runtime: ContextCapabilityRuntime,
	status: ContextStatusChannel,
): void {
	let providerPromptDiagnosticReported = false;
	pi.on("before_provider_request", async (event, ctx) => {
		const candidateToken = runtime.currentProviderProjectionToken();
		const projection = await applyContextPromptContributionsToProvider(pi, event.payload, ctx);
		if (projection.active && !projection.found && !providerPromptDiagnosticReported) {
			providerPromptDiagnosticReported = true;
			reportDiagnostic({
				capability: "Context",
				error: new Error("Provider payload has no supported system-prompt field."),
				key: "provider-prompt-contribution",
				severity: "warning",
				summary: "A Context prompt contribution could not be projected into this Provider request",
				visibility: "silent",
			});
		}
		const payload = projection.payload;
		if (runtime.status().state !== "active") return payload === event.payload ? undefined : payload;
		const capacity = boundedContextInputCapacity(ctx.model);
		const contextWindow = ctx.model?.contextWindow;
		let estimatedTokens: number | undefined;
		try {
			const serialized = JSON.stringify(payload);
			if (serialized !== undefined) estimatedTokens = estimateProviderPayloadTokens(serialized, ctx.model);
		} catch {
			// An unmeasurable Provider payload cannot establish a Bounded Context Projection.
		}
		if (
			capacity === undefined ||
			contextWindow === undefined ||
			estimatedTokens === undefined ||
			!Number.isFinite(estimatedTokens) ||
			estimatedTokens > capacity
		) {
			status.publish({ state: "unknown" });
			ctx.abort();
			ctx.ui.notify(
				"Provider request was stopped because Context could not establish a Bounded Context Projection.",
				"error",
			);
			return undefined;
		}
		runtime.markProviderProjectionValidated(candidateToken, ctx.model);
		status.publish({
			state: "validated",
			tokens: estimatedTokens,
			contextWindow,
		});
		return payload === event.payload ? undefined : payload;
	});
	pi.on("message_end", (event: { message: { role: string; stopReason?: string } }) => {
		if (event.message.role !== "assistant") return;
		if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
			status.publish({ state: "unknown" });
			return;
		}
		status.clear();
	});
}
