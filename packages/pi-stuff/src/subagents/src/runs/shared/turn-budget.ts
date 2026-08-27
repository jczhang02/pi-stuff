import { isRuntimeNumber, isRuntimeObject } from "../../../../shared/runtime-type.js";
import type { ResolvedTurnBudget, TurnBudgetState } from "../../shared/types.ts";

export const DEFAULT_TURN_BUDGET_GRACE_TURNS = 1;
export const DEFAULT_AGENT_TURN_BUDGET: ResolvedTurnBudget = Object.freeze({ maxTurns: 64, graceTurns: 2 });

export function resolveTurnBudgetConfig<Value>(raw: Value, label = "turnBudget") {
	if (raw === undefined) return {};
	if (!raw || !isRuntimeObject(raw) || Array.isArray(raw)) {
		return { error: `${label} must be an object with maxTurns and optional graceTurns.` };
	}
	const unknownField = Object.keys(raw).find((key) => key !== "maxTurns" && key !== "graceTurns");
	if (unknownField) return { error: `${label}.${unknownField} is not supported.` };
	if (!("maxTurns" in raw) || !isRuntimeNumber(raw.maxTurns) || !Number.isInteger(raw.maxTurns) || raw.maxTurns < 1) {
		return { error: `${label}.maxTurns must be an integer >= 1.` };
	}
	const graceTurns =
		"graceTurns" in raw ? (raw.graceTurns ?? DEFAULT_TURN_BUDGET_GRACE_TURNS) : DEFAULT_TURN_BUDGET_GRACE_TURNS;
	if (!isRuntimeNumber(graceTurns) || !Number.isInteger(graceTurns) || graceTurns < 0) {
		return { error: `${label}.graceTurns must be an integer >= 0.` };
	}
	return { turnBudget: { maxTurns: raw.maxTurns, graceTurns } };
}

export function appendTurnBudgetSystemPrompt(systemPrompt: string, budget: ResolvedTurnBudget | undefined): string {
	if (!budget) return systemPrompt;
	const grace =
		budget.graceTurns === 1 ? "1 additional assistant turn" : `${budget.graceTurns} additional assistant turns`;
	const block = [
		"## Turn budget",
		`This child run has a soft budget of ${budget.maxTurns} assistant turn${budget.maxTurns === 1 ? "" : "s"}.`,
		`After that, ${grace} may be allowed only for a final wrap-up.`,
		"When you approach or reach the soft budget, stop starting new tool work and return the final answer immediately.",
		"This runner uses process-mode execution, so live steering after launch may be unavailable; treat this instruction as the wrap-up request.",
		"If you continue past the soft budget plus grace turns, the supervisor may abort the process and return only partial output.",
	].join("\n");
	return systemPrompt.trim() ? `${systemPrompt.trim()}\n\n${block}` : block;
}

export function initialTurnBudgetState(budget: ResolvedTurnBudget): TurnBudgetState {
	return { ...budget, outcome: "within-budget", turnCount: 0 };
}

export function turnBudgetState(budget: ResolvedTurnBudget, turnCount: number, exceeded: boolean): TurnBudgetState {
	const state: TurnBudgetState = {
		...budget,
		turnCount,
		outcome: exceeded ? "exceeded" : "wrap-up-requested",
		wrapUpRequestedAtTurn: budget.maxTurns,
	};
	if (exceeded) state.exceededAtTurn = turnCount;
	return state;
}

export function turnBudgetDecision(
	budget: ResolvedTurnBudget,
	turnCount: number,
	terminalAssistantStop: boolean,
	toolWorkActiveOrStarting: boolean,
	enforceHardLimit = false,
): "continue" | "defer" | "abort" {
	const hardLimit = budget.maxTurns + budget.graceTurns;
	if (turnCount < hardLimit) return "continue";
	if (toolWorkActiveOrStarting && !enforceHardLimit) return "defer";
	if (turnCount === hardLimit && terminalAssistantStop) return "continue";
	return "abort";
}
