import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getImageDimensions } from "@earendil-works/pi-tui";
import {
	createChallengePng,
	evaluateImageBenchmark,
	type ImageBenchmarkCase,
} from "../../scripts/benchmark-code-mode-image.js";
import { inspectProviderPayload } from "../fixtures/code-mode-image-benchmark-observer.js";

function benchmarkCase(arm: "baseline" | "candidate", repetition: number): ImageBenchmarkCase {
	const passed = arm === "candidate";
	return {
		answer: "731905",
		arm,
		code: "731905",
		codeModeErrors: 0,
		endToEnd: passed,
		explicitImageHelper: false,
		firstExit: 0,
		imagePersistedOnce: true,
		instrumentationValid: true,
		nestedTools: passed ? ["view_image"] : ["read"],
		providerEvidence: [],
		providerRequests: 3,
		providerToolDefinitionCharacters: arm === "candidate" ? 100 : 101,
		repetition,
		resumeExit: 0,
		searchQueries: [],
		sessionSafe: true,
		timedOut: false,
		toolChoice: passed,
		transferExact: true,
		understood: true,
	};
}

test("benchmark challenge PNGs are distinct and decoder-readable", () => {
	const first = createChallengePng("731905");
	const second = createChallengePng("284167");
	expect(first.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	expect(second).not.toEqual(first);
	expect(getImageDimensions(first.toString("base64"), "image/png")).toEqual({ heightPx: 80, widthPx: 304 });
});

test("Provider observer traverses complete payloads while retaining only image and schema evidence", () => {
	const image = createChallengePng("731905");
	const record = inspectProviderPayload(
		{
			input: [
				{ content: [{ image_url: `data:image/png;base64,${image.toString("base64")}`, type: "input_image" }] },
			],
			tools: [
				{ description: "Code Mode", name: "codemode", parameters: {}, type: "function" },
				{ description: "Search", name: "tool_search", parameters: {}, type: "function" },
			],
		},
		"image",
	);
	expect(record.providerToolDefinitionCharacters > record.codeModeDefinitionCharacters).toBe(true);
	expect(record).toMatchObject({
		codeModeDefinitionCharacters: expect.any(Number),
		imageCount: 1,
		phase: "image",
		providerToolDefinitionCharacters: expect.any(Number),
		toolNames: ["codemode", "tool_search"],
	});
	expect(record.images).toEqual([
		{
			bytes: image.length,
			mimeType: "image/png",
			sha256: createHash("sha256").update(image).digest("hex"),
			valid: true,
		},
	]);
});

test("benchmark verdict applies preregistered hard and behavioral gates", () => {
	const cases = Array.from({ length: 20 }, (_, index) => [
		benchmarkCase("baseline", index + 1),
		benchmarkCase("candidate", index + 1),
	]).flat();
	const passed = evaluateImageBenchmark(cases);
	expect(passed.candidatePass).toBe(true);
	expect(passed.candidate.endToEnd).toMatchObject({ successes: 20, total: 20 });

	const failed = cases.map((item, index) => (index === 1 ? { ...item, sessionSafe: false } : item));
	expect(evaluateImageBenchmark(failed).candidatePass).toBe(false);
});
