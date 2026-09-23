import type {
  ExtensionAPI,
  MarkdownTransformer,
} from '@earendil-works/pi-coding-agent';
import {
  Markdown,
  stripTerminalSequences,
  visibleWidth,
} from '@earendil-works/pi-tui';
import {
  prepareFencedVisualizations,
  type ProjectedVisualizationBlock,
} from './fenced-visualization';

// One transformer owns projection. The render scope associates metadata with
// only the Markdown instance that actually invoked this extension's transformer.
export function registerVisualizations(pi: ExtensionAPI): MarkdownTransformer {
  const metadata = new WeakMap<
    Markdown,
    readonly ProjectedVisualizationBlock[]
  >();
  const stack: Markdown[] = [];
  let active = true;
  const transform: MarkdownTransformer = (text, context) => {
    if (!active || context.messageType === 'assistant-thinking') return text;
    const projection = prepareFencedVisualizations(
      text,
      Math.max(0, context.availableWidth - 2),
      visibleWidth,
    );
    const current = stack.at(-1);
    if (current) metadata.set(current, projection.projectedBlocks);
    return projection.markdown;
  };
  pi.registerMarkdownTransformer(transform);
  const original = Markdown.prototype.render;
  const render: typeof original = function (this: Markdown, width) {
    if (!active) return original.call(this, width);
    stack.push(this);
    let lines: string[];
    try {
      lines = original.call(this, width);
    } finally {
      stack.pop();
    }
    const blocks = metadata.get(this);
    if (!blocks?.length) return lines;
    let index = 0;
    let indentation: string | undefined;
    const output: string[] = [];
    for (const line of lines) {
      const plain = stripTerminalSequences(line).trimEnd();
      const block = blocks[index];
      if (
        indentation === undefined &&
        block &&
        plain.trimStart() === '```' + block.language
      ) {
        output.push(line.replace('```' + block.language, block.firstLine));
        indentation = plain.slice(0, plain.indexOf('```'));
      } else if (indentation !== undefined && plain === indentation + '```') {
        indentation = undefined;
        index++;
      } else output.push(line);
    }
    return output;
  };
  Markdown.prototype.render = render;
  pi.on('session_shutdown', event => {
    if (event.reason !== 'quit' && event.reason !== 'reload') return;
    active = false;
    if (Markdown.prototype.render === render)
      Markdown.prototype.render = original;
  });
  return transform;
}
