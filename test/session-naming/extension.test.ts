import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionEvent,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	installSessionNamingCapability,
	type SessionNamingHost,
} from "../../packages/pi-stuff/src/session-naming/index.js";
import type { SessionNamingSettings } from "../../packages/pi-stuff/src/session-naming/settings.js";
import { createExtensionContext } from "../fixtures/extension-context.js";

const SETTINGS: SessionNamingSettings = {
	schemaVersion: 1,
	enabled: true,
	cooldownMinutes: 10,
	respectManualName: false,
	fallbackModels: [],
};

type Listener = (event: ExtensionEvent, ctx: ExtensionContext) => void;

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function message(role: "assistant" | "user", content: string, id: string): SessionEntry {
	const base = { id, parentId: null, timestamp: "2026-08-24T00:00:00.000Z" };
	if (role === "user") return { ...base, type: "message", message: { role, content, timestamp: 1 } };
	const assistant: AssistantMessage = {
		role,
		content: [{ type: "text", text: content }],
		api: "openai-completions",
		provider: "fixture",
		model: "fixture",
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: 2,
	};
	return { ...base, type: "message", message: assistant };
}

function hostHarness() {
	const lifecycle = new Map<string, Listener[]>();
	const eventBus = createEventBus();
	const subscribedChannels: string[] = [];
	const events = {
		emit: eventBus.emit.bind(eventBus),
		on(channel: string, handler: Parameters<ExtensionAPI["events"]["on"]>[1]) {
			subscribedChannels.push(channel);
			return eventBus.on(channel, handler);
		},
	} satisfies ExtensionAPI["events"];
	const entries: SessionEntry[] = [
		message("user", "Implement automatic Session naming", "entry-1"),
		message("assistant", "Done", "entry-2"),
	];
	let name: string | undefined;
	const extensionContext = createExtensionContext({ sessionManager: { getBranch: () => entries } });
	Object.assign(extensionContext.modelRegistry, {
		complete: async () => {
			throw new Error("The local fallback does not call the fixture registry");
		},
		find: () => undefined,
		hasConfiguredAuth: () => false,
	});
	// SAFETY: this event adapter records Host callbacks without changing their arguments or results.
	const on = ((event: string, listener: Listener) => {
		const listeners = lifecycle.get(event) ?? [];
		listeners.push(listener);
		lifecycle.set(event, listeners);
	}) as ExtensionAPI["on"];
	const appendEntry: ExtensionAPI["appendEntry"] = <T = unknown>(customType: string, data?: T) => {
		entries.push({
			type: "custom",
			id: `entry-${String(entries.length + 1)}`,
			parentId: null,
			timestamp: "2026-08-24T00:00:00.000Z",
			customType,
			data,
		});
	};
	const pi = {
		events,
		on,
		registerCommand: () => undefined,
		appendEntry,
		getSessionName: () => name,
		setSessionName(next: string) {
			name = next;
		},
	} satisfies SessionNamingHost;
	const emitLifecycle = (event: string): void => {
		// SAFETY: these handlers do not inspect the event payload in the exercised lifecycle cases.
		const fixtureEvent = { type: event } as ExtensionEvent;
		for (const listener of lifecycle.get(event) ?? []) listener(fixtureEvent, extensionContext);
	};
	const emitSettled = (): void => {
		const settledEvent = subscribedChannels.find((event) => event.includes("user-agent-run-settled"));
		if (!settledEvent) throw new Error("Session Naming did not subscribe to the shared settled event");
		pi.events.emit(settledEvent, { ctx: extensionContext });
	};
	return { emitLifecycle, emitSettled, name: () => name, pi };
}

async function waitForName(read: () => string | undefined): Promise<string | undefined> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const value = read();
		if (value) return value;
		await Promise.resolve();
	}
	return read();
}

describe("Session Naming Extension lifecycle", () => {
	test("names a parent Session only at the shared direct-user settled boundary", async () => {
		const host = hostHarness();
		installSessionNamingCapability(host.pi, SETTINGS, {});
		host.emitLifecycle("session_start");
		host.emitLifecycle("agent_settled");
		await Promise.resolve();
		expect(host.name()).toBeUndefined();

		host.emitSettled();
		expect(await waitForName(host.name)).toBe("automatic Session naming");
	});

	test("does not automatically rename a Child Agent Session", async () => {
		const host = hostHarness();
		installSessionNamingCapability(host.pi, SETTINGS, { PI_SUBAGENT_CHILD: "1" });
		host.emitLifecycle("session_start");
		host.emitSettled();

		await Promise.resolve();
		expect(host.name()).toBeUndefined();
	});
});
