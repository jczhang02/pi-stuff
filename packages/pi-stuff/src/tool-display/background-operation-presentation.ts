import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { PlannedToolActivityMember } from "./activity.js";
import type { ToolActivityState } from "./activity-store.js";
import {
	baseOperationBlockModel,
	boundedOperationLines,
	logicalOperationLines,
	operationArgument,
	operationIssueLine,
	operationResultText,
} from "./operation-block-evidence.js";
import type { OperationBlockRowModel, OperationEvidenceLine } from "./operation-block-renderer.js";

export function backgroundOperationBlockModel(
	member: PlannedToolActivityMember,
	result: AgentToolResult<unknown> | undefined,
	state: ToolActivityState,
	expanded: boolean,
): OperationBlockRowModel {
	const id = operationArgument(member.args, "task_id") || operationArgument(member.args, "taskId");
	if (state === "running") {
		return baseOperationBlockModel("Background", id, state, expanded, [{ kind: "outcome", text: "Reading output…" }]);
	}
	if (state !== "success") {
		return baseOperationBlockModel("Background", id, state, expanded, [operationIssueLine(state, result)]);
	}
	const text = operationResultText(result).trim();
	if (!text || /^\(no output yet\)$/iu.test(text)) {
		return baseOperationBlockModel("Background", id, state, expanded, [
			{ kind: "outcome", text: "No output yet.", tone: "muted" },
		]);
	}
	const lines = logicalOperationLines(text);
	const preview = boundedOperationLines(lines, expanded, 3);
	const evidence: OperationEvidenceLine[] = [
		{ kind: "outcome", text: `${String(lines.length)} lines read` },
		...preview.visible.map((line) => ({ kind: "meta" as const, text: line, tone: "muted" as const })),
	];
	if (preview.omitted > 0) {
		evidence.push({
			kind: "meta",
			text: expanded
				? `… ${String(preview.omitted)} lines omitted · output capped at 240 lines / 24 KiB`
				: `… +${String(preview.omitted)} lines (ctrl+o to expand)`,
		});
	}
	return {
		...baseOperationBlockModel("Background", id, state, expanded, evidence),
		expandable: preview.omitted > 0,
	};
}
