# Fast Resume

[Simplified Chinese](../i18n/zh-CN/docs/capabilities/fast-resume.md)

Fast Resume keeps Pi's native Session selector and replaces only its expensive complete-history list loaders. It reads
bounded JSONL regions, returns Pi `SessionInfo` rows, and delegates selection and mutation to the Host component.

## Open the selector

Run `/resume`. Pi Stuff intercepts the native selector call in memory for the current Host process, then mounts Pi's
exported `SessionSelectorComponent` with bounded Current Folder and All Sessions loaders. It does not modify Pi's
installed files. If the certified Host seam is unavailable or opening fails, the original native selector runs and a
bounded Diagnostic Record explains the fallback.

When `fastResume.hijackResume` is disabled, Pi keeps its complete-history `/resume` and Pi Stuff registers
`/fast-resume`. An optional `fastResume.shortcut` Pi key ID opens that same native component with bounded loaders.

## Native selector behavior

Fast Resume deliberately adds no visual mode or extra control. The title, Header, rows, search field, selection,
scrolling, empty states, status messages, rename form, delete confirmation, colors, responsive clipping, and keys are
Pi's native UI.

| Key | Native action |
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

Typing uses Pi's selector search. Plain input uses fuzzy matching, a fully quoted query uses exact substring matching,
and `re:<pattern>` uses regular-expression matching. Fast Resume supplies Session ID, resolved name, cwd, and visible
user and Assistant text found inside its forward window, not an unbounded transcript index.

## Bounded loading

For each candidate, Fast Resume reads at most 1 MiB from the front and parses only complete lines. Files that fit that
window are parsed in full. Oversized files stop early after the Session header and first non-empty user message, then
use a 32 KiB tail window for recent Session name metadata. Files are processed in batches of 50 and report progress
through the native Header. Current Folder finishes before it becomes selectable; All Sessions is not
read until the user changes scope.

The loader has explicit ceilings:

- a first non-empty user message that does not end inside the 1 MiB forward window is omitted from search;
- later text in oversized files and a name written outside the tail window can be absent;
- oversized-file message counts can be lower than complete-history counts;
- when bounded reads cannot see the last message activity, filesystem modification time controls ordering, so a later
  metadata-only append can move a Session;
- complete-history search and exact list metadata remain available only by disabling interception and using Pi's
  original loader.

Fast Resume creates no persistent cache or sidecar index, performs no network request, and does not rewrite Session
files while scanning.

## Resume, rename, and delete

Enter returns the selected path to Pi Stuff, which calls Pi's `switchSession`. Pi remains responsible for validation,
loading, transcript replay, cwd changes, and terminal behavior.

Rename and deletion are Pi's native selector workflows. Rename writes normal Session name metadata and refreshes the
active scope. Delete protects the active Session, asks for confirmation, first tries the platform trash command, and
permanently unlinks the JSONL file when trash is unavailable or fails. Failed deletion leaves the row visible and uses
the native bounded error state.

## Lifecycle

Each open selector receives one child Effect owner, and each native loader call runs as an owned operation. Closing the
selector shuts down that owner and interrupts outstanding work. Pi's native scope and sequence checks remain
authoritative when a loader completes after the user changes view.

## Configuration

Configure Fast Resume manually in the `fastResume` namespace of `<agentDir>/pi-stuff.json`. Startup reads that
namespace without creating or rewriting the file. Invalid values fall back to defaults and produce a Diagnostic Record.
See the [settings reference](../reference/settings.md#fastresume) for the exact fields.
