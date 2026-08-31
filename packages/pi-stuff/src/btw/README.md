# BTW

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/btw/README.md)

One no-Tool side question in a focused dialog, without changing the main conversation.

## Quick start

```text
/btw Why did the typecheck fail?
```

Read the streamed answer and press Escape to return to the editor. Use Left and Right to revisit retained answers,
`c` to copy, or `f` to promote an exchange into a new Pi Session.

## Highlights

- Uses Pi's completed, compaction-aware context while excluding unfinished Assistant output.
- Runs on the active model with an independent abort signal and no Tools.
- Keeps the main Agent running while the side answer streams.
- Stores bounded, invisible history with the owning Session.
- Promotes a useful exchange into ordinary User and Assistant turns in a new Session.
- Uses one responsive single-column Command Dialog at every terminal width.

## Documentation

- [BTW guide](../../../../docs/capabilities/btw.md)
- [Command reference](../../../../docs/reference/commands.md#sessions-and-side-questions)
- [Conversation UI guide](../../../../docs/capabilities/conversation-ui.md)
- [Shared UI contract](../../../../DESIGN.md)
- [Upstream references](UPSTREAM.md)

