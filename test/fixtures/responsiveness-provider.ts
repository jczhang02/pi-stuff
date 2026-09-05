import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JsonInputObject } from "../../packages/pi-stuff/src/shared/json-value.js";
import { createAssistantMessage, createTextStream, registerFixtureProvider } from "./faux-provider.js";

const usageUrl = process.env["PSYON_USAGE_URL"];
const baseMessage = createAssistantMessage(usageUrl ? "openai-codex" : "psyon-cadence", "cadence-model");
const message: typeof baseMessage = (content, reason, usage) => ({
	...baseMessage(content, reason, usage),
	api: usageUrl ? "openai-responses" : "openai-completions",
});

function log(record: JsonInputObject): void {
	const path = process.env["PSYON_PROVIDER_LOG"];
	if (path) appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function block(phase: string): void {
	if ((process.env["PSYON_NEGATIVE_BLOCK_PHASE"] ?? "pre-tool") !== phase) return;
	const until = performance.now() + Number(process.env["PSYON_NEGATIVE_BLOCK_MS"] ?? 0);
	// Explicit negative control; never enabled in ordinary responsiveness samples.
	while (performance.now() < until) {}
}

async function seedLedger(pi: ExtensionAPI, context: ExtensionContext): Promise<void> {
	// Native-only calibration must not import the Suite. Only the preparatory seed process loads this Module.
	const { CodeModeSessionLedger, CODE_MODE_LEDGER_ENTRY_TYPE } = await import(
		"../../packages/pi-stuff/src/code-mode/ledger.js"
	);
	const ledger = new CodeModeSessionLedger(pi);
	const value = "x".repeat(800_000);
	for (let index = 0; index < 24; index += 1) {
		const execution = ledger.begin(
			context,
			`seed-${String(index)}`,
			"text('fixture')",
			new Map([["read", "record"]]),
		);
		execution.beginPass(0);
		const plan = execution.beginToolCall("read", { path: `synthetic-${String(index)}` });
		execution.completeToolCall(plan, { status: "success", value });
		execution.finish("success");
		if (index === 23 && process.env["PSYON_LEDGER_SNIPPET"] === "1") {
			ledger.saveSnippet(context, execution.executionId, "resource-seed");
		}
	}
	const entries = context.sessionManager
		.getBranch()
		.filter((entry) => entry.type === "custom" && entry.customType === CODE_MODE_LEDGER_ENTRY_TYPE);
	assert.equal(entries.length, process.env["PSYON_LEDGER_SNIPPET"] === "1" ? 97 : 96);
	log({
		type: "seed-ready",
		entries: entries.length,
		bytes: entries.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0),
	});
}

const streamSimple: NonNullable<Parameters<ExtensionAPI["registerProvider"]>[1]["streamSimple"]> = (
	_model,
	context,
) => {
	if (process.env["PSYON_SEED_LEDGER"] === "1") return createTextStream(message)("PSYON_SEEDED");
	if (context.systemPrompt?.includes("concise semantic labels for coding sessions")) {
		log({ type: "naming-request" });
		return createTextStream(message)("Cadence Resource Fixture");
	}
	const results = context.messages.filter((entry) => entry.role === "toolResult");
	log({ type: "agent-request", completedTools: results.length });
	const result = results.at(-1);
	const completed = results.length >= (process.env["PSYON_REPEAT_TOOL"] === "1" ? 2 : 1);
	if (
		result &&
		(result.isError ||
			!result.content.some((part) => part.type === "text" && part.text.includes("PSYON_TOOL_RESULT")))
	) {
		throw new Error("Cadence Tool failed or omitted its required result");
	}
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	stream.push({ type: "start", partial: pending });
	setTimeout(() => {
		if (completed) {
			const text = "PSYON_CADENCE_DONE";
			pending.content.push({ type: "text", text });
			stream.push({ type: "text_start", contentIndex: 0, partial: pending });
			stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
			stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
			stream.push({ type: "done", reason: "stop", message: message(pending.content, "stop") });
			return;
		}
		block("pre-tool");
		const toolCall =
			process.env["PSYON_TOOL_MODE"] === "codemode"
				? {
						type: "toolCall" as const,
						id: `cadence-codemode-${String(results.length)}`,
						name: "codemode",
						arguments: {
							code: 'const result = await tools.bash({ command: "sleep 2; printf PSYON_TOOL_RESULT" }); text(result);',
						},
					}
				: {
						type: "toolCall" as const,
						id: `cadence-bash-${String(results.length)}`,
						name: "bash",
						arguments: { command: "sleep 2; printf PSYON_TOOL_RESULT" },
					};
		pending.content.push(toolCall);
		stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
		stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
		stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	}, 4_000);
	return stream;
};

export default function responsivenessProvider(pi: ExtensionAPI): void {
	log({ type: "fixture-ready", pid: process.pid });
	pi.on("session_start", async (_event, ctx) => {
		if (process.env["PSYON_SEED_LEDGER"] === "1") return seedLedger(pi, ctx);
		if (process.env["PSYON_NEGATIVE_BLOCK_PHASE"] === "startup")
			await new Promise((resolve) => setTimeout(resolve, 100));
		block("startup");
		ctx.ui.notify("PSYON_READY", "info");
	});
	pi.on("agent_end", (_event, ctx) => ctx.ui.notify("PSYON_AGENT_END", "info"));
	pi.on("agent_settled", async (_event, ctx) => {
		if (process.env["PSYON_NEGATIVE_BLOCK_PHASE"] === "settlement") {
			await new Promise((resolve) => setTimeout(resolve, 100));
			block("settlement");
		}
		// Adjacent notifications may be coalesced before the terminal paints.
		ctx.ui.notify("PSYON_AGENT_END PSYON_SETTLED", "info");
	});
	for (const name of ["psyon-one", "psyon-two"]) pi.registerCommand(name, { handler: async () => {} });
	if (usageUrl) {
		const url = new URL(usageUrl);
		assert(url.hostname === "127.0.0.1" && url.protocol === "http:", "Usage fixture must stay on loopback");
		pi.registerProvider("openai-codex", {
			name: "Synthetic Codex account",
			baseUrl: usageUrl,
			apiKey: "synthetic-fixture-token",
			headers: { "chatgpt-account-id": "synthetic-fixture-account" },
			api: "openai-responses",
			streamSimple,
			models: [
				{
					id: "cadence-model",
					name: "Cadence model",
					api: "openai-responses",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200_000,
					maxTokens: 4_096,
				},
			],
		});
	} else registerFixtureProvider(pi, "psyon-cadence", "cadence-model", "Native cadence", streamSimple);
	pi.on("session_info_changed", (event) => log({ type: "name-persisted", name: event.name }));
}
