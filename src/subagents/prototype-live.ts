import type {ThinkingLevel} from '@earendil-works/pi-agent-core';
import type {Api, Model} from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';
import {
  createPrototypeTools,
  type AskParent,
  type ChildSessionFactory,
  type NotifyParent,
  type PrototypeSession,
} from './prototype-provider';

export function createLiveSessionFactory(
  modelRuntime: ModelRuntime,
  selectModel: () => Model<Api>,
  selectThinkingLevel: () => ThinkingLevel,
  settingsManager: SettingsManager,
): ChildSessionFactory {
  return async (
    cwd: string,
    agentDir: string,
    agentName: string,
    taskId: string,
    _scenario: string,
    askParent: AskParent,
    notifyParent: NotifyParent,
  ): Promise<PrototypeSession> => {
    const model = selectModel();
    const thinkingLevel = selectThinkingLevel();
    let activeTaskId = taskId;
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      appendSystemPrompt: [
        `You are the ${agentName} subagent in FleetView. Inspect the bounded cancellation files, report concrete findings, and use ask_parent only when blocked. Keep user-facing text in English.`,
      ],
    });
    await loader.reload();

    const tools = createPrototypeTools(
      cwd,
      0,
      () => activeTaskId,
      askParent,
      notifyParent,
    );
    const created = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      model,
      thinkingLevel,
      tools: tools.map(tool => tool.name),
      customTools: tools,
    });
    created.session.setSessionName(`subagent: ${agentName}`);
    return {
      session: created.session,
      setActiveTask: (nextTaskId: string): void => {
        activeTaskId = nextTaskId;
      },
    };
  };
}
