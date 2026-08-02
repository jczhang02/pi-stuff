import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-agents-execution-matrix";
const MODEL = "fixture-model";
const AGENT = "matrix-agent";
const CHILD_DELAY_MS = 1_200;

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type ScenarioId =
	| "single-fresh-foreground"
	| "single-fork-background"
	| "parallel-fresh-background"
	| "parallel-fork-foreground";

function message(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: PROVIDER,
		model: MODEL,
		usage: ZERO_USAGE,
		stopReason,
		timestamp: Date.now(),
	};
}

function requiredEnvironment(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing ${name} for the Agents execution matrix fixture`);
	return value;
}

function scenarioId(): ScenarioId {
	const value = requiredEnvironment("PI_STUFF_AGENTS_EXECUTION_MATRIX_SCENARIO");
	if (
		value !== "single-fresh-foreground" &&
		value !== "single-fork-background" &&
		value !== "parallel-fresh-background" &&
		value !== "parallel-fork-foreground"
	) {
		throw new Error(`Unknown Agents execution matrix scenario: ${value}`);
	}
	return value;
}

function record(value: Record<string, unknown>): void {
	const path = requiredEnvironment("PI_STUFF_AGENTS_EXECUTION_MATRIX_LOG");
	appendFileSync(path, `${JSON.stringify({ at: Date.now(), pid: process.pid, ...value })}\n`);
}

function lastUserText(context: Context): string {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const entry = context.messages[index];
		if (entry?.role !== "user") continue;
		if (typeof entry.content === "string") return entry.content;
		return entry.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function latestSubagentResult(context: Context): string | undefined {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const entry = context.messages[index];
		if (entry?.role !== "toolResult" || entry.toolName !== "subagent") continue;
		return entry.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return undefined;
}

function textStream(text: string) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
	stream.push({ type: "done", reason: "stop", message: message([{ type: "text", text }], "stop") });
	return stream;
}

function delayedTextStream(text: string, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	let settled = false;
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "text_start", contentIndex: 0, partial: pending });

	const finish = (): void => {
		if (settled) return;
		settled = true;
		stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
		stream.push({ type: "done", reason: "stop", message: message([{ type: "text", text }], "stop") });
		record({ kind: "child-finish", scenario: scenarioId(), text });
	};
	const timer = setTimeout(finish, CHILD_DELAY_MS);
	options?.signal?.addEventListener(
		"abort",
		() => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			stream.push({
				type: "error",
				reason: "aborted",
				error: message([{ type: "text", text: "MATRIX_CHILD_ABORTED" }], "aborted"),
			});
			record({ kind: "child-abort", scenario: scenarioId() });
		},
		{ once: true },
	);
	return stream;
}

function toolArguments(scenario: ScenarioId): Record<string, unknown> {
	const common = {
		context: scenario.includes("-fork-") ? "fork" : "fresh",
		foreground: scenario.endsWith("-foreground"),
	};
	if (scenario.startsWith("single-")) {
		return {
			...common,
			agent: AGENT,
			task: `MATRIX_TASK_${scenario.toUpperCase().replaceAll("-", "_")}`,
		};
	}
	return {
		...common,
		tasks: [
			{ agent: AGENT, task: `MATRIX_TASK_${scenario.toUpperCase().replaceAll("-", "_")}_A` },
			{ agent: AGENT, task: `MATRIX_TASK_${scenario.toUpperCase().replaceAll("-", "_")}_B` },
		],
	};
}

function toolCallStream(scenario: ScenarioId) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const toolCall = {
		type: "toolCall" as const,
		id: `agents-execution-matrix-${scenario}`,
		name: "subagent",
		arguments: toolArguments(scenario),
	};
	stream.push({ type: "start", partial: pending });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	return stream;
}

function childStream(context: Context, options?: SimpleStreamOptions) {
	const scenario = scenarioId();
	const marker = requiredEnvironment("PI_STUFF_AGENTS_EXECUTION_MATRIX_ROOT_MARKER");
	const serialized = JSON.stringify(context.messages);
	const lastUser = lastUserText(context);
	const task = lastUser.match(/MATRIX_TASK_[A-Z_]+/)?.[0] ?? "MATRIX_TASK_UNKNOWN";
	const sawRootMarker = serialized.includes(marker);
	record({
		kind: "child-start",
		scenario,
		task,
		lastUser,
		messageCount: context.messages.length,
		sawRootMarker,
	});
	return delayedTextStream(
		`MATRIX_CHILD_RESULT:${scenario}:${task}:root-marker=${sawRootMarker ? "seen" : "absent"}`,
		options,
	);
}

function mainStream(context: Context) {
	const scenario = scenarioId();
	const result = latestSubagentResult(context);
	if (result === undefined) {
		record({
			kind: "main-launch",
			scenario,
			tools: (context.tools ?? []).map((tool) => tool.name),
		});
		return toolCallStream(scenario);
	}
	record({ kind: "main-result", scenario, result });
	return textStream(`MATRIX_MAIN_RESULT:${scenario}`);
}

function fixtureStream(context: Context, options?: SimpleStreamOptions) {
	// biome-ignore lint/complexity/useLiteralKeys: required by noPropertyAccessFromIndexSignature
	return process.env["PI_SUBAGENT_CHILD"] === "1" ? childStream(context, options) : mainStream(context);
}

export default function agentsExecutionMatrixProvider(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff Agents execution matrix fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff Agents execution matrix fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
			fixtureStream(context, options),
	});
}
