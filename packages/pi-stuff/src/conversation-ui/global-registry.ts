/** Return the package-owned WeakMap stored under a global symbol. */
export function globalWeakMap<Value>(key: symbol): WeakMap<object, Value> {
	// SAFETY: callers exclusively own their symbol slot and value contract.
	const root = globalThis as { [key: symbol]: WeakMap<object, Value> | undefined };
	root[key] ??= new WeakMap();
	return root[key];
}
