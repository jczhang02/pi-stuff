import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
	getMarkdownTheme,
	initTheme,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import {
	createLiveThoughtTransformer,
	registerLiveThoughtDisplay,
	type ThoughtMarkdownTransformContext,
	type ThoughtMarkdownTransformer,
} from "../../packages/pi-stuff/src/conversation-ui/live-thought.js";
import { SELF_RENDERED_TRANSCRIPT_PADDING } from "../../packages/pi-stuff/src/conversation-ui/transcript.js";
import { CachedToolRow } from "../../packages/pi-stuff/src/tool-display/render.js";

const CONTEXT: ThoughtMarkdownTransformContext = {
	availableWidth: 80,
	isStreaming: true,
	messageType: "assistant-thinking",
};

const SCREENSHOT_PHASES = [
	"Creating diagnostic script for false failure",
	"Drafting failure detection logic in script",
	"Listing and ranking failure hypotheses",
	"Adding failure hypotheses commentary",
] as const;

function transform(markdown: string, overrides: Partial<ThoughtMarkdownTransformContext> = {}): string {
	return createLiveThoughtTransformer()(markdown, { ...CONTEXT, ...overrides });
}

function visibleMarkdown(markdown: string): string {
	return markdown.replaceAll(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

async function renderAssistant(markdown: string, width = 80): Promise<string[]> {
	initTheme("dark");
	const transformer = createLiveThoughtTransformer();
	const rendered = new Markdown(markdown, 0, 0, getMarkdownTheme(), undefined, {
		transform: (value, availableWidth) =>
			transformer(value, {
				availableWidth,
				isStreaming: false,
				messageType: "assistant",
			}),
	})
		.render(width)
		.map((line) => stripTerminalSequences(line).trimEnd());
	await Promise.resolve();
	return rendered;
}

describe("live Thought display", () => {
	test("uses a one-cell asterisk operator centered on the text axis", () => {
		const visible = visibleMarkdown(transform("Checking alignment"));

		expect([...visible][0]).toBe("∗");
		expect(visible).toBe("∗ thoughts: Checking alignment");
		expect(visibleWidth("∗")).toBe(1);
	});

	test("leaves user Markdown unchanged and gives every Assistant message one outer marker", () => {
		const markdown = "# Keep **all** model content\n\nincluding CJK 内容";
		expect(transform(markdown, { messageType: "user" })).toBe(markdown);
		const structured = transform(markdown, { messageType: "assistant" });
		expect(structured).toStartWith("- # Keep **all** model content");
		expect(structured).toContain("\n  including CJK 内容");
		expect(structured.match(/^- /gmu)).toHaveLength(1);
		const assistant = transform("Keep **all** model content including CJK 内容", { messageType: "assistant" });
		expect(assistant).toStartWith("- ");
		expect(assistant).not.toContain("●");
		expect(assistant).toContain("including CJK 内容");
	});

	test("keeps structured Assistant Markdown inside one message-level bullet", async () => {
		const source = [
			"## Result",
			"",
			"Paragraph with **bold** and [link](https://example.com).",
			"",
			"> quoted",
			"",
			"- first",
			"- second",
			"",
			"```ts",
			"const value = 1;",
			"```",
		].join("\n");
		const projected = transform(source, { messageType: "assistant" });

		expect(projected).toStartWith("- ## Result");
		expect(projected).toContain("\n  > quoted");
		expect(projected).toContain("\n  - first\n  - second");
		expect(projected).toContain("\n  ```ts\n  const value = 1;\n  ```");
		expect(projected.match(/^- /gmu)).toHaveLength(1);

		const rendered = await renderAssistant(source, 44);
		expect(rendered[0]).toStartWith("• ");
		expect(rendered.filter((line) => line.startsWith("• "))).toHaveLength(1);
		expect(rendered.find((line) => line.includes("first"))?.startsWith("    - ")).toBe(true);
		expect(rendered.find((line) => line.includes("const value"))?.startsWith("    ")).toBe(true);
		expect(rendered.every((line) => visibleWidth(line) <= 44)).toBe(true);
	});

	test("keeps the Assistant marker when the first Markdown block is a list", async () => {
		for (const source of [
			"- first\n- second",
			"1. first\n2. second",
			"- [ ] first\n- [x] second",
			"- parent\n  - child\n\nAfter",
		]) {
			const projected = transform(source, { messageType: "assistant" });
			expect(projected).toStartWith("- \u2060\n  ");
			const rendered = await renderAssistant(source, 44);
			expect(rendered[0]?.replaceAll("\u2060", "")).toBe("• ");
			expect(rendered.filter((line) => line.startsWith("• "))).toHaveLength(1);
		}

		expect(transform("* * *\n\nAfter", { messageType: "assistant" })).not.toStartWith("- \u2060\n");
		expect(transform("Before\n\n- first", { messageType: "assistant" })).not.toStartWith("- \u2060\n");
		expect(transform("    - indented code", { messageType: "assistant" })).not.toStartWith("- \u2060\n");
	});

	test("aligns assistant prose wraps after one marker cell and one space", async () => {
		initTheme("dark");
		const transformer = createLiveThoughtTransformer();
		const markdown = new Markdown("检查中文工具结果 and continue", 0, 0, getMarkdownTheme(), undefined, {
			transform: (value, width) =>
				transformer(value, {
					availableWidth: width,
					isStreaming: true,
					messageType: "assistant",
				}),
		});
		const lines = markdown.render(12).map((line) => stripTerminalSequences(line).trimEnd());
		await Promise.resolve();
		expect(lines[0]).toStartWith("• ");
		expect(lines.slice(1).every((line) => line.startsWith("  "))).toBe(true);
		expect(lines.every((line) => visibleWidth(line) <= 12)).toBe(true);
		expect(transform("streaming CJK 内容", { availableWidth: 12, messageType: "assistant" })).toBe(
			transform("streaming CJK 内容", {
				availableWidth: 12,
				isStreaming: false,
				messageType: "assistant",
			}),
		);
	});

	test("aligns Tool Activity and assistant markers under Host outputPad", async () => {
		initTheme("dark");
		const transformer = createLiveThoughtTransformer();
		const assistant = new Markdown(
			"ALL_FAILED_DONE",
			SELF_RENDERED_TRANSCRIPT_PADDING,
			0,
			getMarkdownTheme(),
			undefined,
			{
				transform: (value, width) =>
					transformer(value, {
						availableWidth: width,
						isStreaming: false,
						messageType: "assistant",
					}),
			},
		);
		const toolTheme = {
			bold: (value: string) => value,
			fg: (_color: string, value: string) => value,
		} as Theme;
		const activity = new CachedToolRow(toolTheme, {
			active: false,
			expandable: true,
			hint: "",
			kind: "activity",
			outcome: "error",
			summary: "Ran 1 command · 1 failed",
		});
		const assistantLine = stripTerminalSequences(assistant.render(80)[0] ?? "");
		await Promise.resolve();
		const activityLine = activity.render(80)[0] ?? "";

		expect([activityLine.indexOf("•"), assistantLine.indexOf("•")]).toEqual([
			SELF_RENDERED_TRANSCRIPT_PADDING,
			SELF_RENDERED_TRANSCRIPT_PADDING,
		]);
	});

	test("advances through the screenshot's bold blocks one visible frame at a time", () => {
		const transformer = createLiveThoughtTransformer();

		for (const [index, phase] of SCREENSHOT_PHASES.entries()) {
			const markdown = SCREENSHOT_PHASES.slice(0, index + 1)
				.map((value) => `**${value}**`)
				.join("\n\n");
			const rendered = transformer(markdown, CONTEXT);
			const visible = visibleMarkdown(rendered);

			expect(visible).toBe(`∗ thoughts: ${phase}`);
			expect(visible).not.toContain("**");
			expect(visible).not.toContain("\n");
			expect(visible).not.toMatch(/…\p{L}/u);
			for (const prior of SCREENSHOT_PHASES.slice(0, index)) {
				expect(visible).not.toContain(prior);
			}
		}
	});

	test("grows an incomplete current wrapper and replaces it when a new block starts", () => {
		const transformer = createLiveThoughtTransformer();
		const snapshots = [
			["**Creating", "Creating"],
			["**Creating diagnostic script", "Creating diagnostic script"],
			["**Creating diagnostic script**", "Creating diagnostic script"],
			["**Creating diagnostic script**\n\n**Drafting", "Drafting"],
			["**Creating diagnostic script**\n\n**Drafting failure detection**", "Drafting failure detection"],
		] as const;

		for (const [markdown, current] of snapshots) {
			expect(visibleMarkdown(transformer(markdown, CONTEXT))).toBe(`∗ thoughts: ${current}`);
		}
	});

	test("recognizes paragraph, heading, list-item, and standalone-emphasis boundaries", () => {
		expect(
			visibleMarkdown(transform("First paragraph without punctuation\n\nNewest paragraph without punctuation")),
		).toBe("∗ thoughts: Newest paragraph without punctuation");
		expect(visibleMarkdown(transform("Earlier paragraph\n## Current heading"))).toBe("∗ thoughts: Current heading");
		expect(visibleMarkdown(transform("- First list action\n- Current list action"))).toBe(
			"∗ thoughts: Current list action",
		);
		expect(visibleMarkdown(transform("**First emphasized action**\n_Current emphasized action_"))).toBe(
			"∗ thoughts: Current emphasized action",
		);
	});

	test("lets the current prose block grow without collapsing it to its final sentence", () => {
		const transformer = createLiveThoughtTransformer();
		const first = transformer("Inspecting the repository", CONTEXT);
		const next = transformer("Inspecting the repository. 正在运行真实测试", CONTEXT);

		expect(visibleMarkdown(first)).toBe("∗ thoughts: Inspecting the repository");
		expect(visibleMarkdown(next)).toBe("∗ thoughts: Inspecting the repository. 正在运行真实测试");
	});

	test("retains the final block after settlement, resize, restored replay, and resume", () => {
		const markdown = "**First possibility was rejected**\n\n**最后选择公开 Host seam。**";
		const live = transform(markdown);
		const settled = transform(markdown, { isStreaming: false });
		const resized = transform(markdown, { availableWidth: 32, isStreaming: false });
		const restored = createLiveThoughtTransformer()(markdown, {
			...CONTEXT,
			availableWidth: 32,
			isStreaming: false,
		});
		const resumed = createLiveThoughtTransformer()(markdown, { ...CONTEXT, isStreaming: false });

		expect(visibleMarkdown(settled)).toBe("∗ thoughts: 最后选择公开 Host seam。");
		expect(settled).toBe(live);
		expect(restored).toBe(resized);
		expect(visibleMarkdown(resized)).not.toContain("First possibility");
		expect(visibleWidth(visibleMarkdown(resized))).toBeLessThanOrEqual(32);
		expect(resumed).toBe(settled);
	});

	test("fits CJK and emoji by terminal columns while preserving a readable start and newest tail", () => {
		const rendered = transform("旧步骤完成。正在检查中文🧪结果", { availableWidth: 24 });
		const visible = visibleMarkdown(rendered);

		expect(visibleWidth(visible)).toBeLessThanOrEqual(24);
		expect(visible).toStartWith("∗ thoughts: 旧");
		expect(visible).toEndWith("结果");
		expect(visible).not.toMatch(/…\p{L}/u);
	});

	test("does not expose a mid-word leading ellipsis when fitting long prose", () => {
		const rendered = transform(
			"Creating an exceptionally verbose diagnostic script for the newest failure hypothesis",
			{
				availableWidth: 42,
			},
		);
		const visible = visibleMarkdown(rendered);

		expect(visibleWidth(visible)).toBeLessThanOrEqual(42);
		expect(visible).toStartWith("∗ thoughts: Creating");
		expect(visible).toEndWith("hypothesis");
		expect(visible).not.toContain("…reating");
	});

	test("reduces the label when that preserves both the action start and newest tail", () => {
		const rendered = transform("Adding failure hypotheses commentary", { availableWidth: 30 });
		const visible = visibleMarkdown(rendered);

		expect(visible).toBe("∗ Adding … commentary");
		expect(visibleWidth(visible)).toBeLessThanOrEqual(30);
	});

	test("reduces the label before allowing narrow-terminal wrapping", () => {
		for (const width of [1, 2, 4, 8, 11, 12, 13, 14]) {
			const visible = visibleMarkdown(transform("检查完成", { availableWidth: width }));
			expect(visible).not.toContain("\n");
			expect(visibleWidth(visible)).toBeLessThanOrEqual(width);
			expect(visible).toStartWith("∗");
			if (width >= 4) expect(visible).toMatch(/[检查完成]/u);
		}
		expect(transform("检查完成", { availableWidth: 0 })).toBe("");
		expect(transform("检查完成", { availableWidth: Number.NaN })).toBe("");
	});

	test("removes terminal protocols and direction controls without damaging CJK", () => {
		const rendered = transform("Old.\n\n\u001b]0;forged title\u0007最新\u001b[31m红色\u001b[0m\u202efragment");
		const visible = visibleMarkdown(rendered);

		expect(visible).toBe("∗ thoughts: 最新红色 fragment");
		expect(rendered).not.toContain(String.fromCharCode(0x1b));
		expect(rendered).not.toContain(String.fromCharCode(0x07));
		expect(rendered).not.toContain(String.fromCodePoint(0x202e));
		expect(rendered).not.toContain("forged title");
	});

	test("strips outer display emphasis while keeping inner model text literal and one-line", () => {
		const rendered = transform("Old.\n\n**Use [x](url), <tag> & `code`**");

		expect(visibleMarkdown(rendered)).toBe("∗ thoughts: Use [x](url), <tag> & `code`");
		expect(rendered).not.toContain("\\*\\*Use");
		expect(rendered).toContain("\\[x\\]");
		expect(rendered).not.toContain("\n");
	});

	test("does not invent a fragment for blank or control-only Thinking", () => {
		expect(transform(" \n\t ")).toBe("");
		expect(transform("\u001b[31m\u001b[0m\u202e")).toBe("");
	});
});

describe("live Thought Host adapter", () => {
	test("maps only the next synthetic outer Assistant list marker and restores the Theme", async () => {
		const calls: Array<readonly [string, string]> = [];
		const theme = {
			fg: (color: string, value: string) => {
				calls.push([color, value]);
				return value;
			},
			getColorMode: () => "truecolor",
		} as import("@earendil-works/pi-coding-agent").Theme;
		const original = theme.fg;
		const key = Symbol.for("@earendil-works/pi-coding-agent:theme");
		const previous = (globalThis as Record<symbol, unknown>)[key];
		(globalThis as Record<symbol, unknown>)[key] = theme;
		transform("Outer\n\n- nested", { messageType: "assistant" });
		expect(theme.fg("mdListBullet", "- ")).toBe("• ");
		expect(theme.fg).toBe(original);
		expect(theme.fg("mdListBullet", "- ")).toBe("- ");
		expect(theme.fg("text", "- ")).toBe("- ");
		expect(calls).toEqual([
			["mdListBullet", "• "],
			["mdListBullet", "- "],
			["text", "- "],
		]);
		await Promise.resolve();
		expect(theme.fg).toBe(original);
		if (previous === undefined) delete (globalThis as Record<symbol, unknown>)[key];
		else (globalThis as Record<symbol, unknown>)[key] = previous;
	});

	test("registers through the upstream public seam", () => {
		let registered: ThoughtMarkdownTransformer | undefined;
		const api = {
			registerMarkdownTransformer: (transformer: ThoughtMarkdownTransformer) => {
				registered = transformer;
			},
		} as ExtensionAPI;

		registerLiveThoughtDisplay(api);
		expect(registered).toBeDefined();
		expect(visibleMarkdown(registered?.("Checking. Ready", CONTEXT) ?? "")).toBe("∗ thoughts: Checking. Ready");
	});

	test("fails clearly when the Host cannot provide the accepted projection", () => {
		const api = {} as ExtensionAPI;
		expect(() => registerLiveThoughtDisplay(api)).toThrow("registerMarkdownTransformer() support");
	});
});
