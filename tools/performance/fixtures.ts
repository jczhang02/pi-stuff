import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
export default function (pi: ExtensionAPI) {
  pi.registerCommand('perf-draft', {
    description: 'Isolated benchmark draft',
    handler: async (args, ctx) => {
      const size = Number(args.trim());
      const line =
        'Review /skill:review plain text with 中文 and sample data.\n';
      ctx.ui.setEditorText(
        line.repeat(Math.ceil(size / line.length)).slice(0, size) + '\nEND_TAG',
      );
    },
  });
  pi.registerCommand('perf-evil', {
    description: 'Pathological draft',
    handler: async (_args, ctx) =>
      ctx.ui.setEditorText('a'.repeat(80) + '! END_TAG'),
  });
  pi.registerCommand('perf-message', {
    description: 'Isolated benchmark message',
    handler: async args => {
      const [kind, id] = args.trim().split(' ');
      const tree =
        '```tree\nroot\n' +
        Array.from({length: 255}, (_, i) => `  node-${i}`).join('\n') +
        '\n```';
      const chart =
        '```chart\ntype: heatmap\n' +
        Array.from({length: 32}, () =>
          Array.from({length: 64}, (_, i) => String(i % 10)).join(' '),
        ).join('\n') +
        '\n```';
      const content =
        kind === 'tree'
          ? Array(16).fill(tree).join('\n\n')
          : kind === 'chart'
            ? Array(16).fill(chart).join('\n\n')
            : kind === 'skill'
              ? '<skill name="review" location="/fixture/SKILL.md">\n' +
                'Inspect changes and preserve semantics.\n'.repeat(400) +
                'INSTRUCTIONS_END\n</skill>\n\nCheck this file.'
              : 'Ordinary text without diagrams.\n'.repeat(500);
      pi.sendUserMessage(content + `\n\nBODY_END_${id}`);
    },
  });
  pi.registerCommand('perf-pid', {
    description: 'Isolated benchmark process',
    handler: async (_args, ctx) => {
      ctx.ui.notify(`PERF_PID_${process.pid}`, 'info');
    },
  });
}
