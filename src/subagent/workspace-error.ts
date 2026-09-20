import {Schema} from 'effect';

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
  'WorkspaceError',
  {
    kind: Schema.Literals([
      'input',
      'git',
      'capture',
      'race',
      'workspace',
      'artifact',
      'release',
      'unsupported',
      'cancelled',
      'io',
    ]),
    message: Schema.String,
  },
) {}
