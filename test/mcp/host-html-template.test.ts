import { expect, test } from "bun:test";
import { buildHostHtmlTemplate } from "../../packages/pi-stuff/src/mcp/runtime/host-html-template.js";

test("generated MCP browser code contains no server-only runtime guards", () => {
	const html = buildHostHtmlTemplate({
		allowAttribute: "",
		cacheToolConsent: false,
		requireToolConsent: false,
		resource: { html: "<main>fixture</main>", meta: {}, mimeType: "text/html", uri: "ui://fixture" },
		serverName: "fixture",
		sessionToken: "token",
		toolArgs: {},
		toolName: "show",
	});

	expect(html).not.toMatch(/isRuntime(?:Number|Object|String)/u);
	expect(html).toContain('typeof width === "number"');
	expect(html).toContain("event.source !== iframe.contentWindow");
	expect(html).toContain("new PostMessageTransport(frameWindow, frameWindow)");
	expect(html).not.toContain("new PostMessageTransport(iframe.contentWindow, null)");
});
