export type JsonValue = boolean | null | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

export type JsonInputValue = boolean | null | number | string | undefined | readonly JsonInputValue[] | JsonInputObject;

export interface JsonInputObject {
	[key: string]: JsonInputValue;
}

export function isJsonInputValue<Value>(value: Value): value is Value & JsonInputValue {
	if (value === null || isRuntimeBoolean(value) || isRuntimeString(value) || isRuntimeUndefined(value)) return true;
	if (isRuntimeNumber(value)) return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonInputValue);
	if (!isRuntimeObject(value)) return false;
	return Object.values(value).every(isJsonInputValue);
}

export function isJsonInputObject<Value>(value: Value): value is Value & JsonInputObject {
	return value !== null && isRuntimeObject(value) && !Array.isArray(value) && isJsonInputValue(value);
}

/** A value observed at a runtime boundary that already conforms to the JSON grammar. */
export type JsonSourceValue = boolean | null | number | string | readonly JsonSourceValue[] | JsonSourceObject;

export interface JsonSourceObject {
	readonly [key: string]: JsonSourceValue;
}

export function isJsonSourceValue<Value>(value: Value): value is Value & JsonSourceValue {
	if (value === null || isRuntimeBoolean(value) || isRuntimeString(value)) return true;
	if (isRuntimeNumber(value)) return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonSourceValue);
	if (!isRuntimeObject(value)) return false;
	return Object.values(value).every(isJsonSourceValue);
}

export function jsonInputKind(value: JsonInputValue): "array" | "boolean" | "null" | "number" | "object" | "string" | "undefined" {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (isRuntimeBoolean(value)) return "boolean";
	if (isRuntimeNumber(value)) return "number";
	if (isRuntimeString(value)) return "string";
	return Array.isArray(value) ? "array" : "object";
}

export function parseJsonValue(text: string): JsonValue {
	// SAFETY: successful JSON.parse output is recursively limited to the JSON grammar's value types.
	return JSON.parse(text) as JsonValue;
}

export function parseJsonObject(text: string): JsonObject {
	const value = parseJsonValue(text);
	if (!isJsonObject(value)) throw new TypeError("Expected a JSON object");
	return value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return value !== null && isRuntimeObject(value) && !Array.isArray(value);
}

import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
	isRuntimeUndefined,
} from "./runtime-type.js";
