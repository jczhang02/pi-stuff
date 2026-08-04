import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installWebCapability } from "./adapter.js";

export { createWebAdapterApi, installWebCapability } from "./adapter.js";
export { type DnsAddress, type DnsLookup, FakeIpCompatibility } from "./fake-ip.js";
export { validateWebFetchInput, type WebFetchInput, type WebFetchValidation } from "./url-policy.js";

export default function piStuffWeb(pi: ExtensionAPI): void {
	installWebCapability(pi);
}
