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

function tuiHarness(rows?: number): {
	readonly requests: Array<boolean | undefined>;
	readonly tui: TUI;
} {
	const requests: Array<boolean | undefined> = [];
	return {
		requests,
		tui: {
			requestRender: (force?: boolean) => requests.push(force),
			...(rows === undefined ? {} : { terminal: { rows } }),
		} as unknown as TUI,
	};
}

const inventory: WelcomeHeaderInventory = {
	contextFiles: 3,
	extensions: 24,
	skills: 77,
	tools: 30,
};

describe("WelcomeHeaderController", () => {
	test("matches Claude Code's wide two-column and narrow single-column card structures", () => {
		const source = new InventorySource(inventory);
		const controller = new WelcomeHeaderController(context(), {
			enabled: { get: () => true },
			inventory: source,
		});
		const component = controller.createHeader(tuiHarness().tui, theme);

		const wide = component.render(100);
		expect(wide).toHaveLength(11);
		expect(wide[0]).toContain("╭─── Pi Stuff ");
		expect(wide[2]).toContain("Welcome back!");
		expect(wide[1]).toContain("Tips for getting started");
		expect(wide[2]).toContain("Type / to browse commands");
		expect(wide[4]).toContain("Loaded");
		expect(wide[5]).toContain("3 context · 24 extensions");
		expect(wide[6]).toContain("30 tools · 77 skills");
		expect(wide[8]).toContain("gpt-5.6-sol · openai-codex");
		expect(wide[9]).toContain("~/dev/pi-stuff");
		expect(wide[4]).toContain("▐███████▌");
		expect(wide[10]).toContain("╰");

		const narrow = component.render(64);
		expect(narrow).toHaveLength(13);
		expect(narrow[0]).toContain("╭─ Pi Stuff ");
		expect(narrow[2]).toContain("Welcome back!");
		expect(narrow[8]).toContain("gpt-5.6-sol");
		expect(narrow[9]).toContain("openai-codex");
		expect(narrow[10]).toContain("~/dev/pi-stuff");
		expect(narrow[4]).toContain("▐███████▌");
		expect(narrow.join("\n")).not.toMatch(/Loaded|Tips|extensions|tools|skills/iu);

		const minimumNarrow = component.render(48);
		expect(minimumNarrow).toHaveLength(13);
		expect(minimumNarrow[2]).toContain("Welcome back!");
		expect(minimumNarrow[10]).toContain("~/dev/pi-stuff");

		const ultraNarrow = component.render(32);
		expect(ultraNarrow).toHaveLength(13);
		expect(ultraNarrow[2]).toContain("Welcome back!");
		expect(ultraNarrow[8]).toContain("gpt-5.6-sol");
		expect(ultraNarrow.join("\n")).not.toMatch(/Loaded|Tips|Context files|recent|version/iu);
		for (const lines of [wide, narrow, minimumNarrow, ultraNarrow]) {
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(visibleWidth(lines[0] ?? ""));
		}
	});

	test("reduces only blank and provider rows when Pi's editor would push the card off a short screen", () => {
		const controller = new WelcomeHeaderController(context(), {
			enabled: { get: () => true },
			inventory: new InventorySource(inventory),
		});
		const compact = controller.createHeader(tuiHarness(18).tui, theme).render(32);
		expect(compact).toHaveLength(12);
		expect(compact[0]).toContain("╭─ Pi Stuff ");
		expect(compact.join("\n")).toContain("openai-codex");
		expect(compact.at(-1)).toContain("╰");

		const tight = controller.createHeader(tuiHarness(16).tui, theme).render(24);
		expect(tight).toHaveLength(10);
		expect(tight[0]).toContain("╭─ Pi Stuff ");
		expect(tight.join("\n")).toContain("gpt-5.6-sol");
		expect(tight.join("\n")).not.toContain("openai-codex");
		expect(tight.at(-1)).toContain("╰");
	});

	test("keeps the narrow card focused on identity and abbreviates a long CJK path", () => {
		const longCwd = join(homedir(), "项目目录", "很长的中间目录", "验证");
		const controller = new WelcomeHeaderController(context("gpt-5.6-sol", "openai-codex", longCwd), {
			enabled: { get: () => true },
			inventory: new InventorySource(inventory),
		});
		const lines = controller.createHeader(tuiHarness().tui, theme).render(64);
		const path = lines[10] ?? "";
		expect(path).toContain("~/项/很/验证");
		expect(lines.join("\n")).not.toContain("24 extensions");
		expect(visibleWidth(path)).toBeLessThanOrEqual(64);
	});

	test("keeps a hidden intermediate directory identifiable when abbreviating a narrow path", () => {
		const hiddenCwd = join(homedir(), "dev", "pi-stuff", ".artifacts", "dogfood-0.2.2");
		const controller = new WelcomeHeaderController(context("gpt-5.6-sol", "openai-codex", hiddenCwd), {
			enabled: { get: () => true },
			inventory: new InventorySource(inventory),
		});
		const orientation = controller.createHeader(tuiHarness().tui, theme).render(48)[10] ?? "";
		expect(orientation).toContain("~/d/p/.a/dogfoo");
		expect(orientation).not.toContain("/./");
		expect(visibleWidth(orientation)).toBeLessThanOrEqual(48);
	});

	test("reserves the right column before clipping long Unicode identity fields", () => {
		const longModel = `model-🧪-${"超长模型".repeat(18)}`;
		const longCwd = join(homedir(), ...Array.from({ length: 12 }, () => "非常长的🙂工作区"));
		const largeInventory = {
			contextFiles: 1234,
			extensions: 5678,
			skills: 9012,
			tools: 3456,
		};
		const controller = new WelcomeHeaderController(context(longModel, "provider-非常长", longCwd), {
			enabled: { get: () => true },
			inventory: new InventorySource(largeInventory),
		});
		const component = controller.createHeader(tuiHarness().tui, theme);

		const wide = component.render(100);
		expect(wide[1]).toContain("Tips for getting started");
		expect(wide[4]).toContain("Loaded");
		expect(wide[5]).toContain("1234 context");
		expect(wide[6]).toContain("3456 tools");
		for (const line of wide) expect(visibleWidth(line)).toBeLessThanOrEqual(100);

		const narrow = component.render(88);
		expect(narrow[4]).toContain("Loaded");
		expect(narrow[5]).toContain("1234 context");
		for (const line of narrow) expect(visibleWidth(line)).toBeLessThanOrEqual(88);
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
		expect(component.render(100).join("\n")).toContain("5 context · 24 extensions");
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
				{
					name: "skill:review",
					source: "skill",
					sourceInfo: sourceInfo("/skills/review/SKILL.md", "skill"),
				},
				{
					name: "skill:review",
					source: "skill",
					sourceInfo: sourceInfo("/skills/review/SKILL.md", "skill"),
				},
				{
					name: "agents",
					source: "extension",
					sourceInfo: sourceInfo("/extensions/a.ts", "package:a"),
				},
				{
					name: "btw",
					source: "extension",
					sourceInfo: sourceInfo("/extensions/b.ts", "package:b"),
				},
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
