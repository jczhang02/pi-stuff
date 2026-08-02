import type { CircuitBreakerDecision } from "#src/destructive-command";
import type { PermissionCheckResult } from "#src/types";
import type { GateDescriptor } from "./descriptor";
import type { ToolCallContext } from "./types";

/** Build the non-relaxable pre-policy gate for an ask/deny tripwire result. */
export function describeDestructiveCommandGate(
	tcc: ToolCallContext,
	decision: Exclude<CircuitBreakerDecision, { action: "allow" }>,
): GateDescriptor {
	const check: PermissionCheckResult = {
		toolName: "bash",
		state: decision.action,
		command: decision.command,
		reason: decision.reason,
		matchedPattern: "pi-stuff destructive-command tripwire",
		source: "bash",
		origin: "builtin",
	};
	const subject = tcc.agentName ? `Agent '${tcc.agentName}'` : "Current agent";
	const targetLines =
		decision.targets.length > 0
			? [`Target${decision.targets.length === 1 ? "" : "s"}: ${decision.targets.join(", ")}`]
			: [];
	const message = [
		`${subject} requested '${decision.operation}'.`,
		"",
		decision.command,
		"",
		`Working directory: ${decision.cwd}`,
		...targetLines,
		`Tripwire: ${decision.reason}`,
	].join("\n");

	return {
		surface: "bash",
		input: tcc.input,
		preCheck: check,
		denialContext: {
			kind: "tool",
			check,
			...(tcc.agentName ? { agentName: tcc.agentName } : {}),
			input: tcc.input,
		},
		promptDetails: {
			source: "tool_call",
			agentName: tcc.agentName,
			message,
			toolCallId: tcc.toolCallId,
			toolName: tcc.toolName,
			command: decision.command,
			exactCallOnly: true,
			tripwire: {
				command: decision.command,
				cwd: decision.cwd,
				operation: decision.operation,
				reason: decision.reason,
				targets: [...decision.targets],
			},
			accessIntent: {
				surface: "bash",
				matchValues: [decision.command],
				boundaryValue: null,
			},
		},
		logContext: {
			source: "tool_call",
			toolCallId: tcc.toolCallId,
			toolName: tcc.toolName,
			circuitBreaker: true,
			operation: decision.operation,
		},
		decision: {
			surface: "bash",
			value: decision.command,
		},
	};
}
