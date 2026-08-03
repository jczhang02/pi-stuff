/**
 * PROTOTYPE — disposable real-Pi rendering fixture for the selected Welcome
 * Header. This answers one question only: does the responsive header feel
 * correct inside the Host at wide, narrow, and ultra-narrow terminal widths?
 *
 * This is not production Capability code. The displayed inventory is fixed
 * fixture data so captures stay deterministic and offline.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const FIXTURE_MODEL = "gpt-5.6-sol";
const FIXTURE_PROVIDER = "openai-codex";
const FIXTURE_PATH = "~/dev/pi-stuff";

function clip(line: string, width: number): string {
	return truncateToWidth(line, Math.max(1, width), "…");
}

function joinColumns(left: string, right: string, startColumn: number, width: number): string {
	const gap = " ".repeat(Math.max(2, startColumn - visibleWidth(left)));
	return clip(`${left}${gap}${right}`, width);
}

function wideLines(theme: Theme, width: number): string[] {
	const divider = theme.fg("borderMuted", "─".repeat(width));
	const leftIndent = "  ";
	const detailIndent = "     ";
	const rightColumn = 42;
	const title = `${leftIndent}${theme.fg("accent", theme.bold("π"))}  ${theme.bold("Welcome back!")}`;
	const model = `${detailIndent}${theme.fg("accent", FIXTURE_MODEL)}${theme.fg("dim", ` · ${FIXTURE_PROVIDER}`)}`;
	const path = `${detailIndent}${theme.fg("muted", FIXTURE_PATH)}`;
	const loaded = theme.fg("muted", theme.bold("Loaded"));
	const inventory =
		`${theme.fg("text", "Context files")} ${theme.fg("accent", "3")}` +
		`${theme.fg("dim", " · ")}${theme.fg("text", "Extensions")} ${theme.fg("accent", "24")}` +
		`${theme.fg("dim", " · ")}${theme.fg("text", "Tools")} ${theme.fg("accent", "30")}` +
		`${theme.fg("dim", " · ")}${theme.fg("text", "Skills")} ${theme.fg("accent", "77")}`;
	const tips = theme.fg("muted", theme.bold("Tips"));
	const tipLine =
		`${theme.fg("accent", "/")} ${theme.fg("muted", "commands")}` +
		`${theme.fg("dim", " · ")}${theme.fg("accent", "/ui")} ${theme.fg("muted", "appearance")}` +
		`${theme.fg("dim", " · ")}${theme.fg("accent", "Shift+Tab")} ${theme.fg("muted", "thinking")}`;

	return [
		divider,
		joinColumns(title, loaded, rightColumn, width),
		joinColumns(model, inventory, rightColumn, width),
		joinColumns(path, tips, rightColumn, width),
		joinColumns("", tipLine, rightColumn, width),
		divider,
	];
}

function narrowLines(theme: Theme, width: number): string[] {
	const divider = theme.fg("borderMuted", "─".repeat(width));
	const separator = theme.fg("dim", " · ");
	const title =
		`  ${theme.fg("accent", theme.bold("π"))} ${theme.bold("Welcome back!")}` +
		separator +
		theme.fg("accent", FIXTURE_MODEL) +
		separator +
		theme.fg("dim", FIXTURE_PROVIDER);
	const inventory =
		`  ${theme.fg("muted", FIXTURE_PATH)}` +
		separator +
		`${theme.fg("accent", "3")} ${theme.fg("muted", "context")}` +
		separator +
		`${theme.fg("accent", "24")} ${theme.fg("muted", "ext")}` +
		separator +
		`${theme.fg("accent", "30")} ${theme.fg("muted", "tools")}` +
		separator +
		`${theme.fg("accent", "77")} ${theme.fg("muted", "skills")}`;
	const tips =
		`  ${theme.fg("accent", "/")} ${theme.fg("muted", "commands")}` +
		separator +
		`${theme.fg("accent", "/ui")} ${theme.fg("muted", "appearance")}` +
		separator +
		`${theme.fg("accent", "Shift+Tab")} ${theme.fg("muted", "thinking")}`;

	return [divider, clip(title, width), clip(inventory, width), clip(tips, width), divider];
}

function ultraNarrowLines(theme: Theme, width: number): string[] {
	const divider = theme.fg("borderMuted", "─".repeat(width));
	const identity =
		theme.fg("accent", theme.bold("π")) +
		` ${theme.bold("Welcome back!")}` +
		theme.fg("dim", " · ") +
		theme.fg("accent", FIXTURE_MODEL);
	return [divider, clip(identity, width), divider];
}

class WelcomeHeaderPrototype {
	constructor(private readonly theme: Theme) {}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		if (renderWidth >= 92) return wideLines(this.theme, renderWidth);
		if (renderWidth >= 48) return narrowLines(this.theme, renderWidth);
		return ultraNarrowLines(this.theme, renderWidth);
	}
}

export default function registerWelcomeHeaderPrototype(pi: ExtensionAPI): void {
	pi.registerProvider("welcome-fixture", {
		name: "Welcome Header prototype fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "offline-fixture",
		api: "openai-completions",
		models: [
			{
				id: FIXTURE_MODEL,
				name: "Welcome Header prototype fixture",
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
		ctx.ui.setHeader((_tui, theme) => new WelcomeHeaderPrototype(theme));
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
