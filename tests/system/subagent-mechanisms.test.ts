import {expect, test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchTerminal, type Session} from 'tuistory';
import {
  createSubagentMechanismFixture,
  messageText,
  type ChildRequest,
  type SidecarRun,
} from './fixtures/subagent-mechanisms';

type Fixture = Awaited<ReturnType<typeof createSubagentMechanismFixture>>;

function environment(directory: string, agentDir: string) {
  return {
    ...Object.fromEntries(
      Object.keys(process.env).map(key => [key, undefined]),
    ),
    PATH: process.env.PATH,
    HOME: directory,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: `${agentDir}/sessions`,
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    NO_PROXY: 'localhost,127.0.0.1',
  };
}

function screen(terminal: Session): string {
  return terminal
    .getTerminalData()
    .lines.slice(-terminal.currentRows)
    .map(line => line.spans.map(span => span.text).join(''))
    .join('\n');
}

async function waitScreen(
  terminal: Session,
  marker: string,
  timeout = 15_000,
): Promise<void> {
  await terminal.text({
    timeout,
    trimEnd: true,
    waitFor: () => screen(terminal).includes(marker),
  });
}

async function send(terminal: Session, text: string): Promise<void> {
  await terminal.type(text);
  await terminal.press('enter');
}

async function launch(fixture: Fixture): Promise<Session> {
  const host = process.env.PI_TEST_HOST ?? process.execPath;
  return launchTerminal({
    command: host,
    args: [
      ...(process.env.PI_TEST_HOST
        ? []
        : [
            resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
          ]),
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-context-files',
      '--no-prompt-templates',
      '--no-themes',
      '--no-approve',
      '--provider',
      'mechanism',
      '--model',
      'mechanism-fixture',
      '-e',
      resolve('src/pi/index.ts'),
    ],
    cwd: fixture.cwd,
    cols: 140,
    rows: 42,
    env: environment(fixture.directory, fixture.agentDir),
  });
}

async function closeTerminal(
  terminal: Session,
  fixture: Fixture,
): Promise<void> {
  try {
    terminal.killProcess();
    await terminal.waitForExit(10_000);
  } finally {
    terminal.close();
    await fixture.close();
  }
}

async function waitRun(
  fixture: Fixture,
  runId: string,
  predicate: (run: SidecarRun) => boolean,
  timeout = 10_000,
): Promise<SidecarRun> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const run = (await fixture.readSidecar()).find(item => item.id === runId);
    if (run && predicate(run)) return run;
    await Bun.sleep(50);
  }
  const run = (await fixture.readSidecar()).find(item => item.id === runId);
  throw new Error(
    `Timed out waiting for run ${runId}; current status ${run?.status ?? 'missing'}.`,
  );
}

function childRequest(
  requests: readonly ChildRequest[],
  role: ChildRequest['role'],
): ChildRequest {
  const request = requests.find(item => item.role === role);
  if (!request) throw new Error(`Missing fixture request for ${role}.`);
  return request;
}

function childRequestAt(
  requests: readonly ChildRequest[],
  index: number,
): ChildRequest {
  const request = requests[index];
  if (!request) throw new Error(`Missing fixture request at index ${index}.`);
  return request;
}

function requestTexts(request: ChildRequest): string[] {
  return request.request.messages
    .filter(message => message.role === 'user')
    .map(message => messageText(message));
}

function allRequestText(request: ChildRequest): string {
  return request.request.messages.map(messageText).join('\n');
}

function task(run: SidecarRun, id: string) {
  const found = run.tasks.find(item => item.id === id);
  if (!found) throw new Error(`Missing task ${id} in run ${run.id}.`);
  return found;
}

test('wall-clock timeout aborts a pending provider request and fails the child', async () => {
  const fixture = await createSubagentMechanismFixture('timeout');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism timeout');
    await waitScreen(terminal, 'MECHANISM_TIMEOUT_DONE');
    const runId = fixture.runIds[0];
    if (!runId) throw new Error('Timeout fixture did not create a run.');
    const run = await waitRun(
      fixture,
      runId,
      candidate => candidate.status === 'failed',
    );
    expect(
      fixture.childRequests.some(request => request.role === 'timeout'),
    ).toBe(true);
    expect(task(run, 'task_1').status).toBe('failed');
    expect(task(run, 'task_1').error).toContain('Task exceeded 1000ms.');
    expect(terminal.isDead).toBe(false);
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 60_000);

test('real host cancels a whole concurrency-one run without launching queued tasks', async () => {
  const fixture = await createSubagentMechanismFixture('cancel-queued');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism cancel queued');
    await waitScreen(terminal, 'MECHANISM_CANCEL_QUEUED_DONE');
    await fixture.waitFor(() => fixture.runIds.length === 1);
    const runId = fixture.runIds[0];
    if (!runId) throw new Error('Cancellation fixture did not create a run.');
    const run = await waitRun(
      fixture,
      runId,
      candidate => candidate.status === 'aborted',
    );
    expect(task(run, 'first').status).toBe('aborted');
    expect(task(run, 'second').status).toBe('aborted');
    expect(task(run, 'third').status).toBe('aborted');
    expect(
      fixture.childRequests.some(request => request.role === 'cancel-second'),
    ).toBe(false);
    expect(
      fixture.childRequests.some(request => request.role === 'cancel-third'),
    ).toBe(false);
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 60_000);

test('real chain and explicit needs propagate outputs and block failed dependents', async () => {
  const fixture = await createSubagentMechanismFixture('dependencies');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism dependency chain');
    await waitScreen(terminal, 'MECHANISM_CHAIN_DONE');
    await fixture.waitFor(() => fixture.runIds.length === 1);
    await fixture.waitFor(() =>
      fixture.childRequests.some(request => request.role === 'chain-consumer'),
    );
    const chainConsumer = childRequest(fixture.childRequests, 'chain-consumer');
    expect(allRequestText(chainConsumer)).toContain(
      '## Output of source\nCHAIN_SOURCE_OUTPUT',
    );
    expect(allRequestText(chainConsumer)).not.toContain('{previous}');

    await send(terminal, 'mechanism dependency explicit');
    await waitScreen(terminal, 'MECHANISM_NEEDS_DONE');
    await fixture.waitFor(() => fixture.runIds.length === 2);
    const runId = fixture.runIds[1];
    if (!runId) throw new Error('Needs fixture did not create a run.');
    const run = await waitRun(
      fixture,
      runId,
      candidate => candidate.status === 'failed',
    );
    const dependent = childRequest(fixture.childRequests, 'needs-dependent');
    expect(allRequestText(dependent)).toContain(
      '## Output of source\nNEEDS_SOURCE_OUTPUT',
    );
    expect(fixture.httpFailures).toContain('needs-failed');
    expect(task(run, 'failed').status).toBe('failed');
    expect(task(run, 'blocked').status).toBe('aborted');
    expect(
      fixture.childRequests.some(request => request.role === 'needs-blocked'),
    ).toBe(false);
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 90_000);

test('await returns a pending ask immediately and reply resumes the child', async () => {
  const fixture = await createSubagentMechanismFixture('ask');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism ask');
    await waitScreen(terminal, 'MECHANISM_ASK_DONE');
    await fixture.waitFor(() => fixture.runIds.length === 1);
    const runId = fixture.runIds[0];
    if (!runId) throw new Error('Ask fixture did not create a run.');
    const run = await waitRun(
      fixture,
      runId,
      candidate => candidate.status === 'completed',
    );
    expect(fixture.mainActions).toContain('await_subagent');
    expect(fixture.mainActions).toContain('reply_subagent');
    const awaitDuration = fixture.awaitDurations[0];
    expect(awaitDuration).toBeDefined();
    if (awaitDuration === undefined)
      throw new Error('Ask fixture did not observe await completion.');
    expect(awaitDuration).toBeLessThan(5_000);
    expect(
      fixture.answers.some(answer =>
        answer.includes('fixture answer: continue'),
      ),
    ).toBe(true);
    expect(task(run, 'task_1').finalText).toContain(
      'ASK_CHILD_CONTINUED:fixture answer: continue',
    );
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 60_000);

test('completed and HTTP-failed children resume with the same session history', async () => {
  const fixture = await createSubagentMechanismFixture('resume');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism resume completed');
    await waitScreen(terminal, 'MECHANISM_RESUME_READY_completed');
    await fixture.waitFor(() => fixture.runIds.length === 1);
    const completedId = fixture.runIds[0];
    if (!completedId) throw new Error('Completed resume run is missing.');
    const completedBefore = await waitRun(
      fixture,
      completedId,
      candidate => candidate.status === 'completed',
    );
    const completedTaskBefore = task(completedBefore, 'task_1');
    expect(completedTaskBefore.sessionId).toBeDefined();
    expect(completedTaskBefore.sessionFile).toBeDefined();
    const completedSessionId = completedTaskBefore.sessionId;
    const completedSessionFile = completedTaskBefore.sessionFile;
    const completedRequestsBefore = fixture.childRequests.filter(
      request => request.role === 'resume-completed',
    ).length;

    await send(terminal, 'mechanism resume completed now');
    await waitScreen(terminal, 'MECHANISM_RESUMED_completed');
    const completedAfter = await waitRun(
      fixture,
      completedId,
      candidate => candidate.status === 'completed',
    );
    const completedTaskAfter = task(completedAfter, 'task_1');
    expect(completedTaskAfter.sessionId).toBe(completedSessionId);
    expect(completedTaskAfter.sessionFile).toBe(completedSessionFile);
    const completedRequests = fixture.childRequests.filter(
      request => request.role === 'resume-completed',
    );
    expect(completedRequests.length).toBe(completedRequestsBefore + 1);
    const resumedCompletedRequest = childRequestAt(completedRequests, 1);
    expect(requestTexts(resumedCompletedRequest).length).toBeGreaterThan(1);
    expect(allRequestText(resumedCompletedRequest)).toContain(
      'fixture resume completed follow-up',
    );

    await send(terminal, 'mechanism resume failed');
    await waitScreen(terminal, 'MECHANISM_RESUME_READY_failed');
    await fixture.waitFor(() => fixture.runIds.length === 2);
    const failedId = fixture.runIds[1];
    if (!failedId) throw new Error('Failed resume run is missing.');
    const failedBefore = await waitRun(
      fixture,
      failedId,
      candidate => candidate.status === 'failed',
    );
    const failedTaskBefore = task(failedBefore, 'task_1');
    expect(failedTaskBefore.sessionId).toBeDefined();
    expect(failedTaskBefore.sessionFile).toBeDefined();
    const failedSessionId = failedTaskBefore.sessionId;
    const failedSessionFile = failedTaskBefore.sessionFile;
    expect(fixture.httpFailures).toContain('resume-failed');
    const failedRequestsBefore = fixture.childRequests.filter(
      request => request.role === 'resume-failed',
    ).length;

    await send(terminal, 'mechanism resume failed now');
    await waitScreen(terminal, 'MECHANISM_RESUMED_failed');
    const failedAfter = await waitRun(
      fixture,
      failedId,
      candidate => candidate.status === 'completed',
    );
    const failedTaskAfter = task(failedAfter, 'task_1');
    expect(failedTaskAfter.sessionId).toBe(failedSessionId);
    expect(failedTaskAfter.sessionFile).toBe(failedSessionFile);
    const failedRequests = fixture.childRequests.filter(
      request => request.role === 'resume-failed',
    );
    expect(failedRequests.length).toBe(failedRequestsBefore + 1);
    const resumedFailedRequest = childRequestAt(failedRequests, 1);
    expect(requestTexts(resumedFailedRequest).length).toBeGreaterThan(1);
    expect(allRequestText(resumedFailedRequest)).toContain(
      'fixture resume failed follow-up',
    );
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 90_000);

test('parent cancellation aborts a manual child compaction and preserves its session', async () => {
  const fixture = await createSubagentMechanismFixture('compaction-cancel');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism compaction');
    await waitScreen(terminal, 'MECHANISM_COMPACTION_READY');
    await fixture.waitFor(() => fixture.runIds.length === 1);
    const runId = fixture.runIds[0];
    if (!runId) throw new Error('Compaction fixture did not create a run.');
    const before = await waitRun(
      fixture,
      runId,
      candidate => candidate.status === 'completed',
    );
    const beforeTask = task(before, 'task_1');
    const sessionId = beforeTask.sessionId;
    const sessionFile = beforeTask.sessionFile;
    if (!sessionId || !sessionFile)
      throw new Error('Compaction fixture did not persist the child session.');
    const historyBefore = await readFile(sessionFile, 'utf8');
    const childCompactionRequests = fixture.childRequests.filter(
      request => request.role === 'compaction-child',
    );
    expect(childCompactionRequests.length).toBe(3);
    expect(historyBefore).toContain('COMPACTION_CHILD_FINAL');

    await send(terminal, '/subagents');
    await waitScreen(terminal, 'compactor');
    await send(terminal, '/compact');
    await fixture.waitFor(() => fixture.summaryRequests.length === 1, 15_000);
    const summaryPrompt =
      fixture.summaryRequests[0]?.messages.map(messageText).join('\n') ?? '';
    expect(summaryPrompt).toContain(
      'This is the PREFIX of a turn that was too large to keep.',
    );

    await terminal.press(['ctrl', 'c']);
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism compaction cancel');
    await waitScreen(terminal, 'MECHANISM_COMPACTION_CANCEL_DONE');
    await fixture.waitFor(() => fixture.summaryAborts === 1, 15_000);
    await Bun.sleep(100);

    expect(fixture.summaryAborts).toBe(1);
    const afterRuns = await fixture.readSidecar();
    const after = afterRuns.find(candidate => candidate.id === runId);
    if (!after)
      throw new Error(`Missing run ${runId} after compaction cancel.`);
    const afterTask = task(after, 'task_1');
    expect(afterTask.sessionId).toBe(sessionId);
    expect(afterTask.sessionFile).toBe(sessionFile);
    expect(await readFile(sessionFile, 'utf8')).toBe(historyBefore);

    expect(terminal.isDead).toBe(false);
    await send(terminal, 'mechanism compaction parent');
    await waitScreen(terminal, 'MECHANISM_COMPACTION_PARENT_ALIVE');
    expect(terminal.isDead).toBe(false);
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 90_000);

test('sibling mailbox send and poll exchange a real child message', async () => {
  const fixture = await createSubagentMechanismFixture('sibling');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism sibling');
    await waitScreen(terminal, 'MECHANISM_SIBLING_DONE');
    await fixture.waitFor(() => fixture.runIds.length === 1);
    await fixture.waitFor(() =>
      fixture.childRequests.some(
        request =>
          request.role === 'sibling-b' &&
          allRequestText(request).includes('SIBLING_PAYLOAD'),
      ),
    );
    const runId = fixture.runIds[0];
    if (!runId) throw new Error('Sibling fixture did not create a run.');
    const run = await waitRun(
      fixture,
      runId,
      candidate => candidate.status === 'completed',
    );
    expect(task(run, 'sibling-a').status).toBe('completed');
    expect(task(run, 'sibling-b').status).toBe('completed');
    expect(
      fixture.childRequests.some(
        request =>
          request.role === 'sibling-b' &&
          allRequestText(request).includes('SIBLING_PAYLOAD'),
      ),
    ).toBe(true);
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 60_000);

test('scoped cancellation leaves another child and the parent session active', async () => {
  const fixture = await createSubagentMechanismFixture('scoped-cancel');
  const terminal = await launch(fixture);
  try {
    await waitScreen(terminal, 'mechanism-fixture');
    await send(terminal, 'mechanism scoped cancel');
    await waitScreen(terminal, 'MECHANISM_SCOPED_CANCEL_DONE');
    await fixture.waitFor(() => fixture.runIds.length === 1);
    const runId = fixture.runIds[0];
    if (!runId) throw new Error('Scoped cancellation run is missing.');
    const run = await waitRun(
      fixture,
      runId,
      candidate =>
        candidate.tasks.some(item => item.id === 'keep') &&
        candidate.tasks.some(item => item.id === 'cancelled') &&
        candidate.tasks.find(item => item.id === 'cancelled')?.status ===
          'aborted',
    );
    expect(task(run, 'cancelled').status).toBe('aborted');
    expect(task(run, 'keep').status).toBe('awaiting_parent');
    expect(
      fixture.childRequests.some(request => request.role === 'scoped-keep'),
    ).toBe(true);

    expect(terminal.isDead).toBe(false);
    await send(terminal, 'mechanism scoped followup');
    await waitScreen(terminal, 'MECHANISM_SCOPED_MAIN_ALIVE');
    expect(terminal.isDead).toBe(false);
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    await closeTerminal(terminal, fixture);
  }
}, 60_000);
