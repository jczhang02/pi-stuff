// Real SDK host for the agreed layout; fixture.ts supplies only the model boundary.
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  InteractiveMode,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';
import {join} from 'node:path';
import {installRuntimeFleet} from './extension';

const cwd = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR;
if (!agentDir) throw new Error('Set an isolated PI_CODING_AGENT_DIR');
const createRuntime: CreateAgentSessionRuntimeFactory = async options => {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(options.agentDir, 'auth.json'),
    modelsPath: join(options.agentDir, 'models.json'),
    allowModelNetwork: false,
  });
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir);
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime,
    settingsManager,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: process.env.PI_E2E_COMPANION
        ? [process.env.PI_E2E_COMPANION]
        : [],
      extensionFactories: [
        {
          name: 'subagent-fleet',
          factory: pi => {
            installRuntimeFleet(pi, () => runtime.session);
          },
        },
      ],
    },
  });
  const model = modelRuntime.getModel('local', 'development');
  if (!model) throw new Error('Local verification model is missing');
  const result = await createAgentSessionFromServices({
    services,
    sessionManager: options.sessionManager,
    model,
    thinkingLevel: 'off',
  });
  return {...result, services, diagnostics: services.diagnostics};
};
const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager: SessionManager.create(cwd),
});
const interactive = new InteractiveMode(runtime, {
  tuiMode: 'fullscreen',
  initialThemeSetting: process.env.PI_RUNTIME_THEME ?? 'light',
});
await interactive.run();
