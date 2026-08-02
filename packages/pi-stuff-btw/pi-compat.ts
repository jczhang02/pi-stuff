/**
 * The sole Pi-model transport seam used by BTW.
 *
 * Pi 0.83 does not expose ModelRuntime.streamSimple on ExtensionContext. The
 * public ModelRegistry does expose the composed Provider and its resolved auth,
 * so BTW delegates to that Provider instead of the legacy global compat
 * dispatcher. This preserves extension-registered streamSimple handlers and
 * auth-derived base URLs without reaching into private Host state.
 */

import type {
	Api,
	AssistantMessageEventStream,
	AuthResult,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

class BtwTransportConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BtwTransportConfigurationError";
	}
}

export interface OpenBtwStreamRequest {
	readonly ctx: ExtensionContext;
	readonly model: Model<Api>;
	readonly context: Context;
	readonly signal: AbortSignal;
}

export async function openBtwStream(request: OpenBtwStreamRequest): Promise<AssistantMessageEventStream> {
	const { ctx, model, context, signal } = request;
	const registry = ctx.modelRegistry;
	const reasoning = ctx.thinkingLevel;
	const provider = registry.getProvider(model.provider);
	if (!provider) {
		throw new BtwTransportConfigurationError(`unknown provider: ${model.provider}`);
	}

	let resolved: AuthResult | undefined;
	try {
		resolved = await registry.getProviderAuth(model.provider);
	} catch (error) {
		throw new BtwTransportConfigurationError(error instanceof Error ? error.message : String(error));
	}

	let requestModel: Model<Api> = model;
	const options: SimpleStreamOptions = { signal };
	if (reasoning !== undefined && reasoning !== "off") options.reasoning = reasoning;

	// This model-aware facade applies Pi's provider, extension, models.json, and
	// per-model header composition. Provider-only auth omits those model layers.
	const requestAuth = await registry.getApiKeyAndHeaders(model);
	if (!requestAuth.ok) throw new BtwTransportConfigurationError(requestAuth.error);
	if (resolved?.auth.baseUrl) requestModel = { ...model, baseUrl: resolved.auth.baseUrl };
	if (requestAuth.apiKey !== undefined) options.apiKey = requestAuth.apiKey;
	if (requestAuth.headers !== undefined) options.headers = requestAuth.headers;
	if (requestAuth.env !== undefined) options.env = requestAuth.env;

	return provider.streamSimple(requestModel, context, options);
}
