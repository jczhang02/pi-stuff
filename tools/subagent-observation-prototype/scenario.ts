// Throwaway in-memory fixture for the observation UI prototypes.
// It never calls a model, executes a command, or reads the project.
import type {
  BashToolInput,
  ReadToolInput,
} from '@earendil-works/pi-coding-agent';
import type {Model, Usage} from '@earendil-works/pi-ai';

export const fixtureModel: Model<'anthropic-messages'> = {
  id: 'claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  api: 'anthropic-messages',
  provider: 'anthropic',
  baseUrl: 'http://127.0.0.1:1',
  reasoning: true,
  input: ['text'],
  cost: {input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75},
  contextWindow: 200000,
  maxTokens: 8192,
};

export type ObservationStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'stopped'
  | 'failed';
export type ObservationToolState = 'running' | 'success' | 'error';
export type ObservationToolMessage =
  | {
      kind: 'tool';
      seq: number;
      name: 'read';
      args: ReadToolInput;
      detail: string;
      state: ObservationToolState;
    }
  | {
      kind: 'tool';
      seq: number;
      name: 'bash';
      args: BashToolInput;
      detail: string;
      state: ObservationToolState;
    };
export type ObservationMessage =
  | {kind: 'user'; seq: number; text: string}
  | {kind: 'assistant'; seq: number; text: string; streaming: boolean}
  | ObservationToolMessage;

export interface ObservationAgent {
  id: string;
  name: string;
  task: string;
  status: ObservationStatus;
  activity: string;
  elapsed: number;
  inputTokens: number;
  outputTokens: number;
  messages: ObservationMessage[];
  expanded: boolean;
}

type Draft =
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string; streaming: boolean}
  | {
      kind: 'tool';
      name: 'read';
      args: ReadToolInput;
      detail: string;
      state: ObservationToolState;
    }
  | {
      kind: 'tool';
      name: 'bash';
      args: BashToolInput;
      detail: string;
      state: ObservationToolState;
    };
type ToolEvent =
  | {
      kind: 'tool';
      at: number;
      until: number;
      name: 'read';
      args: ReadToolInput;
      output: string;
      activity: string;
      failure?: boolean;
    }
  | {
      kind: 'tool';
      at: number;
      until: number;
      name: 'bash';
      args: BashToolInput;
      output: string;
      activity: string;
      failure?: boolean;
    };
type RunEvent =
  | {
      kind: 'assistant';
      at: number;
      until: number;
      text: string;
      activity: string;
    }
  | ToolEvent
  | {kind: 'complete'; at: number; activity: string}
  | {kind: 'fail'; at: number; text: string; activity: string};
type Script = readonly RunEvent[];
interface Spec {
  id: string;
  name: string;
  task: string;
  status: ObservationStatus;
  activity: string;
  elapsed: number;
  inputTokens: number;
  outputTokens: number;
  seed: Draft[];
  initial: Script;
  followup: Script;
  recovery: Script;
}
interface Context {
  sequence: number;
}
interface AgentState {
  context: Context;
  run: 'initial' | 'followup' | 'recovery';
  step: number;
  pending: number;
  initial: Script;
  followup: Script;
  recovery: Script;
  active: RunEvent | undefined;
}

const states = new WeakMap<ObservationAgent, AgentState>();
const baseTimestamp = 1_757_728_000_000;
const user = (text: string): Draft => ({kind: 'user', text});
const assistant = (text: string, streaming = false): Draft => ({
  kind: 'assistant',
  text,
  streaming,
});
const read = (
  args: ReadToolInput,
  detail: string,
  state: ObservationToolState,
): Draft => ({kind: 'tool', name: 'read', args, detail, state});
const bash = (
  args: BashToolInput,
  detail: string,
  state: ObservationToolState,
): Draft => ({kind: 'tool', name: 'bash', args, detail, state});
const a = (
  at: number,
  until: number,
  text: string,
  activity: string,
): RunEvent => ({kind: 'assistant', at, until, text, activity});
const r = (
  at: number,
  until: number,
  args: ReadToolInput,
  output: string,
  activity: string,
): RunEvent => ({
  kind: 'tool',
  at,
  until,
  name: 'read',
  args,
  output,
  activity,
});
const b = (
  at: number,
  until: number,
  args: BashToolInput,
  output: string,
  activity: string,
  failure = false,
): RunEvent => ({
  kind: 'tool',
  at,
  until,
  name: 'bash',
  args,
  output,
  activity,
  failure,
});
const complete = (at: number, activity: string): RunEvent => ({
  kind: 'complete',
  at,
  activity,
});
const fail = (at: number, text: string, activity: string): RunEvent => ({
  kind: 'fail',
  at,
  text,
  activity,
});

const mainRead = `import {createCancellation} from './lifecycle.js';
export async function cancelTask(taskId: string): Promise<void> {
  const task = tasks.get(taskId);
  if (!task) return;
  task.controller.abort();
  await task.finished;
  tasks.delete(taskId);
}
export async function awaitRun(taskId: string): Promise<void> {
  const task = tasks.get(taskId);
  if (!task) return;
  await task.finished;
}`;
const reviewerRead = `export function stopChild(child: Child): void {
  if (child.state === 'stopped') return;
  child.state = 'stopping';
  child.abortController.abort();
}
export async function releaseChild(child: Child): Promise<void> {
  await child.finished;
  child.listeners.clear();
  child.session.dispose();
  child.state = 'stopped';
}`;
const testerRead = `describe('cancellation', () => {
  it('settles a running child', async () => {
    const child = await startChild('long read');
    await cancelTask(child.id);
    expect(child.state).toBe('stopped');
  });
  it('can cancel a queued child', async () => {
    const child = await queueChild('pending read');
    await cancelTask(child.id);
    expect(child.finished).resolves.toBeUndefined();
  });
});`;
const explorerRead = `src/subagent/manager.ts:41  startChild()
src/subagent/manager.ts:88  cancelTask()
src/subagent/lifecycle.ts:19  releaseChild()
The manager owns the task map.
The lifecycle module owns the abort controller.
Release resolves completion after cleanup.`;
const baseline =
  'bun test v1.4.0\n\npass  running child settles\npass  queued child releases its session\npass  listeners are removed after completion\n\n3 tests passed';
const releaseBaseline =
  'bun test tests/subagent/release.test.ts\n\npass  abort reaches the child session\npass  release waits for the final tool result\n\n2 tests passed';
const failedTests =
  'bun test v1.4.0\n\npass  running child settles\npass  queued child releases its session\nfail  repeated cancel shares completion\n\nerror: Test timed out after 5000ms\n  at tests/subagent/cancel.test.ts:42\n\n2 passed · 1 failed';
const fixedTests =
  'bun test v1.4.0\n\npass  running child settles\npass  queued child releases its session\npass  repeated cancel shares completion\n\n3 tests passed';

const mainScript: Script = [
  a(
    1,
    10,
    'I am coordinating the cancellation review. The key question is whether every waiter observes the same completion signal before the child session is disposed.',
    'Comparing abort and cleanup ownership',
  ),
  r(
    11,
    18,
    {path: 'src/subagent/manager.ts', offset: 35, limit: 24},
    mainRead,
    'Reading the cancellation manager',
  ),
  b(
    20,
    28,
    {command: 'bun test tests/subagent/cancel.test.ts', timeout: 30},
    baseline,
    'Running focused cancellation tests',
  ),
  a(
    30,
    43,
    'The lifecycle has one shared completion promise, so the owner can await cleanup before deleting the task. I will keep the duplicate-cancel case visible while the reviewer checks the child boundary.',
    'Writing the review decision',
  ),
  complete(44, 'Review coordinated · cleanup boundary is clear'),
];
const reviewerScript: Script = [
  a(
    1,
    8,
    'I am tracing the stop signal from the coordinator into the child session, then checking which layer owns listener cleanup.',
    'Inspecting abort propagation',
  ),
  r(
    9,
    16,
    {path: 'src/subagent/lifecycle.ts', offset: 1, limit: 18},
    reviewerRead,
    'Reading child lifecycle ownership',
  ),
  b(
    18,
    26,
    {command: 'bun test tests/subagent/release.test.ts', timeout: 30},
    releaseBaseline,
    'Checking release ordering',
  ),
  a(
    28,
    39,
    'Abort propagation is ordered correctly for one cancellation. The remaining risk is idempotence: a second caller must await the already-settled child instead of replacing its completion promise.',
    'Summarising review findings',
  ),
  complete(40, 'Review complete · idempotence remains to verify'),
];
const testerScript: Script = [
  a(
    1,
    7,
    'I will add the repeated-cancel case now. The first two cases cover running and queued children; this run checks the second waiter.',
    'Running the repeated-cancellation test',
  ),
  r(
    8,
    15,
    {path: 'tests/subagent/cancel.test.ts', offset: 1, limit: 32},
    testerRead,
    'Reading cancellation test cases',
  ),
  b(
    17,
    25,
    {
      command: 'bun test tests/subagent/cancel.test.ts --filter repeated',
      timeout: 30,
    },
    failedTests,
    'Running repeated-cancellation test',
    true,
  ),
  fail(
    25,
    'The repeated-cancel test failed because the second waiter did not observe the first completion signal. Send a follow-up after the fix to run recovery.',
    'Test failed · repeated cancel timed out',
  ),
];
const testerRecovery: Script = [
  a(
    1,
    7,
    'I have the follow-up. I will reuse the child completion promise for every cancel caller, then rerun the focused test and the full cancellation file.',
    'Applying the idempotent completion fix',
  ),
  b(
    9,
    17,
    {command: 'bun test tests/subagent/cancel.test.ts', timeout: 30},
    fixedTests,
    'Rerunning cancellation tests',
  ),
  a(
    19,
    29,
    'Recovery passed. All cancellation callers now share one completion promise, and the child session is released once the promise settles. The original failure and the successful rerun remain in this history.',
    'Recording recovery result',
  ),
  complete(30, 'Recovery complete · 3 cancellation tests passed'),
];
const explorerScript: Script = [
  a(
    1,
    6,
    'I will trace one more call site so the coordinator can compare the manager and lifecycle boundaries.',
    'Continuing the lifecycle trace',
  ),
  r(
    7,
    14,
    {path: 'src/subagent/manager.ts', offset: 36, limit: 12},
    explorerRead,
    'Reading the lifecycle call graph',
  ),
  a(
    16,
    25,
    'The call graph confirms three entry points: the manager starts and cancels, the lifecycle module owns abort state, and release waits for the child session before clearing listeners.',
    'Writing the trace summary',
  ),
  complete(26, 'Trace complete · 3 entry points confirmed'),
];
const followupScript: Script = [
  a(
    1,
    7,
    'I am checking the requested follow-up against the existing cancellation history and keeping the same cleanup boundary.',
    'Processing your follow-up',
  ),
  r(
    8,
    14,
    {path: 'src/subagent/lifecycle.ts', offset: 1, limit: 18},
    reviewerRead,
    'Checking the follow-up path',
  ),
  a(
    16,
    23,
    'The follow-up is consistent with the existing lifecycle ownership. I kept the earlier tool output available for comparison.',
    'Preparing the follow-up result',
  ),
  complete(24, 'Follow-up complete · history preserved'),
];

const specs: Spec[] = [
  {
    id: 'main',
    name: 'main',
    task: 'Coordinate cancellation and resource cleanup',
    status: 'running',
    activity: 'Coordinating cancellation review',
    elapsed: 44,
    inputTokens: 18400,
    outputTokens: 960,
    seed: [
      user('Coordinate cancellation and resource cleanup'),
      assistant(
        'I am coordinating the cancellation review across the manager, lifecycle owner, and focused tests. The shared question is whether cancellation always releases the child session.',
      ),
      read(
        {path: 'src/subagent/manager.ts', offset: 1, limit: 32},
        mainRead,
        'success',
      ),
      assistant(
        'The manager waits for task.finished before deleting the task. I asked the reviewer to inspect the child boundary and the tester to cover repeated callers.',
      ),
      bash(
        {command: 'bun test tests/subagent/cancel.test.ts', timeout: 30},
        baseline,
        'success',
      ),
      assistant(
        'The baseline cases pass. I am holding the coordination turn open until the repeated-cancel path reports back.',
      ),
    ],
    initial: mainScript,
    followup: followupScript,
    recovery: followupScript,
  },
  {
    id: 'reviewer',
    name: 'reviewer',
    task: 'Review abort propagation and cleanup ownership',
    status: 'running',
    activity: 'Inspecting abort propagation',
    elapsed: 37,
    inputTokens: 13200,
    outputTokens: 620,
    seed: [
      user('Review abort propagation and cleanup ownership'),
      assistant(
        'I will inspect abort propagation first, then verify that release waits for the child session and clears listeners exactly once.',
      ),
      read(
        {path: 'src/subagent/lifecycle.ts', offset: 1, limit: 24},
        reviewerRead,
        'success',
      ),
      assistant(
        'The lifecycle owner waits for completion before disposal. I am checking whether a second cancel caller shares that completion promise.',
      ),
      bash(
        {command: 'bun test tests/subagent/release.test.ts', timeout: 30},
        releaseBaseline,
        'success',
      ),
      assistant(
        'Single-cancel release is covered. The duplicate-cancel case remains the only open edge.',
      ),
    ],
    initial: reviewerScript,
    followup: followupScript,
    recovery: followupScript,
  },
  {
    id: 'tester',
    name: 'tester',
    task: 'Verify repeated cancellation and recovery',
    status: 'waiting',
    activity: 'Question: include repeated cancellation?',
    elapsed: 29,
    inputTokens: 9100,
    outputTokens: 410,
    seed: [
      user('Verify repeated cancellation and recovery'),
      assistant(
        'The running and queued cases are prepared. I need one decision before the test run: should this include two cancellation callers?',
      ),
      read(
        {path: 'tests/subagent/cancel.test.ts', offset: 1, limit: 32},
        testerRead,
        'success',
      ),
      assistant(
        'Waiting for your scope decision. Reply here and the test run will continue; other agents are still progressing.',
      ),
    ],
    initial: testerScript,
    followup: followupScript,
    recovery: testerRecovery,
  },
  {
    id: 'explorer',
    name: 'explorer',
    task: 'Trace cancellation entry points and session lifecycle',
    status: 'completed',
    activity: 'Trace complete · 3 entry points confirmed',
    elapsed: 61,
    inputTokens: 11200,
    outputTokens: 530,
    seed: [
      user('Trace cancellation entry points and session lifecycle'),
      assistant(
        'I traced the manager, lifecycle, and release paths and kept the relevant call sites together for the coordinator.',
      ),
      read(
        {path: 'src/subagent/manager.ts', offset: 36, limit: 12},
        explorerRead,
        'success',
      ),
      assistant(
        'Trace complete: manager starts and cancels, lifecycle owns the abort controller, and release waits before disposing the child session.',
      ),
    ],
    initial: explorerScript,
    followup: explorerScript,
    recovery: explorerScript,
  },
];

function stateFor(agent: ObservationAgent): AgentState {
  const state = states.get(agent);
  if (!state) throw new Error(`Unknown observation agent: ${agent.id}`);
  return state;
}
function add(agent: ObservationAgent, draft: Draft): void {
  const state = stateFor(agent);
  state.context.sequence += 1;
  agent.messages.push({...draft, seq: state.context.sequence});
}
function lastAssistant(
  agent: ObservationAgent,
): Extract<ObservationMessage, {kind: 'assistant'}> | undefined {
  const message = agent.messages.findLast(item => item.kind === 'assistant');
  return message?.kind === 'assistant' ? message : undefined;
}
function lastTool(agent: ObservationAgent): ObservationToolMessage | undefined {
  const message = agent.messages.findLast(item => item.kind === 'tool');
  return message?.kind === 'tool' ? message : undefined;
}
function finishActive(agent: ObservationAgent): void {
  const state = stateFor(agent);
  const active = state.active;
  if (
    !active ||
    active.kind === 'complete' ||
    active.kind === 'fail' ||
    state.step < active.until
  )
    return;
  if (active.kind === 'assistant') {
    const message = lastAssistant(agent);
    if (message) {
      message.text = active.text;
      message.streaming = false;
    }
  } else if (active.kind === 'tool') {
    const message = lastTool(agent);
    if (message) {
      message.detail = active.output;
      message.state = active.failure ? 'error' : 'success';
    }
  }
  state.active = undefined;
}
function updateActive(agent: ObservationAgent): void {
  const state = stateFor(agent);
  const active = state.active;
  if (!active || active.kind === 'complete' || active.kind === 'fail') return;
  const progress = Math.min(
    1,
    (state.step - active.at + 1) / (active.until - active.at + 1),
  );
  if (active.kind === 'assistant') {
    const message = lastAssistant(agent);
    if (message) {
      message.text = active.text.slice(
        0,
        Math.max(1, Math.ceil(active.text.length * progress)),
      );
      message.streaming = state.step < active.until;
    }
  } else {
    const message = lastTool(agent);
    if (message) {
      const lines = active.output.split('\n');
      message.detail = lines
        .slice(0, Math.max(1, Math.ceil(lines.length * progress)))
        .join('\n');
      message.state = 'running';
    }
  }
}
function settle(agent: ObservationAgent, activity: string): void {
  const state = stateFor(agent);
  state.active = undefined;
  if (state.pending > 0) {
    state.pending -= 1;
    state.run = 'followup';
    state.step = 0;
    agent.activity = 'Processing the queued follow-up';
    return;
  }
  agent.status = 'completed';
  agent.activity = activity;
  state.step = 0;
}
function advanceAgent(agent: ObservationAgent): void {
  const state = stateFor(agent);
  state.step += 1;
  if (state.step % 5 === 0) {
    agent.elapsed += 1;
    agent.outputTokens += 19;
  }
  finishActive(agent);
  const script =
    state.run === 'initial'
      ? state.initial
      : state.run === 'recovery'
        ? state.recovery
        : state.followup;
  const event = script.find(item => item.at === state.step);
  if (event?.kind === 'assistant') {
    agent.inputTokens += 480;
    agent.activity = event.activity;
    add(agent, {kind: 'assistant', text: '', streaming: true});
    state.active = event;
  } else if (event?.kind === 'tool') {
    agent.activity = event.activity;
    if (event.name === 'read')
      add(agent, {
        kind: 'tool',
        name: 'read',
        args: event.args,
        detail: '',
        state: 'running',
      });
    else
      add(agent, {
        kind: 'tool',
        name: 'bash',
        args: event.args,
        detail: '',
        state: 'running',
      });
    state.active = event;
  } else if (event?.kind === 'complete') {
    settle(agent, event.activity);
  } else if (event?.kind === 'fail') {
    add(agent, {kind: 'assistant', text: event.text, streaming: false});
    agent.status = 'failed';
    agent.activity = event.activity;
    state.active = undefined;
    state.step = 0;
  }
  updateActive(agent);
}

export function createScenario(): ObservationAgent[] {
  const context: Context = {sequence: 0};
  const agents = specs.map(spec => ({
    id: spec.id,
    name: spec.name,
    task: spec.task,
    status: spec.status,
    activity: spec.activity,
    elapsed: spec.elapsed,
    inputTokens: spec.inputTokens,
    outputTokens: spec.outputTokens,
    messages: [],
    expanded: false,
  }));
  for (const [index, agent] of agents.entries()) {
    const spec = specs[index];
    if (!spec) throw new Error(`Missing observation spec at ${index}`);
    states.set(agent, {
      context,
      run: 'initial',
      step: 0,
      pending: 0,
      initial: spec.initial,
      followup: spec.followup,
      recovery: spec.recovery,
      active: undefined,
    });
    for (const draft of spec.seed) add(agent, draft);
  }
  return agents;
}
export function advance(agents: ObservationAgent[]): void {
  for (const agent of agents)
    if (agent.status === 'running') advanceAgent(agent);
}
export function send(agent: ObservationAgent, value: string): void {
  const text = value.trim();
  if (!text) return;
  const state = stateFor(agent);
  const previous = agent.status;
  add(agent, {kind: 'user', text});
  if (previous === 'running') {
    state.pending += 1;
    return;
  }
  agent.status = 'running';
  state.run =
    previous === 'failed'
      ? 'recovery'
      : previous === 'waiting'
        ? 'initial'
        : 'followup';
  state.step = 0;
  state.active = undefined;
  agent.activity =
    previous === 'failed'
      ? 'Applying the idempotent completion fix'
      : 'Processing your follow-up';
}
export function stop(agent: ObservationAgent): void {
  const state = stateFor(agent);
  if (agent.status === 'stopped') return;
  agent.status = 'stopped';
  agent.activity = 'Stopped · history preserved';
  state.pending = 0;
  state.active = undefined;
  for (const message of agent.messages) {
    if (message.kind === 'assistant') message.streaming = false;
    if (message.kind === 'tool' && message.state === 'running') {
      message.state = 'error';
      message.detail += '\n\nExecution stopped by the operator.';
    }
  }
  add(agent, {
    kind: 'assistant',
    text: 'Work stopped. Existing messages and tool results are preserved; send a follow-up to continue this conversation.',
    streaming: false,
  });
}
export function usageFor(agent: ObservationAgent): Usage {
  const input = agent.inputTokens;
  const output = agent.outputTokens;
  const inputCost = (input * fixtureModel.cost.input) / 1_000_000;
  const outputCost = (output * fixtureModel.cost.output) / 1_000_000;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: {
      input: inputCost,
      output: outputCost,
      cacheRead: 0,
      cacheWrite: 0,
      total: inputCost + outputCost,
    },
  };
}

export {baseTimestamp};
