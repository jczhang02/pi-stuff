export type McpDialogRowRole =
	| "confirmation"
	| "failure"
	| "notice"
	| "preview-detail"
	| "preview-heading"
	| "question"
	| "selected";

export interface McpDialogRows {
	readonly lines: string[];
	readonly roles: Partial<Record<McpDialogRowRole, string>>;
}

export function mcpDialogPriority(body: McpDialogRows, roles: readonly McpDialogRowRole[]): string[] {
	return [...new Set(roles.map((role) => body.roles[role]).filter((line): line is string => !!line))];
}
