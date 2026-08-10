import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCodexTools } from "../../packages/pi-stuff/src/codex/tools.js";

function harness(initial = ["read"]): {
	readonly active: () => readonly string[];
	readonly api: ExtensionAPI;
	readonly registered: Map<string, ToolDefinition>;
} {
	let active = [...initial];
	const registered = new Map<string, ToolDefinition>();
	const api = {
		events: {},
		getActiveTools: () => [...active],
		registerTool: (tool: ToolDefinition) => registered.set(tool.name, tool),
		setActiveTools: (names: string[]) => {
			active = [...names];
		},
	} as unknown as ExtensionAPI;
	return { active: () => active, api, registered };
}

function model(input: ("image" | "text")[]): NonNullable<ExtensionContext["model"]> {
	return {
		api: "openai-responses",
		baseUrl: "https://chatgpt.com/backend-api/codex/responses",
		contextWindow: 200_000,
		cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
		id: "gpt-5.2-codex",
		input,
		maxTokens: 32_000,
		name: "Codex",
		provider: "openai-codex",
		reasoning: true,
	};
}

test("Codex tools register for replay but activate only for compatible models", () => {
	const { active, api, registered } = harness();
	const controller = registerCodexTools(api);
	expect([...registered.keys()].sort()).toEqual(["apply_patch", "imagegen", "view_image"]);

	controller.sync(undefined);
	expect(active()).toEqual(["read"]);
	controller.sync(model(["text"]));
	expect(active()).toEqual(["read", "apply_patch"]);
	controller.sync(model(["text", "image"]));
	expect(active()).toEqual(["read", "apply_patch", "view_image", "imagegen"]);
	controller.sync({ ...model(["text"]), provider: "fixture" });
	expect(active()).toEqual(["read"]);
});
