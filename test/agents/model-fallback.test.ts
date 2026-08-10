import { describe, expect, test } from "bun:test";
import {
	buildModelCandidates,
	isRetryableModelFailure,
	MAX_MODEL_CANDIDATES_PER_CHILD,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/model-fallback.js";

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

	test("retries a larger fallback after the terminal child-payload gate rejects a small model", () => {
		expect(
			isRetryableModelFailure(
				"Agent launch stopped before the provider request: the final child payload is 5,012 UTF-8 bytes, above the safe 4,000-byte input bound for this model.",
			),
		).toBeTrue();
	});
});
