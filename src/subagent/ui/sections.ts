import {isPendingQuestion} from '../coordinator-mailbox';
import type {FleetRecord, TaskRecord} from '../records';
import {formatTokens, stateOf, timestamp} from './format';
import {childrenOf, prerequisiteNames} from './navigation';
import type {DetailSection} from './types';

export const detailSections: readonly DetailSection[] = [
  'prompt',
  'progress',
  'result',
  'communication',
  'relations',
  'configuration',
  'workspace',
  'history',
];

export const sectionLabels: Readonly<Record<DetailSection, string>> = {
  prompt: 'Prompt',
  progress: 'Progress',
  result: 'Result',
  communication: 'Communication',
  relations: 'Relations and queue',
  configuration: 'Configuration and usage',
  workspace: 'Workspace and recovery',
  history: 'History and evidence',
};

interface SectionContext {
  readonly snapshot: FleetRecord;
  readonly task: TaskRecord;
  readonly now: number;
  readonly selectedHistoryTaskId: string | undefined;
  readonly mode: 'preview' | 'full';
}

const LOW_SIGNAL_PROGRESS_EVENTS = new Set([
  'limits',
  'resources',
  'restriction',
]);

/** Shared content projection for inline detail, full reading and copying. */
const sections: Readonly<
  Record<DetailSection, (context: SectionContext) => readonly string[]>
> = {
  prompt: ({snapshot, task, mode}) => {
    const lines = [`Original request: ${task.prompt}`];
    if (mode === 'full') {
      lines.push(
        `History copy: ${task.configuration.copyHistory ? 'enabled' : 'disabled'}`,
        `Fixed upstream inputs: ${prerequisiteNames(snapshot, task).join(', ') || 'none'}`,
      );
      return lines;
    }
    if (task.configuration.copyHistory) lines.push('History copy: enabled');
    const inputs = prerequisiteNames(snapshot, task);
    if (inputs.length > 0)
      lines.push(`Fixed upstream inputs: ${inputs.join(', ')}`);
    return lines;
  },
  progress: ({task, now, mode}) => {
    const stage = `Stage: ${task.stage || task.phase || 'unknown'}${task.reason ? ` · ${task.reason}` : ''}`;
    if (mode === 'preview') {
      const meaningful = task.events.filter(
        event => !LOW_SIGNAL_PROGRESS_EVENTS.has(event.kind),
      );
      const latest = meaningful.at(-1) ?? task.events.at(-1);
      return [
        stage,
        ...task.activeTools.map(
          tool =>
            `Active tool: ${tool.name} · ${tool.progress || 'in progress'}`,
        ),
        ...(task.liveText ? [`Live text: ${task.liveText}`] : []),
        ...(latest
          ? [
              `Latest activity: ${timestamp(latest.at)} · ${latest.kind} · ${latest.text}`,
            ]
          : []),
        `Last activity: ${timestamp(task.lastEventAt)} · ${Math.max(0, Math.floor((now - task.lastEventAt) / 1000))}s ago`,
      ];
    }
    return [
      stage,
      `Model: ${task.configuration.model} · retries: ${task.retries}`,
      `Started: ${timestamp(task.startedAt)} · ended: ${timestamp(task.endedAt)}`,
      `Last activity: ${timestamp(task.lastEventAt)}`,
      `Execution clock: ${task.executionMs}ms · limit: ${task.configuration.executionTimeoutMs ?? 'disabled'}`,
      ...task.activeTools.map(
        tool => `Active tool: ${tool.name} · ${tool.progress || 'in progress'}`,
      ),
      ...(task.liveText ? [`Live text: ${task.liveText}`] : []),
      ...task.events.map(
        event => `${timestamp(event.at)} · ${event.kind} · ${event.text}`,
      ),
    ];
  },
  result: ({task, mode}) => {
    if (mode === 'preview') {
      const lines = [`Report: ${task.report || 'No report is available.'}`];
      lines.push(previewOutcome(task));
      if (task.acceptance !== null && task.outcome !== 'fulfilled')
        lines.push(`Main review: ${task.acceptance ? 'accepted' : 'rejected'}`);
      if (task.files.length > 0) lines.push(`Files: ${task.files.join(', ')}`);
      if (task.checks.length > 0)
        lines.push(`Checks: ${task.checks.join(', ')}`);
      if (task.artifactError)
        lines.push(`Artifact issue: ${task.artifactError}`);
      if (task.unsavedFiles.length > 0)
        lines.push(`Unsaved files: ${task.unsavedFiles.join(', ')}`);
      if (task.commit) lines.push(`Commit: ${task.commit}`);
      if (task.diff) lines.push('Diff: available in the full retained record.');
      return lines;
    }
    return [
      `Declared outcome: ${task.declaration ?? 'not declared'} · final outcome: ${task.outcome ?? 'not settled'}`,
      `Report\n${task.report || 'No report is available.'}`,
      `Stop outcome: ${task.stopOutcome ?? 'none'} · ended: ${timestamp(task.endedAt)}`,
      `Main acceptance: ${task.acceptance === null ? 'unknown' : task.acceptance ? 'accepted' : 'rejected'} · durability: ${task.durability}`,
      `Artifact: ${task.artifactError ?? 'no artifact error recorded'}`,
      `Files: ${task.files.join(', ') || 'none'} · checks: ${task.checks.join(', ') || 'none'}`,
      `Commit: ${task.commit ?? '—'}`,
      `Diff\n${task.diff || 'No diff is recorded.'}`,
    ];
  },
  communication: ({snapshot, task, now}) => {
    const messages = snapshot.messages.filter(
      message => message.taskId === task.id || message.fromTaskId === task.id,
    );
    return messages.length
      ? messages.flatMap(message => {
          const status = isPendingQuestion(snapshot, message)
            ? 'pending reply'
            : message.consumedAt !== null
              ? `consumed ${timestamp(message.consumedAt)}`
              : message.expiresAt !== null && message.expiresAt <= now
                ? 'expired and unprocessed'
                : 'pending consumption';
          return [
            `${message.kind} from ${message.fromTaskId ?? 'main'} to ${message.taskId ?? 'main'}: ${message.text}`,
            `Received ${timestamp(message.receivedAt)} · ${status} · ${message.expiresAt === null ? 'no expiry' : `expires ${timestamp(message.expiresAt)}`}`,
          ];
        })
      : ['No recorded communication.'];
  },
  relations: ({snapshot, task}) => [
    `Parent: ${task.parentTaskId ?? 'main dispatch'}`,
    `Owned children: ${
      childrenOf(snapshot, task.id)
        .map(child => child.description)
        .join(', ') || 'none'
    }`,
    `Dependencies: ${prerequisiteNames(snapshot, task).join(', ') || 'none'}`,
    `Queue: ${task.phase === 'queued' ? task.reason : 'not queued'}`,
    `Retained agent queue: ${snapshot.agents.find(agent => agent.id === task.agentId)?.held ? 'held; explicit recovery required' : 'open'}`,
    ...snapshot.tasks
      .filter(
        candidate =>
          candidate.agentId === task.agentId && candidate.phase === 'queued',
      )
      .map(
        candidate => `Queued: ${candidate.description} · ${candidate.reason}`,
      ),
  ],
  configuration: ({snapshot, task}) => [
    `Role: ${task.configuration.role ?? 'default'} · model: ${task.configuration.model}`,
    `Thinking: ${task.configuration.thinking} · configured tools: ${task.configuration.tools.join(', ') || 'none'}`,
    `Current assignment tools: ${task.currentTools.join(', ') || 'none'}`,
    `Initial ceiling: ${task.configuration.ceiling.join(', ') || 'none'}`,
    `Extensions: ${task.configuration.extensions.join(', ') || 'none'}`,
    `Instructions: ${task.configuration.instructions || 'none'}`,
    `Usage: ${usageText(task)}`,
    dispatchUsage(snapshot, task),
    ...task.events
      .filter(event =>
        ['resources', 'limits', 'restriction'].includes(event.kind),
      )
      .map(event => `${timestamp(event.at)} · ${event.text}`),
  ],
  workspace: ({task}) => [
    `Directory: ${task.workspaceDirectory ?? 'unavailable'} · mode: ${task.configuration.workspace}`,
    `Baseline: ${task.baseline ?? task.configuration.baseline ?? 'unavailable'}`,
    `Session: ${task.sessionFile ?? 'unavailable'} · durability: ${task.durability}`,
    `Phase: ${task.phase} · recovery: ${task.reason || 'no blocker recorded'}`,
    `Artifact: ${task.artifactError ?? 'no artifact blocker recorded'}`,
    `Unsaved files: ${task.unsavedFiles.join(', ') || 'none reported'}`,
    `Ignored files: ${task.ignoredFiles.join(', ') || 'none reported'}`,
  ],
  history: ({snapshot, task, selectedHistoryTaskId, mode}) =>
    snapshot.tasks
      .filter(candidate => candidate.agentId === task.agentId)
      .toSorted((left, right) => left.admittedAt - right.admittedAt)
      .flatMap(assignment => [
        `${assignment.id === selectedHistoryTaskId ? '●' : '○'} ${timestamp(assignment.admittedAt)} · ${assignment.description || assignment.prompt} · ${stateOf(assignment)}`,
        ...(mode === 'preview'
          ? []
          : [
              `Assignment: ${assignment.id} · started ${timestamp(assignment.startedAt)} · ended ${timestamp(assignment.endedAt)}`,
              `Report: ${assignment.report || 'none'}`,
              ...assignment.events.map(
                event =>
                  `${timestamp(event.at)} · ${event.kind} · ${event.text}`,
              ),
            ]),
      ]),
};

export function projectSection(
  snapshot: FleetRecord,
  task: TaskRecord,
  section: string,
  now = Date.now(),
  selectedHistoryTaskId?: string,
  mode: 'preview' | 'full' = 'full',
): readonly string[] {
  const key = detailSections.find(candidate => candidate === section);
  return key === undefined
    ? ['Section unavailable.']
    : sections[key]({snapshot, task, now, selectedHistoryTaskId, mode});
}

function previewOutcome(task: TaskRecord): string {
  const declared = task.declaration ?? 'not declared';
  const final = task.outcome ?? 'not settled';
  if (declared !== 'not declared' && declared !== final)
    return `Declared outcome: ${declared} · final outcome: ${final}`;
  if (final === 'fulfilled' && task.durability === 'saved')
    return task.acceptance === null
      ? 'Saved · awaiting main review'
      : task.acceptance
        ? 'Saved · accepted'
        : 'Saved · rejected';
  if (final === 'fulfilled') return `Fulfilled · save ${task.durability}`;
  if (final !== 'not settled') return `Outcome: ${final} · ${task.durability}`;
  if (declared !== 'not declared') return `Declared outcome: ${declared}`;
  return `Result: pending · durability ${task.durability}`;
}

function usageText(task: TaskRecord): string {
  if (task.usage === null)
    return `input — · output — · cache — · cost — · turns ${task.turns}`;
  return `input ${formatTokens(task.usage.input)} · output ${formatTokens(task.usage.output)} · cache read ${formatTokens(task.usage.cacheRead)} · cache write ${formatTokens(task.usage.cacheWrite)} · cost ${task.usage.cost.toFixed(3)} · turns ${task.turns}`;
}

function dispatchUsage(snapshot: FleetRecord, task: TaskRecord): string {
  const tasks = snapshot.tasks.filter(
    candidate => candidate.dispatchId === task.dispatchId,
  );
  const measured = tasks.filter(candidate => candidate.usage !== null);
  const output = measured.reduce(
    (sum, candidate) => sum + (candidate.usage?.output ?? 0),
    0,
  );
  const input = measured.reduce(
    (sum, candidate) => sum + (candidate.usage?.input ?? 0),
    0,
  );
  const cost = measured.reduce(
    (sum, candidate) => sum + (candidate.usage?.cost ?? 0),
    0,
  );
  return `Dispatch aggregate (each assignment once, including descendants/follow-ups): ${measured.length}/${tasks.length} measured · input ${measured.length ? formatTokens(input) : '—'} · output ${measured.length ? formatTokens(output) : '—'} · cost ${measured.length ? cost.toFixed(3) : '—'}${measured.length < tasks.length ? ' · partial; unknown usage excluded' : ''}`;
}
