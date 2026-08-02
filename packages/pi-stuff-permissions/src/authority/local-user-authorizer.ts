import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";
import type { PermissionPromptDecision, RequestPermissionOptions } from "#src/authority/permission-dialog";
import type { PromptPreferences, requestPermissionDecision } from "#src/authority/permission-prompt-component";
import { buildForwardedScopeLabels } from "#src/pattern-suggest";
import { emitUiPromptEvent, type PermissionEventBus } from "#src/permission-events";
import { buildUiPrompt } from "#src/permission-ui-prompt";
import type { TerminalAuthorizer } from "./authorizer";
import type { PromptPermissionDetails } from "./permission-prompter";

/** Dependencies required by {@link LocalUserAuthorizer}. */
export interface LocalUserAuthorizerDeps {
	/** The active session context used by the shared Command Dialog host. */
	ctx: ExtensionContext;
	coordinator: CommandDialogCoordinator;
	/** Event bus used for the `permissions:ui_prompt` broadcast. */
	events: PermissionEventBus;
	/** Read live at prompt time so a settings-modal toggle takes effect on the next prompt. */
	getPromptPreferences: () => PromptPreferences;
	/** Injected for testability; production callers pass the real function. */
	requestPermissionDecision: typeof requestPermissionDecision;
}

/**
 * Authorizer for a session with an active UI: prompt the human here.
 *
 * Emits the `permissions:ui_prompt` broadcast (moved here from
 * `PermissionPrompter`'s `ctx.hasUI` arm) before showing the dialog, so
 * observers know a decision is imminent. This is the single emit site: a
 * forwarded ask carries its provenance on `details.forwarding`, which this
 * class renders (populated `forwarding` context + "(Subagent)" title) so the
 * broadcast stays non-degraded (#292) without a second emission path.
 */
export class LocalUserAuthorizer implements TerminalAuthorizer {
	constructor(private readonly deps: LocalUserAuthorizerDeps) {}

	authorize(details: PromptPermissionDetails): Promise<PermissionPromptDecision> {
		const uiPrompt = buildUiPrompt(details);
		emitUiPromptEvent(this.deps.events, uiPrompt);
		const requester = details.forwarding?.requesterAgentName ?? details.agentName ?? "current agent";
		const exactTitle = details.tripwire ? `Bash command · from ${requester}` : undefined;
		return this.deps.requestPermissionDecision(
			{
				ctx: this.deps.ctx,
				coordinator: this.deps.coordinator,
				doublePressToConfirm: this.deps.getPromptPreferences().doublePressToConfirm,
			},
			exactTitle ?? (details.forwarding ? "Permission Required (Subagent)" : "Permission Required"),
			details.message,
			buildRequestOptions(details),
		);
	}
}

/**
 * A forwarded ask carrying a session-approval suggestion offers the scope
 * choice (subagent vs whole session); any other ask keeps its single
 * "for this session" option (custom label when the gate supplied one).
 */
function buildRequestOptions(details: PromptPermissionDetails): RequestPermissionOptions | undefined {
	if (details.exactCallOnly) {
		return {
			exactCallOnly: true,
			...(details.tripwire
				? {
						exactCallEvidence: {
							requester: details.forwarding?.requesterAgentName ?? details.agentName ?? "current agent",
							command: details.tripwire.command,
							reason: details.tripwire.reason,
							operation: details.tripwire.operation,
							cwd: details.tripwire.cwd,
							targets: [...details.tripwire.targets],
						},
					}
				: {}),
		};
	}
	const pattern = details.sessionApproval?.patterns[0];
	if (details.forwarding && details.sessionApproval && pattern) {
		return {
			sessionScope: buildForwardedScopeLabels(
				details.forwarding.requesterAgentName,
				details.sessionApproval.surface,
				pattern,
			),
		};
	}
	return details.sessionLabel ? { sessionLabel: details.sessionLabel } : undefined;
}
