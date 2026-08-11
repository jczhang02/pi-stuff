const LIFECYCLE_TRACE_KEY = "@jczhang02/pi-stuff/lifecycle-performance";

interface LifecycleTraceState {
	readonly origin: number;
	readonly events: Array<{ readonly atMs: number; readonly label: string }>;
}

function traceState(): LifecycleTraceState | undefined {
	const value = (globalThis as Record<symbol, unknown>)[Symbol.for(LIFECYCLE_TRACE_KEY)];
	if (typeof value !== "object" || value === null) return undefined;
	const state = value as Partial<LifecycleTraceState>;
	if (typeof state.origin !== "number" || !Array.isArray(state.events)) return undefined;
	return state as LifecycleTraceState;
}

/** Inert unless the explicit lifecycle benchmark installs an in-process observer. */
export function markLifecyclePhase(label: string): void {
	const state = traceState();
	if (!state) return;
	state.events.push({ atMs: Number((performance.now() - state.origin).toFixed(3)), label });
}
