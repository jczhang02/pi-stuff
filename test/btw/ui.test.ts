import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { BtwExchange } from "../../packages/pi-stuff/src/btw/btw-history.js";
import { BtwDialogController } from "../../packages/pi-stuff/src/btw/btw-ui.js";

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
		onFork?: (exchange: BtwExchange, signal: AbortSignal) => Promise<void>;
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
		onFork: options.onFork ?? (async () => {}),
		...(options.copyText === undefined ? {} : { copyText: options.copyText }),
	});
	return {
		controller,
		clearCalls,
		terminal: tui.terminal,
		get closeCount() {
			return closeCount;
		},
		get renderCount() {
			return renderCount;
		},
	};
}

describe("BTW Command Dialog", () => {
	test("renders only the command, native Answering spinner, and contextual hint", () => {
		const { controller } = setup({ question: "Why keep this isolated?" });
		const output = controller.render(100).join("\n");

		expect(output).toContain("/btw Why keep this isolated?");
		expect(output).toContain("Answering…");
		expect(output).toContain("Esc cancel");
		for (const redundant of [
			"side question · main task continues",
			"single exchange",
			"\n  Question",
			"\n  Answer",
		]) {
			expect(output).not.toContain(redundant);
		}
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
		expect(output).toContain("Esc close");
		expect(copied).toEqual(["**final answer**"]);
		controller.dispose();
	});

	test("keeps all history navigable while rendering only a compact five-question window", () => {
		const history = Array.from({ length: 10 }, (_, index) => exchange(index));
		const result = setup({ question: "current question", history });
		const newest = result.controller.render(100).join("\n");
		expect(newest).not.toContain("earlier question 5");
		expect(newest).toContain("earlier question 6");
		expect(newest).toContain("/btw current question");

		for (let index = 0; index < 10; index++) result.controller.handleInput("\u001b[D");
		const oldest = result.controller.render(100).join("\n");
		expect(oldest).toContain("/btw earlier question 0");
		expect(oldest).toContain("earlier answer 0");
		result.controller.dispose();
	});

	test("clears siblings but never discards the in-flight current exchange", () => {
		const result = setup({ question: "current question", history: [exchange(1), exchange(2)] });
		result.controller.handleInput("\u001b[D");
		result.controller.handleInput("x");
		expect(result.clearCalls).toEqual([]);
		expect(result.controller.render(80).join("\n")).toContain("Clear earlier BTW history?");
		result.controller.handleInput("y");
		result.controller.setSuccess({
			id: "current",
			question: "current question",
			answer: "current answer",
			timestamp: 3,
			contextTrimmed: false,
		});
		const output = result.controller.render(80).join("\n");
		expect(result.clearCalls).toEqual([undefined]);
		expect(output).toContain("/btw current question");
		expect(output).toContain("current answer");
		expect(output).not.toContain("earlier question");
		result.controller.dispose();
	});

	test("retains the selected successful exchange when clearing history", () => {
		const result = setup({ history: [exchange(1), exchange(2)] });
		result.controller.handleInput("\u001b[D");
		result.controller.handleInput("x");
		expect(result.clearCalls).toEqual([]);
		result.controller.handleInput("\u001b");
		expect(result.clearCalls).toEqual([]);
		expect(result.controller.render(80).join("\n")).not.toContain("Clear earlier BTW history?");
		result.controller.handleInput("x");
		result.controller.handleInput("y");
		expect(result.clearCalls).toEqual(["exchange-1"]);
		const output = result.controller.render(80).join("\n");
		expect(output).toContain("/btw earlier question 1");
		expect(output).toContain("earlier answer 1");
		expect(output).toContain("Cleared BTW history");
		result.controller.dispose();
	});

	test("promotes only a completed selected exchange and aborts a pending promotion on close", async () => {
		const promoted: BtwExchange[] = [];
		let promotionSignal: AbortSignal | undefined;
		const result = setup({
			history: [exchange(1)],
			onFork: async (selected, signal) => {
				promoted.push(selected);
				promotionSignal = signal;
				await new Promise<void>(() => {});
			},
		});
		result.controller.handleInput("f");
		await Promise.resolve();
		expect(promoted.map((item) => item.id)).toEqual(["exchange-1"]);
		const waiting = result.controller.render(80).join("\n");
		expect(waiting).toContain("Waiting for the main Agent to finish");
		expect(waiting).toContain("Esc close");
		result.controller.handleInput("\u001b");
		result.controller.dispose();
		expect(result.closeCount).toBe(1);
		expect(promotionSignal?.aborted).toBe(true);
	});

	test("accepts Kitty keyboard encoding for copy, fork, and clear", async () => {
		const copied: string[] = [];
		const promoted: string[] = [];
		const result = setup({
			history: [exchange(1), exchange(2)],
			copyText: async (text) => {
				copied.push(text);
			},
			onFork: async (selected) => {
				promoted.push(selected.id);
			},
		});
		result.controller.handleInput("\u001b[99u");
		result.controller.handleInput("\u001b[102u");
		await Promise.resolve();
		expect(copied).toEqual(["earlier answer 2"]);
		expect(promoted).toEqual(["exchange-2"]);

		result.controller.handleInput("\u001b[120u");
		expect(result.clearCalls).toEqual([]);
		result.controller.handleInput("\u001b[121u");
		expect(result.clearCalls).toEqual(["exchange-2"]);
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

	test("keeps the selected question, error, and Escape reachable at very low height", () => {
		const result = setup({ question: "question", history: [exchange(1)] });
		result.controller.setError("provider unavailable", "partial answer");
		result.terminal.rows = 6;
		const lines = result.controller.render(64);
		expect(lines).toHaveLength(3);
		expect(lines.join("\n")).toContain("/btw question");
		expect(lines.join("\n")).toContain("provider unavailable");
		expect(lines.at(-1)).toContain("Esc close");
		result.controller.dispose();
	});

	test("Space, Enter, and Esc match Claude by cancelling the pending Answering surface", () => {
		for (const key of [" ", "\r", "\u001b"]) {
			const result = setup({
				question: "a very long question ".repeat(10),
				history: [exchange(1), exchange(2)],
			});
			const lines = result.controller.render(64);
			expect(lines.every((line) => visibleWidth(line) <= 64)).toBe(true);
			result.controller.handleInput(key);
			expect(result.closeCount).toBe(1);
			result.controller.dispose();
		}
	});

	test("strips ESC and C1 terminal protocols plus bidi controls from every rendered field", () => {
		const { controller } = setup({
			question: "safe\u001b[31m question\u001b]0;hidden-title\u0007 after\u009b32m 中文\u202e end",
		});
		controller.setError(
			"bad\u001bXhidden-sos\u001b\\ error\u0090hidden-c1-dcs\u009c tail",
			"partial\u001bPhidden-dcs\u0007hidden-dcs-after-bell\u001b\\ answer\u009d0;hidden-c1-osc\u0007 kept\u2066 text",
		);
		const output = controller.render(80).join("\n");
		for (const control of ["\u001b", "\u0090", "\u009b", "\u009c", "\u009d", "\u202e", "\u2066"]) {
			expect(output).not.toContain(control);
		}
		for (const hidden of [
			"hidden-title",
			"hidden-sos",
			"hidden-c1-dcs",
			"hidden-dcs",
			"hidden-dcs-after-bell",
			"hidden-c1-osc",
		]) {
			expect(output).not.toContain(hidden);
		}
		expect(output).toContain("safe question after 中文 end");
		expect(output).toContain("partial answer kept  text");
		expect(output).toContain("bad error tail");
		controller.dispose();
	});
});
