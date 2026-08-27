import type { PlannedRetrievalGroup } from "./activity.js";
import type { ToolUiTimerScheduler } from "./contract.js";

const TIMER_STATE_LIMIT = 768;

interface ToolTimerState {
	invalidate: () => void;
	setMarkerVisible: (visible: boolean) => void;
	visible: boolean;
}

type ActivityClockHooks = {
	leaderIdFor: (toolCallId: string) => string | undefined;
	reconcileLeader: (leaderId: string) => void;
	reconcileTool: (toolCallId: string) => void;
	runningMemberId: (leaderId: string) => string | undefined;
	setLeaderMarker: (leaderId: string, visible: boolean, invalidate: boolean) => void;
};

export const DEFAULT_TOOL_UI_TIMER_SCHEDULER: ToolUiTimerScheduler = {
	setInterval: (callback, delayMs) => {
		const id = setInterval(callback, delayMs);
		id.unref?.();
		return id;
	},
	clearInterval: (id) => clearInterval(id),
};

export class ToolActivityClock {
	private readonly groupPulses = new Map<string, { visible: boolean }>();
	private groupPulseTimer: ReturnType<ToolUiTimerScheduler["setInterval"]> | undefined;
	private timer: ReturnType<ToolUiTimerScheduler["setInterval"]> | undefined;
	private readonly timerStates = new Map<string, ToolTimerState>();
	private readonly hooks: ActivityClockHooks;
	private readonly scheduler: ToolUiTimerScheduler;

	constructor(scheduler: ToolUiTimerScheduler, hooks: ActivityClockHooks) {
		this.scheduler = scheduler;
		this.hooks = hooks;
	}

	start(toolCallId: string, invalidate: () => void, setMarkerVisible: (visible: boolean) => void = () => {}): void {
		const existing = this.timerStates.get(toolCallId);
		const visible = existing?.visible ?? true;
		if (existing) this.timerStates.delete(toolCallId);
		while (this.timerStates.size >= TIMER_STATE_LIMIT) {
			const oldestId = this.timerStates.keys().next().value;
			if (!oldestId) break;
			const oldest = this.timerStates.get(oldestId);
			this.timerStates.delete(oldestId);
			oldest?.setMarkerVisible(true);
			this.pulseGroup(oldestId, true);
			this.hooks.reconcileTool(oldestId);
		}
		this.timerStates.set(toolCallId, { invalidate, setMarkerVisible, visible });
		setMarkerVisible(visible);
		if (this.isGroupMarkerDriver(toolCallId)) this.pulseGroup(toolCallId, visible);
		this.timer ??= this.scheduler.setInterval(() => this.tick(), 600);
		this.hooks.reconcileTool(toolCallId);
	}

	stop(toolCallId: string): void {
		const state = this.timerStates.get(toolCallId);
		if (!state) return;
		this.timerStates.delete(toolCallId);
		state.setMarkerVisible(true);
		if (this.timerStates.size === 0 && this.timer !== undefined) {
			this.scheduler.clearInterval(this.timer);
			this.timer = undefined;
		}
		this.pulseGroup(toolCallId, true);
		this.hooks.reconcileTool(toolCallId);
	}

	sync(): void {
		for (const [toolCallId, state] of this.timerStates) {
			state.visible = true;
			state.setMarkerVisible(true);
			this.pulseGroup(toolCallId, true);
			state.invalidate();
		}
		this.reconcileTimerGroups();
	}

	suspend(): void {
		for (const toolCallId of Array.from(this.timerStates.keys())) this.stop(toolCallId);
		for (const leaderId of Array.from(this.groupPulses.keys())) this.dropGroup(leaderId);
	}

	reconcileGroup(group: PlannedRetrievalGroup, active: boolean): void {
		const hasToolTimer = group.members.some((member) => this.timerStates.has(member.id));
		if (!active || hasToolTimer) {
			this.dropGroup(group.leaderId);
			return;
		}
		if (this.groupPulses.has(group.leaderId)) return;
		this.groupPulses.set(group.leaderId, { visible: true });
		this.groupPulseTimer ??= this.scheduler.setInterval(() => this.tickGroupPulses(), 600);
	}

	dropGroup(leaderId: string): void {
		if (!this.groupPulses.delete(leaderId)) return;
		if (this.groupPulses.size === 0 && this.groupPulseTimer !== undefined) {
			this.scheduler.clearInterval(this.groupPulseTimer);
			this.groupPulseTimer = undefined;
		}
		this.hooks.setLeaderMarker(leaderId, true, true);
	}

	pruneGroups(validLeaderIds: ReadonlySet<string>): void {
		for (const leaderId of Array.from(this.groupPulses.keys())) {
			if (!validLeaderIds.has(leaderId)) this.dropGroup(leaderId);
		}
	}

	private tick(): void {
		for (const [toolCallId, state] of this.timerStates) {
			state.visible = !state.visible;
			state.setMarkerVisible(state.visible);
			if (this.isGroupMarkerDriver(toolCallId)) this.pulseGroup(toolCallId, state.visible);
			state.invalidate();
		}
		this.reconcileTimerGroups();
	}

	private reconcileTimerGroups(): void {
		const leaders = new Set<string>();
		for (const toolCallId of this.timerStates.keys()) {
			const leaderId = this.hooks.leaderIdFor(toolCallId);
			if (leaderId) leaders.add(leaderId);
			else this.hooks.reconcileTool(toolCallId);
		}
		for (const leaderId of leaders) this.hooks.reconcileLeader(leaderId);
	}

	private pulseGroup(toolCallId: string, visible: boolean): void {
		const leaderId = this.hooks.leaderIdFor(toolCallId);
		if (leaderId) this.hooks.setLeaderMarker(leaderId, visible, false);
	}

	private isGroupMarkerDriver(toolCallId: string): boolean {
		const leaderId = this.hooks.leaderIdFor(toolCallId);
		return !leaderId || this.hooks.runningMemberId(leaderId) === toolCallId;
	}

	private tickGroupPulses(): void {
		for (const [leaderId, pulse] of this.groupPulses) {
			pulse.visible = !pulse.visible;
			this.hooks.setLeaderMarker(leaderId, pulse.visible, true);
			this.hooks.reconcileLeader(leaderId);
		}
	}
}
