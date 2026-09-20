import {randomUUID} from 'node:crypto';
import {
  getAgentDir,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {Effect} from 'effect';
import {resolveConfiguration} from './configuration';
import {dependencyPlan} from './dependencies';
import type {Assignment} from './protocol';
import type {
  AgentRecord,
  EffectiveConfiguration,
  FleetRecord,
  TaskRecord,
} from './records';
import type {SubagentSettings} from './settings';

export function newAssignment(
  agent: AgentRecord,
  prompt: string,
  description: string,
  parentTaskId: string | null,
  settings: SubagentSettings,
): TaskRecord {
  const now = Date.now();
  return {
    id: randomUUID(),
    agentId: agent.id,
    dispatchId: agent.dispatchId,
    parentTaskId,
    prompt,
    description,
    needs: [],
    admittedAt: now,
    startedAt: null,
    endedAt: null,
    phase: 'queued',
    outcome: null,
    declaration: null,
    stopOutcome: null,
    durability: 'pending',
    acceptance: null,
    reason: 'Waiting for an execution slot.',
    stage: 'queued',
    liveText: '',
    activeTools: [],
    report: '',
    files: [],
    checks: [],
    configuration: agent.configuration,
    currentTools: [...agent.currentTools],
    usage: null,
    turns: 0,
    retries: 0,
    executionMs: 0,
    lastEventAt: now,
    sessionFile: agent.sessionFile,
    historyFile: null,
    workspaceDirectory: agent.workspace?.cwd ?? null,
    baseline: null,
    commit: null,
    baselineRequest: agent.configuration.baseline,
    diff: '',
    artifactError: null,
    unsavedFiles: [],
    ignoredFiles: [],
    events: [
      {
        at: now,
        kind: 'limits',
        text: `Admission limits: ${settings.concurrency ?? 8} shared execution slots; ${settings.tasksPerDispatch ?? 64} tasks per dispatch; maximum depth ${settings.maxDepth ?? 3}. Result wait ${settings.resultWaitMs ?? 60000}ms; answer wait ${settings.answerWaitMs ?? 600000}ms.`,
      },
    ],
    consumedChildren: [],
  };
}

// All configuration I/O and known graph checks precede the single admission
// transaction. The coordinator rechecks live authority and counts at commit.
export async function prepareAdmission(
  assignments: readonly Assignment[],
  caller: string | null,
  record: FleetRecord,
  settings: SubagentSettings,
  context: ExtensionContext,
  ceiling: readonly string[],
) {
  const edges = dependencyPlan(assignments);
  const parent = record.tasks.find(task => task.id === caller);
  if (
    caller &&
    (!parent || parent.phase === 'ended' || parent.stopOutcome !== null)
  )
    throw new Error('Parent no longer accepts descendants.');
  const model = context.model;
  if (!model) throw new Error('Select a model before delegating.');
  const parentAgent = record.agents.find(agent => agent.id === parent?.agentId);
  const depth = (parentAgent?.depth ?? 0) + 1;
  if (depth > (settings.maxDepth ?? 3))
    throw new Error('Maximum delegation depth exceeded.');
  const dispatchId = parent?.dispatchId ?? randomUUID();
  const inherited: EffectiveConfiguration = parent
    ? {
        ...parent.configuration,
        cwd: parent.workspaceDirectory ?? parent.configuration.cwd,
        tools: ceiling,
        ceiling,
      }
    : {
        model: `${model.provider}/${model.id}`,
        thinking: context.thinkingLevel ?? 'medium',
        tools: ceiling,
        ceiling,
        cwd: context.cwd,
        workspace: 'direct',
        instructions: '',
        role: null,
        copyHistory: false,
        executionTimeoutMs: null,
        extensions: [],
        baseline: null,
        include: [],
      };
  const agents: AgentRecord[] = [];
  const tasks: TaskRecord[] = [];
  for (const assignment of assignments) {
    for (const id of assignment.inputs ?? []) {
      const input = record.tasks.find(task => task.id === id);
      if (
        !input ||
        input.phase !== 'ended' ||
        input.outcome !== 'fulfilled' ||
        input.declaration !== 'fulfilled' ||
        input.durability !== 'saved'
      )
        throw new Error(
          'Explicit result inputs must identify saved fulfilled assignments.',
        );
      if (parent && input.dispatchId !== parent.dispatchId)
        throw new Error(
          'Cross-dispatch result input requires an explicit main handoff.',
        );
    }
    const configuration = await Effect.runPromise(
      resolveConfiguration(assignment, {
        cwd: inherited.cwd,
        agentDir: getAgentDir(),
        user: settings,
        parent: inherited,
        availableTools: ceiling,
      }),
    );
    const agent: AgentRecord = {
      id: randomUUID(),
      name: assignment.name,
      dispatchId,
      parentAgentId: parent?.agentId ?? null,
      createdAt: Date.now(),
      depth,
      configuration,
      currentTools: [...configuration.tools],
      sessionFile: null,
      workspace: null,
      held: false,
      released: false,
    };
    agents.push(agent);
    tasks.push(
      newAssignment(
        agent,
        assignment.prompt,
        assignment.description ?? assignment.prompt,
        caller,
        settings,
      ),
    );
  }
  const planned = tasks.map((task, index) => ({
    ...task,
    needs: [
      ...new Set([
        ...(edges[index] ?? []).map(dependency => {
          const upstream = tasks[dependency];
          if (!upstream)
            throw new Error('Dependency disappeared during admission.');
          return upstream.id;
        }),
        ...(assignments[index]?.inputs ?? []),
      ]),
    ],
  }));
  return {dispatchId, agents, tasks: planned};
}
