import type { PathNormalizer } from "#src/path-normalizer";
import type { BashCommandContext } from "#src/types";
import { resolveNodeText, SKIP_SUBTREE_TYPES } from "./node-text";
import type { TSNode } from "./parser";

/** One shell argument together with the facts needed by a destructive gate. */
export interface BashArgument {
	readonly value: string;
	readonly isStatic: boolean;
	readonly hasGlob: boolean;
}

/** A concrete command occurrence in the parsed Bash program. */
export interface BashInvocation {
	readonly commandName: string | undefined;
	readonly commandNameIsStatic: boolean;
	readonly args: readonly BashArgument[];
	readonly text: string;
	readonly effectiveDirectory: string | undefined;
	readonly context: BashCommandContext | undefined;
}

/**
 * Enumerate executable command nodes and retain their effective directories.
 *
 * This projection is deliberately narrower than the general permission rule
 * projection. It exists for the non-relaxable destructive-command tripwire,
 * which must know whether a literal deletion target resolves inside or outside
 * the current working directory. Literal `cd` commands in current-shell lists
 * are folded; an ambiguous directory instead becomes `undefined`, causing a
 * destructive relative target to fail closed and be rewritten concretely.
 */
export function collectInvocations(root: TSNode, normalizer: PathNormalizer, workdir?: string): BashInvocation[] {
	const invocations: BashInvocation[] = [];
	const initialDirectory = resolveInitialDirectory(normalizer, workdir);
	walk(root, initialDirectory, undefined, normalizer, invocations);
	return invocations;
}

function walk(
	node: TSNode,
	directory: string | undefined,
	context: BashCommandContext | undefined,
	normalizer: PathNormalizer,
	out: BashInvocation[],
): string | undefined {
	if (SKIP_SUBTREE_TYPES.has(node.type)) return directory;

	switch (node.type) {
		case "program":
		case "list":
		case "redirected_statement":
		case "compound_statement":
			return walkSequence(node, directory, context, normalizer, out);
		case "command":
			return walkCommand(node, directory, context, normalizer, out);
		case "pipeline":
			return walkPipeline(node, directory, context, normalizer, out);
		case "subshell":
			walkSequence(node, directory, "subshell", normalizer, out);
			return directory;
		case "command_substitution":
			walkSequence(node, directory, "command_substitution", normalizer, out);
			return directory;
		case "process_substitution":
			walkSequence(node, directory, "process_substitution", normalizer, out);
			return directory;
		case "function_definition":
			// Defining a function does not execute its body. A later invocation is
			// intentionally outside the first release's alias/function guarantee.
			return directory;
		default:
			return walkUncertainContainer(node, directory, context, normalizer, out);
	}
}

function walkSequence(
	node: TSNode,
	directory: string | undefined,
	context: BashCommandContext | undefined,
	normalizer: PathNormalizer,
	out: BashInvocation[],
): string | undefined {
	let current = directory;
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (!child?.isNamed || SKIP_SUBTREE_TYPES.has(child.type)) continue;
		const next = walk(child, current, context, normalizer, out);
		current = isBackgrounded(node, index) ? current : next;
	}
	return current;
}

function walkPipeline(
	node: TSNode,
	directory: string | undefined,
	context: BashCommandContext | undefined,
	normalizer: PathNormalizer,
	out: BashInvocation[],
): string | undefined {
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (!child?.isNamed || SKIP_SUBTREE_TYPES.has(child.type)) continue;
		// Each true pipeline stage executes in a subshell. Walking each child from
		// the same base also handles tree-sitter's occasional list-as-first-stage
		// grouping without leaking a `cd` past the pipeline.
		walk(child, directory, context, normalizer, out);
	}
	return directory;
}

function walkCommand(
	node: TSNode,
	directory: string | undefined,
	context: BashCommandContext | undefined,
	normalizer: PathNormalizer,
	out: BashInvocation[],
): string | undefined {
	const invocation = readInvocation(node, directory, context);
	out.push(invocation);
	walkNestedExecutions(node, directory, normalizer, out);

	if (basename(invocation.commandName) !== "cd") return directory;
	const target = invocation.args[0];
	if (!target || invocation.args.length !== 1 || !target.isStatic || target.hasGlob) {
		return undefined;
	}
	return foldDirectory(directory, target.value, normalizer);
}

function walkNestedExecutions(
	node: TSNode,
	directory: string | undefined,
	normalizer: PathNormalizer,
	out: BashInvocation[],
): void {
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (!child || SKIP_SUBTREE_TYPES.has(child.type)) continue;
		if (child.type === "command_substitution") {
			walk(child, directory, "command_substitution", normalizer, out);
			continue;
		}
		if (child.type === "process_substitution") {
			walk(child, directory, "process_substitution", normalizer, out);
			continue;
		}
		walkNestedExecutions(child, directory, normalizer, out);
	}
}

function walkUncertainContainer(
	node: TSNode,
	directory: string | undefined,
	context: BashCommandContext | undefined,
	normalizer: PathNormalizer,
	out: BashInvocation[],
): string | undefined {
	const childDirectory = containsCommandNamed(node, "cd") ? undefined : directory;
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (!child?.isNamed || SKIP_SUBTREE_TYPES.has(child.type)) continue;
		walk(child, childDirectory, context, normalizer, out);
	}
	// Branches and loop bodies do not provide one deterministic post-state.
	return directory;
}

function readInvocation(
	node: TSNode,
	effectiveDirectory: string | undefined,
	context: BashCommandContext | undefined,
): BashInvocation {
	let commandName: string | undefined;
	let commandNameIsStatic = false;
	const args: BashArgument[] = [];

	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (!child?.isNamed || child.type === "variable_assignment") continue;
		if (commandName === undefined && child.type === "command_name") {
			const resolved = resolveStaticInvocationText(child);
			commandName = resolved ?? resolveNodeText(child);
			commandNameIsStatic = resolved !== undefined;
			continue;
		}
		if (child.type === "file_redirect" || child.type === "heredoc_redirect") continue;
		const resolved = resolveStaticInvocationText(child);
		args.push({
			value: resolved ?? resolveNodeText(child),
			isStatic: resolved !== undefined,
			hasGlob: nodeHasGlob(child),
		});
	}

	return {
		commandName,
		commandNameIsStatic,
		args,
		text: node.text,
		effectiveDirectory,
		context,
	};
}

/** Resolve the exact argv value for the static shell shapes we certify. */
function resolveStaticInvocationText(node: TSNode): string | undefined {
	if (DYNAMIC_NODE_TYPES.has(node.type)) return undefined;
	if (node.type === "command_name") {
		const child = firstNamedChild(node);
		return child ? resolveStaticInvocationText(child) : undefined;
	}
	if (node.type === "word") return unescapeUnquotedWord(node.text);
	if (node.type === "ansi_c_string") return decodeAnsiCString(node.text);
	if (node.type === "concatenation") {
		if (/\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(node.text)) return undefined;
		let value = "";
		for (let index = 0; index < node.childCount; index++) {
			const child = node.child(index);
			if (!child) continue;
			const part = resolveStaticInvocationText(child);
			if (part === undefined) return undefined;
			value += part;
		}
		return value;
	}
	if (!nodeIsStatic(node)) return undefined;
	return resolveNodeText(node);
}

function firstNamedChild(node: TSNode): TSNode | undefined {
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (child?.isNamed) return child;
	}
	return undefined;
}

function unescapeUnquotedWord(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (character === "\\" && index + 1 < value.length) {
			result += value[index + 1];
			index += 1;
		} else {
			result += character;
		}
	}
	return result;
}

function decodeAnsiCString(value: string): string | undefined {
	if (!value.startsWith("$'") || !value.endsWith("'")) return undefined;
	const body = value.slice(2, -1);
	let result = "";
	for (let index = 0; index < body.length; index++) {
		const character = body[index];
		if (character !== "\\") {
			result += character;
			continue;
		}
		const escaped = body[index + 1];
		if (escaped === undefined) return undefined;
		index += 1;
		const simple = ANSI_C_SIMPLE_ESCAPES[escaped];
		if (simple !== undefined) {
			result += simple;
			continue;
		}
		if (escaped === "x") {
			const parsed = readEscapedInteger(body, index + 1, 2, 16);
			if (!parsed) return undefined;
			result += String.fromCodePoint(parsed.value);
			index = parsed.end - 1;
			continue;
		}
		if (escaped === "u" || escaped === "U") {
			const digits = escaped === "u" ? 4 : 8;
			const parsed = readEscapedInteger(body, index + 1, digits, 16, true);
			if (!parsed || parsed.value > 0x10ffff) return undefined;
			result += String.fromCodePoint(parsed.value);
			index = parsed.end - 1;
			continue;
		}
		if (escaped === "c") return undefined;
		if (escaped === "0") {
			const parsed = readEscapedInteger(body, index + 1, 3, 8);
			if (!parsed) {
				result += "\0";
			} else {
				result += String.fromCodePoint(parsed.value);
				index = parsed.end - 1;
			}
			continue;
		}
		if (/[0-7]/.test(escaped)) {
			const parsed = readEscapedInteger(body, index, 3, 8);
			if (!parsed) return undefined;
			result += String.fromCodePoint(parsed.value);
			index = parsed.end - 1;
			continue;
		}
		// Bash preserves an unknown ANSI-C escape as backslash + character. Treat
		// it exactly, rather than guessing that the backslash disappears.
		result += `\\${escaped}`;
	}
	return result;
}

function readEscapedInteger(
	input: string,
	start: number,
	maximumDigits: number,
	radix: 8 | 16,
	exact = false,
): { value: number; end: number } | undefined {
	const pattern = radix === 16 ? /[0-9a-fA-F]/ : /[0-7]/;
	let end = start;
	while (end < input.length && end - start < maximumDigits && pattern.test(input[end] ?? "")) {
		end += 1;
	}
	if (end === start || (exact && end - start !== maximumDigits)) return undefined;
	return { value: Number.parseInt(input.slice(start, end), radix), end };
}

const ANSI_C_SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
	"\\": "\\",
	"'": "'",
	'"': '"',
	a: "\u0007",
	b: "\b",
	e: "\u001b",
	E: "\u001b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
};

function nodeIsStatic(node: TSNode): boolean {
	if (DYNAMIC_NODE_TYPES.has(node.type)) return false;
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (child && !nodeIsStatic(child)) return false;
	}
	return true;
}

function nodeHasGlob(node: TSNode): boolean {
	if (node.type === "raw_string" || node.type === "string") return false;
	if (node.type === "word") return containsUnescapedGlob(node.text);
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (child && nodeHasGlob(child)) return true;
	}
	return false;
}

function containsUnescapedGlob(value: string): boolean {
	let escaped = false;
	for (const character of value) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "*" || character === "?" || character === "[") return true;
	}
	return false;
}

function containsCommandNamed(node: TSNode, name: string): boolean {
	if (node.type === "command") {
		const invocation = readInvocation(node, undefined, undefined);
		if (basename(invocation.commandName) === name) return true;
	}
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (child && containsCommandNamed(child, name)) return true;
	}
	return false;
}

function foldDirectory(directory: string | undefined, target: string, normalizer: PathNormalizer): string | undefined {
	const interpreted = normalizer.interpretBashCdTarget(target);
	switch (interpreted.kind) {
		case "absolute":
			return normalizer.flavor.impl.normalize(interpreted.value);
		case "relative":
			return directory === undefined ? undefined : normalizer.flavor.impl.resolve(directory, target);
		case "unknown":
			return undefined;
	}
}

function resolveInitialDirectory(normalizer: PathNormalizer, workdir: string | undefined): string | undefined {
	if (workdir === undefined) return normalizer.resolveBase("");
	const resolved = normalizer.forBashToken(workdir).value();
	return resolved || undefined;
}

function isBackgrounded(node: TSNode, index: number): boolean {
	const next = node.child(index + 1);
	return next !== null && !next.isNamed && next.type === "&";
}

function basename(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = value.replaceAll("\\", "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1);
}

const DYNAMIC_NODE_TYPES = new Set([
	"arithmetic_expansion",
	"brace_expansion",
	"command_substitution",
	"expansion",
	"process_substitution",
	"simple_expansion",
]);
