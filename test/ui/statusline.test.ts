import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	SessionEntry,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import {
	type BooleanValueSource,
	type CodexStatusSnapshot,
	type CodexStatusSource,
	type GitChangeCounts,
	GitStatusSource,
	parseGitStatusPorcelain,
	StatuslineController,
	type StatuslinePreferences,
} from "../../packages/pi-stuff-ui/statusline.js";

class ValueSource<Value> {
	private readonly listeners = new Set<() => void>();
	private value: Value;

	constructor(value: Value) {
		this.value = value;
	}

	get(): Value {
		return this.value;
	}

	set(value: Value): void {
		this.value = value;
		for (const listener of this.listeners) listener();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

class CodexStatusValueSource implements CodexStatusSource {
	private readonly listeners = new Set<() => void>();
	private snapshot: CodexStatusSnapshot;

	constructor(snapshot: CodexStatusSnapshot) {
		this.snapshot = snapshot;
	}

	getSnapshot(): CodexStatusSnapshot {
		return this.snapshot;
	}

	set(snapshot: CodexStatusSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

function usage(cacheRead: number, cost: number, input = 10, cacheWrite = 0) {
	return {
		cacheRead,
		cacheWrite,
		cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: cost },
		input,
		output: 5,
		totalTokens: input + 5 + cacheRead + cacheWrite,
	};
}

function messageEntries(prompt: string, cacheRead = 18_200, cost = 0.42, input = 10, cacheWrite = 0): SessionEntry[] {
	return [
		{
			id: "user",
			message: { content: prompt, role: "user", timestamp: 1 },
			parentId: null,
			timestamp: "2026-08-03T00:00:00Z",
			type: "message",
		},
		{
			id: "assistant",
			message: {
				api: "anthropic-messages",
				content: [],
				model: "sonnet-4.5",
				provider: "anthropic",
				role: "assistant",
				stopReason: "stop",
				timestamp: 2,
				usage: usage(cacheRead, cost, input, cacheWrite),
			},
			parentId: "user",
			timestamp: "2026-08-03T00:00:01Z",
			type: "message",
		},
	] as SessionEntry[];
}

function model(metered: boolean, id = "sonnet-4.5", provider = "anthropic", name = id, reasoning = true) {
	const rate = metered ? 3 : 0;
	return {
		api: "anthropic-messages",
		baseUrl: "https://example.invalid",
		contextWindow: 200_000,
		cost: { cacheRead: rate, cacheWrite: rate, input: rate, output: rate },
		id,
		input: ["text"],
		maxTokens: 8_192,
		name,
		provider,
		reasoning,
	};
}

function context(options: {
	branch?: SessionEntry[];
	contextPercent?: number | null;
	contextWindow?: number | null;
	cwd?: string;
	metered?: boolean;
	modelId?: string;
	modelName?: string;
	provider?: string;
	reasoning?: boolean;
	sessionManager?: ExtensionContext["sessionManager"];
	subscription?: boolean;
}): ExtensionContext {
	const cwd = options.cwd ?? join(homedir(), "dev", "pi-stuff");
	const branch = options.branch ?? messageEntries("Implement the accepted Pi Stuff statusline.");
	const entriesById = new Map(branch.map((entry) => [entry.id, entry]));
	const sessionManager =
		options.sessionManager ??
		({
			getBranch: () => branch,
			getCwd: () => cwd,
			getEntry: (id: string) => entriesById.get(id),
			getLeafId: () => branch.at(-1)?.id ?? null,
			getSessionId: () => "statusline-test-session",
		} as unknown as ExtensionContext["sessionManager"]);
	return {
		cwd,
		getContextUsage: () => ({
			contextWindow: "contextWindow" in options ? options.contextWindow : 200_000,
			percent: "contextPercent" in options ? options.contextPercent : 42.4,
			tokens: 84_800,
		}),
		model: model(options.metered ?? true, options.modelId, options.provider, options.modelName, options.reasoning),
		modelRegistry: { isUsingOAuth: () => options.subscription === true },
		sessionManager,
		thinkingLevel: "medium",
	} as unknown as ExtensionContext;
}

function turnEntries(
	prefix: string,
	prompt: string,
	parentId: string | null,
	cacheRead: number,
	cost: number,
): [SessionEntry, SessionEntry] {
	const entries = messageEntries(prompt, cacheRead, cost);
	const user = entries[0];
	const assistant = entries[1];
	if (!user || !assistant) throw new Error("Expected a complete test turn");
	user.id = `${prefix}-user`;
	user.parentId = parentId;
	assistant.id = `${prefix}-assistant`;
	assistant.parentId = user.id;
	return [user, assistant];
}

function trackedSession(
	entries: SessionEntry[],
	initialLeafId: string,
): {
	readonly manager: ExtensionContext["sessionManager"];
	readonly reads: { branches: number; entries: number };
	setLeaf(id: string): void;
} {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	let leafId = initialLeafId;
	const reads = { branches: 0, entries: 0 };
	const manager = {
		getBranch: () => {
			reads.branches += 1;
			const branch: SessionEntry[] = [];
			let entry = byId.get(leafId);
			while (entry) {
				branch.push(entry);
				entry = entry.parentId ? byId.get(entry.parentId) : undefined;
			}
			return branch.reverse();
		},
		getCwd: () => join(homedir(), "dev", "pi-stuff"),
		getEntry: (id: string) => {
			reads.entries += 1;
			return byId.get(id);
		},
		getLeafId: () => leafId,
		getSessionId: () => "tracked-statusline-session",
	} as unknown as ExtensionContext["sessionManager"];
	return {
		manager,
		reads,
		setLeaf: (id: string) => {
			if (!byId.has(id)) throw new Error(`Unknown test leaf: ${id}`);
			leafId = id;
		},
	};
}

function footerData(branch: string, statuses = new Map<string, string>()): ReadonlyFooterDataProvider {
	return {
		getAvailableProviderCount: () => 1,
		getExtensionStatuses: () => statuses,
		getGitBranch: () => branch,
		onBranchChange: () => () => {},
	};
}

function api(thinking = "medium", skillNames: readonly string[] = []): ExtensionAPI {
	return {
		getCommands: () =>
			skillNames.map((name) => ({
				description: `${name} skill`,
				name: `skill:${name}`,
				source: "skill",
				sourceInfo: { origin: "top-level", path: `${name}/SKILL.md`, scope: "user", source: "fixture" },
			})),
		getThinkingLevel: () => thinking,
	} as unknown as ExtensionAPI;
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

function withNerdFontPreference<Value>(enabled: boolean, run: () => Value): Value {
	const environment = process.env;
	const { POWERLINE_NERD_FONTS: previous } = environment;
	Reflect.set(environment, "POWERLINE_NERD_FONTS", enabled ? "1" : "0");
	try {
		return run();
	} finally {
		if (previous === undefined) Reflect.deleteProperty(environment, "POWERLINE_NERD_FONTS");
		else Reflect.set(environment, "POWERLINE_NERD_FONTS", previous);
	}
}

function preferences(overrides: Partial<StatuslinePreferences> = {}): ValueSource<StatuslinePreferences> {
	return new ValueSource({
		density: "auto",
		enabled: true,
		iconMode: "auto",
		latestPrompt: true,
		...overrides,
	});
}

describe("StatuslineController", () => {
	test("renders cache hit rate and observed Codex weekly and Fast state", () => {
		const codexStatus = new CodexStatusValueSource({ fastEnabled: true, weeklyRemainingPercent: 63.4 });
		const controller = new StatuslineController(api(), {
			codexStatus,
			enabled: new ValueSource(true),
		});
		const harness = tuiHarness();
		const component = controller.createFooter(
			context({ provider: "openai-codex", subscription: true }),
			harness.tui,
			theme,
			footerData("main"),
		);

		const active = withNerdFontPreference(false, () => component.render(160).join("\n"));
		expect(active).toContain("cache 99.9%");
		expect(active).toContain("weekly 63%");
		expect(active).toContain("fast");
		expect(active).not.toContain("18k");
		expect(active).not.toContain("$0.42");

		const rendersBeforeUpdate = harness.requests.length;
		codexStatus.set({ fastEnabled: false, weeklyRemainingPercent: 62.6 });
		const inactive = withNerdFontPreference(false, () => component.render(160).join("\n"));
		expect(inactive).toContain("weekly 63%");
		expect(inactive).not.toContain("fast");
		expect(harness.requests.length).toBeGreaterThan(rendersBeforeUpdate);
	});

	test("includes input and cache writes in the cache hit denominator", () => {
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ branch: messageEntries("Cache denominator", 60, 0, 20, 20), reasoning: false }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		expect(withNerdFontPreference(false, () => component.render(120).join("\n"))).toContain("cache 60%");
	});

	test("hides Codex weekly, Fast, and cost when no observer data exists", () => {
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ provider: "openai-codex", subscription: false }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		const rendered = component.render(160).join("\n");
		expect(rendered).not.toContain("weekly");
		expect(rendered).not.toContain("fast");
		expect(rendered).not.toContain("$");
	});

	test("preserves the old footer visual grammar with the accepted Pi Stuff deviations", () => {
		withNerdFontPreference(false, () => {
			const enabled = new ValueSource(true);
			const git = new ValueSource<GitChangeCounts | undefined>({ staged: 12, unstaged: 3, untracked: 1 });
			const controller = new StatuslineController(api(), { enabled, gitChanges: git });
			const { tui } = tuiHarness();
			const component = controller.createFooter(
				context({ modelName: "Claude Sonnet 4.5" }),
				tui,
				theme,
				footerData(
					"main",
					new Map([
						["codex-goal", "goal:UI"],
						["mcp", "mcp:2"],
						["loadout", "load:full"],
						["agents", "agents:3"],
					]),
				),
			);

			expect(component.render(160)).toEqual([
				" Sonnet 4.5 | think:med | dir pi-stuff | ⎇ main *3 +12 ?1 | ◫ 42.4%/200k | cache 99.9% | $0.42 ",
				" in: Implement the accepted Pi Stuff statusline. ",
			]);
		});
	});

	test("uses the old Nerd Font icon grammar without changing the layout", () => {
		withNerdFontPreference(true, () => {
			const git = new ValueSource<GitChangeCounts | undefined>({ staged: 12, unstaged: 3, untracked: 1 });
			const controller = new StatuslineController(api(), { enabled: new ValueSource(true), gitChanges: git });
			const component = controller.createFooter(
				context({ modelName: "Claude Sonnet 4.5" }),
				tuiHarness().tui,
				theme,
				footerData(
					"main",
					new Map([
						["goal", "goal:UI"],
						["mcp", "mcp:2"],
						["loadout", "load:full"],
					]),
				),
			);

			expect(component.render(160)).toEqual([
				"  Sonnet 4.5 | think:med |  pi-stuff |  main *3 +12 ?1 |  42.4%/200k |  99.9% | $0.42 ",
				"  Implement the accepted Pi Stuff statusline. ",
			]);
		});
	});

	test("applies density, prompt, and icon preferences immediately", () => {
		withNerdFontPreference(false, () => {
			const preferenceSource = preferences({ density: "compact", iconMode: "nerd", latestPrompt: false });
			const controller = new StatuslineController(api(), { preferences: preferenceSource });
			const harness = tuiHarness();
			const component = controller.createFooter(
				context({}),
				harness.tui,
				theme,
				footerData("main", new Map([["goal", "goal:UI"]])),
			);

			const compact = component.render(160).join("\n");
			expect(compact).toContain(" sonnet-4.5");
			expect(compact).not.toContain("Implement the accepted");
			expect(compact).not.toContain("cache");
			expect(compact).not.toContain("$0.42");
			expect(compact).not.toContain("goal:UI");

			preferenceSource.set({ density: "full", enabled: true, iconMode: "ascii", latestPrompt: true });
			const full = component.render(160).join("\n");
			expect(full).toContain("dir pi-stuff");
			expect(full).toContain("in: Implement the accepted Pi Stuff statusline.");
			expect(full).toContain("cache 99.9%");
			expect(full).not.toContain("goal:UI");
			expect(harness.requests.length).toBeGreaterThan(0);
		});
	});

	test("shows Git conflicts and upstream divergence without another probe", () => {
		withNerdFontPreference(false, () => {
			const git = new ValueSource<GitChangeCounts | undefined>({
				ahead: 2,
				behind: 1,
				conflicted: 2,
				staged: 1,
				unstaged: 0,
				untracked: 0,
			});
			const controller = new StatuslineController(api(), { enabled: new ValueSource(true), gitChanges: git });
			const component = controller.createFooter(context({}), tuiHarness().tui, theme, footerData("main"));
			const rendered = component.render(160).join("\n");

			expect(rendered).toContain("⎇ main !conflict:2 +1 ⇡2 ⇣1");
		});
	});

	test("maps the old semantic roles onto Pi theme tokens", () => {
		withNerdFontPreference(false, () => {
			const colored = new Map<string, string[]>();
			const recordingTheme = {
				bold: (text: string) => text,
				fg: (color: string, text: string) => {
					const values = colored.get(color) ?? [];
					values.push(text);
					colored.set(color, values);
					return text;
				},
			} as unknown as Theme;
			const git = new ValueSource<GitChangeCounts | undefined>({ staged: 12, unstaged: 3, untracked: 1 });
			const controller = new StatuslineController(api(), { enabled: new ValueSource(true), gitChanges: git });
			const component = controller.createFooter(
				context({ modelName: "Claude Sonnet 4.5" }),
				tuiHarness().tui,
				recordingTheme,
				footerData("main", new Map([["goal", "goal:UI"]])),
			);

			component.render(160);
			expect(colored.get("customMessageLabel")).toContain("Sonnet 4.5");
			expect(colored.get("thinkingMedium")).toContain("think:med");
			expect(colored.get("accent")).toContain("dir pi-stuff");
			expect(colored.get("warning")).toEqual(expect.arrayContaining(["⎇ main", "*3"]));
			expect(colored.get("success")).toContain("+12");
			expect(colored.get("dim")).toEqual(expect.arrayContaining(["◫ 42.4%/200k", "|"]));
			expect(colored.get("muted")).toEqual(expect.arrayContaining(["?1", "cache 99.9%"]));
			expect([...colored.values()].flat()).not.toContain("goal:UI");
			expect(colored.get("text")).toEqual(
				expect.arrayContaining(["$0.42", "Implement the accepted Pi Stuff statusline."]),
			);
		});
	});

	test("flows complete segments at narrow widths instead of truncating the status row", () => {
		withNerdFontPreference(false, () => {
			const git = new ValueSource<GitChangeCounts | undefined>({ staged: 12, unstaged: 3, untracked: 1 });
			const controller = new StatuslineController(api(), { enabled: new ValueSource(true), gitChanges: git });
			const component = controller.createFooter(
				context({}),
				tuiHarness().tui,
				theme,
				footerData(
					"main",
					new Map([
						["goal", "goal:UI"],
						["mcp", "mcp:2"],
						["loadout", "load:full"],
					]),
				),
			);

			const lines = component.render(64);
			const rendered = lines.join("\n");
			expect(rendered).toContain("sonnet-4.5");
			expect(rendered).toMatch(/◫ 42(?:\.4)?%/u);
			expect(rendered).toContain("⎇ main *3 +12 ?1");
			expect(rendered).not.toContain("AC");
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(64);
		});
	});

	test("renders an explicit unknown Context while hiding zero-value optional segments", () => {
		withNerdFontPreference(false, () => {
			const controller = new StatuslineController(api("off"), { enabled: new ValueSource(true) });
			const component = controller.createFooter(
				context({
					branch: messageEntries("Optional fields are absent.", 0, 0, 0, 0),
					contextPercent: null,
					reasoning: false,
				}),
				tuiHarness().tui,
				theme,
				footerData("main"),
			);
			const rendered = component.render(160).join("\n");
			expect(rendered).not.toContain("think:");
			expect(rendered).toContain("◫ ?/200k");
			expect(rendered).not.toContain("cache");
			expect(rendered).not.toContain("$");
		});
	});

	test("retains model and Context before lower-priority fields at narrow widths", () => {
		withNerdFontPreference(false, () => {
			const git = new ValueSource<GitChangeCounts | undefined>({ staged: 12, unstaged: 3, untracked: 1 });
			const controller = new StatuslineController(api(), { enabled: new ValueSource(true), gitChanges: git });
			const component = controller.createFooter(
				context({}),
				tuiHarness().tui,
				theme,
				footerData(
					"main",
					new Map([
						["goal", "goal:UI"],
						["mcp", "mcp:2"],
						["loadout", "load:full"],
					]),
				),
			);

			for (const width of [48, 32, 24]) {
				const lines = component.render(width);
				const rendered = lines.join("\n");
				expect(rendered).toContain("sonnet");
				expect(rendered).toMatch(/42(?:\.4)?%/u);
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			expect(component.render(48).join("\n")).toContain("Implement the accepted");
			expect(component.render(32).join("\n")).not.toContain("Implement the accepted");
		});
	});

	test("preserves every critical Git marker beside long model and branch names", () => {
		withNerdFontPreference(false, () => {
			const git = new ValueSource<GitChangeCounts | undefined>({
				ahead: 2,
				behind: 1,
				conflicted: 2,
				staged: 12,
				unstaged: 3,
				untracked: 1,
			});
			const controller = new StatuslineController(api(), { enabled: new ValueSource(true), gitChanges: git });
			const component = controller.createFooter(
				context({
					branch: messageEntries("Long identity probe", 0, 0),
					modelName: "ultra-long-provider-model-family-2026",
					reasoning: false,
				}),
				tuiHarness().tui,
				theme,
				footerData("feature/a-very-long-branch-name"),
			);

			for (const width of [64, 48, 32, 24]) {
				const lines = component.render(width);
				const rendered = lines.join("\n");
				expect(rendered).toContain("ultra");
				expect(rendered).toMatch(/42(?:\.4)?%/u);
				expect(rendered).toMatch(/!conflict:2|!2/u);
				expect(rendered).toMatch(/\+12|Δ16/u);
				expect(rendered).toContain("⇡2");
				expect(rendered).toContain("⇣1");
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		});
	});

	test("uses the semantic Git projection when Context is hidden and Git is the final full segment", () => {
		withNerdFontPreference(false, () => {
			const git = new ValueSource<GitChangeCounts | undefined>({
				ahead: 2,
				behind: 1,
				conflicted: 2,
				staged: 12,
				unstaged: 3,
				untracked: 1,
			});
			const controller = new StatuslineController(api(), { enabled: new ValueSource(true), gitChanges: git });
			const component = controller.createFooter(
				context({
					branch: messageEntries("Semantic Git projection", 0, 0),
					modelName: "ultra-long-provider-model-family-2026",
					reasoning: false,
				}),
				tuiHarness().tui,
				theme,
				footerData(
					`feature/${"a-very-long-branch-component-".repeat(6)}`,
					new Map([["compact-policy", "hide-context"]]),
				),
			);

			for (const width of [100, 64, 48, 32, 24]) {
				const lines = component.render(width);
				const rendered = lines.join("\n");
				expect(rendered).toContain("!2");
				expect(rendered).toContain("Δ16");
				expect(rendered).toContain("⇡2");
				expect(rendered).toContain("⇣1");
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		});
	});

	test("falls back to the model Context window when usage reports an invalid window", () => {
		withNerdFontPreference(false, () => {
			for (const contextWindow of [0, Number.NaN]) {
				const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
				const component = controller.createFooter(
					context({ branch: messageEntries("Context fallback", 0, 0), contextWindow, reasoning: false }),
					tuiHarness().tui,
					theme,
					footerData("main"),
				);
				expect(component.render(100).join("\n")).toContain("◫ 42.4%/200k");
			}
		});
	});

	test("renders the accepted ordered live fields and at most two prompt rows", () => {
		const enabled = new ValueSource(true);
		const git = new ValueSource<GitChangeCounts | undefined>({ staged: 12, unstaged: 3, untracked: 1 });
		const controller = new StatuslineController(api(), { enabled, gitChanges: git });
		const { tui } = tuiHarness();
		const component = controller.createFooter(
			context({}),
			tui,
			theme,
			footerData(
				"main",
				new Map([
					["goal", "goal:UI"],
					["mcp", "mcp:2"],
					["loadout", "load:full"],
					["agents", "agents:3"],
				]),
			),
		);

		const lines = withNerdFontPreference(false, () => component.render(120));
		expect(lines).toEqual([
			" sonnet-4.5 | think:med | dir pi-stuff | ⎇ main *3 +12 ?1 | ◫ 42.4%/200k | cache 99.9% | $0.42 ",
			" in: Implement the accepted Pi Stuff statusline. ",
		]);
		expect(lines.join("\n")).not.toMatch(/agents:3|goal:UI|mcp:2|load:full/u);

		const longPrompt = "请实现已经确认的状态栏，并验证中文宽字符和非常长的输入。".repeat(20);
		const longComponent = controller.createFooter(
			context({ branch: messageEntries(longPrompt) }),
			tui,
			theme,
			footerData("main"),
		);
		const narrow = withNerdFontPreference(false, () => longComponent.render(64));
		expect(narrow).toHaveLength(3);
		for (const line of narrow) expect(visibleWidth(line)).toBeLessThanOrEqual(64);
	});

	test("reduces persisted skill expansion to the user prompt and a compact skill badge", () => {
		const skillPath = join(homedir(), ".agents", "skills", "tdd", "SKILL.md");
		const expandedPrompt = [
			`<skill name="tdd" location="${skillPath}">`,
			`References are relative to ${join(homedir(), ".agents", "skills", "tdd")}.`,
			"# Test-Driven Development",
			"User: fix auth test",
			"</skill>",
		].join("\n");
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ branch: messageEntries(expandedPrompt, 0, 0) }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		const rendered = withNerdFontPreference(false, () => component.render(96).join("\n"));
		expect(rendered).toContain("fix auth test [skill:tdd]");
		for (const privateExpansion of ["<skill", "location=", skillPath, "References are relative to"]) {
			expect(rendered).not.toContain(privateExpansion);
		}
	});

	test("restores inline and multiple raw skill commands as responsive badges", () => {
		const rawPrompt = "please use /skill:tdd /skill:review /skill:triage /skill:prototype today /skill:missing";
		const controller = new StatuslineController(api("medium", ["tdd", "review", "triage", "prototype"]), {
			enabled: new ValueSource(true),
		});
		const component = controller.createFooter(
			context({ branch: messageEntries(rawPrompt, 0, 0) }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		const wide = withNerdFontPreference(false, () => component.render(120).join("\n"));
		expect(wide).toContain("please use today /skill:missing [skills:tdd,review,triage,prototype]");
		for (const recognized of ["tdd", "review", "triage", "prototype"]) {
			expect(wide).not.toContain(`/skill:${recognized}`);
		}
		const narrow = withNerdFontPreference(false, () => component.render(64).join("\n"));
		expect(narrow).toContain("[skills:4]");
		expect(narrow).not.toContain("tdd,review,triage,prototype");
	});

	test("keeps the user suffix when an expanded skill body exceeds the display safety cap", () => {
		const expandedPrompt = `<skill name="huge" location="/private/huge/SKILL.md">\n${"x".repeat(20_000)}\n</skill>\n\nDO_THE_USER_TASK`;
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ branch: messageEntries(expandedPrompt, 0, 0) }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		const rendered = withNerdFontPreference(false, () => component.render(96).join("\n"));
		expect(rendered).toContain("DO_THE_USER_TASK [skill:huge]");
		expect(rendered).not.toContain("/private/");
	});

	test("reserves the skill badge when a medium-width prompt is bounded to one row", () => {
		const expandedPrompt = `<skill name="tdd" location="/private/tdd/SKILL.md">\nbody\n</skill>\n\n${"LONGWORD ".repeat(80)}`;
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ branch: messageEntries(expandedPrompt, 0, 0) }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		const lines = withNerdFontPreference(false, () => component.render(48));
		expect(lines.filter((line) => line.includes("LONGWORD") || line.includes("[skill:tdd]"))).toHaveLength(1);
		expect(lines.join("\n")).toContain("[skill:tdd]");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(48);
	});

	test("omits a meaningless prompt ellipsis before a long skill badge", () => {
		const skill = `review-${"x".repeat(24)}`;
		const expandedPrompt = `<skill name="${skill}" location="/private/review/SKILL.md">\nbody\n</skill>\n\n${"检查🙂超长路径 ".repeat(40)}`;
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ branch: messageEntries(expandedPrompt, 0, 0) }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		for (const width of [100, 64, 48, 32, 24]) {
			const lines = withNerdFontPreference(false, () => component.render(width));
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(lines.join("\n")).not.toMatch(/…\s+\[skill:/u);
		}

		const narrowPrompt = withNerdFontPreference(false, () => component.render(48).join("\n"));
		expect(narrowPrompt).toContain(`[skill:${skill}]`);
		expect(narrowPrompt).not.toContain("检查…");
	});

	test("matches the old footer usage accounting by ignoring aborted turns and compaction metadata", () => {
		const [user, assistant] = turnEntries("aborted", "Retry the interrupted task", null, 18_000, 0.42);
		if (assistant.type !== "message" || assistant.message.role !== "assistant") {
			throw new Error("Expected assistant fixture entry");
		}
		assistant.message.stopReason = "aborted";
		const compaction = {
			firstKeptEntryId: user.id,
			id: "aborted-compaction",
			parentId: assistant.id,
			summary: "Interrupted turn summary",
			timestamp: "2026-08-03T00:00:02Z",
			tokensBefore: 10_000,
			type: "compaction",
			usage: usage(9_000, 0.21),
		} as SessionEntry;
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ branch: [user, assistant, compaction] }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		const rendered = withNerdFontPreference(false, () => component.render(120).join("\n"));
		expect(rendered).not.toContain("cache");
		expect(rendered).not.toContain("$0.");
	});

	test("incrementally caches unchanged history and follows branch and compaction leaves", () => {
		const [rootUser, rootAssistant] = turnEntries("root", "Root prompt", null, 100, 0.1);
		const [mainUser, mainAssistant] = turnEntries("main", "Main branch prompt", rootAssistant.id, 200, 0.2);
		const compaction = {
			firstKeptEntryId: mainUser.id,
			id: "main-compaction",
			parentId: mainAssistant.id,
			summary: "Compacted main branch",
			timestamp: "2026-08-03T00:00:02Z",
			tokensBefore: 10_000,
			type: "compaction",
			usage: usage(50, 0.05),
		} as SessionEntry;
		const [alternateUser, alternateAssistant] = turnEntries(
			"alternate",
			"Alternate branch prompt",
			rootAssistant.id,
			300,
			0.3,
		);
		const session = trackedSession(
			[rootUser, rootAssistant, mainUser, mainAssistant, compaction, alternateUser, alternateAssistant],
			compaction.id,
		);
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ sessionManager: session.manager }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);

		const main = component.render(120).join("\n");
		expect(main).toContain("93.8%");
		expect(main).toContain("$0.30");
		expect(main).toContain("Main branch prompt");
		expect(session.reads.branches).toBe(0);
		const readsAfterFirstRender = session.reads.entries;

		component.render(80);
		component.render(120);
		expect(session.reads.entries).toBe(readsAfterFirstRender);
		expect(session.reads.branches).toBe(0);

		session.setLeaf(alternateAssistant.id);
		const alternate = component.render(120).join("\n");
		expect(alternate).toContain("95.2%");
		expect(alternate).toContain("$0.40");
		expect(alternate).toContain("Alternate branch prompt");
		expect(session.reads.entries).toBe(readsAfterFirstRender + 2);

		const readsAfterAlternateBranch = session.reads.entries;
		session.setLeaf(compaction.id);
		expect(component.render(120).join("\n")).toContain("Main branch prompt");
		expect(session.reads.entries).toBe(readsAfterAlternateBranch);
	});

	test("omits cost for OAuth subscription models even when the catalogue reports rates", () => {
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ metered: true, subscription: true }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);
		const rendered = component.render(100).join("\n");
		expect(rendered).not.toContain("$");
		expect(rendered).not.toMatch(/\bsub\b/iu);
		expect(rendered).toContain("99.9%");
	});

	test("omits cost for Kimi Coding subscription models that use API-key authentication", () => {
		const controller = new StatuslineController(api(), { enabled: new ValueSource(true) });
		const component = controller.createFooter(
			context({ metered: true, provider: "kimi-coding", subscription: false }),
			tuiHarness().tui,
			theme,
			footerData("main"),
		);
		const rendered = component.render(100).join("\n");
		expect(rendered).not.toContain("$");
		expect(rendered).toContain("99.9%");
	});

	test("removes every row for settings, Command Dialog, and autocomplete suppression", () => {
		const enabled = new ValueSource(true);
		const autocomplete = new ValueSource(false);
		const controller = new StatuslineController(api(), { autocompleteVisible: autocomplete, enabled });
		const harness = tuiHarness();
		const component = controller.createFooter(context({}), harness.tui, theme, footerData("main"));
		expect(component.render(100)).not.toEqual([]);
		expect(controller.isEnabled()).toBe(true);

		controller.setSuppressed(true);
		expect(component.render(100)).toEqual([]);
		controller.setSuppressed(false);
		autocomplete.set(true);
		expect(component.render(100)).toEqual([]);
		autocomplete.set(false);
		enabled.set(false);
		expect(controller.isEnabled()).toBe(false);
		expect(component.render(100)).toEqual([]);
		expect(harness.requests.length).toBeGreaterThanOrEqual(5);

		const requestsBeforeDispose = harness.requests.length;
		component.dispose();
		enabled.set(true);
		expect(harness.requests).toHaveLength(requestsBeforeDispose);
		expect(component.render(100)).toEqual([]);
	});

	test("strips terminal and bidi controls from every dynamic field", () => {
		const injected = "前\u001b]0;OWNED_TITLE\u0007后\u009b31m红\u202eABC";
		const controller = new StatuslineController(api("medium"), {
			enabled: new ValueSource(true) as BooleanValueSource,
		});
		const component = controller.createFooter(
			context({
				branch: messageEntries(`${injected} 请验证中文`),
				cwd: join(homedir(), injected, "project"),
				modelId: injected,
			}),
			tuiHarness().tui,
			theme,
			footerData(injected, new Map([["goal", injected]])),
		);
		const lines = component.render(64);
		const rendered = lines.join("\n");
		expect(rendered).not.toContain("OWNED_TITLE");
		expect(rendered).not.toContain("\u001b[31m");
		expect(rendered).not.toContain("\u009b");
		expect(rendered).not.toContain("\u202e");
		expect(rendered).toContain("前后红");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(64);
	});

	test("isolates recoverable renderer, source-listener, and unsubscribe failures", () => {
		let enabledListener: (() => void) | undefined;
		const enabled: BooleanValueSource = {
			get: () => true,
			subscribe: (listener) => {
				enabledListener = listener;
				return () => {
					throw new Error("enabled unsubscribe failed");
				};
			},
		};
		let branchListener: (() => void) | undefined;
		const data = {
			getAvailableProviderCount: () => 1,
			getExtensionStatuses: () => new Map<string, string>(),
			getGitBranch: () => "main",
			onBranchChange: (listener: () => void) => {
				branchListener = listener;
				return () => {
					throw new Error("branch unsubscribe failed");
				};
			},
		} as ReadonlyFooterDataProvider;
		const controller = new StatuslineController(api(), { enabled });
		let healthyRenders = 0;
		controller.registerRenderer({
			requestRender: () => {
				throw new Error("renderer failed");
			},
		});
		controller.registerRenderer({ requestRender: () => (healthyRenders += 1) });
		const component = controller.createFooter(
			context({}),
			{
				requestRender: () => {
					throw new Error("TUI render failed");
				},
			} as unknown as TUI,
			theme,
			data,
		);

		expect(() => controller.setSuppressed(true)).not.toThrow();
		expect(healthyRenders).toBe(1);
		expect(() => enabledListener?.()).not.toThrow();
		expect(() => branchListener?.()).not.toThrow();
		expect(() => component.dispose()).not.toThrow();
	});
});

describe("GitStatusSource", () => {
	test("parses a bounded Git refresh and isolates listeners", async () => {
		const porcelain =
			"## main...origin/main [ahead 2, behind 1]\0?? new.ts\0 M changed.ts\0D  gone.ts\0R  renamed.ts\0old.ts\0UU conflict.ts\0!! ignored.ts\0";
		expect(parseGitStatusPorcelain(porcelain)).toEqual({
			ahead: 2,
			behind: 1,
			conflicted: 1,
			staged: 2,
			unstaged: 1,
			untracked: 1,
		});
		let resolveExec: ((value: { code: number; killed: boolean; stderr: string; stdout: string }) => void) | undefined;
		let execCalls = 0;
		const fakeApi = {
			exec: () => {
				execCalls += 1;
				return new Promise((resolve) => {
					resolveExec = resolve;
				});
			},
		} as unknown as ExtensionAPI;
		const source = new GitStatusSource();
		let healthyNotifications = 0;
		source.subscribe(() => {
			throw new Error("observer failed");
		});
		source.subscribe(() => {
			healthyNotifications += 1;
		});

		const first = source.refresh(fakeApi, "/workspace");
		expect(execCalls).toBe(1);
		if (!resolveExec) throw new Error("Expected the Git fixture command to start");
		resolveExec({ code: 0, killed: false, stderr: "", stdout: porcelain });
		await first;

		expect(source.get()).toEqual({
			ahead: 2,
			behind: 1,
			conflicted: 1,
			staged: 2,
			unstaged: 1,
			untracked: 1,
		});
		expect(healthyNotifications).toBe(1);
	});

	test("coalesces refresh bursts into one trailing snapshot without losing the newest Git state", async () => {
		const resolvers: Array<(value: { code: number; killed: boolean; stderr: string; stdout: string }) => void> = [];
		const fakeApi = {
			exec: () =>
				new Promise<{ code: number; killed: boolean; stderr: string; stdout: string }>((resolve) => {
					resolvers.push(resolve);
				}),
		} as unknown as ExtensionAPI;
		const source = new GitStatusSource();

		const first = source.refresh(fakeApi, "/workspace");
		const trailing = source.refresh(fakeApi, "/workspace");
		expect(trailing).toBe(first);
		expect(resolvers).toHaveLength(1);
		resolvers[0]?.({ code: 0, killed: false, stderr: "", stdout: "## main\0 M old.ts\0" });
		await Bun.sleep(0);
		expect(resolvers).toHaveLength(2);
		resolvers[1]?.({
			code: 0,
			killed: false,
			stderr: "",
			stdout: "## main...origin/main [ahead 1]\0 M first.ts\0 M second.ts\0",
		});
		await Promise.all([first, trailing]);

		expect(source.get("/workspace", "main")).toEqual({
			ahead: 1,
			behind: 0,
			conflicted: 0,
			staged: 0,
			unstaged: 2,
			untracked: 0,
		});
	});

	test("drops an in-flight Git result after the presentation is disposed", async () => {
		let resolveExec: ((value: { code: number; killed: boolean; stderr: string; stdout: string }) => void) | undefined;
		const fakeApi = {
			exec: () =>
				new Promise<{ code: number; killed: boolean; stderr: string; stdout: string }>((resolve) => {
					resolveExec = resolve;
				}),
		} as unknown as ExtensionAPI;
		const source = new GitStatusSource();
		let notifications = 0;
		source.subscribe(() => {
			notifications += 1;
		});

		const refresh = source.refresh(fakeApi, "/workspace");
		source.dispose();
		if (!resolveExec) throw new Error("Expected the Git fixture command to start");
		resolveExec({ code: 0, killed: false, stderr: "", stdout: "## main\0 M changed.ts\0" });
		await refresh;

		expect(source.get()).toBeUndefined();
		expect(notifications).toBe(0);
	});

	test("drains a cwd replacement without exposing the prior snapshot as current", async () => {
		const resolvers: Array<(value: { code: number; killed: boolean; stderr: string; stdout: string }) => void> = [];
		const fakeApi = {
			exec: () =>
				new Promise<{ code: number; killed: boolean; stderr: string; stdout: string }>((resolve) => {
					resolvers.push(resolve);
				}),
		} as unknown as ExtensionAPI;
		const source = new GitStatusSource();

		const first = source.refresh(fakeApi, "/workspace/old");
		const latest = source.refresh(fakeApi, "/workspace/new");
		resolvers[0]?.({ code: 0, killed: false, stderr: "", stdout: "## old\0 M old.ts\0" });
		await Bun.sleep(0);
		expect(source.get("/workspace/new", "new")).toBeUndefined();
		resolvers[1]?.({ code: 0, killed: false, stderr: "", stdout: "## new\0 M first.ts\0 M second.ts\0" });
		await Promise.all([first, latest]);

		expect(source.get("/workspace/old", "old")).toBeUndefined();
		expect(source.get("/workspace/new", "new")?.unstaged).toBe(2);
	});

	test("binds measured counts to the matching branch without dropping a fresh snapshot", async () => {
		let porcelain = "## old-branch\0 M old-branch.ts\0";
		const fakeApi = {
			exec: async () => ({ code: 0, killed: false, stderr: "", stdout: porcelain }),
			getThinkingLevel: () => "medium",
		} as unknown as ExtensionAPI;
		const source = new GitStatusSource();
		const cwd = join(homedir(), "dev", "pi-stuff");
		await source.refresh(fakeApi, cwd);
		let branch = "old-branch";
		let notifyBranchChange: (() => void) | undefined;
		const data = {
			getAvailableProviderCount: () => 1,
			getExtensionStatuses: () => new Map<string, string>(),
			getGitBranch: () => branch,
			onBranchChange: (listener: () => void) => {
				notifyBranchChange = listener;
				return () => {};
			},
		} as ReadonlyFooterDataProvider;
		const controller = new StatuslineController(fakeApi, {
			enabled: new ValueSource(true),
			gitChanges: source,
		});
		const component = controller.createFooter(context({}), tuiHarness().tui, theme, data);

		expect(withNerdFontPreference(false, () => component.render(120).join("\n"))).toContain("old-branch *1");
		branch = "new-branch";
		notifyBranchChange?.();
		const changed = withNerdFontPreference(false, () => component.render(120).join("\n"));
		expect(changed).toContain("new-branch");
		expect(changed).not.toContain("new-branch *1");

		porcelain = "## new-branch\0 M first.ts\0 M second.ts\0";
		await source.refresh(fakeApi, cwd);
		notifyBranchChange?.();
		const settled = withNerdFontPreference(false, () => component.render(120).join("\n"));
		expect(settled).toContain("new-branch *2");
	});
});
