import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;
type ContextModule = typeof import("../../packages/pi-stuff/src/context-management/index.js");

class EventBusHarness {
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

	emit(event: string, data: unknown): void {
		for (const listener of [...(this.listeners.get(event) ?? [])]) listener(data);
	}

	on(event: string, listener: (data: unknown) => void): () => void {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
		return () => listeners.delete(listener);
	}
}

test("physical Context Module copies share one Host runtime", async () => {
	const directory = mkdtempSync(join(process.cwd(), ".pi-stuff-context-duplicates-"));
	const firstDirectory = join(directory, "first", "src", "context-management");
	const secondDirectory = join(directory, "second", "src", "context-management");
	for (const copy of [firstDirectory, secondDirectory]) {
		mkdirSync(copy, { recursive: true });
		cpSync(join(process.cwd(), "packages/pi-stuff/src/context-management"), copy, { recursive: true });
		const sourceRoot = join(copy, "..");
		symlinkSync(join(process.cwd(), "packages/pi-stuff/src/tool-display"), join(sourceRoot, "tool-display"), "dir");
		symlinkSync(
			join(process.cwd(), "packages/pi-stuff/src/conversation-ui"),
			join(sourceRoot, "conversation-ui"),
			"dir",
		);
	}

	let first: ContextModule | undefined;
	try {
		first = (await import(pathToFileURL(join(firstDirectory, "index.ts")).href)) as ContextModule;
		const second = (await import(pathToFileURL(join(secondDirectory, "index.ts")).href)) as ContextModule;
		const bus = new EventBusHarness();
		let activeTools: string[] = [];
		const createApi = () => {
			const handlers = new Map<string, Handler[]>();
			const api = {
				events: {
					emit: (event: string, data: unknown) => bus.emit(event, data),
					on: (event: string, listener: (data: unknown) => void) => bus.on(event, listener),
				},
				on(event: string, handler: Handler) {
					handlers.set(event, [...(handlers.get(event) ?? []), handler]);
				},
				registerTool(tool: { name: string }) {
					if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
				},
				getActiveTools: () => [...activeTools],
				setActiveTools(names: string[]) {
					activeTools = [...names];
				},
			} as unknown as ExtensionAPI;
			return { api, handlers };
		};
		const firstApi = createApi();
		const secondApi = createApi();
		let firstLoads = 0;
		let secondLoads = 0;
		await first.default(firstApi.api, {
			loadMagicContext: async () => {
				firstLoads++;
				return {
					default: async (magicApi: ExtensionAPI) => {
						magicApi.on("context", (event) => event);
					},
				};
			},
		});
		const ctx = {
			cwd: "/workspace/duplicate",
			sessionManager: {
				buildContextEntries: () => [],
				getSessionFile: () => "/sessions/duplicate.jsonl",
				getSessionId: () => "duplicate",
			},
		} as unknown as ExtensionContext;
		for (const handler of firstApi.handlers.get("session_start") ?? []) {
			await handler({ type: "session_start", reason: "startup" }, ctx);
		}
		for (const handler of firstApi.handlers.get("before_agent_start") ?? []) await handler({}, ctx);

		await second.default(secondApi.api, {
			loadMagicContext: async () => {
				secondLoads++;
				return { default: async () => undefined };
			},
		});
		expect(firstLoads).toBe(1);
		expect(secondLoads).toBe(0);
		expect(firstApi.handlers.get("context")).toHaveLength(1);
		expect(secondApi.handlers.get("context") ?? []).toHaveLength(0);
		expect(second.getContextCapability(ctx).status().state).toBe("active");
	} finally {
		first?.__test.clear();
		rmSync(directory, { recursive: true, force: true });
	}
});
