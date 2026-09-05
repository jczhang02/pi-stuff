import { expect, test } from "bun:test";
import { InteractiveMode, initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
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
