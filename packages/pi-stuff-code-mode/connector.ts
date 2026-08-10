import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { SuiteToolDefinitionRegistry } from "@jczhang02/pi-stuff-tools/contract";
import type { SandboxToolExecutionContext, SuiteSandboxTool } from "./protocol.js";

const SEARCH_RESULT_LIMIT = 12;

export interface SuiteSandboxCatalogEntry {
	readonly description: string;
	readonly inputSchema: unknown;
	readonly name: string;
}

function identifier(value: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value);
}

function suitePath(name: string): string {
	return identifier(name) ? `suite.${name}` : `suite[${JSON.stringify(name)}]`;
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

export class SuiteCodeModeConnector {
	readonly registry: SuiteToolDefinitionRegistry;

	constructor(registry: SuiteToolDefinitionRegistry) {
		this.registry = registry;
	}

	catalog(): SuiteSandboxCatalogEntry[] {
		return this.registry
			.list()
			.filter((tool) => this.registry.isActive(tool.name))
			.map((tool) => ({
				description: oneLine(tool.description),
				inputSchema: tool.parameters,
				name: tool.name,
			}));
	}

	tools(): SuiteSandboxTool[] {
		return this.catalog().map((entry) => ({
			description: entry.description,
			inputSchema: entry.inputSchema,
			name: entry.name,
			usage: `${suitePath(entry.name)}(input)`,
			invoke: (input, context, signal) => this.invoke(entry.name, input, context, signal),
		}));
	}

	private async invoke(
		name: string,
		input: unknown,
		context: SandboxToolExecutionContext,
		signal: AbortSignal,
	): Promise<AgentToolResult<unknown>> {
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
		return outcome.result;
	}
}

export function buildSuiteSandboxSource(source: string, catalog: readonly SuiteSandboxCatalogEntry[]): string {
	const serialized = JSON.stringify(
		catalog.map((entry) => ({
			description: entry.description,
			inputSchema: entry.inputSchema,
			name: entry.name,
			path: suitePath(entry.name),
		})),
	);
	const prelude = `const __piStuffCatalog=${serialized};
globalThis.suite=globalThis.tools;
globalThis.codemode={};
globalThis.codemode.search=(query)=>{const normalized=String(query??"").toLowerCase().trim();const terms=normalized.split(/[^a-z0-9_$]+/).filter(Boolean);const ranked=__piStuffCatalog.map((entry)=>{const name=entry.name.toLowerCase();const description=entry.description.toLowerCase();let score=name===normalized?1000:name.startsWith(normalized)?240:name.includes(normalized)?160:0;for(const term of terms){if(name.includes(term))score+=100;if(description.includes(term))score+=15;}return{entry,score};}).filter(({score})=>score>0||!normalized).sort((a,b)=>b.score-a.score||a.entry.name.localeCompare(b.entry.name));return{results:ranked.slice(0,${SEARCH_RESULT_LIMIT}).map(({entry,score})=>({connector:"suite",description:entry.description,kind:"method",method:entry.name,path:entry.path,score})),total:ranked.length,truncated:ranked.length>${SEARCH_RESULT_LIMIT}};};
globalThis.codemode.describe=(target)=>{const value=String(target??"");let method=value.startsWith("suite.")?value.slice(6):value;if(value.startsWith("suite[")&&value.endsWith("]")){try{const parsed=JSON.parse(value.slice(6,-1));if(typeof parsed==="string")method=parsed;}catch{}}const entry=__piStuffCatalog.find((candidate)=>candidate.name===method);if(!entry)throw new Error("Unknown Code Mode target: "+value);return{description:entry.description,inputSchema:entry.inputSchema,kind:"method",path:entry.path,usage:entry.path+"(input)"};};
Object.freeze(globalThis.codemode);`;
	return `${prelude}\n${source}`;
}
