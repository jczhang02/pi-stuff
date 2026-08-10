import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface HostResourceRequest<Resource extends object> {
	resource?: Resource;
}

interface HostSharedResourceOptions {
	registerOwnerCleanup?(cleanup: () => void): void;
}

/**
 * Return one resource for every Extension API connected to the same Pi Host.
 *
 * Pi 0.84 gives each extension a distinct `events` facade over one event bus,
 * so facade identity cannot be used as the Host identity. The synchronous bus
 * handoff preserves a local WeakMap fast path while letting independently
 * loaded Packages discover the resource already owned by this Host generation.
 */
export function getHostSharedResource<Resource extends object>(
	events: ExtensionAPI["events"],
	local: WeakMap<object, Resource>,
	discoveryEvent: string,
	create: () => Resource,
	options: HostSharedResourceOptions = {},
): Resource {
	const eventKey = events as object;
	const localResource = local.get(eventKey);
	if (localResource) return localResource;

	const emit = Reflect.get(events as object, "emit");
	const on = Reflect.get(events as object, "on");
	if (typeof emit === "function" && typeof on === "function") {
		const request: HostResourceRequest<Resource> = {};
		emit.call(events, discoveryEvent, request);
		if (request.resource) {
			local.set(eventKey, request.resource);
			return request.resource;
		}

		const resource = create();
		local.set(eventKey, resource);
		let unsubscribe: unknown;
		try {
			unsubscribe = on.call(events, discoveryEvent, (value: unknown) => {
				if (typeof value !== "object" || value === null) return;
				const discovery = value as HostResourceRequest<Resource>;
				discovery.resource ??= resource;
			});
		} catch (error) {
			if (local.get(eventKey) === resource) local.delete(eventKey);
			throw error;
		}
		if (options.registerOwnerCleanup) {
			let released = false;
			const release = (): void => {
				if (released) return;
				released = true;
				try {
					if (typeof unsubscribe === "function") unsubscribe();
				} catch {
					// Pi invalidates the facade at shutdown; one broken unsubscribe must
					// not prevent other Suite resources from being released.
				} finally {
					if (local.get(eventKey) === resource) local.delete(eventKey);
				}
			};
			try {
				options.registerOwnerCleanup(release);
			} catch (error) {
				release();
				throw error;
			}
		}
		return resource;
	}

	const resource = create();
	local.set(eventKey, resource);
	return resource;
}
