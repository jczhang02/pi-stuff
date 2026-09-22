import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type MarkdownTransformer,
} from '@earendil-works/pi-coding-agent';
import {Container, Markdown, truncateToWidth} from '@earendil-works/pi-tui';
import {Option, Schema} from 'effect';

const AssistantLayout = Schema.Struct({
  contentContainer: Schema.instanceOf(Container),
  markdownTransformers: Schema.Array(Schema.instanceOf(Function)),
});
const MarkdownLayout = Schema.Struct({paddingX: Schema.Number});

export function registerAssistantDisplay(pi: ExtensionAPI): void {
  // The identity transformer marks only components belonging to this extension
  // runtime. It never adds display text to Markdown or provider messages.
  const owner: MarkdownTransformer = text => text;
  pi.registerMarkdownTransformer(owner);
  const prototype = AssistantMessageComponent.prototype;
  const original = prototype.updateContent;
  let active = true;

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
    for (const child of layout.value.contentContainer.children) {
      if (!(child instanceof Markdown)) continue;
      const padding: object = child;
      if (!Schema.is(MarkdownLayout)(padding)) continue;
      // Native assembly creates fresh Markdown children. Validate its layout
      // field before replacing horizontal padding with the message gutter.
      Object.assign(padding, {paddingX: 0});
      const render = child.render.bind(child);
      let previous: string[] | undefined;
      let previousWidth: number | undefined;
      let rendered: string[] = [];
      child.render = width => {
        const lines = render(Math.max(1, width - 2));
        if (previous === lines && previousWidth === width) return rendered;
        previous = lines;
        previousWidth = width;
        rendered = lines.map((line, index) =>
          truncateToWidth(`${index === 0 ? '• ' : '  '}${line}`, width),
        );
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
