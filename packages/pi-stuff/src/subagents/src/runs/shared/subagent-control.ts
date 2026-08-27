import type { ControlEvent } from "../../shared/types.ts";

function formatLongRunningFacts(event: ControlEvent): string | undefined {
	const facts: string[] = [];
	if (event.elapsedMs !== undefined) facts.push(`elapsed ${Math.floor(Math.max(0, event.elapsedMs) / 1000)}s`);
	if (event.turns !== undefined) facts.push(`${event.turns} turns`);
	if (event.tokens !== undefined) facts.push(`${event.tokens} tokens`);
	if (event.toolCount !== undefined) facts.push(`${event.toolCount} tools`);
	if (event.currentTool)
		facts.push(
			`tool ${event.currentTool}${event.currentToolDurationMs !== undefined ? ` ${Math.floor(Math.max(0, event.currentToolDurationMs) / 1000)}s` : ""}`,
		);
	if (event.currentPath) facts.push(`path ${event.currentPath}`);
	return facts.length > 0 ? facts.join(" | ") : undefined;
}

export function formatControlNoticeMessage(event: ControlEvent, childIntercomTarget?: string): string {
	const runTarget = event.runId;
	if (event.reason === "completion_guard") {
		return [
			`Subagent failed: ${event.agent}`,
			`Run: ${runTarget}${event.index !== undefined ? ` step ${event.index + 1}` : ""}`,
			`Signal: ${event.message}`,
			"Next: read the output artifact or session from the subagent result, then retry with a more explicit implementation prompt or handle the fix directly.",
			childIntercomTarget ? `Run intercom target (may be inactive): ${childIntercomTarget}` : undefined,
		]
			.filter((line): line is string => Boolean(line))
			.join("\n");
	}

	const nudgeMessage = "What are you blocked on? Reply with the smallest next step or ask for a decision.";
	const steerCommand = `subagent({ action: "steer", id: "${runTarget}", ${event.index !== undefined ? `index: ${event.index}, ` : ""}message: "${nudgeMessage}" })`;
	const stopCommand = `subagent({ action: "stop", id: "${runTarget}"${event.index !== undefined ? `, index: ${event.index}` : ""} })`;
	if (event.type === "active_long_running") {
		const facts = formatLongRunningFacts(event);
		return [
			`Subagent active but long-running: ${event.agent}`,
			`Run: ${runTarget}${event.index !== undefined ? ` step ${event.index + 1}` : ""}`,
			`Signal: ${event.message}`,
			facts ? `Facts: ${facts}` : undefined,
			"Hint: Inspect status first. Use steer for any live Agent, stop to interrupt it, or resume to revive a resumable terminal top-level child.",
			`Live nudge: ${steerCommand}`,
			childIntercomTarget ? `Direct intercom target: ${childIntercomTarget}` : undefined,
			`Status: subagent({ action: "status", id: "${runTarget}" })`,
			`Stop: ${stopCommand}`,
		]
			.filter((line): line is string => Boolean(line))
			.join("\n");
	}

	const supervisorHint =
		event.reason === "supervisor_request"
			? "Supervisor request: reply to the pending request. If subagent_supervisor pending is empty, check intercom pending because an external intercom tool may own the request."
			: undefined;
	return [
		`Subagent needs attention: ${event.agent}`,
		`Run: ${runTarget}${event.index !== undefined ? ` step ${event.index + 1}` : ""}`,
		`Signal: ${event.message}`,
		event.recentFailureSummary ? `Recent failures: ${event.recentFailureSummary}` : undefined,
		supervisorHint,
		"Hint: Inspect status first unless the run is clearly blocked. Use steer for any live Agent, stop to interrupt it, or resume to revive a resumable terminal top-level child.",
		`Live nudge: ${steerCommand}`,
		childIntercomTarget ? `Direct intercom target: ${childIntercomTarget}` : undefined,
		`Status: subagent({ action: "status", id: "${runTarget}" })`,
		`Stop: ${stopCommand}`,
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}
