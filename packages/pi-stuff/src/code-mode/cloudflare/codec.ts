import { isRuntimeBigInt, isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
/**
 * Host-side value codec.
 *
 * Two layers share the binary encoding (a tagged base64 envelope):
 *
 * - **Transport** (`stringifyForCodemode`/`parseForCodemode`): used for the
 *   host↔sandbox tool-call boundary. Must stay in lockstep with the sandbox's
 *   own codec (`SANDBOX_CODEC` in executor.ts).
 * - **Storage** (`stringifyForStorage`/`parseForStorage`): used by the
 *   CodemodeRuntime facet to persist args/results in SQLite. Builds on the
 *   transport encoding and additionally round-trips `bigint` (which plain
 *   `JSON.stringify` rejects). The bigint tag is storage-only — it never
 *   crosses into the sandbox.
 */

export const BINARY_TAG = "__codemode_binary_v1__";
const BIGINT_TAG = "__codemode_bigint_v1__";

type EncodedBinary = {
	[BINARY_TAG]: "Uint8Array" | "ArrayBuffer" | "ArrayBufferView";
	data: string;
};

export type CodemodeValue =
	| ArrayBuffer
	| ArrayBufferView
	| bigint
	| boolean
	| null
	| number
	| object
	| string
	| undefined;

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.byteLength; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
	}
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function encodeCodemodeValue<Value>(value: Value): EncodedBinary | Value {
	if (value instanceof Uint8Array) {
		return { [BINARY_TAG]: "Uint8Array", data: bytesToBase64(value) };
	}
	if (value instanceof ArrayBuffer) {
		return {
			[BINARY_TAG]: "ArrayBuffer",
			data: bytesToBase64(new Uint8Array(value)),
		};
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return {
			[BINARY_TAG]: "ArrayBufferView",
			data: bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
		};
	}
	return value;
}

export function decodeCodemodeValue<Value>(value: Value): ArrayBuffer | Uint8Array | Value {
	if (!value || !isRuntimeObject(value) || !(BINARY_TAG in value)) {
		return value;
	}
	const data = "data" in value ? value.data : undefined;
	if (!isRuntimeString(data)) return value;
	const bytes = base64ToBytes(data);
	if (value[BINARY_TAG] === "ArrayBuffer") {
		return bytes.slice().buffer;
	}
	return bytes;
}

export function stringifyForCodemode<Value>(value: Value): string {
	return JSON.stringify(value, (_key, nested) => encodeCodemodeValue(nested));
}

export function parseForCodemode(json: string): CodemodeValue {
	// SAFETY: JSON.parse plus this reviver can only produce JSON values and the binary values returned by decodeCodemodeValue.
	return JSON.parse(json, (_key, nested) => decodeCodemodeValue(nested)) as CodemodeValue;
}

// ---------------------------------------------------------------------------
// Storage codec — binary + bigint, for the runtime's SQLite columns.
// ---------------------------------------------------------------------------

/**
 * Serialize a value for durable storage. Returns `undefined` when the value is
 * `undefined` (callers store SQL NULL — distinguishing "no value" from a
 * recorded `null`, which serializes to the string `"null"`).
 *
 * Throws on values JSON cannot represent even with the codec (e.g. cycles):
 * a durable replay log cannot faithfully store such a value, and silently
 * storing an approximation would corrupt replay.
 */
export function stringifyForStorage<Value>(value: Value): string | undefined {
	if (value === undefined) return undefined;
	return JSON.stringify(value, (_key, nested) => {
		if (isRuntimeBigInt(nested)) {
			return { [BIGINT_TAG]: nested.toString() };
		}
		return encodeCodemodeValue(nested);
	});
}

export function parseForStorage(json: string | null): CodemodeValue {
	if (json === null) return undefined;
	// SAFETY: JSON.parse plus this reviver can only produce JSON, binary, and bigint values declared by CodemodeValue.
	return JSON.parse(json, (_key, nested) => {
		const encodedBigInt = nested && isRuntimeObject(nested) && BIGINT_TAG in nested ? nested[BIGINT_TAG] : undefined;
		if (nested && isRuntimeObject(nested) && BIGINT_TAG in nested && isRuntimeString(encodedBigInt)) {
			return BigInt(encodedBigInt);
		}
		return decodeCodemodeValue(nested);
	}) as CodemodeValue;
}
