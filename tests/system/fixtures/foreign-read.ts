import {
  createReadToolDefinition,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import {Text} from '@earendil-works/pi-tui';

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'foreign_job',
    label: 'Job',
    description: 'Fixture job with non-native arguments and details',
    parameters: Type.Object({
      jobId: Type.String(),
      fail: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, args) => {
      if (args.fail) throw new Error(`JOB_FAILED:${args.jobId}`);
      return {
        content: [{type: 'text', text: `JOB:${args.jobId}\nDONE`}],
        details: {matchLimitReached: 'foreign-format'},
      };
    },
    renderCall: () => new Text('FOREIGN_JOB_HEADING', 0, 0),
    renderResult: () => new Text('FOREIGN_JOB_VIEW', 0, 0),
  });
  pi.registerTool({
    ...createReadToolDefinition(process.cwd()),
    execute: async (_id, args) => ({
      content: [{type: 'text', text: `FOREIGN_READ_EXECUTION:${args.path}`}],
      details: undefined,
    }),
    renderCall: args => new Text(`FOREIGN_READ_HEADING:${args.path}`, 0, 0),
    renderResult: (_result, _options, _theme, context) =>
      new Text(`FOREIGN_READ_RESULT_VIEW:${context.args.path}`, 0, 0),
  });
}
