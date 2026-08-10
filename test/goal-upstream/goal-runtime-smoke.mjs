import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const { AuthStorage } = await import(
	new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent"))
);
const extensionPath = process.env.PI_STUFF_GOAL_RUNTIME_EXTENSION
	? resolve(process.env.PI_STUFF_GOAL_RUNTIME_EXTENSION)
	: resolve(import.meta.dirname, "../../packages/pi-stuff/src/goal/src/goal.ts");
const runtimeMode = process.env.PI_STUFF_GOAL_RUNTIME_MODE ?? "source";

async function createHarness(
	responses,
	fauxOptions = {},
	prepareSession,
	goalSettings,
	piSettings = {},
	managedRun,
) {
	const root = await mkdtemp(join(tmpdir(), "pi-goal-runtime-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "workspace");
	await mkdir(cwd, { recursive: true });
	if (goalSettings) {
		await mkdir(agentDir, { recursive: true });
		await writeFile(join(agentDir, "pi-goal.json"), `${JSON.stringify(goalSettings)}\n`, "utf8");
	}

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	let createdSession;
	let agentDirRestored = false;
	const restoreAgentDir = () => {
		if (agentDirRestored) return;
		agentDirRestored = true;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	};
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const cleanupResources = async () => {
		try {
			createdSession?.dispose();
		} finally {
			try {
				await rm(root, { recursive: true, force: true });
			} finally {
				restoreAgentDir();
			}
		}
	};

	try {
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		const modelRuntime = await ModelRuntime.create({ credentials: authStorage, modelsPath: null });
		const modelRegistry = new ModelRegistry(modelRuntime);
		const faux = createFauxCore({
			api: `pi-goal-faux-${crypto.randomUUID()}`,
			provider: `pi-goal-faux-${crypto.randomUUID()}`,
			...fauxOptions,
		});
		const provider = faux.getModel().provider;
		const providerConfiguration = {
			name: "Pi Goal runtime smoke faux provider",
			api: faux.api,
			apiKey: "runtime-smoke",
			baseUrl: "http://localhost",
			streamSimple: faux.streamSimple,
			models: faux.models.map((model) => ({
				id: model.id,
				name: model.name,
				api: model.api,
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
			})),
		};
		modelRegistry.registerProvider(provider, providerConfiguration);
		const model = modelRegistry.find(provider, faux.getModel().id);
		assert.ok(model, "expected registered faux model");
		faux.setResponses(responses);
		const managedRunEvents = [];

		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: false },
			...piSettings,
		});
		const lifecycleEvents = [];
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			additionalExtensionPaths: [extensionPath],
			extensionFactories: [
				{
					name: "runtime-smoke-observer",
					factory: (pi) => {
						pi.registerProvider(provider, providerConfiguration);
						if (managedRun) {
							pi.events.on(`pi-goal:event:${managedRun.runId}`, (event) => {
								managedRunEvents.push(event);
							});
							pi.on("session_start", () => {
								pi.events.emit("pi-goal:start", managedRun);
							});
						}
						pi.registerTool({
							name: "budget_probe",
							label: "Budget Probe",
							description: "No-op tool for lifecycle smoke coverage",
							parameters: Type.Object({}),
							async execute() {
								lifecycleEvents.push("budget_probe_execute");
								return { content: [{ type: "text", text: "probe complete" }] };
							},
						});
						pi.on("session_start", () => lifecycleEvents.push("session_start"));
						pi.on("agent_start", () => lifecycleEvents.push("agent_start"));
						pi.on("message_end", (event) => {
							if (event.message.role === "assistant") lifecycleEvents.push("assistant_message_end");
						});
						pi.on("tool_execution_end", () => lifecycleEvents.push("tool_execution_end"));
						pi.on("session_before_compact", () => lifecycleEvents.push("session_before_compact"));
						pi.on("session_compact", (_event, ctx) =>
							lifecycleEvents.push(
								`session_compact:idle=${ctx.isIdle()}:pending=${ctx.hasPendingMessages()}`,
							),
						);
						pi.on("agent_settled", () => lifecycleEvents.push("agent_settled"));
					},
				},
			],
		});
		await resourceLoader.reload();
		const sessionManager = SessionManager.inMemory(cwd);
		prepareSession?.(sessionManager);
		const result = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime,
			model,
			resourceLoader,
			sessionManager,
			settingsManager,
			noTools: "builtin",
		});
		assert.deepEqual(result.extensionsResult.errors, []);
		createdSession = result.session;
		await result.session.bindExtensions({ shutdownHandler: async () => {} });
		return {
			agentDir,
			extensions: result.extensionsResult.extensions.map((extension) => ({
				path: extension.path,
				handlers: [...extension.handlers.keys()],
			})),
			faux,
			lifecycleEvents,
			managedRunEvents,
			session: result.session,
			cleanup: cleanupResources,
		};
	} catch (error) {
		await cleanupResources();
		throw error;
	}
}

function completionResponse(context) {
	const goalId = latestGoalId(context);
	assert.ok(goalId, "expected goal id in continuation system prompt");
	return fauxAssistantMessage(
		fauxToolCall("goal_complete", {
			goal_id: goalId,
			summary: "Runtime smoke completed and verified.",
			evidence: [
				{
					requirement: "Complete and verify the active Goal lifecycle",
					proof: "The real Pi lifecycle test observed the required state transition and persisted output.",
				},
			],
		}),
	);
}

function blockerResponse(repeatedTurns) {
	return (context) => {
		const goalId = latestGoalId(context);
		assert.ok(goalId, "expected goal id in blocker audit system prompt");
		return fauxAssistantMessage(
			fauxToolCall("goal_blocked", {
				goal_id: goalId,
				reason: "Production signing credential requires the user",
				attempt: [
					"Checked the local credential store for the production signing key.",
					"Queried the process environment for an alternate production signing key.",
					"Requested signing through the configured hardware agent socket.",
				][repeatedTurns - 1],
				evidence: `The attempted signing path returned an unavailable credential result on audit turn ${repeatedTurns}.`,
				repeated_turns: repeatedTurns,
			}),
		);
	};
}

function userMessageText(message) {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function storedPromptText(message) {
	const userText = userMessageText(message);
	if (userText || message.role !== "custom") return userText;
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function contextText(context) {
	return [context.systemPrompt ?? "", ...context.messages.map(storedPromptText)].filter(Boolean).join("\n");
}

function latestGoalId(context) {
	return [...contextText(context).matchAll(/<goal_id>\s*([^<\s]+)\s*<\/goal_id>/g)].at(-1)?.[1];
}

async function agentDirectoryIsolationScenario() {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const harness = await createHarness([]);
	try {
		assert.equal(process.env.PI_CODING_AGENT_DIR, harness.agentDir);
	} finally {
		await harness.cleanup();
	}
	assert.equal(process.env.PI_CODING_AGENT_DIR, previousAgentDir);
}

function persistedGoalState(session) {
	return session.sessionManager
		.getBranch()
		.filter((candidate) => candidate.type === "custom" && candidate.customType === "goal-state")
		.at(-1)?.data;
}

function persistedGoalStatus(session) {
	return persistedGoalState(session)?.goal?.status ?? null;
}

function persistedGoalHistory(session) {
	return session.sessionManager
		.getBranch()
		.filter((candidate) => candidate.type === "custom" && candidate.customType === "goal-state")
		.map((candidate) => candidate.data?.goal)
		.filter(Boolean);
}

async function waitFor(predicate, description, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function normalContinuationScenario() {
	const harness = await createHarness([
		fauxAssistantMessage("First pass stopped without completion."),
		completionResponse,
	]);
	const events = [];
	const unsubscribe = harness.session.subscribe((event) => events.push(event.type));
	try {
		await harness.session.prompt("/goal runtime continuation smoke");
		await waitFor(() => harness.faux.state.callCount === 2, "settled continuation");
		await harness.session.agent.waitForIdle();
		assert.equal(events.filter((type) => type === "agent_settled").length, 2);
		assert.equal(persistedGoalStatus(harness.session), null);
		assert.ok(
			harness.session.messages
				.map(storedPromptText)
				.some((text) => text.includes("pi-goal-continuation:")),
		);
	} finally {
		unsubscribe();
		await harness.cleanup();
	}
}

async function strictBlockerAuditScenario() {
	const harness = await createHarness([
		blockerResponse(1),
		fauxAssistantMessage("The first blocker report was recorded; reasonable alternatives remain."),
		blockerResponse(2),
		fauxAssistantMessage("The second blocker report was recorded; one final independent attempt remains."),
		blockerResponse(3),
	]);
	try {
		await harness.session.prompt("/goal prove the strict blocker audit");
		await waitFor(() => harness.faux.state.callCount === 5, "three-turn blocker audit");
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), "blocked");
		assert.equal(persistedGoalState(harness.session)?.goal?.blockerAudit?.consecutiveTurns, 3);
		assert.equal(
			harness.session.messages
				.map(storedPromptText)
				.filter((text) => text.includes("pi-goal-continuation:")).length,
			2,
		);
	} finally {
		await harness.cleanup();
	}
}

async function runawayNoProgressScenario() {
	const harness = await createHarness(
		[
			fauxAssistantMessage("Required phrase"),
			fauxAssistantMessage(""),
			fauxAssistantMessage("   ...   "),
			fauxAssistantMessage(""),
		],
		{},
		undefined,
		{ continuationLimits: { automaticTurns: null, noProgressTurns: 3 } },
	);
	try {
		await harness.session.prompt('/goal Reply with exactly: "Required phrase"');
		await waitFor(() => harness.faux.state.callCount === 4, "no-progress safety pause");
		await harness.session.agent.waitForIdle();
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(harness.faux.state.callCount, 4);
		assert.equal(persistedGoalStatus(harness.session), "paused");
		assert.equal(persistedGoalState(harness.session)?.goal?.safetyPauseCause, "no_progress");
		assert.equal(persistedGoalState(harness.session)?.goal?.toolFreeRepeatCount, 3);
		assert.equal(
			harness.session.messages
				.map(storedPromptText)
				.filter((text) => text.includes("pi-goal-continuation:")).length,
			3,
		);
	} finally {
		await harness.cleanup();
	}
}

async function automaticToolLoopLimitScenario() {
	const observedSignals = [];
	const toolResponse = (_context, options) => {
		observedSignals.push(options?.signal?.aborted === true);
		return fauxAssistantMessage(fauxToolCall("budget_probe", {}));
	};
	const harness = await createHarness(
		[
			fauxAssistantMessage("Start automatic work."),
			toolResponse,
			toolResponse,
			toolResponse,
			(_context, options) => {
				observedSignals.push(options?.signal?.aborted === true);
				assert.equal(options?.signal?.aborted, true);
				return fauxAssistantMessage("Synthetic aborted cleanup.");
			},
		],
		{},
		undefined,
		{ continuationLimits: { automaticTurns: 3, noProgressTurns: null } },
	);
	try {
		await harness.session.prompt("/goal bounded automatic tool loop");
		await harness.session.agent.waitForIdle();
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(persistedGoalStatus(harness.session), "paused");
		assert.equal(persistedGoalState(harness.session)?.goal?.safetyPauseCause, "continuation_limit");
		assert.equal(persistedGoalState(harness.session)?.goal?.automaticModelTurns, 3);
		assert.equal(
			harness.lifecycleEvents.filter((event) => event === "budget_probe_execute").length,
			3,
		);
		assert.deepEqual(observedSignals.slice(0, 3), [false, false, false]);
		assert.ok(observedSignals.length <= 4);
		if (observedSignals.length === 4) assert.equal(observedSignals[3], true);
		assert.ok(harness.faux.state.callCount <= 5);
	} finally {
		await harness.cleanup();
	}
}

async function retryAtHardLimitScenario() {
	const observedSignals = [];
	const harness = await createHarness(
		[
			fauxAssistantMessage("Initial unfinished result."),
			(_context, options) => {
				observedSignals.push(options?.signal?.aborted === true);
				return fauxAssistantMessage("", {
					stopReason: "error",
					errorMessage: "HTTP 524: transient upstream timeout",
				});
			},
			(_context, options) => {
				observedSignals.push(options?.signal?.aborted === true);
				assert.equal(options?.signal?.aborted, true);
				return fauxAssistantMessage("Guard-owned aborted retry cleanup.");
			},
		],
		{},
		undefined,
		{ continuationLimits: { automaticTurns: 1, noProgressTurns: null } },
		{
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
		},
	);
	try {
		await harness.session.prompt("/goal retry cannot cross hard limit");
		await harness.session.agent.waitForIdle();
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(persistedGoalStatus(harness.session), "paused");
		assert.equal(persistedGoalState(harness.session)?.goal?.safetyPauseCause, "continuation_limit");
		assert.equal(persistedGoalState(harness.session)?.goal?.automaticModelTurns, 1);
		assert.equal(observedSignals[0], false);
		assert.ok(observedSignals.length <= 2);
		if (observedSignals.length === 2) assert.equal(observedSignals[1], true);
		assert.ok(
			harness.faux.state.callCount === 2 || harness.faux.state.callCount === 3,
			"Pi must either suppress the cancelled retry before provider dispatch or expose only an aborted cleanup call",
		);
	} finally {
		await harness.cleanup();
	}
}

async function automaticRetryOwnershipScenario() {
	const harness = await createHarness(
		[
			fauxAssistantMessage("Initial unfinished result."),
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "HTTP 524: transient upstream timeout",
			}),
			fauxAssistantMessage("Recovered provider response."),
			completionResponse,
		],
		{},
		undefined,
		{ continuationLimits: { automaticTurns: 3, noProgressTurns: null } },
		{
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
		},
	);
	try {
		await harness.session.prompt("/goal runtime retry ownership smoke");
		await waitFor(() => harness.faux.state.callCount === 4, "provider retry and continuation");
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), null);
		assert.ok(
			persistedGoalHistory(harness.session).some(
				(goal) => goal.automaticModelTurns === 2 && goal.status === "active",
			),
			"retry response must retain automatic ownership",
		);
		assert.ok(
			harness.lifecycleEvents.filter((event) => event === "agent_start").length >= 3,
			"expected retry to emit agent_start",
		);
	} finally {
		await harness.cleanup();
	}
}

async function exhaustedRetryContinuesScenario() {
	const providerError = fauxAssistantMessage("", {
		stopReason: "error",
		errorMessage: "HTTP 524: transient upstream timeout",
	});
	const harness = await createHarness(
		[
			fauxAssistantMessage("Initial unfinished result."),
			providerError,
			providerError,
			completionResponse,
		],
		{},
		undefined,
		undefined,
		{
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
		},
	);
	try {
		await harness.session.prompt("/goal continue after Pi exhausts one provider retry");
		await waitFor(() => harness.faux.state.callCount === 4, "continuation after exhausted retry");
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), null);
		assert.ok(
			harness.session.messages
				.map(storedPromptText)
				.some((text) => text.includes("pi-goal-continuation:")),
		);
	} finally {
		await harness.cleanup();
	}
}

async function orderedQueueScenario() {
	const now = Date.now();
	const harness = await createHarness(
		[completionResponse, completionResponse],
		{},
		(sessionManager) => {
			sessionManager.appendCustomEntry("goal-state", {
				goal: {
					id: crypto.randomUUID(),
					text: "runtime queue head",
					status: "active",
					startedAt: now,
					updatedAt: now,
					iteration: 0,
					tokensUsed: 0,
					timeUsedSeconds: 0,
					baselineTokens: 0,
				},
				queue: [
					{
						id: crypto.randomUUID(),
						text: "runtime queue tail",
						status: "queued",
						startedAt: now,
						updatedAt: now,
						iteration: 0,
						tokensUsed: 0,
						timeUsedSeconds: 0,
						baselineTokens: 0,
					},
				],
			});
		},
		{ experimental: { goals: true } },
	);
	try {
		const toolNames = harness.session.getAllTools().map(({ name }) => name);
		assert.ok(toolNames.includes("goal_complete"));
		assert.ok(toolNames.includes("goal_blocked"));
		assert.equal(toolNames.includes("goals_complete"), false);
		assert.equal(toolNames.includes("goals_blocked"), false);
		await harness.session.prompt("continue the restored ordered queue");
		await waitFor(() => harness.faux.state.callCount === 2, "ordered queue advancement");
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), null);
		assert.equal(persistedGoalState(harness.session)?.queue, undefined);
	} finally {
		await harness.cleanup();
	}
}

async function queuedInputScenario() {
	const observedPrompts = [];
	const harness = await createHarness(
		[
			(context) => {
				observedPrompts.push(context.messages.map(userMessageText).filter(Boolean).at(-1) ?? "");
				return fauxAssistantMessage("x".repeat(120));
			},
			(context) => {
				observedPrompts.push(context.messages.map(userMessageText).filter(Boolean).at(-1) ?? "");
				return fauxAssistantMessage("Queued request handled.");
			},
			(context) => {
				observedPrompts.push(context.messages.map(userMessageText).filter(Boolean).at(-1) ?? "");
				return completionResponse(context);
			},
		],
		{ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } },
	);
	try {
		await harness.session.prompt("/goal queued work smoke");
		await waitFor(() => harness.session.isStreaming, "initial turn streaming");
		await harness.session.prompt("queued user work", { streamingBehavior: "followUp" });
		await waitFor(() => harness.faux.state.callCount === 3, "continuation after queued input");
		await harness.session.agent.waitForIdle();
		const queuedIndex = observedPrompts.findIndex((text) => text.includes("queued user work"));
		const continuationIndex = observedPrompts.findIndex((text) =>
			text.includes("pi-goal-continuation:"),
		);
		assert.ok(queuedIndex >= 0, "expected queued work to reach the model");
		assert.ok(continuationIndex > queuedIndex, "continuation must yield to queued work");
	} finally {
		await harness.cleanup();
	}
}

async function busyEditOwnershipScenario() {
	const harness = await createHarness(
		[
			fauxAssistantMessage("x".repeat(120)),
			fauxAssistantMessage("Edited objective handled in the current run."),
			completionResponse,
		],
		{ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } },
	);
	try {
		await harness.session.prompt("/goal original busy objective");
		await waitFor(() => harness.session.isStreaming, "busy goal turn");
		await harness.session.prompt("/goal edit revised busy objective");
		await waitFor(() => harness.faux.state.callCount === 3, "edited-goal continuation");
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), null);
		assert.ok(
			harness.session.messages
				.map(storedPromptText)
				.some((text) => text.includes("updated objective supersedes")),
		);
	} finally {
		await harness.cleanup();
	}
}

async function pauseScenario() {
	const harness = await createHarness([fauxAssistantMessage("x".repeat(200))], {
		tokensPerSecond: 100,
		tokenSize: { min: 1, max: 1 },
	});
	try {
		await harness.session.prompt("/goal interrupt runtime smoke");
		await waitFor(() => harness.session.isStreaming, "goal turn streaming");
		await harness.session.prompt("/goal pause");
		await waitFor(() => !harness.session.isStreaming, "goal turn abort");
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.ok(harness.faux.state.callCount <= 1, "pause must prevent any second provider call");
		assert.equal(persistedGoalStatus(harness.session), "paused");
		assert.equal(
			harness.session.messages
				.map(storedPromptText)
				.filter((text) => text.includes("pi-goal-continuation:")).length,
			0,
		);
	} finally {
		await harness.cleanup();
	}
}

async function reloadResumeScenario() {
	const now = Date.now();
	const harness = await createHarness([completionResponse], {}, (sessionManager) => {
		sessionManager.appendCustomEntry("goal-state", {
			goal: {
				id: crypto.randomUUID(),
				text: "survive a real Pi reload",
				status: "active",
				startedAt: now - 1_000,
				updatedAt: now - 1_000,
				iteration: 1,
				tokensUsed: 0,
				timeUsedSeconds: 1,
				baselineTokens: 0,
			},
		});
	});
	try {
		assert.equal(persistedGoalStatus(harness.session), "active");
		assert.equal(harness.faux.state.callCount, 0);
		await harness.session.reload();
		assert.ok(harness.session.getAllTools().some(({ name }) => name === "goal_complete"));
		try {
			await waitFor(() => harness.faux.state.callCount === 1, "automatic post-reload Goal completion");
		} catch (error) {
			throw new Error(
				`Post-reload Goal did not complete: ${JSON.stringify({
					callCount: harness.faux.state.callCount,
					status: persistedGoalStatus(harness.session),
					messages: harness.session.messages.map(storedPromptText).filter(Boolean),
				})}`,
				{ cause: error },
			);
		}
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), null);
		assert.ok(
			harness.session.messages
				.map(storedPromptText)
				.some((text) => text.includes("pi-goal-continuation:")),
		);
	} finally {
		await harness.cleanup();
	}
}

async function frozenQueueBlockedToolAbortScenario() {
	const observedSignals = [];
	const now = Date.now();
	const goalId = crypto.randomUUID();
	const harness = await createHarness(
		[
			fauxAssistantMessage(
				fauxToolCall("goal_complete", {
					goal_id: goalId,
					summary: "This frozen queue must not complete.",
					evidence: [
						{
							requirement: "Preserve the frozen queue",
							proof: "The runtime test observed that frozen state must reject this tool call.",
						},
					],
				}),
			),
			(_context, options) => {
				observedSignals.push(options?.signal?.aborted === true);
				return fauxAssistantMessage("Synthetic frozen-queue cleanup.");
			},
		],
		{},
		(sessionManager) => {
			sessionManager.appendCustomEntry("goal-state", {
				goal: {
					id: goalId,
					text: "frozen queue head",
					status: "active",
					startedAt: now,
					updatedAt: now,
					iteration: 0,
					tokensUsed: 0,
					timeUsedSeconds: 0,
					baselineTokens: 0,
				},
				queue: [
					{
						id: crypto.randomUUID(),
						text: "frozen queue tail",
						status: "queued",
						startedAt: now,
						updatedAt: now,
						iteration: 0,
						tokensUsed: 0,
						timeUsedSeconds: 0,
						baselineTokens: 0,
					},
				],
			});
		},
	);
	try {
		await harness.session.prompt("Simulate a stale frozen-queue tool call.");
		await harness.session.agent.waitForIdle();
		assert.ok(
			harness.faux.state.callCount <= 2,
			"frozen guard must allow at most one cleanup call",
		);
		assert.equal(observedSignals.includes(false), false, "any cleanup call must inherit abort");
		assert.equal(persistedGoalStatus(harness.session), "active");
	} finally {
		await harness.cleanup();
	}
}

async function stalePausedToolAbortScenario() {
	const observedSignals = [];
	const harness = await createHarness([
		fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: "Unauthorized: invalid API key",
		}),
		fauxAssistantMessage(fauxToolCall("budget_probe", {})),
		(_context, options) => {
			observedSignals.push(options?.signal?.aborted === true);
			return fauxAssistantMessage("Synthetic stale-turn cleanup.");
		},
	]);
	try {
		await harness.session.prompt("/goal stale paused-tool runtime smoke");
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), "paused");

		// Bypass the normal input boundary to model provider-owned stale work that
		// arrives after the interrupted goal has already installed its tool guard.
		await harness.session.agent.prompt("Simulate a stale provider-owned turn.");
		await harness.session.agent.waitForIdle();
		assert.ok(harness.faux.state.callCount <= 3, "stale guard must allow at most one cleanup call");
		assert.equal(observedSignals.includes(false), false, "any cleanup call must inherit abort");
		assert.equal(
			harness.lifecycleEvents.filter((event) => event === "budget_probe_execute").length,
			0,
		);
	} finally {
		await harness.cleanup();
	}
}

async function budgetBoundaryScenario() {
	const harness = await createHarness([
		fauxAssistantMessage(fauxToolCall("budget_probe", {})),
		(context) => {
			const wrapUp = context.messages.find(
				(message) => message.role === "custom" && message.customType === "goal-budget-wrap-up",
			);
			assert.match(String(wrapUp?.content), /stop substantive work/i);
			return fauxAssistantMessage("Budget-limited progress summary.");
		},
	]);
	try {
		await harness.session.prompt("/goal --tokens 1 budget boundary runtime smoke");
		await waitFor(() => harness.faux.state.callCount === 2, "budget wrap-up response");
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), "budget_limited");
		assert.equal(
			harness.lifecycleEvents.filter((event) => event === "tool_execution_end").length,
			1,
		);
		assert.ok(
			harness.lifecycleEvents.indexOf("assistant_message_end") <
				harness.lifecycleEvents.indexOf("tool_execution_end"),
			"assistant message must finalize before tool_execution_end",
		);
	} finally {
		await harness.cleanup();
	}
}

async function budgetViolationScenario() {
	const harness = await createHarness([
		fauxAssistantMessage(fauxToolCall("budget_probe", {})),
		fauxAssistantMessage(fauxToolCall("budget_probe", {})),
		(_context, options) => {
			assert.equal(options?.signal?.aborted, true);
			return fauxAssistantMessage("This aborted response must not start more work.");
		},
	]);
	try {
		await harness.session.prompt("/goal --tokens 1 reject wrap-up tools at runtime");
		await harness.session.agent.waitForIdle();
		assert.ok(
			harness.faux.state.callCount === 2 || harness.faux.state.callCount === 3,
			"Pi must stop after the rejected wrap-up tool, with at most one aborted cleanup call",
		);
		assert.equal(
			harness.lifecycleEvents.filter((event) => event === "budget_probe_execute").length,
			1,
		);
		assert.equal(persistedGoalStatus(harness.session), "budget_limited");
	} finally {
		await harness.cleanup();
	}
}

async function budgetAgentEndFallbackScenario() {
	const harness = await createHarness([fauxAssistantMessage("No-tool budget response.")]);
	try {
		await harness.session.prompt("/goal --tokens 1 no-tool budget runtime smoke");
		await harness.session.agent.waitForIdle();
		assert.equal(harness.faux.state.callCount, 1);
		assert.equal(persistedGoalStatus(harness.session), "budget_limited");
	} finally {
		await harness.cleanup();
	}
}

async function managedRunRpcScenario() {
	const runId = crypto.randomUUID();
	const harness = await createHarness(
		[completionResponse],
		{},
		undefined,
		{ rpc: { enabled: true } },
		{},
		{ runId, objective: "complete a managed runtime run" },
	);
	try {
		await waitFor(
			() => harness.managedRunEvents.some((event) => event.status === "complete"),
			"managed run completion",
		);
		await harness.session.agent.waitForIdle();
		assert.deepEqual(
			harness.managedRunEvents
				.filter((event) => event.type === "state")
				.map((event) => event.status),
			["active", "complete"],
		);
		assert.equal(
			harness.managedRunEvents.filter(
				(event) => event.type === "state" && event.status !== "active",
			).length,
			1,
		);
	} finally {
		await harness.cleanup();
	}
}

async function managedRunDisabledScenario() {
	const runId = crypto.randomUUID();
	const harness = await createHarness(
		[],
		{},
		undefined,
		undefined,
		{},
		{ runId, objective: "must stay disabled" },
	);
	try {
		await waitFor(() => harness.managedRunEvents.length > 0, "managed run disabled rejection");
		assert.deepEqual(harness.managedRunEvents, [
			{
				type: "error",
				runId,
				operation: "start",
				error: { code: "RPC_DISABLED", message: "Managed run RPC is disabled." },
			},
		]);
		assert.equal(harness.faux.state.callCount, 0);
	} finally {
		await harness.cleanup();
	}
}

async function manualCompactionScenario() {
	const now = Date.now();
	const harness = await createHarness(
		[fauxAssistantMessage("Compacted prior work."), completionResponse],
		{},
		(sessionManager) => {
			sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `Old request ${"x".repeat(100_000)}` }],
				timestamp: now - 4_000,
			});
			sessionManager.appendMessage(fauxAssistantMessage(`Old result ${"y".repeat(100_000)}`));
			sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "Recent request" }],
				timestamp: now - 2_000,
			});
			sessionManager.appendMessage(fauxAssistantMessage("Recent result"));
			sessionManager.appendCustomEntry("goal-state", {
				goal: {
					id: crypto.randomUUID(),
					text: "finish after manual compaction",
					status: "active",
					startedAt: now - 1_000,
					updatedAt: now - 1_000,
					iteration: 1,
					tokensUsed: 0,
					timeUsedSeconds: 1,
					baselineTokens: 0,
				},
			});
		},
	);
	const events = [];
	const unsubscribe = harness.session.subscribe((event) => events.push(event));
	try {
		await harness.session.compact("Summarize for the runtime smoke test.");
		await waitFor(
			() => harness.faux.state.callCount === 2,
			`manual-compaction continuation (${JSON.stringify({
				callCount: harness.faux.state.callCount,
				goalStatus: persistedGoalStatus(harness.session),
				isIdle: harness.session.isIdle,
				events: events.map((event) => event.type),
				extensions: harness.extensions,
				lifecycleEvents: harness.lifecycleEvents,
			})})`,
		);
		await harness.session.agent.waitForIdle();
		assert.equal(persistedGoalStatus(harness.session), null);
		assert.ok(
			harness.session.messages
				.map(storedPromptText)
				.some((text) => text.includes("pi-goal-continuation:")),
		);
	} finally {
		unsubscribe();
		await harness.cleanup();
	}
}

async function runScenarios(scenarios) {
	for (const [name, scenario] of scenarios) {
		console.log(`goal runtime smoke: ${name}`);
		await scenario();
	}
}

if (runtimeMode === "packed") {
	await runScenarios([
		["normal continuation", normalContinuationScenario],
		["strict blocker audit", strictBlockerAuditScenario],
		["reload resume", reloadResumeScenario],
		["manual compaction", manualCompactionScenario],
	]);
	console.log(
		"packed Suite pi-goal lifecycle: multi-turn completion, active reload recovery, strict three-turn blocking, and compaction passed",
	);
} else {
	await runScenarios([
		["agent directory isolation", agentDirectoryIsolationScenario],
		["normal continuation", normalContinuationScenario],
		["strict blocker audit", strictBlockerAuditScenario],
		["runaway no-progress", runawayNoProgressScenario],
		["automatic tool-loop limit", automaticToolLoopLimitScenario],
		["retry at hard limit", retryAtHardLimitScenario],
		["automatic retry ownership", automaticRetryOwnershipScenario],
		["exhausted retry continuation", exhaustedRetryContinuesScenario],
		["ordered queue", orderedQueueScenario],
		["queued input", queuedInputScenario],
		["busy edit ownership", busyEditOwnershipScenario],
		["pause", pauseScenario],
		["reload resume", reloadResumeScenario],
		["frozen queue guard", frozenQueueBlockedToolAbortScenario],
		["stale paused-tool guard", stalePausedToolAbortScenario],
		["budget boundary", budgetBoundaryScenario],
		["budget violation", budgetViolationScenario],
		["budget agent-end fallback", budgetAgentEndFallbackScenario],
		["managed run RPC", managedRunRpcScenario],
		["managed run disabled", managedRunDisabledScenario],
		["manual compaction", manualCompactionScenario],
	]);
	console.log(
		"pi-goal runtime smoke: normal and strict three-turn blocker continuation, runaway guards, retry and busy-edit ownership, ordered queue, queued input, pause and automatic active reload recovery, frozen-queue and stale paused-tool aborts, managed-run RPC, bounded budget behavior, and manual compaction passed",
	);
}
