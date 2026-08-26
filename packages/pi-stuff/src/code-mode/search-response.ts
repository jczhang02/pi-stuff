import type { DescribeOutput, SearchOutput, SearchResult } from "./cloudflare/connector-types.js";
import { sanitizeToolName, toolPath, toPascalCase } from "./cloudflare/utils.js";

const RESULT_LIMIT = 5;
const RESPONSE_CHARS = 4_000;

function metadata(search: SearchOutput, included: number) {
	return {
		total: search.total,
		truncated: search.truncated || included < search.results.length,
	};
}

function signature(result: SearchResult, typed = true): string {
	if (result.kind === "snippet")
		return `codemode.run(${JSON.stringify(result.path)}, input?: unknown): Promise<unknown>`;
	const path = projectedPath(result);
	if (!typed) return `${path}(input: unknown): Promise<unknown>`;
	const typeName = toPascalCase(sanitizeToolName(result.method));
	return `${path}(input: ${typeName}Input): Promise<${typeName}Output>`;
}

function projectedPath(result: SearchResult): string {
	return result.kind === "snippet" ? result.path : toolPath(result.method, result.connector);
}

function signatureResult(result: SearchResult, typed = true) {
	const compact = { kind: result.kind, path: projectedPath(result), signature: signature(result, typed) };
	return result.requiresApproval ? { ...compact, requiresApproval: true } : compact;
}

function definitionResult(result: SearchResult) {
	return { ...result, path: projectedPath(result), signature: signature(result) };
}

function compactDescription(description: DescribeOutput) {
	const compact = {
		kind: description.kind,
		path: description.path,
		types: description.types,
	};
	return description.requiresApproval ? { ...compact, requiresApproval: true } : compact;
}

function encode(
	search: SearchOutput,
	representation: "definitions" | "typed-top" | "signatures" | "paths",
	results: readonly unknown[],
	definitions: readonly unknown[] = [],
): string | undefined {
	const text = JSON.stringify({
		...metadata(search, results.length),
		definitions,
		representation,
		results,
	});
	return text.length <= RESPONSE_CHARS ? text : undefined;
}

function projection(search: SearchOutput, text: string, results: readonly { readonly path: string }[]) {
	return {
		paths: results.map((result) => result.path),
		text,
		truncated: metadata(search, results.length).truncated,
	};
}

export function projectCodeModeSearchResponse(
	search: SearchOutput,
	describe: (result: SearchResult) => DescribeOutput,
): ReturnType<typeof projection> {
	const results = search.results.slice(0, RESULT_LIMIT);
	if (results.length === 0) {
		return projection(search, JSON.stringify({ ...search, definitions: [], representation: "definitions" }), []);
	}

	const descriptions = results.map((result) => ({ ...describe(result), path: projectedPath(result) }));
	let fullResults: Array<ReturnType<typeof definitionResult>> = [];
	let fullDescriptions: DescribeOutput[] = [];
	let fullText: string | undefined;
	for (const [index, result] of results.entries()) {
		const description = descriptions[index];
		if (!description) break;
		const nextResults = [...fullResults, definitionResult(result)];
		const nextDescriptions = [...fullDescriptions, description];
		const encoded = encode(search, "definitions", nextResults, nextDescriptions);
		if (!encoded) break;
		fullResults = nextResults;
		fullDescriptions = nextDescriptions;
		fullText = encoded;
	}
	if (fullText) return projection(search, fullText, fullResults);

	const topDescription = descriptions[0];
	const topResult = results[0];
	const topSignature = topResult ? signatureResult(topResult) : undefined;
	if (topDescription && topSignature) {
		let typedResults = [topSignature];
		const typedDescription = compactDescription(topDescription);
		let typedText = encode(search, "typed-top", typedResults, [typedDescription]);
		if (typedText) {
			for (const result of results.slice(1)) {
				const compact = signatureResult(result, false);
				const nextResults = [...typedResults, compact];
				const encoded = encode(search, "typed-top", nextResults, [typedDescription]);
				if (!encoded) break;
				typedResults = nextResults;
				typedText = encoded;
			}
			return projection(search, typedText, typedResults);
		}
	}

	let compactResults: Array<ReturnType<typeof signatureResult>> = [];
	let compactText: string | undefined;
	for (const result of results) {
		const compact = signatureResult(result, false);
		const nextResults = [...compactResults, compact];
		const encoded = encode(search, "signatures", nextResults);
		if (!encoded) break;
		compactResults = nextResults;
		compactText = encoded;
	}
	if (compactText) return projection(search, compactText, compactResults);

	let pathResults: Array<{ readonly path: string }> = [];
	let pathText = encode(search, "paths", pathResults);
	if (!pathText) throw new Error("Tool Discovery metadata exceeds its response budget.");
	for (const result of results) {
		const nextResults = [...pathResults, { path: projectedPath(result) }];
		const encoded = encode(search, "paths", nextResults);
		if (!encoded) break;
		pathResults = nextResults;
		pathText = encoded;
	}
	return projection(search, pathText, pathResults);
}
