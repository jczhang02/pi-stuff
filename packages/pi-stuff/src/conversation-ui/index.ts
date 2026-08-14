import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, isFocusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import {
	AgentRunOriginTracker,
	listenForActiveAgentWorkUserPromotions,
	listenForAgentWorkOriginQueries,
} from "./agent-run-origin.js";
import { suppressDuplicatedLiveCompactionReplay } from "./compaction-presentation.js";
import { activateDiagnosticChannel, getDiagnosticChannel } from "./diagnostics.js";
import { createDiagnosticsView } from "./diagnostics-dialog.js";
import { getHostSharedResource } from "./host-resource.js";
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
	type AgentWorkOrigin,
	hasDirectUserActivation,
	promoteActiveAgentWorkToUser,
	readAgentWorkOrigin,
	readCurrentAgentWorkOrigin,
	withAgentWorkOrigin,
	withDirectUserActivation,
} from "./agent-run-origin.js";
export {
	activateDiagnosticChannel,
	DiagnosticChannel,
	type DiagnosticRecord,
	type DiagnosticReport,
	type DiagnosticSeverity,
	type DiagnosticVisibility,
	getDiagnosticChannel,
	reportDiagnostic,
} from "./diagnostics.js";
export {
	type CommandDialogRowSections,
	commandDialogRows,
	fitCommandDialogRows,
} from "./dialog-layout.js";

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
export {
	beginSuiteNativeCompactionPreflight,
	deliverSuiteAgentMessage,
	isSuiteNativeCompactionPreflight,
	registerSuiteAgentMessagePreparation,
	type SuiteAgentMessageDeliveryResult,
	type SuiteAgentMessageOptions,
	type SuiteAgentMessagePreparation,
	type SuiteAgentMessagePreparationDecision,
	sendSuiteAgentMessage,
} from "./suite-agent-message.js";
export {
	installSuiteSessionReadiness,
	markSuiteSessionReady,
	rejectSuiteSessionReadiness,
	whenSuiteSessionReady,
} from "./suite-lifecycle.js";

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

export interface CommandDialogShowOptions {
	/** Restore the editor text captured before the dialog opened. Defaults to true. */
	readonly restoreDraft?: boolean;
}

export interface CommandDialogCoordinator {
	registerChrome(id: string, chrome: CommandDialogChrome): () => void;
	/** Add a Suite-owned region after the primary Statusline Footer. */
	registerFooterTail?(id: string, factory: FooterTailFactory): () => void;
	/** Report whether this TUI context is currently hosted by the shared Footer. */
	hasInstalledFooter?(ctx: ExtensionContext): boolean;
	setWorkingVisible(ctx: ExtensionContext, visible: boolean): void;
	show<Result = void>(
		ctx: ExtensionContext,
		view: CommandDialogView<Result>,
		options?: CommandDialogShowOptions,
	): Promise<Result | undefined>;
	whenIdle(): Promise<void>;
}

export type FooterFactory = NonNullable<Parameters<ExtensionUIContext["setFooter"]>[0]>;
export { getHostSharedResource } from "./host-resource.js";
export type FooterTailComponent = Component & {
	/** Replace the primary Footer's second row while this tail renders its controls. */
	readonly replacesBaseRow2?: boolean;
};
export type FooterTailFactory = (tui: TUI, theme: Theme) => FooterTailComponent;

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
	readonly restoreDraft: boolean;
	readonly suppressedChrome: Set<ChromeRecord>;
	closeHost: (() => void) | undefined;
	closeHostCalled: boolean;
	draft: string;
	draftCaptured: boolean;
	host: CommandDialogHost | undefined;
	state: HostRunState;
}

interface NormalUiState {
	baseFooter: FooterFactory | undefined;
	ctx: ExtensionContext | undefined;
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

class FooterStackComponent implements Component {
	private disposed = false;
	private readonly components: readonly Component[];

	constructor(components: readonly Component[]) {
		this.components = components;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const component of [...this.components].reverse()) disposeComponent(component as CommandDialogComponent);
	}

	invalidate(): void {
		if (this.disposed) return;
		for (const component of this.components) callComponent(() => component.invalidate());
	}

	render(width: number): string[] {
		if (this.disposed) return [];
		const lines: string[] = [];
		let baseRow2Available = false;
		for (const [index, component] of this.components.entries()) {
			const section: string[] = [];
			let rendered = false;
			let replacesBaseRow2 = false;
			callComponent(() => {
				replacesBaseRow2 = (component as FooterTailComponent).replacesBaseRow2 === true;
				section.push(...component.render(width));
				rendered = true;
			});
			if (!rendered) continue;
			if (index === 0) baseRow2Available = section.length > 1;
			else if (replacesBaseRow2 && baseRow2Available) {
				lines.splice(1, 1);
				baseRow2Available = false;
			}
			lines.push(...section);
		}
		return lines;
	}
}

class CommandDialogHost implements Component, Focusable {
	private readonly coordinator: CommandDialogCoordinatorImplementation;
	private _focused = false;
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

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		const component = this.activeComponent();
		if (isFocusable(component)) component.focused = value;
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
		const component = this.coordinator.mountActiveRequest(this.run, this, this.tui, this.theme, this.keybindings);
		if (isFocusable(component)) component.focused = this._focused;
		return component;
	}
}

class CommandDialogCoordinatorImplementation implements CommandDialogCoordinator {
	private readonly chrome = new Map<string, ChromeRecord>();
	private readonly boundApis = new WeakSet<ExtensionAPI>();
	private readonly footerTails = new Map<string, FooterTailFactory>();
	private activeRun: HostRun | undefined;
	private accepting = true;
	private generation = 0;
	private generationActive = false;
	private readonly normalUiState: NormalUiState = {
		baseFooter: undefined,
		ctx: undefined,
		footer: undefined,
		workingVisible: true,
	};

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
		this.footerTails.clear();
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

	registerFooterTail(id: string, factory: FooterTailFactory): () => void {
		if (id.length === 0) throw new Error("Footer tail id must not be empty");
		const record = factory;
		this.footerTails.set(id, record);
		this.rebuildFooter();

		let registered = true;
		return () => {
			if (!registered) return;
			registered = false;
			if (this.footerTails.get(id) !== record) return;
			this.footerTails.delete(id);
			this.rebuildFooter();
		};
	}

	hasInstalledFooter(ctx: ExtensionContext): boolean {
		return this.normalUiState.ctx?.ui === ctx.ui && this.normalUiState.baseFooter !== undefined;
	}

	installFooter(ctx: ExtensionContext, factory: FooterFactory): void {
		if (ctx.mode !== "tui") return;
		this.normalUiState.baseFooter = factory;
		this.normalUiState.ctx = ctx;
		this.rebuildFooter();
	}

	setWorkingVisible(ctx: ExtensionContext, visible: boolean): void {
		this.normalUiState.workingVisible = visible;
		if (!this.runOwnsUi()) ctx.ui.setWorkingVisible(visible);
	}

	show<Result = void>(
		ctx: ExtensionContext,
		view: CommandDialogView<Result>,
		options: CommandDialogShowOptions = {},
	): Promise<Result | undefined> {
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
				return this.show(ctx, view, options);
			});
		}

		const { promise, request } = createDialogRequest(view);
		if (activeRun) {
			this.enqueue(activeRun, request);
			activeRun.host?.activate();
			return promise;
		}

		const run = createHostRun(ctx, options);
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
			if (run.restoreDraft) {
				run.draft = run.ctx.ui.getEditorText();
				run.draftCaptured = true;
			}
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

	private rebuildFooter(): void {
		const base = this.normalUiState.baseFooter;
		const tails = [...this.footerTails.values()];
		const footer = base ? composeFooter(base, tails) : undefined;
		this.normalUiState.footer = footer;
		const ctx = this.normalUiState.ctx;
		if (ctx && !this.runOwnsUi()) ctx.ui.setFooter(footer);
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
		this.normalUiState.baseFooter = undefined;
		this.normalUiState.ctx = undefined;
		this.normalUiState.footer = undefined;
		this.normalUiState.workingVisible = true;
		this.footerTails.clear();
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
const COORDINATOR_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/coordinator-discovery/v1";

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

	const coordinator = getHostSharedResource(
		pi.events,
		registry as WeakMap<object, CommandDialogCoordinatorImplementation>,
		COORDINATOR_DISCOVERY_EVENT,
		() => new CommandDialogCoordinatorImplementation(),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
	coordinator.ensureGeneration(pi);
	return coordinator;
}

interface UiSettingsCommandState {
	active: boolean;
	activation?: object;
	registry?: UiSettingRegistry;
}

const UI_SETTINGS_COMMAND_STATES = Symbol.for("@jczhang02/pi-stuff-ui/settings-command-states/v1");
const UI_SETTINGS_COMMAND_STATE_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/settings-command-state-discovery/v1";
const UI_LIFECYCLE_STATES = Symbol.for("@jczhang02/pi-stuff-ui/lifecycle-states/v1");
const UI_LIFECYCLE_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/lifecycle-discovery/v1";
const USER_AGENT_RUN_SETTLED_EVENT = "@jczhang02/pi-stuff-ui/user-agent-run-settled/v1";

interface UiLifecycleState {
	active: boolean;
	activation?: object;
}

function uiLifecycleStates(): WeakMap<ExtensionAPI["events"], UiLifecycleState> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], UiLifecycleState> | undefined;
	};
	root[UI_LIFECYCLE_STATES] ??= new WeakMap();
	return root[UI_LIFECYCLE_STATES];
}

/** Observe a completed direct-user Agent run after the Host reaches a genuinely idle boundary. */
export function listenForUserAgentRunSettled(
	pi: Pick<ExtensionAPI, "events">,
	listener: (ctx: ExtensionContext) => void,
): () => void {
	const unsubscribe = pi.events.on(USER_AGENT_RUN_SETTLED_EVENT, (value) => {
		if (typeof value !== "object" || value === null) return;
		const ctx = Reflect.get(value, "ctx");
		if (typeof ctx !== "object" || ctx === null) return;
		try {
			listener(ctx as ExtensionContext);
		} catch {
			// A derived usage refresh cannot be allowed to break Agent settlement.
		}
	});
	return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

function publishUserAgentRunSettled(pi: Pick<ExtensionAPI, "events">, ctx: ExtensionContext): void {
	try {
		pi.events.emit(USER_AGENT_RUN_SETTLED_EVENT, { ctx });
	} catch {
		// A derived usage refresh cannot be allowed to break Agent settlement.
	}
}

const STATUSLINE_GIT_REFRESH_AFTER_USER_WORK_REQUEST =
	"@jczhang02/pi-stuff-ui/statusline-git-refresh-after-user-work-request/v1";
const STATUSLINE_GIT_REFRESH_LISTENERS = Symbol.for("@jczhang02/pi-stuff-ui/statusline-git-refresh-listeners/v1");
export const UI_RENDER_REQUEST_EVENT = "@jczhang02/pi-stuff-ui/render-request/v1";
const UI_RENDER_REQUEST_LISTENERS = Symbol.for("@jczhang02/pi-stuff-ui/render-request-listeners/v1");

function statuslineGitRefreshListeners(): WeakMap<ExtensionAPI["events"], () => void> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], () => void> | undefined;
	};
	root[STATUSLINE_GIT_REFRESH_LISTENERS] ??= new WeakMap();
	return root[STATUSLINE_GIT_REFRESH_LISTENERS];
}

function listenForStatuslineGitRefreshAfterUserWorkRequests(pi: ExtensionAPI, refresh: () => void): () => void {
	const listeners = statuslineGitRefreshListeners();
	listeners.get(pi.events)?.();

	let active = true;
	const unsubscribe = pi.events.on(STATUSLINE_GIT_REFRESH_AFTER_USER_WORK_REQUEST, () => {
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

/** Report completed user-initiated work whose Git observation may need to wait for Host idle. */
export function requestStatuslineGitRefreshAfterUserWork(pi: Pick<ExtensionAPI, "events">): void {
	try {
		pi.events.emit(STATUSLINE_GIT_REFRESH_AFTER_USER_WORK_REQUEST, undefined);
	} catch {
		// A cosmetic refresh request cannot be allowed to break the caller's lifecycle.
	}
}

function uiRenderRequestListeners(): WeakMap<ExtensionAPI["events"], () => void> {
	const root = globalThis as unknown as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], () => void> | undefined;
	};
	root[UI_RENDER_REQUEST_LISTENERS] ??= new WeakMap();
	return root[UI_RENDER_REQUEST_LISTENERS];
}

function listenForUiRenderRequests(pi: ExtensionAPI, render: (force: boolean) => void): () => void {
	const listeners = uiRenderRequestListeners();
	listeners.get(pi.events)?.();

	let active = true;
	const unsubscribe = pi.events.on(UI_RENDER_REQUEST_EVENT, (value) => {
		if (!active || typeof value !== "object" || value === null) return;
		const request = value as { force?: unknown; handled?: unknown };
		request.handled = true;
		render(request.force === true);
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

/** Request a normal-screen paint and report whether an active UI accepted it. */
export function requestUiRender(pi: Pick<ExtensionAPI, "events">, force = false): boolean {
	const request = { force, handled: false };
	try {
		pi.events.emit(UI_RENDER_REQUEST_EVENT, request);
	} catch {
		// A presentation handoff cannot be allowed to break Agent processing.
	}
	return request.handled;
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
	const state = getHostSharedResource<UiSettingsCommandState>(
		pi.events,
		commandStates as WeakMap<object, UiSettingsCommandState>,
		UI_SETTINGS_COMMAND_STATE_DISCOVERY_EVENT,
		() => ({ active: false }),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
	if (state.active && state.registry) return state.registry;
	const registry = beginUiSettingsGeneration(pi);
	const activation = {};
	state.active = true;
	state.activation = activation;
	state.registry = registry;
	pi.on("session_shutdown", () => {
		if (state.activation !== activation) return;
		state.active = false;
		delete state.activation;
		delete state.registry;
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
	const lifecycle = getHostSharedResource<UiLifecycleState>(
		pi.events,
		uiLifecycleStates() as WeakMap<object, UiLifecycleState>,
		UI_LIFECYCLE_DISCOVERY_EVENT,
		() => ({ active: false }),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
	if (lifecycle.active) return;
	const activation = {};
	lifecycle.active = true;
	lifecycle.activation = activation;
	try {
		await installUiCapability(pi, lifecycle, activation);
	} catch (error) {
		if (lifecycle.activation === activation) {
			lifecycle.active = false;
			delete lifecycle.activation;
		}
		throw error;
	}
}

async function installUiCapability(pi: ExtensionAPI, lifecycle: UiLifecycleState, activation: object): Promise<void> {
	const coordinator = getCommandDialogCoordinator(pi);
	const diagnostics = getDiagnosticChannel(pi);
	activateDiagnosticChannel(diagnostics);
	const registry = ensureUiSettingsCommand(pi);
	pi.registerCommand("diagnostics", {
		description: "Inspect Pi Stuff diagnostics",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/diagnostics requires interactive TUI mode.", "warning");
				return;
			}
			diagnostics.acknowledgeNotices();
			await coordinator.show(ctx, createDiagnosticsView(diagnostics));
		},
	});
	registerLiveThoughtDisplay(pi);
	const settings = await UiSettingsStore.load();
	let unregisterOwnedSettings: (() => void) | undefined = registerOwnedUiSettings(registry, settings);
	let presentation: UiSessionPresentation | undefined;
	let sessionContext: ExtensionContext | undefined;
	const agentRunOrigin = new AgentRunOriginTracker();
	let agentSettlementPending = false;
	let userWorkGitRefreshPending = false;
	let gitRefreshDrainToken: object | undefined;
	let sessionGeneration = 0;
	let agentSettledObserverRegistered = false;
	let inputObserverRegistered = false;
	let compactionReplayDeduperRegistered = false;
	const scheduleGitRefreshAtQuietBoundary = (): void => {
		userWorkGitRefreshPending = true;
		if (!sessionContext || agentSettlementPending || gitRefreshDrainToken) return;
		const token = {};
		const generation = sessionGeneration;
		gitRefreshDrainToken = token;
		queueMicrotask(() => {
			if (gitRefreshDrainToken === token) gitRefreshDrainToken = undefined;
			if (generation !== sessionGeneration || !sessionContext || !userWorkGitRefreshPending) return;
			try {
				// Let every listener in the event that requested this refresh run first.
				// A later Extension may synchronously enqueue more Agent work.
				if (agentSettlementPending || !sessionContext.isIdle() || sessionContext.hasPendingMessages()) return;
			} catch {
				return;
			}
			userWorkGitRefreshPending = false;
			void presentation?.refreshGit();
		});
	};
	let stopListeningForGitRefresh = listenForStatuslineGitRefreshAfterUserWorkRequests(
		pi,
		scheduleGitRefreshAtQuietBoundary,
	);
	let stopListeningForUserSteers = listenForActiveAgentWorkUserPromotions(pi, () => {
		agentRunOrigin.promoteActiveWorkToUser();
	});
	let stopListeningForAgentWorkOriginQueries = listenForAgentWorkOriginQueries(pi, () => agentRunOrigin.current());
	let stopListeningForUiRender = listenForUiRenderRequests(pi, (force) => {
		presentation?.requestRender(force);
	});
	pi.on("session_start", (_event, ctx) => {
		// Observe input after every Package Capability has registered its handler.
		// Pi stops dispatch after a handler returns `handled`, so rejected command or
		// policy input never enters the delivery-attribution queue.
		if (!inputObserverRegistered) {
			inputObserverRegistered = true;
			pi.on("input", (event) => {
				agentRunOrigin.noteInput(event);
			});
		}
		// Register after every Suite Capability factory has initialized. Goal may
		// start an automatic continuation from agent_settled; this observer must
		// run after that decision and re-check the Host's live idle boundary.
		if (!agentSettledObserverRegistered) {
			agentSettledObserverRegistered = true;
			pi.on("agent_settled", async () => {
				if (!sessionContext) return;
				try {
					if (!sessionContext.isIdle() || sessionContext.hasPendingMessages()) {
						userWorkGitRefreshPending ||= agentRunOrigin.hasUserWork();
						return;
					}
				} catch {
					userWorkGitRefreshPending ||= agentRunOrigin.hasUserWork();
					return;
				}
				agentSettlementPending = false;
				const completedUserAgentRun = agentRunOrigin.consumeRunIncludesUserWork();
				const shouldRefreshGit = completedUserAgentRun || userWorkGitRefreshPending;
				userWorkGitRefreshPending = false;
				// Pi awaits Extension handlers sequentially. Awaiting this bounded Git
				// read prevents a later-loaded Extension from starting its continuation
				// while the status probe is still running.
				if (shouldRefreshGit) await presentation?.refreshGit();
				if (completedUserAgentRun) publishUserAgentRunSettled(pi, sessionContext);
			});
		}
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
		sessionGeneration += 1;
		gitRefreshDrainToken = undefined;
		sessionContext = ctx;
		agentRunOrigin.reset();
		agentSettlementPending = false;
		userWorkGitRefreshPending = false;
		presentation = installUiSessionPresentation(
			pi,
			ctx,
			settings,
			coordinator as CommandDialogCoordinatorImplementation,
			diagnostics,
		);
	});
	pi.on("before_agent_start", (event) => {
		diagnostics.acknowledgeNotices();
		presentation?.updateContextFileCount(event.systemPromptOptions.contextFiles?.length);
	});
	pi.on("agent_start", () => {
		agentSettlementPending = true;
	});
	pi.on("turn_start", () => {
		agentRunOrigin.noteTurnStart();
	});
	pi.on("turn_end", () => {
		agentRunOrigin.noteTurnEnd();
	});
	pi.on("message_start", (event) => {
		agentRunOrigin.noteMessageStart(event.message);
	});
	pi.on("session_shutdown", async () => {
		stopListeningForGitRefresh();
		stopListeningForGitRefresh = () => {};
		stopListeningForUserSteers();
		stopListeningForUserSteers = () => {};
		stopListeningForAgentWorkOriginQueries();
		stopListeningForAgentWorkOriginQueries = () => {};
		stopListeningForUiRender();
		stopListeningForUiRender = () => {};
		presentation?.dispose();
		presentation = undefined;
		sessionGeneration += 1;
		gitRefreshDrainToken = undefined;
		sessionContext = undefined;
		agentSettlementPending = false;
		userWorkGitRefreshPending = false;
		await settings.whenIdle();
		unregisterOwnedSettings?.();
		unregisterOwnedSettings = undefined;
		if (lifecycle.activation === activation) {
			lifecycle.active = false;
			delete lifecycle.activation;
		}
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

function createHostRun(ctx: ExtensionContext, options: CommandDialogShowOptions): HostRun {
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
		restoreDraft: options.restoreDraft !== false,
		state: "opening",
		suppressedChrome: new Set(),
	};
}

function composeFooter(base: FooterFactory, tails: readonly FooterTailFactory[]): FooterFactory {
	return (tui, theme, footerData) => {
		const components: Component[] = [];
		callComponentFactory(() => base(tui, theme, footerData), components);
		for (const tail of tails) callComponentFactory(() => tail(tui, theme), components);
		return new FooterStackComponent(components);
	};
}

function callComponentFactory(factory: () => Component, output: Component[]): void {
	try {
		output.push(factory());
	} catch {
		// One optional Footer tail must not take down the primary Statusline.
	}
}

function callComponent(callback: () => void): void {
	try {
		callback();
	} catch {
		// Footer sections are independent presentation adapters.
	}
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
