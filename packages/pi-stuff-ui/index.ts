import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { suppressDuplicatedLiveCompactionReplay } from "./compaction-presentation.js";
import { registerLiveThoughtDisplay } from "./live-thought.js";
import { installUiSessionPresentation, type UiSessionPresentation } from "./session-presentation.js";
import {
	beginUiSettingsGeneration,
	registerOwnedUiSettings,
	type UiSettingRegistry,
	UiSettingsStore,
} from "./settings.js";
import { createUiSettingsView } from "./ui-settings-dialog.js";

export {
	beginUiSettingsGeneration,
	getUiSettingRegistry,
	type RegisteredUiSetting,
	registerOwnedUiSettings,
	type UiSettingId,
	type UiSettingRegistry,
	type UiSettings,
	UiSettingsStore,
} from "./settings.js";
export {
	type CodexStatusChannel,
	type CodexStatusSnapshot,
	type CodexStatusSource,
	type GoalStatus,
	type GoalStatusChannel,
	type GoalStatusSnapshot,
	type GoalStatusSource,
	getCodexStatusChannel,
	getGoalStatusChannel,
} from "./statusline.js";

export type CommandDialogPriority = "blocking" | "normal";

export interface CommandDialogChrome {
	setSuppressed(suppressed: boolean): void;
}

export interface CommandDialogComponent extends Component {
	dispose?(): void;
}

export interface CommandDialogViewContext<Result = void> {
	readonly keybindings: KeybindingsManager;
	readonly signal: AbortSignal;
	readonly theme: Theme;
	readonly tui: TUI;
	close(result?: Result): void;
	requestRender(force?: boolean): void;
}

export interface CommandDialogView<Result = void> {
	readonly priority: CommandDialogPriority;
	create(context: CommandDialogViewContext<Result>): CommandDialogComponent;
}

export interface CommandDialogCoordinator {
	registerChrome(id: string, chrome: CommandDialogChrome): () => void;
	setWorkingVisible(ctx: ExtensionContext, visible: boolean): void;
	show<Result = void>(ctx: ExtensionContext, view: CommandDialogView<Result>): Promise<Result | undefined>;
	whenIdle(): Promise<void>;
}

export type FooterFactory = NonNullable<Parameters<ExtensionUIContext["setFooter"]>[0]>;

type DialogRequestState = "mounted" | "mounting" | "queued" | "settled";
type HostRunState = "closed" | "closing" | "open" | "opening";

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	reject(reason: unknown): void;
	resolve(value: Value): void;
}

interface HostScope {
	readonly keybindings: KeybindingsManager;
	readonly signal: AbortSignal;
	readonly theme: Theme;
	readonly tui: TUI;
	close(value: unknown): void;
	requestRender(force?: boolean): void;
}

interface DialogRequest {
	readonly controller: AbortController;
	readonly priority: CommandDialogPriority;
	component: CommandDialogComponent | undefined;
	state: DialogRequestState;
	mount(scope: HostScope): CommandDialogComponent;
	reject(reason: unknown): void;
	resolve(value: unknown): void;
}

interface ChromeRecord {
	readonly chrome: CommandDialogChrome;
}

interface HostRun {
	readonly blocking: DialogRequest[];
	readonly ctx: ExtensionContext;
	readonly finished: Deferred<void>;
	readonly normal: DialogRequest[];
	readonly pendingSettlements: Array<{ readonly outcome: RequestOutcome; readonly request: DialogRequest }>;
	readonly suppressedChrome: Set<ChromeRecord>;
	closeHost: (() => void) | undefined;
	closeHostCalled: boolean;
	draft: string;
	draftCaptured: boolean;
	host: CommandDialogHost | undefined;
	state: HostRunState;
}

interface NormalUiState {
	footer: FooterFactory | undefined;
	workingVisible: boolean;
}

type RequestOutcome =
	| { readonly kind: "reject"; readonly reason: unknown }
	| { readonly kind: "resolve"; readonly value: unknown };

class EmptyComponent implements Component {
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

class CommandDialogHost implements Component {
	private readonly coordinator: CommandDialogCoordinatorImplementation;
	private readonly keybindings: KeybindingsManager;
	private readonly run: HostRun;
	private readonly theme: Theme;
	private readonly tui: TUI;

	constructor(
		coordinator: CommandDialogCoordinatorImplementation,
		run: HostRun,
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
	) {
		this.coordinator = coordinator;
		this.keybindings = keybindings;
		this.run = run;
		this.theme = theme;
		this.tui = tui;
	}

	get wantsKeyRelease(): boolean {
		return this.activeComponent().wantsKeyRelease ?? false;
	}

	activate(): void {
		this.activeComponent();
		this.tui.requestRender();
	}

	dispose(): void {
		this.coordinator.dismissRun(this.run);
	}

	handleInput(data: string): void {
		this.activeComponent().handleInput?.(data);
	}

	invalidate(): void {
		this.activeComponent().invalidate();
	}

	render(width: number): string[] {
		return this.activeComponent().render(width);
	}

	requestRender(force?: boolean): void {
		this.tui.requestRender(force);
	}

	private activeComponent(): CommandDialogComponent {
		return this.coordinator.mountActiveRequest(this.run, this, this.tui, this.theme, this.keybindings);
	}
}

class CommandDialogCoordinatorImplementation implements CommandDialogCoordinator {
	private readonly chrome = new Map<string, ChromeRecord>();
	private readonly boundApis = new WeakSet<ExtensionAPI>();
	private activeRun: HostRun | undefined;
	private accepting = true;
	private generation = 0;
	private generationActive = false;
	private readonly normalUiState: NormalUiState = { footer: undefined, workingVisible: true };

	bind(pi: ExtensionAPI): void {
		if (this.boundApis.has(pi)) return;
		this.boundApis.add(pi);
		pi.on("session_shutdown", async () => {
			await this.shutdown();
		});
	}

	ensureGeneration(pi: ExtensionAPI): void {
		this.bind(pi);
		if (this.generationActive) return;

		this.generationActive = true;
		this.accepting = true;
		this.generation += 1;
		const run = this.activeRun;
		if (run) this.dismissRun(run);
		this.chrome.clear();
	}

	registerChrome(id: string, chrome: CommandDialogChrome): () => void {
		if (id.length === 0) throw new Error("Command Dialog chrome id must not be empty");
		const previous = this.chrome.get(id);
		const record = { chrome };
		this.chrome.set(id, record);
		const run = this.activeRun;
		if (run && (run.state === "opening" || run.state === "open")) {
			if (previous && run.suppressedChrome.delete(previous)) {
				this.setChromeSuppressed(previous, false);
			}
			run.suppressedChrome.add(record);
			this.setChromeSuppressed(record, true);
		}

		let registered = true;
		return () => {
			if (!registered) return;
			registered = false;
			if (this.chrome.get(id) !== record) return;
			this.chrome.delete(id);

			const currentRun = this.activeRun;
			if (!currentRun?.suppressedChrome.delete(record)) return;
			this.setChromeSuppressed(record, false);
		};
	}

	installFooter(ctx: ExtensionContext, factory: FooterFactory): void {
		if (ctx.mode !== "tui") return;
		this.normalUiState.footer = factory;
		if (!this.runOwnsUi()) ctx.ui.setFooter(factory);
	}

	setWorkingVisible(ctx: ExtensionContext, visible: boolean): void {
		this.normalUiState.workingVisible = visible;
		if (!this.runOwnsUi()) ctx.ui.setWorkingVisible(visible);
	}

	show<Result = void>(ctx: ExtensionContext, view: CommandDialogView<Result>): Promise<Result | undefined> {
		if (ctx.mode !== "tui") return Promise.resolve(undefined);
		if (!this.accepting) return Promise.resolve(undefined);
		if (view.priority !== "normal" && view.priority !== "blocking") {
			return Promise.reject(new Error(`Unknown Command Dialog priority: ${String(view.priority)}`));
		}

		const generation = this.generation;
		const activeRun = this.activeRun;
		if (activeRun && (activeRun.state === "closing" || activeRun.state === "closed" || activeRun.ctx.ui !== ctx.ui)) {
			return activeRun.finished.promise.then(() => {
				if (!this.accepting || this.generation !== generation) return undefined;
				return this.show(ctx, view);
			});
		}

		const { promise, request } = createDialogRequest(view);
		if (activeRun) {
			this.enqueue(activeRun, request);
			activeRun.host?.activate();
			return promise;
		}

		const run = createHostRun(ctx);
		this.activeRun = run;
		this.enqueue(run, request);
		void this.openRun(run);
		return promise;
	}

	async whenIdle(): Promise<void> {
		while (this.activeRun) await this.activeRun.finished.promise;
	}

	dismissRun(run: HostRun): void {
		if (run.state === "closed") return;
		run.state = "closing";
		for (const request of [...run.blocking, ...run.normal]) {
			this.finishRequest(run, request, { kind: "resolve", value: undefined }, false);
		}
		this.closeHost(run);
	}

	mountActiveRequest(
		run: HostRun,
		host: CommandDialogHost,
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
	): CommandDialogComponent {
		for (const request of [...run.blocking, ...run.normal]) {
			if (request.state !== "queued") continue;
			request.state = "mounting";
			let component: CommandDialogComponent;
			try {
				component = request.mount({
					keybindings,
					signal: request.controller.signal,
					theme,
					tui,
					close: (value) => {
						this.finishRequest(run, request, { kind: "resolve", value }, true);
					},
					requestRender: (force) => {
						if (request.state === "settled" || this.activeRun !== run || run.state === "closing") return;
						host.requestRender(force);
					},
				});
			} catch (error) {
				if (!requestIsSettled(request)) {
					this.finishRequest(run, request, { kind: "reject", reason: error }, false);
				}
				continue;
			}

			if (requestIsSettled(request)) {
				disposeComponent(component);
				continue;
			}
			request.component = component;
			request.state = "mounted";
		}

		const active = this.activeRequest(run);
		if (active?.component) return active.component;
		if (active?.state === "mounting") return new EmptyComponent();
		this.beginClosing(run);
		return new EmptyComponent();
	}

	private activeRequest(run: HostRun): DialogRequest | undefined {
		return run.blocking[0] ?? run.normal[0];
	}

	private beginClosing(run: HostRun): void {
		if (run.state === "closing" || run.state === "closed") return;
		run.state = "closing";
		this.closeHost(run);
	}

	private closeHost(run: HostRun): void {
		if (run.closeHostCalled || !run.closeHost) return;
		run.closeHostCalled = true;
		try {
			run.closeHost();
		} catch {
			// Pi owns the host callback. Cleanup still runs if its Promise settles.
		}
	}

	private enqueue(run: HostRun, request: DialogRequest): void {
		const queue = request.priority === "blocking" ? run.blocking : run.normal;
		queue.push(request);
	}

	private failRun(run: HostRun, reason: unknown): void {
		if (run.state === "closed") return;
		run.state = "closing";
		for (const request of [...run.blocking, ...run.normal]) {
			this.finishRequest(run, request, { kind: "reject", reason }, false);
		}
		this.closeHost(run);
	}

	private finishRequest(run: HostRun, request: DialogRequest, outcome: RequestOutcome, refresh: boolean): void {
		if (request.state === "settled") return;
		request.state = "settled";
		removeRequest(run.blocking, request);
		removeRequest(run.normal, request);
		request.controller.abort();
		disposeComponent(request.component);
		request.component = undefined;

		if (run.state === "closing" || run.state === "closed" || !this.activeRequest(run)) {
			run.pendingSettlements.push({ outcome, request });
		} else {
			settleRequest(request, outcome);
		}

		if (!refresh || run.state === "closing" || run.state === "closed") return;
		if (this.activeRequest(run)) run.host?.activate();
		else this.beginClosing(run);
	}

	private async openRun(run: HostRun): Promise<void> {
		try {
			run.draft = run.ctx.ui.getEditorText();
			run.draftCaptured = true;
			run.ctx.ui.setEditorText("");
			run.ctx.ui.setFooter(() => new EmptyComponent());
			run.ctx.ui.setWorkingVisible(false);
			this.suppressChrome(run);

			await run.ctx.ui.custom<void>(
				(tui, theme, keybindings, done) => {
					run.closeHost = () => done();
					const host = new CommandDialogHost(this, run, tui, theme, keybindings);
					run.host = host;
					if (run.state === "opening") run.state = "open";
					host.activate();
					if (run.state === "closing") this.closeHost(run);
					return host;
				},
				{ overlay: false },
			);
		} catch (error) {
			this.failRun(run, error);
		} finally {
			this.dismissRun(run);
			this.restoreRun(run);
			run.state = "closed";
			run.host = undefined;
			if (this.activeRun === run) this.activeRun = undefined;
			run.finished.resolve(undefined);
			this.settlePendingRequests(run);
		}
	}

	private settlePendingRequests(run: HostRun): void {
		const settlements = run.pendingSettlements.splice(0);
		for (const { outcome, request } of settlements) settleRequest(request, outcome);
	}

	private restoreRun(run: HostRun): void {
		const restorations: Array<() => void> = [
			() => run.ctx.ui.setFooter(this.normalUiState.footer),
			() => run.ctx.ui.setWorkingVisible(this.normalUiState.workingVisible),
			() => {
				if (run.draftCaptured) run.ctx.ui.setEditorText(run.draft);
			},
			() => this.restoreChrome(run),
		];
		for (const restore of restorations) {
			try {
				restore();
			} catch {
				// Teardown is best effort, but one failing adapter must not skip the rest.
			}
		}
	}

	private runOwnsUi(): boolean {
		const run = this.activeRun;
		return run !== undefined && run.state !== "closed";
	}

	private restoreChrome(run: HostRun): void {
		const records = [...run.suppressedChrome];
		run.suppressedChrome.clear();
		for (const record of records) this.setChromeSuppressed(record, false);
	}

	private setChromeSuppressed(record: ChromeRecord, suppressed: boolean): void {
		try {
			record.chrome.setSuppressed(suppressed);
		} catch {
			// Chrome is independently owned; one adapter cannot strand the host lifecycle.
		}
	}

	private async shutdown(): Promise<void> {
		if (!this.generationActive) return;
		this.generationActive = false;
		this.accepting = false;
		this.generation += 1;
		this.normalUiState.footer = undefined;
		this.normalUiState.workingVisible = true;
		const run = this.activeRun;
		if (!run) return;
		this.dismissRun(run);
		await run.finished.promise;
	}

	private suppressChrome(run: HostRun): void {
		for (const record of this.chrome.values()) {
			run.suppressedChrome.add(record);
			this.setChromeSuppressed(record, true);
		}
	}
}

const COORDINATOR_REGISTRY = Symbol.for("@jczhang02/pi-stuff-ui/coordinators/v1");

function coordinatorRegistry(): WeakMap<ExtensionAPI["events"], CommandDialogCoordinatorImplementation> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], CommandDialogCoordinatorImplementation> | undefined;
	};
	root[COORDINATOR_REGISTRY] ??= new WeakMap();
	return root[COORDINATOR_REGISTRY];
}

export function getCommandDialogCoordinator(pi: ExtensionAPI): CommandDialogCoordinator {
	const registry = coordinatorRegistry();
	const existing = registry.get(pi.events);
	if (existing) {
		existing.ensureGeneration(pi);
		return existing;
	}
	const coordinator = new CommandDialogCoordinatorImplementation();
	coordinator.ensureGeneration(pi);
	registry.set(pi.events, coordinator);
	return coordinator;
}

interface UiSettingsCommandState {
	active: boolean;
	readonly registry: UiSettingRegistry;
}

const UI_SETTINGS_COMMAND_STATES = Symbol.for("@jczhang02/pi-stuff-ui/settings-command-states/v1");

const STATUSLINE_GIT_REFRESH_REQUEST = "@jczhang02/pi-stuff-ui/statusline-git-refresh-request/v1";
const STATUSLINE_GIT_REFRESH_LISTENERS = Symbol.for("@jczhang02/pi-stuff-ui/statusline-git-refresh-listeners/v1");

function statuslineGitRefreshListeners(): WeakMap<ExtensionAPI["events"], () => void> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], () => void> | undefined;
	};
	root[STATUSLINE_GIT_REFRESH_LISTENERS] ??= new WeakMap();
	return root[STATUSLINE_GIT_REFRESH_LISTENERS];
}

function listenForStatuslineGitRefreshRequests(pi: ExtensionAPI, refresh: () => void): () => void {
	const listeners = statuslineGitRefreshListeners();
	listeners.get(pi.events)?.();

	let active = true;
	const unsubscribe = pi.events.on(STATUSLINE_GIT_REFRESH_REQUEST, () => {
		if (active) refresh();
	});
	const cleanup = (): void => {
		if (!active) return;
		active = false;
		if (typeof unsubscribe === "function") unsubscribe();
		if (listeners.get(pi.events) === cleanup) listeners.delete(pi.events);
	};
	listeners.set(pi.events, cleanup);
	return cleanup;
}

/** Ask the active UI presentation to refresh its Git snapshot, if one exists. */
export function requestStatuslineGitRefresh(pi: Pick<ExtensionAPI, "events">): void {
	try {
		pi.events.emit(STATUSLINE_GIT_REFRESH_REQUEST, undefined);
	} catch {
		// A cosmetic refresh request cannot be allowed to break the caller's lifecycle.
	}
}

function uiSettingsCommandStates(): WeakMap<ExtensionAPI["events"], UiSettingsCommandState> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], UiSettingsCommandState> | undefined;
	};
	root[UI_SETTINGS_COMMAND_STATES] ??= new WeakMap();
	return root[UI_SETTINGS_COMMAND_STATES];
}

/** Ensure every independently loadable Capability can contribute to one /ui list. */
export function ensureUiSettingsCommand(pi: ExtensionAPI): UiSettingRegistry {
	const coordinator = getCommandDialogCoordinator(pi);
	const commandStates = uiSettingsCommandStates();
	const current = commandStates.get(pi.events);
	if (current?.active) return current.registry;
	const registry = beginUiSettingsGeneration(pi);
	const state: UiSettingsCommandState = { active: true, registry };
	commandStates.set(pi.events, state);
	pi.on("session_shutdown", () => {
		if (commandStates.get(pi.events) === state) state.active = false;
	});
	pi.registerCommand("ui", {
		description: "Configure Pi Stuff UI",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/ui requires interactive TUI mode.", "warning");
				return;
			}
			await coordinator.show(
				ctx,
				createUiSettingsView(registry, {
					onPersistenceError: (message) => ctx.ui.notify(message, "error"),
				}),
			);
		},
	});
	return registry;
}

export default async function piStuffUi(pi: ExtensionAPI): Promise<void> {
	const coordinator = getCommandDialogCoordinator(pi);
	const registry = ensureUiSettingsCommand(pi);
	registerLiveThoughtDisplay(pi);
	const settings = await UiSettingsStore.load();
	let unregisterOwnedSettings: (() => void) | undefined = registerOwnedUiSettings(registry, settings);
	let presentation: UiSessionPresentation | undefined;
	let compactionReplayDeduperRegistered = false;
	let stopListeningForGitRefresh = listenForStatuslineGitRefreshRequests(pi, () => {
		presentation?.refreshGit();
	});

	pi.on("session_start", (_event, ctx) => {
		// Register after all Capability factories have initialized so this runs
		// after their session_compact bookkeeping and immediately before Pi's
		// live chat rebuild.
		if (!compactionReplayDeduperRegistered) {
			compactionReplayDeduperRegistered = true;
			pi.on("session_compact", (event, compactCtx) => {
				if (!compactCtx.hasUI) return;
				suppressDuplicatedLiveCompactionReplay(compactCtx.sessionManager, event.compactionEntry.id);
			});
		}
		presentation?.dispose();
		presentation = installUiSessionPresentation(
			pi,
			ctx,
			settings,
			coordinator as CommandDialogCoordinatorImplementation,
		);
	});
	pi.on("before_agent_start", (event) => {
		presentation?.updateContextFileCount(event.systemPromptOptions.contextFiles?.length);
	});
	pi.on("turn_end", () => {
		presentation?.refreshGit();
	});
	pi.on("session_shutdown", async () => {
		stopListeningForGitRefresh();
		stopListeningForGitRefresh = () => {};
		presentation?.dispose();
		presentation = undefined;
		await settings.whenIdle();
		unregisterOwnedSettings?.();
		unregisterOwnedSettings = undefined;
	});
}

function createDeferred<Value>(): Deferred<Value> {
	let resolvePromise: (value: Value) => void = () => {};
	let rejectPromise: (reason: unknown) => void = () => {};
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function createDialogRequest<Result>(view: CommandDialogView<Result>): {
	readonly promise: Promise<Result | undefined>;
	readonly request: DialogRequest;
} {
	const completion = createDeferred<Result | undefined>();
	const controller = new AbortController();
	const request: DialogRequest = {
		component: undefined,
		controller,
		priority: view.priority,
		state: "queued",
		mount: (scope) =>
			view.create({
				keybindings: scope.keybindings,
				signal: scope.signal,
				theme: scope.theme,
				tui: scope.tui,
				close: (result) => scope.close(result),
				requestRender: (force) => scope.requestRender(force),
			}),
		reject: completion.reject,
		resolve: (value) => completion.resolve(value as Result | undefined),
	};
	return { promise: completion.promise, request };
}

function createHostRun(ctx: ExtensionContext): HostRun {
	return {
		blocking: [],
		closeHost: undefined,
		closeHostCalled: false,
		ctx,
		draft: "",
		draftCaptured: false,
		finished: createDeferred<void>(),
		host: undefined,
		normal: [],
		pendingSettlements: [],
		state: "opening",
		suppressedChrome: new Set(),
	};
}

function disposeComponent(component: CommandDialogComponent | undefined): void {
	try {
		component?.dispose?.();
	} catch {
		// A child cannot prevent the coordinator from advancing or restoring Pi UI.
	}
}

function removeRequest(queue: DialogRequest[], request: DialogRequest): void {
	const index = queue.indexOf(request);
	if (index >= 0) queue.splice(index, 1);
}

function requestIsSettled(request: DialogRequest): boolean {
	return request.state === "settled";
}

function settleRequest(request: DialogRequest, outcome: RequestOutcome): void {
	if (outcome.kind === "reject") request.reject(outcome.reason);
	else request.resolve(outcome.value);
}
