import { reportDiagnostic } from "../../conversation-ui/diagnostics.js";

interface WebDiagnosticOptions {
	readonly action?: string;
	readonly key?: string;
	readonly notice?: boolean;
	readonly severity?: "error" | "info" | "warning";
}

export function reportWebDiagnostic(summary: string, error?: unknown, options: WebDiagnosticOptions = {}): void {
	reportDiagnostic({
		...(options.action ? { action: options.action } : {}),
		capability: "Web",
		...(error === undefined ? {} : { error }),
		...(options.key ? { key: options.key } : {}),
		severity: options.severity ?? "error",
		summary,
		visibility: options.notice ? "notice" : "silent",
	});
}
