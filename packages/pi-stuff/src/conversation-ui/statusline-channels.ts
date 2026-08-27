import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRuntimeNumber } from "../shared/runtime-type.js";
import { getHostSharedResource } from "./host-resource.js";

export interface CodexStatusSnapshot {
	readonly fastEnabled: boolean;
	readonly weeklyRemainingPercent?: number;
}

export interface CodexStatusSource {
	getSnapshot(): CodexStatusSnapshot;
	subscribe(listener: () => void): () => void;
}

export interface CodexStatusChannel {
	readonly source: CodexStatusSource;
	clear(): void;
	publish(snapshot: CodexStatusSnapshot): void;
}

export type GoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";

export interface GoalStatusSnapshot {
	readonly activeStartedAt?: number;
	readonly status: GoalStatus;
	readonly timeUsedSeconds: number;
	readonly tokenBudget?: number;
	readonly tokensUsed: number;
}

export interface GoalStatusSource {
	getSnapshot(): GoalStatusSnapshot | undefined;
	subscribe(listener: () => void): () => void;
}

export interface GoalStatusChannel {
	readonly source: GoalStatusSource;
	clear(): void;
	publish(snapshot: GoalStatusSnapshot): void;
}

const CODEX_STATUS_CHANNELS = Symbol.for("@jczhang02/pi-stuff-ui/codex-status-channels/v1");
const GOAL_STATUS_CHANNELS = Symbol.for("@jczhang02/pi-stuff-ui/goal-status-channels/v1");
const CODEX_STATUS_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/codex-status-discovery/v1";
const GOAL_STATUS_DISCOVERY_EVENT = "@jczhang02/pi-stuff-ui/goal-status-discovery/v1";
const REJECTED_STATUS = Symbol("rejected status");

type StatusChannelHost = Pick<ExtensionAPI, "events"> & Partial<Pick<ExtensionAPI, "on">>;

class SharedStatusChannel<Input, Snapshot> {
	private readonly initialSnapshot: () => Snapshot;
	private readonly listeners = new Set<() => void>();
	private readonly normalize: (input: Input) => Snapshot | typeof REJECTED_STATUS;
	private snapshot: Snapshot;
	readonly source = this;

	constructor(initialSnapshot: () => Snapshot, normalize: (input: Input) => Snapshot | typeof REJECTED_STATUS) {
		this.initialSnapshot = initialSnapshot;
		this.normalize = normalize;
		this.snapshot = initialSnapshot();
	}

	clear(): void {
		this.setSnapshot(this.initialSnapshot());
	}

	getSnapshot(): Snapshot {
		return this.snapshot;
	}

	publish(input: Input): void {
		const next = this.normalize(input);
		if (next !== REJECTED_STATUS) this.setSnapshot(next);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setSnapshot(next: Snapshot): void {
		if (JSON.stringify(this.snapshot) === JSON.stringify(next)) return;
		this.snapshot = next;
		for (const listener of this.listeners) callObserver(listener);
	}
}

function normalizeCodexStatus(snapshot: CodexStatusSnapshot): CodexStatusSnapshot {
	const next: CodexStatusSnapshot = { fastEnabled: snapshot.fastEnabled === true };
	if (isRuntimeNumber(snapshot.weeklyRemainingPercent) && Number.isFinite(snapshot.weeklyRemainingPercent)) {
		Object.assign(next, { weeklyRemainingPercent: snapshot.weeklyRemainingPercent });
	}
	return next;
}

function normalizeGoalStatus(snapshot: GoalStatusSnapshot): GoalStatusSnapshot | typeof REJECTED_STATUS {
	if (!isGoalStatus(snapshot.status)) return REJECTED_STATUS;
	const next: GoalStatusSnapshot = {
		status: snapshot.status,
		timeUsedSeconds: finiteNonNegative(snapshot.timeUsedSeconds),
		tokensUsed: finiteNonNegative(snapshot.tokensUsed),
	};
	const activeStartedAt = snapshot.status === "active" ? finitePositive(snapshot.activeStartedAt) : undefined;
	const tokenBudget = finitePositive(snapshot.tokenBudget);
	if (activeStartedAt !== undefined) Object.assign(next, { activeStartedAt });
	if (tokenBudget !== undefined) Object.assign(next, { tokenBudget });
	return next;
}

function finiteNonNegative(value: number): number {
	return isRuntimeNumber(value) && Number.isFinite(value) && value >= 0 ? value : 0;
}

function finitePositive(value: number | undefined): number | undefined {
	return isRuntimeNumber(value) && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isGoalStatus(value: string): value is GoalStatus {
	return ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(value);
}

function callObserver(observer: () => void): void {
	try {
		observer();
	} catch {
		// Shared presentation channels isolate observer failures.
	}
}

function statusChannels<Channel extends object>(key: symbol): WeakMap<ExtensionAPI["events"], Channel> {
	// SAFETY: this package is the sole writer of the symbol-owned slot and stores only the declared WeakMap.
	const root = globalThis as {
		[key: symbol]: WeakMap<ExtensionAPI["events"], Channel> | undefined;
	};
	root[key] ??= new WeakMap();
	return root[key];
}

function getStatusChannel<Channel extends object>(
	pi: StatusChannelHost,
	key: symbol,
	discoveryEvent: string,
	create: () => Channel,
): Channel {
	const channels = statusChannels<Channel>(key);
	// SAFETY: ExtensionAPI events are objects, so this WeakMap's keys satisfy the shared resource's object-key contract.
	return getHostSharedResource(pi.events, channels as WeakMap<object, Channel>, discoveryEvent, create, {
		registerOwnerCleanup: (cleanup) => pi.on?.("session_shutdown", cleanup),
	});
}

/** Share one late-bindable Codex presentation channel across Capability copies. */
export function getCodexStatusChannel(pi: StatusChannelHost): CodexStatusChannel {
	return getStatusChannel(
		pi,
		CODEX_STATUS_CHANNELS,
		CODEX_STATUS_DISCOVERY_EVENT,
		() =>
			new SharedStatusChannel<CodexStatusSnapshot, CodexStatusSnapshot>(
				() => ({ fastEnabled: false }),
				normalizeCodexStatus,
			),
	);
}

/** Share one observation-only Goal presentation channel across Capability copies. */
export function getGoalStatusChannel(pi: StatusChannelHost): GoalStatusChannel {
	return getStatusChannel(
		pi,
		GOAL_STATUS_CHANNELS,
		GOAL_STATUS_DISCOVERY_EVENT,
		() =>
			new SharedStatusChannel<GoalStatusSnapshot, GoalStatusSnapshot | undefined>(
				() => undefined,
				normalizeGoalStatus,
			),
	);
}
