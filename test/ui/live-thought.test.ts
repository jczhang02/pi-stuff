import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	createLiveThoughtTransformer,
	registerLiveThoughtDisplay,
	type ThoughtMarkdownTransformContext,
	type ThoughtMarkdownTransformer,
} from "../../packages/pi-stuff-ui/live-thought.js";

const CONTEXT: ThoughtMarkdownTransformContext = {
	availableWidth: 80,
	isStreaming: true,
	messageType: "assistant-thinking",
};

function transform(markdown: string, overrides: Partial<ThoughtMarkdownTransformContext> = {}): string {
	return createLiveThoughtTransformer()(markdown, { ...CONTEXT, ...overrides });
}

function visibleMarkdown(markdown: string): string {
	return markdown.replaceAll(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

describe("live Thought display", () => {
	test("leaves user and assistant Markdown byte-for-byte unchanged", () => {
		const markdown = "# Keep **all** model content\n\nincluding CJK 内容";
		expect(transform(markdown, { messageType: "user" })).toBe(markdown);
		expect(transform(markdown, { messageType: "assistant" })).toBe(markdown);
	});

	test("projects the newest meaningful live fragment onto one row", () => {
		const transformer = createLiveThoughtTransformer();
		const first = transformer("Inspecting the repository", CONTEXT);
		const next = transformer("Inspecting the repository. 正在运行真实测试", CONTEXT);

		expect(visibleMarkdown(first)).toBe("✻ thoughts: Inspecting the repository");
		expect(visibleMarkdown(next)).toBe("✻ thoughts: 正在运行真实测试");
		expect(next).not.toContain("\n");
	});

	test("retains the final meaningful fragment after streaming settles", () => {
		const markdown = "First possibility was rejected. 最后选择公开 Host seam。";
		const live = transform(markdown);
		const settled = transform(markdown, { isStreaming: false });

		expect(visibleMarkdown(settled)).toBe("✻ thoughts: 最后选择公开 Host seam。");
		expect(settled).toBe(live);
	});

	test("fits CJK and emoji by terminal columns while preserving the newest tail", () => {
		const rendered = transform("旧步骤完成。正在检查中文🧪结果", { availableWidth: 24 });
		const visible = visibleMarkdown(rendered);

		expect(visibleWidth(visible)).toBeLessThanOrEqual(24);
		expect(visible).toStartWith("✻ thoughts: …");
		expect(visible).toEndWith("结果");
	});

	test("reduces the label before allowing narrow-terminal wrapping", () => {
		for (const width of [1, 2, 4, 8, 11, 12, 13, 14]) {
			const visible = visibleMarkdown(transform("检查完成", { availableWidth: width }));
			expect(visible).not.toContain("\n");
			expect(visibleWidth(visible)).toBeLessThanOrEqual(width);
			expect(visible).toStartWith("✻");
			if (width >= 4) expect(visible).toMatch(/[检查完成]/u);
		}
		expect(transform("检查完成", { availableWidth: 0 })).toBe("");
		expect(transform("检查完成", { availableWidth: Number.NaN })).toBe("");
	});

	test("removes terminal protocols and direction controls without damaging CJK", () => {
		const rendered = transform("Old. \u001b]0;forged title\u0007最新\u001b[31m红色\u001b[0m\u202efragment");
		const visible = visibleMarkdown(rendered);

		expect(visible).toBe("✻ thoughts: 最新红色 fragment");
		expect(rendered).not.toContain(String.fromCharCode(0x1b));
		expect(rendered).not.toContain(String.fromCharCode(0x07));
		expect(rendered).not.toContain(String.fromCodePoint(0x202e));
		expect(rendered).not.toContain("forged title");
	});

	test("escapes model-provided Markdown so it remains literal and one-line", () => {
		const rendered = transform("Old. **Use [x](url), <tag> & `code`**");

		expect(visibleMarkdown(rendered)).toBe("✻ thoughts: **Use [x](url), <tag> & `code`**");
		expect(rendered).toContain("\\*\\*Use");
		expect(rendered).not.toContain("\n");
	});

	test("does not invent a fragment for blank or control-only Thinking", () => {
		expect(transform(" \n\t ")).toBe("");
		expect(transform("\u001b[31m\u001b[0m\u202e")).toBe("");
	});
});

describe("live Thought Host adapter", () => {
	test("registers through the upstream public seam", () => {
		let registered: ThoughtMarkdownTransformer | undefined;
		const api = {
			registerMarkdownTransformer: (transformer: ThoughtMarkdownTransformer) => {
				registered = transformer;
			},
		} as unknown as ExtensionAPI;

		registerLiveThoughtDisplay(api);
		expect(registered).toBeDefined();
		expect(visibleMarkdown(registered?.("Checking. Ready", CONTEXT) ?? "")).toBe("✻ thoughts: Ready");
	});

	test("fails clearly when the Host cannot provide the accepted projection", () => {
		const api = {} as ExtensionAPI;
		expect(() => registerLiveThoughtDisplay(api)).toThrow("registerMarkdownTransformer() support");
	});
});
