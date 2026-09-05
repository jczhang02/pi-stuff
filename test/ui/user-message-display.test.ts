import { expect, test } from "bun:test";
import { getMarkdownTheme, InteractiveMode, initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { DiagnosticChannel } from "../../packages/pi-stuff/src/conversation-ui/diagnostics.js";
import { installUserMessageDisplay } from "../../packages/pi-stuff/src/conversation-ui/user-message-display.js";

test("supports overlapping owners and restores the native insertion method after release", () => {
	initTheme("dark");
	const original = Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "addMessageToChat");
	const first = installUserMessageDisplay(new DiagnosticChannel());
	let second: (() => void) | undefined;
	try {
		second = installUserMessageDisplay(new DiagnosticChannel());
		first();
		expect(Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "addMessageToChat")).not.toEqual(original);
	} finally {
		first();
		second?.();
	}
	expect(Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "addMessageToChat")).toEqual(original);
});

test("rejects an incompatible native renderer before installing a patch", () => {
	initTheme("dark");
	const original = UserMessageComponent.prototype.render;
	const insertion = Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "addMessageToChat");
	let release: (() => void) | undefined;
	UserMessageComponent.prototype.render = () => {
		throw new Error("incompatible native renderer");
	};
	try {
		expect(() => {
			release = installUserMessageDisplay(new DiagnosticChannel());
		}).toThrow("incompatible native renderer");
		expect(Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "addMessageToChat")).toEqual(insertion);
	} finally {
		UserMessageComponent.prototype.render = original;
		release?.();
	}
});

test("contains projection faults once, retries on reinstall, and propagates original Host errors", () => {
	initTheme("dark");
	const prototype = InteractiveMode.prototype;
	const names = ["addMessageToChat", "getMarkdownThemeWithSettings", "getMarkdownTransformers"];
	const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(prototype, name));
	const chatContainer = new Container();
	// SAFETY: fault injection supplies the certified fields/accessors and never starts a synthetic Host runtime.
	const host = Object.assign(Object.create(prototype), {
		chatContainer,
		outputPad: 1,
		toolOutputExpanded: false,
	}) as InteractiveMode;
	let invalid = true;
	let nativeError = false;
	Object.defineProperty(prototype, "addMessageToChat", {
		configurable: true,
		writable: true,
		value: () => {
			if (nativeError) throw new Error("original Host error");
			chatContainer.clear();
			chatContainer.addChild(
				invalid ? new Text("Original visible text", 0, 0) : new UserMessageComponent("Original visible text"),
			);
		},
	});
	Object.defineProperty(prototype, "getMarkdownThemeWithSettings", { configurable: true, value: getMarkdownTheme });
	Object.defineProperty(prototype, "getMarkdownTransformers", { configurable: true, value: () => [] });
	const diagnostics = new DiagnosticChannel();
	let release: (() => void) | undefined;
	const insert = (): void => {
		const method = Object.getOwnPropertyDescriptor(prototype, "addMessageToChat")?.value;
		method.call(host, { role: "user", content: "Original visible text", timestamp: 0 });
	};
	try {
		release = installUserMessageDisplay(diagnostics);
		insert();
		insert();
		expect(chatContainer.render(80).join("\n")).toContain("Original visible text");
		expect(diagnostics.list().map((entry) => entry.count)).toEqual([1]);
		release();
		invalid = false;
		chatContainer.clear();
		release = installUserMessageDisplay(diagnostics);
		insert();
		expect(stripTerminalSequences(chatContainer.render(80).join("\n"))).toContain("  Original visible text");
		nativeError = true;
		expect(insert).toThrow("original Host error");
		expect(diagnostics.list().map((entry) => entry.count)).toEqual([1]);
	} finally {
		release?.();
		for (const [index, name] of names.entries()) {
			const descriptor = descriptors[index];
			if (descriptor) Object.defineProperty(prototype, name, descriptor);
		}
		Reflect.deleteProperty(prototype, Symbol.for("@jczhang02/pi-stuff:user-message-host/v1"));
	}
});
