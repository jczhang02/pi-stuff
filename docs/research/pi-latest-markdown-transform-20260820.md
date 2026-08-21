# Pi Markdown transformation API as of 2026-08-20

## Question

Can the current public Pi Extension API add one Assistant transcript marker on the same terminal row as a leading Markdown list, without adding a row or replacing the list's own marker?

## Version checked

- The latest official release is [`v0.84.2`](https://github.com/earendil-works/pi/releases/tag/v0.84.2), released on 2026-08-14 at commit [`914cf14`](https://github.com/earendil-works/pi/commit/914cf1472e715297caa30db4b9535d534a9eb718).
- The default branch was also checked on 2026-08-20. Its commit history had advanced beyond the release through 2026-08-19, while the coding-agent package still reported version `0.84.2`: [main history](https://github.com/earendil-works/pi/commits/main), [main package.json](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json).

## Findings

### The transformer is still source-to-source

Both `v0.84.2` and current `main` define the transformer as:

```ts
export type MarkdownTransformer = (markdown: string, context: MarkdownTransformContext) => string;
```

The context contains only `messageType`, `isStreaming`, and `availableWidth`. It has no rendered-line prefix, gutter, component, theme, or decoration field. See [`types.ts` on main](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts#L1074-L1105) and the [`v0.84.2` source](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/src/core/extensions/types.ts#L1059-L1090).

The official extension guide says that transformer results are chained as Markdown strings and then passed to Pi's built-in renderer. It also requires the transform to remain synchronous and inexpensive because it runs during streaming, restored replay, and terminal resizing. See [`extensions.md` on main](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#piregistermarkdowntransformertransformer) and the [`v0.84.2` guide](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/extensions.md#piregistermarkdowntransformertransformer).

The current implementation confirms that only string results are accepted and returned: [`markdown-transform.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/markdown-transform.ts).

### Pi still owns ordinary Assistant rendering

`AssistantMessageComponent` constructs the built-in `Markdown` component for ordinary Assistant text and passes the registered source transform into it. There is no ordinary-Assistant renderer override or post-render line decorator: [`assistant-message.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L83-L106).

`registerMessageRenderer()` applies only to extension-created `CustomMessage` records. `registerEntryRenderer()` applies only to extension-created `CustomEntry` records. Neither can replace or decorate a normal Assistant message: [`extensions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#message-and-entry-rendering).

### The TUI Markdown component has no general line-prefix option

Current `MarkdownOptions` exposes source transformation, list-marker preservation, escape preservation, and LaTeX rendering. It has no first-line or continuation-line prefix option. The transform runs before lexing and wrapping: [`packages/tui/src/components/markdown.ts`](https://github.com/earendil-works/pi/blob/main/packages/tui/src/components/markdown.ts#L204-L213), [`render()`](https://github.com/earendil-works/pi/blob/main/packages/tui/src/components/markdown.ts#L258-L341).

## Conclusion

The latest release and current default branch do not expose a public package-only way to attach a message-level gutter to ordinary Assistant Markdown after rendering.

A string transform can make the marker visible only by changing the Markdown structure. For a leading list, the available workarounds each violate a requirement:

- adding an otherwise empty outer item creates a marker-only row;
- replacing the first real list marker conflates message and list ownership;
- escaping or flattening the list loses real Markdown list structure;
- patching Host theme/render internals is not a stable public Extension solution.

The narrow public-interface fix would be to extend the existing display-projection contract with rendered-line prefix metadata, or add the equivalent line-prefix option to the Host-owned Markdown render path. Pi could then render the original Markdown at the reduced content width and apply `"• "` to the first rendered line and `"  "` to continuation lines.

## Certified-host package workaround

When changing the Host is out of scope, Pi Stuff can still produce the required layout by reusing the certified Host theme binding that its current Assistant marker projection already uses:

1. Wrap only a leading-list Assistant display projection in one synthetic Markdown blockquote. A blockquote is the built-in Markdown structure that supplies a prefix to every rendered line after nested Markdown has been parsed and wrapped.
2. Run a measurement render of the unchanged Assistant Markdown at `availableWidth - 2` with an identity Markdown theme. Record the rendered line count and the inner italic, quote-style, and quote-border call counts.
3. During the real render, pass through exactly those measured inner calls. Neutralize only the synthetic outer quote's italic/color styling, paint its first border as `"• "`, paint its remaining borders as `"  "`, and restore the Host theme methods synchronously after the measured final outer line.

This keeps real nested quotes untouched and prevents the temporary theme projection from leaking into a later Markdown child in the same TUI frame. A throwaway probe against the certified real renderer produced the required output for flat, wrapped, nested, ordered, task, quoted, code-block, rich-inline, and table cases, including:

```text
• - one
  - two

• 1. one
  2. two

• - one
      - child
  - two
```

The tradeoff is one additional synchronous Markdown render for affected leading-list messages. The transform remains display-only; Session and model-context Markdown are unchanged. This is not a generally portable public Extension technique, but it is a bounded package implementation against the repository's explicitly certified Host profile and does not require a Host source change.
