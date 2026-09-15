// Adapted from @arhen/pi-core-subagent 1.3.54, src/child.ts and the child
// setup in src/manager.ts, commit de1c8783c2a39b1cbb0f86b412307193de9774c1.
// Child sessions are kept independent of the upstream widget and extension
// loader so the inline tree can observe the same Pi session events directly.

import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai';
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  StringEnum,
  type FauxProviderHandle,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentToolResult,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {Type, type Static} from 'typebox';

export type AskParent = (
  taskId: string,
  question: string,
  signal: AbortSignal | undefined,
) => Promise<string>;

export type NotifyParent = (
  taskId: string,
  message: string,
  level: 'info' | 'warning' | 'error',
) => void;

export interface PrototypeSession {
  readonly session: AgentSession;
  readonly provider?: FauxProviderHandle;
  readonly setActiveTask: (taskId: string) => void;
}

export type ChildSessionFactory = (
  cwd: string,
  agentDir: string,
  agentName: string,
  taskId: string,
  scenario: string,
  askParent: AskParent,
  notifyParent: NotifyParent,
) => Promise<PrototypeSession>;

const INSPECT_PARAMETERS = Type.Object({path: Type.String()});
const ASK_PARAMETERS = Type.Object({question: Type.String()});
const NOTIFY_PARAMETERS = Type.Object({
  message: Type.String(),
  level: Type.Optional(StringEnum(['info', 'warning', 'error'] as const)),
});

interface InspectionDetails {
  readonly path: string;
  readonly bytes: number;
  readonly elapsedMs: number;
}

interface AskDetails {
  readonly answered: boolean;
}

interface NotifyDetails {
  readonly delivered: boolean;
}

interface ResponseConfig {
  readonly scenario: string;
  readonly agentName: string;
  readonly taskId: string;
}

let providerSequence = 0;

type ContentBlock = TextContent | ImageContent;

function isContentBlocks(
  content: string | readonly ContentBlock[],
): content is readonly ContentBlock[] {
  return Array.isArray(content);
}

function textOfMessage(message: Message): string {
  if (message.role === 'user') return textOfContent(message.content);
  if (message.role === 'assistant')
    return message.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('');
  return message.content
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('');
}

function textOfContent(
  content: string | readonly (TextContent | ImageContent)[],
): string {
  if (isContentBlocks(content))
    return content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('');
  return content;
}

function userMessages(context: Context): UserMessage[] {
  return context.messages.filter(
    (message): message is UserMessage => message.role === 'user',
  );
}

function toolResults(context: Context): ToolResultMessage[] {
  return context.messages.filter(
    (message): message is ToolResultMessage => message.role === 'toolResult',
  );
}

export function inspectionPathFor(agentName: string, scenario: string): string {
  if (scenario === 'failure') return 'missing-cancellation.ts';
  if (agentName === 'packages') return 'packages.md';
  if (agentName === 'reviewer') return 'cancellation.test.ts';
  if (agentName === 'probe') return 'cancellation.test.ts';
  return 'cancellation.ts';
}

function finalText(
  config: ResponseConfig,
  context: Context,
  baselineUserMessageCount: number,
): string {
  const steering =
    userMessages(context).length > baselineUserMessageCount &&
    config.scenario !== 'followup';
  if (config.scenario === 'followup' && baselineUserMessageCount > 1) {
    return 'Follow-up complete. I retained the earlier context and checked the revised cancellation files from the new task.';
  }
  if (config.agentName === 'reviewer') {
    return steering
      ? 'Review updated after the steering note. The dependency findings still support the cancellation design.'
      : 'Review complete. The lifecycle and package findings agree, and the cancellation test covers the stop boundary.';
  }
  if (config.agentName === 'packages') {
    return steering
      ? 'Package comparison updated with the steering note. The existing manager supplies graph scheduling and session events.'
      : 'Package inspection complete. The report covers Pi session events, graph handoff and child communication as separate capabilities.';
  }
  return steering
    ? 'Lifecycle inspection updated after steering. Cancellation remains pending until the active file read has stopped.'
    : 'Lifecycle inspection complete. The task remains attached to its child branch until active work settles.';
}

function responseFor(
  config: ResponseConfig,
  context: Context,
  baselineUserMessageCount: number,
): AssistantMessage {
  const results = toolResults(context);
  const failed = results.find(result => result.isError);
  if (failed) {
    return fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: `${config.agentName} could not inspect the file: ${textOfMessage(failed)}`,
    });
  }

  if (
    config.scenario === 'question' &&
    config.agentName === 'lifecycle' &&
    results.some(result => result.toolName === 'inspect_cancellation') &&
    !results.some(result => result.toolName === 'ask_parent')
  ) {
    return fauxAssistantMessage(
      [
        fauxText(
          'I need one detail before I can finish the cancellation trace.',
        ),
        fauxToolCall('ask_parent', {
          question:
            'Which command was still running after you cancelled the task?',
        }),
      ],
      {stopReason: 'toolUse'},
    );
  }

  if (results.length === 0) {
    return fauxAssistantMessage(
      [
        fauxText(`Inspecting the ${config.agentName} cancellation files.`),
        fauxToolCall('inspect_cancellation', {
          path: inspectionPathFor(config.agentName, config.scenario),
        }),
      ],
      {stopReason: 'toolUse'},
    );
  }

  return fauxAssistantMessage(
    finalText(config, context, baselineUserMessageCount),
    {stopReason: 'stop'},
  );
}

function createResponseFactory(
  config: ResponseConfig,
  provider: FauxProviderHandle,
): FauxResponseFactory {
  let firstResponse = true;
  let baselineUserMessageCount = 0;
  const factory: FauxResponseFactory = context => {
    provider.appendResponses([factory]);
    if (firstResponse) {
      firstResponse = false;
      baselineUserMessageCount = userMessages(context).length;
      return fauxAssistantMessage(
        [
          fauxText(`Inspecting the ${config.agentName} cancellation path.`),
          fauxToolCall('inspect_cancellation', {
            path: inspectionPathFor(config.agentName, config.scenario),
          }),
        ],
        {stopReason: 'toolUse'},
      );
    }
    return responseFor(config, context, baselineUserMessageCount);
  };
  return factory;
}

export function resetPrototypeResponse(
  provider: FauxProviderHandle,
  agentName: string,
  taskId: string,
  scenario: string,
): void {
  const response = createResponseFactory(
    {scenario, agentName, taskId},
    provider,
  );
  provider.setResponses([response]);
}

function delayWithAbort(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (abortTimer) clearTimeout(abortTimer);
      signal?.removeEventListener('abort', onAbort);
      timer = undefined;
      abortTimer = undefined;
    };
    const finish = (): void => {
      cleanup();
      resolve();
    };
    const abort = (): void => {
      if (abortTimer) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      abortTimer = setTimeout(() => {
        cleanup();
        reject(new Error('Inspection stopped after cancellation.'));
      }, 1500);
    };
    const onAbort = (): void => abort();
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) abort();
    else timer = setTimeout(finish, delayMs);
  });
}

function inspectTool(cwd: string, delayMs: number) {
  return {
    name: 'inspect_cancellation',
    label: 'Inspect cancellation',
    description:
      'Read one bounded cancellation file supplied by the parent task.',
    promptSnippet: 'Inspect the supplied cancellation file.',
    parameters: INSPECT_PARAMETERS,
    executionMode: 'sequential',
    async execute(
      _toolCallId,
      params: Static<typeof INSPECT_PARAMETERS>,
      signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<InspectionDetails>> {
      const started = Date.now();
      await delayWithAbort(delayMs, signal);
      const allowed = new Set([
        'cancellation.ts',
        'cancellation.test.ts',
        'packages.md',
      ]);
      if (!allowed.has(params.path))
        throw new Error(`File is unavailable: ${params.path}`);
      const content = await Effect.runPromise(
        Effect.tryPromise({
          try: () => readFile(join(cwd, params.path), 'utf8'),
          catch: () => new Error(`Could not read ${params.path}.`),
        }),
        {signal},
      );
      return {
        content: [{type: 'text', text: content.slice(0, 2400)}],
        details: {
          path: params.path,
          bytes: content.length,
          elapsedMs: Date.now() - started,
        },
      };
    },
  } satisfies ToolDefinition<typeof INSPECT_PARAMETERS, InspectionDetails>;
}

function askTool(getTaskId: () => string, askParent: AskParent) {
  return {
    name: 'ask_parent',
    label: 'Ask parent',
    description: 'Ask the parent one focused question and wait for its answer.',
    promptSnippet: 'Ask the parent when required information is missing.',
    executionMode: 'sequential',
    parameters: ASK_PARAMETERS,
    async execute(
      _toolCallId,
      params: Static<typeof ASK_PARAMETERS>,
      signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<AskDetails>> {
      const answer = await askParent(getTaskId(), params.question, signal);
      return {
        content: [{type: 'text', text: answer || '(parent gave no answer)'}],
        details: {answered: Boolean(answer)},
      };
    },
  } satisfies ToolDefinition<typeof ASK_PARAMETERS, AskDetails>;
}

function notifyTool(getTaskId: () => string, notifyParent: NotifyParent) {
  return {
    name: 'notify_parent',
    label: 'Notify parent',
    description: 'Send a non-blocking finding to the parent agent.',
    promptSnippet: 'Send a short update to the parent.',
    parameters: NOTIFY_PARAMETERS,
    async execute(
      _toolCallId,
      params: Static<typeof NOTIFY_PARAMETERS>,
      _signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<NotifyDetails>> {
      notifyParent(getTaskId(), params.message, params.level ?? 'info');
      return {
        content: [{type: 'text', text: 'Sent.'}],
        details: {delivered: true},
      };
    },
  } satisfies ToolDefinition<typeof NOTIFY_PARAMETERS, NotifyDetails>;
}

type PrototypeTool =
  | ReturnType<typeof inspectTool>
  | ReturnType<typeof askTool>
  | ReturnType<typeof notifyTool>;

export function createPrototypeTools(
  cwd: string,
  delayMs: number,
  getTaskId: () => string,
  askParent: AskParent,
  notifyParent: NotifyParent,
): PrototypeTool[] {
  return [
    inspectTool(cwd, delayMs),
    askTool(getTaskId, askParent),
    notifyTool(getTaskId, notifyParent),
  ];
}

function fixtureDelay(scenario: string, agentName: string): number {
  if (scenario === 'cancel' && agentName === 'lifecycle') return 30_000;
  if (scenario === 'cancel' && agentName === 'probe') return 30_000;
  if (scenario === 'cancel' && agentName === 'packages') return 5_000;
  if (scenario === 'collaboration' || scenario === 'steer')
    return agentName === 'lifecycle' ? 30_000 : 20_000;
  if (scenario === 'question') return 450;
  if (scenario === 'failure') return 350;
  return 120;
}

export async function createPrototypeSession(
  cwd: string,
  agentDir: string,
  agentName: string,
  taskId: string,
  scenario: string,
  askParent: AskParent,
  notifyParent: NotifyParent,
): Promise<PrototypeSession> {
  const sequence = providerSequence++;
  let activeTaskId = taskId;
  const provider = fauxProvider({
    api: `fleet-faux-api-${sequence}`,
    provider: `fleet-faux-${sequence}`,
    models: [{id: 'fleet-agent', name: 'Fleet agent', reasoning: false}],
    tokensPerSecond: 48,
  });
  const config = {scenario, agentName, taskId} satisfies ResponseConfig;
  const response = createResponseFactory(config, provider);
  provider.setResponses([response]);

  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(provider.provider);

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: [
      `You are the ${agentName} subagent in FleetView. Inspect the bounded cancellation files, report concrete findings, and use ask_parent only when blocked.`,
    ],
  });
  await loader.reload();

  const model = provider.getModel();
  if (!model) throw new Error('The local provider did not expose a model.');
  const tools = createPrototypeTools(
    cwd,
    fixtureDelay(scenario, agentName),
    () => activeTaskId,
    askParent,
    notifyParent,
  );
  const created = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    model,
    thinkingLevel: 'off',
    tools: tools.map(tool => tool.name),
    customTools: tools,
  });
  created.session.setSessionName(`subagent: ${agentName}`);
  return {
    session: created.session,
    provider,
    setActiveTask: (nextTaskId: string): void => {
      activeTaskId = nextTaskId;
    },
  };
}
