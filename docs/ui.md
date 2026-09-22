# Conversation UI

[简体中文](i18n/zh-CN/ui.md) · English is normative.

Implementation of [the accepted UI specification](https://github.com/jczhang02/pi-stuff/issues/106) is in progress. This branch currently changes native Bash, Write, Edit, Read, Grep, Find and Ls presentation. Web tools use the same retrieval presentation. Thoughts and welcome are not implemented yet. The prototype remains visual reference, not production acceptance evidence.

## Bash

Bash shows a status dot, command heading and `⎿` output. Completed output previews three rendered rows; running output shows the latest two. Hidden retained rows are counted as `n more lines`. Pi handles mouse disclosure and Ctrl+O. Short results retain the same native disclosure behavior even when both views look identical.

Configured timeout and upstream truncation/log information have separate result blocks. Expanding reveals only retained output. Tool execution uses Pi's public native definition with the host's configured shell path and command prefix. Other extensions' Bash definitions are left untouched.

## Write

Write retains native file execution and shows the written source with Pi syntax highlighting. The compact result shows three rendered rows and a hidden-row count; native disclosure reveals the complete retained source. The result summary counts source lines rather than terminal wrapping. Error results retain the actual tool error text.

## Edit

Edit renders the native result patch with one line-number gutter, removal numbers from the old file and addition/context numbers from the new file. It highlights the available old and new source separately within each hunk, adds semantic backgrounds and shows six rendered rows before disclosure. Wrapped rows do not repeat the gutter. The summary counts added and removed source lines. Opening an old result uses its recorded patch even if the file has since changed. Syntax context outside the recorded hunks is unavailable.

## Retrieval tools

Read, Grep, Find and Ls share a compact heading and retained-row hint. Native mouse disclosure or Ctrl+O reveals their text. No-match, empty and error results remain visible, as do upstream truncation and result-limit warnings. Ls is used only for an actual `ls` tool call; shell commands keep their Bash identity. Native Read image-resizing settings are preserved. Successful adjacent local and Web calls now form a compact group. Click its summary to show aligned compact tools, then click a tool to reveal its retained result. Ctrl+O reveals grouped results through native tool expansion. Pending calls, empty results, warnings, failures and ordinary Bash remain outside groups. The index stores call identities and counts, not duplicate output.

## Web tools

The existing Web access tools display as WebSearch, WebFetch and WebRead. Compact headings show the operation count or retained-content label; expanded headings show query/URL/content ID and paging/find arguments. Their original API names, output and cache behavior are unchanged. Batch-item errors and retained-content paging notices remain visible while compact. This presentation does not fetch additional content on disclosure.

## Configuration

Add `ui` to the global `pi-stuff.json` beside existing `web`, `tools` and `rtk` settings. Reload Pi after editing. Project configuration is not read for these options.

```json
{
  "ui": {
    "enabled": true,
    "retrievalGroups": true,
    "bashPreviewLines": 3,
    "bashRunningPreviewLines": 2,
    "writePreviewLines": 3,
    "editPreviewLines": 6
  }
}
```

`retrievalGroups` defaults to `true`; `false` keeps individual retrieval tools.

`enabled` defaults to `true`; `false` leaves native tool rendering in place. All preview limits are nonnegative integers, with the defaults shown above. Zero hides the compact body while retaining the summary and hidden-row count. Limits do not change model-visible output, upstream truncation or expanded content.

Open `/ui` for the global switch, retrieval grouping and common preview limits. The panel uses Pi's SettingsList and remains available when UI presentation is disabled. Settings are saved immediately; use `/reload` to apply them. A stale save is rejected if the file changed externally. Saving retains other configuration sections. Theme and Hide thinking remain in Pi's own settings.

The UI implementation is owned by `src/ui/`; the entrypoint registers it after shared configuration decoding. Configuration and remaining UI controls will be extended as their behavior is implemented.

## Verification status

The initial system tests use actual Pi 0.85.1 under Bun 1.4.0 with an isolated deterministic provider. They check compact/expanded output, model-visible content, timeout blocks, host shell settings and global UI controls. A real-host regression test currently fails after reload: Pi rebuilds historical tool components before the session-start registration callbacks run, so those components retain native renderers. Live grouping and individual disclosure pass, but history acceptance does not. This lifecycle issue must be fixed before delivery. Compiled-host, full UI, independent review, performance and extended real-model acceptance remain outstanding.
