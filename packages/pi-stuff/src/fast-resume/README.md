# Fast Resume

[Simplified Chinese](../../../../docs/i18n/zh-CN/packages/pi-stuff/src/fast-resume/README.md)

A progressive Session selector that keeps everyday resume work inside Pi without parsing complete Session histories.

<p align="center">
  <a href="../../../../docs/assets/readme/capabilities/fast-resume.png">
    <img src="../../../../docs/assets/readme/capabilities/fast-resume.png" alt="Fast Resume Session selector in Pi" width="100%">
  </a>
  <br>
  <em>Fast Resume makes the current project's recent Sessions selectable while older metadata continues loading.</em>
</p>

## Quick start

`/resume` opens Fast Resume by default. Type to search, press Enter to switch, or use Tab to move between Current
Folder and All Sessions. The Host's original selector remains the runtime fallback when the certified interception
seam is unavailable.

Set `fastResume.hijackResume` to `false` in `pi-stuff.json` to retain Pi's native `/resume` and use
`/fast-resume` for this selector instead.

## Highlights

- Shows the newest Current Folder Sessions first, then loads the remainder and All Sessions in bounded batches.
- Switches between a Threaded directory presentation and flat Recent or Fuzzy presentation, plus Named-only filtering.
- Searches Session ID, name, cwd, and first user message with fuzzy, quoted exact, or `re:<pattern>` regex input.
- Renames through Pi Session metadata and deletes after confirmation, falling back to permanent unlink when the
  platform trash command is unavailable.
- Cancels obsolete background work on refresh, close, reload, Session replacement, and shutdown.
- Keeps the Session JSONL files authoritative; Fast Resume creates no index or cache.

Bounded reads make the selector fast, but they also make names outside the tail window and message counts approximate.
Use Pi's native selector when complete-history search or exact metadata matters.

## Documentation

- [Fast Resume guide](../../../../docs/capabilities/fast-resume.md)
- [Command reference](../../../../docs/reference/commands.md#sessions-and-side-questions)
- [Settings reference](../../../../docs/reference/settings.md#fastresume)
- [Architecture decision](../../../../docs/adr/0026-add-fast-resume.md)
- [Troubleshooting](../../../../docs/troubleshooting.md)
