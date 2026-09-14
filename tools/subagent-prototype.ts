// Throwaway real-Pi UI host. Live models by default, explicit offline scenarios.
import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from '@earendil-works/pi-ai';
import {
  AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionServices,
  InteractiveMode,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  getAgentDir,
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  type InteractiveModeOptions,
} from '@earendil-works/pi-coding-agent';
import {Effect, Schema} from 'effect';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSubagentPrototype} from '../index';
import {createLiveSessionFactory} from '../src/subagents/prototype-live';

class PrototypeLaunchError extends Schema.TaggedError<PrototypeLaunchError>()(
  'PrototypeLaunchError',
  {message: Schema.String},
) {}

function mainReply(model: Model<Api>, context: Context) {
  const stream = createAssistantMessageEventStream();
  const last = context.messages.at(-1);
  const text =
    last?.role === 'user'
      ? 'I will include that in the review. The subagent tree has their current activity and results.'
      : 'I am comparing the cancellation paths and the task ownership rules.';
  const message: AssistantMessage = {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{type: 'text', text}],
    usage: {
      input: 120,
      output: 24,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 144,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({type: 'start', partial: message});
    stream.push({type: 'text_start', contentIndex: 0, partial: message});
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: text,
      partial: message,
    });
    stream.push({
      type: 'text_end',
      contentIndex: 0,
      content: text,
      partial: message,
    });
    stream.push({type: 'done', reason: 'stop', message});
    stream.end();
  });
  return stream;
}

function selectLiveModel(
  runtime: ModelRuntime,
  settings: SettingsManager,
  reference: string | undefined,
): Model<Api> {
  const separator = reference?.indexOf('/') ?? -1;
  if (reference !== undefined && separator < 1)
    throw new Error('Use provider/model for the optional model argument.');
  const provider =
    reference?.slice(0, separator) ?? settings.getDefaultProvider();
  const modelId = reference?.slice(separator + 1) ?? settings.getDefaultModel();
  if (!provider || !modelId)
    throw new Error('Choose a model in Pi first, or pass live provider/model.');
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error(`Pi cannot find model ${provider}/${modelId}.`);
  return model;
}

async function runHost(
  directory: string,
  scenario: string,
  modelReference: string | undefined,
) {
  const live = scenario === 'live';
  const userAgentDir = getAgentDir();
  const userSettings = live
    ? SettingsManager.create(process.cwd(), userAgentDir)
    : undefined;
  const agentDir = join(directory, 'agent');
  const cwd = join(directory, 'workspace');
  process.env.PI_CODING_AGENT_DIR = agentDir;
  if (!live) process.env.PI_OFFLINE = '1';
  // Match the inspected Ghostty light profile in this isolated terminal.
  process.stdout.write(
    '\x1b]10;#4c4f69\x07\x1b]11;#eff1f5\x07\x1b]12;#dc8a78\x07',
  );
  const settings = SettingsManager.inMemory({
    theme: 'light',
    tuiMode: 'fullscreen',
    quietStartup: true,
    enableSkillCommands: false,
    compaction: {enabled: false},
    retry: {enabled: false},
    transport: userSettings?.getTransport() ?? 'auto',
  });
  const modelRuntime = await ModelRuntime.create(
    live
      ? {
          authPath: join(userAgentDir, 'auth.json'),
          modelsPath: join(userAgentDir, 'models.json'),
          modelsStore: new InMemoryModelsStore(),
          allowModelNetwork: false,
        }
      : {
          credentials: new InMemoryCredentialStore(),
          modelsStore: new InMemoryModelsStore(),
          modelsPath: null,
          allowModelNetwork: false,
          refreshOnCreate: false,
        },
  );
  if (!live)
    modelRuntime.registerProvider('openai-codex', {
      api: 'openai-responses',
      apiKey: 'local-fixture',
      streamSimple: mainReply,
      models: [
        {
          id: 'gpt-6-astra',
          name: 'gpt-6-astra',
          reasoning: true,
          input: ['text'],
          cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
          contextWindow: 272000,
          maxTokens: 16384,
        },
      ],
    });
  const selectedModel = userSettings
    ? selectLiveModel(modelRuntime, userSettings, modelReference)
    : modelRuntime.getModel('openai-codex', 'gpt-6-astra');
  if (!selectedModel) throw new Error('The selected model is not registered.');
  const thinkingLevel =
    userSettings?.getModelThinkingLevel(
      selectedModel.provider,
      selectedModel.id,
    ) ??
    userSettings?.getDefaultThinkingLevel() ??
    (live ? 'medium' : 'high');
  let activeSession: AgentSession | undefined;
  const createChild = live
    ? createLiveSessionFactory(
        modelRuntime,
        () => activeSession?.model ?? selectedModel,
        () => activeSession?.thinkingLevel ?? thinkingLevel,
        settings,
      )
    : undefined;
  const factory: CreateAgentSessionRuntimeFactory = async options => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager: settings,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        appendSystemPrompt: live
          ? [
              'You coordinate lifecycle, packages and reviewer, three background subagents already assigned to inspect the supplied cancellation sample files. Use the subagent tool to inspect their actual tasks and results or control them when requested. Do not invent results or claim work is complete while it is still running. Keep all user-facing text in English.',
            ]
          : [],
        extensionFactories: [
          createSubagentPrototype(
            () => {
              if (!activeSession)
                throw new Error('The main session is not ready.');
              return activeSession;
            },
            scenario,
            agentDir,
            async () => {
              process.stdout.write('\x1b]110\x07\x1b]111\x07\x1b]112\x07');
              await rm(directory, {recursive: true, force: true});
            },
            createChild,
          ),
        ],
      },
    });
    const result = await createAgentSessionFromServices({
      services,
      sessionManager: options.sessionManager,
      model: selectedModel,
      thinkingLevel,
      noTools: live ? 'builtin' : 'all',
    });
    activeSession = result.session;
    return {...result, services, diagnostics: []};
  };
  const sessionManager = SessionManager.inMemory(cwd);
  if (!live) {
    sessionManager.appendMessage({
      role: 'user',
      content:
        'Review our subagent cancellation design against the existing packages.\nRun two investigations in parallel, then have a reviewer compare the findings.',
      timestamp: Date.now(),
    });
    sessionManager.appendMessage({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: "I'll ask one agent to trace cancellation and another to inspect package behavior.\nThe reviewer will compare their findings after both investigations finish.\n\nWhile they work, I'll check the decisions we already agreed on.",
        },
      ],
      api: 'openai-responses',
      provider: 'openai-codex',
      model: 'gpt-6-astra',
      usage: {
        input: 240,
        output: 51,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 291,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    });
  }
  const initial = await factory({cwd, agentDir, sessionManager});
  const runtime = new AgentSessionRuntime(
    initial.session,
    initial.services,
    factory,
  );
  try {
    const options: InteractiveModeOptions = {
      tuiMode: 'fullscreen',
      initialThemeSetting: 'light',
    };
    if (live)
      options.initialMessage =
        'Review the sample cancellation design. Inspect the assigned subagents and briefly explain what they are checking. Use their actual results when available.';
    await new InteractiveMode(runtime, options).run();
  } finally {
    await runtime.dispose();
  }
}

const program = Effect.gen(function* () {
  const scenario = yield* Schema.decodeUnknownEffect(
    Schema.Literals([
      'collaboration',
      'live',
      'question',
      'followup',
      'cancel',
      'failure',
    ]),
  )(process.argv[2] ?? 'live');
  if (scenario !== 'live' && process.argv[3] !== undefined)
    return yield* Effect.fail(
      new PrototypeLaunchError({
        message: 'A model argument is only valid with live mode.',
      }),
    );
  const directory = yield* Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), 'pi-subagent-PROTOTYPE-')),
    catch: () =>
      new PrototypeLaunchError({
        message: 'Cannot create the isolated prototype workspace.',
      }),
  });
  const run = Effect.tryPromise({
    try: async () => {
      await mkdir(join(directory, 'agent'));
      await mkdir(join(directory, 'workspace'));
      await writeFile(
        join(directory, 'workspace', 'cancellation.ts'),
        'export async function cancelBranch(task, children) {\n  task.status = "cancelling";\n  task.acceptsChildren = false;\n  await Promise.all(children.map(child => child.abort()));\n  await task.abort();\n  task.status = "cancelled";\n}\n',
      );
      await writeFile(
        join(directory, 'workspace', 'cancellation.test.ts'),
        'A cancelled parent must wait for all owned descendants to stop.\nCompleted results remain unchanged.\nA later task must not start until the previous tool has stopped.\n',
      );
      await writeFile(
        join(directory, 'workspace', 'packages.md'),
        'arhen pi-core-subagent supports parallel tasks, chains, dependencies, steering, ask_parent and cancellation.\nIts original cancelTask marks a task aborted before child.abort finishes.\nCompleted-agent follow-up and recursive delegation require adaptation.\n',
      );
      await runHost(directory, scenario, process.argv[3]);
    },
    catch: error => new PrototypeLaunchError({message: String(error)}),
  });
  yield* run.pipe(
    Effect.ensuring(
      Effect.promise(() => rm(directory, {recursive: true, force: true})),
    ),
  );
});

await Effect.runPromise(program);
