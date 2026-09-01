# BTW

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/btw.md)

BTW answers one side question in a focused dialog while the main Agent keeps working. The question and answer do not
become messages in the main conversation.

## Quick start

Ask a question from Pi's editor:

```text
/btw Why did the typecheck fail?
```

The answer streams in the shared Command Dialog. Press Escape to return to the exact editor draft that was present
before the dialog opened.

Running `/btw` without a question opens the dialog with a usage hint.

## Controls

| Key | Action |
| --- | --- |
| Left / Right | Move through retained BTW exchanges |
| Up / Down | Scroll the current answer |
| PageUp / PageDown or Space | Move by a page when content overflows |
| `c` | Copy the selected answer |
| `f` | Open the selected question and answer as a new Pi Session |
| `x` | Ask to clear earlier BTW history |
| `y` | Confirm a pending history clear |
| Escape | Cancel confirmation or close the dialog |

The layout remains single-column at every width. At low terminal heights, the selected question, current error, and
Escape route take priority over older history.

## Context used by BTW

BTW receives Pi's effective completed context, including compacted summaries, text, images, Tool calls, and Tool
results. An unfinished Assistant partial is excluded.

The request uses the active model and its configured authentication with `tools: []`. It has an independent abort
signal, so closing the dialog stops only the BTW request and does not cancel the main Agent.

The answer is not fed back into the main model context. Use promotion when the result should become formal work.

## History

Successful exchanges are stored as invisible Session custom entries. They survive process restart and Session resume,
but are not inherited by `/clear`, a new Session, or a fork.

History is bounded to 1,000 exchanges and 8 MiB per Session. The dialog shows up to five recent questions at once while
retaining the larger bounded history for navigation.

To remove earlier history, press `x` and then `y` in the same dialog. Escape cancels the confirmation.

## Promote an answer

Press `f` to turn the selected exchange into a new Pi Session. Promotion waits until the main Agent is idle, then writes
the question and answer as ordinary User and Assistant turns in the new Session. The original Session keeps only its
invisible BTW history entry.

Use promotion when a side answer needs Tools, follow-up reasoning, or a durable place in the conversation.

## Good uses

- Clarify a term while a longer task is running.
- Ask why a visible check failed without changing the active objective.
- Compare two small choices before deciding whether to promote the answer.

BTW is not a replacement for a new Session when the side question needs Tools or should drive the main work.

## See also

- [BTW Module README](../../packages/pi-stuff/src/btw/README.md)
- [Conversation UI](conversation-ui.md)
- [Command reference](../reference/commands.md)
- [DESIGN.md](../../DESIGN.md)

