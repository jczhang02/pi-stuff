import { isRuntimeBigInt, isRuntimeObject } from "../../shared/runtime-type.js";
/**
 * Deterministic JSON of a value: object keys sorted recursively, BigInt tagged.
 * Used to compare a replayed call's args against the recorded args. Best-effort
 * — returns `undefined` if the value can't be serialized (e.g. a cycle), in
 * which case the caller skips the args check rather than reporting a false
 * divergence.
 */
export function stableStringify(value: unknown): string | undefined {
	try {
		return JSON.stringify(value, (_key, val) => {
			if (isRuntimeBigInt(val)) return `__bigint__:${val.toString()}`;
			if (val && isRuntimeObject(val) && !Array.isArray(val)) {
				const record = val as Record<string, unknown>;
				const sorted: Record<string, unknown> = {};
				for (const key of Object.keys(record).sort()) sorted[key] = record[key];
				return sorted;
			}
			return val;
		});
	} catch {
		return undefined;
	}
}
