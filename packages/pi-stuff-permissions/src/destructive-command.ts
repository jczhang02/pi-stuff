import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { BashArgument, BashInvocation } from "#src/access-intent/bash/invocation-enumeration";
import type { BashProgram } from "#src/access-intent/bash/program";
import type { PathNormalizer } from "#src/path-normalizer";

export interface CircuitBreakerEvidence {
	readonly command: string;
	readonly cwd: string;
	readonly operation: string;
	readonly reason: string;
	readonly targets: readonly string[];
}

export type CircuitBreakerDecision =
	| { readonly action: "allow" }
	| ({ readonly action: "ask" } & CircuitBreakerEvidence)
	| ({ readonly action: "deny" } & CircuitBreakerEvidence);

export interface CircuitBreakerContext {
	readonly cwd: string;
	readonly homeDirectory?: string;
	readonly gitWorktreeRoot?: string;
}

/**
 * Classify the deliberately small destructive-command family Pi Stuff guards.
 *
 * This is an accident circuit breaker, not a sandbox. Unknown ordinary shell
 * commands pass through; recognized destructive shapes either run silently,
 * ask about this exact call once, or fail closed with a concrete rewrite hint.
 */
export function classifyDestructiveCommand(
	program: BashProgram,
	normalizer: PathNormalizer,
	context: CircuitBreakerContext,
): CircuitBreakerDecision {
	const command = program.commandText();
	if (program.hasSyntaxError() && looksPotentiallyDestructive(command)) {
		return deny(
			command,
			context.cwd,
			"unparsed destructive command",
			[],
			"The destructive shell command could not be parsed safely. Rewrite it as a direct command with concrete targets.",
		);
	}

	const protectedPaths = resolveProtectedPaths(normalizer, context);
	const asks: CircuitBreakerEvidence[] = [];
	const invocations = program.invocations();
	const destructiveCandidate = invocations.some((invocation) => invocationMayBeDestructive(invocation, command));
	const directoryMutation = destructiveCandidate ? invocations.find(invocationMutatesDirectoryContext) : undefined;
	if (directoryMutation) {
		return deny(
			command,
			context.cwd,
			"destructive command after shell directory mutation",
			[],
			`The command combines deletion with '${directoryMutation.text}', so its effective directory is not certified. Rewrite it as a direct destructive command with concrete paths and no cd/pushd/source step.`,
		);
	}

	for (const invocation of invocations) {
		const decision = classifyInvocation(invocation, command, normalizer, context, protectedPaths);
		if (decision.action === "deny") return decision;
		if (decision.action === "ask") asks.push(decision);
	}

	return asks.length === 0 ? { action: "allow" } : mergeAskEvidence(asks);
}

/** Find the nearest Git worktree root without spawning Git or writing files. */
export function findGitWorktreeRoot(start: string, normalizer: PathNormalizer): string | undefined {
	const path = normalizer.flavor.impl;
	let current = path.resolve(start);
	while (true) {
		if (existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function classifyInvocation(
	invocation: BashInvocation,
	fullCommand: string,
	normalizer: PathNormalizer,
	context: CircuitBreakerContext,
	protectedPaths: ReadonlyMap<string, string>,
): CircuitBreakerDecision {
	const commandName = basename(invocation.commandName);
	if (!invocation.commandNameIsStatic) {
		if (!dynamicInvocationMayBeDestructive(invocation, fullCommand)) {
			return { action: "allow" };
		}
		return deny(
			fullCommand,
			context.cwd,
			"dynamic shell executable",
			invocation.commandName ? [invocation.commandName] : [],
			"The executable name is produced by a variable or shell substitution, so the destructive tripwire cannot classify it. Rewrite it with a direct command name.",
		);
	}
	if (!commandName) return { action: "allow" };

	if (WRAPPER_COMMANDS.has(commandName) && wrapperCarriesDestructivePayload(invocation)) {
		return deny(
			fullCommand,
			context.cwd,
			`destructive command through ${commandName}`,
			[],
			`Destructive operations through '${commandName}' are outside the certified tripwire shapes. Rewrite it as a direct command with concrete targets.`,
		);
	}

	if (DELETE_COMMANDS.has(commandName)) {
		if (
			commandName === "rmdir" &&
			invocation.args.some((argument) => argument.value === "-p" || argument.value === "--parents")
		) {
			return deny(
				fullCommand,
				context.cwd,
				"rmdir parents",
				deletionTargets(invocation.args).map((target) => target.value),
				"rmdir -p/--parents can continue through unlisted ancestor directories. Rewrite it with each directory named explicitly.",
			);
		}
		return classifyDeletion(
			commandName,
			deletionTargets(invocation.args),
			invocation,
			fullCommand,
			normalizer,
			context,
			protectedPaths,
		);
	}

	if (commandName === "find") {
		const hasExecutionWrapper = invocation.args.some((argument) => FIND_EXEC_FLAGS.has(argument.value));
		if (hasExecutionWrapper && wrapperCarriesDestructivePayload(invocation)) {
			return deny(
				fullCommand,
				context.cwd,
				"destructive command through find execution",
				[],
				"Destructive operations through find -exec/-ok are outside the certified tripwire shapes. Split it into direct commands with concrete targets.",
			);
		}
		if (!invocation.args.some((argument) => argument.value === "-delete")) {
			return { action: "allow" };
		}
		return classifyDeletion(
			"find -delete",
			findRoots(invocation.args),
			invocation,
			fullCommand,
			normalizer,
			context,
			protectedPaths,
		);
	}

	if (commandName === "git") {
		return classifyGitDiscard(invocation, fullCommand, context);
	}

	return { action: "allow" };
}

function classifyDeletion(
	operation: string,
	targets: readonly BashArgument[],
	invocation: BashInvocation,
	fullCommand: string,
	normalizer: PathNormalizer,
	context: CircuitBreakerContext,
	protectedPaths: ReadonlyMap<string, string>,
): CircuitBreakerDecision {
	if (targets.length === 0) return { action: "allow" };

	const askTargets: string[] = [];
	for (const target of targets) {
		const unsafe = validateConcreteTarget(target);
		if (unsafe) {
			return deny(fullCommand, context.cwd, operation, [target.value], unsafe);
		}

		if (invocation.effectiveDirectory === undefined && isRelative(target.value, normalizer)) {
			return deny(
				fullCommand,
				context.cwd,
				operation,
				[target.value],
				"The deletion target's effective directory cannot be resolved safely. Rewrite it with a concrete path and working directory.",
			);
		}

		const accessPath = normalizer.forBashToken(target.value, {
			resolveBase: invocation.effectiveDirectory,
		});
		const lexical = accessPath.value();
		const boundary = accessPath.boundaryValue();
		if (!lexical || !boundary) {
			return deny(
				fullCommand,
				context.cwd,
				operation,
				[target.value],
				"The deletion target could not be resolved safely. Rewrite it as a concrete path.",
			);
		}

		const protectedLabel = protectedPaths.get(boundary);
		const protectedAncestor = protectedLabel
			? { label: protectedLabel, path: boundary }
			: findProtectedPathInsideTarget(boundary, protectedPaths, normalizer);
		if (protectedAncestor) {
			return deny(
				fullCommand,
				context.cwd,
				operation,
				[lexical],
				`Refusing to delete the protected ${protectedAncestor.label} '${protectedAncestor.path}' directly or through an ancestor target. Narrow the command to specific files below it.`,
			);
		}

		if (isFilesystemRoot(boundary, normalizer)) {
			return deny(
				fullCommand,
				context.cwd,
				operation,
				[lexical],
				`Refusing to delete filesystem root '${lexical}'. Narrow the command to a directory below the root.`,
			);
		}

		if (isGitWorktreeDirectory(boundary, normalizer)) {
			return deny(
				fullCommand,
				context.cwd,
				operation,
				[lexical],
				`Refusing to delete Git worktree root '${lexical}'. Narrow the command to specific files inside it.`,
			);
		}

		if (normalizer.isBoundaryOutsideWorkingDirectory(boundary)) {
			askTargets.push(lexical);
		}
	}

	if (askTargets.length === 0) return { action: "allow" };
	return ask(
		fullCommand,
		context.cwd,
		operation,
		askTargets,
		"This command deletes a statically resolved target outside the current working directory. Approval applies to this exact call only.",
	);
}

function classifyGitDiscard(
	invocation: BashInvocation,
	fullCommand: string,
	context: CircuitBreakerContext,
): CircuitBreakerDecision {
	const inlineAlias = invocation.args.find(
		(argument) => argument.value.startsWith("alias.") && looksLikeGitDiscardPayload(argument.value),
	);
	if (inlineAlias) {
		return deny(
			fullCommand,
			context.cwd,
			"Git inline alias",
			[inlineAlias.value],
			"A Git inline alias hides a worktree-discard operation. Rewrite it as the direct Git command with concrete arguments.",
		);
	}
	const parsed = parseGitInvocation(invocation.args);
	if (!parsed) return { action: "allow" };
	if (parsed.unsafeReason) {
		return deny(fullCommand, context.cwd, `git ${parsed.subcommand}`, parsed.targets, parsed.unsafeReason);
	}

	if (!isGitDiscardInvocation(parsed)) return { action: "allow" };

	const unsafeArgument = parsed.args.find((argument) => !argument.isStatic || argument.hasGlob);
	if (unsafeArgument) {
		return deny(
			fullCommand,
			context.cwd,
			`git ${parsed.subcommand}`,
			[unsafeArgument.value],
			"The Git discard request contains a variable, shell substitution, brace expansion, or glob. Rewrite it with concrete arguments.",
		);
	}

	return ask(
		fullCommand,
		context.cwd,
		`git ${parsed.subcommand}`,
		parsed.targets,
		"This Git operation can discard uncommitted work. Approval applies to this exact call only.",
	);
}

interface ParsedGitInvocation {
	readonly subcommand: string;
	readonly args: readonly BashArgument[];
	readonly targets: readonly string[];
	readonly unsafeReason?: string;
}

function parseGitInvocation(args: readonly BashArgument[]): ParsedGitInvocation | undefined {
	let index = 0;
	let unsafeReason: string | undefined;
	const unsafeTargets: string[] = [];
	while (index < args.length) {
		const argument = args[index];
		if (!argument) return undefined;
		if (!argument.isStatic || argument.hasGlob) {
			return {
				subcommand: argument.value || "unknown",
				args: args.slice(index + 1),
				targets: [argument.value],
				unsafeReason:
					"The Git subcommand or global option is produced dynamically. Rewrite it without variables, substitutions, brace expansion, or globs.",
			};
		}
		if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(argument.value)) {
			const value = args[index + 1];
			if (!value?.isStatic || value.hasGlob) {
				unsafeReason =
					"The Git working location or global option value is not concrete. Rewrite it without variables, substitutions, or globs.";
				if (value) unsafeTargets.push(value.value);
			}
			index += 2;
			continue;
		}
		if (argument.value.startsWith("-")) {
			index += 1;
			continue;
		}
		const subcommand = argument.value;
		const commandArgs = args.slice(index + 1);
		return {
			subcommand,
			args: commandArgs,
			targets: [...unsafeTargets, ...gitTargets(subcommand, commandArgs)],
			...(unsafeReason ? { unsafeReason } : {}),
		};
	}
	return undefined;
}

function deletionTargets(args: readonly BashArgument[]): BashArgument[] {
	const targets: BashArgument[] = [];
	let options = true;
	for (const argument of args) {
		if (options && argument.value === "--") {
			options = false;
			continue;
		}
		if (options && argument.value.startsWith("-")) continue;
		targets.push(argument);
	}
	return targets;
}

function findRoots(args: readonly BashArgument[]): BashArgument[] {
	const roots: BashArgument[] = [];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (!argument) break;
		if (argument.value === "--" && roots.length === 0) continue;
		if (roots.length === 0 && FIND_PREFIX_OPTIONS.has(argument.value)) continue;
		if (roots.length === 0 && argument.value === "-D") {
			index += 1;
			continue;
		}
		if (
			argument.value === "!" ||
			argument.value === "(" ||
			argument.value === ")" ||
			argument.value === "," ||
			argument.value.startsWith("-")
		) {
			break;
		}
		roots.push(argument);
	}
	return roots.length > 0 ? roots : [{ value: ".", isStatic: true, hasGlob: false }];
}

function gitTargets(subcommand: string, args: readonly BashArgument[]): string[] {
	if (subcommand === "checkout") {
		const separator = args.findIndex((argument) => argument.value === "--");
		return separator === -1 ? [] : args.slice(separator + 1).map((argument) => argument.value);
	}
	if (subcommand === "restore" || subcommand === "clean" || subcommand === "switch" || subcommand === "stash") {
		return args.filter((argument) => !argument.value.startsWith("-")).map((argument) => argument.value);
	}
	if (subcommand === "reset") {
		return args.filter((argument) => !argument.value.startsWith("-")).map((argument) => argument.value);
	}
	return [];
}

function isDiscardCheckout(args: readonly BashArgument[]): boolean {
	if (
		args.some(
			(argument) =>
				argument.value === "." ||
				argument.value === ".." ||
				argument.value === "--ours" ||
				argument.value === "--theirs",
		)
	) {
		return true;
	}
	const createsBranch = args.some(
		(argument) => argument.value === "-b" || argument.value === "-B" || argument.value === "--orphan",
	);
	const positional = args.filter((argument) => !argument.value.startsWith("-"));
	return (
		args.some((argument) => argument.value === "-f" || argument.value === "--force") ||
		args.some((argument) => argument.value === "--") ||
		(!createsBranch && positional.length >= 2)
	);
}

function isGitSwitchDiscard(value: string): boolean {
	return value === "-f" || value === "--force" || value === "--discard-changes";
}

function isDestructiveStash(args: readonly BashArgument[]): boolean {
	return args.some((argument) => argument.value === "clear" || argument.value === "drop");
}

function isGitDiscardInvocation(parsed: ParsedGitInvocation): boolean {
	switch (parsed.subcommand) {
		case "reset":
			return parsed.args.some((argument) => argument.value === "--hard");
		case "clean":
			return !parsed.args.some((argument) => isGitCleanDryRun(argument.value));
		case "restore":
			return true;
		case "checkout":
			return isDiscardCheckout(parsed.args);
		case "switch":
			return parsed.args.some((argument) => isGitSwitchDiscard(argument.value));
		case "stash":
			return isDestructiveStash(parsed.args);
		default:
			return false;
	}
}

function looksLikeGitDiscardPayload(value: string): boolean {
	return /(?:^|[=\s!])(?:reset\s+--hard|clean(?:\s|$)|restore(?:\s|$)|checkout(?:\s|$)|switch\s+(?:-f|--force|--discard-changes)|stash\s+(?:drop|clear))(?:\s|$)/.test(
		value,
	);
}

function isGitCleanDryRun(value: string): boolean {
	if (value === "--dry-run" || value === "-n") return true;
	return /^-[^-]*n/.test(value);
}

function validateConcreteTarget(target: BashArgument): string | undefined {
	if (!target.isStatic) {
		return "The deletion target contains a variable, shell/process substitution, or brace expansion. Rewrite it with a concrete path.";
	}
	if (target.hasGlob) {
		return "The deletion target contains a glob. Rewrite it with explicitly named paths so the affected set is reviewable.";
	}
	if (target.value.trim().length === 0) {
		return "The deletion target is empty. Rewrite it with a concrete path.";
	}
	return undefined;
}

function resolveProtectedPaths(
	normalizer: PathNormalizer,
	context: CircuitBreakerContext,
): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	const path = normalizer.flavor.impl;
	const values: Array<readonly [string, string]> = [
		[path.parse(path.resolve(context.cwd)).root, "filesystem root"],
		[context.homeDirectory ?? homedir(), "user home"],
		[context.cwd, "working directory"],
	];
	const gitRoot = context.gitWorktreeRoot ?? findGitWorktreeRoot(context.cwd, normalizer);
	if (gitRoot) {
		values.push([gitRoot, "Git worktree root"]);
		values.push([path.join(gitRoot, ".git"), "Git metadata directory"]);
	}

	for (const [value, label] of values) {
		const boundary = normalizer.forPath(value).boundaryValue();
		if (boundary) result.set(boundary, label);
	}
	return result;
}

function findProtectedPathInsideTarget(
	target: string,
	protectedPaths: ReadonlyMap<string, string>,
	normalizer: PathNormalizer,
): { label: string; path: string } | undefined {
	for (const [protectedPath, label] of protectedPaths) {
		if (normalizer.isWithinDirectory(protectedPath, target)) {
			return { label, path: protectedPath };
		}
	}
	return undefined;
}

function isFilesystemRoot(target: string, normalizer: PathNormalizer): boolean {
	const path = normalizer.flavor.impl;
	const normalized = normalizer.flavor.fold(path.normalize(target));
	const root = normalizer.flavor.fold(path.normalize(path.parse(target).root));
	return normalized.length > 0 && normalized === root;
}

function isGitWorktreeDirectory(target: string, normalizer: PathNormalizer): boolean {
	return existsSync(normalizer.flavor.impl.join(target, ".git"));
}

function wrapperCarriesDestructivePayload(invocation: BashInvocation): boolean {
	const payload = wrapperPayload(invocation);
	return looksPotentiallyDestructive(payload);
}

function wrapperPayload(invocation: BashInvocation): string {
	const commandName = basename(invocation.commandName);
	if (commandName && SHELL_INTERPRETERS.has(commandName)) {
		const commandOption = invocation.args.findIndex(
			(argument) => argument.value === "-c" || /^-[^-]*c/.test(argument.value),
		);
		const script = commandOption >= 0 ? invocation.args[commandOption + 1] : undefined;
		if (script) return script.value;
	}
	return invocation.args.map((argument) => argument.value).join(" ");
}

function invocationMayBeDestructive(invocation: BashInvocation, fullCommand: string): boolean {
	if (!invocation.commandNameIsStatic) return dynamicInvocationMayBeDestructive(invocation, fullCommand);
	const commandName = basename(invocation.commandName);
	if (!commandName) return false;
	if (DELETE_COMMANDS.has(commandName)) return true;
	if (commandName === "find") {
		return invocation.args.some((argument) => argument.value === "-delete" || FIND_EXEC_FLAGS.has(argument.value));
	}
	if (commandName === "git") {
		return invocation.args.some((argument) => GIT_DISCARD_WORDS.has(argument.value));
	}
	return WRAPPER_COMMANDS.has(commandName) && wrapperCarriesDestructivePayload(invocation);
}

function dynamicInvocationMayBeDestructive(invocation: BashInvocation, fullCommand: string): boolean {
	const dynamicName = invocation.commandName ?? "";
	if (/(?:^|[^A-Za-z0-9_-])(?:rm|rmdir|unlink)(?:$|[^A-Za-z0-9_-])/.test(dynamicName)) {
		return true;
	}

	const variableName = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/.exec(dynamicName);
	const name = variableName?.[1] ?? variableName?.[2];
	if (!name) return false;
	const assignment = new RegExp(
		`(?:^|[;&|\\n]\\s*)${escapeRegExp(name)}\\s*=\\s*(['"]?)(?:[^\\s;'"&|]*/)?(?:rm|rmdir|unlink)\\1(?=\\s*(?:[;&|\\n]|$))`,
	);
	return assignment.test(fullCommand);
}

function invocationMutatesDirectoryContext(invocation: BashInvocation): boolean {
	if (!invocation.commandNameIsStatic) return false;
	const commandName = basename(invocation.commandName);
	if (!commandName) return false;
	if (DIRECTORY_CONTEXT_COMMANDS.has(commandName)) return true;
	if (commandName === "builtin" || commandName === "command") {
		return invocation.args.some((argument) => DIRECTORY_CONTEXT_COMMANDS.has(argument.value));
	}
	return false;
}

function looksPotentiallyDestructive(command: string): boolean {
	return (
		/(^|[;&|()\n]\s*)(?:[^\s/]+\/)*(?:rm|rmdir|unlink)(?=$|\s)/.test(command) ||
		/(^|[;&|()\n]\s*)(?:[^\s/]+\/)*find(?=$|\s)[^;&|()\n]*\s-delete(?=$|\s)/.test(command) ||
		looksLikeGitDiscardCommand(command)
	);
}

function looksLikeGitDiscardCommand(value: string): boolean {
	for (const match of value.matchAll(/(?:^|[;&|()\n]\s*)(?:[^\s/]+\/)*git\s+([^;&|()\n]*)/g)) {
		const words = splitStaticShellWords(match[1] ?? "");
		if (!words) continue;
		const parsed = parseGitInvocation(words.map((word) => ({ value: word, isStatic: true, hasGlob: false })));
		if (parsed && isGitDiscardInvocation(parsed)) return true;
	}
	return false;
}

function splitStaticShellWords(value: string): string[] | null {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	const push = (): void => {
		if (current.length === 0) return;
		words.push(current);
		current = "";
	};
	for (const character of value) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			push();
			continue;
		}
		current += character;
	}
	if (escaped || quote) return null;
	push();
	return words;
}

function isRelative(value: string, normalizer: PathNormalizer): boolean {
	return !normalizer.isAbsolute(value) && !value.startsWith("~");
}

function mergeAskEvidence(evidence: readonly CircuitBreakerEvidence[]): CircuitBreakerDecision {
	const first = evidence[0];
	if (!first) return { action: "allow" };
	return {
		action: "ask",
		command: first.command,
		cwd: first.cwd,
		operation: [...new Set(evidence.map((item) => item.operation))].join(" + "),
		reason: [...new Set(evidence.map((item) => item.reason))].join(" "),
		targets: [...new Set(evidence.flatMap((item) => item.targets))],
	};
}

function ask(
	command: string,
	cwd: string,
	operation: string,
	targets: readonly string[],
	reason: string,
): CircuitBreakerDecision {
	return { action: "ask", command, cwd, operation, targets, reason };
}

function deny(
	command: string,
	cwd: string,
	operation: string,
	targets: readonly string[],
	reason: string,
): CircuitBreakerDecision {
	return { action: "deny", command, cwd, operation, targets, reason };
}

function basename(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = value.replaceAll("\\", "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DELETE_COMMANDS = new Set(["rm", "rmdir", "unlink"]);
const FIND_EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const FIND_PREFIX_OPTIONS = new Set(["-H", "-L", "-P"]);
const WRAPPER_COMMANDS = new Set([
	"bash",
	"busybox",
	"builtin",
	"command",
	"dash",
	"doas",
	"env",
	"eval",
	"exec",
	"fd",
	"flock",
	"ionice",
	"ksh",
	"nice",
	"nohup",
	"parallel",
	"rush",
	"setsid",
	"sh",
	"stdbuf",
	"sudo",
	"time",
	"timeout",
	"toybox",
	"watch",
	"xargs",
	"zsh",
]);
const SHELL_INTERPRETERS = new Set(["bash", "dash", "ksh", "sh", "zsh"]);
const DIRECTORY_CONTEXT_COMMANDS = new Set([".", "cd", "eval", "exec", "popd", "pushd", "source"]);
const GIT_DISCARD_WORDS = new Set(["checkout", "clean", "reset", "restore", "stash", "switch"]);
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
	"-C",
	"-c",
	"--config-env",
	"--exec-path",
	"--git-dir",
	"--namespace",
	"--work-tree",
]);
