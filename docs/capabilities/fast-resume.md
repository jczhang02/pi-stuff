# Fast Resume

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/fast-resume.md)

Fast Resume replaces Pi's default Session selector with a progressive picker that reads bounded JSONL regions instead
of complete conversation histories. It retains the native Session files and delegates the final switch to Pi.

## Open the selector

Run `/resume`. Fast Resume intercepts the native selector in memory for the current Host process; it does not modify
Pi's installed files. If the certified Host seam is unavailable, Pi's original selector opens and a bounded Diagnostic
Record explains the fallback.

When `fastResume.hijackResume` is disabled, Pi keeps its native `/resume` and Pi Stuff registers
`/fast-resume`. An optional `fastResume.shortcut` key ID opens the same Fast Resume surface.

## Navigate and filter

The Header reports scope, view, sort order, visible count, loading state, and loading progress when available.

| Key | Action |
| --- | --- |
| Up / Down | Move one Session |
| Page Up / Page Down | Move through the visible window |
| Home / End | Select the first or last visible Session |
| Enter | Switch to the selected Session |
| Escape | Close the selector and restore the editor |
| Tab / Shift+Tab | Toggle Current Folder and All Sessions |
| Ctrl+S | Cycle Threaded, Recent, and Fuzzy sorting |
| Ctrl+N | Toggle Named-only filtering |
| Ctrl+P | Toggle Session paths |
| Ctrl+L | Refresh the active scope |
| Ctrl+R | Rename the selected Session |
| Ctrl+D | Confirm deletion of the selected Session |

Typing searches the current scope. Plain input uses fuzzy matching, a fully quoted query uses exact substring matching,
and a `re:<pattern>` query such as `re:release.*notes` uses a regular expression. Invalid expressions show a bounded error and match no rows until corrected. Search covers Session ID, Session name, cwd, and the first user message; it does not search the
complete transcript.

Threaded mode groups Sessions by canonical parent path, with children after their parents and roots and siblings ordered
by activity. Recent mode preserves modification order after filtering. Fuzzy mode ranks matches and breaks score ties by
modification time.

## Progressive loading

Fast Resume discovers candidates by filename and modification time, reads the first complete header and user message,
and checks a bounded tail window for the latest Session name. Current Folder's newest 30 candidates appear first.
Older Current Folder rows finish before All Sessions start, and All Sessions then stream in batches with progress.
Closing or refreshing the Dialog cancels obsolete work and fences late results from the current view.

This bounded contract has deliberate ceilings:

- a name written outside the tail window may be absent;
- partial-read message counts are marked with `≈`; only fully read counts are exact;
- complete-history search remains available only in Pi's native selector.

Fast Resume creates no persistent cache or sidecar index, performs no network request, and does not rewrite Session
files while scanning.

## Rename and delete

Ctrl+R writes Pi's normal Session name metadata and refreshes the active view. Empty input leaves the Session unchanged.

Ctrl+D opens an in-place confirmation. The active Session cannot be deleted. Confirmation first tries the platform
trash command; if that command is unavailable or fails, Fast Resume permanently unlinks the JSONL file. A failed
unlink leaves the row visible and reports a bounded error. Successful mutation refreshes the active scope while
retaining the selected path when it still exists.

## Configuration

Configure Fast Resume manually in the `fastResume` namespace of `<agentDir>/pi-stuff.json`. Startup reads that
namespace without creating or rewriting the file. Invalid values fall back to defaults and produce a Diagnostic Record.
See the [settings reference](../reference/settings.md#fastresume) for the exact fields.
