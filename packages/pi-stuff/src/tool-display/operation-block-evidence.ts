import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { readHostProxyProperty } from "../shared/host-proxy.js";
import { isRuntimeObject, isRuntimeString } from "../shared/runtime-type.js";
import type { ToolArguments } from "./activity.js";
import type { ToolActivityState } from "./activity-store.js";
import type { OperationBlockRowModel, OperationEvidenceLine } from "./operation-block-renderer.js";
import { oneLine } from "./tool-text.js";

export const COMPACT_OPERATION_BYTE_LIMIT = 2 * 1024;
export const EXPANDED_OPERATION_BYTE_LIMIT = 24 * 1024;
export const EXPANDED_OPERATION_LINE_LIMIT = 240;

export function operationArgument(args: ToolArguments, key: string): string {
	const value = args[key];
	return isRuntimeString(value) ? value : "";
}

export function operationResultText(result: AgentToolResult<unknown> | undefined): string {
	return (
		result?.content
			.filter((item): item is { readonly text: string; readonly type: "text" } => item.type === "text")
			.map((item) => item.text)
			.join("\n") ?? ""
	);
}

export function operationIssueLine(
	state: ToolActivityState,
	result: AgentToolResult<unknown> | undefined,
): OperationEvidenceLine {
	const raw = operationResultText(result)
		.split(/\r?\n/u)
		.find((line) => line.trim().length > 0);
	const reason = oneLine(raw ?? state) || state;
	if (state === "rejected") return { kind: "outcome", text: `Rejected: ${reason}`, tone: "warning" };
	if (state === "cancelled") return { kind: "outcome", text: `Cancelled: ${reason}`, tone: "warning" };
	return { kind: "outcome", text: `Error: ${reason}`, tone: "error" };
}

export function logicalOperationLines(value: string): string[] {
	if (!value) return [];
	const lines = value.replaceAll("\r", "").split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

export function boundedOperationLines(lines: readonly string[], expanded: boolean, compactLineLimit: number) {
	const lineLimit = expanded ? EXPANDED_OPERATION_LINE_LIMIT : compactLineLimit;
	const byteLimit = expanded ? EXPANDED_OPERATION_BYTE_LIMIT : COMPACT_OPERATION_BYTE_LIMIT;
	const visible: string[] = [];
	let bytes = 0;
	for (const line of lines) {
		if (visible.length >= lineLimit) break;
		const nextBytes = Buffer.byteLength(line) + (visible.length > 0 ? 1 : 0);
		if (bytes + nextBytes > byteLimit) break;
		visible.push(line);
		bytes += nextBytes;
	}
	return { omitted: Math.max(0, lines.length - visible.length), visible };
}

function detailsRecord(result: AgentToolResult<unknown> | undefined): object | undefined {
	const details = result?.details;
	return isRuntimeObject(details) && details !== null && !Array.isArray(details) ? details : undefined;
}

export function operationDetailString(result: AgentToolResult<unknown> | undefined, key: string): string | undefined {
	const details = detailsRecord(result);
	if (!details) return undefined;
	const value: unknown = readHostProxyProperty(details, key);
	return isRuntimeString(value) ? value : undefined;
}

export function operationDetailStrings(result: AgentToolResult<unknown> | undefined, key: string): string[] {
	const details = detailsRecord(result);
	if (!details) return [];
	const value: unknown = readHostProxyProperty(details, key);
	return Array.isArray(value) && value.every(isRuntimeString) ? [...value] : [];
}

export function baseOperationBlockModel(
	label: string,
	identity: string,
	state: ToolActivityState,
	expanded: boolean,
	evidence: readonly OperationEvidenceLine[],
): OperationBlockRowModel {
	return {
		active: state === "running",
		evidence,
		expandable: false,
		expanded,
		identity: oneLine(identity),
		kind: "operation-block",
		label,
		state,
	};
}
