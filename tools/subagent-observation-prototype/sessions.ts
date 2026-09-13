// Native sessions supply footer metadata only; Transcript owns sample history.
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {join} from 'node:path';
import {fixtureModel, usageFor, type ObservationAgent} from './scenario';

export async function createSessions(
  agents: ObservationAgent[],
  cwd: string,
  agentDir: string,
) {
  const services = await Effect.runPromise(
    Effect.promise(async () => {
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'),
        modelsPath: null,
        modelsStorePath: join(agentDir, 'models-cache.json'),
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      return createAgentSessionServices({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager: SettingsManager.inMemory({quietStartup: true}),
        resourceLoaderOptions: {
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          noExtensions: true,
        },
      });
    }),
  );
  const sessions = new Map<string, AgentSession>();
  const usageRefs = agents.map(agent => usageFor(agent));
  const dispose = () => {
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
  };
  try {
    for (const [index, agent] of agents.entries()) {
      const usage = usageRefs[index];
      if (!usage) throw new Error('Missing agent usage');
      const sessionManager = SessionManager.inMemory(cwd);
      sessionManager.appendMessage({
        role: 'user',
        content: agent.task,
        timestamp: 0,
      });
      sessionManager.appendMessage({
        role: 'assistant',
        content: [{type: 'text', text: agent.activity}],
        api: fixtureModel.api,
        provider: fixtureModel.provider,
        model: fixtureModel.id,
        usage,
        stopReason: 'stop',
        timestamp: 1,
      });
      const result = await Effect.runPromise(
        Effect.promise(() =>
          createAgentSessionFromServices({
            services,
            sessionManager,
            model: fixtureModel,
            thinkingLevel: 'medium',
            noTools: 'all',
          }),
        ),
      );
      sessions.set(agent.id, result.session);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    sessions,
    dispose,
    syncUsage() {
      for (const [index, agent] of agents.entries()) {
        const usage = usageRefs[index];
        if (usage) Object.assign(usage, usageFor(agent));
      }
    },
  };
}
