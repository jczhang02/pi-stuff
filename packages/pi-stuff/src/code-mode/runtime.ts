import type { AgentToolResult, AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SuiteToolEnvelopeOperation } from "../tool-display/contract.js";
import { buildSuiteSandboxSource, type SuiteCodeModeConnector } from "./connector.js";
import { captureCodeModeModelContent } from "./presentation.js";
import type {
	CodeModeExecuteOptions,
	CodeModeWaitOptions,
	RuntimeContentItem,
	RuntimeResponse,
	RuntimeToolTrace,
} from "./protocol.js";

const AUTO_WAIT_MS = 60_000;
const MAX_OUTPUT_CHARS = 400_000;
const NESTED_CANCELLATION_TEXT = "Operation aborted";

export interface CodeModeExecutor {
	execute(options: CodeModeExecuteOptions): Promise<RuntimeResponse>;
	shutdown(): Promise<void>;
	wait(cellId: string, options: CodeModeWaitOptions & { readonly yieldTimeMs: number }): Promise<RuntimeResponse>;
}

export interface PiStuffCodeModeDetails {
	readonly cellId?: string;
	readonly droppedOperationCount?: number;
	readonly error?: string;
	readonly kind: "pi-stuff-code-mode";
	/** Normalized provider-facing content retained outside the Host-rendered result. */
	readonly modelContent?: AgentToolResult<unknown>["content"];
	/** Content indexes for each normalized media segment in modelContent. */
	readonly mediaContentIndexes?: readonly (readonly number[])[];
	readonly operations: readonly SuiteToolEnvelopeOperation[];
	readonly status: "cancelled" | "error" | "running" | "success";
}

function operation(trace: RuntimeToolTrace): SuiteToolEnvelopeOperation {
	return {
		args:
			typeof trace.input === "object" && trace.input !== null && !Array.isArray(trace.input)
				? (trace.input as Record<string, unknown>)
				: {},
		id: trace.id,
		name: trace.name,
		...(trace.result ? { result: trace.result } : {}),
		state:
			trace.status === "done"
				? "success"
				: trace.status === "error"
					? "error"
					: trace.status === "cancelled"
						? "cancelled"
						: "running",
	};
}

function imageKey(item: AgentToolResult<unknown>["content"][number]): string | undefined {
	return item.type === "image" ? `${item.mimeType}\u0000${item.data}` : undefined;
}

function projectFinalMedia(
	traces: ReadonlyMap<string, RuntimeToolTrace>,
	content: AgentToolResult<unknown>["content"],
): { readonly content: AgentToolResult<unknown>["content"]; readonly operations: SuiteToolEnvelopeOperation[] } {
	const output = [...content];
	const available = new Map<string, number[]>();
	let imageIndex = 0;
	for (const item of output) {
		const key = imageKey(item);
		if (!key) continue;
		const indexes = available.get(key) ?? [];
		indexes.push(imageIndex);
		available.set(key, indexes);
		imageIndex += 1;
	}
	const operations = [...traces.values()].map((trace) => {
		const projected = operation(trace);
		if (!trace.result) return projected;
		const mediaPlacements: Array<{ readonly afterContentIndex: number; readonly mediaIndex: number }> = [];
		const nonMedia: AgentToolResult<unknown>["content"] = [];
		for (const item of trace.result.content) {
			const key = imageKey(item);
			if (!key) {
				nonMedia.push(item);
				continue;
			}
			const reusable = available.get(key)?.shift();
			if (reusable !== undefined) {
				mediaPlacements.push({ afterContentIndex: nonMedia.length, mediaIndex: reusable });
				continue;
			}
			mediaPlacements.push({ afterContentIndex: nonMedia.length, mediaIndex: imageIndex });
			imageIndex += 1;
			output.push(item);
		}
		return mediaPlacements.length === 0
			? projected
			: {
					...projected,
					mediaPlacements,
					result: { ...trace.result, content: nonMedia },
				};
	});
	return { content: output, operations };
}

function mergeTraces(target: Map<string, RuntimeToolTrace>, traces: readonly RuntimeToolTrace[] | undefined): void {
	for (const trace of traces ?? []) target.set(trace.id, trace);
}

function settleRunningTraces(
	traces: ReadonlyMap<string, RuntimeToolTrace>,
	status: "cancelled" | "error",
	message: string,
): void {
	for (const trace of traces.values()) {
		if (trace.status !== "running") continue;
		trace.status = status;
		trace.error = message;
		trace.result ??= { content: [{ type: "text", text: message }], details: {} };
	}
}

function wasCancelled(error: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

function contentItem(item: RuntimeContentItem): AgentToolResult<unknown>["content"][number] | undefined {
	if (item.type === "input_text" && typeof item.text === "string") return { type: "text", text: item.text };
	if (item.type !== "input_image" || typeof item.image_url !== "string") return undefined;
	const match = item.image_url.match(/^data:([^;,]+);base64,(.+)$/su);
	return match ? { type: "image", data: match[2] ?? "", mimeType: match[1] ?? "application/octet-stream" } : undefined;
}

function boundedContent(items: readonly RuntimeContentItem[], fallback: string): AgentToolResult<unknown>["content"] {
	let remaining = MAX_OUTPUT_CHARS;
	const output: AgentToolResult<unknown>["content"] = [];
	for (const item of items) {
		const converted = contentItem(item);
		if (!converted) continue;
		if (converted.type !== "text") {
			output.push(converted);
			continue;
		}
		if (remaining <= 0) continue;
		const text = converted.text.slice(0, remaining);
		remaining -= text.length;
		output.push({ type: "text", text: text.length === converted.text.length ? text : `${text}\n[Output truncated]` });
	}
	return output.length > 0 ? output : [{ type: "text", text: fallback }];
}

type ToolUsage = NonNullable<AgentToolResult<unknown>["usage"]>;

function aggregateUsage(results: readonly AgentToolResult<unknown>[]): ToolUsage | undefined {
	const values = results.flatMap((result) => (result.usage ? [result.usage] : []));
	if (values.length === 0) return undefined;
	const optional = (key: "cacheWrite1h" | "reasoning"): number | undefined => {
		const present = values.filter((usage) => usage[key] !== undefined);
		return present.length > 0 ? present.reduce((total, usage) => total + (usage[key] ?? 0), 0) : undefined;
	};
	const cacheWrite1h = optional("cacheWrite1h");
	const reasoning = optional("reasoning");
	return {
		cacheRead: values.reduce((total, usage) => total + usage.cacheRead, 0),
		cacheWrite: values.reduce((total, usage) => total + usage.cacheWrite, 0),
		...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
		cost: {
			cacheRead: values.reduce((total, usage) => total + usage.cost.cacheRead, 0),
			cacheWrite: values.reduce((total, usage) => total + usage.cost.cacheWrite, 0),
			input: values.reduce((total, usage) => total + usage.cost.input, 0),
			output: values.reduce((total, usage) => total + usage.cost.output, 0),
			total: values.reduce((total, usage) => total + usage.cost.total, 0),
		},
		input: values.reduce((total, usage) => total + usage.input, 0),
		output: values.reduce((total, usage) => total + usage.output, 0),
		...(reasoning === undefined ? {} : { reasoning }),
		totalTokens: values.reduce((total, usage) => total + usage.totalTokens, 0),
	};
}

function nestedResultControls(traces: ReadonlyMap<string, RuntimeToolTrace>): {
	readonly addedToolNames?: string[];
	readonly terminate?: true;
	readonly usage?: ToolUsage;
} {
	const results = [...traces.values()].flatMap((trace) => (trace.result ? [trace.result] : []));
	const addedToolNames = [...new Set(results.flatMap((result) => result.addedToolNames ?? []))];
	const usage = aggregateUsage(results);
	return {
		...(addedToolNames.length > 0 ? { addedToolNames } : {}),
		...(results.some((result) => result.terminate === true) ? { terminate: true as const } : {}),
		...(usage ? { usage } : {}),
	};
}

export class CodeModeRuntime {
	readonly connector: SuiteCodeModeConnector;
	readonly executor: CodeModeExecutor;

	constructor(connector: SuiteCodeModeConnector, executor: CodeModeExecutor) {
		this.connector = connector;
		this.executor = executor;
	}

	async execute(
		outerToolCallId: string,
		code: string,
		context: ExtensionContext,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<PiStuffCodeModeDetails>,
	): Promise<AgentToolResult<PiStuffCodeModeDetails>> {
		const traces = new Map<string, RuntimeToolTrace>();
		let droppedOperationCount = 0;
		let cellId: string | undefined;
		const details = (
			status: PiStuffCodeModeDetails["status"],
			error?: string,
			operations: readonly SuiteToolEnvelopeOperation[] = [...traces.values()].map(operation),
		): PiStuffCodeModeDetails => ({
			...(cellId ? { cellId } : {}),
			...(droppedOperationCount > 0 ? { droppedOperationCount } : {}),
			...(error ? { error } : {}),
			kind: "pi-stuff-code-mode",
			operations,
			status,
		});
		const publish = (): void => {
			onUpdate?.({ content: [], details: details("running") });
		};
		const executorContext = {
			cwd: context.cwd,
			extensionContext: context,
			onTraceUpdate: (update: {
				cellId: string;
				droppedTraceCount?: number;
				traces: readonly RuntimeToolTrace[];
			}) => {
				cellId = update.cellId;
				droppedOperationCount = Math.max(droppedOperationCount, update.droppedTraceCount ?? 0);
				mergeTraces(traces, update.traces);
				publish();
			},
			toolCallId: outerToolCallId,
		};
		try {
			const tools = this.connector.tools();
			let response = await this.executor.execute({
				context: executorContext,
				...(signal ? { signal } : {}),
				source: buildSuiteSandboxSource(code, this.connector.catalog()),
				tools,
			});
			cellId = response.cellId;
			droppedOperationCount = Math.max(droppedOperationCount, response.droppedTraceCount ?? 0);
			mergeTraces(traces, response.traces);
			publish();
			while (response.kind === "yielded") {
				response = await this.executor.wait(response.cellId, {
					context: executorContext,
					...(signal ? { signal } : {}),
					yieldTimeMs: AUTO_WAIT_MS,
				});
				cellId = response.cellId;
				droppedOperationCount = Math.max(droppedOperationCount, response.droppedTraceCount ?? 0);
				mergeTraces(traces, response.traces);
				publish();
			}
			const error = response.kind === "result" ? response.errorText : undefined;
			const status = response.kind === "terminated" ? "cancelled" : error ? "error" : "success";
			if (status !== "success") {
				settleRunningTraces(
					traces,
					status,
					status === "cancelled" ? NESTED_CANCELLATION_TEXT : (error ?? "Code Mode execution failed"),
				);
			}
			const media = projectFinalMedia(
				traces,
				boundedContent(
					response.contentItems,
					error ??
						(status === "cancelled"
							? "Code Mode execution was cancelled"
							: "Code completed with no output; use text(...) to return a value"),
				),
			);
			const finalDetails = details(status, error, media.operations);
			captureCodeModeModelContent(finalDetails, media.content);
			return {
				content: media.content,
				details: finalDetails,
				...nestedResultControls(traces),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = wasCancelled(error, signal) ? "cancelled" : "error";
			settleRunningTraces(traces, status, status === "cancelled" ? NESTED_CANCELLATION_TEXT : message);
			const media = projectFinalMedia(traces, [{ type: "text", text: message }]);
			const finalDetails = details(status, message, media.operations);
			captureCodeModeModelContent(finalDetails, media.content);
			return {
				content: media.content,
				details: finalDetails,
				...nestedResultControls(traces),
			};
		}
	}

	shutdown(): Promise<void> {
		return this.executor.shutdown();
	}
}
