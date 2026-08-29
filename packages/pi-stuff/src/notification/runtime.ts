export interface NotificationTimer {
	unref?(): void;
}

export interface NotificationClock {
	now(): number;
	setTimeout(callback: () => void, delayMs: number): NotificationTimer;
	clearTimeout(timer: NotificationTimer): void;
}

export interface NotificationRuntimeSettings {
	readonly completionAlerts: boolean;
	readonly enabled: boolean;
	readonly failureAlerts: boolean;
	readonly gracePeriodMs: number;
	readonly minimumDurationMs: number;
}

export interface NotificationAlert {
	readonly elapsedMs: number;
	readonly outcome: "completion" | "failure";
	readonly preview?: string;
}

export interface FinalAssistantOutcome {
	readonly errorMessage?: string;
	readonly preview?: string;
	readonly stopReason?: string;
}

interface IdleWorkCycle {
	readonly generation: number;
	readonly status: "idle";
}

interface ActiveWorkCycle {
	readonly generation: number;
	readonly includesUserWork: boolean;
	readonly latestAssistant?: FinalAssistantOutcome;
	readonly promptDepth: number;
	readonly promptStartedAt: number | null;
	readonly promptWaitMs: number;
	readonly startedAt: number;
}

interface RunningWorkCycle extends ActiveWorkCycle {
	readonly status: "running";
}

interface PendingWorkCycle extends ActiveWorkCycle {
	readonly settledAt: number;
	readonly status: "pending";
}

export type WorkCycleState = IdleWorkCycle | RunningWorkCycle | PendingWorkCycle;

export type WorkCycleEvent =
	| { readonly now: number; readonly type: "agent_start" }
	| { readonly type: "agent_end" }
	| { readonly type: "user_work" }
	| ({ readonly type: "assistant_finalized" } & FinalAssistantOutcome)
	| { readonly now: number; readonly type: "agent_settled" }
	| { readonly now: number; readonly type: "ui_prompt_start" }
	| { readonly now: number; readonly type: "ui_prompt_end" }
	| { readonly type: "input" }
	| { readonly type: "terminal_input" }
	| { readonly type: "clear" };

export type NotificationRuntimeEvent =
	| { readonly type: "agent_start" }
	| { readonly type: "agent_end" }
	| { readonly type: "user_work" }
	| ({ readonly type: "assistant_finalized" } & FinalAssistantOutcome)
	| { readonly type: "agent_settled" }
	| { readonly type: "ui_prompt_start" }
	| { readonly type: "ui_prompt_end" }
	| { readonly type: "input" }
	| { readonly type: "terminal_input" };

export function createWorkCycleState(): WorkCycleState {
	return { generation: 0, status: "idle" };
}

function idleAfter(state: WorkCycleState): IdleWorkCycle {
	return { generation: state.generation + 1, status: "idle" };
}

export function reduceWorkCycle(state: WorkCycleState, event: WorkCycleEvent): WorkCycleState {
	if (event.type === "clear") return idleAfter(state);
	if (event.type === "agent_start") {
		if (state.status === "idle") {
			return {
				generation: state.generation + 1,
				includesUserWork: false,
				promptDepth: 0,
				promptStartedAt: null,
				promptWaitMs: 0,
				startedAt: event.now,
				status: "running",
			};
		}
		if (state.status === "pending") {
			const running = {
				generation: state.generation + 1,
				includesUserWork: state.includesUserWork,
				promptDepth: state.promptDepth,
				promptStartedAt: state.promptStartedAt,
				promptWaitMs: state.promptWaitMs,
				startedAt: state.startedAt,
				status: "running" as const,
			};
			if (state.latestAssistant) Object.assign(running, { latestAssistant: state.latestAssistant });
			return running;
		}
		return state;
	}
	if (state.status === "idle" || event.type === "agent_end") return state;
	if (event.type === "user_work") return { ...state, includesUserWork: true };
	if (event.type === "ui_prompt_start") {
		if (state.status !== "running") return state;
		return state.promptDepth === 0
			? { ...state, promptDepth: 1, promptStartedAt: event.now }
			: { ...state, promptDepth: state.promptDepth + 1 };
	}
	if (event.type === "ui_prompt_end") {
		if (state.promptDepth === 0 || state.promptStartedAt === null) return state;
		return state.promptDepth > 1
			? { ...state, promptDepth: state.promptDepth - 1 }
			: {
					...state,
					promptDepth: 0,
					promptStartedAt: null,
					promptWaitMs: state.promptWaitMs + Math.max(0, event.now - state.promptStartedAt),
				};
	}
	if (event.type === "assistant_finalized") {
		const latestAssistant = {};
		if (event.errorMessage !== undefined) Object.assign(latestAssistant, { errorMessage: event.errorMessage });
		if (event.preview !== undefined) Object.assign(latestAssistant, { preview: event.preview });
		if (event.stopReason !== undefined) Object.assign(latestAssistant, { stopReason: event.stopReason });
		return {
			...state,
			latestAssistant,
		};
	}
	if (event.type === "agent_settled") {
		if (state.status !== "running") return state;
		const promptWaitMs = state.promptWaitMs + Math.max(0, event.now - (state.promptStartedAt ?? event.now));
		return { ...state, promptDepth: 0, promptStartedAt: null, promptWaitMs, settledAt: event.now, status: "pending" };
	}
	if ((event.type === "input" || event.type === "terminal_input") && state.status === "pending") {
		return idleAfter(state);
	}
	return state;
}

function classifyOutcome(message: FinalAssistantOutcome | undefined): NotificationAlert["outcome"] | undefined {
	if (!message || message.stopReason === "aborted") return undefined;
	return message.stopReason === "error" || message.errorMessage?.trim() ? "failure" : "completion";
}

export class NotificationRuntime {
	private readonly clock: NotificationClock;
	private readonly getSettings: () => NotificationRuntimeSettings;
	private readonly isQuiet: () => boolean;
	private readonly notify: (alert: NotificationAlert) => void;
	private state: WorkCycleState = createWorkCycleState();
	private timer: NotificationTimer | undefined;

	constructor(options: {
		readonly clock: NotificationClock;
		readonly getSettings: () => NotificationRuntimeSettings;
		readonly isQuiet: () => boolean;
		readonly notify: (alert: NotificationAlert) => void;
	}) {
		this.clock = options.clock;
		this.getSettings = options.getSettings;
		this.isQuiet = options.isQuiet;
		this.notify = options.notify;
	}

	dispose(): void {
		this.clearTimer();
		this.state = reduceWorkCycle(this.state, { type: "clear" });
	}

	observe(event: NotificationRuntimeEvent): void {
		const previous = this.state;
		this.state = reduceWorkCycle(
			previous,
			event.type === "agent_start" ||
				event.type === "agent_settled" ||
				event.type === "ui_prompt_start" ||
				event.type === "ui_prompt_end"
				? { now: this.clock.now(), type: event.type }
				: event,
		);
		if (this.timer && (this.state.generation !== previous.generation || this.state.status !== "pending")) {
			this.clearTimer();
		}
		if (event.type !== "agent_settled" || this.state.status !== "pending" || this.timer) return;
		if (!this.state.includesUserWork) {
			this.state = reduceWorkCycle(this.state, { type: "clear" });
			return;
		}
		this.schedule(this.state);
	}

	private clearTimer(): void {
		if (!this.timer) return;
		this.clock.clearTimeout(this.timer);
		this.timer = undefined;
	}

	private schedule(cycle: PendingWorkCycle): void {
		const delayMs = this.getSettings().gracePeriodMs;
		const timer = this.clock.setTimeout(() => {
			if (this.timer === timer) this.timer = undefined;
			let quiet = false;
			try {
				quiet = this.isQuiet();
			} catch {
				return;
			}
			if (this.state.status !== "pending" || this.state.generation !== cycle.generation || !quiet) {
				return;
			}
			const settled = this.state;
			this.state = reduceWorkCycle(this.state, { type: "clear" });
			const settings = this.getSettings();
			const elapsedMs = Math.max(0, settled.settledAt - settled.startedAt - settled.promptWaitMs);
			const outcome = classifyOutcome(settled.latestAssistant);
			if (
				!settings.enabled ||
				elapsedMs < settings.minimumDurationMs ||
				!outcome ||
				(outcome === "completion" && !settings.completionAlerts) ||
				(outcome === "failure" && !settings.failureAlerts)
			) {
				return;
			}
			try {
				const alert = {
					elapsedMs,
					outcome,
				};
				if (settled.latestAssistant?.preview) Object.assign(alert, { preview: settled.latestAssistant.preview });
				this.notify(alert);
			} catch {
				// Notification delivery is observational and cannot fail Agent work.
			}
		}, delayMs);
		this.timer = timer;
		timer.unref?.();
	}
}
