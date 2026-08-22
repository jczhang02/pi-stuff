import type { JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeBoolean } from "../../shared/runtime-type.js";
import { isRuntimeNumber, isRuntimeString } from "../../shared/runtime-type.js";
export interface FetchContentParams {
	url?: JsonInputValue;
	urls?: JsonInputValue;
	forceClone?: JsonInputValue;
	prompt?: JsonInputValue;
	timestamp?: JsonInputValue;
	frames?: JsonInputValue;
	model?: JsonInputValue;
	mode?: JsonInputValue;
	answerModel?: JsonInputValue;
}

export interface NormalizedFetchContentParams {
	urlList: string[];
	options: {
		forceClone?: boolean;
		prompt?: string;
		timestamp?: string;
		frames?: number;
		model?: string;
		mode?: "readable" | "raw" | "answer";
		answerModel?: string;
	};
}

export function normalizeFetchContentParams(params: FetchContentParams): NormalizedFetchContentParams {
	const normalizedUrls = uniqueUrls(normalizeUrlArray(params.urls));
	const urlList = normalizedUrls.length > 0 ? normalizedUrls : normalizeSingleUrl(params.url);
	const prompt = normalizeOptionalString(params.prompt);
	const timestamp = normalizeOptionalString(params.timestamp);
	const frames = normalizeOptionalInteger(params.frames);

	const shouldIncludeFrames = frames !== undefined && (timestamp !== undefined || frames > 1);

	const forceClone = isRuntimeBoolean(params.forceClone) ? params.forceClone : undefined;
	const model = normalizeOptionalString(params.model);
	const mode = normalizeMode(params.mode);
	const answerModel = normalizeOptionalString(params.answerModel);
	const options: NormalizedFetchContentParams["options"] = {};
	if (forceClone !== undefined) options.forceClone = forceClone;
	if (prompt !== undefined) options.prompt = prompt;
	if (timestamp !== undefined) options.timestamp = timestamp;
	if (shouldIncludeFrames) options.frames = frames;
	if (model !== undefined) options.model = model;
	if (mode !== undefined) options.mode = mode;
	if (answerModel !== undefined) options.answerModel = answerModel;

	return {
		urlList,
		options,
	};
}

function normalizeUrlArray(value: JsonInputValue): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(normalizeSingleUrl);
}

function normalizeSingleUrl(value: JsonInputValue): string[] {
	if (!isRuntimeString(value)) return [];
	const trimmed = value.trim();
	return trimmed ? [trimmed] : [];
}

function normalizeOptionalString(value: JsonInputValue): string | undefined {
	if (!isRuntimeString(value)) return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function normalizeMode(value: JsonInputValue): "readable" | "raw" | "answer" | undefined {
	if (value === undefined) return undefined;
	if (value === "readable" || value === "raw" || value === "answer") return value;
	throw new Error('mode must be "readable", "raw", or "answer"');
}

function normalizeOptionalInteger(value: JsonInputValue): number | undefined {
	if (!isRuntimeNumber(value) || !Number.isInteger(value) || value < 1) return undefined;
	return value;
}

function uniqueUrls(urls: string[]): string[] {
	return [...new Set(urls)];
}
