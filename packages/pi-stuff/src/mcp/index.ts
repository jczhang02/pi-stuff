import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installMcpCapability } from "./adapter.js";

export { createMcpAdapterApi, installMcpCapability, suppressMcpFooterContext } from "./adapter.js";
export { createMcpControlView } from "./mcp-dialog.js";
export { McpStatusStore, parseMcpStatusSnapshot } from "./status-store.js";

export default function piStuffMcp(pi: ExtensionAPI): void {
	installMcpCapability(pi);
}
