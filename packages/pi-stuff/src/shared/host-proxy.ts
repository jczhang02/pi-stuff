/** Read a Host member with ordinary property-access semantics, including target Proxy traps. */
export function readHostProxyProperty<Target extends object>(
	target: Target,
	property: PropertyKey,
): Target[keyof Target] | undefined {
	// SAFETY: Proxy traps supply runtime property keys; ordinary indexed access preserves the target's own interception.
	return target[property as keyof Target];
}
