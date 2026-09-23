import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {visibleWidth} from '@earendil-works/pi-tui';
import {BashDisplay} from '../../../src/ui/bash';
import {displayRetrieval} from '../../../src/ui/retrieval';

export default function (pi: ExtensionAPI) {
  const bash = new BashDisplay(pi);
  pi.registerCommand('check-result-width', {
    description:
      'Check result components at widths too small for the full host UI',
    handler: async (label, ctx) => {
      const tools = [
        displayRetrieval({name: 'read'}, 'Read', () => 'fixture.txt'),
        {name: 'bash', ...bash.display({}, {})},
      ];
      for (const tool of tools) {
        for (const text of [
          '\u0301\u093eX',
          'normal\n\u0301\u093eX',
          '界'.repeat(30),
          'e\u0301'.repeat(40),
        ]) {
          for (const options of [
            {expanded: true, isPartial: false},
            {expanded: false, isPartial: false},
            {expanded: false, isPartial: true},
          ]) {
            const component = tool.renderResult?.(
              {content: [{type: 'text', text}], details: undefined},
              options,
              ctx.ui.theme,
              {
                args: {path: 'fixture.txt', command: 'fixture'},
                toolCallId: 'width-fixture',
                invalidate() {},
                lastComponent: undefined,
                state: {},
                cwd: ctx.cwd,
                executionStarted: true,
                argsComplete: true,
                showImages: false,
                isError: false,
                ...options,
              },
            );
            if (!component) throw new Error('Missing result renderer');
            for (const width of [1, 2, 3, 4, 5, 6, 7, 60, 80, 120]) {
              for (const line of component.render(width)) {
                if (visibleWidth(line) > width) {
                  ctx.ui.notify(
                    `${label.trim()}:WIDTH_FAIL:${tool.name}:${width}:${visibleWidth(line)}`,
                    'error',
                  );
                  return;
                }
              }
            }
          }
        }
      }
      ctx.ui.notify(`${label.trim()}:WIDTH_OK`, 'info');
    },
  });
}
