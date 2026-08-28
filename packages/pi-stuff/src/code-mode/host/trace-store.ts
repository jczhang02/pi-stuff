import type { CodemodeValue } from "../cloudflare/codec.js";
import type {
	ExecutorContext,
	RuntimeResponse,
	RuntimeToolCallPlan,
	RuntimeToolTrace,
	RuntimeTraceUpdate,
} from "../protocol.js";

const MAX_OPERATION_COUNT = 768;

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
	private readonly operationCounts = new Map<string, number>();
	private readonly traces = new Map<string, RuntimeToolTrace[]>();

	clear(): void {
		this.operationCounts.clear();
		this.traces.clear();
	}

	delete(cellId: string): void {
		this.operationCounts.delete(cellId);
		this.traces.delete(cellId);
	}

	reserve(cellId: string): void {
		const count = this.operationCounts.get(cellId) ?? 0;
		if (count >= MAX_OPERATION_COUNT) {
			throw new Error(`Code Mode supports at most ${String(MAX_OPERATION_COUNT)} nested Tool calls per execution`);
		}
		this.operationCounts.set(cellId, count + 1);
	}

	start(cellId: string, id: string, name: string, input: CodemodeValue, plan?: RuntimeToolCallPlan): RuntimeToolTrace {
		const traces = this.traces.get(cellId) ?? [];
		if (traces.some((trace) => trace.id === id)) {
			throw new Error(`Duplicate Code Mode nested Tool call ID: ${id}`);
		}
		this.reserve(cellId);
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
		traces.push(trace);
		this.traces.set(cellId, traces);
		return trace;
	}

	emit(cellId: string, trace: RuntimeToolTrace, context: ExecutorContext): void {
		try {
			const update: RuntimeTraceUpdate = {
				cellId,
				trace: cloneTrace(trace),
			};
			context.onTraceUpdate?.(update);
		} catch {
			// UI projection failures never change nested Tool execution.
		}
	}

	attach(response: RuntimeResponse): RuntimeResponse {
		const traces = this.traces.get(response.cellId)?.map(cloneTrace);
		if (response.kind !== "yielded") this.delete(response.cellId);
		return traces && traces.length > 0 ? { ...response, traces } : response;
	}
}
