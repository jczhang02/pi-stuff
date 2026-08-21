/** Read a proxied Host member with the same prototype and getter-receiver behavior as ordinary property access. */
export function readHostProxyProperty<Target extends object, Receiver extends object>(
	target: Target,
	property: PropertyKey,
	receiver: Receiver,
): Target[keyof Target] | undefined {
	let owner: object | null = target;
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, property);
		if (descriptor) {
			if ("value" in descriptor) return descriptor.value;
			return descriptor.get?.call(receiver);
		}
		owner = Object.getPrototypeOf(owner);
	}
	return undefined;
}
