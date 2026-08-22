import { isJsonInputObject, type JsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeNumber } from "../../shared/runtime-type.js";
import { isRuntimeBigInt, isRuntimeFunction, isRuntimeObject, isRuntimeString, isRuntimeSymbol } from "../../shared/runtime-type.js";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { formatWithOptions } from "node:util";
import { Worker } from "node:worker_threads";
import { guardMcpOutput, guardedMcpDetails, resolveMcpOutputGuardOptions } from "./mcp-output-guard.ts";
import { executeCall } from "./proxy-modes.ts";
import { combineAbortSignals } from "./runtime-owner.ts";
import { paginate, rankSuggestions, rankToolMatches } from "./search-ranking.ts";
import type { McpExtensionState } from "./state.ts";
import { findToolByName } from "./tool-metadata.ts";
import { renderTsType } from "./ts-shape.ts";
import type { ContentBlock } from "./types.ts";

export const DEFAULT_MCP_SCRIPT_TIMEOUT_MS = 30_000;

class McpScriptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`mcp_script timed out after ${timeoutMs}ms`);
    this.name = "McpScriptTimeoutError";
  }
}

interface SearchInput extends JsonInputObject {
	limit?: JsonInputValue;
	offset?: JsonInputValue;
	query?: JsonInputValue;
	server?: JsonInputValue;
}

interface DescribeInput extends JsonInputObject {
	path?: JsonInputValue;
}
type WorkerMessage =
  | { type: "emit"; block: JsonInputValue }
	  | { type: "call"; id: number; path: string; args?: JsonInputObject }
	  | { type: "search"; id: number; input?: SearchInput }
	  | { type: "describe"; id: number; input?: DescribeInput }
  | { type: "done"; returnBlock?: JsonInputValue }
  | { type: "error"; message: string };

type WorkerResultMessage = { type: "result"; id: number; envelope: JsonInputValue };

function needsInspectableFormatting(value: JsonInputValue, stack = new WeakSet<object>()): boolean {
  if (value === undefined || isRuntimeBigInt(value) || isRuntimeFunction(value) || isRuntimeSymbol(value)) return true;
  if (!isRuntimeObject(value) || value === null) return false;
  if (stack.has(value)) return true;
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) return true;
  stack.add(value);
  try {
    return Object.values(value).some((entry) => needsInspectableFormatting(entry, stack));
  } finally {
    stack.delete(value);
  }
}

function formatValue(value: JsonInputValue): string {
  if (isRuntimeString(value)) return value;
  try {
    if (!needsInspectableFormatting(value)) {
      const json = JSON.stringify(value, null, 2);
      if (json !== undefined) return json;
    }
    return formatWithOptions({ colors: false, depth: 6 }, value);
  } catch {
    return "[unserializable value]";
  }
}

function toContentBlock(value: JsonInputValue): ContentBlock {
  if (isRuntimeObject(value) && value !== null) {
	    if (!isJsonInputObject(value)) return { type: "text", text: formatValue(value) };
	    if (value.type === "text" && isRuntimeString(value.text)) {
	      return { type: "text", text: value.text };
	    }
	    if (value.type === "image" && isRuntimeString(value.data) && isRuntimeString(value.mimeType)) {
	      return { type: "image", data: value.data, mimeType: value.mimeType };
    }
  }
  return { type: "text", text: formatValue(value) };
}

function textFromContent(content: ContentBlock[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function abortReasonError(reason: JsonInputValue): Error {
  return reason instanceof Error ? reason : new Error(String(reason ?? "MCP request aborted"));
}

function parseWorkerMessage(value: JsonInputValue): WorkerMessage | null {
	  if (!isJsonInputObject(value)) return null;
	  if (value.type === "emit" && "block" in value) return { type: "emit", block: value.block };
	  if (value.type === "call" && isRuntimeNumber(value.id) && isRuntimeString(value.path)) {
	    if (!("args" in value)) return { type: "call", id: value.id, path: value.path };
	    if (!isJsonInputObject(value.args)) return null;
	    return { type: "call", id: value.id, path: value.path, args: value.args };
	  }
	  if ((value.type === "search" || value.type === "describe") && isRuntimeNumber(value.id)) {
	    if (!("input" in value)) return { type: value.type, id: value.id };
	    if (!isJsonInputObject(value.input)) return null;
	    return { type: value.type, id: value.id, input: value.input };
	  }
	  if (value.type === "done") {
	    return "returnBlock" in value ? { type: "done", returnBlock: value.returnBlock } : { type: "done" };
	  }
	  if (value.type === "error" && isRuntimeString(value.message)) {
	    return { type: "error", message: value.message };
  }
  return null;
}

export async function runMcpScript(
  state: McpExtensionState,
  code: string,
  timeoutMs = DEFAULT_MCP_SCRIPT_TIMEOUT_MS,
  getPiTools?: () => ToolInfo[],
  signal?: AbortSignal,
) {
  const resolvedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : DEFAULT_MCP_SCRIPT_TIMEOUT_MS;
  const output: ContentBlock[] = [];
  const externalSignal = combineAbortSignals(state.owner?.signal, signal);
  const timeoutController = new AbortController();
  const callSignal = combineAbortSignals(externalSignal, timeoutController.signal);

  type ScriptOperation =
    | { operation: "call"; path: string; ok: true; durationMs: number }
    | { operation: "call"; path: string; ok: false; error: string; durationMs: number }
    | { operation: "search"; query: string; ok: true; durationMs: number }
    | { operation: "search"; query: string; ok: false; error: string; durationMs: number }
    | { operation: "describe"; path: string; ok: true; durationMs: number }
    | { operation: "describe"; path: string; ok: false; error: string; durationMs: number };
  type TrackedScriptOperation = ScriptOperation & { startedAt: number };
  const calls: TrackedScriptOperation[] = [];
  const snapshotCalls = (): ScriptOperation[] => calls.map(({ startedAt, ...operation }) => ({
    ...operation,
    durationMs: "error" in operation && operation.error === "incomplete"
      ? Math.max(0, Date.now() - startedAt)
      : operation.durationMs,
  }));
  let callsSnapshot: ScriptOperation[] | undefined;
  const callTool = async (path: string, args?: JsonInputObject) => {
    // Record before dispatch so calls still in flight at timeout/abort appear in the trace.
    const startedAt = Date.now();
    const index = calls.push({ operation: "call", path, ok: false, error: "incomplete", durationMs: 0, startedAt }) - 1;
    const result = await executeCall(state, path, args, undefined, getPiTools, callSignal);
    const details = result.details;
    if (details.error !== undefined) {
      const errorCode = String(details.error);
      const suggestions = Array.isArray(details.suggestions)
        ? details.suggestions.filter((suggestion): suggestion is string => isRuntimeString(suggestion))
        : [];
      const message = errorCode === "tool_not_found"
        ? `Tool "${path}" not found. Use await tools.search({ query: "..." }) inside mcp_script.${suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}` : ""}`
        : isRuntimeString(details.message)
          ? details.message
          : textFromContent(result.content);
      calls[index] = { operation: "call", path, ok: false, error: errorCode, durationMs: Date.now() - startedAt, startedAt };
      return {
        ok: false as const,
        error: { code: errorCode, message },
      };
    }
    calls[index] = { operation: "call", path, ok: true, durationMs: Date.now() - startedAt, startedAt };
    return {
      ok: true as const,
      data: details.mcpResult !== undefined ? details.mcpResult : textFromContent(result.content),
    };
  };

  const searchTools = (input?: SearchInput) => {
    const startedAt = Date.now();
    const query = isRuntimeString(input?.query) ? input.query : "";
    let error: JsonInputValue;
    try {
      if (query.trim() === "") {
        return { items: [], total: 0, hasMore: false, nextOffset: null };
      }
      const server = isRuntimeString(input.server) ? input.server : undefined;
      const limit = isRuntimeNumber(input.limit) ? input.limit : 12;
      const offset = isRuntimeNumber(input.offset) ? input.offset : 0;
      const page = paginate(rankToolMatches(state, query, server), offset, limit);
      return {
        ...page,
	        items: page.items.map(({ server: matchServer, tool, score }) => {
	          const item = { path: tool.name, name: tool.originalName, server: matchServer, score };
	          if (tool.description) Object.assign(item, { description: tool.description });
	          return item;
	        }),
      };
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      calls.push(error === undefined
        ? { operation: "search", query, ok: true, durationMs: Date.now() - startedAt, startedAt }
        : { operation: "search", query, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt, startedAt });
    }
  };

  const describeTool = (input?: DescribeInput) => {
    const startedAt = Date.now();
    const path = isRuntimeString(input?.path) ? input.path : "";
    let error: JsonInputValue;
    try {
      for (const [server, metadata] of state.toolMetadata) {
        const tool = findToolByName(metadata, path);
        if (!tool) continue;
        const inputTypeScript = tool.inputSchema ? renderTsType(tool.inputSchema) : null;
	        const description = {
	          path: tool.name,
	          name: tool.originalName,
	          server,
	        };
	        if (tool.description) Object.assign(description, { description: tool.description });
	        if (inputTypeScript) Object.assign(description, { inputTypeScript });
	        return description;
      }
      const suggestions = path ? rankSuggestions(state, path, 5) : [];
      error = "tool_not_found";
      return {
        path,
        error: {
          code: "tool_not_found",
          message: `Tool not found: ${path}`,
          suggestions,
        },
      };
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      calls.push(error === undefined
        ? { operation: "describe", path, ok: true, durationMs: Date.now() - startedAt, startedAt }
        : { operation: "describe", path, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt, startedAt });
    }
  };

  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = () => {};
  let errorCode: "timeout" | "aborted" | "script_error" | undefined;
  let errorMessage: string | undefined;

  try {
    if (externalSignal?.aborted) {
      throw abortReasonError(externalSignal.reason);
    }

    worker = new Worker(new URL("./mcp-script-worker.mjs", import.meta.url), {
      workerData: { code },
      env: {},
    });
    const activeWorker = worker;
    const execution = new Promise<void>((resolve, reject) => {
      let completed = false;
      activeWorker.on("message", (value: JsonInputValue) => {
        const message = parseWorkerMessage(value);
        if (!message || completed) return;
        if (message.type === "emit") {
          output.push(toContentBlock(message.block));
          return;
        }
        if (message.type === "done") {
          completed = true;
          if ("returnBlock" in message) output.push(toContentBlock(message.returnBlock));
          resolve();
          return;
        }
        if (message.type === "error") {
          completed = true;
          reject(new Error(message.message));
          return;
        }

        void (async () => {
	          let envelope: JsonInputValue;
	          if (message.type === "call") {
	            envelope = await callTool(message.path, message.args);
	          } else if (message.type === "search") {
	            envelope = searchTools(message.input);
	          } else {
	            envelope = describeTool(message.input);
          }
          const response: WorkerResultMessage = { type: "result", id: message.id, envelope };
          activeWorker.postMessage(response);
        })().catch(reject);
      });
      activeWorker.once("error", reject);
      activeWorker.once("exit", (code) => {
        if (!completed && code !== 0) reject(new Error(`mcp_script worker exited with code ${code}`));
      });
    });
    const timeoutError = new McpScriptTimeoutError(resolvedTimeoutMs);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        callsSnapshot = snapshotCalls();
        timeoutController.abort(timeoutError);
        void activeWorker.terminate();
        reject(timeoutError);
      }, resolvedTimeoutMs);
    });
    const aborted = externalSignal
      ? new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            callsSnapshot = snapshotCalls();
            void activeWorker.terminate();
            reject(abortReasonError(externalSignal.reason));
          };
          externalSignal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => externalSignal.removeEventListener("abort", onAbort);
        })
      : new Promise<never>(() => {});

    await Promise.race([execution, timeout, aborted]);
  } catch (error) {
    if (error instanceof McpScriptTimeoutError) {
      errorCode = "timeout";
      errorMessage = `mcp_script timed out after ${resolvedTimeoutMs}ms`;
    } else if (externalSignal?.aborted) {
      errorCode = "aborted";
      errorMessage = error instanceof Error ? error.message : String(error);
    } else {
      errorCode = "script_error";
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    output.push({ type: "text", text: errorMessage });
  } finally {
    clearTimeout(timer);
    removeAbortListener();
    // "incomplete" means the call had not settled when the script finished
    // (deadline, abort, or early return). Snapshot before aborting stragglers.
    callsSnapshot ??= snapshotCalls();
    // A script may finish without awaiting every call; abort leftovers so
    // parent-side dispatches do not outlive the script.
    timeoutController.abort(new Error("mcp_script finished"));
    await worker?.terminate();
  }

  // Snapshot before the asynchronous output guard; the terminated worker can no longer emit.
  const guarded = await guardMcpOutput(
    output.length > 0 ? [...output] : [{ type: "text", text: "(no output)" }],
    resolveMcpOutputGuardOptions(state.config.settings),
  );
	  const details = {
	    mode: "script",
	    timeoutMs: resolvedTimeoutMs,
	    ...guardedMcpDetails(guarded),
	  };
	  if (errorCode) Object.assign(details, { error: errorCode, message: errorMessage });
	  if (callsSnapshot.length > 0) Object.assign(details, { calls: callsSnapshot });
	  return {
	    content: guarded.content,
	    details,
	  };
}
