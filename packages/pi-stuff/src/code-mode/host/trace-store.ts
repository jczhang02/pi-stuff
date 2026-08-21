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
		return {
			...trace,
			input: "[unserializable input]",
			...(trace.result
				? { result: { content: [{ type: "text", text: "[unserializable Tool result]" }], details: {} } }
				: {}),
		};
	}
}

export class CodeModeTraceStore {
	private readonly traces = new Map<string, RuntimeToolTrace[]>();

	clear(): void {
		this.traces.clear();
	}

	delete(cellId: string): void {
		this.traces.delete(cellId);
	}

	start(cellId: string, id: string, name: string, input: CodemodeValue, plan?: RuntimeToolCallPlan): RuntimeToolTrace {
		const traces = this.traces.get(cellId) ?? [];
		if (traces.length >= MAX_OPERATION_COUNT) {
			throw new Error(`Code Mode supports at most ${String(MAX_OPERATION_COUNT)} nested Tool calls per execution`);
		}
		if (traces.some((trace) => trace.id === id)) {
			throw new Error(`Duplicate Code Mode nested Tool call ID: ${id}`);
		}
		const trace: RuntimeToolTrace = {
			...(plan
				? {
						attempt: plan.attempt,
						executionId: plan.executionId,
						replayed: plan.replay !== undefined,
						sequence: plan.sequence,
					}
				: {}),
			id,
			input,
			name,
			status: "running",
		};
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
