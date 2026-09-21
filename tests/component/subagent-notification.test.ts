import {expect, test} from 'bun:test';
import {
  createAgentSession,
  DefaultResourceLoader,
  initTheme,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runs} from '../../src/subagent/runs';
import type {TaskSnapshot} from '../../src/subagent/records';
import type {Dispatch} from '../../src/subagent/protocol';
import {renderSubagentResult} from '../../src/subagent/tool-view';

const fixtureModel = {
  id: 'fixture',
  name: 'Notification fixture',
  reasoning: false,
  input: ['text'] as const,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
  contextWindow: 8192,
  maxTokens: 1024,
};

function fixtureResponse(report = 'NOTIFICATION_SAFE_REPORT'): Response {
  const chunk = {
    id: 'notification-fixture',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fixture',
    choices: [
      {
        index: 0,
        delta: {content: report},
        finish_reason: null,
      },
    ],
  };
  const done = {
    ...chunk,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
  };
  return new Response(
    `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`,
    {headers: {'content-type': 'text/event-stream'}},
  );
}

function taskById(tasks: readonly TaskSnapshot[], id: string): TaskSnapshot {
  const task = tasks.find(candidate => candidate.id === id);
  if (task === undefined) throw new Error(`Missing task ${id}.`);
  return task;
}

test('recognized subagent results stay structured when expanded', () => {
  initTheme('dark', false);
  // SAFETY: The renderer only calls bold on this intentionally minimal test theme.
  const theme = {bold: (text: string) => text} as Parameters<
    typeof renderSubagentResult
  >[2];
  // SAFETY: The renderer does not read render context for this recognized result.
  const context = {} as Parameters<typeof renderSubagentResult>[3];
  const result = {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'completed',
          tasks: [{agent: 'reviewer', status: 'completed'}],
        }),
      },
    ],
    details: {
      status: 'completed',
      tasks: [
        {
          agent: 'reviewer',
          status: 'completed',
          finalText: 'TOOL_REPORT_MARKER',
          preservationError: 'Commit was not saved.',
          extensionErrors: ['Extension hook failed.'],
        },
      ],
    },
  };
  const collapsed = renderSubagentResult(
    result,
    {expanded: false, isPartial: false},
    theme,
    context,
  );
  const expanded = renderSubagentResult(
    result,
    {expanded: true, isPartial: false},
    theme,
    context,
  );
  const collapsedText = stripTerminalSequences(
    collapsed.render(120).join('\n'),
  );
  const expandedText = stripTerminalSequences(expanded.render(120).join('\n'));
  expect(collapsedText).toContain('reviewer · completed');
  expect(collapsedText).not.toContain('TOOL_REPORT_MARKER');
  expect(expandedText).toContain('TOOL_REPORT_MARKER');
  expect(expandedText).toContain('Commit failed: Commit was not saved.');
  expect(expandedText).toContain('Extension error: Extension hook failed.');
  expect(expandedText).not.toContain('"finalText"');

  const runExpanded = renderSubagentResult(
    {
      content: [
        {
          type: 'text' as const,
          text: '{"status":"completed","persistenceError":"disk full"}',
        },
      ],
      details: {
        status: 'completed',
        persistenceError: 'disk full',
        tasks: [
          {
            agent: 'reviewer',
            status: 'completed',
            extensionErrorCount: 2,
          },
        ],
      },
    },
    {expanded: true, isPartial: false},
    theme,
    context,
  );
  const runExpandedText = stripTerminalSequences(
    runExpanded.render(120).join('\n'),
  );
  expect(runExpandedText).toContain('Persistence failed: disk full');
  expect(runExpandedText).toContain('Extension errors: 2');
  expect(runExpandedText).toContain('Report not included in this result.');
});

test('notification failures do not interrupt dependency execution or continuation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-notify-'));
  const agentDir = join(directory, 'agent');
  await mkdir(agentDir);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (request.method !== 'POST') return new Response(null, {status: 404});
      return fixtureResponse();
    },
  });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = '1';
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>['session']
    | undefined;
  let runs: Runs | undefined;
  try {
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: `${server.url}v1`,
            api: 'openai-completions',
            apiKey: 'offline-fixture',
            models: [fixtureModel],
          },
        },
      }),
    );
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
      allowModelNetwork: false,
    });
    await modelRuntime.refresh({allowNetwork: false});
    const model = modelRuntime.getModel('fixture', 'fixture');
    if (model === undefined) throw new Error('Fixture model was not loaded.');
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd: directory,
      agentDir,
      modelRuntime,
      model,
      resourceLoader,
      tools: [],
      sessionManager: SessionManager.inMemory(directory),
    });
    session = created.session;
    await session.bindExtensions({mode: 'json'});
    const context = session.extensionRunner.createContext();
    const notifications: string[] = [];
    let completedNotice = Promise.withResolvers<void>();
    runs = new Runs((_run, task) => {
      if (!task) {
        completedNotice.resolve();
        return;
      }
      notifications.push(task.id);
      throw new Error(`notification failed for ${task.id}`);
    });
    const dispatch: Dispatch = {
      mode: 'parallel',
      tasks: [
        {
          id: 'first',
          agent: 'first',
          task: 'FIRST_NOTIFY_TASK',
          cwd: directory,
          prompt: '',
          write: false,
          tools: ['read', 'grep', 'find', 'ls'],
          explicitTools: true,
          model: undefined,
          thinking: undefined,
          needs: [],
          maxRuntimeMs: 10000,
        },
        {
          id: 'dependent',
          agent: 'dependent',
          task: 'DEPENDENT_NOTIFY_TASK',
          cwd: directory,
          prompt: '',
          write: false,
          tools: ['read', 'grep', 'find', 'ls'],
          explicitTools: true,
          model: undefined,
          thinking: undefined,
          needs: ['first'],
          maxRuntimeMs: 10000,
        },
      ],
      concurrency: 1,
      autoAwait: false,
      notifyPerTask: true,
    };
    const initial = await runs.dispatch(dispatch, context);
    await completedNotice.promise;
    const completed = await runs.wait(initial.id);
    expect(completed.status).toBe('completed');
    expect(taskById(completed.tasks, 'first').status).toBe('completed');
    expect(taskById(completed.tasks, 'dependent').status).toBe('completed');
    expect(notifications).toEqual(['first', 'dependent']);
    expect(taskById(completed.tasks, 'first').notificationError).toContain(
      'notification failed for first',
    );
    expect(taskById(completed.tasks, 'dependent').notificationError).toContain(
      'notification failed for dependent',
    );

    completedNotice = Promise.withResolvers<void>();
    const continued = await runs.continueTask(
      {
        command: 'follow-up',
        runId: initial.id,
        taskId: 'first',
        message: 'FOLLOWUP_NOTIFY_TASK',
      },
      context,
    );
    await completedNotice.promise;
    const continuedResult = await runs.wait(continued.id);
    expect(continuedResult.status).toBe('completed');
    const current = taskById(continuedResult.tasks, 'first');
    expect(current.status).toBe('completed');
    expect(current.history).toHaveLength(1);
    expect(current.finalText).toContain('NOTIFICATION_SAFE_REPORT');
    expect(notifications).toEqual(['first', 'dependent', 'first']);
    expect(current.notificationError).toContain(
      'notification failed for first',
    );
  } finally {
    await runs?.close();
    session?.dispose();
    await server.stop(true);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    await rm(directory, {recursive: true, force: true});
  }
});

class GatedCompletionFlushRuns extends Runs {
  readonly completionFlushReached = Promise.withResolvers<void>();
  readonly releaseCompletionFlush = Promise.withResolvers<void>();
  private completionFlushGated = false;

  override async flush(): Promise<void> {
    await super.flush();
    if (this.completionFlushGated || this.list()[0]?.status !== 'completed')
      return;
    this.completionFlushGated = true;
    this.completionFlushReached.resolve();
    await this.releaseCompletionFlush.promise;
  }
}

test('completion notification owns the settled snapshot across continuation race', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-notify-race-'));
  const agentDir = join(directory, 'agent');
  await mkdir(agentDir);
  const modelGate = Promise.withResolvers<void>();
  const followupRequestSeen = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, {status: 404});
      const body = await request.text();
      if (body.includes('FOLLOWUP_NOTIFY_RACE_TASK')) {
        followupRequestSeen.resolve();
        await modelGate.promise;
        return fixtureResponse('FOLLOWUP_NOTIFY_RACE_REPORT');
      }
      if (body.includes('INITIAL_NOTIFY_RACE_SIBLING'))
        return fixtureResponse('INITIAL_NOTIFY_RACE_SIBLING_REPORT');
      return fixtureResponse('INITIAL_NOTIFY_RACE_REPORT');
    },
  });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = '1';
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>['session']
    | undefined;
  let runs: GatedCompletionFlushRuns | undefined;
  try {
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: `${server.url}v1`,
            api: 'openai-completions',
            apiKey: 'offline-fixture',
            models: [fixtureModel],
          },
        },
      }),
    );
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
      allowModelNetwork: false,
    });
    await modelRuntime.refresh({allowNetwork: false});
    const model = modelRuntime.getModel('fixture', 'fixture');
    if (model === undefined) throw new Error('Fixture model was not loaded.');
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd: directory,
      agentDir,
      modelRuntime,
      model,
      resourceLoader,
      tools: [],
      sessionManager: SessionManager.inMemory(directory),
    });
    session = created.session;
    await session.bindExtensions({mode: 'json'});
    const context = session.extensionRunner.createContext();
    const notices: Array<{
      status: string;
      reports: string[];
    }> = [];
    const initialNotice = Promise.withResolvers<void>();
    const continuationNotice = Promise.withResolvers<void>();
    let failInitialCompletion = true;
    runs = new GatedCompletionFlushRuns((run, task) => {
      if (task !== undefined) return;
      notices.push({
        status: run.status,
        reports: run.tasks.map(child => child.finalText),
      });
      initialNotice.resolve();
      if (notices.length === 2) continuationNotice.resolve();
      if (failInitialCompletion) {
        failInitialCompletion = false;
        throw new Error('initial completion notification failed');
      }
    });
    const dispatch: Dispatch = {
      mode: 'parallel',
      tasks: [
        {
          id: 'reviewer',
          agent: 'reviewer',
          task: 'INITIAL_NOTIFY_RACE_TASK',
          cwd: directory,
          prompt: '',
          write: false,
          tools: ['read', 'grep', 'find', 'ls'],
          explicitTools: true,
          model: undefined,
          thinking: undefined,
          needs: [],
          maxRuntimeMs: 10000,
        },
        {
          id: 'sibling',
          agent: 'sibling',
          task: 'INITIAL_NOTIFY_RACE_SIBLING',
          cwd: directory,
          prompt: '',
          write: false,
          tools: ['read', 'grep', 'find', 'ls'],
          explicitTools: true,
          model: undefined,
          thinking: undefined,
          needs: [],
          maxRuntimeMs: 10000,
        },
      ],
      concurrency: 2,
      autoAwait: false,
      notifyPerTask: false,
    };
    const initial = await runs.dispatch(dispatch, context);
    await runs.completionFlushReached.promise;
    const continuedPromise = runs.continueTask(
      {
        command: 'follow-up',
        runId: initial.id,
        taskId: 'reviewer',
        message: 'FOLLOWUP_NOTIFY_RACE_TASK',
      },
      context,
    );
    runs.releaseCompletionFlush.resolve();
    await initialNotice.promise;
    expect(notices).toHaveLength(1);
    expect(notices[0]?.status).toBe('completed');
    expect(notices[0]?.reports).toContain('INITIAL_NOTIFY_RACE_REPORT');
    expect(notices[0]?.reports).toContain('INITIAL_NOTIFY_RACE_SIBLING_REPORT');
    const continued = await continuedPromise;
    await followupRequestSeen.promise;

    const continuationComplete = Promise.withResolvers<void>();
    const unsubscribe = runs.subscribe(() => {
      const snapshot = runs?.list()[0];
      if (
        snapshot?.status === 'completed' &&
        snapshot.tasks[0]?.finalText === 'FOLLOWUP_NOTIFY_RACE_REPORT'
      )
        continuationComplete.resolve();
    });
    modelGate.resolve();
    await continuationComplete.promise;
    unsubscribe();
    await continuationNotice.promise;
    expect(continued.tasks[0]?.history).toHaveLength(1);
    expect(notices).toHaveLength(2);
    expect(notices[1]?.status).toBe('completed');
    expect(notices[1]?.reports).toContain('FOLLOWUP_NOTIFY_RACE_REPORT');
    expect(notices[1]?.reports).not.toContain('INITIAL_NOTIFY_RACE_REPORT');
    expect(notices[1]?.reports).not.toContain(
      'INITIAL_NOTIFY_RACE_SIBLING_REPORT',
    );
    expect(continued.tasks[0]?.history[0]?.notificationError).toContain(
      'initial completion notification failed',
    );
  } finally {
    runs?.releaseCompletionFlush.resolve();
    modelGate.resolve();
    await runs?.close();
    session?.dispose();
    await server.stop(true);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    await rm(directory, {recursive: true, force: true});
  }
}, 60000);

test('wait started during completion flush suppresses its completion notice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-notify-wait-'));
  const agentDir = join(directory, 'agent');
  await mkdir(agentDir);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (request.method !== 'POST') return new Response(null, {status: 404});
      return fixtureResponse('WAIT_FLUSH_REPORT');
    },
  });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = '1';
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>['session']
    | undefined;
  let runs: GatedCompletionFlushRuns | undefined;
  try {
    await writeFile(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: `${server.url}v1`,
            api: 'openai-completions',
            apiKey: 'offline-fixture',
            models: [fixtureModel],
          },
        },
      }),
    );
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
      allowModelNetwork: false,
    });
    await modelRuntime.refresh({allowNetwork: false});
    const model = modelRuntime.getModel('fixture', 'fixture');
    if (model === undefined) throw new Error('Fixture model was not loaded.');
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const created = await createAgentSession({
      cwd: directory,
      agentDir,
      modelRuntime,
      model,
      resourceLoader,
      tools: [],
      sessionManager: SessionManager.inMemory(directory),
    });
    session = created.session;
    await session.bindExtensions({mode: 'json'});
    const context = session.extensionRunner.createContext();
    const notices: string[] = [];
    runs = new GatedCompletionFlushRuns((_run, task) => {
      if (task === undefined) notices.push('completion');
    });
    const dispatch: Dispatch = {
      mode: 'single',
      tasks: [
        {
          id: 'waiter',
          agent: 'waiter',
          task: 'WAIT_FLUSH_TASK',
          cwd: directory,
          prompt: '',
          write: false,
          tools: ['read', 'grep', 'find', 'ls'],
          explicitTools: true,
          model: undefined,
          thinking: undefined,
          needs: [],
          maxRuntimeMs: 10000,
        },
      ],
      concurrency: 1,
      autoAwait: false,
      notifyPerTask: false,
    };
    const initial = await runs.dispatch(dispatch, context);
    await runs.completionFlushReached.promise;
    const waiting = runs.wait(initial.id);
    runs.releaseCompletionFlush.resolve();
    const completed = await waiting;
    expect(completed.status).toBe('completed');
    expect(notices).toHaveLength(0);
  } finally {
    runs?.releaseCompletionFlush.resolve();
    await runs?.close();
    session?.dispose();
    await server.stop(true);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    await rm(directory, {recursive: true, force: true});
  }
}, 60000);
