/**
 * PROTOTYPE — render the accepted Statusline information architecture inside
 * the real Pi Host. This is disposable evidence, not production code, and was
 * written from the visible-behavior brief without consulting old JC code.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type ReadonlyFooterDataProvider,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Key, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PROVIDER = "statusline-fixture";
const METERED_MODEL = "sonnet-4.5-metered";
const SUBSCRIPTION_MODEL = "sonnet-4.5-subscription";
const GIT_COUNTS = "+12 ~3 -1";

function formatCount(value: number): string {
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}

function formatThinking(level: string): string {
	const labels = new Map([
		["off", "off"],
		["minimal", "min"],
		["low", "low"],
		["medium", "med"],
		["high", "high"],
		["xhigh", "xhigh"],
		["max", "max"],
	]);
	return labels.get(level) ?? level;
}

function abbreviateCwd(cwd: string): string {
	const home = process.env["HOME"];
	const homeRelative = home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
	const pieces = homeRelative.split("/");
	if (pieces.length <= 2) return homeRelative;
	return pieces.map((piece, index) => (index > 0 && index < pieces.length - 1 ? piece.slice(0, 1) : piece)).join("/");
}

function latestPrompt(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message.role !== "user") continue;
		const content = entry.message.content;
		const text = Array.isArray(content)
			? content
					.filter((part): part is { type: "text"; text: string } => part.type === "text")
					.map((part) => part.text)
					.join(" ")
			: content;
		return text.replace(/\s+/g, " ").trim() || undefined;
	}
	return undefined;
}

function usageTotals(ctx: ExtensionContext) {
	let cacheRead = 0;
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message;
		cacheRead += message.usage.cacheRead;
		cost += message.usage.cost.total;
	}
	return { cacheRead, cost };
}

function renderStatusline(
	width: number,
	theme: Theme,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	footerData: ReadonlyFooterDataProvider,
): string[] {
	const separator = theme.fg("dim", " · ");
	const usage = usageTotals(ctx);
	const contextPercent = ctx.getContextUsage()?.percent;
	const branch = footerData.getGitBranch() ?? "git";
	const statuses = footerData.getExtensionStatuses();
	const model =
		ctx.model?.id === SUBSCRIPTION_MODEL || ctx.model?.id === METERED_MODEL
			? "sonnet-4.5"
			: (ctx.model?.id ?? "no-model");
	const subscription = ctx.model?.id === SUBSCRIPTION_MODEL;
	const segments = [
		theme.fg("accent", model),
		theme.fg("muted", formatThinking(pi.getThinkingLevel())),
		theme.fg("text", abbreviateCwd(ctx.cwd)),
		`${theme.fg("muted", branch)} ${theme.fg("success", GIT_COUNTS.split(" ")[0] ?? "")}` +
			` ${theme.fg("warning", GIT_COUNTS.split(" ")[1] ?? "")} ${theme.fg("error", GIT_COUNTS.split(" ")[2] ?? "")}`,
		theme.fg(
			"warning",
			contextPercent === null || contextPercent === undefined ? "ctx ?" : `${Math.round(contextPercent)}%`,
		),
		theme.fg("muted", `↻${formatCount(usage.cacheRead)}`),
	];
	if (!subscription) segments.push(theme.fg("warning", `$${usage.cost.toFixed(2)}`));
	for (const key of ["goal", "mcp", "loadout"]) {
		const status = statuses.get(key);
		if (status) segments.push(theme.fg("muted", status));
	}

	const mainLine = truncateToWidth(segments.join(separator), Math.max(1, width), theme.fg("dim", "…"));
	const prompt = latestPrompt(ctx);
	if (!prompt || width < 4) return [mainLine];

	const promptWidth = Math.max(1, width - 2);
	const wrapped = wrapTextWithAnsi(prompt, promptWidth);
	const firstPromptLine = `${theme.fg("accent", "›")} ${theme.fg("dim", wrapped[0] ?? "")}`;
	if (wrapped.length === 1) return [mainLine, truncateToWidth(firstPromptLine, width)];

	const overflow = wrapped.slice(1).join(" ");
	const secondPromptLine = `  ${theme.fg("dim", truncateToWidth(overflow, promptWidth, "…"))}`;
	return [mainLine, truncateToWidth(firstPromptLine, width), truncateToWidth(secondPromptLine, width)];
}

class StatuslineFooter implements Component {
	private readonly theme: Theme;
	private readonly ctx: ExtensionContext;
	private readonly pi: ExtensionAPI;
	private readonly footerData: ReadonlyFooterDataProvider;
	private readonly shouldHide: () => boolean;

	constructor(
		theme: Theme,
		ctx: ExtensionContext,
		pi: ExtensionAPI,
		footerData: ReadonlyFooterDataProvider,
		shouldHide: () => boolean,
	) {
		this.theme = theme;
		this.ctx = ctx;
		this.pi = pi;
		this.footerData = footerData;
		this.shouldHide = shouldHide;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.shouldHide()) return [];
		return renderStatusline(width, this.theme, this.ctx, this.pi, this.footerData).map((line) => {
			if (visibleWidth(line) <= width) return line;
			return truncateToWidth(line, width, this.theme.fg("dim", "…"));
		});
	}
}

export default function registerStatuslinePrototype(pi: ExtensionAPI): void {
	let activeEditor: CustomEditor | undefined;
	let activeTui: TUI | undefined;
	let temporarySurfaceOpen = false;

	pi.registerProvider(PROVIDER, {
		name: "Statusline visual-review fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: METERED_MODEL,
				name: "Sonnet 4.5 metered fixture",
				reasoning: true,
				input: ["text"],
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200_000,
				maxTokens: 8_192,
			},
			{
				id: SUBSCRIPTION_MODEL,
				name: "Sonnet 4.5 subscription fixture",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 8_192,
			},
		],
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus("goal", "goal:UI");
		ctx.ui.setStatus("mcp", "mcp:2");
		ctx.ui.setStatus("loadout", "load:full");

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new CustomEditor(tui, theme, keybindings);
			activeEditor = editor;
			activeTui = tui;
			return editor;
		});
		ctx.ui.setFooter((tui, theme, footerData) => {
			activeTui = tui;
			return new StatuslineFooter(
				theme,
				ctx,
				pi,
				footerData,
				() => temporarySurfaceOpen || (activeEditor?.isShowingAutocomplete() ?? false),
			);
		});

		const openSelector = async (): Promise<void> => {
			temporarySurfaceOpen = true;
			activeTui?.requestRender();
			try {
				await ctx.ui.select("Statusline hidden · temporary selector", [
					"Continue with the current task",
					"Review UI settings",
					"Cancel",
				]);
			} finally {
				temporarySurfaceOpen = false;
				activeTui?.requestRender();
			}
		};

		pi.registerCommand("prototype-statusline-selector", {
			description: "Open the temporary selector used by the Statusline prototype",
			handler: openSelector,
		});
		pi.registerShortcut(Key.ctrl("b"), {
			description: "[prototype only] Open the Statusline selector without consuming the draft",
			handler: openSelector,
		});
	});

	pi.on("session_shutdown", () => {
		activeEditor = undefined;
		activeTui = undefined;
		temporarySurfaceOpen = false;
	});
}
