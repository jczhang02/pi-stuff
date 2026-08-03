import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import {
	readWelcomeRegistryInventory,
	WelcomeHeaderController,
	type WelcomeHeaderInventory,
	type WelcomeHeaderInventorySource,
	WelcomeRegistrySource,
} from "../../packages/pi-stuff-ui/welcome-header.js";

class InventorySource implements WelcomeHeaderInventorySource {
	private readonly listeners = new Set<() => void>();
	private value: WelcomeHeaderInventory;

	constructor(value: WelcomeHeaderInventory) {
		this.value = value;
	}

	get(): WelcomeHeaderInventory {
		return this.value;
	}

	set(value: WelcomeHeaderInventory): void {
		this.value = value;
		for (const listener of this.listeners) listener();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

function context(modelId = "gpt-5.6-sol", provider = "openai-codex", cwd = join(homedir(), "dev", "pi-stuff")) {
	return {
		cwd,
		model: { id: modelId, provider },
		sessionManager: { getCwd: () => cwd },
	} as unknown as ExtensionContext;
}

const theme = {
	bold: (text: string) => text,
	fg: (_color: string, text: string) => text,
} as unknown as Theme;

function tuiHarness(): { readonly requests: Array<boolean | undefined>; readonly tui: TUI } {
	const requests: Array<boolean | undefined> = [];
	return {
		requests,
		tui: { requestRender: (force?: boolean) => requests.push(force) } as unknown as TUI,
	};
}

const inventory: WelcomeHeaderInventory = { contextFiles: 3, extensions: 24, skills: 77, tools: 30 };

describe("WelcomeHeaderController", () => {
	test("matches the accepted wide, narrow, and identity-only responsive structures", () => {
		const source = new InventorySource(inventory);
		const controller = new WelcomeHeaderController(context(), {
			enabled: { get: () => true },
			inventory: source,
		});
		const component = controller.createHeader(tuiHarness().tui, theme);

		const wide = component.render(100);
		expect(wide).toHaveLength(6);
		expect(wide[1]).toContain("π  Welcome back!");
		expect(wide[1]).toContain("Loaded");
		expect(wide[2]).toContain("gpt-5.6-sol · openai-codex");
		expect(wide[2]).toContain("Context files 3 · Extensions 24 · Tools 30 · Skills 77");
		expect(wide[3]).toContain("~/dev/pi-stuff");
		expect(wide[4]).toContain("/tools details · /ui appearance · Shift+Tab thinking");

		const narrow = component.render(64);
		expect(narrow).toHaveLength(5);
		expect(narrow[1]).toContain("π Welcome back! · gpt-5.6-sol · openai-codex");
		expect(narrow[2]).toContain("~/dev/pi-stuff · 3 context · 24 ext · 30 tools · 77 skills");
		expect(narrow[3]).toContain("/tools details · /ui appearance · Shift+Tab thinking");

		const ultraNarrow = component.render(32);
		expect(ultraNarrow).toHaveLength(3);
		expect(ultraNarrow[1]).toContain("π Welcome back!");
		expect(ultraNarrow.join("\n")).not.toMatch(/Loaded|Tips|Context files|recent|version/iu);
		for (const lines of [wide, narrow, ultraNarrow]) {
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(visibleWidth(lines[0] ?? ""));
		}
	});

	test("keeps every inventory count beside an abbreviated long CJK path at 64 columns", () => {
		const longCwd = join(homedir(), "项目目录", "很长的中间目录", "验证");
		const controller = new WelcomeHeaderController(context("gpt-5.6-sol", "openai-codex", longCwd), {
			enabled: { get: () => true },
			inventory: new InventorySource(inventory),
		});
		const lines = controller.createHeader(tuiHarness().tui, theme).render(64);
		const orientation = lines[2] ?? "";
		expect(orientation).toContain("~/项/很/验证");
		expect(orientation).toContain("3 context · 24 ext · 30 tools · 77 skills");
		expect(visibleWidth(orientation)).toBeLessThanOrEqual(64);
	});

	test("captures enablement for the launch but repaints live inventory changes", () => {
		let enabled = false;
		const source = new InventorySource(inventory);
		const disabledController = new WelcomeHeaderController(context(), {
			enabled: { get: () => enabled },
			inventory: source,
		});
		enabled = true;
		expect(disabledController.enabledAtLaunch).toBe(false);
		expect(disabledController.createHeader(tuiHarness().tui, theme).render(100)).toEqual([]);

		const harness = tuiHarness();
		const controller = new WelcomeHeaderController(context(), {
			enabled: { get: () => true },
			inventory: source,
		});
		const component = controller.createHeader(harness.tui, theme);
		source.set({ ...inventory, contextFiles: 5 });
		expect(harness.requests).toHaveLength(1);
		expect(component.render(100).join("\n")).toContain("Context files 5");
		component.dispose();
		source.set({ ...inventory, contextFiles: 6 });
		expect(harness.requests).toHaveLength(1);
	});

	test("isolates recoverable repaint and unsubscribe failures", () => {
		let listener: (() => void) | undefined;
		const source: WelcomeHeaderInventorySource = {
			get: () => inventory,
			subscribe: (observer) => {
				listener = observer;
				return () => {
					throw new Error("Welcome unsubscribe failed");
				};
			},
		};
		const controller = new WelcomeHeaderController(context(), {
			enabled: { get: () => true },
			inventory: source,
		});
		const component = controller.createHeader(
			{
				requestRender: () => {
					throw new Error("Welcome repaint failed");
				},
			} as unknown as TUI,
			theme,
		);

		expect(() => listener?.()).not.toThrow();
		expect(() => component.dispose()).not.toThrow();
	});

	test("strips terminal and bidi controls from model, provider, and cwd", () => {
		const injected = "前\u001b]0;OWNED_TITLE\u0007后\u009b31m红\u202eABC";
		const controller = new WelcomeHeaderController(context(injected, injected, join(homedir(), injected)), {
			enabled: { get: () => true },
			inventory: new InventorySource(inventory),
		});
		const lines = controller.createHeader(tuiHarness().tui, theme).render(64);
		const rendered = lines.join("\n");
		expect(rendered).not.toContain("OWNED_TITLE");
		expect(rendered).not.toContain("\u001b");
		expect(rendered).not.toContain("\u009b");
		expect(rendered).not.toContain("\u202e");
		expect(rendered).toContain("前后红");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(64);
	});
});

describe("readWelcomeRegistryInventory", () => {
	test("counts exact public tools and skills and deduplicates registry-visible extension sources", () => {
		const sourceInfo = (path: string, source: string) => ({
			origin: "top-level" as const,
			path,
			scope: "user" as const,
			source,
		});
		const pi = {
			getAllTools: () => [
				{ sourceInfo: sourceInfo("<builtin:read>", "builtin") },
				{ sourceInfo: sourceInfo("/extensions/a.ts", "package:a") },
				{ sourceInfo: sourceInfo("/extensions/c.ts", "package:c") },
			],
			getCommands: () => [
				{ name: "skill:review", source: "skill", sourceInfo: sourceInfo("/skills/review/SKILL.md", "skill") },
				{ name: "skill:review", source: "skill", sourceInfo: sourceInfo("/skills/review/SKILL.md", "skill") },
				{ name: "agents", source: "extension", sourceInfo: sourceInfo("/extensions/a.ts", "package:a") },
				{ name: "btw", source: "extension", sourceInfo: sourceInfo("/extensions/b.ts", "package:b") },
			],
		} as unknown as Pick<ExtensionAPI, "getAllTools" | "getCommands">;

		expect(readWelcomeRegistryInventory(pi, 3)).toEqual({
			contextFiles: 3,
			extensions: 3,
			skills: 1,
			tools: 3,
		});
	});

	test("isolates registry-source observers so later listeners still run", () => {
		let toolCount = 1;
		const pi = {
			getAllTools: () =>
				Array.from({ length: toolCount }, (_, index) => ({
					sourceInfo: {
						origin: "top-level" as const,
						path: `<builtin:${String(index)}>`,
						scope: "user" as const,
						source: "builtin",
					},
				})),
			getCommands: () => [],
		} as unknown as ExtensionAPI;
		const source = new WelcomeRegistrySource(pi);
		let healthyNotifications = 0;
		source.subscribe(() => {
			throw new Error("Welcome observer failed");
		});
		source.subscribe(() => {
			healthyNotifications += 1;
		});

		toolCount = 2;
		expect(() => source.refresh()).not.toThrow();
		expect(healthyNotifications).toBe(1);
		expect(source.get().tools).toBe(2);
	});
});
