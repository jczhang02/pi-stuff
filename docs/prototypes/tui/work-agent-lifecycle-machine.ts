/**
 * PROTOTYPE — throwaway, model-free lifecycle state machine; not product code.
 *
 * Question: can one owned work-surface coordinator suspend BTW for a narrowly
 * scoped destructive-operation tripwire, allow only that exact operation once
 * or deny it, restore the exact prior surface, keep ordinary needs-input
 * non-modal, and stop one explicitly selected Agent without a confirmation UI?
 *
 * This module is deliberately pure: no Pi API, terminal input, timers, model
 * calls, persistence, or process I/O. The native-Pi shell only projects it.
 */

export type AgentLifecycleStatus = "done" | "failed" | "running" | "stopped" | "stopping" | "waiting";

export interface LifecycleAgent {
	elapsed: string;
	failureReason: string | null;
	id: string;
	name: string;
	partialResultAvailable: boolean;
	question: string | null;
	status: AgentLifecycleStatus;
	task: string;
}

export interface AgentPermissionRequest {
	action: string;
	agentId: string;
	command: string;
	reason: string;
}

export interface AgentNeedsInputRequest {
	agentId: string;
	question: string;
}

export type PermissionDecision = "allow-once" | "deny";

export type ResumableWorkSurface = { kind: "btw" } | { kind: "main" };

export type WorkSurface =
	| ResumableWorkSurface
	| {
			kind: "permission";
			request: AgentPermissionRequest;
			resume: ResumableWorkSurface;
	  };

export interface RosterNavigationState {
	active: boolean;
	selectedIndex: number;
}

export interface WorkAgentLifecycleState {
	agents: readonly LifecycleAgent[];
	attention: AgentNeedsInputRequest | null;
	lastPermissionDecision: PermissionDecision | null;
	lastStoppedAgentId: string | null;
	roster: RosterNavigationState;
	surface: WorkSurface;
}

export type WorkAgentLifecycleAction =
	| { type: "close-btw" }
	| { type: "needs-input-arrived"; request: AgentNeedsInputRequest }
	| { type: "open-btw" }
	| { type: "permission-arrived"; request: AgentPermissionRequest }
	| { type: "permission-resolved"; decision: PermissionDecision }
	| { type: "roster-enter" }
	| { type: "roster-leave" }
	| { type: "roster-move"; delta: -1 | 1 }
	| { type: "stop-requested" }
	| { type: "stop-settled"; agentId: string };

const INITIAL_AGENTS: readonly LifecycleAgent[] = [
	{
		elapsed: "12s",
		failureReason: null,
		id: "reviewer",
		name: "reviewer",
		partialResultAvailable: false,
		question: null,
		status: "running",
		task: "Review lifecycle ownership",
	},
	{
		elapsed: "18s",
		failureReason: null,
		id: "explorer",
		name: "explorer",
		partialResultAvailable: false,
		question: null,
		status: "done",
		task: "Inspect Claude interaction states",
	},
	{
		elapsed: "9s",
		failureReason: "reference API unavailable",
		id: "verifier",
		name: "verifier",
		partialResultAvailable: true,
		question: null,
		status: "failed",
		task: "Verify failure rendering",
	},
	{
		elapsed: "7s",
		failureReason: null,
		id: "planner",
		name: "planner",
		partialResultAvailable: false,
		question: null,
		status: "running",
		task: "Choose migration target",
	},
];

export function createWorkAgentLifecycleState(): WorkAgentLifecycleState {
	return {
		agents: INITIAL_AGENTS.map((agent) => ({ ...agent })),
		attention: null,
		lastPermissionDecision: null,
		lastStoppedAgentId: null,
		roster: { active: false, selectedIndex: 0 },
		surface: { kind: "main" },
	};
}

export function reduceWorkAgentLifecycle(
	state: WorkAgentLifecycleState,
	action: WorkAgentLifecycleAction,
): WorkAgentLifecycleState {
	switch (action.type) {
		case "open-btw":
			if (state.surface.kind !== "main") return state;
			return {
				...state,
				lastPermissionDecision: null,
				roster: { active: false, selectedIndex: 0 },
				surface: { kind: "btw" },
			};

		case "close-btw":
			if (state.surface.kind !== "btw") return state;
			return { ...state, surface: { kind: "main" } };

		case "permission-arrived": {
			if (state.surface.kind === "permission") return state;
			const resume: ResumableWorkSurface = state.surface.kind === "btw" ? { kind: "btw" } : { kind: "main" };
			return {
				...state,
				lastPermissionDecision: null,
				surface: { kind: "permission", request: action.request, resume },
			};
		}

		case "permission-resolved":
			if (state.surface.kind !== "permission") return state;
			return {
				...state,
				lastPermissionDecision: action.decision,
				surface: state.surface.resume,
			};

		case "needs-input-arrived":
			return {
				...state,
				agents: updateAgent(state.agents, action.request.agentId, (agent) => ({
					...agent,
					question: action.request.question,
					status: "waiting",
				})),
				attention: action.request,
			};

		case "roster-enter":
			if (state.surface.kind !== "main" || state.roster.active) return state;
			return { ...state, roster: { active: true, selectedIndex: 0 } };

		case "roster-leave":
			if (!state.roster.active) return state;
			return { ...state, roster: { active: false, selectedIndex: 0 } };

		case "roster-move": {
			if (!state.roster.active) return state;
			const selectedIndex = clamp(state.roster.selectedIndex + action.delta, 0, state.agents.length);
			return { ...state, roster: { active: true, selectedIndex } };
		}

		case "stop-requested": {
			if (!state.roster.active || state.roster.selectedIndex === 0) return state;
			const agent = state.agents[state.roster.selectedIndex - 1];
			if (!agent || (agent.status !== "running" && agent.status !== "waiting")) return state;
			return {
				...state,
				agents: updateAgent(state.agents, agent.id, (candidate) => ({ ...candidate, status: "stopping" })),
				attention: state.attention?.agentId === agent.id ? null : state.attention,
			};
		}

		case "stop-settled":
			return {
				...state,
				agents: updateAgent(state.agents, action.agentId, (agent) =>
					agent.status === "stopping" ? { ...agent, question: null, status: "stopped" } : agent,
				),
				lastStoppedAgentId: action.agentId,
			};
	}
}

export function selectedLifecycleAgent(state: WorkAgentLifecycleState): LifecycleAgent | undefined {
	if (!state.roster.active || state.roster.selectedIndex === 0) return undefined;
	return state.agents[state.roster.selectedIndex - 1];
}

function updateAgent(
	agents: readonly LifecycleAgent[],
	agentId: string,
	update: (agent: LifecycleAgent) => LifecycleAgent,
): readonly LifecycleAgent[] {
	return agents.map((agent) => (agent.id === agentId ? update(agent) : agent));
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
