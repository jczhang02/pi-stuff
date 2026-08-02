import type { BashCommand } from "#src/access-intent/bash/command-enumeration";
import { pickMostRestrictive } from "#src/handlers/gates/candidate-check";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { PermissionCheckResult } from "#src/types";

/**
 * Resolve the bash command-pattern decision for a (possibly chained) command.
 *
 * A bash invocation may be a shell program with several commands joined by
 * `&&`, `||`, `;`, `|`, `&`, or newlines. Matching the whole string against the
 * bash patterns lets a denied command ride through on an allowed leading one
 * (issue #301). Instead, the caller supplies the program's command units (from
 * the shared `BashProgram.commands()` parse) — including those nested inside
 * substitutions and subshells (#306); each is evaluated on the `bash` surface
 * and the most restrictive result wins (`deny > ask > allow`).
 *
 * The selected result carries the offending sub-command in `command`, its rule
 * in `matchedPattern`, and the offending command's execution context in
 * `commandContext` (set only for a nested command), so the prompt,
 * session-approval suggestion, and decision event scope to that command.
 *
 * Wrapper opacity is handled by the non-relaxable destructive-command
 * tripwire. This policy layer honors the selected mode as-is: unrestricted
 * mode does not prompt for ordinary `env`, `timeout`, `bash -lc`, or similar
 * workflow commands; manual mode and explicit rules can still ask or deny.
 *
 * When `commands` is empty there are two cases. A trivially-empty command (an
 * empty, whitespace-only, or comment-only line) has genuinely nothing to gate,
 * so the whole `command` is resolved as before. A non-empty command that parsed
 * to zero command units (a parse anomaly or an opaque program) is resolved as
 * a whole. A potentially destructive parse failure is already denied by the
 * tripwire before this policy layer runs.
 *
 * Pure and synchronous: the (async, tree-sitter) parse happens once in the
 * handler, which passes the decomposed `commands` here.
 */
export function resolveBashCommandCheck(
	command: string,
	commands: BashCommand[],
	agentName: string | undefined,
	resolver: ScopedPermissionResolver,
): PermissionCheckResult {
	if (commands.length === 0) {
		return resolver.resolve({
			kind: "tool",
			surface: "bash",
			input: { command },
			agentName,
		});
	}

	const results = commands.map((cmd) => {
		const result = resolver.resolve({
			kind: "tool",
			surface: "bash",
			input: { command: cmd.text },
			agentName,
		});
		return cmd.context ? { ...result, commandContext: cmd.context } : result;
	});
	return (
		pickMostRestrictive(results) ??
		resolver.resolve({
			kind: "tool",
			surface: "bash",
			input: { command },
			agentName,
		})
	);
}
