export type ContextMode = "fresh" | "fork";
export type ContextSummary = ContextMode | "mixed";

export function isContextMode<Value>(value: Value): value is Value & ContextMode {
	return value === "fresh" || value === "fork";
}

export function summarizeContextModes(modes: Array<ContextMode | undefined>): ContextSummary | undefined {
	const resolved = modes.filter(isContextMode);
	if (resolved.length === 0) return undefined;
	const first = resolved.at(0);
	if (first === undefined) return undefined;
	return resolved.every((mode) => mode === first) ? first : "mixed";
}
