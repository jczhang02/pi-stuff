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
import {createFleetExtension} from './index';

const cwd = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR ?? cwd;
let activeSession: AgentSession | undefined;

const fleetExtension: ExtensionFactory = pi =>
  createFleetExtension(() => {
    if (!activeSession) {
      throw new Error('Fleet extension session is not initialized');
    }
    return activeSession;
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
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    modelRuntime,
    resourceLoaderOptions: {
      extensionFactories: [{name: 'fleet-prototype', factory: fleetExtension}],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      noExtensions: true,
    },
  });
  const result = await createAgentSessionFromServices({
    services,
    sessionManager: options.sessionManager,
    noTools: 'all',
  });
  activeSession = result.session;
  return {...result, services, diagnostics: services.diagnostics};
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
await interactive.run();
