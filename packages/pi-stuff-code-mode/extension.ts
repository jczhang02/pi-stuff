import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	registerSuiteToolEnvelope,
	type SuiteToolDefinitionRegistry,
	type SuiteToolEnvelopeOperation,
	type SuiteToolSurfaceController,
} from "@jczhang02/pi-stuff-tools/contract";
import { Type } from "typebox";
import { SuiteCodeModeConnector } from "./connector.js";
import {
	captureCodeModeModelContent,
	decodeCodeModeMediaSegments,
	rehydrateCodeModeMessages,
	separateCodeModeMediaForUi,
} from "./presentation.js";
import { CodeModeRuntime, type PiStuffCodeModeDetails } from "./runtime.js";
import { V8CodeModeExecutor } from "./v8-executor.js";

export const CODE_MODE_TOOL_NAME = "codemode";

const CODE_MODE_PARAMETERS = Type.Object(
	{
		code: Type.String({ description: "JavaScript source only; no JSON wrapper or Markdown fence" }),
	},
	{ additionalProperties: false },
);

const CODE_MODE_DESCRIPTION = `Run JavaScript in isolated V8 and compose Pi Stuff Tools through the suite Connector.
Common calls:
- const value = await suite.read({ path: string, offset?: number, limit?: number })
- const value = await suite.bash({ command: string, description?: string, run_in_background?: boolean, timeout?: number }) // timeout is seconds, max 86400
- const value = await suite.edit({ path: string, edits: { oldText: string, newText: string }[] })
- const value = await suite.write({ path: string, content: string })
Use codemode.search(query) and codemode.describe("suite.name") for unfamiliar Tools. At top level, await work and call text(value); console is unavailable and top-level return is invalid. Emit only needed output. The sandbox has no direct filesystem, network, process, Node, Bun, require, fetch, or credentials; I/O is only through suite. Helpers include text, image, generatedImage, store, load, notify, exit, setTimeout, clearTimeout, and yield_control.`;

export interface PiStuffCodeModeOptions {
	readonly registry: SuiteToolDefinitionRegistry;
	readonly surface: SuiteToolSurfaceController;
}

export function decodeCodeModeOperations(details: unknown): readonly SuiteToolEnvelopeOperation[] {
	if (
		typeof details !== "object" ||
		details === null ||
		!("kind" in details) ||
		details.kind !== "pi-stuff-code-mode" ||
		!("operations" in details) ||
		!Array.isArray(details.operations)
	) {
		return [];
	}
	return details.operations as readonly SuiteToolEnvelopeOperation[];
}

export function createCodeModeDefinition(
	runtime: CodeModeRuntime,
): ToolDefinition<typeof CODE_MODE_PARAMETERS, PiStuffCodeModeDetails> {
	return {
		description: CODE_MODE_DESCRIPTION,
		executionMode: "sequential",
		async execute(toolCallId, input, signal, onUpdate, context) {
			return runtime.execute(toolCallId, input.code, context, signal, onUpdate);
		},
		label: "Code Mode",
		name: CODE_MODE_TOOL_NAME,
		parameters: CODE_MODE_PARAMETERS,
		promptSnippet: "Use codemode to compose Pi Stuff Tools with JavaScript while returning only needed output",
	};
}

/** Register before context managers so they receive the provider-visible result, not the TUI projection. */
export function registerCodeModeContextProjection(pi: ExtensionAPI): void {
	pi.on("context", (event) => {
		const messages = rehydrateCodeModeMessages(event.messages);
		return messages ? { messages } : undefined;
	});
}

export default function piStuffCodeMode(pi: ExtensionAPI, options: PiStuffCodeModeOptions): void {
	const runtime = new CodeModeRuntime(new SuiteCodeModeConnector(options.registry), new V8CodeModeExecutor());
	let enabled = process.env["PI_STUFF_CODE_MODE_DEFAULT"]?.trim().toLowerCase() === "on";
	registerSuiteToolEnvelope(pi, createCodeModeDefinition(runtime), {
		decode: decodeCodeModeOperations,
		media: decodeCodeModeMediaSegments,
		registry: options.registry,
	});

	const apply = (): void => {
		if (enabled) options.surface.enableEnvelope(CODE_MODE_TOOL_NAME);
		else options.surface.disableEnvelope(CODE_MODE_TOOL_NAME);
	};
	pi.registerCommand("codemode", {
		description: "Enable, disable, or inspect Code Mode",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"]
				.filter((value) => value.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ label: value, value })),
		handler: async (args, context) => {
			const action = args.trim().toLowerCase() || "status";
			if (action === "on") enabled = true;
			else if (action === "off") enabled = false;
			else if (action !== "status") {
				context.ui.notify("Usage: /codemode [on|off|status]", "warning");
				return;
			}
			apply();
			context.ui.notify(`Code Mode ${enabled ? "on" : "off"}`, "info");
		},
	});
	pi.on("session_start", apply);
	pi.on("model_select", apply);
	pi.on("before_agent_start", apply);
	pi.on("tool_result", (event) => {
		if (event.toolName !== CODE_MODE_TOOL_NAME) return undefined;
		const details = event.details as PiStuffCodeModeDetails | undefined;
		if (details?.kind === "pi-stuff-code-mode") captureCodeModeModelContent(details, event.content);
		if (details?.kind === "pi-stuff-code-mode" && (details.status === "error" || details.status === "cancelled")) {
			return { isError: true };
		}
		return undefined;
	});
	pi.on("tool_execution_end", (event) => {
		if (event.toolName !== CODE_MODE_TOOL_NAME) return;
		const separated = separateCodeModeMediaForUi(event.result);
		if (!separated) return;
		event.result.content = separated.content;
		event.result.details = separated.details;
	});
	pi.on("session_shutdown", async () => {
		await runtime.shutdown();
	});
}
