import { describe, expect, test } from "bun:test";
import {
	buildModelCandidates,
	MAX_MODEL_CANDIDATES_PER_CHILD,
} from "../../packages/pi-stuff-agents/src/runs/shared/model-fallback.js";

describe("Agent model fallback proof bounds", () => {
	test("accepts 64 total candidates and rejects the 65th before any writer can spawn", () => {
		const sixtyThreeFallbacks = Array.from(
			{ length: MAX_MODEL_CANDIDATES_PER_CHILD - 1 },
			(_, index) => `provider/fallback-${index}`,
		);
		expect(buildModelCandidates("provider/primary", sixtyThreeFallbacks, undefined)).toHaveLength(
			MAX_MODEL_CANDIDATES_PER_CHILD,
		);
		expect(() =>
			buildModelCandidates("provider/primary", [...sixtyThreeFallbacks, "provider/fallback-overflow"], undefined),
		).toThrow("at most 64 model candidates");
	});
});
