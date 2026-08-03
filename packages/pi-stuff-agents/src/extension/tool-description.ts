export function buildSubagentToolDescription(): string {
	return [
		"Delegate one or several concrete tasks to isolated current-session Agents.",
		"For every launch, provide a 3–5 word description for the UI and put the complete execution instruction in task.",
		"Use the built-in general-purpose Agent unless a user or project Agent is a better fit.",
		"Agents run in the background by default; set foreground=true only when their result is required before continuing.",
		"Use tasks for independent parallel work. Use action=status, steer, stop, or resume to control an existing Agent.",
		"Only direct-child summaries return here; inspect full and nested transcripts through /agents.",
	].join(" ");
}
