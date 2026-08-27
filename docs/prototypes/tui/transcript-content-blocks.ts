/**
 * PROTOTYPE — fixture renderer for native Pi transcript content blocks.
 *
 * This Extension never calls a model. Its tool exists only so Pi can pair the
 * tool calls and results stored in generated session fixtures with a real
 * ToolExecutionComponent and this proposed renderer.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface PrototypeInspectDetails {
	detailLines: string[];
	hint?: string;
	summary: string;
}

const PARAMETERS = Type.Object({
	path: Type.String({ description: "Fixture path shown in the transcript" }),
});

export default function registerTranscriptContentBlocks(pi: ExtensionAPI): void {
	// A local catalog entry keeps the footer deterministic. The fixture never
	// starts a turn, so no provider request is made.
	pi.registerProvider("fixture", {
		name: "Transcript fixture",
		baseUrl: "http://127.0.0.1.invalid",
		apiKey: "fixture-only",
		api: "openai-completions",
		models: [
			{
				id: "transcript-fixture",
				name: "Transcript fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8_192,
				maxTokens: 1_024,
			},
		],
	});

	pi.registerTool({
		name: "prototype_inspect",
		label: "Inspect fixture",
		description: "Render a fixed transcript fixture. This prototype tool performs no I/O.",
		parameters: PARAMETERS,

		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text" as const, text: `Fixture only: ${params.path}` }],
				details: {
					detailLines: [],
					summary: "Fixture completed",
				} satisfies PrototypeInspectDetails,
			};
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(`${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", args.path)}`);
			return text;
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			// SAFETY: this fixture Tool returns PrototypeInspectDetails; undefined remains valid for partial Host results.
			const details = result.details as PrototypeInspectDetails | undefined;

			if (isPartial) {
				text.setText(`\n${theme.fg("warning", "· Working")}`);
				return text;
			}

			if (context.isError) {
				const summary = details?.summary ?? "Action failed";
				const hint = details?.hint;
				const lines = [`\n${theme.fg("error", "✗")} ${theme.fg("text", summary)}`];
				if (hint) lines.push(`  ${theme.fg("muted", hint)}`);
				text.setText(lines.join("\n"));
				return text;
			}

			const summary = details?.summary ?? "Action completed";
			const lines = [`\n${theme.fg("success", "✓")} ${theme.fg("text", summary)}`];
			if (expanded) {
				for (const detailLine of details?.detailLines ?? []) {
					lines.push(`  ${theme.fg("toolOutput", detailLine)}`);
				}
			} else if ((details?.detailLines.length ?? 0) > 0) {
				lines[0] += theme.fg("dim", "  (ctrl+o for details)");
			}

			text.setText(lines.join("\n"));
			return text;
		},
	});
}
