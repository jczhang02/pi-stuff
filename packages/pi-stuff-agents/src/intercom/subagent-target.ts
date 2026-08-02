function safeTargetPart(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "agent"
	);
}

/** Stable address used only by the live nested-control delivery path. */
export function resolveSubagentIntercomTarget(runId: string, agent: string, index?: number): string {
	const stepSuffix = index !== undefined ? `-${index + 1}` : "";
	return `subagent-${safeTargetPart(agent)}-${safeTargetPart(runId)}${stepSuffix}`;
}
