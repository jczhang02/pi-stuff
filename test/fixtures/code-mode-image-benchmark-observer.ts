import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	isJsonInputObject,
	type JsonInputObject,
	type JsonInputValue,
	requireJsonInputValue,
} from "../../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeString } from "../../packages/pi-stuff/src/shared/runtime-type.js";

export interface BenchmarkImageObservation {
	readonly bytes: number;
	readonly mimeType: string;
	readonly sha256: string;
	readonly valid: boolean;
}

export interface BenchmarkProviderObservation {
	readonly codeModeDefinitionCharacters: number;
	readonly imageCount: number;
	readonly images: readonly BenchmarkImageObservation[];
	readonly nodes: number;
	readonly payloadBytes: number;
	readonly payloadSha256: string;
	readonly phase: string;
	readonly providerToolDefinitionCharacters: number;
	readonly toolNames: readonly string[];
}

function hash(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function imageObservation(data: string, mimeType: string): BenchmarkImageObservation {
	const bytes = Buffer.from(data, "base64");
	const canonical = bytes.toString("base64") === data;
	const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	return { bytes: bytes.length, mimeType, sha256: hash(bytes), valid: canonical && mimeType === "image/png" && png };
}

function dataUrlObservation(url: string): BenchmarkImageObservation | undefined {
	const match = /^data:([^;,]+);base64,(.+)$/su.exec(url);
	return match?.[1] && match[2] ? imageObservation(match[2], match[1]) : undefined;
}

function toolName(value: JsonInputObject): string | undefined {
	if (
		isRuntimeString(value["name"]) &&
		(isRuntimeString(value["description"]) || isJsonInputObject(value["function"]))
	)
		return value["name"];
	const nested = value["function"];
	return isJsonInputObject(nested) && isRuntimeString(nested["name"]) ? nested["name"] : undefined;
}

export function inspectProviderPayload(payload: JsonInputValue, phase: string): BenchmarkProviderObservation {
	const images: BenchmarkImageObservation[] = [];
	const tools = new Map<string, JsonInputObject>();
	const seen = new Set<JsonInputObject | readonly JsonInputValue[]>();
	let nodes = 0;
	function visit(value: JsonInputValue): void {
		nodes += 1;
		if (Array.isArray(value)) {
			if (seen.has(value)) return;
			seen.add(value);
			for (const item of value) visit(item);
			return;
		}
		if (!isJsonInputObject(value)) return;
		if (seen.has(value)) return;
		seen.add(value);
		const name = toolName(value);
		if (name) tools.set(name, value);
		if (value["type"] === "image") {
			const data = value["data"];
			const mimeType = value["mimeType"];
			images.push(
				isRuntimeString(data) && isRuntimeString(mimeType)
					? imageObservation(data, mimeType)
					: { bytes: 0, mimeType: "", sha256: "", valid: false },
			);
		}
		if (value["type"] === "input_image" || value["image_url"] !== undefined) {
			const imageUrl = value["image_url"];
			const imageUrlObject = isJsonInputObject(imageUrl) ? imageUrl : undefined;
			const url = isRuntimeString(imageUrl)
				? imageUrl
				: imageUrlObject && isRuntimeString(imageUrlObject["url"])
					? imageUrlObject["url"]
					: undefined;
			images.push(
				url
					? (dataUrlObservation(url) ?? { bytes: 0, mimeType: "", sha256: "", valid: false })
					: { bytes: 0, mimeType: "", sha256: "", valid: false },
			);
		}
		for (const item of Object.values(value)) visit(item);
	}
	visit(payload);
	const serialized = JSON.stringify(payload);
	if (!serialized) throw new TypeError("Provider payload must serialize to JSON");
	const codeMode = tools.get("codemode");
	return {
		codeModeDefinitionCharacters: codeMode ? JSON.stringify(codeMode).length : 0,
		imageCount: images.length,
		images,
		nodes,
		payloadBytes: Buffer.byteLength(serialized),
		payloadSha256: hash(serialized),
		phase,
		providerToolDefinitionCharacters: [...tools.values()].reduce(
			(total, tool) => total + JSON.stringify(tool).length,
			0,
		),
		toolNames: [...tools.keys()].sort(),
	};
}

export default function imageBenchmarkObserver(pi: ExtensionAPI): void {
	const logPath = process.env["PI_STUFF_CODE_MODE_IMAGE_BENCHMARK_LOG"];
	if (!logPath) throw new Error("PI_STUFF_CODE_MODE_IMAGE_BENCHMARK_LOG is required");
	pi.on("before_provider_request", (event) => {
		const payload = requireJsonInputValue(event.payload, "Provider payload");
		const observation = inspectProviderPayload(
			payload,
			process.env["PI_STUFF_CODE_MODE_IMAGE_BENCHMARK_PHASE"] ?? "unknown",
		);
		appendFileSync(logPath, `${JSON.stringify(observation)}\n`, { mode: 0o600 });
	});
}
