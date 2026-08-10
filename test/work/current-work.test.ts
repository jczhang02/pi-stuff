import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCurrentWorkSources } from "../../packages/pi-stuff-work/src/current-work.js";

class EventBusHarness {
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

	view(): ExtensionAPI["events"] {
		return {
			emit: (event, data) => {
				for (const listener of [...(this.listeners.get(event) ?? [])]) listener(data);
			},
			on: (event, listener) => {
				const listeners = this.listeners.get(event) ?? new Set();
				listeners.add(listener);
				this.listeners.set(event, listeners);
				return () => listeners.delete(listener);
			},
		};
	}
}

function extensionApi(events: ExtensionAPI["events"]): ExtensionAPI {
	return { events, on: () => {} } as unknown as ExtensionAPI;
}

test("Current Work sources follow the Pi Host bus across extension event facades", () => {
	const bus = new EventBusHarness();
	const first = extensionApi(bus.view());
	const second = extensionApi(bus.view());
	const isolated = extensionApi(new EventBusHarness().view());

	expect(getCurrentWorkSources(first)).toBe(getCurrentWorkSources(second));
	expect(getCurrentWorkSources(first)).not.toBe(getCurrentWorkSources(isolated));
});
