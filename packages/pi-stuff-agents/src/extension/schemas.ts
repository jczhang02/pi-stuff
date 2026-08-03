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
		task: Type.Optional(
			Type.String({ minLength: 1, description: "Concrete task for a single launch; use tasks for parallel work." }),
		),
		tasks: Type.Optional(
			Type.Array(AgentTask, {
				minItems: 1,
				description:
					"Parallel launch only: independent Agent tasks to run concurrently. Do not combine with agent or task.",
			}),
		),
		foreground: Type.Optional(
			Type.Boolean({
				description:
					"Omit for the default background launch. Set true only when the result is required before continuing; never send background.",
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
			"Exactly one shape: agent plus task for one launch, tasks for a parallel launch, or action for current-session control.",
		oneOf: [
			{
				title: "Single Agent launch: agent plus task",
				required: ["agent", "task"],
				properties: { tasks: false, action: false, id: false, index: false, message: false },
			},
			{
				title: "Parallel Agent launch: tasks",
				required: ["tasks"],
				properties: {
					agent: false,
					description: false,
					task: false,
					action: false,
					id: false,
					index: false,
					message: false,
				},
			},
			{
				title: "Current-session Agent control: action",
				required: ["action"],
				properties: {
					agent: false,
					description: false,
					task: false,
					tasks: false,
					foreground: false,
					context: false,
					isolation: false,
					cwd: false,
					model: false,
					thinking: false,
					skill: false,
					timeoutMs: false,
					turnBudget: false,
					toolBudget: false,
				},
			},
		],
	},
);
