/**
 * General utility functions for the subagent extension
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { getAgentDir as getPiAgentDir } from "@earendil-works/pi-coding-agent";
import { isJsonInputValue, type JsonObject, type JsonValue, parseJsonValue } from "../../../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber, isRuntimeObject, isRuntimeString } from "../../../shared/runtime-type.js";
import type { ToolArguments } from "../../../tool-display/activity.js";
import { boundTerminalLine } from "../../../tool-display/index.js";
import { formatToolCall } from "./formatters.ts";
import {
	assertPrivateDirectory,
	readBoundedOwnedFileSnapshot,
	readBoundedOwnedFileSnapshotAsync,
} from "./private-directory.ts";
import type {
	AgentProgress,
	AsyncStatus,
	Details,
	DisplayItem,
	ErrorInfo,
	NestedRunSummary,
	SingleResult,
	ToolCallSummary,
	Usage,
} from "./types.ts";

// ============================================================================
// File System Utilities
// ============================================================================

const DEFAULT_CONFIG_DIR_NAME = ".pi";
const PI_CODING_AGENT_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const PI_CODING_AGENT_PACKAGE_ROOT_ENV = "PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT";

export function resolveWatchPath(
	watchPath: string,
	nativeRealpath: (filePath: string) => string = fs.realpathSync.native,
): string {
	// libuv's Windows watcher cannot mix 8.3 registration paths with long event paths.
	try {
		return nativeRealpath(watchPath);
	} catch {
		return watchPath;
	}
}

function validConfigDirName<Value>(value: Value): string | undefined {
	return isRuntimeString(value) && value.trim() ? value : undefined;
}

function readConfigDirNameFromPackageRoot(packageRoot: string | undefined): string | undefined {
	if (!packageRoot) return undefined;
	try {
		const pkg = parseJsonValue(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"));
		if (
			!isRuntimeObject(pkg) ||
			pkg === null ||
			Array.isArray(pkg) ||
			!("name" in pkg) ||
			pkg["name"] !== PI_CODING_AGENT_PACKAGE_NAME
		) {
			return undefined;
		}
		if (
			!("piConfig" in pkg) ||
			!isRuntimeObject(pkg["piConfig"]) ||
			pkg["piConfig"] === null ||
			Array.isArray(pkg["piConfig"])
		) {
			return undefined;
		}
		return "configDir" in pkg["piConfig"] ? validConfigDirName(pkg["piConfig"]["configDir"]) : undefined;
	} catch {
		return undefined;
	}
}

function resolveConfigDirNameFromPackageJson(
	entryPoint = process.argv[1],
	packageRoot = process.env[PI_CODING_AGENT_PACKAGE_ROOT_ENV],
): string | undefined {
	const packageRootValue = readConfigDirNameFromPackageRoot(packageRoot);
	if (packageRootValue) return packageRootValue;
	if (!entryPoint) return undefined;
	try {
		let dir = path.dirname(fs.realpathSync(entryPoint));
		while (dir !== path.dirname(dir)) {
			const value = readConfigDirNameFromPackageRoot(dir);
			if (value) return value;
			dir = path.dirname(dir);
		}
	} catch {
		// Package metadata lookup is best-effort; detached runners must not fail here.
	}
	return undefined;
}

export function resolveConfigDirName<CodingAgentModule>(
	codingAgentModule?: CodingAgentModule,
	entryPoint?: string,
	packageRoot?: string,
): string {
	const moduleValue =
		codingAgentModule && isRuntimeObject(codingAgentModule) && "CONFIG_DIR_NAME" in codingAgentModule
			? validConfigDirName(codingAgentModule.CONFIG_DIR_NAME)
			: undefined;
	return moduleValue ?? resolveConfigDirNameFromPackageJson(entryPoint, packageRoot) ?? DEFAULT_CONFIG_DIR_NAME;
}

export function getConfigDirName(): string {
	return resolveConfigDirName();
}

export function getProjectConfigDir(projectRoot: string): string {
	return path.join(projectRoot, getConfigDirName());
}

export function getAgentDir(): string {
	return getPiAgentDir();
}

export function getAgentSessionsDir(environment: NodeJS.ProcessEnv = process.env): string {
	const configured = environment["PI_CODING_AGENT_SESSION_DIR"];
	const home = environment["HOME"] ?? os.homedir();
	if (configured === "~") return home;
	if (configured?.startsWith("~/")) return path.join(home, configured.slice(2));
	return configured || path.join(getAgentDir(), "sessions");
}

const statusCache = new Map<
	string,
	{ mtime: number; ctime: number; size: number; ino: number; dev: number; status: AsyncStatus }
>();
export const MAX_ASYNC_STATUS_FILE_BYTES = 8 * 1024 * 1024;

function getErrorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function resolveChildCwd(baseCwd: string, childCwd: string | undefined): string {
	if (!childCwd) return baseCwd;
	return path.isAbsolute(childCwd) ? childCwd : path.resolve(baseCwd, childCwd);
}

function isNotFoundError<Cause>(cause: Cause): boolean {
	return isRuntimeObject(cause) && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function asyncStatusForRun(status: JsonValue, statusPath: string, expectedRunId: string): AsyncStatus {
	if (
		!isRuntimeObject(status) ||
		status === null ||
		Array.isArray(status) ||
		!("runId" in status) ||
		status["runId"] !== expectedRunId
	) {
		throw new Error(`Async status file '${statusPath}' runId must exactly match its run directory.`);
	}
	// SAFETY: the bounded file is read from a verified private directory, Suite writers serialize AsyncStatus,
	// and the checked runId binds this typed artifact to the directory selected by the caller.
	return status as JsonObject & AsyncStatus;
}

/**
 * Read async job status from disk (with mtime-based caching)
 */
export function readStatus(asyncDir: string): AsyncStatus | null {
	const statusPath = path.join(asyncDir, "status.json");

	let snapshot: ReturnType<typeof readBoundedOwnedFileSnapshot>;
	try {
		assertPrivateDirectory(asyncDir);
		if (fs.realpathSync(asyncDir) !== path.resolve(asyncDir))
			throw new Error(`Async run directory '${asyncDir}' contains a redirected path component.`);
		snapshot = readBoundedOwnedFileSnapshot(statusPath, MAX_ASYNC_STATUS_FILE_BYTES);
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw new Error(`Failed to inspect async status file '${statusPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
	const cached = statusCache.get(statusPath);
	if (
		cached &&
		cached.mtime === snapshot.mtimeMs &&
		cached.ctime === snapshot.ctimeMs &&
		cached.size === snapshot.size &&
		cached.ino === snapshot.ino &&
		cached.dev === snapshot.dev
	) {
		return cached.status;
	}

	let parsed: JsonValue;
	try {
		parsed = parseJsonValue(snapshot.text);
	} catch (error) {
		throw new Error(`Failed to parse async status file '${statusPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
	const status = asyncStatusForRun(parsed, statusPath, path.basename(asyncDir));

	statusCache.set(statusPath, {
		mtime: snapshot.mtimeMs,
		ctime: snapshot.ctimeMs,
		size: snapshot.size,
		ino: snapshot.ino,
		dev: snapshot.dev,
		status,
	});
	if (statusCache.size > 50) {
		const firstKey = statusCache.keys().next().value;
		if (firstKey) statusCache.delete(firstKey);
	}
	return status;
}

/** Read one persisted Agent status without performing filesystem work on the Host event-loop thread. */
export async function readStatusAsync(asyncDir: string): Promise<AsyncStatus | null> {
	const statusPath = path.join(asyncDir, "status.json");
	let snapshot: Awaited<ReturnType<typeof readBoundedOwnedFileSnapshotAsync>>;
	try {
		const directoryStat = await fs.promises.lstat(asyncDir);
		assertPrivateDirectory(asyncDir, directoryStat);
		if ((await fs.promises.realpath(asyncDir)) !== path.resolve(asyncDir)) {
			throw new Error(`Async run directory '${asyncDir}' contains a redirected path component.`);
		}
		snapshot = await readBoundedOwnedFileSnapshotAsync(statusPath, MAX_ASYNC_STATUS_FILE_BYTES);
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw new Error(`Failed to inspect async status file '${statusPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
	const cached = statusCache.get(statusPath);
	if (
		cached &&
		cached.mtime === snapshot.mtimeMs &&
		cached.ctime === snapshot.ctimeMs &&
		cached.size === snapshot.size &&
		cached.ino === snapshot.ino &&
		cached.dev === snapshot.dev
	) {
		return cached.status;
	}

	let parsed: JsonValue;
	try {
		parsed = parseJsonValue(snapshot.text);
	} catch (error) {
		throw new Error(`Failed to parse async status file '${statusPath}': ${getErrorMessage(error)}`, {
			cause: error instanceof Error ? error : undefined,
		});
	}
	const status = asyncStatusForRun(parsed, statusPath, path.basename(asyncDir));
	statusCache.set(statusPath, {
		mtime: snapshot.mtimeMs,
		ctime: snapshot.ctimeMs,
		size: snapshot.size,
		ino: snapshot.ino,
		dev: snapshot.dev,
		status,
	});
	if (statusCache.size > 50) {
		const firstKey = statusCache.keys().next().value;
		if (firstKey) statusCache.delete(firstKey);
	}
	return status;
}

/**
 * Get human-readable last activity time for a file
 */
export function getLastActivity(outputFile: string | undefined): string {
	if (!outputFile) return "";
	try {
		const stat = fs.statSync(outputFile);
		const ago = Date.now() - stat.mtimeMs;
		if (ago < 1000) return "active now";
		if (ago < 60000) return `active ${Math.floor(ago / 1000)}s ago`;
		return `active ${Math.floor(ago / 60000)}m ago`;
	} catch {
		// Last-activity text is best effort; missing files should simply omit the hint.
		return "";
	}
}

/**
 * Find the latest session file in a directory
 */
export function findLatestSessionFile(sessionDir: string): string | null {
	if (!fs.existsSync(sessionDir)) return null;
	const files = fs
		.readdirSync(sessionDir)
		.filter((f) => f.endsWith(".jsonl"))
		.map((f) => {
			const filePath = path.join(sessionDir, f);
			return {
				path: filePath,
				mtime: fs.statSync(filePath).mtimeMs,
			};
		})
		.sort((a, b) => b.mtime - a.mtime);
	return files[0]?.path ?? null;
}

// ============================================================================
// Message Parsing Utilities
// ============================================================================

/**
 * Get the final text output from a list of messages
 */
export function getFinalOutput(messages: readonly { role?: string; content?: unknown }[]): string {
	const validTextParts: string[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || !isRuntimeObject(msg) || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
		const hasAssistantError =
			("errorMessage" in msg && isRuntimeString(msg.errorMessage) && msg.errorMessage.length > 0) ||
			("stopReason" in msg && msg.stopReason === "error");
		if (hasAssistantError) continue;
		const messageText = msg.content
			.filter(
				(part) =>
					part !== null &&
					isRuntimeObject(part) &&
					part.type === "text" &&
					isRuntimeString(part.text) &&
					part.text.trim().length > 0,
			)
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("\n");
		for (let j = msg.content.length - 1; j >= 0; j--) {
			const part = msg.content[j];
			if (
				!part ||
				!isRuntimeObject(part) ||
				part.type !== "text" ||
				!isRuntimeString(part.text) ||
				part.text.trim().length === 0
			)
				continue;
			validTextParts.push(part.text);
			if (/```acceptance[-_]report\s*\n[\s\S]*?```/i.test(part.text)) return messageText;
			for (const match of part.text.matchAll(/```(?:json|jsonc|json5)\s*\n([\s\S]*?)```/gi)) {
				const body = match[1] ?? "";
				if (
					/"(?:criteriaSatisfied|criteria_satisfied)"/.test(body) &&
					/"(?:changedFiles|changed_files|testsAddedOrUpdated|tests_added_or_updated|commandsRun|commands_run|validationOutput|validation_output|residualRisks|residual_risks|noStagedFiles|no_staged_files|diffSummary|diff_summary|reviewFindings|review_findings|manualNotes|manual_notes)"/.test(
						body,
					)
				) {
					return messageText;
				}
			}
			if (/ACCEPTANCE_REPORT\s*:/i.test(part.text)) return messageText;
		}
	}
	return validTextParts[0] ?? "";
}

export function getSingleResultOutput(result: Pick<SingleResult, "finalOutput" | "messages">): string {
	return result.finalOutput ?? getFinalOutput(result.messages ?? []);
}

/**
 * Extract display items (text and tool calls) from messages
 */
export function getDisplayItems(messages: Message[] | undefined): DisplayItem[] {
	if (!messages || messages.length === 0) return [];
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg && isRuntimeObject(msg) && msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (!part || !isRuntimeObject(part)) continue;
				if (part.type === "text" && isRuntimeString(part.text)) items.push({ type: "text", text: part.text });
				else if (
					part.type === "toolCall" &&
					isRuntimeString(part.name) &&
					part.arguments !== null &&
					isJsonInputValue(part.arguments) &&
					isRuntimeObject(part.arguments) &&
					!Array.isArray(part.arguments)
				)
					items.push({ type: "tool", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

function compactCompletedProgress(progress: AgentProgress): AgentProgress {
	if (progress.status === "running") return progress;
	const compacted: AgentProgress = {
		index: progress.index,
		agent: progress.agent,
		status: progress.status,
		task: progress.task,
		toolCount: progress.toolCount,
		tokens: progress.tokens,
		durationMs: progress.durationMs,
		recentTools: [],
		recentOutput: [],
	};
	if (progress.activityState !== undefined) compacted.activityState = progress.activityState;
	if (progress.skills !== undefined) compacted.skills = progress.skills;
	if (progress.error !== undefined) compacted.error = progress.error;
	if (progress.failedTool !== undefined) compacted.failedTool = progress.failedTool;
	return compacted;
}

function extractToolCallSummaries(messages: Message[] | undefined): ToolCallSummary[] {
	if (!messages?.length) return [];
	const summaries: ToolCallSummary[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type !== "toolCall") continue;
			const args =
				isJsonInputValue(part.arguments) &&
				isRuntimeObject(part.arguments) &&
				part.arguments !== null &&
				!Array.isArray(part.arguments)
					? part.arguments
					: {};
			summaries.push({
				text: formatToolCall(part.name, args),
				expandedText: formatToolCall(part.name, args, true),
			});
		}
	}
	return summaries;
}

export function sumResultsUsage(results: SingleResult[]): Usage {
	const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const result of results) {
		usage.input += result.usage.input;
		usage.output += result.usage.output;
		usage.cacheRead += result.usage.cacheRead;
		usage.cacheWrite += result.usage.cacheWrite;
		usage.cost += result.usage.cost;
		usage.turns += result.usage.turns;
	}
	return usage;
}

function addNestedCost(total: NonNullable<Details["totalCost"]>, children: NestedRunSummary[] | undefined): void {
	for (const child of children ?? []) {
		if (child.totalCost) {
			total.inputTokens += child.totalCost.inputTokens;
			total.outputTokens += child.totalCost.outputTokens;
			total.costUsd += child.totalCost.costUsd;
			continue;
		}
		addNestedCost(total, child.children);
		for (const step of child.steps ?? []) addNestedCost(total, step.children);
	}
}

/** Sum input tokens, output tokens, and cost across a set of SingleResults. */
export function sumResultsCost(results: SingleResult[]): NonNullable<Details["totalCost"]> {
	const total = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
	for (const result of results) {
		total.inputTokens += result.usage.input;
		total.outputTokens += result.usage.output;
		total.costUsd += result.usage.cost;
		addNestedCost(total, result.children);
	}
	return total;
}

export function compactForegroundResult(result: SingleResult): SingleResult {
	if (result.progress?.status === "running") return result;
	const toolCalls = result.toolCalls?.length ? result.toolCalls : extractToolCallSummaries(result.messages);
	const compacted = { ...result };
	delete compacted.messages;
	delete compacted.progress;
	delete compacted.toolCalls;
	if (toolCalls.length) compacted.toolCalls = toolCalls;
	return compacted;
}

export function compactForegroundDetails(details: Details): Details {
	const compacted: Details = {
		...details,
		results: details.results.map(compactForegroundResult),
	};
	delete compacted.progress;
	if (details.progress) compacted.progress = details.progress.map(compactCompletedProgress);
	return compacted;
}

/**
 * Streaming counterparts to compactForegroundResult / compactCompletedProgress.
 *
 * The completed-compaction helpers above bail out while a child is still
 * `running`, so a long or deeply nested fan-out streams full, unbounded progress on
 * every tick. Pi serializes each streamed `tool_execution_update` as a single
 * child-stdout line, which the parent reads under `MAX_CHILD_PENDING_LINE_BYTES`;
 * an unbounded running snapshot can cross that cap and kill the child with
 * `protocol_output_limit`.
 *
 * These bound the STREAMED snapshot only. The final returned result keeps the full
 * live progress and message transcript, and every live-display consumer already
 * reads just the last few entries (`recentTools.slice(-3)`, `recentOutput.slice(-5)`).
 */
export const MAX_STREAMED_RECENT_TOOLS = 32;
export const MAX_STREAMED_TOOL_CALLS = 64;
export const MAX_STREAMED_OUTPUT_LINE_CHARS = 2000;

/** Keep only the most recent tool-history entries in a streamed snapshot. */
export function boundStreamedRecentTools(recentTools: AgentProgress["recentTools"]): AgentProgress["recentTools"] {
	return recentTools.slice(-MAX_STREAMED_RECENT_TOOLS).map((tool) => ({ ...tool }));
}

/** Cap per-line length of recent output so one long line can't inflate a snapshot. */
export function boundStreamedRecentOutput(recentOutput: string[]): string[] {
	return recentOutput.map((line) => boundTerminalLine(line, MAX_STREAMED_OUTPUT_LINE_CHARS, "… [truncated]"));
}

/**
 * Compact tool-call summaries for a streamed snapshot, standing in for the
 * unbounded `messages` transcript. Prefers an existing `toolCalls` summary, else
 * derives one from `messages`; bounded to the most recent calls.
 */
export function boundStreamedToolCalls(
	result: Pick<SingleResult, "toolCalls" | "messages">,
): ToolCallSummary[] | undefined {
	const summaries = result.toolCalls?.length ? result.toolCalls : extractToolCallSummaries(result.messages);
	if (!summaries.length) return undefined;
	return summaries.slice(-MAX_STREAMED_TOOL_CALLS).map((summary) => ({ ...summary }));
}

export function hasEmptyTerminalAssistantResponse(messages: Message[]): boolean {
	const lastAssistant = messages.findLast(
		(message) => message !== null && isRuntimeObject(message) && message.role === "assistant",
	);
	return (
		lastAssistant !== undefined &&
		lastAssistant.role === "assistant" &&
		Array.isArray(lastAssistant.content) &&
		lastAssistant.content.length === 0 &&
		(!lastAssistant.usage || !isRuntimeObject(lastAssistant.usage) || lastAssistant.usage.output === 0)
	);
}

/**
 * Detect errors in subagent execution from messages (only errors with no subsequent success)
 */
export function detectSubagentError(messages: Message[]): ErrorInfo {
	let lastAssistantTextIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg && isRuntimeObject(msg) && msg.role === "assistant") {
			const hasText =
				Array.isArray(msg.content) &&
				msg.content.some(
					(c) =>
						c !== null &&
						isRuntimeObject(c) &&
						c.type === "text" &&
						"text" in c &&
						isRuntimeString(c.text) &&
						c.text.trim().length > 0,
				);
			if (hasText) {
				lastAssistantTextIndex = i;
				break;
			}
		}
	}

	const scanStart = lastAssistantTextIndex >= 0 ? lastAssistantTextIndex + 1 : 0;

	for (let i = messages.length - 1; i >= scanStart; i--) {
		const msg = messages[i];
		if (!msg || !isRuntimeObject(msg) || msg.role !== "toolResult" || !Array.isArray(msg.content)) continue;
		const toolName = "toolName" in msg && isRuntimeString(msg.toolName) ? msg.toolName : undefined;
		const isError = "isError" in msg && msg.isError === true;

		if (!isError) continue;

		const text = msg.content.find(
			(c) => c !== null && isRuntimeObject(c) && c.type === "text" && isRuntimeString(c.text),
		);
		const details = text && "text" in text && isRuntimeString(text.text) ? text.text : undefined;
		const exitMatch = details?.match(/exit(?:ed)?\s*(?:with\s*)?(?:code|status)?\s*[:\s]?\s*(\d+)/i);
		const error: ErrorInfo = {
			hasError: true,
			exitCode: exitMatch?.[1] ? parseInt(exitMatch[1], 10) : 1,
			errorType: toolName || "tool",
		};
		if (details !== undefined) error.details = details.slice(0, 200);
		return error;
	}

	return { hasError: false };
}

/**
 * Extract a preview of tool arguments for display
 */
export function extractToolArgsPreview(args: ToolArguments): string {
	const truncatePreview = (value: string, maximumWidth: number): string =>
		boundTerminalLine(value, maximumWidth, "...");

	const stringifyPreviewValue = <Value>(value: Value): string | undefined => {
		if (isRuntimeString(value) && value.trim().length > 0) return value;
		if (isRuntimeNumber(value) || isRuntimeBoolean(value)) return String(value);
		return undefined;
	};

	const previewArray = <Value>(value: Value): string | undefined => {
		if (!Array.isArray(value) || value.length === 0) return undefined;
		const first = stringifyPreviewValue(value[0]);
		if (!first) return undefined;
		const suffix = value.length > 1 ? ` (+${value.length - 1} more)` : "";
		return `${first}${suffix}`;
	};

	// Handle MCP tool calls - show server/tool info
	if (args["tool"] && isRuntimeString(args["tool"])) {
		const server = args["server"] && isRuntimeString(args["server"]) ? `${args["server"]}/` : "";
		const toolArgs = args["args"] && isRuntimeString(args["args"]) ? ` ${truncatePreview(args["args"], 40)}` : "";
		return `${server}${args["tool"]}${toolArgs}`;
	}

	const queriesPreview = previewArray(args["queries"]);
	if (queriesPreview) return truncatePreview(queriesPreview, 60);
	if (isRuntimeString(args["query"]) && args["query"].trim().length > 0) return truncatePreview(args["query"], 60);

	if (isRuntimeString(args["url"]) && args["url"].trim().length > 0) return truncatePreview(args["url"], 60);
	const urlsPreview = previewArray(args["urls"]);
	if (urlsPreview) return truncatePreview(urlsPreview, 60);
	if (isRuntimeString(args["prompt"]) && args["prompt"].trim().length > 0) return truncatePreview(args["prompt"], 60);

	const previewKeys = ["command", "path", "file_path", "pattern", "query", "url", "task", "describe", "search"];
	for (const key of previewKeys) {
		const value = args[key];
		if (value && isRuntimeString(value)) return truncatePreview(value, 60);
	}

	// Fallback: show first string value found
	for (const [key, value] of Object.entries(args)) {
		const arrayPreview = previewArray(value);
		if (arrayPreview) return `${key}=${truncatePreview(arrayPreview, 50)}`;
		if (isRuntimeString(value) && value.length > 0) {
			const preview = truncatePreview(value, 50);
			return `${key}=${preview}`;
		}
	}
	return "";
}

/**
 * Extract text content from various message content formats
 */
export function extractTextFromContent<Content>(content: Content): string {
	if (!content) return "";
	// Handle string content directly
	if (isRuntimeString(content)) return content;
	// Handle array content
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const part of content) {
		if (part && isRuntimeObject(part)) {
			// Handle { type: "text", text: "..." }
			if ("type" in part && part.type === "text" && "text" in part) {
				texts.push(String(part.text));
			}
			// Handle { type: "tool_result", content: "..." }
			else if ("type" in part && part.type === "tool_result" && "content" in part) {
				const inner = extractTextFromContent(part.content);
				if (inner) texts.push(inner);
			}
			// Handle { text: "..." } without type
			else if ("text" in part) {
				texts.push(String(part.text));
			}
		}
	}
	return texts.join("\n");
}

// ============================================================================
// Concurrency Utilities
// ============================================================================

export { mapConcurrent } from "../runs/shared/parallel-utils.ts";
