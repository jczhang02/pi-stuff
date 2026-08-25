import type { Api, AssistantMessage, Context, Model, ModelsApiStreamOptions } from "@earendil-works/pi-ai";
import type { NamingMessage } from "./prompt.js";
import { assistantText, buildNamingPrompt, cleanModelName, fallbackName, isHighQualityName } from "./prompt.js";
import type { SessionNamingSettings } from "./settings.js";

const MAX_OUTPUT_TOKENS = 64;
const PER_ATTEMPT_TIMEOUT_MS = 12_000;
const TOTAL_TIMEOUT_MS = 30_000;

export interface GeneratedSessionName {
	readonly name: string;
	readonly source: "ai" | "fallback";
}

interface AttemptSignal {
	dispose(): void;
	readonly signal: AbortSignal;
}

export interface SessionNamingModelContext {
	readonly model: Model<Api> | undefined;
	readonly modelRegistry: {
		complete(model: Model<Api>, context: Context, options?: ModelsApiStreamOptions<Api>): Promise<AssistantMessage>;
		find(provider: string, modelId: string): Model<Api> | undefined;
		hasConfiguredAuth(model: Model<Api>): boolean;
	};
}

function parseModelReference(reference: string): { modelId: string; provider: string } | undefined {
	const separator = reference.indexOf("/");
	if (separator <= 0 || separator >= reference.length - 1) return undefined;
	return { provider: reference.slice(0, separator), modelId: reference.slice(separator + 1) };
}

function modelKey(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

export function buildModelChain(ctx: SessionNamingModelContext, settings: SessionNamingSettings): Model<Api>[] {
	const result: Model<Api>[] = [];
	const seen = new Set<string>();
	const addReference = (reference: string | undefined): void => {
		if (!reference) return;
		const parsed = parseModelReference(reference);
		if (!parsed) return;
		const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
		if (!model || seen.has(modelKey(model))) return;
		seen.add(modelKey(model));
		result.push(model);
	};
	addReference(settings.model);
	for (const reference of settings.fallbackModels) addReference(reference);
	if (ctx.model && !seen.has(modelKey(ctx.model))) result.push(ctx.model);
	return result;
}

function attemptSignal(parent: AbortSignal, timeoutMs: number): AttemptSignal {
	const controller = new AbortController();
	const abortFromParent = (): void => controller.abort(parent.reason);
	if (parent.aborted) abortFromParent();
	else parent.addEventListener("abort", abortFromParent, { once: true });
	const timeout = setTimeout(() => controller.abort(new Error("Session naming request timed out")), timeoutMs);
	return {
		dispose() {
			clearTimeout(timeout);
			parent.removeEventListener("abort", abortFromParent);
		},
		signal: controller.signal,
	};
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const aborted = (): void => reject(signal.reason);
		signal.addEventListener("abort", aborted, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", aborted);
				resolve(value);
			},
			(cause: unknown) => {
				signal.removeEventListener("abort", aborted);
				reject(cause);
			},
		);
	});
}

export async function generateSessionName(
	ctx: SessionNamingModelContext,
	settings: SessionNamingSettings,
	messages: readonly NamingMessage[],
	currentName: string | undefined,
	signal: AbortSignal,
	clock: () => number = Date.now,
): Promise<GeneratedSessionName | undefined> {
	if (messages.length === 0 || signal.aborted) return undefined;
	const prompt = buildNamingPrompt(messages, currentName);
	const startedAt = clock();
	for (const model of buildModelChain(ctx, settings)) {
		if (signal.aborted) return undefined;
		const remaining = TOTAL_TIMEOUT_MS - (clock() - startedAt);
		if (remaining <= 0) break;
		if (!ctx.modelRegistry.hasConfiguredAuth(model)) continue;
		const attempt = attemptSignal(signal, Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining));
		try {
			const response = await awaitWithSignal(
				ctx.modelRegistry.complete(
					model,
					{
						systemPrompt: prompt.systemPrompt,
						messages: [{ role: "user", content: prompt.userPrompt, timestamp: clock() }],
					},
					{ cacheRetention: "none", maxTokens: MAX_OUTPUT_TOKENS, signal: attempt.signal },
				),
				attempt.signal,
			);
			if (attempt.signal.aborted) continue;
			const text = assistantText(response);
			const candidate = text ? cleanModelName(text) : undefined;
			if (candidate && isHighQualityName(candidate)) return { name: candidate, source: "ai" };
		} catch {
			// Naming is best-effort. Try the next configured model, then the local fallback.
		} finally {
			attempt.dispose();
		}
	}
	if (signal.aborted) return undefined;
	const fallback = fallbackName(messages);
	return fallback && isHighQualityName(fallback) ? { name: fallback, source: "fallback" } : undefined;
}
