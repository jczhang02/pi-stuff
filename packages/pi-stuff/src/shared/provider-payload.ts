import Tokenizer from "ai-tokenizer";
import * as o200kBase from "ai-tokenizer/encoding/o200k_base";

export type ProviderPayloadModel = {
	provider?: string;
	id?: string;
	contextWindow?: number;
	maxTokens?: number;
};

const OPENAI_PAYLOAD_TOKENIZER = new Tokenizer(o200kBase);

function usesO200kTokenizer(model: ProviderPayloadModel | undefined): boolean {
	if (model?.provider === "openai-codex") return true;
	if (model?.provider !== "openai" && model?.provider !== "azure-openai-responses") return false;
	const id = model.id?.toLowerCase();
	if (!id) return false;
	return /^(?:chatgpt-4o|gpt-4o|gpt-5|o[134](?:-|$))/u.test(id);
}

export function estimateProviderPayloadTokens(serialized: string, model: ProviderPayloadModel | undefined): number {
	if (usesO200kTokenizer(model)) {
		try {
			return OPENAI_PAYLOAD_TOKENIZER.count(serialized);
		} catch {
			// The byte-level upper bound below remains safe if tokenization fails.
		}
	}
	return Buffer.byteLength(serialized, "utf8");
}

export function boundedContextInputCapacity(model: ProviderPayloadModel | undefined): number | undefined {
	const contextWindow = model?.contextWindow;
	if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
	return Math.floor(contextWindow * 0.95);
}
