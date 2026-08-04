/**
 * PROTOTYPE — mounts the production Welcome component in an isolated real Pi
 * session with deterministic model and inventory data.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	WelcomeHeaderController,
	type WelcomeHeaderInventory,
	type WelcomeHeaderInventorySource,
} from "../../../../../packages/pi-stuff-ui/welcome-header.js";

const FIXTURE_MODEL = "gpt-5.6-sol";
const inventory: WelcomeHeaderInventorySource = {
	get: (): WelcomeHeaderInventory => ({
		contextFiles: 3,
		extensions: 24,
		skills: 77,
		tools: 30,
	}),
	subscribe: () => () => {},
};

export default function registerWelcomeHeaderPrototype(pi: ExtensionAPI): void {
	pi.registerProvider("welcome-fixture", {
		name: "Welcome Header prototype fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "offline-fixture",
		api: "openai-completions",
		models: [
			{
				id: FIXTURE_MODEL,
				name: "GPT-5.6 Sol",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const controller = new WelcomeHeaderController(ctx, {
			enabled: { get: () => true },
			inventory,
		});
		ctx.ui.setHeader((tui, theme) => controller.createHeader(tui, theme));
	});

	pi.registerMessageRenderer("welcome-scroll-fixture", (message, _options, theme) => {
		return new Text(theme.fg("muted", String(message.content)), 2, 0);
	});
	pi.registerCommand("prototype-fill", {
		description: "[prototype only] Fill the transcript to prove that Welcome scrolls away",
		handler: async () => {
			for (let index = 1; index <= 20; index += 1) {
				pi.sendMessage({
					customType: "welcome-scroll-fixture",
					content: `Transcript line ${String(index).padStart(2, "0")} · Welcome belongs to the document`,
					display: true,
				});
			}
		},
	});
}
