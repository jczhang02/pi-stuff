import { type ExtensionCommandContext, InteractiveMode } from "@earendil-works/pi-coding-agent";

interface PrivateExtensionRunner {
	createCommandContext(): ExtensionCommandContext;
}

interface PrivateInteractiveMode {
	readonly session?: { readonly extensionRunner?: PrivateExtensionRunner };
}

interface PrivateInteractiveModePrototype {
	setupExtensionShortcuts?: (this: PrivateInteractiveMode, runner: PrivateExtensionRunner) => void;
	showSessionSelector?: (this: PrivateInteractiveMode) => void;
}

export interface InteractiveModeConstructor {
	readonly prototype: PrivateInteractiveModePrototype;
}

export interface FastResumeHostPatchOptions {
	readonly captureShortcutContext?: boolean;
	readonly hijackResume: boolean;
	readonly open: (context: ExtensionCommandContext) => Promise<void>;
	readonly report?: (message: string) => void;
}

export interface FastResumeHostPatch {
	readonly hijackInstalled: boolean;
	readonly shortcutCaptureInstalled: boolean;
	commandContext(): ExtensionCommandContext | undefined;
	restore(): void;
}

interface PatchState {
	active: boolean;
	captureActive: boolean;
	hijackActive: boolean;
	open: FastResumeHostPatchOptions["open"];
	originalSelector?: PrivateInteractiveModePrototype["showSessionSelector"];
	originalSetup?: PrivateInteractiveModePrototype["setupExtensionShortcuts"];
	owner: symbol;
	report: NonNullable<FastResumeHostPatchOptions["report"]>;
	runner?: PrivateExtensionRunner;
	selectorWrapper?: PrivateInteractiveModePrototype["showSessionSelector"];
	setupWrapper?: PrivateInteractiveModePrototype["setupExtensionShortcuts"];
}

const PATCH_STATE = Symbol.for("@jczhang02/pi-stuff/fast-resume-host-patch/v1");

type PatchCarrier = PrivateInteractiveModePrototype & { [key: symbol]: PatchState | undefined };

function getPatchState(prototype: PrivateInteractiveModePrototype): PatchState | undefined {
	// SAFETY: PatchCarrier adds only Pi Stuff's private symbol slot to this exact prototype object.
	return (prototype as PatchCarrier)[PATCH_STATE];
}

function setPatchState(prototype: PrivateInteractiveModePrototype, state: PatchState): void {
	// SAFETY: PatchCarrier adds only Pi Stuff's private symbol slot to this exact prototype object.
	(prototype as PatchCarrier)[PATCH_STATE] = state;
}

function deletePatchState(prototype: PrivateInteractiveModePrototype, state: PatchState): void {
	// SAFETY: PatchCarrier adds only Pi Stuff's private symbol slot to this exact prototype object.
	const carrier = prototype as PatchCarrier;
	if (carrier[PATCH_STATE] === state) delete carrier[PATCH_STATE];
}

function commandContextFromRunner(runner: PrivateExtensionRunner | undefined): ExtensionCommandContext | undefined {
	if (!runner) return undefined;
	try {
		return runner.createCommandContext();
	} catch {
		return undefined;
	}
}

function installSelector(prototype: PrivateInteractiveModePrototype, state: PatchState): boolean {
	if (state.selectorWrapper && prototype.showSessionSelector === state.selectorWrapper) return true;
	const original = prototype.showSessionSelector;
	if (!original) {
		state.report("InteractiveMode.showSessionSelector is unavailable.");
		return false;
	}
	state.originalSelector = original;
	const wrapper = function (this: PrivateInteractiveMode): void {
		const context = commandContextFromRunner(this.session?.extensionRunner);
		if (!state.active || !state.hijackActive || !context) {
			original.call(this);
			return;
		}
		void state.open(context).catch(() => {
			state.report("Fast Resume failed to open; native /resume was restored for this invocation.");
			original.call(this);
		});
	};
	state.selectorWrapper = wrapper;
	prototype.showSessionSelector = wrapper;
	return true;
}

function installSetupCapture(prototype: PrivateInteractiveModePrototype, state: PatchState): boolean {
	if (state.setupWrapper && prototype.setupExtensionShortcuts === state.setupWrapper) return true;
	const original = prototype.setupExtensionShortcuts;
	if (!original) {
		state.report("InteractiveMode.setupExtensionShortcuts is unavailable.");
		return false;
	}
	state.originalSetup = original;
	const wrapper = function (this: PrivateInteractiveMode, runner: PrivateExtensionRunner): void {
		if (state.active && state.captureActive) state.runner = runner;
		original.call(this, runner);
	};
	state.setupWrapper = wrapper;
	prototype.setupExtensionShortcuts = wrapper;
	return true;
}

function uninstallSelector(prototype: PrivateInteractiveModePrototype, state: PatchState): void {
	if (state.selectorWrapper && prototype.showSessionSelector === state.selectorWrapper) {
		if (state.originalSelector) prototype.showSessionSelector = state.originalSelector;
		else delete prototype.showSessionSelector;
	}
}

function uninstallSetupCapture(prototype: PrivateInteractiveModePrototype, state: PatchState): void {
	delete state.runner;
	if (state.setupWrapper && prototype.setupExtensionShortcuts === state.setupWrapper) {
		if (state.originalSetup) prototype.setupExtensionShortcuts = state.originalSetup;
		else delete prototype.setupExtensionShortcuts;
	}
}

function restore(prototype: PrivateInteractiveModePrototype, state: PatchState, token: symbol): void {
	if (state.owner !== token) return;
	state.active = false;
	delete state.runner;
	if (state.selectorWrapper && prototype.showSessionSelector === state.selectorWrapper) {
		if (state.originalSelector) prototype.showSessionSelector = state.originalSelector;
		else delete prototype.showSessionSelector;
	}
	if (state.setupWrapper && prototype.setupExtensionShortcuts === state.setupWrapper) {
		if (state.originalSetup) prototype.setupExtensionShortcuts = state.originalSetup;
		else delete prototype.setupExtensionShortcuts;
	}
	deletePatchState(prototype, state);
}

function emptyPatch(): FastResumeHostPatch {
	return {
		commandContext: () => undefined,
		hijackInstalled: false,
		restore: () => undefined,
		shortcutCaptureInstalled: false,
	};
}

export function installFastResumeHostPatch(
	target: InteractiveModeConstructor,
	options: FastResumeHostPatchOptions,
): FastResumeHostPatch {
	const prototype = target.prototype;
	let state = getPatchState(prototype);
	if (!options.hijackResume && !options.captureShortcutContext && !state?.active) return emptyPatch();
	const token = Symbol("Fast Resume Host patch generation");
	if (!state?.active) {
		state = {
			active: true,
			captureActive: Boolean(options.captureShortcutContext),
			hijackActive: options.hijackResume,
			open: options.open,
			owner: token,
			report: options.report ?? (() => undefined),
		};
		setPatchState(prototype, state);
	} else {
		state.owner = token;
		state.open = options.open;
		state.report = options.report ?? (() => undefined);
		state.hijackActive = options.hijackResume;
		state.captureActive = Boolean(options.captureShortcutContext);
	}
	const hijackInstalled = options.hijackResume ? installSelector(prototype, state) : false;
	if (!options.hijackResume) uninstallSelector(prototype, state);
	const shortcutCaptureInstalled = options.captureShortcutContext ? installSetupCapture(prototype, state) : false;
	if (!options.captureShortcutContext) uninstallSetupCapture(prototype, state);
	return {
		commandContext: () => (state?.captureActive ? commandContextFromRunner(state.runner) : undefined),
		hijackInstalled,
		restore: () => {
			if (state) restore(prototype, state, token);
		},
		shortcutCaptureInstalled,
	};
}

type SessionManager = ExtensionCommandContext["sessionManager"];

type CertifiedSessionManager = SessionManager & {
	usesDefaultSessionDir?: () => boolean;
};

export function usesDefaultSessionDirectory(sessionManager: SessionManager): boolean {
	// SAFETY: Pi 0.84.4's runtime SessionManager owns this feature-detected private method.
	const certified = sessionManager as CertifiedSessionManager;
	try {
		return certified.usesDefaultSessionDir?.() ?? true;
	} catch {
		return true;
	}
}

export function installCertifiedFastResumeHostPatch(options: FastResumeHostPatchOptions): FastResumeHostPatch {
	// SAFETY: certification pins Pi 0.84.4 and installFastResumeHostPatch feature-detects both private methods.
	const certified = InteractiveMode as typeof InteractiveMode & InteractiveModeConstructor;
	return installFastResumeHostPatch(certified, options);
}
