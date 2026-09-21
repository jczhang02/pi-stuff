import {expect, test} from 'bun:test';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import type {ExtensionContext} from '@earendil-works/pi-coding-agent';
import {dispatchInput, type Dispatch} from '../../src/subagent/protocol';
import type {RunSnapshot} from '../../src/subagent/records';
import {Runs} from '../../src/subagent/runs';
import {saveRuns} from '../../src/subagent/store';

interface TestContext {
  context: ExtensionContext;
  session: Awaited<ReturnType<typeof createAgentSession>>['session'];
  sessionManager: SessionManager;
}

async function createContext(
  cwd: string,
  agentDir: string,
  sessionDir: string,
  sessionId: string,
): Promise<TestContext> {
  const settingsManager = SettingsManager.inMemory({});
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const sessionManager = SessionManager.create(cwd, sessionDir, {
    id: sessionId,
  });
  const created = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    resourceLoader,
    settingsManager,
    sessionManager,
    tools: [],
  });
  await created.session.bindExtensions({mode: 'json'});
  return {
    context: created.session.extensionRunner.createContext(),
    session: created.session,
    sessionManager,
  };
}

function runningRun(
  runId: string,
  taskId: string,
  dispatch: Dispatch,
): RunSnapshot {
  const task = dispatch.tasks[0];
  if (task === undefined) throw new Error('Dispatch did not create a task.');
  return {
    id: runId,
    mode: dispatch.mode,
    notifyPerTask: dispatch.notifyPerTask,
    status: 'running',
    intercom: [],
    tasks: [
      {
        ...task,
        id: taskId,
        requestId: `${runId}-request`,
        history: [],
        status: 'running',
        finalText: '',
        pendingInstructions: [],
        configurationNotes: [],
      },
    ],
  };
}

function runResult(runs: Runs, runId: string): RunSnapshot {
  const result = runs.result(runId);
  if (!('tasks' in result)) throw new Error(`Expected run ${runId}.`);
  return result;
}

async function writeSidecar(
  context: TestContext,
  snapshot: RunSnapshot,
): Promise<string> {
  const parentFile = context.sessionManager.getSessionFile();
  if (parentFile === undefined)
    throw new Error('Parent session did not allocate a file.');
  await Effect.runPromise(saveRuns(parentFile, [snapshot]));
  return `${parentFile}.pi-stuff-subagents.json`;
}

function testDispatch(
  parentCwd: string,
  agent: string,
  task: string,
): Dispatch {
  return dispatchInput(
    {
      command: 'dispatch',
      agent,
      task,
      cwd: '.',
      notifyPerTask: false,
    },
    parentCwd,
  );
}

test('serializes concurrent restore and close lifecycles by generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-restore-'));
  const leftCwd = join(directory, 'left');
  const rightCwd = join(directory, 'right');
  const leftAgentDir = join(directory, 'agent-left');
  const rightAgentDir = join(directory, 'agent-right');
  const leftSessionDir = join(directory, 'sessions-left');
  const rightSessionDir = join(directory, 'sessions-right');
  await Promise.all([
    mkdir(leftCwd),
    mkdir(rightCwd),
    mkdir(leftAgentDir),
    mkdir(rightAgentDir),
    mkdir(leftSessionDir),
    mkdir(rightSessionDir),
  ]);

  let left: TestContext | undefined;
  let right: TestContext | undefined;
  let runs: Runs | undefined;
  try {
    left = await createContext(
      leftCwd,
      leftAgentDir,
      leftSessionDir,
      'parent-left',
    );
    right = await createContext(
      rightCwd,
      rightAgentDir,
      rightSessionDir,
      'parent-right',
    );
    const leftDispatch = testDispatch(leftCwd, 'left-agent', 'LEFT_TASK');
    const rightDispatch = testDispatch(rightCwd, 'right-agent', 'RIGHT_TASK');
    const leftSnapshot = runningRun('run-left', 'task-left', leftDispatch);
    const rightSnapshot = runningRun('run-right', 'task-right', rightDispatch);
    const leftSidecar = await writeSidecar(left, leftSnapshot);
    const rightSidecar = await writeSidecar(right, rightSnapshot);
    const leftBefore = await readFile(leftSidecar, 'utf8');

    const lifecycle = new Runs(() => undefined);
    runs = lifecycle;
    await Promise.all([
      lifecycle.restore(left.context),
      lifecycle.restore(right.context),
    ]);

    expect(() => lifecycle.result('run-left')).toThrow('Unknown run: run-left');
    const restoredRight = runResult(lifecycle, 'run-right');
    expect(restoredRight.tasks[0]?.status).toBe('stopped');
    expect(await readFile(leftSidecar, 'utf8')).toBe(leftBefore);
    const rightAfterRestore = await readFile(rightSidecar, 'utf8');

    await Promise.all([lifecycle.close(), lifecycle.restore(left.context)]);

    expect(() => lifecycle.result('run-right')).toThrow(
      'Unknown run: run-right',
    );
    const restoredLeft = runResult(lifecycle, 'run-left');
    expect(restoredLeft.tasks[0]?.status).toBe('stopped');
    expect(await readFile(rightSidecar, 'utf8')).toBe(rightAfterRestore);
  } finally {
    await runs?.close();
    left?.session.dispose();
    right?.session.dispose();
    await rm(directory, {recursive: true, force: true});
  }
});
