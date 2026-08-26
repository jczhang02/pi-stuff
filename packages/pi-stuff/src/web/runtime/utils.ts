import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { getWebConfigPath } from "../settings.ts";

export function errorMessage<ErrorValue>(error: ErrorValue): string {
	return error instanceof Error ? error.message : String(error);
}

export function getWebSearchConfigPath(): string {
	return getWebConfigPath();
}

export function isAbortError<ErrorValue>(error: ErrorValue): boolean {
	return errorMessage(error).toLowerCase().includes("abort");
}

export function normalizeCount(value: number | undefined, fallback = 5, maximum = 20): number {
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(Math.floor(value), maximum));
}

export function normalizeHeaders(headers: Readonly<Record<string, string | null>> | undefined): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers ?? {}).filter((entry): entry is [string, string] => entry[1] !== null),
	);
}

export function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
