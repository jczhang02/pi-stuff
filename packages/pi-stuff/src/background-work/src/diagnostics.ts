import { reportDiagnostic } from "../../conversation-ui/diagnostics.js";

interface WorkDiagnosticOptions {
	readonly action?: string;
	readonly key?: string;
	readonly notice?: boolean;
	readonly severity?: "error" | "info" | "warning";
}

export function reportWorkDiagnostic(summary: string, cause?: unknown, options: WorkDiagnosticOptions = {}): void {
	reportDiagnostic({
		...(options.action ? { action: options.action } : {}),
		capability: "Background Work",
		...(cause === undefined ? {} : { error: cause }),
		...(options.key ? { key: options.key } : {}),
		severity: options.severity ?? "error",
		summary,
		visibility: options.notice ? "notice" : "silent",
	});
}
