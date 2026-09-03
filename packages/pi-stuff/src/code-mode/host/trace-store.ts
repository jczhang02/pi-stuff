import type { CodemodeValue } from "../cloudflare/codec.js";
import type {
	ExecutorContext,
	RuntimeResponse,
	RuntimeToolCallPlan,
	RuntimeToolTrace,
	RuntimeTraceUpdate,
} from "../protocol.js";
import { MAX_RETAINED_CODE_MODE_TRACES } from "../protocol.js";

interface TraceState {
	dropped: number;
	readonly ids: Set<string>;
	readonly traces: RuntimeToolTrace[];
}

function cloneTrace(trace: RuntimeToolTrace): RuntimeToolTrace {
	try {
		return structuredClone(trace);
	} catch {
		const clone: RuntimeToolTrace = {
			...trace,
			input: "[unserializable input]",
		};
		if (trace.result) {
			clone.result = { content: [{ type: "text", text: "[unserializable Tool result]" }], details: {} };
		}
		return clone;
	}
}

export class CodeModeTraceStore {
	private readonly states = new Map<string, TraceState>();

	clear(): void {
		this.states.clear();
	}

	delete(cellId: string): void {
		this.states.delete(cellId);
	}

	start(cellId: string, id: string, name: string, input: CodemodeValue, plan?: RuntimeToolCallPlan): RuntimeToolTrace {
		const state = this.states.get(cellId) ?? { dropped: 0, ids: new Set(), traces: [] };
		if (state.ids.has(id)) throw new Error(`Duplicate Code Mode nested Tool call ID: ${id}`);
		const trace: RuntimeToolTrace = {
			id,
			input,
			name,
			status: "running",
		};
		if (plan) {
			Object.assign(trace, {
				attempt: plan.attempt,
				executionId: plan.executionId,
				replayed: plan.replay !== undefined,
				sequence: plan.sequence,
			});
		}
		state.ids.add(id);
		state.traces.push(trace);
		if (state.traces.length > MAX_RETAINED_CODE_MODE_TRACES) {
			state.traces.shift();
			state.dropped += 1;
		}
		this.states.set(cellId, state);
		return trace;
	}

	emit(cellId: string, trace: RuntimeToolTrace, context: ExecutorContext): void {
		try {
			const state = this.states.get(cellId);
			if (!state?.traces.some((retained) => retained.id === trace.id)) return;
			const update: RuntimeTraceUpdate = {
				cellId,
				trace: cloneTrace(trace),
			};
			if (state && state.dropped > 0) Object.assign(update, { droppedTraceCount: state.dropped });
			context.onTraceUpdate?.(update);
		} catch {
			// UI projection failures never change nested Tool execution.
		}
	}

	attach(response: RuntimeResponse): RuntimeResponse {
		const state = this.states.get(response.cellId);
		if (response.kind !== "yielded") this.delete(response.cellId);
		if (!state) return response;
		const projected = { ...response };
		if (state.dropped > 0) Object.assign(projected, { droppedTraceCount: state.dropped });
		if (state.traces.length > 0) Object.assign(projected, { traces: state.traces.map(cloneTrace) });
		return projected;
	}
}
