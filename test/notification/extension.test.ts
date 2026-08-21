import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	TerminalInputHandler,
} from "@earendil-works/pi-coding-agent";
import { getUiSettingRegistry } from "../../packages/pi-stuff/src/conversation-ui/index.js";
import {
	installNotificationCapability,
	type NotificationHost,
} from "../../packages/pi-stuff/src/notification/index.js";
import {
	DEFAULT_NOTIFICATION_SETTINGS,
	NotificationSettingsStore,
} from "../../packages/pi-stuff/src/notification/settings.js";
import { createExtensionCommandContext, createExtensionContext } from "../fixtures/extension-context.js";

type EventHandler = (
	event: ExtensionEvent,
	context: ExtensionContext,
) => object | undefined | Promise<object | undefined>;
type CommandSpec = Parameters<ExtensionAPI["registerCommand"]>[1];

class EventBusHarness {
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

	readonly view = {
		emit: (event: string, data: unknown) => {
			for (const listener of this.listeners.get(event) ?? []) listener(data);
		},
		on: (event: string, listener: (data: unknown) => void) => {
			const listeners = this.listeners.get(event) ?? new Set();
			listeners.add(listener);
			this.listeners.set(event, listeners);
			return () => listeners.delete(listener);
		},
	};
}

interface NotificationHarness {
	readonly api: NotificationHost;
	readonly commands: Map<string, CommandSpec>;
	readonly handlers: Map<string, EventHandler[]>;
}

function harness(): NotificationHarness {
	const commands = new Map<string, CommandSpec>();
	const handlers = new Map<string, EventHandler[]>();
	const bus = new EventBusHarness();
	// SAFETY: this test adapter records every Host event callback without changing its arguments or result.
	const on = ((type: string, handler: EventHandler) => {
		handlers.set(type, [...(handlers.get(type) ?? []), handler]);
	}) as ExtensionAPI["on"];
	return {
		api: {
			events: bus.view,
			on,
			registerCommand: (name, command) => {
				commands.set(name, command);
			},
		},
		commands,
		handlers,
	};
}

test("Notification owns a dedicated settings command and releases its terminal observer", async () => {
	const host = harness();
	const settings = NotificationSettingsStore.memory(DEFAULT_NOTIFICATION_SETTINGS);
	await installNotificationCapability(host.api, settings);

	expect(getUiSettingRegistry(host.api).list()).toEqual([]);
	expect(host.commands.has("notifications")).toBeTrue();
	expect(host.commands.has("notify-test")).toBeFalse();
	expect(host.handlers.get("agent_settled")).toBeUndefined();
	const notices: string[] = [];
	await host.commands.get("notifications")?.handler(
		"",
		createExtensionCommandContext({
			hasUI: false,
			mode: "rpc",
			ui: { notify: (message: string) => notices.push(message) },
		}),
	);
	expect(notices).toEqual(["/notifications requires interactive TUI mode."]);

	let terminalInput: TerminalInputHandler | undefined;
	const context = createExtensionContext({
		cwd: "/project",
		hasPendingMessages: () => false,
		hasUI: true,
		isIdle: () => true,
		mode: "tui",
		sessionManager: { getSessionName: () => "Notification test" },
		ui: {
			notify: () => {},
			onTerminalInput: (handler: TerminalInputHandler) => {
				terminalInput = handler;
				return () => {
					if (terminalInput === handler) terminalInput = undefined;
				};
			},
		},
	});
	for (const handler of host.handlers.get("session_start") ?? []) {
		await handler({ reason: "startup", type: "session_start" }, context);
	}
	expect(terminalInput).toBeFunction();
	expect(host.handlers.get("agent_settled")).toHaveLength(1);

	for (const handler of host.handlers.get("session_shutdown") ?? []) {
		await handler({ reason: "quit", type: "session_shutdown" }, context);
	}
	expect(terminalInput).toBeUndefined();
});
