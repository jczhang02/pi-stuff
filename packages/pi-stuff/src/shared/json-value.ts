export type JsonValue = boolean | null | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

export type JsonInputValue = boolean | null | number | string | undefined | JsonInputValue[] | JsonInputObject;

export interface JsonInputObject {
	[key: string]: JsonInputValue;
}

export function parseJsonValue(text: string): JsonValue {
	// SAFETY: successful JSON.parse output is recursively limited to the JSON grammar's value types.
	return JSON.parse(text) as JsonValue;
}
