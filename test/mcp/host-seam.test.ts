import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	sessionEntryToContextMessages,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import piStuffContext, { getContextCapability } from "../../packages/pi-stuff/src/context-management/index.js";
import { readAgentWorkOrigin } from "../../packages/pi-stuff/src/conversation-ui/agent-run-origin.js";
import {
	dispatchMcpPromptToAgent,
	MCP_USER_PROMPT_MESSAGE_TYPE,
	registerMcpPromptMessageRenderer,
} from "../../packages/pi-stuff/src/mcp/runtime/prompts.js";
import {
	formatMcpDirectToolCallLines,
	formatMcpToolResultLines,
} from "../../packages/pi-stuff/src/mcp/runtime/tool-result-renderer.js";

const sessions: AgentSession[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
	for (const session of sessions.splice(0)) session.dispose();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function deferred<Value>() {
	let resolve = (_value: Value): void => {};
	const promise = new Promise<Value>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function messageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = Reflect.get(message, "content");
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is object => Boolean(part) && typeof part === "object")
		.filter((part) => Reflect.get(part, "type") === "text")
		.map((part) => String(Reflect.get(part, "text") ?? ""))
		.join("\n");
}

test("MCP call and result previews are terminal-cell-safe", () => {
	const call = formatMcpDirectToolCallLines("server/tool", { query: "😀".repeat(31) }, 60);
	const result = formatMcpToolResultLines(
		{ content: [{ type: "text", text: `\u001b[31m${"界".repeat(100)}\u001b[0m` }] },
		false,
		3,
		60,
	);
	for (const line of [...call.slice(1), ...result.lines]) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(60);
		expect(line).not.toContain("\u001b");
	}
	expect(result.truncated).toBeTrue();
});

test("real Pi 0.84.2 preserves MCP prompt provenance, Context, persistence, and reload rendering", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-mcp-host-"));
	temporaryRoots.push(root);
	const agentDir = join(root, "agent");
	const cwd = join(root, "workspace");
	const sessionDir = join(root, "sessions");
	await mkdir(agentDir, { recursive: true });
	await mkdir(cwd, { recursive: true });

	const faux = createFauxCore({
		api: `pi-stuff-mcp-${crypto.randomUUID()}`,
		provider: `pi-stuff-mcp-${crypto.randomUUID()}`,
	});
	const provider = faux.getModel().provider;
	const providerConfiguration = {
		api: faux.api,
		apiKey: "host-seam",
		baseUrl: "http://localhost",
		models: faux.models.map((model) => ({
			api: model.api,
			baseUrl: model.baseUrl,
			contextWindow: model.contextWindow,
			cost: model.cost,
			id: model.id,
			input: model.input,
			maxTokens: model.maxTokens,
			name: model.name,
			reasoning: model.reasoning,
		})),
		name: "Pi Stuff MCP host seam",
		streamSimple: faux.streamSimple,
	};
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	modelRuntime.registerProvider(provider, providerConfiguration);
	const model = modelRuntime.getModel(provider, faux.getModel().id);
	if (!model) throw new Error("Expected the faux model to be registered");

	let extensionApi: Parameters<typeof dispatchMcpPromptToAgent>[0] | undefined;
	let magicFactoryCalls = 0;
	let magicTransforms = 0;
	let providerContext: Context | undefined;
	const delivered = deferred<object>();
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	});
	const createLoader = () =>
		new DefaultResourceLoader({
			agentDir,
			cwd,
			extensionFactories: [
				{
					name: "mcp-real-host-seam",
					factory: async (pi) => {
						extensionApi = pi;
						pi.registerProvider(provider, providerConfiguration);
						await piStuffContext(pi, {
							loadMagicContext: async () => ({
								default: async (magicApi) => {
									magicFactoryCalls += 1;
									magicApi.registerTool({
										description: "REAL_MAGIC_CTX_SEARCH",
										execute: async () => ({
											content: [{ text: "real magic result", type: "text" }],
											details: undefined,
										}),
										label: "Context search",
										name: "ctx_search",
										parameters: Type.Object({ query: Type.String() }),
									});
									magicApi.on("context", (event) => {
										magicTransforms += 1;
										return {
											messages: [
												{
													content: [
														{
															text: "<session-history>REAL_MAGIC_HISTORY</session-history>",
															type: "text",
														},
													],
													role: "user",
													timestamp: 1,
												},
												...event.messages,
											],
										};
									});
								},
							}),
							prepareMagicContext: async () => "ready",
						});
						registerMcpPromptMessageRenderer(pi);
						pi.on("message_start", (event, ctx) => {
							if (event.message.role !== "custom" || event.message.customType !== MCP_USER_PROMPT_MESSAGE_TYPE) {
								return;
							}
							expect(getContextCapability(ctx).status().state).toBe("active");
							delivered.resolve(event.message);
						});
					},
				},
			],
			noContextFiles: true,
			noExtensions: true,
			noPromptTemplates: true,
			noSkills: true,
			noThemes: true,
			settingsManager,
		});

	const loader = createLoader();
	await loader.reload();
	const sessionManager = SessionManager.create(cwd, sessionDir);
	const created = await createAgentSession({
		agentDir,
		cwd,
		model,
		modelRuntime,
		noTools: "builtin",
		resourceLoader: loader,
		sessionManager,
		settingsManager,
	});
	sessions.push(created.session);
	expect(created.extensionsResult.errors).toEqual([]);
	await created.session.bindExtensions({ shutdownHandler: async () => {} });
	if (!extensionApi) throw new Error("Expected the real ExtensionAPI");

	faux.setResponses([
		(context) => {
			providerContext = context;
			return fauxAssistantMessage("MCP host seam complete");
		},
	]);
	const prompt = "Review this real MCP prompt";
	await dispatchMcpPromptToAgent(extensionApi, prompt);
	const deliveredMessage = await delivered.promise;
	expect(readAgentWorkOrigin(deliveredMessage)).toBe("user");
	await created.session.waitForIdle();

	expect(magicFactoryCalls).toBe(1);
	expect(magicTransforms).toBeGreaterThan(0);
	expect(providerContext?.messages.some((message) => messageText(message).includes("REAL_MAGIC_HISTORY"))).toBe(true);
	expect(
		providerContext?.messages.some((message) => messageText(message).includes("<pi-stuff-context-guidance>")),
	).toBe(true);
	expect(providerContext?.messages.some((message) => messageText(message).includes(prompt))).toBe(true);
	expect(providerContext?.tools?.some((tool) => tool.description === "REAL_MAGIC_CTX_SEARCH")).toBe(true);

	const customEntry = sessionManager
		.getEntries()
		.find((entry) => entry.type === "custom_message" && entry.customType === MCP_USER_PROMPT_MESSAGE_TYPE);
	if (customEntry?.type !== "custom_message") throw new Error("Expected persisted MCP custom message");
	expect(customEntry.content).toBe(prompt);
	expect(customEntry.display).toBe(true);
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("Expected a persisted session file");
	const reopened = SessionManager.open(sessionFile, sessionDir);
	const reopenedEntry = reopened
		.getEntries()
		.find((entry) => entry.type === "custom_message" && entry.customType === MCP_USER_PROMPT_MESSAGE_TYPE);
	if (!reopenedEntry) throw new Error("Expected MCP entry after reopening the session");
	expect(reopened.buildSessionContext().messages.some((message) => messageText(message).includes(prompt))).toBe(true);

	await created.session.reload();
	const renderer = created.session.extensionRunner.getMessageRenderer(MCP_USER_PROMPT_MESSAGE_TYPE);
	if (!renderer) throw new Error("Expected the MCP renderer after Extension reload");
	initTheme("dark", false);
	const reloadedMessage = sessionEntryToContextMessages(reopenedEntry)[0];
	if (reloadedMessage?.role !== "custom") throw new Error("Expected reloaded custom message");
	const component = renderer(reloadedMessage, { expanded: false, outputPad: 1 }, {} as Theme);
	expect(component?.render(80).join("\n")).toContain(prompt);
}, 20_000);
