import type {FleetRecord, TaskRecord} from './records';
import type {SubagentInput} from './protocol';

function taskFor(record: FleetRecord, id: string): TaskRecord {
  const task = record.tasks.find(candidate => candidate.id === id);
  if (!task)
    throw new Error('Unknown task. Use inspect to obtain an identity.');
  return task;
}

export function inspectFleet(
  record: FleetRecord,
  input: SubagentInput,
  caller: string | null,
  preview: number,
) {
  const dispatchId = caller
    ? taskFor(record, caller).dispatchId
    : input.dispatchId;
  const tasks = record.tasks.filter(
    task =>
      (!dispatchId || task.dispatchId === dispatchId) &&
      (!input.taskId || task.id === input.taskId) &&
      (!input.agentId || task.agentId === input.agentId),
  );
  const ids = new Set(tasks.map(task => task.id));
  const callerTask = caller ? taskFor(record, caller) : undefined;
  const inputReferences = callerTask
    ? record.tasks
        .filter(
          task =>
            callerTask.needs.includes(task.id) &&
            task.dispatchId !== callerTask.dispatchId,
        )
        .map(task => ({
          id: task.id,
          dispatchId: task.dispatchId,
          outcome: task.outcome,
          durability: task.durability,
          baseline: task.baseline,
          commit: task.commit,
          files: task.files,
          checks: task.checks,
        }))
    : [];
  return {
    ...record,
    usage: {
      measuredTasks: tasks.filter(task => task.usage !== null).length,
      unmeasuredTasks: tasks.filter(task => task.usage === null).length,
      input: tasks.reduce((sum, task) => sum + (task.usage?.input ?? 0), 0),
      output: tasks.reduce((sum, task) => sum + (task.usage?.output ?? 0), 0),
      cacheRead: tasks.reduce(
        (sum, task) => sum + (task.usage?.cacheRead ?? 0),
        0,
      ),
      cacheWrite: tasks.reduce(
        (sum, task) => sum + (task.usage?.cacheWrite ?? 0),
        0,
      ),
      cost: tasks.reduce((sum, task) => sum + (task.usage?.cost ?? 0), 0),
      turns: tasks.reduce((sum, task) => sum + task.turns, 0),
    },
    agents: record.agents.filter(agent =>
      tasks.some(task => task.agentId === agent.id),
    ),
    dispatches: record.dispatches.filter(
      dispatch => !dispatchId || dispatch.id === dispatchId,
    ),
    tasks: tasks.map(task => ({
      ...task,
      report: task.report.slice(0, preview),
      reportCharacters: task.report.length,
      previewTruncated: task.report.length > preview,
      diff: undefined,
      events: undefined,
      fullRecords: ['report', 'transcript', 'diff'],
    })),
    messages: record.messages.filter(message =>
      message.taskId
        ? ids.has(message.taskId) || message.taskId === caller
        : caller === null,
    ),
    notices: record.notices.filter(notice => ids.has(notice.taskId)),
    inputReferences,
  };
}

export function readTask(
  record: FleetRecord,
  input: SubagentInput,
  caller: string | null,
) {
  if (!input.taskId) throw new Error('read requires taskId.');
  const task = taskFor(record, input.taskId);
  const callerTask = caller ? taskFor(record, caller) : undefined;
  if (
    callerTask &&
    task.dispatchId !== callerTask.dispatchId &&
    (!callerTask.needs.includes(task.id) ||
      task.phase !== 'ended' ||
      task.outcome !== 'fulfilled' ||
      task.durability !== 'saved' ||
      input.record === 'transcript')
  )
    throw new Error(
      'Only an explicit saved input may be read across dispatches, and transcripts remain private.',
    );
  const text =
    input.record === 'diff'
      ? task.diff
      : input.record === 'transcript'
        ? task.events
            .map(
              event =>
                `${new Date(event.at).toISOString()} ${event.kind}\n${event.text}`,
            )
            .join('\n\n')
        : task.report;
  const offset = input.offset ?? 0;
  const end = Math.min(text.length, offset + (input.length ?? 8000));
  return {
    taskId: task.id,
    record: input.record ?? 'report',
    text: text.slice(offset, end),
    offset,
    total: text.length,
    nextOffset: end < text.length ? end : null,
    durability: task.durability,
    unavailable: task.durability === 'failed',
  };
}
