import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getHostSharedResource } from "../../packages/pi-stuff/src/conversation-ui/host-resource.js";

type Events = ExtensionAPI["events"];

test("Host resource discovery fails initialization instead of creating a facade-local duplicate", () => {
	const local = new WeakMap<object, object>();
	let creates = 0;
	const emitFailure = {
		emit: () => {
			throw new Error("injected discovery failure");
		},
		on: () => () => {},
	} as unknown as Events;
	expect(() =>
		getHostSharedResource(emitFailure, local, "test:resource", () => {
			creates += 1;
			return {};
		}),
	).toThrow("injected discovery failure");
	expect(creates).toBe(0);

	const registrationFailure = {
		emit: () => {},
		on: () => {
			throw new Error("injected registration failure");
		},
	} as unknown as Events;
	expect(() => getHostSharedResource(registrationFailure, local, "test:resource", () => ({}))).toThrow(
		"injected registration failure",
	);
	expect(local.has(registrationFailure as object)).toBe(false);
});

test("Host resource cleanup remains idempotent when its event unsubscribe fails", () => {
	const local = new WeakMap<object, object>();
	const cleanups: Array<() => void> = [];
	let unsubscribeCalls = 0;
	const events = {
		emit: () => {},
		on: () => () => {
			unsubscribeCalls += 1;
			throw new Error("injected unsubscribe failure");
		},
	} as unknown as Events;
	const resource = getHostSharedResource(events, local, "test:resource", () => ({}), {
		registerOwnerCleanup: (cleanup) => cleanups.push(cleanup),
	});
	expect(local.get(events as object)).toBe(resource);
	expect(cleanups).toHaveLength(1);

	expect(() => cleanups[0]?.()).not.toThrow();
	expect(() => cleanups[0]?.()).not.toThrow();
	expect(unsubscribeCalls).toBe(1);
	expect(local.has(events as object)).toBe(false);
});
