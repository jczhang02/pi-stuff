# Conversation UI

[简体中文](i18n/zh-CN/ui.md) · English is normative.

Implementation of [the accepted UI specification](https://github.com/jczhang02/pi-stuff/issues/106) is in progress. This branch currently changes native Bash and Write presentation. Other tool types, Thoughts, welcome, retrieval grouping and interactive settings are not implemented yet. The prototype remains visual reference, not production acceptance evidence.

## Bash

Bash shows a status dot, command heading and `⎿` output. Completed output previews three rendered rows; running output shows the latest two. Hidden retained rows are counted as `n more lines`. Pi handles mouse disclosure and Ctrl+O. Short results retain the same native disclosure behavior even when both views look identical.

Configured timeout and upstream truncation/log information have separate result blocks. Expanding reveals only retained output. Tool execution uses Pi's public native definition with the host's configured shell path and command prefix. Other extensions' Bash definitions are left untouched.

## Write

Write retains native file execution and shows the written source with Pi syntax highlighting. The compact result shows three rendered rows and a hidden-row count; native disclosure reveals the complete retained source. The result summary counts source lines rather than terminal wrapping. Error results retain the actual tool error text.

## Configuration

Add `ui` to the global `pi-stuff.json` beside existing `web`, `tools` and `rtk` settings. Reload Pi after editing. Project configuration is not read for these options.

```json
{
  "ui": {
    "enabled": true,
    "bashPreviewLines": 3
  }
}
```

`enabled` defaults to `true`; `false` leaves native tool rendering in place. `bashPreviewLines` is a nonnegative integer and defaults to `3`. Zero hides the compact body while retaining its hidden-row count. It does not change model-visible output, upstream truncation or expanded content.

The UI implementation is owned by `src/ui/`; the entrypoint registers it after shared configuration decoding. Configuration and remaining UI controls will be extended as their behavior is implemented.

## Verification status

The initial system tests use actual Pi 0.85.1 under Bun 1.4.0 with an isolated deterministic provider. They check compact/expanded output, model-visible content, timeout blocks, host shell settings and global UI controls. Compiled-host, full UI, independent review, performance and extended real-model acceptance remain outstanding.
