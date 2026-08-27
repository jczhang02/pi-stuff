/** Project one Agent writer's bounded protocol streams into background-run state. */

import type { JsonValue } from "../../../../shared/json-value.js";
import { parseJsonValue } from "../../../../shared/json-value.js";
import { appendArtifactJsonl } from "../../shared/artifacts.ts";
import type { ChildTranscriptWriter } from "../../shared/child-transcript.ts";
import { reportAgentDiagnostic } from "../../shared/diagnostics.ts";
import type { ProtocolOutputLimit, TurnBudgetState, Usage } from "../../shared/types.ts";
import { extractTextFromContent, extractToolArgsPreview, getFinalOutput } from "../../shared/utils.ts";
import {
	type ChildProtocolEvent,
	type ChildProtocolMessage,
	createBoundedByteTail,
	createBoundedLineReader,
	formatProtocolOutputLimit,
	MAX_CHILD_STDERR_BYTES,
	parseChildProtocolEvent,
	projectChildLifecycle,
} from "../shared/child-protocol.ts";
import type { BackgroundRunnerConfig, RunnerAgentTask } from "../shared/parallel-utils.ts";
import { initialTurnBudgetState, turnBudgetDecision, turnBudgetState } from "../shared/turn-budget.ts";
import type {
	BackgroundRunnerStatus as RunnerStatus,
	BackgroundRunnerStatusStep as RunnerStatusStep,
} from "./initial-status.ts";
import {
	addUsage,
	appendDiagnosticEvent,
	appendRecentOutput,
	assistantStartsToolCall,
	emptyUsage,
	estimatedChildMessageTokens,
	maxChildProtocolBytes,
	providerContextTokens,
	resolveTaskContextWindow,
	terminalAssistantStop,
	tokenUsage,
} from "./runner-output.ts";
import { writeStatus } from "./runner-state.ts";

type ChildProtocolTerminalCause = "protocol" | "turn-budget";

export interface ChildProtocolRuntimeInput {
	config: BackgroundRunnerConfig;
	task: RunnerAgentTask;
	index: number;
	model?: string | undefined;
	transcript: ChildTranscriptWriter;
	artifactJsonlPath?: string | undefined;
	statusStep: RunnerStatusStep;
	statusPath: string;
	status: RunnerStatus;
	startFinalDrain: (evidence: boolean) => void;
	cancelFinalDrain: () => void;
	terminate: (cause: ChildProtocolTerminalCause, error: string, signal: "SIGINT" | "SIGTERM") => boolean;
}

export interface ChildProtocolSnapshot {
	stderr: string;
	messages: ChildProtocolMessage[];
	output: string;
	assistantError: string | undefined;
	protocolError: ProtocolOutputLimit | undefined;
	usage: Usage;
	toolCount: number;
	model: string | undefined;
	turnBudget: TurnBudgetState | undefined;
	turnBudgetExceeded: boolean;
	contextNudgeObserved: boolean;
}

function aggregateOutputLimit(
	stream: "stdout" | "stderr",
	limitBytes: number,
	observedBytes: number,
	line: string,
): ProtocolOutputLimit {
	const diagnostic = Buffer.from(line, "utf-8");
	return {
		code: "protocol_output_limit",
		stream,
		scope: "aggregate",
		limitBytes,
		observedBytes,
		diagnosticPrefix: diagnostic.subarray(0, 4_096).toString("utf-8"),
		diagnosticTail: diagnostic.subarray(Math.max(0, diagnostic.length - 4_096)).toString("utf-8"),
	};
}

export class ChildProtocolRuntime {
	private readonly input: ChildProtocolRuntimeInput;
	private readonly usage = emptyUsage();
	private readonly messages: ChildProtocolMessage[] = [];
	private readonly stderrTail = createBoundedByteTail();
	private readonly rawOutputTail = createBoundedByteTail();
	private readonly stdoutProtocolLimit = maxChildProtocolBytes();
	private readonly stderrProtocolLimit = maxChildProtocolBytes();
	private readonly stdoutReader: ReturnType<typeof createBoundedLineReader>;
	private readonly stderrReader: ReturnType<typeof createBoundedLineReader>;
	private contextWindow: number | undefined;
	private contextTokens: number | undefined;
	private toolCount = 0;
	private observedModel: string | undefined;
	private assistantError: string | undefined;
	private protocolError: ProtocolOutputLimit | undefined;
	private invalidProtocolEvent = false;
	private stdoutProtocolBytes = 0;
	private stderrProtocolBytes = 0;
	private turnBudget: TurnBudgetState | undefined;
	private turnBudgetExceeded = false;
	private contextNudgeObserved = false;
	private streamingStatusPersistenceFailed = false;

	constructor(input: ChildProtocolRuntimeInput) {
		this.input = input;
		this.contextWindow = resolveTaskContextWindow(input.task, input.model);
		this.observedModel = input.model;
		this.turnBudget = input.task.turnBudget ? initialTurnBudgetState(input.task.turnBudget) : undefined;
		this.stdoutReader = createBoundedLineReader({
			onLine: (line) => this.processLine(line),
			onLimit: (limit) => {
				this.protocolError = limit;
				input.terminate("protocol", formatProtocolOutputLimit(limit), "SIGTERM");
			},
		});
		this.stderrReader = createBoundedLineReader({
			stream: "stderr",
			maxPendingLineBytes: MAX_CHILD_STDERR_BYTES,
			onLine: (line) => this.processStderrLine(line),
			onLimit: (limit) => this.rejectStderrLimit(limit),
		});
	}

	private persistStreamingStatus(): void {
		try {
			writeStatus(this.input.statusPath, this.input.status);
		} catch (error) {
			if (this.streamingStatusPersistenceFailed) return;
			this.streamingStatusPersistenceFailed = true;
			reportAgentDiagnostic(
				`Failed to persist live Agent progress for child ${String(this.input.index)}; execution will continue in memory:`,
				error,
			);
		}
	}

	private appendRawEvent(line: string, event?: ChildProtocolEvent): void {
		appendDiagnosticEvent(`${this.input.config.asyncDir}/events.jsonl`, {
			...(event ?? { type: "subagent.child.stdout", line }),
			subagentSource: "child",
			subagentRunId: this.input.config.id,
			subagentStepIndex: this.input.index,
			subagentAgent: this.input.task.agent,
			observedAt: Date.now(),
		});
		if (!this.input.artifactJsonlPath) return;
		try {
			appendArtifactJsonl(this.input.artifactJsonlPath, line);
		} catch {
			// Artifact JSONL is optional.
		}
	}

	private updateContextUsage(message: ChildProtocolMessage): void {
		if (!this.contextWindow) return;
		if (message.role === "assistant") {
			const providerTokens = providerContextTokens(message);
			if (message.stopReason !== "aborted" && message.stopReason !== "error" && providerTokens) {
				this.contextTokens = providerTokens;
			} else if (this.contextTokens !== undefined) {
				this.contextTokens += estimatedChildMessageTokens(message);
			}
		} else if (this.contextTokens !== undefined) {
			this.contextTokens += estimatedChildMessageTokens(message);
		}
		this.input.statusStep.contextUsage =
			this.contextTokens === undefined
				? undefined
				: { tokens: this.contextTokens, contextWindow: this.contextWindow };
	}

	private rejectProtocolEvent(line: string, reason: string): void {
		this.invalidProtocolEvent = true;
		this.recordRawLine(line);
		this.input.terminate("protocol", `protocol_invalid_event: ${reason}.`, "SIGTERM");
	}

	private recordRawLine(line: string): void {
		this.rawOutputTail.push(`${line}\n`);
		this.input.transcript.writeStdoutLine(line);
		this.appendRawEvent(line);
	}

	private consumeStdoutBytes(line: string): boolean {
		const observedBytes = this.stdoutProtocolBytes + Buffer.byteLength(line, "utf-8") + 1;
		if (observedBytes <= this.stdoutProtocolLimit) {
			this.stdoutProtocolBytes = observedBytes;
			return true;
		}
		this.protocolError = aggregateOutputLimit("stdout", this.stdoutProtocolLimit, observedBytes, line);
		this.input.terminate("protocol", formatProtocolOutputLimit(this.protocolError), "SIGTERM");
		return false;
	}

	private parseEvent(line: string): ChildProtocolEvent | undefined {
		let parsed: JsonValue;
		try {
			parsed = parseJsonValue(line);
		} catch {
			this.recordRawLine(line);
			appendRecentOutput(this.input.statusStep, line);
			this.persistStreamingStatus();
			return undefined;
		}
		const parsedEvent = parseChildProtocolEvent(parsed);
		if (!parsedEvent.event) {
			this.rejectProtocolEvent(line, parsedEvent.error ?? "event is malformed");
			return undefined;
		}
		return parsedEvent.event;
	}

	private processLineUnchecked(line: string): void {
		if (this.protocolError || this.invalidProtocolEvent || !line.trim() || !this.consumeStdoutBytes(line)) return;
		const event = this.parseEvent(line);
		if (event) this.processEvent(line, event);
	}

	private processLine(line: string): void {
		try {
			this.processLineUnchecked(line);
		} catch (error) {
			this.rejectProtocolEvent(
				line,
				`event processing failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private processEvent(line: string, event: ChildProtocolEvent): void {
		if (
			event.type === "message_end" &&
			event.message?.role === "custom" &&
			event.message.customType === "magic-context:ceiling-nudge"
		) {
			this.contextNudgeObserved = true;
		}
		this.appendRawEvent(line, event);
		this.input.transcript.writeChildEvent(event);
		if (this.handleContextEvent(event)) return;
		const terminalStop =
			event.type === "message_end" && event.message?.role === "assistant" && terminalAssistantStop(event.message);
		const lifecycle = projectChildLifecycle(event, terminalStop);
		if (lifecycle === "start-drain") this.input.startFinalDrain(terminalStop || event.type === "agent_settled");
		else if (lifecycle === "cancel-drain") this.input.cancelFinalDrain();
		if (this.handleToolEvent(event)) return;
		if ((event.type !== "message_end" && event.type !== "tool_result_end") || !event.message) return;
		this.recordMessage(event.message, event.type === "message_end" && event.message.role === "assistant");
	}

	private handleContextEvent(event: ChildProtocolEvent): boolean {
		if (event.modelContext) {
			this.contextWindow = event.modelContext.contextWindow;
			this.input.statusStep.contextUsage =
				this.contextTokens === undefined
					? undefined
					: { tokens: this.contextTokens, contextWindow: this.contextWindow };
			this.persistStreamingStatus();
			return true;
		}
		if (event.type !== "compaction_start") return false;
		this.contextTokens = undefined;
		this.input.statusStep.contextUsage = undefined;
		this.persistStreamingStatus();
		return true;
	}

	private handleToolEvent(event: ChildProtocolEvent): boolean {
		if (event.type === "tool_execution_start" && event.toolName) {
			this.toolCount += 1;
			this.input.statusStep.toolCount = this.toolCount;
			this.input.statusStep.currentTool = event.toolName;
			this.input.statusStep.currentToolArgs = extractToolArgsPreview(event.args ?? {});
			this.input.statusStep.currentToolStartedAt = Date.now();
			this.input.statusStep.lastActivityAt = Date.now();
			this.persistStreamingStatus();
			return true;
		}
		if (event.type !== "tool_execution_end") return false;
		this.input.statusStep.currentTool = undefined;
		this.input.statusStep.currentToolArgs = undefined;
		this.input.statusStep.currentToolStartedAt = undefined;
		this.input.statusStep.lastActivityAt = Date.now();
		this.persistStreamingStatus();
		return true;
	}

	private recordMessage(message: ChildProtocolMessage, assistantMessageEnd: boolean): void {
		this.messages.push(message);
		this.updateContextUsage(message);
		const text = extractTextFromContent(message.content);
		if (text) {
			appendRecentOutput(this.input.statusStep, text);
			this.input.statusStep.lastActivityAt = Date.now();
		}
		if (assistantMessageEnd && message.role === "assistant") {
			this.observedModel = message.model ?? this.observedModel;
			this.assistantError = message.errorMessage;
			addUsage(this.usage, message);
			this.input.statusStep.turnCount = this.usage.turns;
			this.input.statusStep.tokens = tokenUsage(this.usage);
			this.applyTurnBudget(message);
		}
		this.persistStreamingStatus();
	}

	private applyTurnBudget(message: Extract<ChildProtocolMessage, { role: "assistant" }>): void {
		const budget = this.input.task.turnBudget;
		if (!budget) return;
		const decision = turnBudgetDecision(
			budget,
			this.usage.turns,
			terminalAssistantStop(message),
			assistantStartsToolCall(message),
			true,
		);
		const error = `Agent exceeded its turn budget (${budget.maxTurns} + ${budget.graceTurns}).`;
		const aborted =
			decision === "abort" && !this.turnBudgetExceeded && this.input.terminate("turn-budget", error, "SIGINT");
		this.turnBudget = turnBudgetState(budget, this.usage.turns, aborted);
		this.input.statusStep.turnBudget = this.turnBudget;
		if (aborted) this.turnBudgetExceeded = true;
	}

	private appendStderr(line: string): void {
		this.input.transcript.writeStderrLine(line);
		appendDiagnosticEvent(`${this.input.config.asyncDir}/events.jsonl`, {
			type: "subagent.child.stderr",
			line,
			subagentRunId: this.input.config.id,
			subagentStepIndex: this.input.index,
			observedAt: Date.now(),
		});
	}

	private rejectStderrLimit(limit: ProtocolOutputLimit): void {
		if (this.protocolError || this.invalidProtocolEvent) return;
		this.protocolError = limit;
		const diagnostic = formatProtocolOutputLimit(limit);
		this.appendStderr(diagnostic);
		this.input.terminate("protocol", diagnostic, "SIGTERM");
	}

	private processStderrLine(line: string): void {
		if (this.protocolError || this.invalidProtocolEvent) return;
		const observedBytes = this.stderrProtocolBytes + Buffer.byteLength(line, "utf-8") + 1;
		if (observedBytes > this.stderrProtocolLimit) {
			this.rejectStderrLimit(aggregateOutputLimit("stderr", this.stderrProtocolLimit, observedBytes, line));
			return;
		}
		this.stderrProtocolBytes = observedBytes;
		this.appendStderr(line);
	}

	pushStdout(chunk: Buffer): void {
		this.stdoutReader.push(chunk);
	}

	pushStderr(chunk: Buffer): void {
		this.stderrTail.push(chunk);
		this.stderrReader.push(chunk);
	}

	end(): void {
		this.stdoutReader.end();
		this.stderrReader.end();
	}

	snapshot(): ChildProtocolSnapshot {
		return {
			stderr: this.stderrTail.text(),
			messages: this.messages,
			output: getFinalOutput(this.messages) || this.rawOutputTail.text().trim(),
			assistantError: this.assistantError,
			protocolError: this.protocolError,
			usage: this.usage,
			toolCount: this.toolCount,
			model: this.observedModel,
			turnBudget: this.turnBudget,
			turnBudgetExceeded: this.turnBudgetExceeded,
			contextNudgeObserved: this.contextNudgeObserved,
		};
	}
}
