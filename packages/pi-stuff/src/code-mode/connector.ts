import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	isRuntimeBigInt,
	isRuntimeBoolean,
	isRuntimeFunction,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
	isRuntimeSymbol,
	isRuntimeUndefined,
} from "../shared/runtime-type.js";
import type {
	SuiteToolCodeModeExecutionEndStatus,
	SuiteToolCodeModeLifecycle,
	SuiteToolCodeModePassEndStatus,
	SuiteToolDefinitionRegistry,
} from "../tool-display/contract.js";
import type { ConnectorDescription } from "./cloudflare/connector-types.js";
import { describeTarget } from "./cloudflare/describe.js";
import { normalizeCode } from "./cloudflare/normalize.js";
import { searchConnectors } from "./cloudflare/search.js";
import type { Snippet } from "./cloudflare/snippet.js";
import type { SandboxToolExecutionContext, SuiteSandboxTool } from "./protocol.js";

const INTERNAL_DESCRIBE_TOOL = "__pi_stuff_codemode_describe_v1";
const INTERNAL_SEARCH_TOOL = "__pi_stuff_codemode_search_v1";
export const INTERNAL_STEP_DECIDE_TOOL = "__pi_stuff_codemode_step_decide_v1";
export const INTERNAL_STEP_RECORD_TOOL = "__pi_stuff_codemode_step_record_v1";

export interface SuiteSandboxCatalogEntry {
	readonly description: string;
	readonly inputSchema: unknown;
	readonly name: string;
	readonly replay?: "never" | "record" | "reexecute";
	readonly requiresApproval?: boolean;
}

function identifier(value: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value);
}

function toolPath(name: string): string {
	return identifier(name) ? `tools.${name}` : `tools[${JSON.stringify(name)}]`;
}

function oneLine(value: string): string {
	return value.replaceAll(/\s+/gu, " ").trim();
}

function toolErrorMessage(result: AgentToolResult<unknown>, fallback: string): string {
	for (const item of result.content) {
		if (item.type === "text" && item.text.trim()) return item.text.trim();
	}
	return fallback;
}

export class SuiteToolInvocationError extends Error {
	readonly result: AgentToolResult<unknown>;

	constructor(message: string, result: AgentToolResult<unknown>) {
		super(message);
		this.name = "SuiteToolInvocationError";
		this.result = result;
	}
}

function describeReceivedValue(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (isRuntimeBigInt(value)) return "bigint";
	if (isRuntimeBoolean(value)) return "boolean";
	if (isRuntimeFunction(value)) return "function";
	if (isRuntimeNumber(value)) return "number";
	if (isRuntimeString(value)) return "string";
	if (isRuntimeSymbol(value)) return "symbol";
	if (isRuntimeUndefined(value)) return "undefined";
	return "object";
}

function invalidResult(name: string, path: string, expected: string, received: unknown): never {
	throw new Error(
		`Code Mode Tool ${JSON.stringify(name)} returned an invalid result at ${path}: expected ${expected}; received ${describeReceivedValue(received)}; retry safe: false`,
	);
}

/** Cloudflare-compatible MCP/Pi result unwrapping with a strict content boundary. */
export function unwrapSuiteToolResult(name: string, result: unknown): unknown {
	if (!isRuntimeObject(result) || result === null) invalidResult(name, "result", "an object", result);
	const record = result as AgentToolResult<unknown> & {
		readonly structuredContent?: unknown;
		readonly toolResult?: unknown;
	};
	if (record.toolResult !== undefined) return record.toolResult;
	if (record.structuredContent != null) return record.structuredContent;
	const content: unknown = record.content;
	if (!Array.isArray(content)) invalidResult(name, "result.content", "an array", content);
	for (const [index, item] of content.entries()) {
		if (!isRuntimeObject(item) || item === null) {
			invalidResult(name, `result.content[${String(index)}]`, "a content object", item);
		}
		const block = item as Record<string, unknown>;
		if (block["type"] === "text" && !isRuntimeString(block["text"])) {
			invalidResult(name, `result.content[${String(index)}].text`, "a string", block["text"]);
		}
		if (block["type"] === "image" && (!isRuntimeString(block["data"]) || !isRuntimeString(block["mimeType"]))) {
			invalidResult(name, `result.content[${String(index)}]`, "base64 image data and a MIME type", item);
		}
		if (block["type"] !== "text" && block["type"] !== "image") {
			invalidResult(name, `result.content[${String(index)}].type`, '"text" or "image"', block["type"]);
		}
	}
	if (content.length === 0 || !content.every((item) => (item as Record<string, unknown>)["type"] === "text")) {
		return record;
	}
	const text = content.map((item) => String((item as Record<string, unknown>)["text"])).join("\n");
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export class SuiteCodeModeConnector {
	readonly registry: SuiteToolDefinitionRegistry;

	constructor(registry: SuiteToolDefinitionRegistry) {
		this.registry = registry;
	}

	catalog(): SuiteSandboxCatalogEntry[] {
		return this.registry
			.catalog()
			.filter((entry) => this.registry.isActive(entry.definition.name))
			.map((entry) => {
				if (entry.codeMode?.requiresApproval && entry.codeMode.replay === "reexecute") {
					throw new Error(
						`Code Mode Tool ${JSON.stringify(entry.definition.name)} cannot combine requiresApproval with replay: reexecute`,
					);
				}
				return {
					description: oneLine(entry.definition.description),
					inputSchema: entry.definition.parameters,
					name: entry.definition.name,
					replay: entry.codeMode?.replay ?? "never",
					...(entry.codeMode?.requiresApproval ? { requiresApproval: true } : {}),
				};
			});
	}

	describe(target: string, snippets: readonly Snippet[] = []): ReturnType<typeof describeTarget> {
		return describeTarget(target, [this.connectorDescription()], [...snippets]);
	}

	search(query: string, snippets: readonly Snippet[] = []): ReturnType<typeof searchConnectors> {
		return searchConnectors(query, [this.connectorDescription()], [...snippets]);
	}

	async disposeExecution(executionId: string, status: SuiteToolCodeModeExecutionEndStatus): Promise<void> {
		await Promise.allSettled(
			this.lifecycles().map(async (lifecycle) => lifecycle.disposeExecution?.(executionId, status)),
		);
	}

	async onPassEnd(executionId: string, status: SuiteToolCodeModePassEndStatus): Promise<void> {
		await Promise.allSettled(this.lifecycles().map(async (lifecycle) => lifecycle.onPassEnd?.(executionId, status)));
	}

	tools(): SuiteSandboxTool[] {
		return this.catalog().map((entry) => ({
			description: entry.description,
			inputSchema: entry.inputSchema,
			name: entry.name,
			...(entry.replay ? { replay: entry.replay } : {}),
			...(entry.requiresApproval ? { requiresApproval: true } : {}),
			usage: `${toolPath(entry.name)}(input)`,
			invoke: (input, context, signal) => this.invoke(entry.name, input, context, signal),
		}));
	}

	runtimeTools(snippets: readonly Snippet[] = []): SuiteSandboxTool[] {
		return [
			...this.tools(),
			{
				description: "Search the active programmatic Tool catalog",
				inputSchema: {
					additionalProperties: false,
					properties: { query: { type: "string" } },
					required: ["query"],
					type: "object",
				},
				name: INTERNAL_SEARCH_TOOL,
				presentation: "hidden",
				replay: "record",
				usage: `${INTERNAL_SEARCH_TOOL}({ query })`,
				invoke: async (input) =>
					this.search(
						isRuntimeObject(input) && input !== null && "query" in input ? String(input.query) : "",
						snippets,
					),
			},
			{
				description: "Describe one active programmatic Tool or saved snippet",
				inputSchema: {
					additionalProperties: false,
					properties: { target: { type: "string" } },
					required: ["target"],
					type: "object",
				},
				name: INTERNAL_DESCRIBE_TOOL,
				presentation: "hidden",
				replay: "record",
				usage: `${INTERNAL_DESCRIBE_TOOL}({ target })`,
				invoke: async (input) =>
					this.describe(
						isRuntimeObject(input) && input !== null && "target" in input ? String(input.target) : "",
						snippets,
					),
			},
		];
	}

	private connectorDescription(): ConnectorDescription {
		return {
			annotations: Object.fromEntries(
				this.catalog().map((entry) => [
					entry.name,
					{
						...(entry.requiresApproval ? { requiresApproval: true } : {}),
						...(entry.replay === "reexecute" ? { replay: "reexecute" as const } : {}),
					},
				]),
			),
			descriptors: Object.fromEntries(
				this.catalog().map((entry) => [
					entry.name,
					{ description: entry.description, inputSchema: entry.inputSchema as never },
				]),
			),
			name: "tools",
		};
	}

	private lifecycles(): SuiteToolCodeModeLifecycle[] {
		return [
			...new Set(
				this.registry
					.catalog()
					.filter((entry) => this.registry.isActive(entry.definition.name))
					.flatMap((entry) => (entry.codeMode?.lifecycle ? [entry.codeMode.lifecycle] : [])),
			),
		];
	}

	private async invoke(
		name: string,
		input: unknown,
		context: SandboxToolExecutionContext,
		signal: AbortSignal,
	): Promise<unknown> {
		if (!context.extensionContext) throw new Error("Code Mode ExtensionContext is unavailable");
		if (!context.toolCallId) throw new Error("Code Mode nested Tool call ID is unavailable");
		const outcome = await this.registry.invoke({
			context: context.extensionContext,
			input,
			name,
			...(context.onUpdate ? { onUpdate: context.onUpdate } : {}),
			signal,
			toolCallId: context.toolCallId,
		});
		context.captureResult?.(outcome.result);
		if (outcome.isError)
			throw new SuiteToolInvocationError(toolErrorMessage(outcome.result, `${name} failed`), outcome.result);
		return unwrapSuiteToolResult(name, outcome.result);
	}
}

export function buildSuiteSandboxSource(
	source: string,
	catalog: readonly SuiteSandboxCatalogEntry[],
	snippets: readonly Snippet[] = [],
): string {
	const serialized = JSON.stringify(
		catalog.map((entry) => ({
			description: entry.description,
			inputSchema: entry.inputSchema,
			name: entry.name,
			path: toolPath(entry.name),
			...(entry.requiresApproval ? { requiresApproval: true } : {}),
		})),
	);
	const snippetEntries = snippets
		.map((snippet) => `[${JSON.stringify(snippet.name)},(${normalizeCode(snippet.code)})]`)
		.join(",");
	const program = normalizeCode(source);
	return `{
const __piStuffCatalog=${serialized};
const __piStuffSnippets=new Map([${snippetEntries}]);
const __piStuffBinaryTag="__codemode_binary_v1__";
const __piStuffBigintTag="__codemode_bigint_v1__";
const __piStuffBase64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const __piStuffToBase64=(bytes)=>{let output="";for(let index=0;index<bytes.length;index+=3){const first=bytes[index];const second=bytes[index+1];const third=bytes[index+2];output+=__piStuffBase64[first>>2]+__piStuffBase64[((first&3)<<4)|((second??0)>>4)]+(second===undefined?"=":__piStuffBase64[((second&15)<<2)|((third??0)>>6)])+(third===undefined?"=":__piStuffBase64[third&63]);}return output;};
const __piStuffFromBase64=(value)=>{let buffer=0,bits=0;const output=[];for(const character of value){if(character==="=")break;const digit=__piStuffBase64.indexOf(character);if(digit<0)throw new TypeError("Invalid Code Mode binary value");buffer=(buffer<<6)|digit;bits+=6;if(bits>=8){bits-=8;output.push((buffer>>bits)&255);}}return new Uint8Array(output);};
const __piStuffEncode=(value)=>{if(typeof value==="bigint")return {[__piStuffBigintTag]:value.toString()};if(value instanceof Uint8Array)return {[__piStuffBinaryTag]:"Uint8Array",data:__piStuffToBase64(value)};if(value instanceof ArrayBuffer)return {[__piStuffBinaryTag]:"ArrayBuffer",data:__piStuffToBase64(new Uint8Array(value))};if(ArrayBuffer.isView(value))return {[__piStuffBinaryTag]:"ArrayBufferView",data:__piStuffToBase64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};if(Array.isArray(value))return value.map(__piStuffEncode);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,nested])=>[key,__piStuffEncode(nested)]));return value;};
const __piStuffDecode=(value)=>{if(Array.isArray(value))return value.map(__piStuffDecode);if(!value||typeof value!=="object")return value;if(typeof value[__piStuffBigintTag]==="string")return BigInt(value[__piStuffBigintTag]);if(typeof value.data==="string"&&typeof value[__piStuffBinaryTag]==="string"){const bytes=__piStuffFromBase64(value.data);return value[__piStuffBinaryTag]==="ArrayBuffer"?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):bytes;}return Object.fromEntries(Object.entries(value).map(([key,nested])=>[key,__piStuffDecode(nested)]));};
const __piStuffRawTools=globalThis.tools;
const __piStuffToolCache=new Map();
globalThis.tools=new Proxy(__piStuffRawTools,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=="function")return value;if(!__piStuffToolCache.has(key))__piStuffToolCache.set(key,async(...args)=>__piStuffDecode(await value.apply(target,args.map(__piStuffEncode))));return __piStuffToolCache.get(key);}});
const __piStuffHost={text:globalThis.text,image:globalThis.image,generatedImage:globalThis.generatedImage,audio:globalThis.audio,notify:globalThis.notify};
let __piStuffOutputCount=0;
const __piStuffOutput=(name)=>(...args)=>{const helper=__piStuffHost[name];if(typeof helper!=="function")throw new Error("Unsupported Code Mode output helper: "+name);__piStuffOutputCount+=1;return helper(...args);};
const text=__piStuffOutput("text");
const image=__piStuffOutput("image");
const generatedImage=__piStuffOutput("generatedImage");
const audio=__piStuffOutput("audio");
const notify=__piStuffOutput("notify");
globalThis.suite=globalThis.tools;
globalThis.codemode={};
globalThis.codemode.search=(query)=>globalThis.tools.${INTERNAL_SEARCH_TOOL}({query:String(query??"")});
globalThis.codemode.describe=(target)=>globalThis.tools.${INTERNAL_DESCRIBE_TOOL}({target:String(target??"")});
globalThis.codemode.run=async(name,input)=>{const snippet=__piStuffSnippets.get(String(name));if(!snippet)return {error:"Snippet "+JSON.stringify(String(name))+" not found."};return await snippet(input);};
globalThis.codemode.step=async(name,fn)=>{if(typeof fn!=="function")throw new TypeError("codemode.step(name, fn) requires a function");const decision=await globalThis.tools.${INTERNAL_STEP_DECIDE_TOOL}({name:String(name)});if(decision.kind==="replay")return decision.result;if(decision.kind!=="execute")throw new Error("Code Mode step could not continue");const value=await fn();await globalThis.tools.${INTERNAL_STEP_RECORD_TOOL}({plan:decision.plan,value});return value;};
Object.freeze(globalThis.codemode);
const __piStuffProgram=(${program});
const __piStuffResult=await __piStuffProgram();
if(__piStuffOutputCount===0&&__piStuffResult!==undefined){
  if(__piStuffResult&&typeof __piStuffResult==="object"&&Array.isArray(__piStuffResult.content)){
    for(const item of __piStuffResult.content){
      if(item?.type==="text"&&typeof item.text==="string")text(item.text);
      else if(item?.type==="image"&&typeof item.data==="string"&&typeof item.mimeType==="string")image({image_url:"data:"+item.mimeType+";base64,"+item.data});
    }
  }else{
    let value;
    try{value=typeof __piStuffResult==="string"?__piStuffResult:JSON.stringify(__piStuffEncode(__piStuffResult));}catch{throw new TypeError("Code Mode returned a value that is not JSON-serializable");}
    if(typeof value!=="string")throw new TypeError("Code Mode returned an unsupported value");
    text(value);
  }
}
}`;
}
