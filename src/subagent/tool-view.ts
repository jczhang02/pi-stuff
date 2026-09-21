import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {Text} from '@earendil-works/pi-tui';
import {Schema} from 'effect';

const Task = Schema.Struct({agent: Schema.String, status: Schema.String});
const Run = Schema.Struct({status: Schema.String, tasks: Schema.Array(Task)});

export const renderSubagentResult: NonNullable<
  ToolDefinition['renderResult']
> = (result, options, theme) => {
  if (options.expanded)
    return new Text(
      result.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n'),
      0,
      0,
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
  return new Text(
    result.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n'),
    0,
    0,
  );
};
