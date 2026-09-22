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
} from '@earendil-works/pi-tui';
import {Option, Schema} from 'effect';

const AssistantLayout = Schema.Struct({
  contentContainer: Schema.instanceOf(Container),
  markdownTransformers: Schema.Array(Schema.instanceOf(Function)),
});
const MarkdownLayout = Schema.Struct({paddingX: Schema.Number});
const ThinkingRegion = Schema.Struct({
  child: Schema.Union([Schema.instanceOf(Markdown), Schema.instanceOf(Text)]),
});

export function registerAssistantDisplay(pi: ExtensionAPI): void {
  // The identity transformer marks only components belonging to this extension
  // runtime. It never adds display text to Markdown or provider messages.
  const owner: MarkdownTransformer = text => text;
  pi.registerMarkdownTransformer(owner);
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
    for (const component of layout.value.contentContainer.children) {
      const region =
        component instanceof MouseRegion
          ? Schema.decodeUnknownOption(ThinkingRegion)(component)
          : Option.none();
      const thinking = Option.isSome(region);
      const child = Option.isSome(region) ? region.value.child : component;
      if (!(child instanceof Markdown) && !(thinking && child instanceof Text))
        continue;
      const label = thinking && child instanceof Markdown ? 'Thoughts: ' : '';
      const padding: object = child;
      if (!Schema.is(MarkdownLayout)(padding)) continue;
      if (thinking && child instanceof Text) child.setText('Thoughts');
      // Native assembly creates fresh Markdown children. Validate its layout
      // field before replacing horizontal padding with the message gutter.
      Object.assign(padding, {paddingX: 0});
      const render = child.render.bind(child);
      let previous: string[] | undefined;
      let previousWidth: number | undefined;
      let rendered: string[] = [];
      child.render = width => {
        const lines = render(Math.max(1, width - 2 - label.length));
        if (previous === lines && previousWidth === width) return rendered;
        previous = lines;
        previousWidth = width;
        rendered = lines.map((line, index) => {
          const prefix = index === 0 ? `• ${label}` : '  ';
          return truncateToWidth(
            `${thinking ? thinkingStyle(prefix) : prefix}${thinking && child instanceof Text ? thinkingStyle(line) : line}`,
            width,
          );
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
