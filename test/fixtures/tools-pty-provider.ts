import { appendFileSync } from "node:fs";
import type { Context } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerSuiteOwnedTool } from "../../packages/pi-stuff/src/tool-display/index.js";
import { createAssistantMessage, createTextStream, registerFixtureProvider } from "./faux-provider.js";

const PROVIDER = "pi-stuff-tools-pty";
const MODEL = "fixture-model";
const LONG_READ_TARGET = "pi-max-tools-019fc372-d606-77ef-b3d5-59ba054c8d1a/deep/sample-工具.txt";

const TOOL_SEQUENCE = [
	{ name: "read", arguments: { path: LONG_READ_TARGET } },
	{
		name: "write",
		arguments: { path: "written.ts", content: 'const label = "旧内容";\nconst count = 2;\n' },
	},
	{ name: "edit", arguments: { path: "written.ts", oldText: "旧内容", newText: "新内容" } },
	{ name: "bash", arguments: { command: "printf '\u001b]0;OWNED_TITLE\u0007BASH_CJK_工具\\n'" } },
	{ name: "grep", arguments: { pattern: "新内容", path: "." } },
	{ name: "find", arguments: { pattern: "*.txt", path: "." } },
	{ name: "ls", arguments: { path: "." } },
	{ name: "bash", arguments: { command: "printf 'BUILTIN_FAILURE_工具\\n' >&2; exit 7" } },
	{ name: "fixture_search", arguments: {} },
	{ name: "fixture_state", arguments: { state: "error" } },
	{ name: "fixture_state", arguments: { state: "rejected" } },
	{ name: "fixture_state", arguments: { state: "cancelled" } },
	{ name: "tool_search", arguments: { query: "write file" } },
	{ name: "codemode", arguments: { code: 'await yield_control(); text("CONTROL_ONLY_ACK")' } },
	{ name: "codemode", arguments: { code: "const silent = 1;" } },
	{
		name: "codemode",
		arguments: { code: 'text("VISIBLE_CODE_MODE_SUMMARY\\nVISIBLE_CODE_MODE_DETAIL")' },
	},
] as const;

const message = createAssistantMessage(PROVIDER, MODEL);
const textStream = createTextStream(message);

function toolCallStream(index: number) {
	const stream = createAssistantMessageEventStream();
	const pending = message([], "pending");
	const fixture = TOOL_SEQUENCE[index];
	if (!fixture) return textStream("TOOLS_DONE");
	const toolCall = {
		type: "toolCall" as const,
		id: `tools-pty-${String(index + 1)}`,
		name: fixture.name,
		arguments: fixture.arguments,
	};
	stream.push({ type: "start", partial: pending });
	pending.content.push(toolCall);
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: pending });
	stream.push({ type: "done", reason: "toolUse", message: message([toolCall], "toolUse") });
	return stream;
}

function fixtureStream(context: Context) {
	const completed = context.messages.filter((entry) => entry.role === "toolResult").length;
	const tools = (context.tools ?? []).map((tool) => tool.name);
	const logPath = process.env["PI_STUFF_TOOLS_PTY_LOG"];
	if (logPath) appendFileSync(logPath, `${JSON.stringify({ completed, tools })}\n`);
	if (process.env["PI_STUFF_TOOLS_PTY_PROBE_ONLY"] === "1") return textStream("TOOLS_PROBE_DONE");
	if (completed === 12 && !tools.includes("codemode")) return textStream("TOOLS_DIRECT_DONE");
	return completed < TOOL_SEQUENCE.length ? toolCallStream(completed) : textStream("TOOLS_DONE");
}

export default function toolsPtyProvider(pi: ExtensionAPI): void {
	registerSuiteOwnedTool(
		pi,
		{
			description: "Delay one retrieval for active Tool UI certification",
			execute: async () => {
				await new Promise((resolve) => setTimeout(resolve, 1_900));
				return { content: [{ type: "text", text: "FIXTURE_SEARCH" }], details: undefined };
			},
			label: "Search",
			name: "fixture_search",
			parameters: Type.Object({}),
		},
		{
			activity: {
				categories: ["search-pattern"],
				classify: () => [{ category: "search-pattern", count: 1, target: "fixture" }],
			},
			runningSummary: "searching",
			summarize: () => "searched",
			target: () => "fixture",
		},
	);
	registerSuiteOwnedTool(
		pi,
		{
			description: "Return deterministic terminal states for Tool UI certification",
			execute: async (_toolCallId, args) => {
				if (args.state === "error") await new Promise((resolve) => setTimeout(resolve, 1_900));
				return {
					content: [
						{
							type: "text",
							text:
								args.state === "rejected"
									? "Tool execution was blocked: FIXTURE_REJECTED"
									: args.state === "cancelled"
										? "Command aborted: FIXTURE_CANCELLED"
										: "FIXTURE_ERROR",
						},
					],
					details: { state: args.state },
				};
			},
			label: "State",
			name: "fixture_state",
			parameters: Type.Object({
				state: Type.Union([Type.Literal("error"), Type.Literal("rejected"), Type.Literal("cancelled")]),
			}),
		},
		{
			activity: { categories: ["run-command"], classify: () => [{ category: "run-command", count: 1 }] },
			resultIsError: () => true,
			summarize: (_args, _result, state) => state,
			target: (args) => args.state,
		},
	);
	registerFixtureProvider(pi, PROVIDER, MODEL, "Pi Stuff Tools PTY fixture", (_model, context) =>
		fixtureStream(context),
	);
}
