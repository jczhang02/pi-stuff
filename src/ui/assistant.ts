import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type MarkdownTransformer,
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  Markdown,
  MouseRegion,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {Option, Schema} from 'effect';
import {ThinkingTimes} from './thinking';

const AssistantLayout = Schema.Struct({
  contentContainer: Schema.instanceOf(Container),
  markdownTransformers: Schema.Array(Schema.instanceOf(Function)),
});
const MarkdownLayout = Schema.Struct({paddingX: Schema.Number});
const ThinkingRegion = Schema.Struct({
  child: Schema.Union([Schema.instanceOf(Markdown), Schema.instanceOf(Text)]),
});

export function registerAssistantDisplay(
  pi: ExtensionAPI,
  owner: MarkdownTransformer,
) {
  const times = new ThinkingTimes(pi);
  // The shared transformer identifies components owned by this extension.
  const prototype = AssistantMessageComponent.prototype;
  const original = prototype.updateContent;
  let active = true;
  let thinkingStyle = (text: string) => text;
  pi.on('session_start', (_event, ctx) => {
    // Pi supplies a live theme proxy. Keep it, not the session-scoped context,
    // because old transcript components may render during session replacement.
    const theme = ctx.ui.theme;
    thinkingStyle = text => theme.fg('thinkingText', text);
  });

  const update: typeof original = function (
    this: AssistantMessageComponent,
    message,
    streaming,
  ) {
    original.call(this, message, streaming);
    if (!active) return;
    const layout = Schema.decodeUnknownOption(AssistantLayout)(this);
    if (
      Option.isNone(layout) ||
      !layout.value.markdownTransformers.includes(owner)
    )
      return;
    const runs = times.runs(message);
    let runIndex = 0;
    for (const component of layout.value.contentContainer.children) {
      const region =
        component instanceof MouseRegion
          ? Schema.decodeUnknownOption(ThinkingRegion)(component)
          : Option.none();
      const thinking = Option.isSome(region);
      const run = thinking ? runs[runIndex++] : undefined;
      const child = Option.isSome(region) ? region.value.child : component;
      if (!(child instanceof Markdown) && !(thinking && child instanceof Text))
        continue;
      const padding: object = child;
      if (!Schema.is(MarkdownLayout)(padding)) continue;
      // Native assembly creates fresh Markdown children. Validate its layout
      // field before replacing horizontal padding with the message gutter.
      Object.assign(padding, {paddingX: 0});
      const render = child.render.bind(child);
      let previous: string[] | undefined;
      let previousWidth: number | undefined;
      let previousLabel: string | undefined;
      let rendered: string[] = [];
      let hiddenLabel: string | undefined;
      child.render = width => {
        const seconds = run?.seconds;
        const title = `${run?.running ? 'Thinking' : 'Thoughts'}${seconds === undefined ? '' : ` · ${seconds}s`}`;
        const label =
          thinking && child instanceof Markdown
            ? run?.running
              ? `${title} `
              : 'Thoughts: '
            : '';
        if (thinking && child instanceof Text) {
          if (title !== hiddenLabel) {
            child.setText(title);
            hiddenLabel = title;
          }
        }
        const lines = render(Math.max(1, width - 2 - label.length));
        if (
          previous === lines &&
          previousWidth === width &&
          previousLabel === label
        )
          return rendered;
        previous = lines;
        previousWidth = width;
        previousLabel = label;
        rendered = lines.flatMap((line, index) => {
          const body =
            index === lines.length - 1 &&
            thinking &&
            child instanceof Markdown &&
            seconds !== undefined &&
            !run?.running
              ? wrapTextWithAnsi(
                  `${index === 0 && label ? thinkingStyle(label) : ''}${line.trimEnd()}${thinkingStyle(`  ${seconds}s`)}`,
                  Math.max(1, width - 2),
                )
              : [
                  `${index === 0 && label ? thinkingStyle(label) : ''}${thinking && child instanceof Text ? thinkingStyle(line) : line}`,
                ];
          return body.map((row, continuation) => {
            const prefix = index === 0 && continuation === 0 ? '• ' : '  ';
            return truncateToWidth(
              `${thinking ? thinkingStyle(prefix) : prefix}${row}`,
              width,
            );
          });
        });
        return rendered;
      };
    }
  };
  prototype.updateContent = update;
  pi.on('session_shutdown', event => {
    if (event.reason !== 'quit' && event.reason !== 'reload') return;
    // Remain inert if another extension later restores this wrapper.
    active = false;
    if (prototype.updateContent === update) prototype.updateContent = original;
  });
}
