import type {
  ExtensionAPI,
  MarkdownTransformer,
} from '@earendil-works/pi-coding-agent';
import {Markdown, visibleWidth} from '@earendil-works/pi-tui';
import {Option, Schema} from 'effect';
import {
  prepareFencedVisualizations,
  type ProjectedVisualizationBlock,
} from './fenced-visualization';

type Token = {type: string; lang?: string; text?: string};
type InlineStyle = {applyText: (text: string) => string; stylePrefix: string};
type RenderToken = (
  this: Markdown,
  token: Token,
  width: number,
  next?: string,
  style?: InlineStyle,
) => string[];
const NativeToken = Schema.Struct({
  renderToken: Schema.declare<RenderToken>(
    (value): value is RenderToken => value instanceof Function,
  ),
});
const Color = Schema.declare<(text: string) => string>(
  (value): value is (text: string) => string => value instanceof Function,
);
const Layout = Schema.Struct({
  theme: Schema.Struct({
    codeBlock: Color,
    codeBlockIndent: Schema.optional(Schema.String),
  }),
});

// Source transformation is scoped by Pi's public message-type API. Its private
// token adapter displays only our generated code blocks before wrapping/padding.
export function registerVisualizations(
  pi: Pick<ExtensionAPI, 'registerMarkdownTransformer' | 'on'>,
): MarkdownTransformer {
  const metadata = new WeakMap<
    Markdown,
    {blocks: readonly ProjectedVisualizationBlock[]; index: number}
  >();
  const stack: Markdown[] = [];
  let active = true;
  const native = Schema.decodeUnknownSync(NativeToken)(
    Markdown.prototype,
  ).renderToken;
  const original = Markdown.prototype.render;
  const transform: MarkdownTransformer = (text, context) => {
    const current = stack.at(-1);
    if (!active || !current || context.messageType === 'assistant-thinking')
      return text;
    const layout = Schema.decodeUnknownOption(Layout)(current);
    if (Option.isNone(layout)) return text;
    const indent = layout.value.theme.codeBlockIndent ?? '  ';
    const projection = prepareFencedVisualizations(
      text,
      Math.max(0, context.availableWidth - visibleWidth(indent)),
      visibleWidth,
    );
    metadata.set(current, {blocks: projection.projectedBlocks, index: 0});
    return projection.markdown;
  };
  pi.registerMarkdownTransformer(transform);
  const render: typeof original = function (this: Markdown, width) {
    if (!active) return original.call(this, width);
    stack.push(this);
    try {
      return original.call(this, width);
    } finally {
      stack.pop();
    }
  };
  const renderToken: RenderToken = function (token, width, next, style) {
    const state = active ? metadata.get(this) : undefined;
    const block = state?.blocks[state.index];
    if (token.type !== 'code' || !block || token.lang !== block.language)
      return native.call(this, token, width, next, style);
    const layout = Schema.decodeUnknownSync(Layout)(this);
    if (state) state.index++;
    const indent = layout.theme.codeBlockIndent ?? '  ';
    const lines = [
      block.firstLine,
      ...(token.text ? token.text.split('\n') : []),
    ].map(line => indent + layout.theme.codeBlock(line));
    if (next && next !== 'space') lines.push('');
    return lines;
  };
  Markdown.prototype.render = render;
  Object.assign(Markdown.prototype, {renderToken});
  pi.on('session_shutdown', event => {
    if (event.reason !== 'quit' && event.reason !== 'reload') return;
    active = false;
    if (Markdown.prototype.render === render)
      Markdown.prototype.render = original;
    const current = Schema.decodeUnknownOption(NativeToken)(Markdown.prototype);
    if (Option.isSome(current) && current.value.renderToken === renderToken)
      Object.assign(Markdown.prototype, {renderToken: native});
  });
  return transform;
}
