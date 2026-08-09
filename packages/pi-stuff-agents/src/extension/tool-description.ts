export function buildSubagentToolDescription(): string {
	return [
		"Delegate one or several concrete tasks to isolated current-session Agents.",
		'Choose exactly one call shape: single uses agent + task; parallel uses tasks; control uses action="status", "steer", "stop", or "resume".',
		"Do not combine single, parallel, or control fields.",
		"A short 3–5 word description improves the UI; put the complete execution instruction in task.",
		"Use the built-in general-purpose Agent unless a user or project Agent is a better fit.",
		"Omit turnBudget and toolBudget for ordinary tasks; use them only when the user or project explicitly requires a hard execution bound.",
		"Do not invent or pass a background field. Omit foreground for the default background launch; set foreground=true only when the findings must inform the current answer.",
		"Background completion never starts another main turn and remains inspectable through /agents. Foreground returns only direct-child summaries; inspect full and nested transcripts through /agents.",
	].join(" ");
}

export function buildFanoutChildSubagentToolDescription(): string {
	return [
		"Delegate one or several concrete tasks to isolated nested Agents.",
		"Choose exactly one launch shape: single uses agent + task; parallel uses tasks.",
		"Do not combine single and parallel fields.",
		"A short 3–5 word description improves the UI; put the complete execution instruction in task.",
		"Use the built-in general-purpose Agent unless a user or project Agent is a better fit.",
		"Omit turnBudget and toolBudget for ordinary tasks; use them only when the user or project explicitly requires a hard execution bound.",
		"Nested launches are always owner-blocking and collected before this Agent can finish; detached background launch is unavailable here.",
		"Results contain direct-child summaries; inspect full and nested transcripts through /agents.",
	].join(" ");
}
