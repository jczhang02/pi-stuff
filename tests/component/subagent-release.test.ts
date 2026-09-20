import {expect, test} from 'bun:test';
import {
  CoordinatorControls,
  type CoordinatorControlHost,
} from '../../src/subagent/coordinator-controls';
import type {
  AgentRecord,
  EffectiveConfiguration,
  FleetRecord,
  TaskRecord,
} from '../../src/subagent/records';
import type {SubagentInput} from '../../src/subagent/protocol';
import type {Workspace} from '../../src/subagent/workspace';

const configuration = (): EffectiveConfiguration => ({
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
});

const taskRecord = (phase: TaskRecord['phase']): TaskRecord => ({
  id: 'task-a',
  agentId: 'agent-a',
  dispatchId: 'dispatch-a',
  parentTaskId: null,
  prompt: 'prompt',
  description: 'description',
  needs: [],
  admittedAt: 1,
  startedAt: phase === 'queued' ? null : 1,
  endedAt: phase === 'ended' ? 2 : null,
  phase,
  outcome: phase === 'ended' ? 'fulfilled' : null,
  declaration: phase === 'ended' ? 'fulfilled' : null,
  stopOutcome: null,
  durability: phase === 'ended' ? 'saved' : 'pending',
  acceptance: phase === 'ended' ? true : null,
  reason: '',
  stage: phase === 'ended' ? 'complete' : 'working',
  liveText: '',
  activeTools: [],
  report: '',
  files: [],
  checks: [],
  configuration: configuration(),
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
});

const agentRecord = (workspace: Workspace | null = null): AgentRecord => ({
  id: 'agent-a',
  name: 'agent-a',
  dispatchId: 'dispatch-a',
  parentAgentId: null,
  createdAt: 1,
  depth: 0,
  configuration: configuration(),
  currentTools: [],
  sessionFile: null,
  workspace,
  held: false,
  released: false,
});

const fleetRecord = (
  phase: TaskRecord['phase'],
  workspace: Workspace | null = null,
): FleetRecord => {
  const task = taskRecord(phase);
  return {
    version: 1,
    sessionId: 'session',
    revision: 1,
    storageError: null,
    agents: [agentRecord(workspace)],
    tasks: [task],
    dispatches: [{id: task.dispatchId, admitted: 1}],
    messages: [],
    notices: [],
  };
};

interface ReleaseHarness {
  readonly controls: CoordinatorControls;
  readonly record: FleetRecord;
  readonly gate: PromiseWithResolvers<void>;
  readonly resetGate: () => void;
  readonly setStorageError: (message: string | null) => void;
  readonly setTasks: (tasks: readonly TaskRecord[]) => void;
  readonly state: {
    waitCalls: number;
    scheduleCalls: number;
    workspaceCalls: number;
    workspaceGate: PromiseWithResolvers<void>;
    workspaceStarted: PromiseWithResolvers<void>;
  };
}

function harness(
  phase: TaskRecord['phase'],
  withWorkspace = false,
  blockWorkspace = false,
): ReleaseHarness {
  const workspace: Workspace | null = withWorkspace
    ? {
        directory: '/tmp/pi-subagent-release-test',
        cwd: '/tmp/pi-subagent-release-test',
        repository: null,
        baseline: null,
        mode: 'direct',
        released: false,
      }
    : null;
  let record = fleetRecord(phase, workspace);
  let gate = Promise.withResolvers<void>();
  const state = {
    waitCalls: 0,
    scheduleCalls: 0,
    workspaceCalls: 0,
    workspaceGate: Promise.withResolvers<void>(),
    workspaceStarted: Promise.withResolvers<void>(),
  };
  const host: CoordinatorControlHost = {
    storeDirectory: '/tmp/pi-subagent-release-test',
    snapshot: () => record,
    task: (id: string) => {
      const task = record.tasks.find(candidate => candidate.id === id);
      if (!task) throw new Error(`Unknown task ${id}.`);
      return task;
    },
    update: async (transform: (record: FleetRecord) => FleetRecord) => {
      record = transform(record);
    },
    effectiveTools: () => [],
    cancelTask: async (_id: string, _caller: string | null) => {},
    schedule: () => {
      state.scheduleCalls++;
    },
    waitForAgent: async (_agentId: string) => {
      state.waitCalls++;
      await gate.promise;
    },
    workspaceOperation: async <T>(operation: () => Promise<T>) => {
      state.workspaceCalls++;
      state.workspaceStarted.resolve();
      if (blockWorkspace) await state.workspaceGate.promise;
      return operation();
    },
    runtime: {
      session: () => undefined,
      setActiveTools: (_id: string, _tools: readonly string[]) => {},
      activeToolNames: (_id: string) => [],
    },
  };
  return {
    controls: new CoordinatorControls(host),
    get record() {
      return record;
    },
    get gate() {
      return gate;
    },
    resetGate: () => {
      gate = Promise.withResolvers<void>();
    },
    setStorageError: (message: string | null) => {
      record = {...record, storageError: message};
    },
    setTasks: (tasks: readonly TaskRecord[]) => {
      record = {...record, tasks: [...tasks]};
    },
    state,
  };
}

const releaseInput = (): SubagentInput => ({
  command: 'release',
  agentId: 'agent-a',
});

async function expectPending<T>(promise: Promise<T>): Promise<void> {
  const pending = await Promise.race([
    promise.then(
      () => false,
      () => false,
    ),
    Bun.sleep(0).then(() => true),
  ]);
  expect(pending).toBe(true);
}

test('release waits for ended agent teardown before changing durable state', async () => {
  const h = harness('ended');
  const release = h.controls.release(releaseInput(), null);

  await expectPending(release);
  expect(h.controls.isReleasing('agent-a')).toBe(true);
  expect(h.state.waitCalls).toBe(1);
  expect(h.record.agents[0]?.released).toBe(false);

  h.gate.resolve();
  await expect(release).resolves.toEqual({
    status: 'released',
    agentId: 'agent-a',
  });
  expect(h.controls.isReleasing('agent-a')).toBe(false);
  expect(h.record.agents[0]?.released).toBe(true);
});

test('release rejects work admitted while teardown is draining', async () => {
  const h = harness('ended');
  const release = h.controls.release(releaseInput(), null);

  await expectPending(release);
  h.setTasks([taskRecord('queued')]);
  h.gate.resolve();

  await expect(release).rejects.toThrow('New work arrived');
  expect(h.controls.isReleasing('agent-a')).toBe(false);
  expect(h.record.agents[0]?.released).toBe(false);
  expect(h.state.scheduleCalls).toBe(1);
});

test.each(['queued', 'executing'] as const)(
  'release rejects %s work without awaiting teardown',
  async phase => {
    const h = harness(phase);
    await expect(h.controls.release(releaseInput(), null)).rejects.toThrow(
      'active or queued work',
    );
    expect(h.state.waitCalls).toBe(0);
    expect(h.controls.isReleasing('agent-a')).toBe(false);
    expect(h.record.agents[0]?.released).toBe(false);
  },
);

test('release failure after teardown preserves the agent and unlocks retry', async () => {
  const h = harness('ended');
  const release = h.controls.release(releaseInput(), null);
  await expectPending(release);
  h.setStorageError('journal unavailable');
  h.gate.resolve();

  await expect(release).rejects.toThrow('journal unavailable');
  expect(h.controls.isReleasing('agent-a')).toBe(false);
  expect(h.record.agents[0]?.released).toBe(false);

  h.setStorageError(null);
  h.resetGate();
  const retry = h.controls.release(releaseInput(), null);
  await expectPending(retry);
  h.gate.resolve();
  await expect(retry).resolves.toEqual({
    status: 'released',
    agentId: 'agent-a',
  });
  expect(h.record.agents[0]?.released).toBe(true);
});

test('release rechecks storage after a workspace operation starts', async () => {
  const h = harness('ended', true, true);
  const release = h.controls.release(releaseInput(), null);

  await expectPending(release);
  h.gate.resolve();
  await h.state.workspaceStarted.promise;
  expect(h.state.workspaceCalls).toBe(1);
  h.setStorageError('journal unavailable');
  h.state.workspaceGate.resolve();

  await expect(release).rejects.toThrow('journal unavailable');
  expect(h.controls.isReleasing('agent-a')).toBe(false);
  expect(h.record.agents[0]?.released).toBe(false);
  expect(h.record.agents[0]?.workspace?.released).toBe(false);
  expect(h.state.scheduleCalls).toBe(1);
});
