import { Type } from "typebox";
import { MAX_BACKGROUND_TASKS } from "../runs/shared/parallel-utils.ts";

const SkillSelection = Type.Unsafe({
	anyOf: [
		{ type: "array", items: { type: "string", minLength: 1 } },
		{ type: "boolean" },
		{ type: "string", minLength: 1 },
	],
	description: "Optional skill name or names. false disables skills for this Agent.",
});

const TurnBudget = Type.Object(
	{
		maxTurns: Type.Integer({
			minimum: 1,
			description: "Soft threshold at which wrap-up is requested.",
		}),
		graceTurns: Type.Optional(
			Type.Integer({
				minimum: 0,
				description: "Additional wrap-up turns allowed after the soft threshold and before forced termination.",
			}),
		),
	},
	{
		additionalProperties: false,
		description:
			"Optional expert bounded-execution control. Omit for ordinary delegated work unless the user or project explicitly requires a turn bound; forced termination begins only after maxTurns plus graceTurns.",
	},
);

const ToolBudget = Type.Object(
	{
		soft: Type.Optional(Type.Integer({ minimum: 1 })),
		hard: Type.Integer({ minimum: 1 }),
		block: Type.Optional(
			Type.Unsafe({
				anyOf: [
					{ type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
					{ type: "string", enum: ["*"] },
				],
			}),
		),
	},
	{ additionalProperties: false },
);

const AgentTask = Type.Object(
	{
		agent: Type.String({ minLength: 1, description: "Agent definition name." }),
		description: Type.Optional(
			Type.String({
				minLength: 1,
				description: "Short 3–5 word UI description; keep paths and execution detail in task.",
			}),
		),
		task: Type.String({ minLength: 1, description: "Concrete task delegated to this Agent." }),
		cwd: Type.Optional(Type.String({ minLength: 1 })),
		model: Type.Optional(Type.String({ minLength: 1 })),
		skill: Type.Optional(SkillSelection),
		turnBudget: Type.Optional(TurnBudget),
		toolBudget: Type.Optional(ToolBudget),
		context: Type.Optional(
			Type.String({
				enum: ["fresh", "fork"],
				description: "Shared launch hint. When supplied inside tasks, every task must use the same value.",
			}),
		),
		isolation: Type.Optional(
			Type.String({
				enum: ["shared", "worktree"],
				description: "Shared launch hint. When supplied inside tasks, every task must use the same value.",
			}),
		),
		foreground: Type.Optional(
			Type.Boolean({
				description: "Shared launch hint. When supplied inside tasks, every task must use the same value.",
			}),
		),
	},
	{ additionalProperties: false },
);

const FanoutAgentTask = Type.Object(
	{
		agent: Type.String({ minLength: 1, description: "Agent definition name." }),
		description: Type.Optional(
			Type.String({
				minLength: 1,
				description: "Short 3–5 word UI description; keep paths and execution detail in task.",
			}),
		),
		task: Type.String({ minLength: 1, description: "Concrete task delegated to this Agent." }),
		cwd: Type.Optional(Type.String({ minLength: 1 })),
		model: Type.Optional(Type.String({ minLength: 1 })),
		skill: Type.Optional(SkillSelection),
		turnBudget: Type.Optional(TurnBudget),
		toolBudget: Type.Optional(ToolBudget),
		context: Type.Optional(
			Type.String({
				enum: ["fresh", "fork"],
				description: "Shared launch hint. When supplied inside tasks, every task must use the same value.",
			}),
		),
		isolation: Type.Optional(
			Type.String({
				enum: ["shared", "worktree"],
				description: "Shared launch hint. When supplied inside tasks, every task must use the same value.",
			}),
		),
	},
	{ additionalProperties: false },
);

export const SubagentParams = Type.Object(
	{
		agent: Type.Optional(Type.String({ minLength: 1, description: "Agent definition name for one delegated task." })),
		description: Type.Optional(
			Type.String({
				minLength: 1,
				description: "Short 3–5 word UI description; keep paths and execution detail in task.",
			}),
		),
		task: Type.Optional(
			Type.String({ minLength: 1, description: "Concrete task for a single launch; use tasks for parallel work." }),
		),
		tasks: Type.Optional(
			Type.Array(AgentTask, {
				minItems: 1,
				maxItems: MAX_BACKGROUND_TASKS,
				description:
					"Parallel launch only: independent Agent tasks to run concurrently. Do not combine with agent or task.",
			}),
		),
		foreground: Type.Optional(
			Type.Boolean({
				description:
					"Omit foreground for the default background launch. Set true only when the result is required before continuing; do not invent or pass a background field.",
			}),
		),
		context: Type.Optional(
			Type.String({
				enum: ["fresh", "fork"],
				description:
					"fresh starts an isolated named Agent; fork preserves the parent conversation identity and context.",
			}),
		),
		isolation: Type.Optional(
			Type.String({
				enum: ["shared", "worktree"],
				description: "Optional per-Agent Git worktree isolation. Defaults to the shared working directory.",
			}),
		),
		cwd: Type.Optional(Type.String({ minLength: 1 })),
		model: Type.Optional(Type.String({ minLength: 1 })),
		thinking: Type.Optional(Type.String({ minLength: 1 })),
		skill: Type.Optional(SkillSelection),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
		turnBudget: Type.Optional(TurnBudget),
		toolBudget: Type.Optional(ToolBudget),
		action: Type.Optional(
			Type.String({
				enum: ["status", "steer", "stop", "resume"],
				description:
					"Control only: status, steer, stop, or resume. Do not combine a control action with launch fields.",
			}),
		),
		id: Type.Optional(
			Type.String({
				minLength: 1,
				description: "Stable Agent or run id. Optional for status; required for steer, stop, and resume.",
			}),
		),
		index: Type.Optional(Type.Integer({ minimum: 0 })),
		message: Type.Optional(
			Type.String({ minLength: 1, description: "Required steering message, or an optional resume message." }),
		),
	},
	{
		additionalProperties: false,
		description:
			"Exactly one runtime-validated shape: agent plus task for one launch, tasks for a parallel launch, or action for current-session control.",
	},
);

/**
 * Nested fanout children are launch-only and cannot detach work or manage runs.
 *
 * Keep this schema explicit. Deriving it with `Type.Omit` weakens the root
 * `additionalProperties` contract and can accidentally expose future
 * management fields added to `SubagentParams`.
 */
export const FanoutChildSubagentParams = Type.Object(
	{
		agent: Type.Optional(Type.String({ minLength: 1, description: "Agent definition name for one delegated task." })),
		description: Type.Optional(
			Type.String({
				minLength: 1,
				description: "Short 3–5 word UI description; keep paths and execution detail in task.",
			}),
		),
		task: Type.Optional(
			Type.String({ minLength: 1, description: "Concrete task for a single launch; use tasks for parallel work." }),
		),
		tasks: Type.Optional(
			Type.Array(FanoutAgentTask, {
				minItems: 1,
				maxItems: MAX_BACKGROUND_TASKS,
				description: "Parallel launch only: independent Agent tasks to run concurrently.",
			}),
		),
		context: Type.Optional(Type.String({ enum: ["fresh", "fork"] })),
		isolation: Type.Optional(Type.String({ enum: ["shared", "worktree"] })),
		cwd: Type.Optional(Type.String({ minLength: 1 })),
		model: Type.Optional(Type.String({ minLength: 1 })),
		thinking: Type.Optional(Type.String({ minLength: 1 })),
		skill: Type.Optional(SkillSelection),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
		turnBudget: Type.Optional(TurnBudget),
		toolBudget: Type.Optional(ToolBudget),
	},
	{
		additionalProperties: false,
		description:
			"Launch one runtime-validated single or parallel nested Agent call and wait for every result before returning to the owning Agent.",
	},
);
