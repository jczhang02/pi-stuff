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

export function parseJsonValue(text: string): JsonValue {
	// SAFETY: successful JSON.parse output is recursively limited to the JSON grammar's value types.
	return JSON.parse(text) as JsonValue;
}

import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
	isRuntimeUndefined,
} from "./runtime-type.js";
