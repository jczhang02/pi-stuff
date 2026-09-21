import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {getMarkdownTheme} from '@earendil-works/pi-coding-agent';
import {Markdown, Text} from '@earendil-works/pi-tui';
import {Schema} from 'effect';

const Task = Schema.Struct({
  agent: Schema.String,
  status: Schema.String,
  finalText: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  question: Schema.optional(
    Schema.Union([
      Schema.Struct({text: Schema.String}),
      Schema.Struct({excerpt: Schema.String}),
    ]),
  ),
  preservationError: Schema.optional(Schema.String),
  cleanupError: Schema.optional(Schema.String),
  notificationError: Schema.optional(Schema.String),
  extensionErrors: Schema.optional(Schema.Array(Schema.String)),
  extensionErrorCount: Schema.optional(Schema.Number),
  finalizing: Schema.optional(Schema.Boolean),
  git: Schema.optional(
    Schema.Struct({
      status: Schema.String,
      commitSha: Schema.optional(Schema.String),
      diffStat: Schema.optional(Schema.String),
      changedFiles: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});
const Run = Schema.Struct({
  status: Schema.String,
  tasks: Schema.Array(Task),
  persistenceError: Schema.optional(Schema.String),
});

function contentText(
  result: Parameters<NonNullable<ToolDefinition['renderResult']>>[0],
) {
  return result.content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

function taskReport(task: typeof Task.Type): string {
  const sections: string[] = [];
  if (task.finalText === undefined)
    sections.push('Report not included in this result.');
  if (task.finalText !== undefined && task.finalText.length > 0)
    sections.push(task.finalText);
  if (task.question !== undefined)
    sections.push(
      'Question: ' +
        ('text' in task.question ? task.question.text : task.question.excerpt),
    );
  if (task.error !== undefined) sections.push(`Error: ${task.error}`);
  if (task.preservationError !== undefined)
    sections.push(`Commit failed: ${task.preservationError}`);
  if (task.cleanupError !== undefined)
    sections.push(`Cleanup failed: ${task.cleanupError}`);
  if (task.notificationError !== undefined)
    sections.push(`Notification failed: ${task.notificationError}`);
  for (const error of task.extensionErrors ?? [])
    sections.push(`Extension error: ${error}`);
  if (task.extensionErrorCount !== undefined && task.extensionErrorCount > 0)
    sections.push(`Extension errors: ${task.extensionErrorCount}`);
  if (task.finalizing === true) sections.push('Finalizing saved work.');
  if (task.git?.status === 'committed') {
    const commit = task.git.commitSha ? ` (${task.git.commitSha})` : '';
    const diff = task.git.diffStat ? `: ${task.git.diffStat}` : '';
    sections.push(`Saved commit${commit}${diff}`);
  }
  return sections.length > 0 ? sections.join('\n\n') : 'No report recorded.';
}

function expandedTask(task: typeof Task.Type): string {
  return [`### ${task.agent} · ${task.status}`, taskReport(task)].join('\n\n');
}

function expandedDetails(details: typeof Run.Type | typeof Task.Type): string {
  if (Schema.is(Run)(details))
    return [
      `## Subagent run · ${details.status}`,
      details.persistenceError === undefined
        ? ''
        : `Persistence failed: ${details.persistenceError}`,
      ...details.tasks.map(expandedTask),
    ]
      .filter(section => section.length > 0)
      .join('\n\n');
  return expandedTask(details);
}

export const renderSubagentResult: NonNullable<
  ToolDefinition['renderResult']
> = (result, options, theme) => {
  if (options.expanded)
    return new Markdown(
      Schema.is(Run)(result.details) || Schema.is(Task)(result.details)
        ? expandedDetails(result.details)
        : contentText(result),
      0,
      0,
      getMarkdownTheme(),
    );
  if (Schema.is(Run)(result.details)) {
    return new Text(
      result.details.tasks
        .map(task => `${theme.bold(task.agent)} · ${task.status}`)
        .join('\n'),
      0,
      0,
    );
  }
  if (Schema.is(Task)(result.details))
    return new Text(
      `${theme.bold(result.details.agent)} · ${result.details.status}`,
      0,
      0,
    );
  return new Text(contentText(result), 0, 0);
};
