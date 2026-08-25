export type ToolActivityState = "cancelled" | "error" | "rejected" | "running" | "success";

export interface ToolActivity {
	readonly detailLines: readonly string[];
	/** Undefined for historical rows replayed without a live execution clock. */
	readonly durationMs: number | undefined;
	readonly id: string;
	readonly label: string;
	readonly name: string;
	readonly sequence: number;
	readonly startedAt: number | undefined;
	readonly state: ToolActivityState;
	readonly summary: string;
	readonly summaryFromResult?: boolean;
	readonly target: string;
}

export interface StartToolActivity {
	readonly id: string;
	readonly label: string;
	readonly name: string;
	readonly startedAt?: number;
	readonly target: string;
}

export interface SettleToolActivity {
	readonly detailLines: readonly string[];
	readonly durationMs: number | undefined;
	readonly state: Exclude<ToolActivityState, "running">;
	readonly summary: string;
	readonly summaryFromResult?: boolean;
}

type ActivityListener = (activities: readonly ToolActivity[]) => void;

const DEFAULT_ACTIVITY_LIMIT = 768;

function terminal(state: ToolActivityState): boolean {
	return state !== "running";
}

function immutableActivity(activity: ToolActivity): ToolActivity {
	return Object.freeze({
		...activity,
		detailLines: Object.freeze([...activity.detailLines]),
	});
}

/** Bounded, process-local projection rebuilt from Host tool rows after reload. */
export class ToolActivityStore {
	private readonly activities = new Map<string, ToolActivity>();
	private readonly limit: number;
	private readonly listeners = new Set<ActivityListener>();
	private nextSequence = 1;

	constructor(limit = DEFAULT_ACTIVITY_LIMIT) {
		this.limit = Math.max(1, Math.floor(limit));
	}

	begin(input: StartToolActivity): ToolActivity {
		const existing = this.activities.get(input.id);
		if (existing && terminal(existing.state)) return existing;
		if (
			existing &&
			existing.label === input.label &&
			existing.name === input.name &&
			existing.target === input.target
		) {
			if (existing.startedAt === undefined && input.startedAt !== undefined) {
				const updated = immutableActivity({ ...existing, startedAt: input.startedAt });
				this.activities.set(input.id, updated);
				return updated;
			}
			return existing;
		}
		const activity = immutableActivity({
			detailLines: existing?.detailLines ?? [],
			durationMs: existing?.durationMs,
			id: input.id,
			label: input.label,
			name: input.name,
			sequence: existing?.sequence ?? this.nextSequence++,
			startedAt: existing?.startedAt ?? input.startedAt,
			state: "running",
			summary: "running",
			target: input.target,
		});
		this.activities.set(input.id, activity);
		this.prune();
		this.notify();
		return activity;
	}

	clear(): void {
		if (this.activities.size === 0) return;
		this.activities.clear();
		this.notify();
	}

	get(id: string): ToolActivity | undefined {
		return this.activities.get(id);
	}

	list(): readonly ToolActivity[] {
		return [...this.activities.values()].sort((left, right) => right.sequence - left.sequence);
	}

	resolve(idOrPrefix: string): ToolActivity | undefined {
		const normalized = idOrPrefix.trim();
		if (!normalized) return undefined;
		const exact = this.activities.get(normalized);
		if (exact) return exact;
		const matches = this.list().filter((activity) => activity.id.startsWith(normalized));
		return matches.length === 1 ? matches[0] : undefined;
	}

	settle(id: string, input: SettleToolActivity): ToolActivity | undefined {
		const existing = this.activities.get(id);
		if (!existing) return undefined;
		const durationMs = input.durationMs === undefined ? undefined : Math.max(0, Math.floor(input.durationMs));
		if (
			existing.durationMs === durationMs &&
			existing.state === input.state &&
			existing.summary === input.summary &&
			existing.summaryFromResult === (input.summaryFromResult === true) &&
			existing.detailLines.length === input.detailLines.length &&
			existing.detailLines.every((line, index) => line === input.detailLines[index])
		) {
			return existing;
		}
		const activity = immutableActivity({
			...existing,
			detailLines: input.detailLines,
			durationMs,
			state: input.state,
			summary: input.summary,
			summaryFromResult: input.summaryFromResult === true,
		});
		this.activities.set(id, activity);
		this.notify();
		return activity;
	}

	subscribe(listener: ActivityListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		if (this.listeners.size === 0) return;
		const snapshot = this.list();
		for (const listener of this.listeners) {
			try {
				listener(snapshot);
			} catch {
				// A details view cannot block Host tool execution or transcript rendering.
			}
		}
	}

	private prune(): void {
		while (this.activities.size > this.limit) {
			let oldest: ToolActivity | undefined;
			for (const activity of this.activities.values()) {
				if (!oldest || activity.sequence < oldest.sequence) oldest = activity;
			}
			if (!oldest) return;
			this.activities.delete(oldest.id);
		}
	}
}
