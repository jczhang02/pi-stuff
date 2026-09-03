import { expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { transformConversationMarkdown } from "../../packages/pi-stuff/src/conversation-ui/conversation-markdown.js";
import {
	HIDDEN_THINKING_LABEL,
	installThinkingLineDisplay,
} from "../../packages/pi-stuff/src/conversation-ui/thinking-line.js";

const ZERO_USAGE = {
	cacheRead: 0,
	cacheWrite: 0,
	cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
	input: 0,
	output: 0,
	totalTokens: 0,
};

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		api: "openai-completions",
		content,
		model: "thinking-line-fixture",
		provider: "fixture",
		role: "assistant",
		stopReason,
		timestamp: 0,
		usage: ZERO_USAGE,
	};
}

function component(message: AssistantMessage, hidden = false): AssistantMessageComponent {
	return new AssistantMessageComponent(message, hidden, getMarkdownTheme(), HIDDEN_THINKING_LABEL, 1, [
		transformConversationMarkdown,
	]);
}

function renderedContent(componentUnderTest: AssistantMessageComponent, width = 80): string[] {
	return componentUnderTest
		.render(width)
		.map((line) => stripTerminalSequences(line).trim())
		.filter(Boolean);
}

test("replaces a visible Thinking run with its latest native Markdown row", () => {
	initTheme("dark");
	const uninstall = installThinkingLineDisplay();
	try {
		const streaming = assistantMessage(
			[
				{ type: "thinking", thinking: "**Planning comprehensive backpressure design**" },
				{ type: "thinking", thinking: "**Formulating backpressure assumptions and schemes**" },
			],
			"pending",
		);
		const sourceBeforeRender = structuredClone(streaming);
		const rendered = component(streaming);

		expect(renderedContent(rendered)).toEqual(["• thoughts: Formulating backpressure assumptions and schemes"]);
		expect(streaming).toEqual(sourceBeforeRender);

		const settled = assistantMessage([
			...streaming.content,
			{ type: "thinking", thinking: "**Defining combined state machine and event priorities**" },
			{ type: "thinking", thinking: "**Designing event loop state machine**\n\n" },
		]);
		rendered.updateContent(settled, false);
		expect(renderedContent(rendered)).toEqual(["• thoughts: Designing event loop state machine"]);
	} finally {
		uninstall();
	}
});

test("reuses the projected row during ordinary Host redraws", () => {
	initTheme("dark");
	const uninstall = installThinkingLineDisplay();
	const original = Markdown.prototype.render;
	let renderCalls = 0;
	Markdown.prototype.render = function (width): string[] {
		renderCalls += 1;
		return original.call(this, width);
	};
	try {
		const rendered = component(assistantMessage([{ type: "thinking", thinking: "first\n\nlatest" }]));
		rendered.render(80);
		rendered.render(80);
		expect(renderCalls).toBe(1);
		rendered.invalidate();
		rendered.render(80);
		expect(renderCalls).toBe(2);
	} finally {
		Markdown.prototype.render = original;
		uninstall();
	}
});

test("restores the Host renderer after the final adapter owner releases it", () => {
	initTheme("dark");
	const releaseFirst = installThinkingLineDisplay();
	const releaseSecond = installThinkingLineDisplay();
	releaseFirst();
	try {
		expect(renderedContent(component(assistantMessage([{ type: "thinking", thinking: "First\n\nLatest" }])))).toEqual(
			["• thoughts: Latest"],
		);
	} finally {
		releaseSecond();
	}
	expect(renderedContent(component(assistantMessage([{ type: "thinking", thinking: "First\n\nLatest" }])))).toEqual([
		"First",
		"Latest",
	]);
});

test("keeps Host Thinking visibility semantics", () => {
	initTheme("dark");
	const uninstall = installThinkingLineDisplay();
	try {
		const rendered = component(assistantMessage([{ type: "thinking", thinking: "First\n\nLatest" }]));
		rendered.setHideThinkingBlock(true);
		const hidden = rendered.render(80);
		expect(
			hidden
				.map(stripTerminalSequences)
				.map((line) => line.trim())
				.filter(Boolean),
		).toEqual(["• thoughts"]);

		rendered.setHideThinkingBlock(false);
		expect(renderedContent(rendered)).toEqual(["• thoughts: Latest"]);
	} finally {
		uninstall();
	}
});

test("retains separate Host Thinking runs", () => {
	initTheme("dark");
	const uninstall = installThinkingLineDisplay();
	try {
		const rendered = component(
			assistantMessage([
				{ type: "thinking", thinking: "First run" },
				{ type: "text", text: "Visible answer" },
				{ type: "thinking", thinking: "Second run" },
			]),
		);
		const thoughts = renderedContent(rendered).filter((line) => line.startsWith("• thoughts"));
		expect(thoughts).toEqual(["• thoughts: First run", "• thoughts: Second run"]);
	} finally {
		uninstall();
	}
});

test("matches Host whitespace filtering without scanning ordinary cumulative content", () => {
	initTheme("dark");
	const uninstall = installThinkingLineDisplay();
	try {
		const rendered = component(
			assistantMessage([
				{ type: "text", text: "   " },
				{ type: "thinking", thinking: "\n" },
				{ type: "thinking", thinking: "Latest" },
			]),
		);
		expect(renderedContent(rendered)).toEqual(["• thoughts: Latest"]);
	} finally {
		uninstall();
	}
});

test("keeps the tail of a wrapped latest line within the viewport", () => {
	initTheme("dark");
	const uninstall = installThinkingLineDisplay();
	try {
		const rendered = component(
			assistantMessage([
				{
					type: "thinking",
					thinking: "[abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ](https://example.com)",
				},
			]),
		);
		rendered.render(80);
		const raw = rendered.render(28).find((line) => stripTerminalSequences(line).includes("thoughts"));
		if (!raw) throw new Error("Thinking row was not rendered");
		const visible = stripTerminalSequences(raw).trim();
		expect(visible).toEndWith("MNOPQRSTUVWXYZ");
		expect(visible).not.toContain("abc");
		expect(raw).toContain("\u001b]8;;\u001b\\");
		expect(raw).toEndWith("\u001b[0m");
		expect(visibleWidth(raw)).toBeLessThanOrEqual(28);
	} finally {
		uninstall();
	}
});
