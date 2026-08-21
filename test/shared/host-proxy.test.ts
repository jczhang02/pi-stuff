import { expect, test } from "bun:test";
import { readHostProxyProperty } from "../../packages/pi-stuff/src/shared/host-proxy.js";

class HostSurface {
	label: string;

	constructor(label: string) {
		this.label = label;
	}

	get decoratedLabel(): string {
		return `[${this.label}]`;
	}
}

test("Host proxy lookup preserves inherited getter receiver semantics", () => {
	const target = new HostSurface("target");
	const receiver = new HostSurface("receiver");

	expect(readHostProxyProperty(target, "decoratedLabel", receiver)).toBe("[receiver]");
	expect(readHostProxyProperty(target, "label", receiver)).toBe("target");
	expect(readHostProxyProperty(target, "missing", receiver)).toBeUndefined();
});
