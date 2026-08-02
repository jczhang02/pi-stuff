import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import piStuffUi, {
	type CommandDialogComponent,
	type CommandDialogPriority,
	type CommandDialogView,
	type CommandDialogViewContext,
	getCommandDialogCoordinator,
} from "../../packages/pi-stuff-ui/index.js";

type FooterFactory = Parameters<ExtensionUIContext["setFooter"]>[0];
type ShutdownHandler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

interface TestDeferred<Value> {
	readonly promise: Promise<Value>;
	reject(reason: unknown): void;
	resolve(value: Value): void;
}

interface HostCall {
	component: CommandDialogComponent | undefined;
	doneCalls: number;
	doneRequested: boolean;
	readonly options: { overlay?: boolean } | undefined;
	reject(reason: unknown): void;
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

class UiHarness {
	autoResolveOnDone = true;
	editorText = "saved draft";
	readonly editorWrites: string[] = [];
	readonly footerWrites: Array<FooterFactory | undefined> = [];
	readonly forbiddenCalls: string[] = [];
	readonly hostCalls: HostCall[] = [];
	readonly keybindings = { identity: "keybindings" } as unknown as KeybindingsManager;
	readonly renderRequests: Array<boolean | undefined> = [];
	readonly theme = { identity: "theme" } as unknown as Theme;
	throwOnFooterRestore = false;
	readonly tui = {
		requestRender: (force?: boolean) => {
			this.renderRequests.push(force);
		},
	} as unknown as TUI;
	readonly workingWrites: boolean[] = [];

	get currentHost(): CommandDialogComponent {
		const host = this.hostCalls.at(-1)?.component;
		if (!host) throw new Error("Expected a mounted Command Dialog host");
		return host;
	}

	custom<Result>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
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

	setEditorText(text: string): void {
		this.editorText = text;
		this.editorWrites.push(text);
	}

	setFooter(factory: FooterFactory | undefined): void {
		this.footerWrites.push(factory);
		if (factory === undefined && this.throwOnFooterRestore) throw new Error("footer restore failed");
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

	rejectCurrent(reason: unknown): void {
		const call = this.hostCalls.at(-1);
		if (!call) throw new Error("Expected an active custom call");
		call.reject(reason);
	}

	settleCurrentDone(): void {
		const call = this.hostCalls.at(-1);
		if (!call) throw new Error("Expected an active custom call");
		call.settleDone();
	}
}

function createApiHarness(events: object = {}) {
	const shutdownHandlers: ShutdownHandler[] = [];
	const api = {
		events,
		on: (event: string, handler: ShutdownHandler) => {
			if (event === "session_shutdown") shutdownHandlers.push(handler);
		},
	} as unknown as ExtensionAPI;

	return {
		api,
		shutdownHandlers,
		async shutdown(ctx: ExtensionContext): Promise<void> {
			for (const handler of shutdownHandlers) {
				await handler({ reason: "quit", type: "session_shutdown" }, ctx);
			}
		},
	};
}

function createContext(ui: UiHarness, mode: ExtensionContext["mode"] = "tui"): ExtensionContext {
	return { mode, ui: ui as unknown as ExtensionUIContext } as unknown as ExtensionContext;
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

function createDeferred<Value>(): TestDeferred<Value> {
	let resolvePromise: (value: Value) => void = () => {};
	let rejectPromise: (reason: unknown) => void = () => {};
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, reject: rejectPromise, resolve: resolvePromise };
}

describe("Command Dialog coordinator", () => {
	test("is a WeakMap singleton for one Extension event bus and ignores non-TUI contexts", async () => {
		const events = {};
		const first = createApiHarness(events);
		const second = createApiHarness(events);
		const other = createApiHarness({});
		const coordinator = getCommandDialogCoordinator(first.api);

		expect(getCommandDialogCoordinator(second.api)).toBe(coordinator);
		expect(getCommandDialogCoordinator(other.api)).not.toBe(coordinator);
		expect(first.shutdownHandlers).toHaveLength(1);
		expect(second.shutdownHandlers).toHaveLength(1);
		piStuffUi(first.api);
		expect(first.shutdownHandlers).toHaveLength(1);

		const ui = new UiHarness();
		const result = await coordinator.show(createContext(ui, "rpc"), {
			priority: "normal",
			create: () => new TestComponent("never mounted"),
		});
		expect(result).toBeUndefined();
		expect(ui.hostCalls).toHaveLength(0);
	});

	test("starts a reload generation with fresh chrome and a newly bound shutdown lifecycle", async () => {
		const events = {};
		const first = createApiHarness(events);
		piStuffUi(first.api);
		const coordinator = getCommandDialogCoordinator(first.api);
		const oldChromeWrites: boolean[] = [];
		const unregisterOld = coordinator.registerChrome("todo", {
			setSuppressed: (suppressed) => oldChromeWrites.push(suppressed),
		});

		const reloaded = createApiHarness(events);
		piStuffUi(reloaded.api);
		expect(reloaded.shutdownHandlers).toHaveLength(1);
		expect(getCommandDialogCoordinator(reloaded.api)).toBe(coordinator);
		const newChromeWrites: boolean[] = [];
		coordinator.registerChrome("todo", {
			setSuppressed: (suppressed) => newChromeWrites.push(suppressed),
		});
		unregisterOld();

		const ui = new UiHarness();
		let viewContext: CommandDialogViewContext | undefined;
		const shown = coordinator.show(createContext(ui), {
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

	test("owns one non-overlay host and restores the draft, footer, working row, and chrome", async () => {
		const api = createApiHarness();
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
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
		const footerFactory = ui.footerWrites[0];
		expect(typeof footerFactory).toBe("function");
		expect(footerFactory?.(ui.tui, ui.theme, {} as never).render(80)).toEqual([]);
		expect(ui.currentHost.render(80)).toEqual(["normal"]);

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
		expect(ui.footerWrites.at(-1)).toBeUndefined();
		expect(ui.workingWrites).toEqual([false, true]);
		expect(ui.editorWrites).toEqual(["", "saved draft"]);
		expect(chromeWrites).toEqual([true, false]);
		expect(ui.forbiddenCalls).toEqual([]);

		mountedContext.close("late");
		expect(ui.hostCalls[0]?.doneCalls).toBe(1);
		unregister();
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
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
		const components = new Map<string, TestComponent>();
		const contexts = new Map<string, CommandDialogViewContext<string>>();

		const normalPromise = coordinator.show(ctx, createView("normal", "normal", components, contexts));
		const firstBlockingPromise = coordinator.show(ctx, createView("blocking-1", "blocking", components, contexts));
		const secondBlockingPromise = coordinator.show(ctx, createView("blocking-2", "blocking", components, contexts));

		expect(ui.hostCalls).toHaveLength(1);
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

		normalContext.close("normal result");
		expect(await normalPromise).toBe("normal result");
		await drainMicrotasks();
		expect(ui.hostCalls).toHaveLength(1);
		expect(normalContext.signal.aborted).toBe(true);
		expect(components.get("normal")?.disposeCalls).toBe(1);
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
		const coordinator = getCommandDialogCoordinator(api.api);
		const ui = new UiHarness();
		const ctx = createContext(ui);
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
		expect(ui.workingWrites).toEqual([false, true]);
		expect(chromeWrites).toEqual([true, false]);

		contexts.get("blocking")?.close("late");
		expect(ui.hostCalls[0]?.doneCalls).toBe(1);
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
		expect(getCommandDialogCoordinator(reloaded.api)).toBe(coordinator);
		const reloadedUi = new UiHarness();
		let reloadedContext: CommandDialogViewContext | undefined;
		const reopened = coordinator.show(createContext(reloadedUi), {
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
