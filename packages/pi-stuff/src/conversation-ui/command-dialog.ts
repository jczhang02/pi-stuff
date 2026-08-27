import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, isFocusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../lifecycle-deadline.js";
import { isRuntimeFunction } from "../shared/runtime-type.js";
import { getHostSharedResource } from "./host-resource.js";

export type CommandDialogPriority = "blocking" | "normal";

export interface CommandDialogChrome {
	setSuppressed(suppressed: boolean): void;
}

export type CommandDialogCoordinatorHost = Pick<ExtensionAPI, "events" | "on">;

export interface CommandDialogComponent extends Component {
	dispose?(): void;
}

export type CommandDialogKeybindings = Pick<KeybindingsManager, "getKeys" | "matches">;

export interface CommandDialogViewContext<Result = void> {
	readonly keybindings: CommandDialogKeybindings;
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
export type FooterTailComponent = Component & {
	/** Replace the primary Footer's second row while this tail renders its controls. */
	readonly replacesBaseRow2?: boolean;
};
export type FooterTailFactory = (tui: TUI, theme: Theme) => FooterTailComponent;

type DialogRequestState = "mounted" | "mounting" | "queued" | "settled";
type HostRunState = "closed" | "closing" | "open" | "opening";

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	reject(cause: unknown): void;
	resolve(value: Value): void;
}

interface HostScope {
	readonly keybindings: KeybindingsManager;
	readonly signal: AbortSignal;
	readonly theme: Theme;
	readonly tui: TUI;
	close<Value>(value?: Value): void;
	requestRender(force?: boolean): void;
}

interface DialogRequest {
	readonly controller: AbortController;
	readonly priority: CommandDialogPriority;
	component: CommandDialogComponent | undefined;
	state: DialogRequestState;
	mount(scope: HostScope): CommandDialogComponent;
	reject(cause: unknown): void;
	resolve<Value>(value: Value): void;
}

interface HostRun {
	readonly blocking: DialogRequest[];
	readonly ctx: ExtensionContext;
	readonly finished: Deferred<void>;
	readonly normal: DialogRequest[];
	readonly pendingSettlements: Array<{ readonly outcome: RequestOutcome; readonly request: DialogRequest }>;
	readonly restoreDraft: boolean;
	readonly suppressedChrome: Set<{ readonly chrome: CommandDialogChrome }>;
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
		for (const component of [...this.components].reverse()) disposeComponent(component);
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
				replacesBaseRow2 = "replacesBaseRow2" in component && component.replacesBaseRow2 === true;
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

export class CommandDialogCoordinatorImplementation implements CommandDialogCoordinator {
	private readonly chrome = new Map<string, { readonly chrome: CommandDialogChrome }>();
	private readonly boundApis = new WeakSet<CommandDialogCoordinatorHost>();
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

	bind(pi: CommandDialogCoordinatorHost): void {
		if (this.boundApis.has(pi)) return;
		this.boundApis.add(pi);
		pi.on("session_shutdown", async () => {
			await settleWithin(this.shutdown(), HOST_SHUTDOWN_GRACE_MS);
		});
	}

	ensureGeneration(pi: CommandDialogCoordinatorHost): void {
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

	private failRun(run: HostRun, cause: unknown): void {
		if (run.state === "closed") return;
		run.state = "closing";
		for (const request of [...run.blocking, ...run.normal]) {
			this.finishRequest(run, request, { kind: "reject", reason: cause }, false);
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

	private setChromeSuppressed(record: { readonly chrome: CommandDialogChrome }, suppressed: boolean): void {
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
	// SAFETY: this package-owned symbol slot is initialized only with the coordinator WeakMap.
	const root = globalThis as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], CommandDialogCoordinatorImplementation> | undefined;
	};
	root[COORDINATOR_REGISTRY] ??= new WeakMap();
	return root[COORDINATOR_REGISTRY];
}

export function getCommandDialogCoordinator(pi: CommandDialogCoordinatorHost): CommandDialogCoordinator {
	const registry = coordinatorRegistry();
	const existing = registry.get(pi.events);
	if (existing) {
		existing.ensureGeneration(pi);
		return existing;
	}

	const coordinator = getHostSharedResource(
		pi.events,
		// SAFETY: ExtensionAPI event buses are objects, so this narrower WeakMap satisfies the shared Host registry seam.
		registry as WeakMap<object, CommandDialogCoordinatorImplementation>,
		COORDINATOR_DISCOVERY_EVENT,
		() => new CommandDialogCoordinatorImplementation(),
		{ registerOwnerCleanup: (cleanup) => pi.on("session_shutdown", cleanup) },
	);
	coordinator.ensureGeneration(pi);
	return coordinator;
}

function createDialogRequest<Result>(view: CommandDialogView<Result>) {
	const completion = Promise.withResolvers<Result | undefined>();
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
		resolve: <Value>(value: Value) => {
			// SAFETY: this request is created from CommandDialogView<Result>, so its close value has that same Result contract.
			completion.resolve(value as Value & (Result | undefined));
		},
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
		finished: Promise.withResolvers<void>(),
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

function disposeComponent(component: Component | undefined): void {
	try {
		if (component && "dispose" in component && isRuntimeFunction(component.dispose)) component.dispose();
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
