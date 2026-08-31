import type { AgentEffectOwner } from "./agent-effect-owner.ts";
import { AgentExecutionCoordinator, type AgentExecutionSessionIdentity } from "./agent-execution-coordinator.ts";
import { AgentExecutionGovernor } from "./agent-execution-governor.ts";
import { SessionAgentGovernor, type SessionGovernorLimitInput } from "./session-governor.ts";

export interface DurableAgentExecutionCoordinatorOptions {
	readonly effects: AgentEffectOwner;
	readonly rootDir: string;
	readonly limits?: SessionGovernorLimitInput;
	readonly isPidAlive?: (pid: number) => boolean | undefined;
	readonly readProcessStartIdentity?: (pid: number) => string | undefined;
	readonly readSystemBootIdentity?: () => string | undefined;
}

export function createDurableAgentExecutionCoordinator(
	options: DurableAgentExecutionCoordinatorOptions,
): AgentExecutionCoordinator {
	return new AgentExecutionCoordinator({
		effects: options.effects,
		isPidAlive: options.isPidAlive,
		readProcessStartIdentity: options.readProcessStartIdentity,
		readSystemBootIdentity: options.readSystemBootIdentity,
		createSession: (identity: AgentExecutionSessionIdentity) => {
			const sessionGovernor = new SessionAgentGovernor({
				rootDir: options.rootDir,
				sessionId: identity.sessionId,
				ownerAgentPath: identity.ownerAgentPath,
				limits: options.limits,
				readSystemBootIdentity: options.readSystemBootIdentity,
			});
			return {
				governor: new AgentExecutionGovernor(sessionGovernor),
				hasLedger: () => sessionGovernor.hasLedger(),
				inspectExistingSnapshot: () => sessionGovernor.inspectExistingSnapshot(),
				reconcile: async (isPidAlive) => {
					await sessionGovernor.reconcile(isPidAlive);
				},
			};
		},
	});
}
