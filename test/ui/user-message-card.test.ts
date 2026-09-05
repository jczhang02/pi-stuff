import { expect, test } from "bun:test";
import {
	getMarkdownTheme,
	initTheme,
	parseSkillBlock,
	SkillInvocationMessageComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, stripTerminalSequences } from "@earendil-works/pi-tui";
import { UserMessageCard } from "../../packages/pi-stuff/src/conversation-ui/user-message-card.js";

function card(prompt: string, skillName = "implement", failures?: Error[]): UserMessageCard {
	initTheme("dark");
	const skill = parseSkillBlock(
		`<skill name="${skillName}" location="fixture/SKILL.md">\nDetails stay below the prompt.\n</skill>${prompt ? `\n\n${prompt}` : ""}`,
	);
	const fallback = new Container();
	if (skill) fallback.addChild(new SkillInvocationMessageComponent(skill));
	if (prompt) {
		fallback.addChild(new Spacer(1));
		fallback.addChild(new UserMessageComponent(prompt));
	}
	return new UserMessageCard(prompt, {
		markdownTheme: getMarkdownTheme(),
		outputPad: 1,
		transformers: [],
		skill,
		fallback,
		fail: (error) => {
			if (failures) {
				failures.push(error);
				return;
			}
			throw error;
		},
	});
}

function content(message: UserMessageCard, width = 80): string[] {
	return message
		.render(width)
		.map((row) => stripTerminalSequences(row).trimEnd())
		.filter((row) => row.trim());
}

test.each([
	"# Heading",
	"- First item",
	"> Quotation",
	"```ts\nconst answer = 42;\n```",
	"Heading\n=======",
	"Name | Value\n--- | ---\nA | B",
])("keeps block Markdown below the inline Skill identity: %s", (prompt) => {
	const message = card(prompt);
	expect(content(message)[0]).toBe("  [skill] implement");
	expect(content(message).length).toBeGreaterThan(1);
});

test("retains native messages and expansion after a projection rendering failure", () => {
	const failures: Error[] = [];
	const message = card("Original prompt", "implement", failures);
	const nativeRender = Markdown.prototype.render;
	Markdown.prototype.render = function (width): string[] {
		if (width === 76) throw new Error("injected projection-width failure");
		return nativeRender.call(this, width);
	};
	try {
		expect(content(message)).toContain(" Original prompt");
		expect(failures).toHaveLength(1);
		message.setExpanded(true);
		expect(content(message).some((row) => row.includes("Details stay below the prompt."))).toBe(true);
		expect(failures).toHaveLength(1);
		message.setOutputPad(3);
		expect(content(message)).toContain("   Original prompt");
	} finally {
		Markdown.prototype.render = nativeRender;
	}
});

test("retains prompt rows across redraw, expansion, and padding changes", () => {
	const message = card("First line\nSecond line");
	const initial = content(message);
	expect(initial).toEqual(["  [skill] implement First line", "   Second line"]);
	expect(content(message)).toEqual(initial);
	message.setOutputPad(3);
	message.setExpanded(true);
	expect(content(message)[0]).toBe("    [skill] implement First line");
	message.setExpanded(false);
	expect(content(message)).toEqual(["    [skill] implement First line", "     Second line"]);
});
