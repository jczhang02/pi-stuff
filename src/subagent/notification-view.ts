import {
  getMarkdownTheme,
  keyHint,
  type MessageRenderer,
} from '@earendil-works/pi-coding-agent';
import {Markdown, Text} from '@earendil-works/pi-tui';
import {Schema} from 'effect';
import type {RunSnapshot, TaskSnapshot} from './records';

const NotificationTask = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  status: Schema.String,
});

const NotificationDetails = Schema.Struct({
  kind: Schema.Literals(['task', 'run']),
  runId: Schema.String,
  taskId: Schema.optional(Schema.String),
  status: Schema.String,
  tasks: Schema.Array(NotificationTask),
  summary: Schema.optional(Schema.String),
});

type NotificationDetails = typeof NotificationDetails.Type;

function contentText(
  content: string | readonly {type: string; text?: string}[],
) {
  return Schema.is(Schema.String)(content)
    ? content
    : content
        .filter(part => part.type === 'text')
        .map(part => part.text ?? '')
        .join('\n');
}

function oneLine(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function boundedSummary(text: string): string {
  const normalized = oneLine(text);
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized;
}

function notificationSummary(
  run: RunSnapshot,
  task: TaskSnapshot | undefined,
  message: string | undefined,
): string {
  if (message !== undefined) return boundedSummary(message);
  if (task?.question !== undefined) return 'Question for parent.';
  if (task?.error !== undefined) return boundedSummary(`Error: ${task.error}`);
  if (task?.preservationError !== undefined)
    return boundedSummary(`Commit failed: ${task.preservationError}`);
  if (task?.cleanupError !== undefined)
    return boundedSummary(`Cleanup failed: ${task.cleanupError}`);
  if (task?.notificationError !== undefined)
    return boundedSummary(`Notification failed: ${task.notificationError}`);
  if (task?.status === 'completed') return 'Report ready.';
  if (task === undefined) {
    const issue = run.tasks.find(
      child =>
        child.question !== undefined ||
        child.error !== undefined ||
        child.preservationError !== undefined ||
        child.cleanupError !== undefined ||
        child.notificationError !== undefined,
    );
    if (issue?.question !== undefined) return 'Question for parent.';
    if (issue?.error !== undefined)
      return boundedSummary(`Error: ${issue.error}`);
    if (issue?.preservationError !== undefined)
      return boundedSummary(`Commit failed: ${issue.preservationError}`);
    if (issue?.cleanupError !== undefined)
      return boundedSummary(`Cleanup failed: ${issue.cleanupError}`);
    if (issue?.notificationError !== undefined)
      return boundedSummary(`Notification failed: ${issue.notificationError}`);
    if (run.persistenceError !== undefined)
      return boundedSummary(`Persistence failed: ${run.persistenceError}`);
    if (run.status === 'completed') return 'Reports ready.';
    return 'Updated subagent requests.';
  }
  return 'Request updated.';
}

function taskEvidence(task: TaskSnapshot, message: string | undefined): string {
  const sections: string[] = [];
  if (message !== undefined) sections.push(message);
  if (task.question !== undefined)
    sections.push(`Question: ${task.question.text}`);
  if (task.finalText.length > 0) sections.push(task.finalText);
  if (task.error !== undefined) sections.push(`Error: ${task.error}`);
  if (task.preservationError !== undefined)
    sections.push(`Commit failed: ${task.preservationError}`);
  if (task.cleanupError !== undefined)
    sections.push(`Cleanup failed: ${task.cleanupError}`);
  if (task.notificationError !== undefined)
    sections.push(`Notification failed: ${task.notificationError}`);
  for (const error of task.extensionErrors ?? [])
    sections.push(`Extension error: ${error}`);
  if (task.finalizing === true) sections.push('Finalizing saved work.');
  if (task.git?.status === 'committed')
    sections.push(`Code saved: ${task.git.commitSha}`);
  else if (task.git?.status === 'empty')
    sections.push('No code changes to save.');
  return sections.length > 0 ? sections.join('\n\n') : 'No report recorded.';
}

export function createSubagentNotificationContent(
  run: RunSnapshot,
  task: TaskSnapshot | undefined,
  message: string | undefined,
): string {
  if (task !== undefined)
    return `${task.agent}: ${task.status}\n${taskEvidence(task, message)}`;
  const reports = run.tasks.map(
    child =>
      `${child.agent}: ${child.status}\n${taskEvidence(child, undefined)}`,
  );
  const persistence =
    run.persistenceError === undefined
      ? ''
      : `\n\nPersistence failed: ${run.persistenceError}`;
  return `Subagent run ${run.status}\n${reports.join('\n\n')}${persistence}`;
}

function taskLabels(tasks: readonly NotificationDetails['tasks'][number][]) {
  return boundedSummary(
    tasks.map(task => `${task.agent} · ${task.status}`).join(', '),
  );
}

function expandedBody(details: NotificationDetails, content: string): string {
  const title =
    details.kind === 'run'
      ? `### Subagent run · ${details.status}`
      : `### ${details.tasks[0]?.agent ?? 'Subagent'} · ${details.status}`;
  const requests =
    details.tasks.length > 0
      ? `Updated requests:\n${details.tasks.map(task => `- ${task.agent} · ${task.status}`).join('\n')}`
      : 'No request details recorded.';
  const report = content.trim();
  return [title, requests, report]
    .filter(section => section.length > 0)
    .join('\n\n');
}

export function createSubagentNotificationDetails(
  run: RunSnapshot,
  task: TaskSnapshot | undefined,
  message: string | undefined,
): NotificationDetails {
  const tasks = (task === undefined ? run.tasks : [task]).map(item => ({
    id: item.id,
    agent: item.agent,
    status: item.status,
  }));
  const summary = notificationSummary(run, task, message);
  if (task === undefined)
    return {
      kind: 'run',
      runId: run.id,
      status: run.status,
      tasks,
      summary,
    };
  return {
    kind: 'task',
    runId: run.id,
    taskId: task.id,
    status: task.status,
    tasks,
    summary,
  };
}

export const renderSubagentNotification: MessageRenderer<
  NotificationDetails
> = (message, options, theme) => {
  const content = contentText(message.content);
  const details = Schema.is(NotificationDetails)(message.details)
    ? message.details
    : undefined;
  if (options.expanded)
    return new Markdown(
      details === undefined ? content : expandedBody(details, content),
      0,
      0,
      getMarkdownTheme(),
    );
  if (details === undefined)
    return new Text(
      theme.fg(
        'customMessageText',
        `Subagent update · ${keyHint('app.tools.expand', 'to expand')}`,
      ),
      0,
      0,
    );
  const prefix =
    details.kind === 'run'
      ? `Subagents · ${details.status}`
      : `${details.tasks[0]?.agent ?? 'Subagent'} · ${details.status}`;
  const labels =
    details.kind === 'run' ? ` · ${taskLabels(details.tasks)}` : '';
  const summary = details.summary ? ` · ${details.summary}` : '';
  return new Text(
    theme.fg(
      'customMessageText',
      `${theme.bold(prefix)}${labels}${summary} · ${keyHint('app.tools.expand', 'to expand')}`,
    ),
    0,
    0,
  );
};
