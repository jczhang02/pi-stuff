import { describe, expect, test } from "bun:test";
import type { Api, AssistantMessage, Context, Model, ModelsApiStreamOptions } from "@earendil-works/pi-ai";
import {
	buildModelChain,
	generateSessionName,
	type SessionNamingModelContext,
} from "../../packages/pi-stuff/src/session-naming/model.js";
import type { SessionNamingSettings } from "../../packages/pi-stuff/src/session-naming/settings.js";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function model(provider: string, id: string): Model<Api> {
	return {
		id,
		name: `${provider}/${id}`,
		api: "openai-completions",
		provider,
		baseUrl: "https://fixture.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4_096,
	};
}

function response(provider: string, id: string, text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider,
		model: id,
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: 1,
	};
}

function settings(overrides: Partial<SessionNamingSettings> = {}): SessionNamingSettings {
	return {
		schemaVersion: 1,
		enabled: true,
		cooldownMinutes: 10,
		respectManualName: false,
		fallbackModels: [],
		...overrides,
	};
}

describe("Session Naming model selection", () => {
	test("orders configured models before the active model and removes duplicates", () => {
		const primary = model("fixture", "primary");
		const backup = model("fixture", "backup");
		const registry = new Map([
			["fixture/primary", primary],
			["fixture/backup", backup],
		]);
		const ctx = {
			model: backup,
			modelRegistry: {
				complete: async () => response("fixture", "backup", "Unused"),
				find: (provider: string, id: string) => registry.get(`${provider}/${id}`),
				hasConfiguredAuth: () => true,
			},
		} satisfies SessionNamingModelContext;

		expect(
			buildModelChain(
				ctx,
				settings({ model: "fixture/primary", fallbackModels: ["fixture/backup", "fixture/primary"] }),
			).map((candidate) => `${candidate.provider}/${candidate.id}`),
		).toEqual(["fixture/primary", "fixture/backup"]);
	});

	test("uses the public registry, bounded options, and redacted prompt", async () => {
		const selected = model("fixture", "primary");
		const calls: { context: Context; options: ModelsApiStreamOptions<Api> | undefined }[] = [];
		const ctx = {
			model: selected,
			modelRegistry: {
				find: () => undefined,
				hasConfiguredAuth: () => true,
				async complete(_model: Model<Api>, context: Context, options?: ModelsApiStreamOptions<Api>) {
					calls.push({ context, options });
					return response("fixture", "primary", '"Session Naming Safety"');
				},
			},
		} satisfies SessionNamingModelContext;

		expect(
			await generateSessionName(
				ctx,
				settings(),
				[{ role: "user", content: "Fix api_key=do-not-send-this naming" }],
				new AbortController().signal,
			),
		).toEqual({ name: "Session Naming Safety", source: "ai" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.context.messages[0]?.content).not.toContain("do-not-send-this");
		expect(calls[0]?.options).toMatchObject({ cacheRetention: "none", maxTokens: 64 });
		expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
	});

	test("falls back locally when no authenticated model is available", async () => {
		const selected = model("fixture", "primary");
		const ctx = {
			model: selected,
			modelRegistry: {
				complete: async () => response("fixture", "primary", "Unused"),
				find: () => undefined,
				hasConfiguredAuth: () => false,
			},
		} satisfies SessionNamingModelContext;

		expect(
			await generateSessionName(
				ctx,
				settings(),
				[{ role: "user", content: "Please repair automatic Session naming" }],
				new AbortController().signal,
			),
		).toEqual({ name: "repair automatic Session", source: "fallback" });
	});

	test("stops when the lifecycle aborts a provider that ignores its signal", async () => {
		const selected = model("fixture", "primary");
		const ctx = {
			model: selected,
			modelRegistry: {
				find: () => undefined,
				hasConfiguredAuth: () => true,
				complete: () => new Promise<AssistantMessage>(() => undefined),
			},
		} satisfies SessionNamingModelContext;
		const abort = new AbortController();
		const naming = generateSessionName(
			ctx,
			settings(),
			[{ role: "user", content: "Repair a hanging naming provider" }],
			abort.signal,
		);

		abort.abort(new Error("Session ended"));
		expect(await naming).toBeUndefined();
	});
});
