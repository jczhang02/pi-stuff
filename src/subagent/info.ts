import type {RequestRecord, Usage} from './records';

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function fenced(value: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${fence}\n${value}\n${fence}`;
}

function markdownValue(value: string): string {
  return value.includes('\n') || value.includes('\r')
    ? fenced(value)
    : `${'`'.repeat(Math.max(1, longestBacktickRun(value) + 1))} ${value} ${'`'.repeat(Math.max(1, longestBacktickRun(value) + 1))}`;
}

function row(label: string, value: string): string {
  if (value.includes('\n') || value.includes('\r')) {
    return `- ${label}:\n${fenced(value)
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n')}`;
  }
  return `- ${label}: ${markdownValue(value)}`;
}

function available(value: number | undefined): string {
  return value === undefined ? 'unavailable' : String(value);
}

function usageRows(label: string, usage: Usage | undefined): string[] {
  if (usage === undefined) return [`### ${label}`, '- unavailable'];
  return [
    `### ${label}`,
    row('Input', available(usage.input)),
    row('Output', available(usage.output)),
    row('Cache read', available(usage.cacheRead)),
    row('Cache write', available(usage.cacheWrite)),
    row('Cost (USD)', available(usage.cost)),
    row('Turns', available(usage.turns)),
  ];
}

function errorRows(task: RequestRecord): string[] {
  const rows: string[] = [];
  if (task.error !== undefined) rows.push(row('Execution', task.error));
  if (task.preservationError !== undefined)
    rows.push(row('Preservation', task.preservationError));
  if (task.cleanupError !== undefined)
    rows.push(row('Cleanup', task.cleanupError));
  if (task.notificationError !== undefined)
    rows.push(row('Notification', task.notificationError));
  for (const error of task.extensionErrors ?? [])
    rows.push(row('Extension', error));
  return rows;
}

/** Build the read-only Markdown document shown by the task Info surface. */
export function taskInfo(task: RequestRecord, cumulativeUsage?: Usage): string {
  const configuration = [
    '## Effective configuration',
    row('Status', task.status),
    row('Agent', task.agent),
    row('Model', task.model ?? 'unavailable'),
    row('Provider', task.provider ?? 'unavailable'),
    row('Thinking', task.thinking ?? 'unavailable'),
    row('Tools', task.tools.length > 0 ? task.tools.join(', ') : 'none'),
    row(
      'Working directory',
      task.workspace?.cwd ?? (task.cwd || 'unavailable'),
    ),
    row(
      'Session file',
      task.sessionFile === undefined ? 'unavailable' : task.sessionFile,
    ),
  ];
  if (task.roleSource !== undefined)
    configuration.push(row('Role source', task.roleSource));
  if (task.configurationNotes.length > 0) {
    configuration.push('### Override notes');
    for (const note of task.configurationNotes)
      configuration.push(row('Note', note));
  }

  const workspaceRows: string[] = [];
  if (task.workspace !== undefined || task.git !== undefined) {
    workspaceRows.push('## Workspace and Git');
    if (task.workspace === undefined) {
      workspaceRows.push(row('Workspace', 'unavailable'));
    } else {
      workspaceRows.push(row('Workspace root', task.workspace.root));
      workspaceRows.push(row('Workspace path', task.workspace.path));
      workspaceRows.push(row('Branch', task.workspace.branch));
      workspaceRows.push(row('Base / ancestry', task.workspace.base));
    }
    if (task.git === undefined) {
      workspaceRows.push(row('Git outcome', 'unavailable'));
    } else {
      workspaceRows.push(row('Git outcome', task.git.status));
      workspaceRows.push(
        row(
          'Changed files',
          task.git.changedFiles.length > 0
            ? task.git.changedFiles.join(', ')
            : 'none',
        ),
      );
      workspaceRows.push(
        row(
          'Diffstat',
          task.git.diffStat.length > 0 ? task.git.diffStat : 'none',
        ),
      );
      if (task.git.status === 'committed')
        workspaceRows.push(row('Commit', task.git.commitSha));
    }
  }

  const usage = [
    '## Usage',
    ...usageRows('Current request', task.usage),
    ...usageRows('Cumulative child', cumulativeUsage),
  ];
  const errors = errorRows(task);
  if (errors.length > 0) {
    usage.push('## Errors');
    usage.push(...errors);
  }

  return ['# Info', ...configuration, ...workspaceRows, ...usage].join('\n');
}
