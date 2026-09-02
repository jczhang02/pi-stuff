import type { AgentWorkUnitSnapshot } from "../../runtime/session-governor.ts";
import type { AgentTerminalClass, AgentTerminalOutcome } from "./run-result.ts";

interface TerminalResultInput {
	runId: string;
	index: number;
	success: boolean;
	error?: string;
	sessionFile?: string | undefined;
	interrupted?: boolean;
	timedOut?: boolean;
	stopped?: boolean;
	protocolError?: unknown;
	turnBudgetExceeded?: boolean;
	workUnit?: AgentWorkUnitSnapshot;
}

export function classifyAgentFailure(error: string): AgentTerminalClass {
	if (/no space left|\bENOSPC\b|disk quota|read-only file system|storage/i.test(error)) return "storage";
	if (/payload input bound|context(?:[_\s-]*(?:length|window|overflow))|too many tokens/i.test(error)) {
		return "context";
	}
	if (/protocol[_\s-]|message(?:\.|_).*invalid|malformed event/i.test(error)) return "protocol";
	if (/timed?\s*out|deadline/i.test(error)) return "timeout";
	if (/automatic Agent expansion needs attention/i.test(error)) return "cost_guard";
	if (/turn budget|tool budget|budget/i.test(error)) return "explicit_budget";
	if (/\b(?:401|403|429|5\d\d)\b|auth(?:entication|orization)?|quota|rate limit|provider/i.test(error)) {
		return "provider";
	}
	if (/signal|exit(?:ed| code)|process|crash|disappear/i.test(error)) return "process";
	return "unknown";
}

export function terminalOutcome(input: TerminalResultInput): AgentTerminalOutcome {
	const target = { id: input.runId, index: input.index };
	if (input.success) {
		return {
			state: "completed",
			class: "completed",
			reason: "Agent returned a final answer.",
			continuation: { target, resumeSupported: false },
		};
	}
	const resumeSupported = Boolean(input.sessionFile) && input.stopped !== true;
	const terminalClass = terminalClassFromInput(input);
	const continuation: AgentTerminalOutcome["continuation"] = {
		target,
		resumeSupported,
	};
	if (resumeSupported && input.workUnit?.expansionAllowed === false) continuation.acknowledgementRequired = true;
	return {
		state: resumeSupported ? "incomplete" : "failed",
		class: terminalClass,
		reason: input.error?.trim() || defaultReason(terminalClass),
		continuation,
	};
}

function terminalClassFromInput(input: TerminalResultInput): AgentTerminalClass {
	if (input.timedOut) return "timeout";
	if (input.stopped) return "stopped";
	if (input.interrupted) return "interrupted";
	if (input.protocolError) return "protocol";
	if (input.turnBudgetExceeded) return "explicit_budget";
	return classifyAgentFailure(input.error ?? "");
}

function defaultReason(terminalClass: AgentTerminalClass): string {
	return terminalClass === "unknown"
		? "Agent ended without a final answer."
		: `Agent ended because of ${terminalClass}.`;
}
