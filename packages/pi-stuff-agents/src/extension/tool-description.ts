export function buildSubagentToolDescription(): string {
	return [
		"Delegate one or several concrete tasks to isolated current-session Agents.",
		'Choose exactly one call shape: single uses agent + task; parallel uses tasks; control uses action="status", "steer", "stop", or "resume".',
		"Do not combine single, parallel, or control fields.",
		"For every launch, provide a 3–5 word description for the UI and put the complete execution instruction in task.",
		"Use the built-in general-purpose Agent unless a user or project Agent is a better fit.",
		"Never send background; omit foreground for the default background launch, or set foreground=true only when the result is required before continuing.",
		"Only direct-child summaries return here; inspect full and nested transcripts through /agents.",
	].join(" ");
}
