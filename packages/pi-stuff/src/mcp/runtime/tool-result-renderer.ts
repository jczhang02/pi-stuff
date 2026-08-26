import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { type Component, Text, visibleWidth } from "@earendil-works/pi-tui";
import type { JsonInputObject, JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { boundTerminalLine, boundTerminalText, graphemePrefix } from "../../tool-display/index.js";

type McpToolResultDetails = JsonInputObject & { error?: JsonInputValue };
type McpToolContentBlock = AgentToolResult<McpToolResultDetails>["content"][number];

type RenderTheme = Pick<Theme, "fg"> & Partial<Pick<Theme, "bold">>;

const plainTheme: RenderTheme = { fg: (_name, text) => text };

export interface McpProxyToolCallInput {
	tool?: string;
	args?: string | object;
	connect?: string;
	describe?: string;
	search?: string;
	regex?: boolean;
	includeSchemas?: boolean;
	server?: string;
	action?: string;
}

interface McpToolRenderContext {
	isError: boolean;
}

export interface McpToolResultDisplay {
	lines: string[];
	truncated: boolean;
}

const DEFAULT_MAX_CALL_INPUT_CHARS = 1500;
const DEFAULT_MAX_COLLAPSED_LINES = 3;
const DEFAULT_MAX_COLLAPSED_CHARS = 8000;
const COLLAPSED_RENDER_CHAR_SLACK = 8;

class CollapsibleText implements Component {
	private readonly text: string;
	private readonly expanded: boolean;
	private readonly maxCollapsedLines: number;
	readonly ellipsis: string;
	readonly expandHint: string;
	private readonly preTruncated: boolean;
	private readonly fullText: Text;
	private readonly footerText: Text;
	private collapsedText: { charBudget: number; fullyIncluded: boolean; text: Text } | null = null;

	constructor(
		text: string,
		expanded: boolean,
		maxCollapsedLines: number,
		ellipsis: string,
		expandHint: string,
		preTruncated = false,
	) {
		this.text = text;
		this.expanded = expanded;
		this.maxCollapsedLines = maxCollapsedLines;
		this.ellipsis = ellipsis;
		this.expandHint = expandHint;
		this.preTruncated = preTruncated;
		this.fullText = new Text(text, 0, 0);
		this.footerText = new Text(`${ellipsis}\n${expandHint}`, 0, 0);
	}

	render(width: number): string[] {
		if (this.expanded) {
			return this.fullText.render(width);
		}

		const safeWidth = Math.max(1, Math.floor(width));
		const charBudget = safeWidth * (this.maxCollapsedLines + 1) * COLLAPSED_RENDER_CHAR_SLACK;
		if (!this.collapsedText || this.collapsedText.charBudget !== charBudget) {
			const prefix = graphemePrefix(this.text, charBudget);
			this.collapsedText = {
				charBudget,
				fullyIncluded: prefix === this.text,
				text: new Text(prefix, 0, 0),
			};
		}

		const lines = this.collapsedText.text.render(width);
		if (!this.preTruncated && this.collapsedText.fullyIncluded && lines.length <= this.maxCollapsedLines)
			return lines;

		return [...lines.slice(0, this.maxCollapsedLines), ...this.footerText.render(width)];
	}

	invalidate(): void {}
}

function truncateText(value: string, maxChars: number): string {
	return boundTerminalText(value, maxChars);
}

function formatJsonish(value: NonNullable<McpProxyToolCallInput["args"]>, maxChars: number): string {
	if (isRuntimeString(value)) {
		try {
			return truncateText(JSON.stringify(JSON.parse(value), null, 2), maxChars);
		} catch {
			return truncateText(value, maxChars);
		}
	}

	try {
		return truncateText(JSON.stringify(value, null, 2), maxChars);
	} catch {
		return truncateText(String(value), maxChars);
	}
}

function hasUsefulObjectContent(value: JsonInputValue): boolean {
	return isRuntimeObject(value) && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function formatMcpProxyToolCallLines(
	args: McpProxyToolCallInput,
	maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS,
): string[] {
	if (args.action === "ui-messages") return [`mcp ${args.action}`];

	if (args.tool) {
		const target = args.server ? `${args.tool} @ ${args.server}` : args.tool;
		const lines = [`mcp call ${target}`];
		if (args.args) lines.push(formatJsonish(args.args, maxInputChars));
		return lines;
	}

	if (args.connect) return [`mcp connect ${args.connect}`];
	if (args.describe) return [`mcp describe ${args.describe}`];

	if (args.search) {
		let line = `mcp search ${args.search}`;
		if (args.server) line += ` @ ${args.server}`;
		if (args.regex === true) line += " (regex)";
		if (args.includeSchemas === false) line += " (schemas hidden)";
		return [line];
	}

	if (args.server) return [`mcp list ${args.server}`];
	if (args.action) return [`mcp ${args.action}`];

	return ["mcp status"];
}

export function formatMcpDirectToolCallLines(
	displayName: string,
	args: JsonInputObject,
	maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS,
): string[] {
	if (!hasUsefulObjectContent(args)) return [displayName];
	return [displayName, formatJsonish(args, maxInputChars)];
}

function renderToolCallLines(lines: string[], theme?: RenderTheme) {
	const activeTheme = theme ?? plainTheme;
	const [rawTitle = "mcp", ...rest] = lines;
	const title = boundTerminalLine(rawTitle, DEFAULT_MAX_CALL_INPUT_CHARS);
	const styledTitle = activeTheme.fg("toolTitle", activeTheme.bold ? activeTheme.bold(title) : title);
	const styledRest = rest.map((line) =>
		activeTheme.fg("muted", boundTerminalText(line, DEFAULT_MAX_CALL_INPUT_CHARS)),
	);
	return new Text([styledTitle, ...styledRest].join("\n"), 0, 0);
}

export function renderMcpProxyToolCall(args: McpProxyToolCallInput, theme?: RenderTheme) {
	return renderToolCallLines(formatMcpProxyToolCallLines(args), theme);
}

export function createMcpDirectToolCallRenderer(displayName: string) {
	return (args: JsonInputObject, theme?: RenderTheme) => {
		return renderToolCallLines(formatMcpDirectToolCallLines(displayName, args), theme);
	};
}

function blockToLines(block: McpToolContentBlock): string[] {
	if (block.type === "text") {
		return block.text.split("\n").map((line) => boundTerminalLine(line, Number.MAX_SAFE_INTEGER));
	}
	return [`[image: ${block.mimeType}]`];
}

function collectCollapsedResultLines(
	content: AgentToolResult<McpToolResultDetails>["content"],
	maxLines: number,
	maxChars: number,
): McpToolResultDisplay {
	if (content.length === 0) return { lines: ["(empty result)"], truncated: false };

	const lines: string[] = [];
	let remainingCells = maxChars;
	let truncated = false;

	const appendLine = (line: string) => {
		if (lines.length >= maxLines || remainingCells <= 0) {
			truncated = true;
			return false;
		}

		const safe = boundTerminalLine(line, Number.MAX_SAFE_INTEGER);
		if (visibleWidth(safe) > remainingCells) {
			lines.push(boundTerminalLine(safe, remainingCells, ""));
			truncated = true;
			remainingCells = 0;
			return false;
		}

		lines.push(safe);
		remainingCells -= visibleWidth(safe) + 1;
		return true;
	};

	for (const block of content) {
		if (block.type !== "text") {
			if (!appendLine(`[image: ${block.mimeType}]`)) break;
			continue;
		}

		let start = 0;
		while (start <= block.text.length) {
			const newline = block.text.indexOf("\n", start);
			const line = newline === -1 ? block.text.slice(start) : block.text.slice(start, newline);
			if (!appendLine(line)) break;
			if (newline === -1) break;
			start = newline + 1;
		}

		if (truncated) break;
	}

	if (lines.length === 0) lines.push("");
	if (truncated && lines.length >= maxLines) lines.push("…");
	return { lines, truncated };
}

export function formatMcpToolResultIdentity(details: McpToolResultDetails | undefined): string | null {
	if (details?.["mode"] !== "call") return null;
	const server = isRuntimeString(details["server"])
		? details["server"]
		: isRuntimeString(details["hintServer"])
			? details["hintServer"]
			: null;
	if (!server) return null;
	if (isRuntimeString(details["tool"])) return `MCP ${server}/${details["tool"]}`;
	if (isRuntimeString(details["resourceUri"])) return `MCP ${server} resource ${details["resourceUri"]}`;
	if (isRuntimeString(details["requestedTool"])) return `MCP ${server}/${details["requestedTool"]}`;
	return null;
}

export function formatMcpToolResultLines(
	result: Pick<AgentToolResult<McpToolResultDetails>, "content">,
	expanded: boolean,
	maxCollapsedLines = 3,
	maxCollapsedChars = DEFAULT_MAX_COLLAPSED_CHARS,
): McpToolResultDisplay {
	if (!expanded) {
		return collectCollapsedResultLines(result.content, maxCollapsedLines, maxCollapsedChars);
	}

	const allLines = result.content.flatMap(blockToLines);
	const lines = allLines.length > 0 ? allLines : ["(empty result)"];
	return { lines, truncated: false };
}

export function renderMcpToolResult(
	result: AgentToolResult<McpToolResultDetails>,
	options: ToolRenderResultOptions,
	theme?: RenderTheme,
	context?: McpToolRenderContext,
) {
	const activeTheme = theme ?? plainTheme;
	if (options.isPartial) {
		return new Text(activeTheme.fg("warning", "Running MCP tool..."), 0, 0);
	}

	const hasErrorDetails = Boolean(result.details.error);
	const expanded = options.expanded || context?.isError === true || hasErrorDetails;
	const display = formatMcpToolResultLines(result, expanded);
	const identity = formatMcpToolResultIdentity(result.details);
	const output = [
		...(identity ? [activeTheme.fg("muted", identity)] : []),
		...display.lines.map((line) => activeTheme.fg("toolOutput", line)),
	].join("\n");

	return new CollapsibleText(
		output,
		expanded,
		DEFAULT_MAX_COLLAPSED_LINES + (identity ? 1 : 0),
		activeTheme.fg("muted", "…"),
		activeTheme.fg("muted", "(Ctrl+O to expand)"),
		display.truncated,
	);
}
