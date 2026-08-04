// biome-ignore-all lint/complexity/useLiteralKeys: TypeScript enforces bracket access for untrusted index-signature data.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";

export interface CodexAccount {
	readonly accountId: string;
	readonly baseUrl: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly token: string;
}

type CodexModel = NonNullable<ExtensionContext["model"]>;

function headerValue(headers: Readonly<Record<string, string>> | undefined, name: string): string | undefined {
	const normalized = name.toLowerCase();
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() === normalized && value.trim()) return value.trim();
	}
	return undefined;
}

function bearerToken(headers: Readonly<Record<string, string>> | undefined): string | undefined {
	return headerValue(headers, "authorization")
		?.match(/^Bearer\s+(.+)$/iu)?.[1]
		?.trim();
}

function accountIdFromToken(token: string): string | undefined {
	try {
		const encoded = token.split(".")[1];
		if (!encoded) return undefined;
		const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
		if (typeof payload !== "object" || payload === null) return undefined;
		const claims = (payload as Record<string, unknown>)[JWT_AUTH_CLAIM];
		if (typeof claims !== "object" || claims === null) return undefined;
		const accountId = (claims as Record<string, unknown>)["chatgpt_account_id"];
		return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
	} catch {
		return undefined;
	}
}

export function isOpenAICodexResponsesModel(model: ExtensionContext["model"]): model is CodexModel {
	return model?.provider.toLowerCase() === "openai-codex" && Boolean(model.api?.includes("responses"));
}

export function supportsCodexImages(model: ExtensionContext["model"]): boolean {
	return isOpenAICodexResponsesModel(model) && Array.isArray(model?.input) && model.input.includes("image");
}

export async function resolveCodexAccount(ctx: ExtensionContext): Promise<CodexAccount> {
	const model = ctx.model;
	if (!isOpenAICodexResponsesModel(model)) {
		throw new Error("Select an OpenAI Codex subscription model first.");
	}
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	const headers = { ...model.headers, ...auth.headers };
	const token = auth.apiKey?.trim() || bearerToken(headers);
	if (!token) throw new Error("OpenAI Codex is not authenticated; run /login openai-codex.");
	const accountId = headerValue(headers, "chatgpt-account-id") ?? accountIdFromToken(token);
	if (!accountId) throw new Error("OpenAI Codex authentication has no account id; run /login openai-codex again.");
	return {
		accountId,
		baseUrl: model.baseUrl?.trim() || DEFAULT_CODEX_BASE_URL,
		headers,
		token,
	};
}
