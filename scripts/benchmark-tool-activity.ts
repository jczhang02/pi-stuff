import { performance } from "node:perf_hooks";
import { isRuntimeObject, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import { planToolActivityGroups } from "../packages/pi-stuff/src/tool-display/activity.js";
import { ToolUiRuntime } from "../packages/pi-stuff/src/tool-display/contract.js";
import { buildToolResultLines } from "../packages/pi-stuff/src/tool-display/render.js";

const CALLS = 20_000;
const CALLS_PER_ROUND = 10;
const ITERATIONS = 15;
const MAX_BASELINE_REGRESSION_MS = 25;
const STREAMING_UPDATES = 200;
const FORMATTED_RESULTS = 1_000;
const classify = (name: string) => (name === "read" ? ("retrieval" as const) : ("boundary" as const));

interface ReadActivityArguments {
	readonly path?: unknown;
}

const messages: unknown[] = [{ role: "user", content: [{ type: "text", text: "benchmark" }] }];
for (let start = 0; start < CALLS; start += CALLS_PER_ROUND) {
	const content: unknown[] = [{ type: "thinking", thinking: "inspect" }];
	for (let index = start; index < Math.min(CALLS, start + CALLS_PER_ROUND); index += 1) {
		content.push({
			type: "toolCall",
			id: `call-${String(index)}`,
			name: "read",
			arguments: { path: `${String(index)}.ts` },
		});
	}
	messages.push({ role: "assistant", content });
	for (let index = start; index < Math.min(CALLS, start + CALLS_PER_ROUND); index += 1) {
		messages.push({
			role: "toolResult",
			toolCallId: `call-${String(index)}`,
			content: [{ type: "text", text: "ok" }],
			details: {},
		});
	}
}

/**
 * Behavior-preserving benchmark copy of ToolUiRuntime.planMessageGroups at the
 * shipped Exploration Grouping fixed point (merge base 6cea279). That planner
 * inspected each Assistant message once and formed groups from adjacent calls
 * whose grouping policy returned exploration; it did not pre-scan results.
 */
function shippedExplorationProjection(input: readonly unknown[]): number {
	let groups = 0;
	for (const candidate of input) {
		if (
			!isRuntimeObject(candidate) ||
			candidate === null ||
			!("role" in candidate) ||
			!("content" in candidate) ||
			candidate.role !== "assistant" ||
			!Array.isArray(candidate.content)
		) {
			continue;
		}
		let adjacent = 0;
		const flush = () => {
			if (adjacent >= 2) groups += 1;
			adjacent = 0;
		};
		for (const block of candidate.content) {
			if (
				!isRuntimeObject(block) ||
				block === null ||
				!("arguments" in block) ||
				!("type" in block) ||
				!("id" in block) ||
				!("name" in block)
			) {
				continue;
			}
			const args = block.arguments;
			const explorationCall =
				block.type === "toolCall" &&
				isRuntimeString(block.id) &&
				block.id.length > 0 &&
				block.name === "read" &&
				isRuntimeObject(args) &&
				args !== null &&
				!Array.isArray(args);
			if (explorationCall) adjacent += 1;
			else flush();
		}
		flush();
	}
	return groups;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function benchmark(run: () => void): number {
	for (let index = 0; index < 3; index += 1) run();
	const samples: number[] = [];
	for (let index = 0; index < ITERATIONS; index += 1) {
		const started = performance.now();
		run();
		samples.push(performance.now() - started);
	}
	return median(samples);
}

const baselineMs = benchmark(() => shippedExplorationProjection(messages));
const activityMs = benchmark(() => planToolActivityGroups(messages, classify, true));
const streamingSamples: number[] = [];
for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity<ReadActivityArguments, unknown>("read", {
		categories: ["read-file"],
		classify: ({ args }) => [
			{
				category: "read-file",
				countKeys: [String(args["path"] ?? "")],
			},
		],
	});
	runtime.markRendererAttached("read");
	runtime.indexMessages(messages);
	runtime.indexMessage({
		role: "user",
		content: [{ type: "text", text: "stream" }],
	});
	runtime.startTurn();
	const started = performance.now();
	for (let index = 0; index < STREAMING_UPDATES / 2; index += 1) {
		const id = `stream-${String(index)}`;
		runtime.indexMessage({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id,
					name: "read",
					arguments: { path: `stream-${String(index)}.ts` },
				},
			],
		});
		runtime.indexMessage({
			role: "toolResult",
			toolCallId: id,
			content: [{ type: "text", text: "ok" }],
			details: {},
		});
	}
	streamingSamples.push(performance.now() - started);
	const streamedGroup = runtime.resolveGroup("stream-0");
	if (!streamedGroup || streamedGroup === "ambiguous" || streamedGroup.memberIds.length !== STREAMING_UPDATES / 2) {
		throw new Error("Incremental Activity benchmark did not build the streamed Tool Activity Group");
	}
}
const streamingMs = median(streamingSamples);
const groups = planToolActivityGroups(messages, classify, true);
const shortResults = Array.from({ length: FORMATTED_RESULTS }, (_, index) => ({
	content: [{ type: "text" as const, text: `result ${String(index)}` }],
	details: { index },
}));
const formattedExpansionMs = benchmark(() => shortResults.map((result) => buildToolResultLines(result)));
const formattedLines = shortResults.flatMap((result) => buildToolResultLines(result));
const baselineGroups = shippedExplorationProjection(messages);
if (baselineGroups !== CALLS / CALLS_PER_ROUND) {
	throw new Error(`Shipped Exploration benchmark copy produced ${String(baselineGroups)} groups`);
}
if (groups.length !== 1 || groups[0]?.members.length !== CALLS) {
	throw new Error(
		`Activity reconstruction lost members: ${String(groups.length)} groups, ${String(groups[0]?.members.length)} members`,
	);
}
if (activityMs > 250) throw new Error(`Activity reconstruction exceeded 250 ms: ${activityMs.toFixed(2)} ms`);
if (activityMs > baselineMs + MAX_BASELINE_REGRESSION_MS) {
	throw new Error(
		`Activity reconstruction exceeded the baseline by more than ${String(MAX_BASELINE_REGRESSION_MS)} ms: ${activityMs.toFixed(2)} ms versus ${baselineMs.toFixed(2)} ms`,
	);
}
if (streamingMs > 250) {
	throw new Error(
		`Incremental Activity projection exceeded 250 ms for ${String(STREAMING_UPDATES)} updates after a ${String(CALLS)}-call history: ${streamingMs.toFixed(2)} ms`,
	);
}
if (formattedExpansionMs > 250) {
	throw new Error(
		`Formatted expansion exceeded 250 ms for ${String(FORMATTED_RESULTS)} short results: ${formattedExpansionMs.toFixed(2)} ms`,
	);
}
if (formattedLines.some((line) => /^(?:Call ID|Arguments|Result content|Details)$/u.test(line))) {
	throw new Error("Formatted expansion constructed Raw protocol output");
}

console.log(
	JSON.stringify(
		{
			activityMedianMs: Number(activityMs.toFixed(2)),
			calls: CALLS,
			formattedExpansionMedianMs: Number(formattedExpansionMs.toFixed(2)),
			formattedResults: FORMATTED_RESULTS,
			iterations: ITERATIONS,
			shippedExplorationMedianMs: Number(baselineMs.toFixed(2)),
			ratio: Number((activityMs / baselineMs).toFixed(2)),
			streamingTailMedianMs: Number(streamingMs.toFixed(2)),
			streamingUpdates: STREAMING_UPDATES,
		},
		null,
		2,
	),
);
