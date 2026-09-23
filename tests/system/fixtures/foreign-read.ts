import {
  createReadToolDefinition,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import {Text} from '@earendil-works/pi-tui';

export default function (pi: ExtensionAPI) {
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
