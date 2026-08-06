import { performance } from "node:perf_hooks";
import { planToolActivityGroups } from "../packages/pi-stuff-tools/activity.js";
import { ToolUiRuntime } from "../packages/pi-stuff-tools/contract.js";

const CALLS = 20_000;
const CALLS_PER_ROUND = 10;
const ITERATIONS = 15;
const MAX_BASELINE_REGRESSION_MS = 25;
const STREAMING_UPDATES = 200;
const owned = new Set(["read"]);

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

function legacyExplorationProjection(input: readonly unknown[]): number {
	const successful = new Set<string>();
	for (const candidate of input) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const message = candidate as Record<string, unknown>;
		if (
			message["role"] === "toolResult" &&
			typeof message["toolCallId"] === "string" &&
			message["isError"] !== true
		) {
			successful.add(message["toolCallId"]);
		}
	}
	let groups = 0;
	for (const candidate of input) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const message = candidate as Record<string, unknown>;
		if (message["role"] !== "assistant" || !Array.isArray(message["content"])) continue;
		let adjacent = 0;
		const flush = () => {
			if (adjacent > 0) groups += 1;
			adjacent = 0;
		};
		for (const block of message["content"]) {
			if (typeof block !== "object" || block === null) continue;
			const value = block as Record<string, unknown>;
			if (value["type"] === "text") flush();
			if (value["type"] !== "toolCall") continue;
			if (value["name"] === "read" && typeof value["id"] === "string" && successful.has(value["id"])) adjacent += 1;
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

function benchmark(run: () => unknown): number {
	for (let index = 0; index < 3; index += 1) run();
	const samples: number[] = [];
	for (let index = 0; index < ITERATIONS; index += 1) {
		const started = performance.now();
		run();
		samples.push(performance.now() - started);
	}
	return median(samples);
}

const baselineMs = benchmark(() => legacyExplorationProjection(messages));
const activityMs = benchmark(() => planToolActivityGroups(messages, owned, true));
const streamingSamples: number[] = [];
for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
	const runtime = new ToolUiRuntime();
	runtime.registerActivity("read", {
		categories: ["read-file"],
		classify: ({ args }) => [
			{
				category: "read-file",
				countKeys: [String(args["path"] ?? "")],
			},
		],
	});
	runtime.indexMessages(messages);
	runtime.indexMessage({
		role: "user",
		content: [{ type: "text", text: "stream" }],
	});
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
}
const streamingMs = median(streamingSamples);
const groups = planToolActivityGroups(messages, owned, true);
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

console.log(
	JSON.stringify(
		{
			activityMedianMs: Number(activityMs.toFixed(2)),
			calls: CALLS,
			iterations: ITERATIONS,
			legacyExplorationMedianMs: Number(baselineMs.toFixed(2)),
			ratio: Number((activityMs / baselineMs).toFixed(2)),
			streamingTailMedianMs: Number(streamingMs.toFixed(2)),
			streamingUpdates: STREAMING_UPDATES,
		},
		null,
		2,
	),
);
