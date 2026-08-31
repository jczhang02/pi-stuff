import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { PlannedToolActivityMember, ToolArguments } from "./activity.js";
import type { ToolActivityState } from "./activity-store.js";
import { backgroundOperationBlockModel } from "./background-operation-presentation.js";
import { fileOperationBlockModel, isFileOperationBlock } from "./file-operation-presentation.js";
import { operationArgument } from "./operation-block-evidence.js";
import type { OperationBlockRowModel } from "./operation-block-renderer.js";

function isBackgroundOutput(name: string, args: ToolArguments): boolean {
	return name === "background" && operationArgument(args, "action") === "output";
}

export function isOperationBlockMember(name: string, args: ToolArguments): boolean {
	return isFileOperationBlock(name) || isBackgroundOutput(name, args);
}

export function operationBlockModel(
	member: PlannedToolActivityMember,
	result: AgentToolResult<unknown> | undefined,
	state: ToolActivityState,
	expanded: boolean,
): OperationBlockRowModel | undefined {
	if (isFileOperationBlock(member.name)) return fileOperationBlockModel(member, result, state, expanded);
	if (isBackgroundOutput(member.name, member.args)) {
		return backgroundOperationBlockModel(member, result, state, expanded);
	}
	return undefined;
}
