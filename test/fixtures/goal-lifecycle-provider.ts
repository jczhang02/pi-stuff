import { appendFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "pi-stuff-goal-lifecycle";
const MODEL = "fixture-model";
const CONTEXT_COMPACTION_BYPASSED_EVENT = "@jczhang02/pi-stuff-context/compaction-bypassed/v1";
const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Scenario = "blocker" | "compaction" | "normal" | "reload";

let providerCalls = 0;
let goalCalls = 0;
let compactionRequested = false;

function scenario(): Scenario {
	// biome-ignore lint/complexity/useLiteralKeys: certification runs with noPropertyAccessFromIndexSignature
	const value = process.env["PI_STUFF_GOAL_LIFECYCLE_SCENARIO"];
	if (value === "blocker" || value === "compaction" || value === "normal" || value === "reload") return value;
	throw new Error(`Unknown Goal lifecycle scenario: ${value ?? "missing"}`);
}

function log(record: Record<string, unknown>): void {
	// biome-ignore lint/complexity/useLiteralKeys: certification runs with noPropertyAccessFromIndexSignature
	const path = process.env["PI_STUFF_GOAL_LIFECYCLE_LOG"];
	if (path) appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function message(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
	errorMessage?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: PROVIDER,
		model: MODEL,
		usage: ZERO_USAGE,
		stopReason,
		...(errorMessage ? { errorMessage } : {}),
		timestamp: Date.now(),
	};
}

function stream(content: AssistantMessage["content"], stopReason: "length" | "stop" | "toolUse") {
	const result = createAssistantMessageEventStream();
	const pending = message([], "pending");
	result.push({ type: "start", partial: pending });
	for (const [contentIndex, item] of content.entries()) {
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

function toolStream(name: string, arguments_: Record<string, unknown>) {
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
		const content = Reflect.get(entry, "content");
		if (typeof content === "string") {
			text.push(content);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const item of content) {
			if (item && typeof item === "object" && Reflect.get(item, "type") === "text") {
				const value = Reflect.get(item, "text");
				if (typeof value === "string") text.push(value);
			}
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
	pi.events.on(CONTEXT_COMPACTION_BYPASSED_EVENT, (event) => {
		if (
			typeof event === "object" &&
			event !== null &&
			Reflect.get(event, "schemaVersion") === 1 &&
			Reflect.get(event, "source") === "magic-context"
		) {
			log({ type: "context_compaction_bypassed" });
		}
	});
	pi.registerProvider(PROVIDER, {
		name: "Pi Stuff Goal lifecycle fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Pi Stuff Goal lifecycle fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
		streamSimple: (_model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => response(context),
	});

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
