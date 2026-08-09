/**
 * ACCEPTANCE SUPPORT — load the production Pi Stuff UI shell in certified Pi
 * and expose one deterministic Command Dialog used only by the PTY harness.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import piStuffUi, { getCommandDialogCoordinator } from "../../../packages/pi-stuff-ui/index.ts";

const PROVIDER = "footer-fixture";
const MODEL = "compact-footer-fixture";

class FooterLifecycleDialog implements Component {
	private readonly close: () => void;
	private readonly theme: Theme;

	constructor(theme: Theme, close: () => void) {
		this.close = close;
		this.theme = theme;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) this.close();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const line = (text: string): string => truncateToWidth(text, renderWidth, "…");
		return [
			this.theme.fg("borderMuted", "─".repeat(renderWidth)),
			line(`  ${this.theme.fg("text", "Footer lifecycle")}`),
			"",
			line("  普通页脚已隐藏；Command Dialog 独占焦点。"),
			line(this.theme.fg("dim", "  CJK width: 项目 / 上下文 / 分支")),
			"",
			line(this.theme.fg("dim", "  Esc return")),
		];
	}
}

export default function registerFooterShellCapture(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Compact footer acceptance fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "Compact footer acceptance fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			},
		],
	});

	piStuffUi(pi);
	const dialogs = getCommandDialogCoordinator(pi);
	const openDialog = async (ctx: ExtensionContext): Promise<void> => {
		await dialogs.show(ctx, {
			priority: "normal",
			create: ({ theme, close }) => new FooterLifecycleDialog(theme, close),
		});
	};
	pi.registerCommand("footer-lifecycle", {
		description: "Open the compact-footer lifecycle acceptance surface",
		handler: async (_args, ctx) => openDialog(ctx),
	});
	pi.registerShortcut(Key.ctrl("b"), {
		description: "[acceptance only] Open the footer lifecycle surface without consuming the editor draft",
		handler: openDialog,
	});
}
