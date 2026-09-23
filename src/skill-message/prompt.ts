import {Markdown} from '@earendil-works/pi-tui';
import {Schema} from 'effect';

type Token = {type: string};
type InlineStyle = {applyText: (text: string) => string; stylePrefix: string};
type RenderToken = (
  this: Markdown,
  token: Token,
  width: number,
  next?: string,
  style?: InlineStyle,
) => string[];
const Native = Schema.Struct({
  renderToken: Schema.declare<RenderToken>(
    (value): value is RenderToken => value instanceof Function,
  ),
  applyDefaultStyle: Schema.declare<(text: string) => string>(
    (value): value is (text: string) => string => value instanceof Function,
  ),
});

// Keep the prompt's parser input intact. Definitions and nested blocks remain
// native; only the first visible top-level block receives the skill label.
export function prependSkillLabel(markdown: Markdown, label: string) {
  const native = Schema.decodeUnknownSync(Native)(Markdown.prototype);
  const render = markdown.render.bind(markdown);
  let pending = true;
  let depth = 0;
  markdown.render = width => {
    pending = true;
    return render(width);
  };
  const renderToken: RenderToken = function (token, width, next, style) {
    depth++;
    let rows: string[];
    try {
      rows = native.renderToken.call(this, token, width, next, style);
    } finally {
      depth--;
    }
    if (depth || !pending || token.type === 'space' || !rows.length)
      return rows;
    pending = false;
    const prefix = native.applyDefaultStyle.call(this, label);
    return token.type === 'paragraph'
      ? [prefix + ' ' + (rows[0] ?? ''), ...rows.slice(1)]
      : [prefix, ...rows];
  };
  Object.assign(markdown, {renderToken});
}
