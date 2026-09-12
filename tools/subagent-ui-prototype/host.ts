import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  InteractiveMode,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import type {AssistantMessage, Usage} from '@earendil-works/pi-ai';
import {createFleetExtension} from './index';
import {createAgents, fixtureModel, usageFor} from './model';

const cwd = process.env.PI_PROTOTYPE_PROJECT_CWD ?? process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR ?? cwd;
const agents = createAgents(process.env.PI_PROTOTYPE_SCENARIO === 'completed');
const sessions = new Map<string, {session: AgentSession; usage: Usage}>();

const fleetExtension: ExtensionFactory = pi =>
  createFleetExtension(agents, agent => {
    const entry = sessions.get(agent.id);
    if (!entry) {
      throw new Error('Fleet extension session is not initialized');
    }
    // SessionManager.inMemory retains this owned fixture message by reference.
    // Updating its usage keeps the native footer and Fleet on the same sample.
    Object.assign(entry.usage, usageFor(agent));
    return entry.session;
  })(pi);

const createRuntime = async (options: {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManager;
}) => {
  const settingsManager = SettingsManager.inMemory({quietStartup: true});
  const modelRuntime = await ModelRuntime.create({
    authPath: `${options.agentDir}/auth.json`,
    modelsPath: null,
    modelsStorePath: `${options.agentDir}/models-cache.json`,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const serviceOptions = {
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    modelRuntime,
    resourceLoaderOptions: {
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      noExtensions: true,
    },
  };
  const childServices = await createAgentSessionServices(serviceOptions);
  const services = await createAgentSessionServices({
    ...serviceOptions,
    resourceLoaderOptions: {
      ...serviceOptions.resourceLoaderOptions,
      extensionFactories: [{name: 'fleet-prototype', factory: fleetExtension}],
    },
  });
  let mainResult;
  for (const agent of agents) {
    const sessionManager =
      agent.id === 'main'
        ? options.sessionManager
        : SessionManager.inMemory(options.cwd);
    const message: AssistantMessage = {
      role: 'assistant',
      content: agent.messages
        .slice(1, 2)
        .flatMap(entry =>
          entry.kind === 'assistant'
            ? [{type: 'text' as const, text: entry.text}]
            : [],
        ),
      api: fixtureModel.api,
      provider: fixtureModel.provider,
      model: fixtureModel.id,
      usage: usageFor(agent),
      stopReason: 'stop',
      timestamp: Date.now(),
    };
    sessionManager.appendMessage({
      role: 'user',
      content: agent.task,
      timestamp: Date.now(),
    });
    sessionManager.appendMessage(message);
    const result = await createAgentSessionFromServices({
      services: agent.id === 'main' ? services : childServices,
      sessionManager,
      model: fixtureModel,
      thinkingLevel: 'medium',
      noTools: 'all',
    });
    sessions.set(agent.id, {session: result.session, usage: message.usage});
    if (agent.id === 'main') mainResult = result;
  }
  if (!mainResult) throw new Error('Prototype needs a main session');
  return {...mainResult, services, diagnostics: services.diagnostics};
};

const sessionManager = SessionManager.inMemory(cwd);
const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager,
});
const interactive = new InteractiveMode(runtime, {
  tuiMode: 'fullscreen',
  initialThemeSetting: process.env.PI_PROTOTYPE_THEME ?? 'light/dark',
});
try {
  await interactive.run();
} finally {
  for (const entry of sessions.values()) entry.session.dispose();
}
