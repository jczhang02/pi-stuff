import { appendFileSync } from "node:fs";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Guard } from "typebox/guard";
import type { JsonInputValue } from "../../packages/pi-stuff/src/shared/json-value.js";
import { registerFixtureProvider, ZERO_USAGE } from "./faux-provider.js";

const PROVIDER = "pi-stuff-goal-lifecycle";
const MODEL = "fixture-model";
type Scenario = "blocker" | "compaction" | "normal" | "reload";

let providerCalls = 0;
let goalCalls = 0;
let compactionRequested = false;

function scenario(): Scenario {
	const value = process.env["PI_STUFF_GOAL_LIFECYCLE_SCENARIO"];
	if (value === "blocker" || value === "compaction" || value === "normal" || value === "reload") return value;
	throw new Error(`Unknown Goal lifecycle scenario: ${value ?? "missing"}`);
}

function log(record: Record<string, JsonInputValue>): void {
	const path = process.env["PI_STUFF_GOAL_LIFECYCLE_LOG"];
	if (path) appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function message(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	errorMessage?: string,
): AssistantMessage {
	const result: AssistantMessage = {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: PROVIDER,
		model: MODEL,
		usage: ZERO_USAGE,
		stopReason,
		timestamp: Date.now(),
	};
	if (errorMessage !== undefined) result.errorMessage = errorMessage;
	return result;
}

function stream(content: AssistantMessage["content"], stopReason: "length" | "stop" | "toolUse") {
	const result = createAssistantMessageEventStream();
	const pending = message([], "pending");
	result.push({ type: "start", partial: pending });
	for (const [contentIndex, item] of content.entries()) {
		pending.content.push(item);
		if (item.type === "text") {
			result.push({ type: "text_start", contentIndex, partial: pending });
			result.push({ type: "text_delta", contentIndex, delta: item.text, partial: pending });
			result.push({ type: "text_end", contentIndex, content: item.text, partial: pending });
		} else if (item.type === "toolCall") {
			result.push({ type: "toolcall_start", contentIndex, partial: pending });
			result.push({ type: "toolcall_end", contentIndex, toolCall: item, partial: pending });
		}
	}
	result.push({ type: "done", reason: stopReason, message: message(content, stopReason) });
	return result;
}

function textStream(text: string) {
	return stream([{ type: "text", text }], "stop");
}

function toolStream<Arguments extends object>(name: string, arguments_: Arguments) {
	return stream(
		[
			{
				type: "toolCall",
				id: `goal-lifecycle-${String(providerCalls)}`,
				name,
				arguments: arguments_,
			},
		],
		"toolUse",
	);
}

function retryableErrorStream(errorMessage: string) {
	const result = createAssistantMessageEventStream();
	result.push({ type: "start", partial: message([], "pending") });
	result.push({ type: "error", reason: "error", error: message([], "error", errorMessage) });
	return result;
}

function contextText(context: Context): string {
	const text = [context.systemPrompt ?? ""];
	for (const entry of context.messages) {
		const content = entry.content;
		if (Guard.IsString(content)) {
			text.push(content);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const item of content) {
			if (item.type === "text") text.push(item.text);
		}
	}
	return text.join("\n");
}

function goalId(context: Context): string {
	const id = /<goal_id>\s*([^<\s]+)\s*<\/goal_id>/u.exec(contextText(context))?.[1];
	if (!id) throw new Error("Goal lifecycle fixture did not receive a goal_id");
	return id;
}

function completion(context: Context) {
	return toolStream("goal_complete", {
		goal_id: goalId(context),
		summary: "Packed lifecycle objective completed and verified.",
		evidence: [
			{
				requirement: "Exercise the requested packed Goal lifecycle",
				proof: "The certified Pi host persisted and observed the required lifecycle transition.",
			},
		],
	});
}

function blocker(context: Context, attempt: number) {
	const attemptedActions = [
		"Checked the local credential store for the production signing key.",
		"Queried the process environment for an alternate production signing key.",
		"Requested signing through the configured hardware agent socket.",
	];
	return toolStream("goal_blocked", {
		goal_id: goalId(context),
		reason: "Production signing requires an unavailable hardware credential",
		attempt: attemptedActions[attempt - 1],
		evidence: `The attempted signing path returned an unavailable hardware signer result on audit turn ${String(attempt)}.`,
		repeated_turns: attempt,
	});
}

function response(context: Context) {
	providerCalls += 1;
	const selected = scenario();
	if (!/<goal_id>/u.test(contextText(context))) {
		log({ type: "provider_call", scenario: selected, providerCalls, historical: true });
		return textStream(`Historical packed context ${"x".repeat(20_000)}`);
	}
	goalCalls += 1;
	log({ type: "provider_call", scenario: selected, providerCalls, goalCalls });
	if (selected === "normal") {
		return goalCalls === 1 ? textStream("Initial packed pass is incomplete.") : completion(context);
	}
	if (selected === "reload") return completion(context);
	if (selected === "compaction") {
		return goalCalls === 1
			? retryableErrorStream("HTTP 524 retryable boundary before owned compaction")
			: completion(context);
	}
	const blockerAttempt = Math.floor((goalCalls + 1) / 2);
	return goalCalls % 2 === 1
		? blocker(context, blockerAttempt)
		: textStream(`Blocker attempt ${String(blockerAttempt)} recorded; continue the audit.`);
}

function activeGoal(objective: string) {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		text: objective,
		status: "active",
		startedAt: now - 1_000,
		updatedAt: now - 1_000,
		iteration: 1,
		tokensUsed: 0,
		timeUsedSeconds: 1,
		baselineTokens: 0,
	};
}

export default function goalLifecycleProvider(pi: ExtensionAPI): void {
	pi.on("session_compact_failed", (event) => {
		log({
			type: "session_compact_failed",
			aborted: event.aborted,
			fromExtension: event.fromExtension,
			reason: event.reason,
			willRetry: event.willRetry,
		});
	});
	registerFixtureProvider(pi, PROVIDER, MODEL, "Pi Stuff Goal lifecycle fixture", (_model, context) =>
		response(context),
	);

	pi.registerCommand("goal-lifecycle-wait", {
		description: "Wait for packed Goal lifecycle work to settle",
		handler: async (_args, ctx) => {
			// RPC accepts a prompt before its agent run is scheduled. Yield once so
			// waitForIdle observes that scheduled work instead of the preceding idle edge.
			await new Promise((resolve) => setTimeout(resolve, 50));
			await ctx.waitForIdle();
		},
	});

	pi.registerCommand("goal-lifecycle-seed", {
		description: "Seed an active packed Goal and reload its extension runtime",
		handler: async (_args, ctx) => {
			const selected = scenario();
			if (selected !== "reload") {
				throw new Error(`Cannot seed scenario ${selected}`);
			}
			pi.appendEntry("goal-state", {
				goal: activeGoal("Certify active Goal continuation across reload"),
			});
			await ctx.reload();
			return;
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (scenario() !== "compaction" || goalCalls !== 1 || compactionRequested) return;
		compactionRequested = true;
		await ctx.compact({ customInstructions: "Certify active Goal compaction." });
	});
	pi.on("agent_start", () => log({ type: "agent_start" }));
	pi.on("tool_call", (event) => log({ type: "tool_call", toolCallId: event.toolCallId, toolName: event.toolName }));
	pi.on("tool_execution_start", (event) =>
		log({ type: "tool_execution_start", toolCallId: event.toolCallId, toolName: event.toolName }),
	);
	pi.on("tool_execution_end", (event) =>
		log({
			type: "tool_execution_end",
			isError: event.isError,
			toolCallId: event.toolCallId,
			toolName: event.toolName,
		}),
	);

	pi.on("session_before_compact", (event) => {
		if (scenario() !== "compaction") return;
		log({ type: "session_before_compact", reason: event.reason });
		return {
			compaction: {
				summary: "Packed Goal compaction lifecycle summary.",
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: { certified: true },
			},
		};
	});
	pi.on("session_compact", (event) => log({ type: "session_compact", reason: event.reason }));
	pi.on("session_start", (event) => log({ type: "session_start", reason: event.reason }));
}
