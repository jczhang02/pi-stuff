import {expect, test} from 'bun:test';
import {runAgentLoop, type StreamFn} from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import {Type} from 'typebox';
import type {ChildActivity} from '../../src/subagent/activity';
import {observeActivity} from '../../src/subagent/activity';
import type {TaskRecord} from '../../src/subagent/records';

function taskRecord(): TaskRecord {
  return {
    id: 'task-activity',
    agentId: 'agent-activity',
    dispatchId: 'dispatch-activity',
    parentTaskId: null,
    prompt: 'prompt',
    description: 'description',
    needs: [],
    admittedAt: 1,
    startedAt: 1,
    endedAt: null,
    phase: 'executing',
    outcome: null,
    declaration: null,
    stopOutcome: null,
    durability: 'pending',
    acceptance: null,
    reason: '',
    stage: 'working',
    liveText: '',
    activeTools: [],
    report: '',
    files: [],
    checks: [],
    configuration: {
      model: 'fixture',
      thinking: 'off',
      tools: [],
      ceiling: [],
      cwd: '.',
      workspace: 'live',
      instructions: '',
      role: null,
      copyHistory: false,
      executionTimeoutMs: null,
      extensions: [],
      baseline: null,
      include: [],
    },
    currentTools: [],
    usage: null,
    turns: 0,
    retries: 0,
    executionMs: 0,
    lastEventAt: 1,
    sessionFile: null,
    historyFile: null,
    workspaceDirectory: null,
    baseline: null,
    commit: null,
    baselineRequest: null,
    diff: '',
    artifactError: null,
    unsavedFiles: [],
    ignoredFiles: [],
    events: [],
    consumedChildren: [],
  };
}

function usage(seed: number) {
  return {
    input: seed,
    output: seed + 1,
    cacheRead: seed + 2,
    cacheWrite: seed + 3,
    totalTokens: seed * 4 + 6,
    cost: {
      input: seed / 100,
      output: (seed + 1) / 100,
      cacheRead: (seed + 2) / 100,
      cacheWrite: (seed + 3) / 100,
      total: (seed + 6) / 100,
    },
  };
}

test('counts each persisted usage source once across a tool turn and compaction', () => {
  const assistantUsage = usage(10);
  const toolUsage = usage(20);
  const compactionUsage = usage(30);
  const cacheWarmUsage = usage(40);
  const assistantMessage = {
    role: 'assistant',
    content: [{type: 'text', text: 'Finished.'}],
    api: 'openai-responses',
    provider: 'fixture',
    model: 'fixture',
    usage: assistantUsage,
    stopReason: 'stop',
    timestamp: 2,
  } satisfies Extract<ChildActivity, {type: 'message_end'}>['message'];
  const toolResult = {
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{type: 'text', text: 'contents'}],
    usage: toolUsage,
    isError: false,
    timestamp: 3,
  } satisfies Extract<ChildActivity, {type: 'message_end'}>['message'];
  const events: readonly ChildActivity[] = [
    {type: 'message_end', message: assistantMessage},
    {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'read',
      result: toolResult,
      isError: false,
    },
    {type: 'message_end', message: toolResult},
    {
      type: 'compaction_end',
      reason: 'manual',
      result: {
        summary: 'Compacted.',
        firstKeptEntryId: 'entry-1',
        tokensBefore: 100,
        usage: compactionUsage,
      },
      aborted: false,
      willRetry: false,
    },
    {
      type: 'entry_appended',
      entry: {
        type: 'usage',
        id: 'usage-1',
        parentId: 'entry-1',
        timestamp: '2026-09-20T00:00:00.000Z',
        kind: 'cache_warm',
        provider: 'fixture',
        model: 'fixture',
        usage: cacheWarmUsage,
      },
    },
  ];

  const result = events.reduce(observeActivity, taskRecord());

  expect(result.usage).toEqual({
    input: 100,
    output: 104,
    cacheRead: 108,
    cacheWrite: 112,
    cost: 1.24,
  });
});

test('actual SDK tool events retain a cost-only charge exactly once', async () => {
  const zero = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
  };
  const charged = {...zero, cost: {...zero.cost, total: 0.25}};
  let task = taskRecord();
  let requests = 0;
  const streamFn: StreamFn = () => {
    const stream = createAssistantMessageEventStream();
    const isTool = requests++ === 0;
    const message = {
      role: 'assistant',
      content: isTool
        ? [
            {
              type: 'toolCall',
              id: 'call',
              name: 'charged_lookup',
              arguments: {},
            },
          ]
        : [{type: 'text', text: 'done'}],
      api: 'openai-completions',
      provider: 'fixture',
      model: 'fixture',
      usage: zero,
      stopReason: isTool ? 'toolUse' : 'stop',
      timestamp: 1,
    } satisfies AssistantMessage;
    stream.push({type: 'done', reason: message.stopReason, message});
    return stream;
  };
  await runAgentLoop(
    [{role: 'user', content: 'look up', timestamp: 1}],
    {
      systemPrompt: '',
      messages: [],
      tools: [
        {
          name: 'charged_lookup',
          label: 'lookup',
          description: 'lookup',
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{type: 'text', text: 'found'}],
            details: {},
            usage: charged,
          }),
        },
      ],
    },
    {
      model: {
        id: 'fixture',
        name: 'fixture',
        provider: 'fixture',
        api: 'openai-completions',
        baseUrl: 'http://fixture.invalid',
        reasoning: false,
        input: ['text'],
        cost: zero.cost,
        contextWindow: 4096,
        maxTokens: 1024,
      },
      convertToLlm: messages =>
        messages.filter(
          message =>
            message.role === 'user' ||
            message.role === 'assistant' ||
            message.role === 'toolResult',
        ),
    },
    event => {
      if (event.type === 'message_end' || event.type === 'tool_execution_end')
        task = observeActivity(task, event);
    },
    undefined,
    streamFn,
  );
  expect(requests).toBe(2);
  expect(task.usage).toEqual({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.25,
  });
});
