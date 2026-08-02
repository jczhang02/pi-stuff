import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { BtwExchange } from "../../packages/pi-stuff-btw/btw-history.js";
import { BtwDialogController } from "../../packages/pi-stuff-btw/btw-ui.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	strikethrough: (text: string) => text,
} as unknown as Theme;

function exchange(index: number): BtwExchange {
	return {
		id: `exchange-${index}`,
		question: `earlier question ${index}`,
		answer: `earlier answer ${index}`,
		timestamp: index,
		contextTrimmed: false,
	};
}

function setup(
	options: {
		question?: string;
		history?: BtwExchange[];
		error?: string;
		copyText?: (text: string) => Promise<void>;
	} = {},
) {
	let closeCount = 0;
	const clearCalls: Array<string | undefined> = [];
	let renderCount = 0;
	const tui = {
		terminal: { rows: 28 },
		requestRender: () => {
			renderCount++;
		},
	};
	const controller = new BtwDialogController(theme, tui as never, {
		history: options.history ?? [],
		...(options.question === undefined ? {} : { question: options.question }),
		...(options.error === undefined ? {} : { error: options.error }),
		onClose: () => {
			closeCount++;
		},
		onClearEarlier: (id) => clearCalls.push(id),
		...(options.copyText === undefined ? {} : { copyText: options.copyText }),
	});
	return {
		controller,
		clearCalls,
		get closeCount() {
			return closeCount;
		},
		get renderCount() {
			return renderCount;
		},
	};
}

describe("BTW Command Dialog", () => {
	test("renders a divider-led one-shot pending surface with no composer or frame", () => {
		const { controller } = setup({ question: "Why keep this isolated?" });
		const output = controller.render(100).join("\n");

		expect(output).toContain("BTW · side question · main task continues");
		expect(output).toContain("Question\n  Why keep this isolated?");
		expect(output).toContain("Answer\n  Answering…");
		expect(output).toContain("Esc cancel");
		expect(output).not.toContain("Follow-up");
		expect(output).not.toContain("╭");
		controller.dispose();
	});

	test("streams in place, then renders the final Markdown answer and copy action", async () => {
		const copied: string[] = [];
		const { controller } = setup({
			question: "question",
			copyText: async (text) => {
				copied.push(text);
			},
		});
		controller.appendText("**partial**");
		controller.setSuccess({
			id: "current",
			question: "question",
			answer: "**final answer**",
			timestamp: 1,
			contextTrimmed: false,
		});
		controller.handleInput("c");
		await Promise.resolve();

		const output = controller.render(80).join("\n");
		expect(output).toContain("final answer");
		expect(output).toContain("Copied answer");
		expect(copied).toEqual(["**final answer**"]);
		controller.dispose();
	});

	test("shows at most five earlier exchanges plus current and clears only earlier history", () => {
		const history = Array.from({ length: 10 }, (_, index) => exchange(index));
		const setupResult = setup({ question: "current question", history });
		const before = setupResult.controller.render(100).join("\n");
		expect(before).toContain("(+5 earlier /btw)");
		expect(before).not.toContain("earlier question 4");
		expect(before).toContain("earlier question 5");

		setupResult.controller.handleInput("x");
		const after = setupResult.controller.render(100).join("\n");
		expect(setupResult.clearCalls).toEqual([undefined]);
		expect(after).not.toContain("earlier question");
		expect(after).not.toContain("earlier /btw");
		setupResult.controller.dispose();
	});

	test("navigates display-only history without creating a second composer", () => {
		const result = setup({ history: [exchange(1), exchange(2)] });
		const { controller } = result;
		controller.handleInput("\u001b[D");
		const output = controller.render(80).join("\n");
		expect(output).toContain("Question\n  earlier question 1");
		expect(output).not.toContain("Follow-up");
		controller.handleInput("x");
		expect(result.clearCalls).toEqual(["exchange-1"]);
		expect(controller.render(80).join("\n")).toContain("Question\n  earlier question 1");
		controller.dispose();
	});

	test("never discards an in-flight current exchange when clearing from history", () => {
		const result = setup({ question: "current question", history: [exchange(1), exchange(2)] });
		result.controller.handleInput("\u001b[D");
		result.controller.handleInput("x");
		result.controller.setSuccess({
			id: "current",
			question: "current question",
			answer: "current answer",
			timestamp: 3,
			contextTrimmed: false,
		});
		const output = result.controller.render(80).join("\n");
		expect(result.clearCalls).toEqual([undefined]);
		expect(output).toContain("Question\n  current question");
		expect(output).toContain("current answer");
		result.controller.dispose();
	});

	test("keeps partial text visibly incomplete on provider failure", () => {
		const { controller } = setup({ question: "question" });
		controller.setError("provider unavailable", "partial answer");
		const output = controller.render(80).join("\n");
		expect(output).toContain("partial answer");
		expect(output).toContain("Incomplete answer");
		expect(output).toContain("provider unavailable");
		controller.dispose();
	});

	test("Esc is the only advertised close key and every line fits a 64-column terminal", () => {
		const result = setup({ question: "a very long question ".repeat(10), history: [exchange(1), exchange(2)] });
		const lines = result.controller.render(64);
		expect(lines.every((line) => visibleWidth(line) <= 64)).toBe(true);
		result.controller.handleInput("\u001b");
		expect(result.closeCount).toBe(1);
		result.controller.dispose();
	});

	test("strips terminal control sequences from questions and answers", () => {
		const { controller } = setup({ question: "safe\u001b[31m question" });
		controller.setError("bad\u001b[2J error", "partial\u001b[31m answer");
		const output = controller.render(80).join("\n");
		expect(output).not.toContain("\u001b");
		expect(output).toContain("safe question");
		controller.dispose();
	});
});
