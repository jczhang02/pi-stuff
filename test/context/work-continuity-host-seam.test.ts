import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import piStuffContext from "../../packages/pi-stuff/src/context-management/index.js";
import piStuffUi from "../../packages/pi-stuff/src/conversation-ui/index.js";

const sessions: AgentSession[] = [];
const temporaryRoots: string[] = [];

function textOfContext(context: Context): string {
	return context.messages
		.map((message) => {
			const content = Reflect.get(message, "content");
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return "";
			return content
				.map((part) =>
					part && typeof part === "object" && Reflect.get(part, "type") === "text"
						? String(Reflect.get(part, "text") ?? "")
						: "",
				)
				.join("\n");
		})
		.join("\n");
}

async function createHost(options: {
	readonly compactOnProbeRounds?: readonly number[];
	readonly softTools: number;
	readonly hardTools: number;
	readonly responses: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0];
}) {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-work-continuity-host-"));
	temporaryRoots.push(root);
	const agentDir = join(root, "agent");
	const cwd = join(root, "workspace");
	await mkdir(agentDir, { recursive: true });
	await mkdir(cwd, { recursive: true });

	const faux = createFauxCore({
		api: `pi-stuff-work-continuity-${crypto.randomUUID()}`,
		provider: `pi-stuff-work-continuity-${crypto.randomUUID()}`,
		models: [{ id: "host-seam", contextWindow: 32_000, maxTokens: 2_048 }],
	});
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
		name: "Pi Stuff work-continuity Host seam",
		streamSimple: faux.streamSimple,
	};
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	modelRuntime.registerProvider(faux.provider, providerConfiguration);
	const model = modelRuntime.getModel(faux.provider, faux.getModel().id);
	if (!model) throw new Error("Expected the faux model to be registered");
	faux.setResponses(options.responses);

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	});
	const sessionManager = SessionManager.inMemory(cwd);
	const compactedRounds = new Set<number>();
	const loader = new DefaultResourceLoader({
		agentDir,
		cwd,
		extensionFactories: [
			{ name: "conversation-ui", factory: piStuffUi },
			{
				name: "context-management",
				factory: (pi) =>
					piStuffContext(pi, {
						loadMagicContext: async () => ({ default: async () => {} }),
						prepareMagicContext: async () => "deferred",
						workContinuityLimits: {
							softTools: options.softTools,
							hardTools: options.hardTools,
							softTurns: 100,
							hardTurns: 120,
							softDelegations: 100,
							hardDelegations: 120,
							softCompactions: 100,
							hardCompactions: 120,
							noProgressTurns: 100,
						},
					}),
			},
		],
		noContextFiles: true,
		noExtensions: true,
		noPromptTemplates: true,
		noSkills: true,
		noThemes: true,
		settingsManager,
	});
	await loader.reload();
	const created = await createAgentSession({
		agentDir,
		cwd,
		customTools: [
			{
				name: "probe",
				label: "Probe",
				description: "Return deterministic evidence.",
				parameters: Type.Object({ round: Type.Number() }),
				execute: async (_id, rawParams) => {
					const params = rawParams as { round: number };
					if (options.compactOnProbeRounds?.includes(params.round) && !compactedRounds.has(params.round)) {
						const firstKeptEntryId = sessionManager.getLeafId();
						if (!firstKeptEntryId) throw new Error("Expected an active Tool-call entry before compaction");
						sessionManager.appendCompaction(
							"managed history summary",
							firstKeptEntryId,
							12_000,
							{ source: "magic-context" },
							true,
						);
						compactedRounds.add(params.round);
					}
					return {
						content: [{ type: "text" as const, text: `evidence-${params.round}` }],
						details: undefined,
					};
				},
			},
		],
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
	return { faux, session: created.session, sessionManager };
}

afterEach(async () => {
	for (const session of sessions.splice(0)) session.dispose();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("real Pi Host injects the task anchor after a managed compaction and replaces it on the next request", async () => {
	const seen: string[] = [];
	const { session, sessionManager } = await createHost({
		softTools: 20,
		hardTools: 30,
		responses: [
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage("first complete");
			},
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage("second complete");
			},
		],
	});

	await session.prompt("Review alpha. Return an alpha report. Do not modify files.", { source: "interactive" });
	const firstUser = sessionManager
		.getBranch()
		.find((entry) => entry.type === "message" && entry.message.role === "user");
	if (!firstUser) throw new Error("Expected the first user entry");
	sessionManager.appendCompaction("managed summary", firstUser.id, 12_000, { source: "magic-context" }, true);
	await session.prompt("Correction: review beta instead. Return a beta report. Do not discuss alpha.", {
		source: "interactive",
	});

	expect(seen[0]).toContain("<pi-stuff-task-anchor");
	expect(seen[0]).toContain("Review alpha");
	expect(seen[1]).toContain("<pi-stuff-task-anchor");
	expect(seen[1]).toContain("Correction: review beta instead");
	expect(seen[1]).not.toContain("Current request:\nReview alpha");
}, 10_000);

test("real Pi Host transitions from successful Tool expansion to synthesis and blocks further Tools", async () => {
	const seen: string[] = [];
	const { session } = await createHost({
		softTools: 2,
		hardTools: 4,
		responses: [
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage(fauxToolCall("probe", { round: 1 }, { id: "probe-1" }));
			},
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage(fauxToolCall("probe", { round: 2 }, { id: "probe-2" }));
			},
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage(fauxToolCall("probe", { round: 3 }, { id: "probe-3" }));
			},
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage(
					"Actionable incompleteness: synthesis boundary reached after verified evidence.",
				);
			},
		],
	});

	await session.prompt("Inspect the evidence and return a supported report.", { source: "interactive" });

	expect(seen).toHaveLength(4);
	expect(seen[2]).toContain("Convergence state: SYNTHESIS REQUIRED");
	expect(seen[3]).toContain("aggregate user-work convergence boundary is active");
	expect(
		session.messages.some(
			(message) =>
				message.role === "assistant" &&
				Array.isArray(message.content) &&
				message.content.some(
					(part) =>
						part.type === "text" && part.text.includes("Actionable incompleteness: synthesis boundary reached"),
				),
		),
	).toBe(true);
}, 10_000);

test("real Pi Host keeps the current task anchor after a managed compaction during a Tool loop", async () => {
	const seen: string[] = [];
	const request = "Review the live task. Return one supported report. Do not lose this requirement.";
	const { session, sessionManager } = await createHost({
		compactOnProbeRounds: [1],
		softTools: 20,
		hardTools: 30,
		responses: [
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage(fauxToolCall("probe", { round: 1 }, { id: "compact-probe" }));
			},
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage("completed after managed compaction");
			},
		],
	});

	await session.prompt(request, { source: "interactive" });

	expect(sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(1);
	expect(seen).toHaveLength(2);
	expect(seen[1]).toContain("<pi-stuff-task-anchor");
	expect(seen[1]).toContain(request);
}, 10_000);

test("real Pi Host completes 18 Tool rounds across three managed compactions with one anchored synthesis", async () => {
	const seen: string[] = [];
	const request = "Audit the repository evidence across every round, then return one final supported recommendation.";
	const toolRounds = Array.from({ length: 18 }, (_, index) => index + 1);
	const { session, sessionManager } = await createHost({
		compactOnProbeRounds: [5, 10, 15],
		softTools: 18,
		hardTools: 22,
		responses: [
			...toolRounds.map((round) => (context: Context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage(fauxToolCall("probe", { round }, { id: `long-probe-${round}` }));
			}),
			(context) => {
				seen.push(textOfContext(context));
				return fauxAssistantMessage(
					"Final recommendation: all 18 evidence rounds were considered after three compactions.",
				);
			},
		],
	});

	await session.prompt(request, { source: "interactive" });

	expect(sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(3);
	expect(seen).toHaveLength(19);
	for (const providerRequest of [seen[5], seen[10], seen[15]]) {
		expect(providerRequest).toContain("<pi-stuff-task-anchor");
		expect(providerRequest).toContain(request);
	}
	expect(seen[18]).toContain("Convergence state: SYNTHESIS REQUIRED");
	expect(
		session.messages.some(
			(message) =>
				message.role === "assistant" &&
				Array.isArray(message.content) &&
				message.content.some(
					(part) =>
						part.type === "text" &&
						part.text.includes("all 18 evidence rounds were considered after three compactions"),
				),
		),
	).toBe(true);
}, 10_000);
