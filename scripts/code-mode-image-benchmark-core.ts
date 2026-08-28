import { deflateSync } from "node:zlib";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { JsonObject, JsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";

export const REQUIRED_TOOL_SUCCESSES = 18;
export const REQUIRED_HARD_SUCCESSES = 20;
const codes = (...groups: string[]): readonly string[] => groups.flatMap((group) => group.split(" "));
export const IMAGE_BENCHMARK_CODES = {
	baseline: codes(
		"731905 284167 609352 418730 952641 367824 805219 146593 573086 920475",
		"238761 694028 351972 782436 469105 817354 205687 936412 542809 173648",
	),
	candidate: codes(
		"615204 807361 392570 708143 154829 683517 429630 571264 836951 247583",
		"918426 365701 729815 481692 653278 194537 826149 537284 961750 348625",
	),
};
const SESSIONS_PER_ARM = IMAGE_BENCHMARK_CODES.baseline.length;
const DIGITS = [
	["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
	["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
	["11111", "00001", "00001", "11111", "10000", "10000", "11111"],
	["11111", "00001", "00001", "01111", "00001", "00001", "11111"],
	["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
	["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
	["11111", "10000", "10000", "11111", "10001", "10001", "11111"],
	["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
	["11111", "10001", "10001", "11111", "10001", "10001", "11111"],
	["11111", "10001", "10001", "11111", "00001", "00001", "11111"],
] as const;

export type Arm = "baseline" | "candidate";

const IMAGE_OBSERVATION_SCHEMA = Type.Object({
	bytes: Type.Number(),
	mimeType: Type.String(),
	sha256: Type.String(),
	valid: Type.Boolean(),
});
const PROVIDER_OBSERVATION_SCHEMA = Type.Object({
	codeModeDefinitionCharacters: Type.Number(),
	imageCount: Type.Number(),
	images: Type.Array(IMAGE_OBSERVATION_SCHEMA),
	nodes: Type.Number(),
	payloadBytes: Type.Number(),
	payloadSha256: Type.String(),
	phase: Type.Union([Type.Literal("image"), Type.Literal("resume")]),
	providerToolDefinitionCharacters: Type.Number(),
	toolNames: Type.Array(Type.String()),
});
export type ProviderObservation = Static<typeof PROVIDER_OBSERVATION_SCHEMA>;
export interface ImageBenchmarkCase {
	readonly answer: string;
	readonly arm: Arm;
	readonly code: string;
	readonly codeModeErrors: number;
	readonly endToEnd: boolean;
	readonly explicitImageHelper: boolean;
	readonly firstExit: number | null;
	readonly imagePersistedOnce: boolean;
	readonly instrumentationValid: boolean;
	readonly nestedTools: readonly string[];
	readonly providerEvidence: readonly ProviderObservation[];
	readonly providerRequests: number;
	readonly providerToolDefinitionCharacters: number;
	readonly repetition: number;
	readonly resumeExit: number | null;
	readonly searchQueries: readonly string[];
	readonly sessionImageCount: number;
	readonly sessionSafe: boolean;
	readonly timedOut: boolean;
	readonly toolChoice: boolean;
	readonly transferExact: boolean;
	readonly understood: boolean;
}
interface ArmMetrics {
	readonly endToEnd: Metric;
	readonly sessionSafe: Metric;
	readonly toolChoice: Metric;
	readonly transferExact: Metric;
	readonly understood: Metric;
}
interface Metric {
	readonly interval95: readonly [number, number];
	readonly successes: number;
	readonly total: number;
}
export interface SessionAnalysis {
	readonly codeModeErrors: number;
	readonly explicitImageHelper: boolean;
	readonly imageBlocks: readonly { readonly data: string; readonly mimeType: string }[];
	readonly nestedTools: readonly string[];
	readonly searchQueries: readonly string[];
}

export function failBenchmark(message: string): never {
	throw new Error(`Code Mode image benchmark failed: ${message}`);
}

function crc32(value: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of value) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
	const name = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
	return Buffer.concat([length, name, data, checksum]);
}

export function createChallengePng(code: string): Buffer {
	if (!/^\d{6}$/u.test(code)) failBenchmark("challenge code must contain exactly six digits");
	const scale = 8;
	const margin = 12;
	const gap = 8;
	const width = margin * 2 + code.length * 5 * scale + (code.length - 1) * gap;
	const height = margin * 2 + 7 * scale;
	const rows = Buffer.alloc((width + 1) * height, 255);
	for (let y = 0; y < height; y += 1) rows[y * (width + 1)] = 0;
	for (const [digitIndex, digit] of [...code].entries()) {
		const glyph = DIGITS[Number(digit)];
		if (!glyph) failBenchmark(`missing glyph ${digit}`);
		for (const [rowIndex, row] of glyph.entries()) {
			for (const [columnIndex, pixel] of [...row].entries()) {
				if (pixel !== "1") continue;
				for (let dy = 0; dy < scale; dy += 1) {
					const y = margin + rowIndex * scale + dy;
					for (let dx = 0; dx < scale; dx += 1) {
						const x = margin + digitIndex * (5 * scale + gap) + columnIndex * scale + dx;
						rows[y * (width + 1) + x + 1] = 0;
					}
				}
			}
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 0, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(rows)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function jsonObject(value: JsonValue | undefined): JsonObject | undefined {
	if (value === null || Array.isArray(value) || !isRuntimeObject(value)) return undefined;
	return value;
}

export function analyzeSession(entries: readonly JsonValue[]): SessionAnalysis {
	const imageBlocks: { data: string; mimeType: string }[] = [];
	const nestedTools: string[] = [];
	const searchQueries: string[] = [];
	let codeModeErrors = 0;
	let explicitImageHelper = false;
	function visit(value: JsonValue): void {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const record = jsonObject(value);
		if (!record) return;
		if (record["type"] === "image" && isRuntimeString(record["data"]) && isRuntimeString(record["mimeType"])) {
			imageBlocks.push({ data: record["data"], mimeType: record["mimeType"] });
		}
		if (record["kind"] === "pi-stuff-code-mode") {
			if (record["status"] !== "success") codeModeErrors += 1;
			const operations = record["operations"];
			if (Array.isArray(operations)) {
				for (const operation of operations) {
					const operationRecord = jsonObject(operation);
					if (operationRecord && isRuntimeString(operationRecord["name"]))
						nestedTools.push(operationRecord["name"]);
				}
			}
		}
		const arguments_ = jsonObject(record["arguments"]);
		if (record["type"] === "toolCall" && record["name"] === "codemode" && arguments_) {
			const source = arguments_["code"];
			if (isRuntimeString(source) && /\bimage\s*\(/u.test(source)) explicitImageHelper = true;
		}
		if (record["type"] === "toolCall" && record["name"] === "tool_search" && arguments_) {
			const query = arguments_["query"];
			if (isRuntimeString(query)) searchQueries.push(query);
		}
		for (const item of Object.values(record)) visit(item);
	}
	for (const entry of entries) {
		const record = jsonObject(entry);
		if (record?.["type"] === "message" && record["message"] !== undefined) visit(record["message"]);
	}
	return {
		codeModeErrors,
		explicitImageHelper,
		imageBlocks,
		nestedTools: [...new Set(nestedTools)],
		searchQueries: [...new Set(searchQueries)],
	};
}

export function parseProviderObservation(line: string): ProviderObservation {
	const value: unknown = JSON.parse(line);
	if (!Check(PROVIDER_OBSERVATION_SCHEMA, value)) failBenchmark("observer emitted malformed JSON");
	return value;
}

export function sanitizeBenchmarkSearchQuery(query: string, project: string): string {
	return query.replaceAll(project, "<project>");
}

function interval95(successes: number, total: number): readonly [number, number] {
	if (total === 0) return [0, 1];
	const z = 1.959963984540054;
	const proportion = successes / total;
	const denominator = 1 + (z * z) / total;
	const center = (proportion + (z * z) / (2 * total)) / denominator;
	const margin =
		(z / denominator) * Math.sqrt((proportion * (1 - proportion)) / total + (z * z) / (4 * total * total));
	return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function metric(
	cases: readonly ImageBenchmarkCase[],
	key: keyof Pick<ImageBenchmarkCase, "endToEnd" | "sessionSafe" | "toolChoice" | "transferExact" | "understood">,
): Metric {
	const successes = cases.filter((item) => item[key]).length;
	return { successes, total: cases.length, interval95: interval95(successes, cases.length) };
}

function armMetrics(cases: readonly ImageBenchmarkCase[]): ArmMetrics {
	return {
		endToEnd: metric(cases, "endToEnd"),
		sessionSafe: metric(cases, "sessionSafe"),
		toolChoice: metric(cases, "toolChoice"),
		transferExact: metric(cases, "transferExact"),
		understood: metric(cases, "understood"),
	};
}

export function evaluateImageBenchmark(cases: readonly ImageBenchmarkCase[]) {
	const baselineCases = cases.filter((item) => item.arm === "baseline");
	const candidateCases = cases.filter((item) => item.arm === "candidate");
	const baseline = armMetrics(baselineCases);
	const candidate = armMetrics(candidateCases);
	const baselineDefinitions = baselineCases
		.map((item) => item.providerToolDefinitionCharacters)
		.filter((value) => value > 0);
	const candidateDefinitions = candidateCases
		.map((item) => item.providerToolDefinitionCharacters)
		.filter((value) => value > 0);
	const standingContextNoIncrease =
		baselineDefinitions.length === SESSIONS_PER_ARM &&
		candidateDefinitions.length === SESSIONS_PER_ARM &&
		Math.max(...candidateDefinitions) <= Math.min(...baselineDefinitions);
	return {
		baseline,
		candidate,
		standingContextNoIncrease,
		candidatePass:
			candidateCases.length === SESSIONS_PER_ARM &&
			candidateCases.every(
				(item) => item.instrumentationValid && item.imagePersistedOnce && item.codeModeErrors === 0,
			) &&
			candidate.transferExact.successes >= REQUIRED_HARD_SUCCESSES &&
			candidate.sessionSafe.successes >= REQUIRED_HARD_SUCCESSES &&
			candidate.toolChoice.successes >= REQUIRED_TOOL_SUCCESSES &&
			candidate.understood.successes >= REQUIRED_TOOL_SUCCESSES &&
			candidate.endToEnd.successes >= REQUIRED_TOOL_SUCCESSES &&
			standingContextNoIncrease,
	};
}
