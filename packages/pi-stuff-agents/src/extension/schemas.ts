import { Type } from "typebox";

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
		maxTurns: Type.Integer({ minimum: 1 }),
		graceTurns: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ additionalProperties: false },
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
		task: Type.Optional(Type.String({ minLength: 1, description: "Concrete task for one Agent." })),
		tasks: Type.Optional(
			Type.Array(AgentTask, {
				minItems: 1,
				description: "Independent Agent tasks to launch concurrently as one group.",
			}),
		),
		foreground: Type.Optional(
			Type.Boolean({
				description:
					"Wait for the result only when it is required before the main Agent can continue. Defaults to false.",
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
				description: "Current-session control action. Omit for a new delegation.",
			}),
		),
		id: Type.Optional(Type.String({ minLength: 1, description: "Stable Agent or run id for a control action." })),
		index: Type.Optional(Type.Integer({ minimum: 0 })),
		message: Type.Optional(Type.String({ minLength: 1, description: "Steering or resume message." })),
	},
	{ additionalProperties: false },
);
