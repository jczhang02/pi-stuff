import { describe, expect, test } from "bun:test";
import {
	type Action,
	type CellSummary,
	type LifecycleAcceptanceSelection,
	lifecycleAcceptanceFindings,
	lifecycleConfirmationTargets,
	lifecycleExpectProgram,
	lifecycleSessionFindings,
	percentile,
	type Scenario,
	summarize,
	type TerminalSize,
	type Variant,
} from "../scripts/benchmark-lifecycle.js";

const ACTIONS = ["exit", "ctrl-c", "reload", "reload-change", "prompt", "background-exit", "agent-exit"] as const;
const SCENARIOS = ["fresh", "resume-short", "resume-long", "degraded"] as const;
const SIZES = [
	{ columns: 100, rows: 32 },
	{ columns: 64, rows: 28 },
] as const;
const VARIANTS = ["host", "suite"] as const;

function metric(p95 = 1) {
	return { maximum: p95, minimum: 1, p50: 1, p95, samples: 3 };
}

function selection(overrides: Partial<LifecycleAcceptanceSelection> = {}): LifecycleAcceptanceSelection {
	return {
		actions: ACTIONS,
		samples: 3,
		scenarios: SCENARIOS,
		sizes: SIZES,
		trace: true,
		variants: VARIANTS,
		warmups: 1,
		...overrides,
	};
}

function cell(variant: Variant, scenario: Scenario, action: Action, size: TerminalSize): CellSummary {
	return {
		action,
		...(action === "prompt"
			? {
					acknowledgement: metric(),
					response: metric(),
					steadyAcknowledgement: metric(),
					steadyResponse: metric(),
				}
			: {}),
		columns: size.columns,
		...(action === "reload" || action === "reload-change" ? { reload: metric() } : {}),
		rows: size.rows,
		scenario,
		shutdown: metric(),
		startup: metric(),
		variant,
		warmups: 1,
	};
}

function acceptanceCells(): CellSummary[] {
	return SIZES.flatMap((size) =>
		SCENARIOS.flatMap((scenario) =>
			ACTIONS.flatMap((action) => {
				if (
					((action === "background-exit" || action === "agent-exit") &&
						scenario !== "fresh" &&
						scenario !== "resume-long") ||
					(action === "reload-change" && (scenario !== "fresh" || size.columns !== 100 || size.rows !== 32))
				) {
					return [];
				}
				const variants: readonly Variant[] =
					action === "background-exit" || action === "agent-exit" || action === "reload-change"
						? ["suite"]
						: VARIANTS;
				return variants.map((variant) => cell(variant, scenario, action, size));
			}),
		),
	);
}

function sessionEntries(messages: readonly Record<string, unknown>[] = []): unknown[] {
	return [
		{ type: "session", version: 3 },
		{
			type: "model_change",
			provider: "pi-stuff-lifecycle-benchmark",
			modelId: "fixture-model",
		},
		...messages.map((message) => ({ type: "message", message })),
	];
}

describe("lifecycle benchmark statistics", () => {
	test("waits for real Editor input instead of sleeping after visible markers", () => {
		for (const action of ACTIONS) {
			const program = lifecycleExpectProgram(action, false);
			expect(program).toContain("wait_for_initial_editor");
			expect(program).toContain("must_editor_ready");
			expect(program).not.toMatch(/after (?:60|80)\\b/u);
		}
		const prompt = lifecycleExpectProgram("prompt", false);
		expect(prompt).toContain('must_expect "PS5BW_INPUT_ACK_PS5BW_FIRST_PROMPT"');
		expect(prompt).toContain('must_editor_ready "PS5BW_STEADY_EDITOR_READY"');
		expect(prompt).toContain('must_editor_ready "PS5BW_SHUTDOWN_EDITOR_READY"');
	});

	test("uses nearest-rank percentiles", () => {
		const values = Array.from({ length: 20 }, (_value, index) => index + 1);
		expect(percentile(values, 0.5)).toBe(10);
		expect(percentile(values, 0.95)).toBe(19);
	});

	test("reports bounded, rounded summaries", () => {
		expect(summarize([3.456, 1.234, 2.345])).toEqual({
			maximum: 3.46,
			minimum: 1.23,
			p50: 2.35,
			p95: 3.46,
			samples: 3,
		});
	});

	test("accepts only a complete traced matrix within every p95 budget", () => {
		expect(lifecycleAcceptanceFindings(selection(), acceptanceCells())).toEqual([]);
	});

	test("reports bypassed coverage and the exact over-budget cell", () => {
		const cells = acceptanceCells().map((candidate) =>
			candidate.variant === "suite" && candidate.scenario === "resume-long" && candidate.columns === 64
				? candidate.action === "reload"
					? { ...candidate, reload: metric(551) }
					: candidate.action === "background-exit"
						? { ...candidate, shutdown: metric(376) }
						: candidate
				: candidate,
		);
		const findings = lifecycleAcceptanceFindings(
			selection({ actions: ACTIONS.filter((action) => action !== "agent-exit"), trace: false }),
			cells,
		);
		expect(findings).toContain("coverage requires Host and Suite lifecycle tracing");
		expect(findings).toContain("coverage is missing action agent-exit");
		expect(findings).toContain("suite/resume-long/reload/64x28 reload p95 551.00ms exceeds 550ms");
		expect(findings).toContain("suite/resume-long/background-exit/64x28 shutdown p95 376.00ms exceeds 375ms");
	});

	test("accepts a one-batch scheduler outlier only after an independent confirmation passes", () => {
		const cells = acceptanceCells().map((candidate) =>
			candidate.variant === "suite" &&
			candidate.scenario === "fresh" &&
			candidate.action === "exit" &&
			candidate.columns === 64
				? { ...candidate, startup: metric(2_701) }
				: candidate,
		);
		const target = cells.find(
			(candidate) =>
				candidate.variant === "suite" &&
				candidate.scenario === "fresh" &&
				candidate.action === "exit" &&
				candidate.columns === 64,
		);
		if (!target) throw new Error("missing lifecycle test target");
		expect(lifecycleConfirmationTargets(cells)).toEqual([target]);
		expect(lifecycleAcceptanceFindings(selection(), cells, [cell("suite", "fresh", "exit", SIZES[1])])).toEqual([]);
	});

	test("still fails a performance regression repeated by the confirmation batch", () => {
		const cells = acceptanceCells().map((candidate) =>
			candidate.variant === "suite" &&
			candidate.scenario === "fresh" &&
			candidate.action === "exit" &&
			candidate.columns === 64
				? { ...candidate, startup: metric(2_701) }
				: candidate,
		);
		const confirmation = { ...cell("suite", "fresh", "exit", SIZES[1]), startup: metric(2_702) };
		const findings = lifecycleAcceptanceFindings(selection(), cells, [confirmation]);
		expect(findings).toContain("suite/fresh/exit/64x28 startup p95 2701.00ms exceeds 2700ms");
		expect(findings).toContain("suite/fresh/exit/64x28 startup confirmation p95 2702.00ms also exceeds 2700ms");
	});

	test("requires complete samples and warmups for every action metric and its confirmation", () => {
		const cells = acceptanceCells().map((candidate) =>
			candidate.variant === "suite" && candidate.scenario === "fresh" && candidate.action === "prompt"
				? { ...candidate, response: { ...metric(), samples: 2 }, warmups: 0 }
				: candidate,
		);
		expect(lifecycleAcceptanceFindings(selection(), cells)).toContain(
			"suite/fresh/prompt/100x32 response has only 2 measured samples",
		);
		expect(lifecycleAcceptanceFindings(selection(), cells)).toContain("suite/fresh/prompt/100x32 has only 0 warmups");

		const overBudget = acceptanceCells().map((candidate) =>
			candidate.variant === "suite" &&
			candidate.scenario === "fresh" &&
			candidate.action === "exit" &&
			candidate.columns === 64
				? { ...candidate, startup: metric(2_701) }
				: candidate,
		);
		const shortConfirmation = {
			...cell("suite", "fresh", "exit", SIZES[1]),
			startup: { ...metric(2_600), samples: 2 },
		};
		expect(lifecycleAcceptanceFindings(selection(), overBudget, [shortConfirmation])).toContain(
			"suite/fresh/exit/64x28 startup confirmation has only 2 measured samples",
		);
		const coldConfirmation = { ...cell("suite", "fresh", "exit", SIZES[1]), warmups: 0 };
		expect(lifecycleAcceptanceFindings(selection(), overBudget, [coldConfirmation])).toContain(
			"suite/fresh/exit/64x28 confirmation has only 0 warmups",
		);
	});

	test("requires every Host and Suite action metric", () => {
		const cells = acceptanceCells().map((candidate) => {
			if (
				candidate.variant !== "host" ||
				candidate.scenario !== "fresh" ||
				candidate.action !== "prompt" ||
				candidate.columns !== 100
			) {
				return candidate;
			}
			const { steadyResponse: _steadyResponse, ...withoutSteadyResponse } = candidate;
			return withoutSteadyResponse;
		});
		expect(lifecycleAcceptanceFindings(selection(), cells)).toContain(
			"host/fresh/prompt/100x32 is missing steadyResponse",
		);
	});

	test("enforces steady-state prompt latency budgets", () => {
		const cells = acceptanceCells().map((candidate) =>
			candidate.variant === "suite" &&
			candidate.scenario === "fresh" &&
			candidate.action === "prompt" &&
			candidate.columns === 100
				? { ...candidate, steadyAcknowledgement: metric(16), steadyResponse: metric(51) }
				: candidate,
		);
		const findings = lifecycleAcceptanceFindings(selection(), cells);
		expect(findings).toContain("suite/fresh/prompt/100x32 steadyAcknowledgement p95 16.00ms exceeds 15ms");
		expect(findings).toContain("suite/fresh/prompt/100x32 steadyResponse p95 51.00ms exceeds 50ms");
	});

	test("requires durable resumed history and matching Background Tool receipts", () => {
		const entries = sessionEntries([
			{ role: "assistant", content: [{ type: "text", text: "PS5BW_SESSION_TAIL_long" }] },
			{ role: "user", content: "PS5BW_BACKGROUND_PROMPT" },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "ps5bw-background-launch", name: "bash", arguments: {} }],
			},
			{ role: "toolResult", toolCallId: "ps5bw-background-launch", content: [] },
			{ role: "assistant", content: [{ type: "text", text: "PS5BW_BACKGROUND_READY" }] },
		]);
		expect(lifecycleSessionFindings(entries, "background-exit", "resume-long")).toEqual([]);
		expect(
			lifecycleSessionFindings(
				entries.filter((entry) => !JSON.stringify(entry).includes("toolResult")),
				"background-exit",
				"resume-long",
			),
		).toContain("Session JSONL lost Tool result receipt ps5bw-background-launch");
	});

	test("requires both measured prompt submissions to remain durable", () => {
		const findings = lifecycleSessionFindings(
			sessionEntries([
				{ role: "user", content: "PS5BW_FIRST_PROMPT" },
				{ role: "assistant", content: [{ type: "text", text: "PS5BW_FIRST_PROMPT_DONE" }] },
			]),
			"prompt",
			"fresh",
		);
		expect(findings).toContain("Session JSONL lost marker PS5BW_SECOND_PROMPT");
		expect(findings).toContain("Session JSONL lost marker PS5BW_SECOND_PROMPT_DONE");
	});

	test("requires completed prompt markers after reload", () => {
		const findings = lifecycleSessionFindings(
			sessionEntries([{ role: "user", content: "PS5BW_RELOAD_PROMPT" }]),
			"reload",
			"fresh",
		);
		expect(findings).toContain("Session JSONL lost marker PS5BW_PROMPT_DONE");
	});
});
