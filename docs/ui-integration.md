# Assistant UI integration

[简体中文](i18n/zh-CN/ui-integration.md) · English is normative.

The accepted assistant/Thoughts presentation is still unimplemented. This record describes a public-API experiment, not the proposed final UI. The experiment ran on the installed compiled Pi 0.87.0 / Bun 1.4.0, with an isolated deterministic provider and a 100×45 Terminal Control session. Production baseline: `5accad3`.

## Observed limits

The experiment registered a Markdown transformer that prepended `• ` to assistant text and `• Thoughts: ` to thinking. It also exposed Pi's `setHiddenThinkingLabel` through a temporary command.

| Operation                                                                                      | Observed result                                                                                 | Consequence                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Prefix a response beginning with two Markdown list items                                       | The first line becomes `• - FIRST_LIST_ITEM`; the second marker remains two columns to its left | Source prefixing does not supply the accepted message gutter |
| Prefix visible thinking                                                                        | The entire Thoughts row remains italic; the captured frame contained 35 italic cells            | The prefix does not change Pi's default thinking typography  |
| Set the hidden label to `• Thoughts · 1s`, create another response, then set `• Thoughts · 2s` | Both historical thinking blocks display `2s`                                                    | A global label cannot represent independent durations        |

The `1s` and `2s` strings are deliberately assigned labels, not measured durations. The provider received the original prior assistant text without the display prefix.

![Public transformer experiment: list alignment and italic Thoughts](assets/ui/public-api-prefix-dark-100.png)

![Global label experiment: both history blocks acquire the latest label](assets/ui/public-api-labels-dark-100.png)

Pi's [extension types](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts) expose the transformer before Markdown rendering and a string-valued hidden label. The [assistant component](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/modes/interactive/components/assistant-message.ts) applies italic thinking styles and owns local visibility overrides. There is no registered assistant-component factory in that extension API. The installed 0.85.1 declarations have the same relevant boundary.

## Behavior to preserve

The real-host message test checks that Ctrl+T changes the default and clears local overrides, clicking reveals only one thinking block, and Ctrl+O leaves thinking hidden. It also checks that the next model request contains the original assistant text. These are passing preservation checks; they do not establish the new typography or timing.

```sh
bun test tests/system/ui-messages.test.ts
PI_TEST_HOST=/opt/bin/pi bun test tests/system/ui-messages.test.ts
```

The deterministic provider sends reasoning before the final text. Only the provider stream is scripted; the tests drive the actual Pi TUI and its renderer. Welcome coverage remains in the same file.

## Proposed compatibility boundary

The recommendation is a display-only adapter around `AssistantMessageComponent` content assembly. This needs the concrete-patch decision required by [specification item 13](https://github.com/jczhang02/pi-stuff/issues/106); it has not been implemented or approved.

- Add the assistant gutter after Markdown parsing. Keep Pi's Markdown renderer, code highlighting, wrapping and native failure/Esc presentation.
- Adapt each Thoughts block's presentation and measured in-memory duration. Preserve Hide thinking, Ctrl+T and local mouse disclosure. Do not modify canonical messages, provider context or saved sessions; omit unavailable historical durations.
- Install once per active UI extension and restore on shutdown/reload. Check the supported host shape, preserve other extensions and fall back to native rendering when the adapter cannot apply safely. Do not change Pi installation files.
- Verify repeated reload, session replacement, theme/width changes, streaming, list/code-first responses and long-history performance before acceptance.

Using the global hidden-label setter as a timer would also repeatedly update historical components. Mutating saved thinking to add labels, as the [inspected pi-tool-display revision](https://github.com/MasuRii/pi-tool-display/blob/91cef7580078371f8dc49a8607222807ad6a424d/src/thinking-label.ts) does, conflicts with the agreed record-preservation requirement. Neither approach is selected.

This assistant adapter is separate from the already pending `ToolExecutionComponent` history-renderer repair. The overall implementation remains incomplete.
