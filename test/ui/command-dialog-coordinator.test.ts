import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type KeybindingsManager as AgentKeybindingsManager,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionUIContext,
	ModelRegistry,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type KeybindingsConfig, KeybindingsManager, type TUI, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Check } from "typebox/value";
import piStuffCodex from "../../packages/pi-stuff/src/codex/index.js";
import piStuffUi, {
	type CommandDialogComponent,
	type CommandDialogPriority,
	type CommandDialogView,
	type CommandDialogViewContext,
	DiagnosticChannel,
	ensureUiSettingsCommand,
	getCodexStatusChannel,
	getCommandDialogCoordinator,
	getGoalStatusChannel,
	promoteActiveAgentWorkToUser,
	readCurrentAgentWorkOrigin,
	requestStatuslineGitRefreshAfterUserWork,
	UiSettingsStore,
	withAgentWorkOrigin,
} from "../../packages/pi-stuff/src/conversation-ui/index.js";
import { installUiSessionPresentation } from "../../packages/pi-stuff/src/conversation-ui/session-presentation.js";
import { createExtensionApi } from "../fixtures/extension-api.js";
import { createExtensionContext, testTheme } from "../fixtures/extension-context.js";
import { TestTui } from "../fixtures/test-tui.js";

const HANDLED_ACTION_SCHEMA = Type.Object({ action: Type.Literal("handled") }, { additionalProperties: true });
const INPUT_EVENT_SCHEMA = Type.Object(
	{ source: Type.Optional(Type.String()), text: Type.String() },
	{ additionalProperties: true },
);

type FooterFactory = Parameters<ExtensionUIContext["setFooter"]>[0];
type HeaderFactory = Parameters<ExtensionUIContext["setHeader"]>[0];
type EditorFactory = NonNullable<ReturnType<ExtensionUIContext["getEditorComponent"]>>;
interface HarnessMessage {
	readonly content?: string | readonly object[];
	readonly role: string;
}

interface HarnessEvent {
	readonly message?: HarnessMessage;
	readonly reason?: string;
	readonly source?: string;
	readonly streamingBehavior?: "followUp" | "steer";
	readonly text?: string;
	readonly timestamp?: number;
	readonly turnIndex?: number;
	readonly type: string;
}
type SessionHandler = (event: HarnessEvent, ctx: ExtensionContext) => object | undefined | Promise<object | undefined>;
type ExtensionEventListener = Parameters<ExtensionAPI["events"]["on"]>[1];
type ExtensionEventPayload = Parameters<ExtensionEventListener>[0];

interface TestDeferred<Value> {
	readonly promise: Promise<Value>;
	reject(cause: unknown): void;
	resolve(value: Value): void;
}

interface HostCall {
	component: CommandDialogComponent | undefined;
	doneCalls: number;
	doneRequested: boolean;
	readonly options: { overlay?: boolean } | undefined;
	reject(cause: unknown): void;
	settleDone(): void;
}

class TestComponent implements CommandDialogComponent {
	disposeCalls = 0;
	input: string[] = [];
	invalidateCalls = 0;
	private readonly label: string;

	constructor(label: string) {
		this.label = label;
	}

	dispose(): void {
		this.disposeCalls += 1;
	}

	handleInput(data: string): void {
		this.input.push(data);
	}

	invalidate(): void {
		this.invalidateCalls += 1;
	}

	render(): string[] {
		return [this.label];
	}
}

class FocusableTestComponent extends TestComponent {
	focused = false;
}

interface EventBusLike {
	emit(event: string, data: ExtensionEventPayload): void;
	on(event: string, listener: ExtensionEventListener): () => void;
}

class EventBusHarness implements EventBusLike {
	private readonly listeners = new Map<string, Set<ExtensionEventListener>>();

	emit(event: string, data: ExtensionEventPayload): void {
		for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(data);
	}

	on(event: string, listener: ExtensionEventListener): () => void {
		let listeners = this.listeners.get(event);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(event, listeners);
		}
		listeners.add(listener);
		return () => listeners?.delete(listener);
	}
}

function eventBusView(bus: EventBusHarness): EventBusLike {
	return {
		emit: (event, data) => bus.emit(event, data),
		on: (event, listener) => bus.on(event, listener),
	};
}

class UiHarnessKeybindings extends KeybindingsManager {
	constructor() {
		super(TUI_KEYBINDINGS);
	}

	getEffectiveConfig(): KeybindingsConfig {
		return this.getResolvedBindings();
	}

	reload(): void {}
}

class UiHarnessTui extends TestTui {
	private readonly requests: Array<boolean | undefined>;

	constructor(requests: Array<boolean | undefined>) {
		super();
		this.requests = requests;
	}

	override requestRender(force?: boolean): void {
		this.requests.push(force);
	}
}

class UiHarness {
	autoResolveOnDone = true;
	editorText = "saved draft";
	readonly editorWrites: string[] = [];
	readonly footerWrites: Array<FooterFactory | undefined> = [];
	readonly headerWrites: Array<HeaderFactory | undefined> = [];
	readonly forbiddenCalls: string[] = [];
	readonly hostCalls: HostCall[] = [];
	readonly renderRequests: Array<boolean | undefined> = [];
	// SAFETY: the test manager implements the two Agent additions and otherwise uses the inherited TUI keybinding contract.
	readonly keybindings = new UiHarnessKeybindings() as AgentKeybindingsManager;
	readonly theme = testTheme;
	throwOnFooterRestore = false;
	readonly tui = new UiHarnessTui(this.renderRequests);
	readonly workingWrites: boolean[] = [];
	private editorFactory: EditorFactory | undefined;

	get currentHost(): CommandDialogComponent {
		const host = this.hostCalls.at(-1)?.component;
		if (!host) throw new Error("Expected a mounted Command Dialog host");
		return host;
	}

	custom<Result>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: AgentKeybindingsManager,
			done: (result: Result) => void,
		) => CommandDialogComponent | Promise<CommandDialogComponent>,
		options?: { overlay?: boolean },
	): Promise<Result> {
		const completion = createDeferred<Result>();
		let doneResult: Result | undefined;
		const call: HostCall = {
			component: undefined,
			doneCalls: 0,
			doneRequested: false,
			options,
			reject: completion.reject,
			settleDone: () => {
				if (!call.doneRequested) throw new Error("Host done was not requested");
				// SAFETY: this test controls the value and supplies every Result member exercised by this case.
				completion.resolve(doneResult as Result);
			},
		};
		this.hostCalls.push(call);
		const component = factory(this.tui, this.theme, this.keybindings, (result) => {
			call.doneCalls += 1;
			call.doneRequested = true;
			doneResult = result;
			if (this.autoResolveOnDone) completion.resolve(result);
		});
		if (component instanceof Promise) throw new Error("The test host expects a synchronous component factory");
		call.component = component;
		return completion.promise;
	}

	getEditorText(): string {
		return this.editorText;
	}

	getEditorComponent(): EditorFactory | undefined {
		return this.editorFactory;
	}

	setEditorText(text: string): void {
		this.editorText = text;
		this.editorWrites.push(text);
	}

	setEditorComponent(factory: EditorFactory | undefined): void {
		this.editorFactory = factory;
	}

	setFooter(factory: FooterFactory | undefined): void {
		this.footerWrites.push(factory);
		if (factory === undefined && this.throwOnFooterRestore) throw new Error("footer restore failed");
	}

	setHeader(factory: HeaderFactory | undefined): void {
		this.headerWrites.push(factory);
	}

	setStatus(): void {
		this.forbiddenCalls.push("status");
	}

	setWidget(): void {
		this.forbiddenCalls.push("widget");
	}

	setWorkingVisible(visible: boolean): void {
		this.workingWrites.push(visible);
	}

	rejectCurrent(cause: unknown): void {
		const call = this.hostCalls.at(-1);
		if (!call) throw new Error("Expected an active custom call");
		call.reject(cause);
	}

	settleCurrentDone(): void {
		const call = this.hostCalls.at(-1);
		if (!call) throw new Error("Expected an active custom call");
		call.settleDone();
	}
}

function createApiHarness(events: EventBusLike = new EventBusHarness(), execute?: ExtensionAPI["exec"]) {
	const execCalls: unknown[][] = [];
	const eventHandlers = new Map<string, SessionHandler[]>();
	const registeredCommands: string[] = [];
	const sessionHandlers: SessionHandler[] = [];
	const shutdownHandlers: SessionHandler[] = [];
	const exec: ExtensionAPI["exec"] = async (command, args, options) => {
		execCalls.push([command, args, options]);
		return execute ? execute(command, args, options) : { code: 1, killed: false, stderr: "", stdout: "" };
	};
	// SAFETY: this test adapter records every Host event callback without changing its arguments or result.
	const on = ((event: string, handler: SessionHandler) => {
		const handlers = eventHandlers.get(event) ?? [];
		handlers.push(handler);
		eventHandlers.set(event, handlers);
		if (event === "session_start") sessionHandlers.push(handler);
		if (event === "session_shutdown") shutdownHandlers.push(handler);
	}) as ExtensionAPI["on"];
	const api = createExtensionApi({
		events,
		exec,
		getAllTools: () => [],
		getActiveTools: () => [],
		getCommands: () => [],
		getThinkingLevel: () => "medium",
		on,
		registerCommand: (name: string) => registeredCommands.push(name),
		registerMarkdownTransformer: () => {},
		registerTool: () => {},
		setActiveTools: () => {},
	});

	return {
		api,
		execCalls,
		registeredCommands,
		sessionHandlers,
		shutdownHandlers,
		async emit(event: string, data: HarnessEvent, ctx: ExtensionContext): Promise<void> {
			// Pi 0.84.3 creates one context per input dispatch and shares it across
			// that dispatch's handlers. Other lifecycle events receive the supplied
			// session context directly.
			const handlerContext = event === "input" ? Object.create(ctx) : ctx;
			for (const handler of eventHandlers.get(event) ?? []) {
				const result = await handler(data, handlerContext);
				if (event === "input" && Check(HANDLED_ACTION_SCHEMA, result)) {
					return;
				}
			}
		},
		async start(ctx: ExtensionContext): Promise<void> {
			for (const handler of sessionHandlers) {
				await handler({ type: "session_start" }, ctx);
			}
		},
		async shutdown(ctx: ExtensionContext): Promise<void> {
			for (const handler of shutdownHandlers) {
				await handler({ reason: "quit", type: "session_shutdown" }, ctx);
			}
		},
	};
}

interface ContextOptions {
	readonly contextUsage?: {
		readonly contextWindow: number;
		readonly percent: number | null;
		readonly tokens: number | null;
	};
	readonly cwd?: string;
	readonly hasPendingMessages?: () => boolean;
	readonly isIdle?: () => boolean;
	readonly model?: ExtensionContext["model"];
	readonly modelId?: string;
	readonly modelRegistry?: Partial<ExtensionContext["modelRegistry"]>;
	readonly provider?: string;
	readonly signal?: AbortSignal;
}

function createTestModel(
	id: string,
	provider = "fixture",
	overrides: Partial<NonNullable<ExtensionContext["model"]>> = {},
): NonNullable<ExtensionContext["model"]> {
	return {
		api: "openai-responses",
		baseUrl: "https://example.test",
		contextWindow: 200_000,
		cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
		id,
		input: ["text"],
		maxTokens: 8_192,
		name: id,
		provider,
		reasoning: true,
		...overrides,
	};
}

function createContext(
	ui: UiHarness,
	mode: ExtensionContext["mode"] = "tui",
	options: ContextOptions = {},
): ExtensionContext {
	const cwd = options.cwd ?? "/workspace";
	const contextOptions: Parameters<typeof createExtensionContext>[0] = {
		cwd,
		getContextUsage: () => options.contextUsage,
		hasUI: mode !== "rpc",
		hasPendingMessages: options.hasPendingMessages ?? (() => false),
		isIdle: options.isIdle ?? (() => true),
		mode,
		model: options.model ?? (options.modelId ? createTestModel(options.modelId, options.provider) : undefined),
		sessionManager: { getBranch: () => [], getCwd: () => cwd },
		signal: options.signal,
		ui: {
			custom: (factory, dialogOptions) => ui.custom(factory, dialogOptions),
			getEditorComponent: () => ui.getEditorComponent(),
			getEditorText: () => ui.getEditorText(),
			setEditorComponent: (factory) => ui.setEditorComponent(factory),
			setEditorText: (text) => ui.setEditorText(text),
			setFooter: (factory) => ui.setFooter(factory),
			setHeader: (factory) => ui.setHeader(factory),
			setStatus: () => ui.setStatus(),
			setWidget: () => ui.setWidget(),
			setWorkingVisible: (visible) => ui.setWorkingVisible(visible),
			theme: ui.theme,
		},
	};
	if (options.modelRegistry) {
		contextOptions.modelRegistry = Object.assign(Object.create(ModelRegistry.prototype), options.modelRegistry);
	}
	return createExtensionContext(contextOptions);
}

function createFooterData(branch: string | null = null) {
	const listeners = new Set<() => void>();
	return {
		getAvailableProviderCount: () => 1,
		getExtensionStatuses: () => new Map<string, string>(),
		getGitBranch: () => branch,
		onBranchChange: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function createView<Result>(
	label: string,
	priority: CommandDialogPriority,
	components: Map<string, TestComponent>,
	contexts: Map<string, CommandDialogViewContext<Result>>,
): CommandDialogView<Result> {
	return {
		priority,
		create: (context) => {
			const component = new TestComponent(label);
			components.set(label, component);
			contexts.set(label, context);
			return component;
		},
	};
}

async function drainMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for test condition");
}

async function settleAgentRun(
	api: ReturnType<typeof createApiHarness>,
	ctx: ExtensionContext,
	source: "extension" | "interactive",
	text: string,
): Promise<void> {
	await api.emit("input", { type: "input", source, text }, ctx);
	await api.emit("agent_start", { type: "agent_start" }, ctx);
	await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
	await api.emit(
		"message_start",
		{ type: "message_start", message: { role: "user", content: [{ type: "text", text }] } },
		ctx,
	);
	await api.emit("turn_end", { type: "turn_end", turnIndex: 0 }, ctx);
	await api.emit("agent_settled", { type: "agent_settled" }, ctx);
}

function createDeferred<Value>(): TestDeferred<Value> {
	let resolvePromise: (value: Value) => void = () => {};
	let rejectPromise: (cause: unknown) => void = () => {};
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, reject: rejectPromise, resolve: resolvePromise };
}

describe("normal UI presentation integration", () => {
	test("installs one UI lifecycle across per-extension event API wrappers", async () => {
		const bus = new EventBusHarness();
		const first = createApiHarness(eventBusView(bus));
		const duplicate = createApiHarness(eventBusView(bus));

		await piStuffUi(first.api);
		await piStuffUi(duplicate.api);

		expect(first.registeredCommands).toEqual(["ui", "diagnostics"]);
		expect(first.sessionHandlers).toHaveLength(1);
		expect(duplicate.registeredCommands).toEqual([]);
		expect(duplicate.sessionHandlers).toHaveLength(0);
	});

	test("observes late Codex status publication through one shared channel", async () => {
		const events = new EventBusHarness();
		const uiApi = createApiHarness(eventBusView(events));
		await piStuffUi(uiApi.api);
		const ui = new UiHarness();
		const ctx = createContext(ui, "tui", {
			contextUsage: { contextWindow: 200_000, percent: 42.4, tokens: 84_800 },
			modelId: "gpt-5.6-sol",
			provider: "openai-codex",
		});
		await uiApi.start(ctx);

		const factory = ui.footerWrites.at(-1);
		if (!factory) throw new Error("Expected the Suite footer factory");
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const footer = factory(ui.tui, ui.theme, createFooterData("main") as never);
		const initial = footer.render(120).join("\n");
		expect(initial).not.toContain("weekly");
		expect(initial).not.toContain("fast");

		const codexApi = createApiHarness(eventBusView(events));
		const uiChannel = getCodexStatusChannel(uiApi.api);
		const codexChannel = getCodexStatusChannel(codexApi.api);
		expect(codexChannel).toBe(uiChannel);
		const rendersBeforePublish = ui.renderRequests.length;
		codexChannel.publish({ fastEnabled: true, weeklyRemainingPercent: 72.4 });
		const active = footer.render(120).join("\n");
		expect(active).toContain("med ·");
		expect(active).toContain("fast ·");
		expect(active).toContain("72%");
		expect(ui.renderRequests.length).toBeGreaterThan(rendersBeforePublish);

		const rendersBeforeClear = ui.renderRequests.length;
		codexChannel.clear();
		const cleared = footer.render(120).join("\n");
		expect(cleared).not.toContain("weekly");
		expect(cleared).not.toContain("fast");
		expect(ui.renderRequests.length).toBeGreaterThan(rendersBeforeClear);

		footer.dispose?.();
		const rendersAfterDispose = ui.renderRequests.length;
		codexChannel.publish({ fastEnabled: true, weeklyRemainingPercent: 71 });
		expect(ui.renderRequests).toHaveLength(rendersAfterDispose);
	});

	test("refreshes Codex weekly usage after completed direct-user work without opening /codex", async () => {
		const events = new EventBusHarness();
		const uiApi = createApiHarness(eventBusView(events));
		const codexApi = createApiHarness(eventBusView(events));
		await piStuffUi(uiApi.api);
		await piStuffCodex(codexApi.api);
		const controller = new AbortController();
		const ctx = createContext(new UiHarness(), "tui", {
			// SAFETY: this test fixture implements the exact Host surface exercised by this case.
			model: {
				api: "openai-responses",
				baseUrl: "https://chatgpt.com/backend-api",
				id: "gpt-5.6-sol",
				input: ["text"],
				provider: "openai-codex",
			} as ExtensionContext["model"],
			modelRegistry: {
				getApiKeyAndHeaders: async () => ({
					apiKey: "test-token",
					headers: { "chatgpt-account-id": "account-42" },
					ok: true,
				}),
			},
			signal: controller.signal,
		});
		let fetchCalls = 0;
		let usedPercent = 18;
		let deferredFetch: Promise<Response> | undefined;
		let failNextFetch = false;
		let codexShutdown = false;
		const usageResponse = (used: number): Response =>
			new Response(JSON.stringify({ rate_limit: { secondary: { used_percent: used, window_minutes: 10_080 } } }), {
				status: 200,
			});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = Object.assign(
			async (_input: string | URL | Request, _init?: RequestInit) => {
				fetchCalls += 1;
				if (deferredFetch) {
					const pending = deferredFetch;
					deferredFetch = undefined;
					return pending;
				}
				if (failNextFetch) {
					failNextFetch = false;
					throw new Error("usage unavailable");
				}
				return usageResponse(usedPercent);
			},
			{ preconnect: originalFetch.preconnect },
		);

		try {
			await uiApi.start(ctx);
			await codexApi.start(ctx);
			const status = getCodexStatusChannel(uiApi.api).source;
			expect(status.getSnapshot().weeklyRemainingPercent).toBeUndefined();
			expect(fetchCalls).toBe(0);

			await settleAgentRun(uiApi, ctx, "extension", "automatic");
			expect(fetchCalls).toBe(0);
			const codexModel = ctx.model;
			Object.assign(ctx, { model: { id: "claude", provider: "anthropic" } });
			await settleAgentRun(uiApi, ctx, "interactive", "non-Codex request");
			expect(fetchCalls).toBe(0);
			Object.assign(ctx, { hasUI: false, model: codexModel });
			await settleAgentRun(uiApi, ctx, "interactive", "non-UI request");
			expect(fetchCalls).toBe(0);
			Object.assign(ctx, { hasUI: true });

			await settleAgentRun(uiApi, ctx, "interactive", "first direct request");
			await waitUntil(() => status.getSnapshot().weeklyRemainingPercent === 82);
			expect(fetchCalls).toBe(1);

			const heldFetch = createDeferred<Response>();
			deferredFetch = heldFetch.promise;
			await settleAgentRun(uiApi, ctx, "interactive", "second direct request");
			await waitUntil(() => fetchCalls === 2);
			usedPercent = 45;
			await settleAgentRun(uiApi, ctx, "interactive", "queued direct request");
			await settleAgentRun(uiApi, ctx, "interactive", "newest queued direct request");
			expect(fetchCalls).toBe(2);
			heldFetch.resolve(usageResponse(31));
			await waitUntil(() => status.getSnapshot().weeklyRemainingPercent === 55);
			expect(fetchCalls).toBe(3);

			failNextFetch = true;
			await settleAgentRun(uiApi, ctx, "interactive", "failed refresh");
			await waitUntil(() => fetchCalls === 4);
			await drainMicrotasks();
			expect(status.getSnapshot().weeklyRemainingPercent).toBe(55);

			usedPercent = 50;
			await settleAgentRun(uiApi, ctx, "interactive", "recovered refresh");
			await waitUntil(() => status.getSnapshot().weeklyRemainingPercent === 50);
			expect(fetchCalls).toBe(5);

			const lateFetch = createDeferred<Response>();
			deferredFetch = lateFetch.promise;
			await settleAgentRun(uiApi, ctx, "interactive", "shutdown refresh");
			await waitUntil(() => fetchCalls === 6);
			await codexApi.shutdown(ctx);
			codexShutdown = true;
			lateFetch.resolve(usageResponse(60));
			await drainMicrotasks();
			expect(status.getSnapshot().weeklyRemainingPercent).toBeUndefined();
			await settleAgentRun(uiApi, ctx, "interactive", "after shutdown");
			expect(fetchCalls).toBe(6);
		} finally {
			controller.abort();
			globalThis.fetch = originalFetch;
			await uiApi.shutdown(ctx);
			if (!codexShutdown) await codexApi.shutdown(ctx);
		}
	});

	test("shows live Goal state conditionally in the shared Statusline", async () => {
		const events = new EventBusHarness();
		const uiApi = createApiHarness(eventBusView(events));
		await piStuffUi(uiApi.api);
		const ui = new UiHarness();
		const ctx = createContext(ui, "tui", {
			contextUsage: { contextWindow: 200_000, percent: 42.4, tokens: 84_800 },
			modelId: "gpt-5.6-sol",
		});
		await uiApi.start(ctx);

		const factory = ui.footerWrites.at(-1);
		if (!factory) throw new Error("Expected the Suite footer factory");
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const footer = factory(ui.tui, ui.theme, createFooterData("main") as never);
		expect(footer.render(120).join("\n")).not.toContain("goal");

		const goalApi = createApiHarness(eventBusView(events));
		const uiChannel = getGoalStatusChannel(uiApi.api);
		const goalChannel = getGoalStatusChannel(goalApi.api);
		expect(goalChannel).toBe(uiChannel);

		const rendersBeforeActive = ui.renderRequests.length;
		const activeStartedAt = Date.now();
		goalChannel.publish({
			activeStartedAt,
			status: "active",
			timeUsedSeconds: 13 * 60,
			tokenBudget: 12_000,
			tokensUsed: 1_250,
		});
		expect(goalChannel.source.getSnapshot()).toEqual({
			activeStartedAt,
			status: "active",
			timeUsedSeconds: 13 * 60,
			tokenBudget: 12_000,
			tokensUsed: 1_250,
		});
		expect(footer.render(120).join("\n")).toContain("● goal 1.3k/12k 13m");
		expect(ui.renderRequests.length).toBeGreaterThan(rendersBeforeActive);

		goalChannel.publish({ status: "paused", timeUsedSeconds: 13 * 60, tokensUsed: 1_250 });
		expect(footer.render(120).join("\n")).toContain("■ goal paused 13m");
		goalChannel.publish({
			status: "budget_limited",
			timeUsedSeconds: 13 * 60,
			tokenBudget: 12_000,
			tokensUsed: 12_000,
		});
		expect(footer.render(120).join("\n")).toContain("! goal budget 12k/12k 13m");
		goalChannel.publish({ status: "usage_limited", timeUsedSeconds: 13 * 60, tokensUsed: 1_250 });
		expect(footer.render(120).join("\n")).toContain("! goal usage 13m");
		goalChannel.publish({ status: "blocked", timeUsedSeconds: 13 * 60, tokensUsed: 1_250 });
		expect(footer.render(120).join("\n")).toContain("! goal blocked 13m");
		goalChannel.publish({ status: "complete", timeUsedSeconds: 13 * 60, tokensUsed: 0 });
		expect(footer.render(120).join("\n")).toContain("✓ goal complete 13m");

		const rendersBeforeClear = ui.renderRequests.length;
		goalChannel.clear();
		expect(goalChannel.source.getSnapshot()).toBeUndefined();
		expect(footer.render(120).join("\n")).not.toContain("goal");
		expect(ui.renderRequests.length).toBeGreaterThan(rendersBeforeClear);

		footer.dispose?.();
		const rendersAfterDispose = ui.renderRequests.length;
		goalChannel.publish({ status: "blocked", timeUsedSeconds: 13 * 60, tokensUsed: 1_250 });
		expect(ui.renderRequests).toHaveLength(rendersAfterDispose);
	});

	test("installs the accepted Statusline, Welcome header, and editor decorator", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui, "tui", {
			contextUsage: { contextWindow: 200_000, percent: 42.4, tokens: 84_800 },
			cwd: join(homedir(), "dev", "pi-stuff"),
			modelId: "gpt-5.6-sol",
		});
		await api.start(ctx);
		expect(api.execCalls).toEqual([]);

		const factory = ui.footerWrites.at(-1);
		if (!factory) throw new Error("Expected the Suite footer factory");
		const footerData = createFooterData("main");
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const footer = factory(ui.tui, ui.theme, footerData as never);
		const statusline = footer.render(100).join("\n");
		for (const expected of ["gpt-5.6-sol", "med", "pi-stuff", "main", "42.4%"]) {
			expect(statusline).toContain(expected);
		}
		expect(statusline).not.toContain("$0.00");
		expect(ui.headerWrites.at(-1)).toBeTypeOf("function");
		expect(ui.getEditorComponent()).toBeTypeOf("function");
	});

	test("lets Fleetview replace Footer row 2 in place and restores the exact prompt row", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui, "tui", { modelId: "gpt-5.6-sol" });
		await api.start(ctx);
		expect(coordinator.hasInstalledFooter?.(ctx)).toBe(true);

		let managing = false;
		const hint = "↑/↓ select · Enter view · Esc return";
		const main = "● main";
		const prompt = "prompt";
		const reviewer = "○ reviewer  3s";

		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		(
			coordinator as typeof coordinator & {
				installFooter(context: ExtensionContext, factory: NonNullable<FooterFactory>): void;
			}
		).installFooter(ctx, () => ({
			invalidate: () => {},
			render: () => ["status", prompt],
		}));
		const initialFactory = ui.footerWrites.at(-1);
		if (!initialFactory) throw new Error("Expected the primary Suite Footer");
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const initialLines = initialFactory(ui.tui, ui.theme, createFooterData("main") as never).render(100);
		expect(initialLines).toEqual(["status", prompt]);
		const unregister = coordinator.registerFooterTail?.("fleetview-fixture", () => ({
			get replacesBaseRow2() {
				return managing;
			},
			invalidate: () => {},
			render: () => [...(managing ? [hint] : []), main, reviewer],
		}));
		const stackedFactory = ui.footerWrites.at(-1);
		if (!stackedFactory) throw new Error("Expected the stacked Suite Footer");
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const idle = stackedFactory(ui.tui, ui.theme, createFooterData("main") as never).render(100);

		expect(idle[0]).toBe("status");
		expect(idle[1]).toBe(prompt);
		expect(idle.at(-2)).toBe(main);
		expect(idle.at(-1)).toBe(reviewer);
		const idleMainIndex = idle.indexOf(main);

		managing = true;
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const active = stackedFactory(ui.tui, ui.theme, createFooterData("main") as never).render(100);
		expect(active[0]).toBe("status");
		expect(active[1]).toBe(hint);
		expect(active).not.toContain(prompt);
		expect(active.indexOf(main)).toBe(idleMainIndex);

		managing = false;
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		const restored = stackedFactory(ui.tui, ui.theme, createFooterData("main") as never).render(100);
		expect(restored[1]).toBe(prompt);
		expect(restored).not.toContain(hint);

		unregister?.();
		const statusOnlyFactory = ui.footerWrites.at(-1);
		if (!statusOnlyFactory) throw new Error("Expected the restored primary Footer");
		// SAFETY: this test double implements the exact Pi members exercised by this case; unused Host members are intentionally erased.
		expect(statusOnlyFactory(ui.tui, ui.theme, createFooterData("main") as never).render(100)).not.toContain(main);
	});

	test("uses the logical Footer row-2 slot with Statusline and latest Prompt independently disabled", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		const installFooter =
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
			(
				coordinator as typeof coordinator & {
					installFooter(context: ExtensionContext, factory: NonNullable<FooterFactory>): void;
				}
			).installFooter.bind(coordinator);
		let managing = false;
		const unregister = coordinator.registerFooterTail?.("fleetview-fixture", () => ({
			get replacesBaseRow2() {
				return managing;
			},
			invalidate: () => {},
			render: () => [...(managing ? ["controls"] : []), "● main"],
		}));

		for (const baseRows of [["status", "prompt"], ["status"], []] as const) {
			installFooter(ctx, () => ({
				invalidate: () => {},
				render: () => [...baseRows],
			}));
			const factory = ui.footerWrites.at(-1);
			if (!factory) throw new Error("Expected a composed Footer");
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
			const component = factory(ui.tui, ui.theme, {} as never);

			managing = false;
			expect(component.render(80)).toEqual([...baseRows, "● main"]);
			managing = true;
			expect(component.render(80)).toEqual([...baseRows.slice(0, 1), "controls", "● main"]);
		}
		unregister?.();
	});

	test("does not probe Git while Statusline is disabled", async () => {
		const api = createApiHarness();
		const ui = new UiHarness();
		const ctx = createContext(ui);
		const settings = UiSettingsStore.memory();
		const coordinator = {
			installFooter: (_ctx: ExtensionContext, factory: FooterFactory) => ui.setFooter(factory),
			registerChrome: () => () => {},
			setWorkingVisible: () => {},
			show: async () => undefined,
			whenIdle: async () => {},
		};
		const presentation = installUiSessionPresentation(
			api.api,
			ctx,
			settings,
			// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
			coordinator as never,
			new DiagnosticChannel(),
		);
		if (!presentation) throw new Error("Expected a TUI presentation");

		await settings.set("statusline", false);
		presentation.refreshGit();
		expect(api.execCalls).toHaveLength(0);

		await settings.set("statusline", true);
		presentation.refreshGit();
		expect(api.execCalls).toHaveLength(1);
		presentation.dispose();
	});

	test("refreshes Git once after a direct-user Agent run, not after automatic Extension runs", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const ctx = createContext(new UiHarness());
		await api.start(ctx);

		await api.emit("input", { type: "input", text: "automatic", source: "extension" }, ctx);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("automatic");
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
		await api.emit(
			"message_start",
			{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "automatic" }] } },
			ctx,
		);
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(0);

		await api.emit("input", { type: "input", text: "direct", source: "interactive" }, ctx);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("automatic");
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 2 }, ctx);
		await api.emit(
			"message_start",
			{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "direct" }] } },
			ctx,
		);
		await api.emit(
			"input",
			{ type: "input", text: "queued automatic", source: "extension", streamingBehavior: "followUp" },
			ctx,
		);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("user");
		await api.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 3 }, ctx);
		await api.emit(
			"message_start",
			{
				type: "message_start",
				message: { role: "user", content: [{ type: "text", text: "queued automatic" }] },
			},
			ctx,
		);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("automatic");
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(1);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("automatic");

		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(1);

		await api.emit("input", { type: "input", text: "automatic", source: "extension" }, ctx);
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 4 }, ctx);
		await api.emit(
			"message_start",
			{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "automatic" }] } },
			ctx,
		);
		await api.emit(
			"input",
			{ type: "input", text: "user follow-up", source: "rpc", streamingBehavior: "followUp" },
			ctx,
		);
		// Merely accepting a follow-up must not change the work currently executing.
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("automatic");
		await api.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 5 }, ctx);
		await api.emit(
			"message_start",
			{
				type: "message_start",
				message: { role: "user", content: [{ type: "text", text: "user follow-up" }] },
			},
			ctx,
		);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("user");
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(2);
	});

	test("waits for a Goal continuation started by an earlier settlement handler before refreshing Git", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		let idle = true;
		let pendingMessages = false;
		let settlements = 0;
		api.api.on("agent_settled", () => {
			settlements += 1;
			if (settlements !== 1) return;
			// Goal is initialized after Conversation UI, but its listener exists before
			// session_start. It schedules an automatic continuation at this boundary.
			idle = false;
			pendingMessages = true;
		});
		const ctx = createContext(new UiHarness(), "tui", {
			hasPendingMessages: () => pendingMessages,
			isIdle: () => idle,
		});
		await api.start(ctx);

		await api.emit("input", { type: "input", text: "direct", source: "interactive" }, ctx);
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
		await api.emit(
			"message_start",
			{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "direct" }] } },
			ctx,
		);
		await api.emit("turn_end", { type: "turn_end", turnIndex: 0 }, ctx);
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(0);

		pendingMessages = false;
		await api.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 2 }, ctx);
		await api.emit(
			"message_start",
			{
				type: "message_start",
				message: withAgentWorkOrigin(
					{ role: "custom", customType: "goal-continuation", content: "continue" },
					"automatic",
				),
			},
			ctx,
		);
		await api.emit("turn_end", { type: "turn_end", turnIndex: 1 }, ctx);
		idle = true;
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(1);
	});

	test("holds background refresh requests while earlier settlement handlers are still running", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const settlementEntered = createDeferred<void>();
		const releaseSettlement = createDeferred<void>();
		api.api.on("agent_settled", async () => {
			settlementEntered.resolve();
			await releaseSettlement.promise;
		});
		// Pi marks itself idle before it awaits Extension settlement handlers.
		const ctx = createContext(new UiHarness(), "tui", {
			hasPendingMessages: () => false,
			isIdle: () => true,
		});
		await api.start(ctx);

		await api.emit("agent_start", { type: "agent_start" }, ctx);
		const settlement = api.emit("agent_settled", { type: "agent_settled" }, ctx);
		await settlementEntered.promise;
		requestStatuslineGitRefreshAfterUserWork(api.api);
		expect(api.execCalls).toHaveLength(0);

		releaseSettlement.resolve();
		await settlement;
		expect(api.execCalls).toHaveLength(1);
	});

	test("finishes Git observation before a later settlement handler can start Agent work", async () => {
		const gitEntered = createDeferred<void>();
		const releaseGit = createDeferred<void>();
		const order: string[] = [];
		let gitRunning = false;
		let overlap = false;
		const api = createApiHarness(new EventBusHarness(), async () => {
			gitRunning = true;
			order.push("git-start");
			gitEntered.resolve();
			await releaseGit.promise;
			order.push("git-complete");
			gitRunning = false;
			return { code: 1, killed: false, stderr: "", stdout: "" };
		});
		await piStuffUi(api.api);
		const ctx = createContext(new UiHarness());
		await api.start(ctx);
		// A separately loaded Extension can register after Pi Stuff's dynamic
		// observer. Pi 0.84.3 awaits these handlers in registration order.
		api.api.on("agent_settled", () => {
			overlap = gitRunning;
			order.push("later-extension");
		});

		await api.emit("input", { type: "input", text: "direct", source: "interactive" }, ctx);
		await api.emit("agent_start", { type: "agent_start" }, ctx);
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
		await api.emit(
			"message_start",
			{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "direct" }] } },
			ctx,
		);
		await api.emit("turn_end", { type: "turn_end", turnIndex: 0 }, ctx);
		const settlement = api.emit("agent_settled", { type: "agent_settled" }, ctx);
		await gitEntered.promise;
		expect(order).toEqual(["git-start"]);

		releaseGit.resolve();
		await settlement;
		expect(overlap).toBe(false);
		expect(order).toEqual(["git-start", "git-complete", "later-extension"]);
	});

	test("does not refresh Git for a direct input handled before Pi starts a turn", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const ctx = createContext(new UiHarness());
		await api.start(ctx);

		await api.emit("input", { type: "input", text: "/handled", source: "interactive" }, ctx);
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
		await api.emit(
			"message_start",
			{
				type: "message_start",
				message: withAgentWorkOrigin(
					{ role: "custom", customType: "automatic-work", content: "continue" },
					"automatic",
				),
			},
			ctx,
		);
		await api.emit("turn_end", { type: "turn_end", turnIndex: 0 }, ctx);
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(0);
	});

	test("does not refresh Git for a steer handled before Pi delivers it", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		api.api.on("input", (event) =>
			Check(INPUT_EVENT_SCHEMA, event) && event.text === "handled correction" && event.source === "interactive"
				? { action: "handled" as const }
				: undefined,
		);
		const ctx = createContext(new UiHarness());
		await api.start(ctx);

		await api.emit("input", { type: "input", text: "automatic", source: "extension" }, ctx);
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
		await api.emit(
			"message_start",
			{
				type: "message_start",
				message: withAgentWorkOrigin(
					{ role: "custom", customType: "automatic-work", content: "continue" },
					"automatic",
				),
			},
			ctx,
		);
		await api.emit(
			"input",
			{ type: "input", text: "handled correction", source: "interactive", streamingBehavior: "steer" },
			ctx,
		);
		await api.emit(
			"input",
			{ type: "input", text: "handled correction", source: "extension", streamingBehavior: "steer" },
			ctx,
		);
		await api.emit(
			"message_start",
			{ type: "message_start", message: { role: "user", content: "handled correction" } },
			ctx,
		);
		await api.emit("turn_end", { type: "turn_end", turnIndex: 0 }, ctx);
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(0);
	});

	test("fails closed when a later Extension makes steer attribution ambiguous", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const ctx = createContext(new UiHarness());
		await api.start(ctx);
		// Registered after session_start, this simulates a separately loaded
		// Extension that Pi visits after Pi Stuff's Package-local late observer.
		api.api.on("input", (event) => {
			const text = Check(INPUT_EVENT_SCHEMA, event) ? event.text : undefined;
			if (text === "handled user correction") return { action: "handled" as const };
			if (text === "raw automatic correction") {
				return { action: "transform" as const, text: "transformed automatic correction" };
			}
			return undefined;
		});

		await api.emit("input", { type: "input", text: "automatic run", source: "extension" }, ctx);
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
		await api.emit(
			"message_start",
			{
				type: "message_start",
				message: withAgentWorkOrigin(
					{ role: "custom", customType: "automatic-work", content: "continue" },
					"automatic",
				),
			},
			ctx,
		);
		await api.emit(
			"input",
			{ type: "input", text: "handled user correction", source: "interactive", streamingBehavior: "steer" },
			ctx,
		);
		await api.emit(
			"input",
			{ type: "input", text: "raw automatic correction", source: "extension", streamingBehavior: "steer" },
			ctx,
		);
		await api.emit(
			"message_start",
			{ type: "message_start", message: { role: "user", content: "transformed automatic correction" } },
			ctx,
		);
		await api.emit("turn_end", { type: "turn_end", turnIndex: 0 }, ctx);
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);

		expect(api.execCalls).toHaveLength(0);
	});

	test("attributes marked custom work at delivery and accepted Suite steers immediately", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const ctx = createContext(new UiHarness());
		await api.start(ctx);

		const queued = withAgentWorkOrigin(
			{ role: "custom", customType: "explicit-user-action", content: "continue" },
			"user",
		);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("automatic");
		await api.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1 }, ctx);
		await api.emit("message_start", { type: "message_start", message: queued }, ctx);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("user");
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(1);

		await api.emit("input", { type: "input", text: "automatic", source: "extension" }, ctx);
		promoteActiveAgentWorkToUser(api.api);
		expect(readCurrentAgentWorkOrigin(api.api)).toBe("user");
		await api.emit("agent_settled", { type: "agent_settled" }, ctx);
		expect(api.execCalls).toHaveLength(2);
	});

	test("refreshes Git for completed user work only at an idle boundary in the active generation", async () => {
		const events = new EventBusHarness();
		const first = createApiHarness(events);
		await piStuffUi(first.api);
		requestStatuslineGitRefreshAfterUserWork(first.api);
		expect(first.execCalls).toEqual([]);

		let idle = false;
		let pendingMessages = false;
		const firstContext = createContext(new UiHarness(), "tui", {
			hasPendingMessages: () => pendingMessages,
			isIdle: () => idle,
		});
		await first.start(firstContext);
		requestStatuslineGitRefreshAfterUserWork(first.api);
		idle = true;
		pendingMessages = true;
		requestStatuslineGitRefreshAfterUserWork(first.api);
		expect(first.execCalls).toHaveLength(0);
		pendingMessages = false;
		await first.emit("agent_settled", { type: "agent_settled" }, firstContext);
		expect(first.execCalls).toHaveLength(1);
		await drainMicrotasks();
		requestStatuslineGitRefreshAfterUserWork(first.api);
		await drainMicrotasks();
		expect(first.execCalls).toHaveLength(2);

		await first.shutdown(firstContext);
		requestStatuslineGitRefreshAfterUserWork(first.api);
		expect(first.execCalls).toHaveLength(2);

		const reloaded = createApiHarness(events);
		await piStuffUi(reloaded.api);
		await reloaded.start(createContext(new UiHarness()));
		requestStatuslineGitRefreshAfterUserWork(reloaded.api);
		await drainMicrotasks();
		expect(first.execCalls).toHaveLength(2);
		expect(reloaded.execCalls).toHaveLength(1);

		await reloaded.shutdown(createContext(new UiHarness()));
		requestStatuslineGitRefreshAfterUserWork(reloaded.api);
		expect(reloaded.execCalls).toHaveLength(1);
	});
});

describe("Command Dialog coordinator", () => {
	test("shares and restores the Suite footer across real per-extension event API wrappers", async () => {
		const bus = new EventBusHarness();
		const suite = createApiHarness(eventBusView(bus));
		const independentExtension = createApiHarness(eventBusView(bus));
		await piStuffUi(suite.api);
		const suiteCoordinator = getCommandDialogCoordinator(suite.api);
		const externalCoordinator = getCommandDialogCoordinator(independentExtension.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await suite.start(ctx);
		const normalFooter = ui.footerWrites.at(-1);
		if (!normalFooter) throw new Error("Expected the normal Suite footer");

		expect(externalCoordinator).toBe(suiteCoordinator);
		let viewContext: CommandDialogViewContext | undefined;
		const shown = externalCoordinator.show(ctx, {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return new TestComponent("independent extension");
			},
		});
		if (!viewContext) throw new Error("Expected the independent extension dialog to mount");
		viewContext.close();
		await shown;

		expect(ui.footerWrites.at(-1)).toBe(normalFooter);
	});

	test("is a WeakMap singleton for one Extension event bus and ignores non-TUI contexts", async () => {
		const events = new EventBusHarness();
		const first = createApiHarness(events);
		const second = createApiHarness(events);
		const other = createApiHarness(new EventBusHarness());
		const coordinator = getCommandDialogCoordinator(first.api);

		expect(getCommandDialogCoordinator(second.api)).toBe(coordinator);
		expect(getCommandDialogCoordinator(other.api)).not.toBe(coordinator);
		const firstCoordinatorHandlerCount = first.shutdownHandlers.length;
		const secondCoordinatorHandlerCount = second.shutdownHandlers.length;
		expect(firstCoordinatorHandlerCount).toBeGreaterThan(0);
		expect(secondCoordinatorHandlerCount).toBeGreaterThan(0);
		await piStuffUi(first.api);
		const installedHandlerCount = first.shutdownHandlers.length;
		expect(installedHandlerCount).toBeGreaterThan(firstCoordinatorHandlerCount);
		await piStuffUi(first.api);
		expect(first.shutdownHandlers).toHaveLength(installedHandlerCount);

		const ui = new UiHarness();
		const result = await coordinator.show(createContext(ui, "rpc"), {
			priority: "normal",
			create: () => new TestComponent("never mounted"),
		});
		expect(result).toBeUndefined();
		expect(ui.hostCalls).toHaveLength(0);
	});

	test("starts a reload generation with fresh chrome and a newly bound shutdown lifecycle", async () => {
		const events = new EventBusHarness();
		const first = createApiHarness(events);
		await piStuffUi(first.api);
		const coordinator = getCommandDialogCoordinator(first.api);
		const oldChromeWrites: boolean[] = [];
		const unregisterOld = coordinator.registerChrome("todo", {
			setSuppressed: (suppressed) => oldChromeWrites.push(suppressed),
		});
		await first.shutdown(createContext(new UiHarness()));

		const reloaded = createApiHarness(events);
		await piStuffUi(reloaded.api);
		const reloadedCoordinator = getCommandDialogCoordinator(reloaded.api);
		expect(reloadedCoordinator).not.toBe(coordinator);
		const newChromeWrites: boolean[] = [];
		reloadedCoordinator.registerChrome("todo", {
			setSuppressed: (suppressed) => newChromeWrites.push(suppressed),
		});
		unregisterOld();

		const ui = new UiHarness();
		let viewContext: CommandDialogViewContext | undefined;
		const shown = reloadedCoordinator.show(createContext(ui), {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return new TestComponent("reloaded");
			},
		});
		expect(oldChromeWrites).toEqual([]);
		expect(newChromeWrites).toEqual([true]);
		if (!viewContext) throw new Error("Expected reloaded view context");
		viewContext.close();
		await shown;
		await drainMicrotasks();
		expect(newChromeWrites).toEqual([true, false]);
	});

	test("shares one /ui registry across distinct Package APIs in one Host generation", async () => {
		const events = new EventBusHarness();
		const toolsApi = createApiHarness(eventBusView(events));
		const uiApi = createApiHarness(eventBusView(events));
		const toolsRegistry = ensureUiSettingsCommand(toolsApi.api);
		toolsRegistry.register({
			description: "Timer",
			get: () => "true",
			id: "toolRunningTimer",
			label: "Tool running timer",
			order: 50,
			set: async () => {},
			subscribe: () => () => {},
			values: ["true", "false"],
		});
		const uiRegistry = ensureUiSettingsCommand(uiApi.api);
		uiRegistry.register({
			description: "Statusline",
			get: () => "true",
			id: "statusline",
			label: "Statusline",
			order: 10,
			set: async () => {},
			subscribe: () => () => {},
			values: ["true", "false"],
		});

		expect(uiRegistry).toBe(toolsRegistry);
		expect(uiRegistry.list().map((setting) => setting.id)).toEqual(["statusline", "toolRunningTimer"]);
		expect(toolsApi.registeredCommands).toEqual(["ui"]);
		expect(uiApi.registeredCommands).toEqual([]);
	});

	test("owns one non-overlay host and restores the draft, footer, working row, and chrome", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		const normalFooter = ui.footerWrites.at(-1);
		if (!normalFooter) throw new Error("Expected the normal Suite footer");
		const chromeWrites: boolean[] = [];
		const unregister = coordinator.registerChrome("todo", {
			setSuppressed: (suppressed) => chromeWrites.push(suppressed),
		});
		let viewContext: CommandDialogViewContext<string> | undefined;
		const component = new TestComponent("normal");

		const resultPromise = coordinator.show<string>(ctx, {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return component;
			},
		});

		expect(ui.hostCalls).toHaveLength(1);
		expect(ui.hostCalls[0]?.options).toEqual({ overlay: false });
		expect(ui.editorWrites).toEqual([""]);
		expect(ui.workingWrites).toEqual([false]);
		expect(chromeWrites).toEqual([true]);
		const footerFactory = ui.footerWrites[1];
		expect(footerFactory).toBeTypeOf("function");
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		expect(footerFactory?.(ui.tui, ui.theme, {} as never).render(80)).toEqual([]);
		expect(ui.currentHost.render(80)).toEqual(["normal"]);
		expect(ui.renderRequests).toEqual([undefined]);

		const mountedContext = viewContext;
		if (!mountedContext) throw new Error("Expected the normal view to mount");
		expect(mountedContext.tui).toBe(ui.tui);
		expect(mountedContext.theme).toBe(ui.theme);
		expect(mountedContext.keybindings).toBe(ui.keybindings);
		mountedContext.requestRender(true);
		expect(ui.renderRequests.at(-1)).toBe(true);
		mountedContext.close("accepted");
		expect(await resultPromise).toBe("accepted");
		await drainMicrotasks();

		expect(mountedContext.signal.aborted).toBe(true);
		expect(component.disposeCalls).toBe(1);
		expect(ui.hostCalls[0]?.doneCalls).toBe(1);
		expect(ui.footerWrites.at(-1)).toBe(normalFooter);
		expect(ui.workingWrites).toEqual([false, true]);
		expect(ui.editorWrites).toEqual(["", "saved draft"]);
		expect(chromeWrites).toEqual([true, false]);
		expect(ui.forbiddenCalls).toEqual([]);

		mountedContext.close("late");
		expect(ui.hostCalls[0]?.doneCalls).toBe(1);
		unregister();
	});

	test("does not restore an already submitted slash command when the caller opts out", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		ui.editorText = "/ctx";
		const ctx = createContext(ui);
		await api.start(ctx);
		let viewContext: CommandDialogViewContext | undefined;

		const shown = coordinator.show(
			ctx,
			{
				priority: "normal",
				create: (context) => {
					viewContext = context;
					return new TestComponent("command dialog");
				},
			},
			{ restoreDraft: false },
		);
		if (!viewContext) throw new Error("Expected the command dialog to mount");
		viewContext.close();
		await shown;

		expect(ui.editorText).toBe("");
		expect(ui.editorWrites).toEqual([""]);
	});

	test("forwards host focus to the active dialog component", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		let viewContext: CommandDialogViewContext | undefined;
		const component = new FocusableTestComponent("input dialog");

		const shown = coordinator.show(ctx, {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return component;
			},
		});
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		const host = ui.currentHost as CommandDialogComponent & { focused: boolean };
		host.focused = true;
		expect(component.focused).toBeTrue();
		host.focused = false;
		expect(component.focused).toBeFalse();

		if (!viewContext) throw new Error("Expected the dialog to mount");
		viewContext.close();
		await shown;
	});

	test("restores the Suite-owned working visibility that preceded the dialog", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		coordinator.setWorkingVisible(ctx, false);
		let viewContext: CommandDialogViewContext | undefined;

		const shown = coordinator.show(ctx, {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return new TestComponent("normal");
			},
		});
		if (!viewContext) throw new Error("Expected the dialog to mount");
		viewContext.close();
		await shown;

		expect(ui.workingWrites.at(-1)).toBe(false);
	});

	test("restores footer and working updates made while the dialog owns Pi UI", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		const initialFooter = ui.footerWrites.at(-1);
		if (!initialFooter) throw new Error("Expected the initial Suite footer");
		let viewContext: CommandDialogViewContext | undefined;
		const shown = coordinator.show(ctx, {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return new TestComponent("normal");
			},
		});
		if (!viewContext) throw new Error("Expected the dialog to mount");
		const writesWhileOwned = ui.footerWrites.length;
		const updatedFooter: FooterFactory = () => new TestComponent("updated footer");

		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		(
			coordinator as typeof coordinator & {
				installFooter(context: ExtensionContext, factory: NonNullable<FooterFactory>): void;
			}
		).installFooter(ctx, updatedFooter);
		coordinator.setWorkingVisible(ctx, false);

		expect(ui.footerWrites).toHaveLength(writesWhileOwned);
		viewContext.close();
		await shown;

		const restoredFooter = ui.footerWrites.at(-1);
		expect(restoredFooter).not.toBe(initialFooter);
		// SAFETY: this test controls the fixture or result and exercises every member of the asserted contract.
		expect(restoredFooter?.(ui.tui, ui.theme, {} as never).render(80)).toEqual(["updated footer"]);
		expect(ui.workingWrites).toEqual([false, false]);
	});

	test("restores the Suite footer when Pi supplies a fresh UI context wrapper", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const startupContext = createContext(ui);
		await api.start(startupContext);
		const normalFooter = ui.footerWrites.at(-1);
		if (!normalFooter) throw new Error("Expected the normal Suite footer");
		// SAFETY: this test fixture implements the exact Host surface exercised by this case.
		const commandContext = {
			...startupContext,
			ui: new Proxy(startupContext.ui, {}),
		} as ExtensionContext;
		let viewContext: CommandDialogViewContext | undefined;

		const shown = coordinator.show(commandContext, {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return new TestComponent("normal");
			},
		});
		if (!viewContext) throw new Error("Expected the dialog to mount");
		viewContext.close();
		await shown;

		expect(ui.footerWrites.at(-1)).toBe(normalFooter);
	});

	test("settles the final view only after host chrome and the saved draft are restored", async () => {
		const api = createApiHarness();
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		let viewContext: CommandDialogViewContext | undefined;
		const shown = coordinator.show(createContext(ui), {
			priority: "normal",
			create: (context) => {
				viewContext = context;
				return new TestComponent("normal");
			},
		});
		const continued = shown.then(() => ui.setEditorText("next draft"));

		if (!viewContext) throw new Error("Expected the normal view to mount");
		viewContext.close();
		await continued;

		expect(ui.editorText).toBe("next draft");
		expect(ui.editorWrites).toEqual(["", "saved draft", "next draft"]);
		expect(ui.footerWrites.at(-1)).toBeUndefined();
		expect(ui.workingWrites).toEqual([false, true]);
	});

	test("does not mount a view twice when its factory synchronously queues a blocker", async () => {
		const api = createApiHarness();
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		const normal = new TestComponent("normal");
		const blocker = new TestComponent("blocker");
		let normalContext: CommandDialogViewContext | undefined;
		let blockerContext: CommandDialogViewContext | undefined;
		let blockerPromise: Promise<unknown> | undefined;
		let normalCreateCalls = 0;
		let blockerCreateCalls = 0;

		const normalPromise = coordinator.show(ctx, {
			priority: "normal",
			create: (context) => {
				normalCreateCalls += 1;
				normalContext = context;
				blockerPromise = coordinator.show(ctx, {
					priority: "blocking",
					create: (blockingContext) => {
						blockerCreateCalls += 1;
						blockerContext = blockingContext;
						return blocker;
					},
				});
				return normal;
			},
		});

		expect(normalCreateCalls).toBe(1);
		expect(blockerCreateCalls).toBe(1);
		expect(ui.currentHost.render(80)).toEqual(["blocker"]);
		if (!blockerContext || !blockerPromise) throw new Error("Expected the synchronous blocker to mount");
		blockerContext.close();
		await blockerPromise;
		expect(ui.currentHost.render(80)).toEqual(["normal"]);
		if (!normalContext) throw new Error("Expected the normal view to mount");
		normalContext.close();
		await normalPromise;
		expect(normal.disposeCalls).toBe(1);
		expect(blocker.disposeCalls).toBe(1);
	});

	test("preempts a normal view with FIFO blockers, then resumes the same component", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		const normalFooter = ui.footerWrites.at(-1);
		if (!normalFooter) throw new Error("Expected the normal Suite footer");
		const components = new Map<string, TestComponent>();
		const contexts = new Map<string, CommandDialogViewContext<string>>();

		const normalPromise = coordinator.show(ctx, createView("normal", "normal", components, contexts));
		const firstBlockingPromise = coordinator.show(ctx, createView("blocking-1", "blocking", components, contexts));
		const secondBlockingPromise = coordinator.show(ctx, createView("blocking-2", "blocking", components, contexts));

		expect(ui.hostCalls).toHaveLength(1);
		expect(ui.footerWrites).toHaveLength(2);
		expect(ui.currentHost.render(80)).toEqual(["blocking-1"]);
		const normalContext = contexts.get("normal");
		const firstContext = contexts.get("blocking-1");
		const secondContext = contexts.get("blocking-2");
		if (!normalContext || !firstContext || !secondContext) throw new Error("Expected every queued view to mount");
		expect(new Set([normalContext.signal, firstContext.signal, secondContext.signal]).size).toBe(3);
		expect(normalContext.signal.aborted).toBe(false);
		expect(components.get("normal")?.disposeCalls).toBe(0);

		firstContext.close("first");
		expect(await firstBlockingPromise).toBe("first");
		expect(ui.currentHost.render(80)).toEqual(["blocking-2"]);
		firstContext.close("late first");
		expect(ui.currentHost.render(80)).toEqual(["blocking-2"]);
		expect(secondContext.signal.aborted).toBe(false);

		secondContext.close("second");
		expect(await secondBlockingPromise).toBe("second");
		expect(ui.currentHost.render(80)).toEqual(["normal"]);
		expect(normalContext.signal.aborted).toBe(false);
		expect(components.get("normal")?.disposeCalls).toBe(0);
		ui.currentHost.handleInput?.("n");
		expect(components.get("normal")?.input).toEqual(["n"]);
		expect(ui.renderRequests).not.toContain(true);

		normalContext.close("normal result");
		expect(await normalPromise).toBe("normal result");
		await drainMicrotasks();
		expect(ui.hostCalls).toHaveLength(1);
		expect(normalContext.signal.aborted).toBe(true);
		expect(components.get("normal")?.disposeCalls).toBe(1);
		expect(ui.footerWrites.at(-1)).toBe(normalFooter);
	});

	test("reports idle only after a preempted view closes and all shared chrome is restored", async () => {
		const api = createApiHarness();
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		ui.autoResolveOnDone = false;
		ui.editorText = "draft before dialog";
		const ctx = createContext(ui);
		const components = new Map<string, TestComponent>();
		const contexts = new Map<string, CommandDialogViewContext<string>>();
		const todoWrites: boolean[] = [];
		const agentWrites: boolean[] = [];
		coordinator.registerChrome("todo", {
			setSuppressed: (suppressed) => todoWrites.push(suppressed),
		});
		coordinator.registerChrome("agents", {
			setSuppressed: (suppressed) => agentWrites.push(suppressed),
		});

		const normal = coordinator.show(ctx, createView("btw", "normal", components, contexts));
		const blocker = coordinator.show(ctx, createView("permission", "blocking", components, contexts));
		let idleSettled = false;
		const idle = coordinator.whenIdle().then(() => {
			idleSettled = true;
		});

		expect(ui.currentHost.render(80)).toEqual(["permission"]);
		expect(todoWrites).toEqual([true]);
		expect(agentWrites).toEqual([true]);
		expect(ui.editorText).toBe("");
		const normalComponent = components.get("btw");
		const blockingContext = contexts.get("permission");
		if (!normalComponent || !blockingContext) throw new Error("Expected both views to mount");

		blockingContext.close("denied");
		expect(await blocker).toBe("denied");
		expect(ui.currentHost.render(80)).toEqual(["btw"]);
		expect(components.get("btw")).toBe(normalComponent);
		await drainMicrotasks();
		expect(idleSettled).toBe(false);

		const normalContext = contexts.get("btw");
		if (!normalContext) throw new Error("Expected the normal view to resume");
		normalContext.close("dismissed");
		await drainMicrotasks();
		expect(idleSettled).toBe(false);
		expect(ui.editorText).toBe("");
		expect(todoWrites).toEqual([true]);
		expect(agentWrites).toEqual([true]);

		ui.settleCurrentDone();
		expect(await normal).toBe("dismissed");
		await idle;
		expect(idleSettled).toBe(true);
		expect(ui.editorText).toBe("draft before dialog");
		expect(todoWrites).toEqual([true, false]);
		expect(agentWrites).toEqual([true, false]);
	});

	test("session shutdown aborts and dismisses every view before restoring UI", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		const normalFooter = ui.footerWrites.at(-1);
		if (!normalFooter) throw new Error("Expected the normal Suite footer");
		const components = new Map<string, TestComponent>();
		const contexts = new Map<string, CommandDialogViewContext<string>>();
		const chromeWrites: boolean[] = [];
		coordinator.registerChrome("roster", {
			setSuppressed: (suppressed) => chromeWrites.push(suppressed),
		});

		const normalPromise = coordinator.show(ctx, createView("normal", "normal", components, contexts));
		const blockingPromise = coordinator.show(ctx, createView("blocking", "blocking", components, contexts));
		const queuedPromise = coordinator.show(ctx, createView("queued", "blocking", components, contexts));
		await api.shutdown(ctx);

		expect(await Promise.all([normalPromise, blockingPromise, queuedPromise])).toEqual([
			undefined,
			undefined,
			undefined,
		]);
		for (const context of contexts.values()) expect(context.signal.aborted).toBe(true);
		for (const component of components.values()) expect(component.disposeCalls).toBe(1);
		expect(ui.hostCalls[0]?.doneCalls).toBe(1);
		expect(ui.editorText).toBe("saved draft");
		expect(normalFooter).toBeTypeOf("function");
		expect(ui.footerWrites.at(-1)).toBeUndefined();
		expect(ui.workingWrites).toEqual([false, true]);
		expect(chromeWrites).toEqual([true, false]);

		contexts.get("blocking")?.close("late");
		expect(ui.hostCalls[0]?.doneCalls).toBe(1);
	});

	test("restores the exact Suite footer after a custom Host failure", async () => {
		const api = createApiHarness();
		await piStuffUi(api.api);
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		await api.start(ctx);
		const normalFooter = ui.footerWrites.at(-1);
		if (!normalFooter) throw new Error("Expected the normal Suite footer");

		const failed = coordinator.show(ctx, {
			priority: "normal",
			create: () => new TestComponent("failed host"),
		});
		ui.rejectCurrent(new Error("custom failed"));

		await expect(failed).rejects.toThrow("custom failed");
		expect(ui.footerWrites.at(-1)).toBe(normalFooter);
		expect(ui.workingWrites).toEqual([false, true]);
	});

	test("does not reopen a deferred or late view after shutdown begins", async () => {
		const api = createApiHarness();
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		ui.autoResolveOnDone = false;
		const ctx = createContext(ui);
		const components = new Map<string, TestComponent>();
		const contexts = new Map<string, CommandDialogViewContext<void>>();
		const first = coordinator.show(ctx, createView("first", "normal", components, contexts));

		const shutdown = api.shutdown(ctx);
		await drainMicrotasks();
		const late = coordinator.show(ctx, createView("late", "normal", components, contexts));
		expect(await late).toBeUndefined();
		expect(components.has("late")).toBe(false);
		expect(ui.hostCalls).toHaveLength(1);

		ui.settleCurrentDone();
		await shutdown;
		expect(await first).toBeUndefined();
		await drainMicrotasks();
		expect(ui.hostCalls).toHaveLength(1);

		const reloaded = createApiHarness(api.api.events);
		const reloadedCoordinator = getCommandDialogCoordinator(reloaded.api);
		expect(reloadedCoordinator).not.toBe(coordinator);
		const reloadedUi = new UiHarness();
		let reloadedContext: CommandDialogViewContext | undefined;
		const reopened = reloadedCoordinator.show(createContext(reloadedUi), {
			priority: "normal",
			create: (context) => {
				reloadedContext = context;
				return new TestComponent("standalone reload");
			},
		});
		if (!reloadedContext) throw new Error("Expected a standalone reload view");
		reloadedContext.close();
		await reopened;
	});

	test("preserves show order across host cleanup and final-view continuations", async () => {
		const api = createApiHarness();
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		ui.autoResolveOnDone = false;
		const ctx = createContext(ui);
		const createOrder: string[] = [];
		const contexts = new Map<string, CommandDialogViewContext>();
		const view = (label: string): CommandDialogView => ({
			priority: "normal",
			create: (context) => {
				createOrder.push(label);
				contexts.set(label, context);
				return new TestComponent(label);
			},
		});

		const first = coordinator.show(ctx, view("A"));
		let third: Promise<unknown> | undefined;
		const continued = first.then(() => {
			third = coordinator.show(ctx, view("C"));
			return third;
		});
		const firstContext = contexts.get("A");
		if (!firstContext) throw new Error("Expected A to mount");
		firstContext.close();
		const second = coordinator.show(ctx, view("B"));

		ui.settleCurrentDone();
		await drainMicrotasks();
		expect(createOrder).toEqual(["A", "B", "C"]);
		expect(ui.currentHost.render(80)).toEqual(["B"]);

		const secondContext = contexts.get("B");
		if (!secondContext) throw new Error("Expected B to mount");
		secondContext.close();
		await second;
		expect(ui.currentHost.render(80)).toEqual(["C"]);
		const thirdContext = contexts.get("C");
		if (!thirdContext || !third) throw new Error("Expected C to mount");
		ui.autoResolveOnDone = true;
		thirdContext.close();
		await continued;
	});

	test("runs every restoration after host failure and starts a new host only after prior cleanup", async () => {
		const api = createApiHarness();
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		const chromeWrites: boolean[] = [];
		coordinator.registerChrome("throwing", {
			setSuppressed: (suppressed) => {
				chromeWrites.push(suppressed);
				if (!suppressed) throw new Error("chrome restore failed");
			},
		});
		ui.throwOnFooterRestore = true;
		const failed = coordinator.show(ctx, {
			priority: "normal",
			create: () => new TestComponent("failed host"),
		});
		ui.rejectCurrent(new Error("custom failed"));

		await expect(failed).rejects.toThrow("custom failed");
		await drainMicrotasks();
		expect(ui.workingWrites).toEqual([false, true]);
		expect(ui.editorWrites).toEqual(["", "saved draft"]);
		expect(chromeWrites).toEqual([true, false]);

		ui.throwOnFooterRestore = false;
		ui.autoResolveOnDone = false;
		let firstContext: CommandDialogViewContext | undefined;
		const first = coordinator.show(ctx, {
			priority: "normal",
			create: (context) => {
				firstContext = context;
				return new TestComponent("first");
			},
		});
		if (!firstContext) throw new Error("Expected first view context");
		firstContext.close();
		let secondContext: CommandDialogViewContext | undefined;
		const second = coordinator.show(ctx, {
			priority: "normal",
			create: (context) => {
				secondContext = context;
				return new TestComponent("second");
			},
		});
		expect(ui.hostCalls).toHaveLength(2);
		expect(secondContext).toBeUndefined();

		ui.settleCurrentDone();
		await first;
		await drainMicrotasks();
		expect(ui.hostCalls).toHaveLength(3);
		if (!secondContext) throw new Error("Expected second view context after cleanup");
		ui.autoResolveOnDone = true;
		secondContext.close();
		await second;
	});
});
