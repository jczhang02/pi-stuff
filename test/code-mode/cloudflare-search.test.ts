import { expect, test } from "bun:test";
import type { ConnectorDescription } from "../../packages/pi-stuff/src/code-mode/cloudflare/connector-types.js";
import { searchConnectors } from "../../packages/pi-stuff/src/code-mode/cloudflare/search.js";

const descriptions: ConnectorDescription[] = [
	{
		descriptors: {
			read: { description: "Read a file", inputSchema: { type: "object" } },
			view_image: { description: "View a local image", inputSchema: { type: "object" } },
			view_picture: { description: "View a local image", inputSchema: { type: "object" } },
		},
		name: "tools",
	},
];

test("a verbose query keeps an exact Tool-name token match without admitting description-only noise", () => {
	const result = searchConnectors("read an image file from absolute path and display it", descriptions);
	const paths = result.results.map(({ path }) => path);

	expect(paths).toContain("tools.view_image");
	expect(paths).not.toContain("tools.view_picture");
});
