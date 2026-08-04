/**
 * PROTOTYPE ONLY — compare iconified two-row Statusline treatments inside the
 * real Pi Host. This is disposable visual evidence, not production code.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PROVIDER = "statusline-fixture";
const MODEL = "gpt-5.6-sol";
const MODEL_IDENTITY = "openai-codex/gpt-5.6-sol";
const SEPARATOR_TEXT = " · ";
const FIXTURE_CWD = "pi-stuff";
const FIXTURE_BRANCH = "main";

type Variant = "a" | "b" | "c";
type SegmentId = "model" | "thinking" | "fast" | "cwd" | "branch" | "diff" | "context" | "cache" | "weekly";

interface Segment {
	readonly id: SegmentId;
	readonly priority: number;
	readonly text: string;
}

function configuredVariant(): Variant {
	const value = process.env["PI_STUFF_STATUSLINE_VARIANT"]?.toLowerCase();
	return value === "b" || value === "c" ? value : "a";
}

function latestPrompt(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message.role !== "user") continue;
		const content = entry.message.content;
		const text =
			typeof content === "string"
				? content
				: content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join(" ");
		return text.replace(/\s+/gu, " ").trim() || undefined;
	}
	return undefined;
}

function aSegments(theme: Theme, cwd: string, branch: string): readonly Segment[] {
	return [
		{ id: "model", priority: 100, text: theme.fg("accent", `󰚩 ${MODEL_IDENTITY}`) },
		{ id: "thinking", priority: 65, text: `${theme.fg("accent", "◉")} ${theme.fg("muted", "high")}` },
		{ id: "fast", priority: 55, text: theme.fg("warning", " Fast") },
		{ id: "cwd", priority: 95, text: `${theme.fg("accent", "󰉋")} ${theme.fg("text", cwd)}` },
		{ id: "branch", priority: 90, text: `${theme.fg("muted", "")} ${theme.fg("text", branch)}` },
		{
			id: "diff",
			priority: 50,
			text: `${theme.fg("muted", "")} ${theme.fg("success", "(+6,")}${theme.fg("error", "-0")}${theme.fg("success", ")")}`,
		},
		{ id: "context", priority: 85, text: `${theme.fg("muted", "◈")} ${theme.fg("text", "42%")}` },
		{ id: "cache", priority: 45, text: `${theme.fg("muted", "󰆼")} ${theme.fg("text", "78%")}` },
		{ id: "weekly", priority: 80, text: `${theme.fg("warning", "󰃭")} ${theme.fg("text", "52%")}` },
	];
}

function bSegments(theme: Theme, cwd: string, branch: string): readonly Segment[] {
	return [
		{ id: "model", priority: 100, text: `${theme.fg("accent", "")} ${theme.fg("text", MODEL_IDENTITY)}` },
		{ id: "thinking", priority: 65, text: `${theme.fg("accent", "✻")} ${theme.fg("text", "high")}` },
		{ id: "fast", priority: 55, text: `${theme.fg("warning", "")} ${theme.fg("text", "Fast")}` },
		{ id: "cwd", priority: 95, text: `${theme.fg("accent", "")} ${theme.fg("text", cwd)}` },
		{
			id: "branch",
			priority: 90,
			text: `${theme.fg("muted", "")} ${theme.fg("text", branch)} ${theme.fg("success", "+6")}${theme.fg("dim", "/")}${theme.fg("error", "-0")}`,
		},
		{ id: "context", priority: 85, text: `${theme.fg("muted", "◒")} ${theme.fg("text", "42%")}` },
		{ id: "cache", priority: 45, text: `${theme.fg("muted", "↻")} ${theme.fg("text", "78%")}` },
		{ id: "weekly", priority: 80, text: `${theme.fg("muted", "◷")} ${theme.fg("text", "52%")}` },
	];
}

function cSegments(theme: Theme, cwd: string, branch: string): readonly Segment[] {
	return [
		{ id: "model", priority: 100, text: `${theme.fg("accent", "󰚩")} ${theme.fg("text", MODEL_IDENTITY)}` },
		{ id: "thinking", priority: 65, text: `${theme.fg("accent", "◉")} ${theme.fg("dim", "high")}` },
		{ id: "fast", priority: 55, text: theme.fg("warning", " Fast") },
		{
			id: "cwd",
			priority: 95,
			text: `${theme.fg("accent", "󰉋")} ${theme.fg("text", cwd)} ${theme.fg("dim", "/")} ${theme.fg("text", branch)}`,
		},
		{
			id: "branch",
			priority: 90,
			text: `${theme.fg("success", "+6")} ${theme.fg("error", "-0")}`,
		},
		{ id: "context", priority: 85, text: `${theme.fg("accent", "◈")}${theme.fg("text", "42%")}` },
		{ id: "cache", priority: 45, text: `${theme.fg("accent", "󰆼")}${theme.fg("text", "78%")}` },
		{ id: "weekly", priority: 80, text: `${theme.fg("warning", "󰃭")}${theme.fg("text", "52%")}` },
	];
}

function segmentsFor(variant: Variant, theme: Theme, cwd: string, branch: string): readonly Segment[] {
	if (variant === "b") return bSegments(theme, cwd, branch);
	if (variant === "c") return cSegments(theme, cwd, branch);
	return aSegments(theme, cwd, branch);
}

function packOneRow(segments: readonly Segment[], width: number, theme: Theme): string {
	const separator = theme.fg("dim", SEPARATOR_TEXT);
	const selected = [...segments];
	const render = (): string => selected.map((segment) => segment.text).join(separator);

	while (selected.length > 1 && visibleWidth(render()) > width) {
		let removalIndex = 0;
		for (let index = 1; index < selected.length; index += 1) {
			if ((selected[index]?.priority ?? Number.POSITIVE_INFINITY) < (selected[removalIndex]?.priority ?? 0)) {
				removalIndex = index;
			}
		}
		selected.splice(removalIndex, 1);
	}

	return truncateToWidth(render(), Math.max(1, width), theme.fg("dim", "…"));
}

function promptRow(prompt: string, width: number, theme: Theme): string {
	const marker = `${theme.fg("accent", "●")} `;
	const available = Math.max(1, width - visibleWidth(marker));
	return `${marker}${theme.fg("dim", truncateToWidth(prompt, available, "…"))}`;
}

class PrototypeFooter implements Component {
	private readonly theme: Theme;
	private readonly ctx: ExtensionContext;
	private readonly variant: Variant;

	constructor(theme: Theme, ctx: ExtensionContext, variant: Variant) {
		this.theme = theme;
		this.ctx = ctx;
		this.variant = variant;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const status = packOneRow(segmentsFor(this.variant, this.theme, FIXTURE_CWD, FIXTURE_BRANCH), width, this.theme);
		const prompt = latestPrompt(this.ctx);
		return prompt ? [status, promptRow(prompt, width, this.theme)] : [status];
	}
}

export default function registerStatuslineIconFooterPrototype(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER, {
		name: "Statusline icon-footer fixture",
		baseUrl: "https://fixture.invalid",
		apiKey: "fixture",
		api: "openai-completions",
		models: [
			{
				id: MODEL,
				name: "GPT-5.6 Sol fixture",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 272_000,
				maxTokens: 8_192,
			},
		],
	});

	pi.on("session_start", (_event, ctx) => {
		const variant = configuredVariant();
		ctx.ui.setFooter((_tui, theme) => new PrototypeFooter(theme, ctx, variant));
	});
}
