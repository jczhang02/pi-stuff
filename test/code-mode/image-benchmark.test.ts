import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getImageDimensions } from "@earendil-works/pi-tui";
import {
	analyzeSession,
	createChallengePng,
	evaluateImageBenchmark,
	IMAGE_BENCHMARK_CODES,
	type ImageBenchmarkCase,
	sanitizeBenchmarkSearchQuery,
} from "../../scripts/code-mode-image-benchmark-core.js";
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
		sessionImageCount: 1,
		sessionSafe: true,
		timedOut: false,
		toolChoice: passed,
		transferExact: true,
		understood: true,
	};
}

test("all preregistered challenge PNGs are distinct and decoder-readable", () => {
	const images = Object.values(IMAGE_BENCHMARK_CODES).flat().map(createChallengePng);
	expect(new Set(images.map((image) => createHash("sha256").update(image).digest("hex"))).size).toBe(40);
	for (const image of images) {
		expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		expect(getImageDimensions(image.toString("base64"), "image/png")).toEqual({ heightPx: 80, widthPx: 304 });
	}
});

test("Session analysis counts images only in persisted Provider messages", () => {
	const image = { data: createChallengePng("731905").toString("base64"), mimeType: "image/png", type: "image" };
	const analysis = analyzeSession([
		{ data: { result: { json: { content: [image] } }, value: { json: { content: [image] } } }, type: "custom" },
		{ message: { content: [image], role: "toolResult" }, type: "message" },
	]);
	expect(analysis.imageBlocks).toEqual([{ data: image.data, mimeType: "image/png" }]);
});

test("benchmark search evidence redacts temporary project paths", () => {
	expect(sanitizeBenchmarkSearchQuery("view /run/private/project/challenge.png", "/run/private/project")).toBe(
		"view <project>/challenge.png",
	);
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
