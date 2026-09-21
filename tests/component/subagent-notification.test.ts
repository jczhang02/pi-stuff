import {expect, test} from 'bun:test';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runs} from '../../src/subagent/runs';
import type {TaskSnapshot} from '../../src/subagent/records';
import type {Dispatch} from '../../src/subagent/protocol';

const fixtureModel = {
  id: 'fixture',
  name: 'Notification fixture',
  reasoning: false,
  input: ['text'] as const,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
  contextWindow: 8192,
  maxTokens: 1024,
};

function fixtureResponse(): Response {
  const chunk = {
    id: 'notification-fixture',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fixture',
    choices: [
      {
        index: 0,
        delta: {content: 'NOTIFICATION_SAFE_REPORT'},
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
    runs = new Runs((_run, task) => {
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
      autoAwait: true,
      notifyPerTask: true,
    };
    const initial = await runs.dispatch(dispatch, context);
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

    const continued = await runs.continueTask(
      {
        command: 'follow-up',
        runId: initial.id,
        taskId: 'first',
        message: 'FOLLOWUP_NOTIFY_TASK',
      },
      context,
    );
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
