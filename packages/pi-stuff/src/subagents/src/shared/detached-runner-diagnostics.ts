const MAX_CHILD_LOG_LINE = 8 * 1024;

/** Child-only stderr log; the detached runner redirects this descriptor to its private run log. */
export function writeDetachedRunnerDiagnostic(line: string): void {
	if (process.env["PI_STUFF_BACKGROUND_RUNNER"] !== "1") return;
	try {
		process.stderr.write(`${line.slice(0, MAX_CHILD_LOG_LINE)}\n`);
	} catch {
		// A detached runner can lose its stderr sink during shutdown. Nothing else owns this child-only log.
	}
}
