import Tokenizer from "ai-tokenizer";
import * as o200kBase from "ai-tokenizer/encoding/o200k_base";

const PONYTAIL_PROMPT_TOKENIZER = new Tokenizer(o200kBase);

/** Measure the Capability-owned prompt independently from Context Management. */
export function countPonytailPromptTokens(prompt: string): number {
	return PONYTAIL_PROMPT_TOKENIZER.count(prompt);
}
