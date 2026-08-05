import { type Command, type Node, type ParsedScript, parse, type Redirect, type Statement, type Word } from "unbash";

const MAX_GROUPABLE_SHELL_BYTES = 32 * 1024;
const SIMPLE_READ_COMMANDS = new Set([
	"[",
	"basename",
	"cat",
	"cksum",
	"comm",
	"cut",
	"date",
	"df",
	"diff",
	"dirname",
	"du",
	"echo",
	"false",
	"file",
	"fold",
	"free",
	"grep",
	"head",
	"id",
	"jq",
	"lsof",
	"ls",
	"md5sum",
	"nl",
	"od",
	"pgrep",
	"printenv",
	"printf",
	"ps",
	"pwd",
	"readlink",
	"realpath",
	"rg",
	"sha1sum",
	"sha256sum",
	"sha512sum",
	"sort",
	"stat",
	"strings",
	"tail",
	"test",
	"tr",
	"tree",
	"true",
	"type",
	"uname",
	"uptime",
	"wc",
	"which",
	"whoami",
]);
const READ_ONLY_GIT_COMMANDS = new Set([
	"blame",
	"cat-file",
	"check-ignore",
	"count-objects",
	"describe",
	"diff",
	"diff-tree",
	"for-each-ref",
	"grep",
	"log",
	"ls-files",
	"ls-remote",
	"ls-tree",
	"merge-base",
	"name-rev",
	"rev-list",
	"rev-parse",
	"shortlog",
	"show",
	"show-ref",
	"status",
]);
const READ_ONLY_BD_COMMANDS = new Set([
	"blocked",
	"deferred",
	"doctor",
	"graph",
	"help",
	"list",
	"ready",
	"show",
	"stats",
	"status",
	"version",
	"where",
]);

function basename(command: string): string {
	return command.slice(command.lastIndexOf("/") + 1);
}

interface WordAnalysis {
	readonly evaluationSafe: boolean;
	readonly staticValue?: string;
}

function hasUnquotedExpansion(value: string): boolean {
	let quote: "'" | '"' | undefined;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === "\\") {
			index += 1;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (character === "*" || character === "?" || character === "[") return true;
		if (character === "{") {
			const end = value.indexOf("}", index + 1);
			const body = end < 0 ? "" : value.slice(index + 1, end);
			if (body.includes(",") || body.includes("..")) return true;
		}
	}
	return false;
}

function analyzeWord(word: Word | undefined): WordAnalysis {
	if (!word) return { evaluationSafe: false };
	let dynamic = hasUnquotedExpansion(word.text);
	for (const part of word.parts ?? []) {
		if (part.type === "Literal" || part.type === "SingleQuoted" || part.type === "AnsiCQuoted") continue;
		if (part.type === "SimpleExpansion") {
			dynamic = true;
			continue;
		}
		if (part.type === "ParameterExpansion") {
			if (part.operator || part.operand || part.slice || part.replace || part.index || part.indexParts?.length) {
				return { evaluationSafe: false };
			}
			dynamic = true;
			continue;
		}
		if (part.type === "CommandExpansion" || part.type === "ProcessSubstitution") {
			if (!part.script || !safeScript(part.script)) return { evaluationSafe: false };
			dynamic = true;
			continue;
		}
		if (part.type === "DoubleQuoted") {
			for (const child of part.parts) {
				if (child.type === "Literal") continue;
				if (child.type === "SimpleExpansion") {
					dynamic = true;
					continue;
				}
				if (child.type === "ParameterExpansion") {
					if (
						child.operator ||
						child.operand ||
						child.slice ||
						child.replace ||
						child.index ||
						child.indexParts?.length
					) {
						return { evaluationSafe: false };
					}
					dynamic = true;
					continue;
				}
				if (child.type === "CommandExpansion") {
					if (!child.script || !safeScript(child.script)) return { evaluationSafe: false };
					dynamic = true;
					continue;
				}
				return { evaluationSafe: false };
			}
			continue;
		}
		return { evaluationSafe: false };
	}
	return dynamic ? { evaluationSafe: true } : { evaluationSafe: true, staticValue: word.value };
}

function safeRedirect(redirect: Redirect): boolean {
	const target = analyzeWord(redirect.target);
	if (redirect.target && !target.evaluationSafe) return false;
	if (redirect.body && !analyzeWord(redirect.body).evaluationSafe) return false;
	switch (redirect.operator) {
		case "<":
			return !/^\/dev\/(?:tcp|udp)\//u.test(target.staticValue ?? "");
		case "<<":
		case "<<-":
		case "<<<":
			return true;
		case "<&":
		case ">&":
			return target.staticValue === "-" || /^\d+$/u.test(target.staticValue ?? "");
		case ">":
		case ">>":
		case ">|":
		case "&>":
		case "&>>":
			return target.staticValue === "/dev/null";
		case "<>":
			return false;
	}
}

function isForbiddenOption(arg: string, option: string): boolean {
	if (!option.startsWith("--")) return arg.startsWith(option);
	if (arg === option || arg.startsWith(`${option}=`)) return true;
	const abbreviated = arg.split("=", 1)[0] ?? "";
	return abbreviated.startsWith("--") && abbreviated.length > 2 && option.startsWith(abbreviated);
}

function noOption(args: readonly string[], ...forbidden: readonly string[]): boolean {
	return !args.some((arg) => forbidden.some((option) => isForbiddenOption(arg, option)));
}

function safeFind(args: readonly string[]): boolean {
	return noOption(args, "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprint", "-fprint0", "-fprintf");
}

function gitSubcommand(
	args: readonly string[],
): { readonly args: readonly string[]; readonly name: string } | undefined {
	let index = 0;
	while (index < args.length) {
		const arg = args[index];
		if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree" || arg === "--namespace") {
			index += 2;
			continue;
		}
		if (arg?.startsWith("--git-dir=") || arg?.startsWith("--work-tree=") || arg?.startsWith("--namespace=")) {
			index += 1;
			continue;
		}
		if (["--no-pager", "--literal-pathspecs", "--no-literal-pathspecs"].includes(arg ?? "")) {
			index += 1;
			continue;
		}
		break;
	}
	const name = args[index];
	return name ? { args: args.slice(index + 1), name } : undefined;
}

function safeGit(args: readonly string[]): boolean {
	if (args.length === 1 && ["--version", "-v"].includes(args[0] ?? "")) return true;
	const subcommand = gitSubcommand(args);
	if (!subcommand) return false;
	if (READ_ONLY_GIT_COMMANDS.has(subcommand.name)) {
		return noOption(
			subcommand.args,
			"--exec",
			"--ext-diff",
			"--filters",
			"--open-files-in-pager",
			"--output",
			"--textconv",
			"--upload-pack",
			"-o",
		);
	}
	switch (subcommand.name) {
		case "branch": {
			if (subcommand.args.length === 0) return true;
			const [first, ...rest] = subcommand.args;
			if (first === "--list") return rest.every((arg) => !arg.startsWith("-"));
			return subcommand.args.every((arg) =>
				[
					"--all",
					"--color",
					"--column",
					"--ignore-case",
					"--no-color",
					"--no-column",
					"--remotes",
					"--show-current",
					"--verbose",
					"-a",
					"-r",
					"-v",
					"-vv",
				].includes(arg),
			);
		}
		case "config":
			return false;
		case "remote":
			return (
				subcommand.args.length === 0 ||
				(subcommand.args.length === 1 && ["--verbose", "-v"].includes(subcommand.args[0] ?? "")) ||
				["get-url", "show"].includes(subcommand.args[0] ?? "")
			);
		case "stash":
			return ["list", "show"].includes(subcommand.args[0] ?? "");
		case "submodule":
			return subcommand.args[0] === "status";
		case "tag":
			return (
				subcommand.args.length === 0 ||
				(["--list", "-l"].includes(subcommand.args[0] ?? "") &&
					subcommand.args.slice(1).every((arg) => !arg.startsWith("-")))
			);
		case "worktree":
			return subcommand.args[0] === "list";
		default:
			return false;
	}
}

function safeBd(args: readonly string[]): boolean {
	const command = args.find((arg) => !arg.startsWith("-"));
	if (!command) return args.some((arg) => arg === "--version" || arg === "--help");
	const commandIndex = args.indexOf(command);
	const rest = args.slice(commandIndex + 1);
	if (command === "config") return ["get", "list", "show"].includes(rest[0] ?? "");
	if (!READ_ONLY_BD_COMMANDS.has(command)) return false;
	return noOption(rest, "--claim", "--claim-next", "--fix", "--repair", "--write");
}

function safePackageCommand(name: string, args: readonly string[]): boolean {
	if (args.length === 1 && ["--version", "-v", "-V"].includes(args[0] ?? "")) return true;
	if (name === "bun") {
		if (args[0] !== "pm") return false;
		return ["bin", "ls", "why"].includes(args[1] ?? "");
	}
	return ["info", "list", "ls", "outdated", "root", "view", "why"].includes(args[0] ?? "");
}

function safeGh(args: readonly string[]): boolean {
	if (args.length === 1 && args[0] === "--version") return true;
	if (!noOption(args, "--web")) return false;
	const [area, action] = args;
	if (area === "status") return true;
	if (area === "repo") return action === "view" || action === "list";
	if (area === "issue") return action === "list" || action === "view" || action === "status";
	if (area === "pr") return ["checks", "diff", "list", "status", "view"].includes(action ?? "");
	if (area === "run") return action === "list" || action === "view";
	return false;
}

function safeCommand(command: Command): boolean {
	if (command.prefix.length > 0 || !command.redirects.every(safeRedirect)) return false;
	const nameValue = analyzeWord(command.name).staticValue;
	if (!nameValue) return false;
	const args: string[] = [];
	let dynamicArgs = false;
	for (const word of command.suffix) {
		const analysis = analyzeWord(word);
		if (!analysis.evaluationSafe) return false;
		if (analysis.staticValue === undefined) dynamicArgs = true;
		else args.push(analysis.staticValue);
	}
	const name = basename(nameValue);
	if (SIMPLE_READ_COMMANDS.has(name)) {
		if (dynamicArgs && ["date", "diff", "file", "jq", "pgrep", "rg", "sort", "tree"].includes(name)) return false;
		if (name === "printf") return noOption(args, "-v");
		if (name === "date") return noOption(args, "--set", "-s");
		if (name === "diff") return noOption(args, "--output", "-o");
		if (name === "file") return noOption(args, "--compile", "--preserve-date", "-C", "-p");
		if (name === "jq") return noOption(args, "--run-tests");
		if (name === "pgrep") return noOption(args, "--signal");
		if (name === "rg") return noOption(args, "--pre");
		if (name === "sort") return noOption(args, "--compress-program", "--output", "-o");
		if (name === "tree") return noOption(args, "--output", "-o");
		return true;
	}
	if (name === "cd") return command.suffix.length <= 1;
	if (name === "command") return !dynamicArgs && (args[0] === "-v" || args[0] === "-V");
	if (dynamicArgs) return false;
	if (name === "find") return safeFind(args);
	if (name === "git") return safeGit(args);
	if (name === "bd") return safeBd(args);
	if (["bun", "npm", "pnpm", "yarn"].includes(name)) return safePackageCommand(name, args);
	if (name === "gh") return safeGh(args);
	if (["node", "pi"].includes(name)) return args.length === 1 && ["--version", "-v", "-V"].includes(args[0] ?? "");
	return false;
}

function safeNode(node: Node): boolean {
	switch (node.type) {
		case "Command":
			return safeCommand(node);
		case "Pipeline":
		case "AndOr":
			return node.commands.every(safeNode);
		case "Subshell":
		case "BraceGroup":
			return node.body.commands.every(safeStatement);
		case "CompoundList":
			return node.commands.every(safeStatement);
		case "If":
			return (
				node.clause.commands.every(safeStatement) &&
				node.then.commands.every(safeStatement) &&
				(node.else === undefined ||
					(node.else.type === "If" ? safeNode(node.else) : node.else.commands.every(safeStatement)))
			);
		default:
			return false;
	}
}

function safeStatement(statement: Statement): boolean {
	return statement.background !== true && statement.redirects.every(safeRedirect) && safeNode(statement.command);
}

function safeScript(script: ParsedScript): boolean {
	return (script.errors?.length ?? 0) === 0 && script.commands.length > 0 && script.commands.every(safeStatement);
}

/** Conservatively recognize shell reads that may be folded into an exploration summary. */
export function isLowImpactShellCommand(source: unknown): boolean {
	if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source) > MAX_GROUPABLE_SHELL_BYTES)
		return false;
	try {
		return safeScript(parse(source));
	} catch {
		return false;
	}
}
