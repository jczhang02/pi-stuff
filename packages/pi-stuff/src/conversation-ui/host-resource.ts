import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Guard } from "typebox/guard";

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
	const eventKey = events;
	const localResource = local.get(eventKey);
	if (localResource) return localResource;

	const emit = events.emit;
	const on = events.on;
	if (!Guard.IsFunction(emit) || !Guard.IsFunction(on)) {
		const resource = create();
		local.set(eventKey, resource);
		return resource;
	}

	const request: HostResourceRequest<Resource> = {};
	emit.call(events, discoveryEvent, request);
	if (request.resource) {
		local.set(eventKey, request.resource);
		return request.resource;
	}

	const resource = create();
	local.set(eventKey, resource);
	let unsubscribe: (() => void) | undefined;
	try {
		const subscription = on.call(events, discoveryEvent, (value) => {
			if (!Guard.IsObject(value)) return;
			// SAFETY: Pi delivers the same mutable discovery request object emitted above.
			const discovery = value as HostResourceRequest<Resource>;
			discovery.resource ??= resource;
		});
		if (Guard.IsFunction(subscription)) unsubscribe = () => subscription();
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
				unsubscribe?.();
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
