import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;
type ContextModule = typeof import("../../packages/pi-stuff-context/index.js");

test("physical Context package copies share one Host runtime", async () => {
	const directory = mkdtempSync(join(process.cwd(), ".pi-stuff-context-duplicates-"));
	const firstDirectory = join(directory, "first");
	const secondDirectory = join(directory, "second");
	mkdirSync(firstDirectory);
	mkdirSync(secondDirectory);
	copyFileSync(join(process.cwd(), "packages/pi-stuff-context/index.ts"), join(firstDirectory, "index.ts"));
	copyFileSync(join(process.cwd(), "packages/pi-stuff-context/index.ts"), join(secondDirectory, "index.ts"));
	for (const copy of [firstDirectory, secondDirectory]) {
		const scope = join(copy, "node_modules/@jczhang02");
		mkdirSync(scope, { recursive: true });
		symlinkSync(join(process.cwd(), "packages/pi-stuff-tools"), join(scope, "pi-stuff-tools"), "dir");
	}

	let first: ContextModule | undefined;
	try {
		first = (await import(pathToFileURL(join(firstDirectory, "index.ts")).href)) as ContextModule;
		const second = (await import(pathToFileURL(join(secondDirectory, "index.ts")).href)) as ContextModule;
		const handlers = new Map<string, Handler[]>();
		let activeTools: string[] = [];
		const api = {
			events: {},
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
		let firstLoads = 0;
		let secondLoads = 0;
		first.default(api, {
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
		for (const handler of handlers.get("session_start") ?? []) {
			await handler({ type: "session_start", reason: "startup" }, ctx);
		}
		for (const handler of handlers.get("before_agent_start") ?? []) await handler({}, ctx);

		second.default(api, {
			loadMagicContext: async () => {
				secondLoads++;
				return { default: async () => undefined };
			},
		});
		expect(firstLoads).toBe(1);
		expect(secondLoads).toBe(0);
		expect(handlers.get("context")).toHaveLength(1);
		expect(second.getContextCapability(ctx).status().state).toBe("active");
	} finally {
		first?.__test.clear();
		rmSync(directory, { recursive: true, force: true });
	}
});
