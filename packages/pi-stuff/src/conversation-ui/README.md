# Conversation UI module

The unified presentation layer for the Pi Stuff Suite. It keeps Pi as the Host and adds a responsive Statusline,
Welcome header, live Thought and fenced visualization projection, input enhancements, one `/ui` settings surface, and
the shared non-floating Command Dialog used by focused Suite commands.

## Daily UI

### Statusline

The Statusline is exactly one icon-led status row followed by one optional previous-prompt row. The status row uses dim
middle-dot separators and this stable order: model, Thinking, conditional `fast`, working directory, Git branch, Git file
state, Context percentage, cache hit rate, and metered cost or Codex weekly allowance. It deliberately omits token-window
counts and worktime. Capability state such as Goal, MCP, Agents, Todo, BTW, and Tool activity stays on its own focused
surface instead of adding Statusline segments.

Automatic density first changes long fields to their compact form, then removes complete low-priority segments. It
never wraps the status row or leaves clipped field fragments. Model and Context survive first, followed by cwd, branch,
Thinking, allowance, file state, `fast`, and cache according to their accepted priorities. A constrained dirty Git state
aggregates file changes as `ΔN`; branch tracking remains attributable through `⇡` and `⇣` markers.

The previous prompt is always bounded to one row when enabled. Its muted `›` cue occupies the same first visual column
as the model icon. Both rows reserve one marker cell followed by one stable gap, so Latin, CJK, and emoji text begin in
the same terminal column. The prompt text uses the readable secondary `muted` token rather than the decorative `dim`
token. Persisted skill expansion and recognized inline or multiple `/skill:*` commands are reduced
back to the submitted task plus compact skill badges; Skill XML, instructions, and local paths never enter the preview.

Nerd Font terminals receive the compact model, Thinking, `fast`, folder, branch, file-state, Context, cache, allowance,
and cost icon family; the Prompt uses the same one-cell `›` in every mode. Other terminals receive one-cell width-safe
fallbacks. Set `POWERLINE_NERD_FONTS=1` or `0`
to override automatic detection, or choose a fixed mode in `/ui`. Colors come only from Pi semantic theme tokens.

The cache value is the active branch's cumulative hit rate across successful assistant messages:
`cacheRead / (input + cacheRead + cacheWrite)`. Failed or aborted messages and compaction metadata do not affect the
rate or cost. A zero denominator, unavailable context, and Thinking for a non-reasoning model are omitted. Subscription
models omit both cost and the former `(sub)` label.

For `openai-codex`, cost is always replaced by observed weekly remaining percentage. When Fast mode is active, `fast`
occupies its former-footer position between Thinking and the working directory; weekly allowance remains after cache. The
internal Codex module publishes that snapshot through `getCodexStatusChannel(pi)`; the Statusline
performs no authentication or network work.
Weekly allowance stays hidden until real data arrives, and `fast` appears only while Fast mode is enabled. The shared
channel is keyed by Pi's Extension event bus, so late-loaded and physically separate Capability copies still converge
on one observer identity. After a user-driven interactive Codex Agent run reaches the same genuinely idle boundary used
for post-run observation, the Codex Capability refreshes the snapshot once without a timer. Automatic work, non-Codex
runs, import, and startup do not request usage; overlapping post-run refreshes collapse into one trailing request.

Session import and startup do not probe Git. A user-driven Agent turn, including its attributed background Agent
completion, requests one bounded, read-only, no-lock status refresh that binds counts to the measured working directory
and branch. Automatic Extension work never requests one. Stale counts disappear across branch or cwd changes, and
disabling Statusline stops future probes. Requests arriving during an active probe collapse into one trailing
measurement, so the newest state is not lost and bursts remain bounded. Pi exposes itself as idle while asynchronous
`agent_settled` handlers are still deciding whether to continue; the Suite therefore holds refresh requests until the
last observed settlement reaches a genuinely idle boundary, preventing a probe from overlapping Goal continuation.

Attribution follows Pi's actual message delivery rather than queue acceptance. A user follow-up therefore remains
pending without relabeling the Agent work already in flight; it becomes user work at its `message_start` boundary.
Direct interactive and RPC steers promote the active work only when Pi delivers their message, so a later input handler
can still reject them without changing attribution. A Suite-owned UI steer promotes immediately after its Host send is
accepted. Suite-authored Goal, Web, MCP, Background Work, and supervisor messages carry an in-memory user/automatic
marker, so Agents launched from those turns inherit the correct origin while the marker stays out of persisted session
JSON. A separate non-persisted marker identifies a direct command, prompt, or UI/RPC action. Historical user
attribution can therefore survive an asynchronous Background Work or curator completion without granting that later
automatic wake-up first-use configuration authority. Explicit Suite UI work uses marked custom messages through Pi's
public `sendMessage` seam instead of trying to annotate fire-and-forget `sendUserMessage` input dispatches. Pending delivery
attribution follows Pi's own queue without an arbitrary item cap, so a large accepted steer/follow-up backlog remains
lossless until delivery or the Agent-run boundary clears it. Pi has no post-input hook across separately loaded Extensions;
if a later Extension leaves mixed user/automatic records that cannot be correlated after transformation, the whole
ambiguous delivery class is discarded and attributed as automatic. This deliberately loses a cosmetic user-only Git
refresh rather than allowing automatic work to trigger it.

The same shared Host seam prepares Context before Suite custom Agent work is accepted and rechecks the originating
Session or Goal after every asynchronous preparation boundary. Aggregate Suite startup uses a `conversation-ui`-owned,
module-local readiness gate: all Capability `session_start` handlers are observed, any failure rejects the generation,
and restored Goal work is released only after the complete Suite has settled successfully.

It reduces lower-priority information at narrow widths and disappears while autocomplete or a Command Dialog owns the
input area. It does not duplicate Agent, Todo, BTW, Goal, MCP, or Tool activity.

### Welcome header

The startup header follows the observed Claude Code 2.1.197 card geometry while keeping Pi Stuff's own identity and
content. Its accent-colored Pi mark is reconstructed from the official pi.dev geometry: an 8×4 mark at ordinary sizes
and a complete 4×2 mark below 48 columns or at 18 rows and shorter. It selects the compact mark instead of cropping the
large one and always keeps one effective blank row below the mark. At 70 columns and above the card uses a fixed 52-cell
identity column plus a responsive guidance column; below that it becomes a centered single-column card and removes
guidance and inventory instead of wrapping them. It is part of Pi's normal scrollback, not a floating window.

### Input enhancements

Recognized commands and skills are highlighted without changing the editor's text or width. Inline Slash autocomplete
reuses Pi's native fuzzy results after slash text elsewhere, keeps only Skills, and inserts their canonical
`/skill:<name>` form while preserving Pi's native editor, completion provider, and keybindings.

### Live Thoughts

Through Pi's public Markdown-transform hook, streaming and settled thinking are projected as one bounded row beginning
with U+2217 `∗ thoughts:`. The one-cell asterisk operator stays visually centered on the text axis without regaining the
oversized weight of U+273B. Blank paragraphs, headings, list items, and standalone emphasis start a new semantic block;
only the current block remains visible, so consecutive model thoughts replace the same row instead of accumulating on
one line. Narrow rows preserve a readable action word and the newest tail without cutting into the middle of a word. The
projection is display-only: the complete original Thinking remains in model context and session data. Pi Stuff fails
clearly on an older Host that lacks this required rendering API instead of silently presenting a different UI. Keep
Pi's native **Hide thinking blocks** setting disabled so the transformed live row is rendered.

### Transcript markers

Ordinary Suite-owned Conversation Transcript records use one small U+2022 `•` marker. This includes Assistant prose,
Tool Activity, Agent outcomes, and Background Work outcomes; larger state dots remain reserved for interactive controls
such as Fleetview, dialogs, Todo, MCP, diagnostics, and selection state. Every Assistant text message receives exactly
one outer marker, including structured Markdown. Continuation paragraphs, headings, lists, quotes, tables, and fenced
code stay inside that message-level body and retain their Markdown hierarchy. This projection is display-only and does
not rewrite Assistant text, Session records, copy/export source, or provider context.

### Fenced visualizations

Complete `chart` and `tree` fenced code blocks in User or Assistant Markdown receive a display-only terminal projection.
Thinking stays exclusively under Live Thoughts. Pi Stuff does not add Provider instructions to solicit these formats,
and it does not alter the message stored in the Session or sent back to a Provider.

A chart uses one `type`, an optional `title`, an optional `data:` marker, and bounded rows:

```chart
type: bar
title: Monthly net change
data:
Jan -8
Feb 5
Mar 12
```

Supported types are `bar` (with `histogram` as an alias), `line`, `scatter`, `sparkline`, and `heatmap`. Ordinary
series accept at most 64 points. Heatmaps accept at most 32 rows and 64 values per row. Chart source is capped at
12,000 characters, requires at least 24 chart-content cells, and never renders wider than 80. The Host Markdown code
indent reserves two additional cells; Assistant messages reserve another two for their outer marker.

A tree uses exactly two spaces per level:

```tree
Pi Stuff
  conversation-ui
    chart
    tree
  tools
```

Trees require one root, reject tabs, odd indentation, blank nodes, depth jumps, and multiple roots, and are capped at
12,000 characters, 256 nodes, and 32 levels. Labels are measured with Pi TUI terminal-cell width, including CJK and
emoji. If any tree row cannot fit without truncating its label, the original fence remains visible.

Both backtick and tilde fences are accepted. At most 16 valid blocks are projected per Markdown message; later blocks
remain ordinary fences. Unknown, malformed, unsafe, incomplete, over-limit, nested, or too-narrow blocks also remain
ordinary fenced code. The static dispatcher is part of the existing single Conversation Markdown
transformer; it is not a plugin API or setting. See ADR 0017 and `UPSTREAM.md` for design and provenance. Ordinary
path performance is certified with:

```bash
bun run benchmark:conversation-markdown -- --baseline-root <baseline> --candidate-root <candidate>
```

The command reports feature rendering separately and fails only on a repeatable ordinary-path regression.

### Diagnostics

Capability Modules report structured diagnostics through this module instead of writing directly to the Host terminal.
Ordinary state stays on its owning surface, and maintenance-only cleanup or retry information remains silent. A problem
that needs the user raises at most one focus-neutral row above the editor, such as
`● Pi Stuff · Background Work needs attention · /diagnostics`. Repeated failures coalesce rather than stacking rows,
and multiple active problems collapse to one count.

`/diagnostics` opens the shared full-width Command Dialog with bounded current-process history, occurrence counts,
details, and the suggested Capability command when one exists. It stays single-column at every width. Enter opens one
record; `c` clears history; Escape first returns to the list and then restores the exact editor draft and Suite chrome.
Opening the dialog or starting the next prompt acknowledges the one-row notice without deleting history.

Diagnostics never enter Session history, model context, the Statusline, or an independent persistence layer. Details
are bounded, terminal control characters are removed, and common tokens and API keys are redacted. Restarting Pi clears
this inspection history; Capability-owned durable state is unaffected.

## `/ui`

`/ui` opens one searchable Pi-native `SettingsList` inside the shared Command Dialog. It owns presentation settings
only; behavior settings stay with the Capability they affect. In the full Suite it contains eight settings:

| Setting | Effect | Applies |
| --- | --- | --- |
| Statusline | Show session context below the editor | Immediately |
| Statusline density | Choose automatic, full, or compact responsive detail | Immediately |
| Latest prompt | Show the latest prompt when Statusline space allows | Immediately |
| Statusline icons | Detect icons automatically or force Nerd Font or ASCII icons | Immediately |
| Welcome header | Show startup orientation and inventory | Next launch |
| Input highlighting | Style recognized commands and skills while typing | Immediately |
| Inline slash autocomplete | Suggest Host-ranked Skills after slash text | Immediately |
| Tool running timer | Show elapsed time for long-running Tool operations | Immediately |

The Tools Capability contributes the timer through the shared settings registry. The former `/tool-settings` command is
removed. Settings files are written only after an explicit change in `/ui`; opening the Suite does not write them.
Concurrent changes share a kernel-held file lease, so a process exit releases ownership without deleting or replacing
another Pi process's lock; a leftover lock file is safe and is reused.

## Command Dialog

The module gives independently owned Capabilities one full-width, non-floating focus surface without coupling them to
each other. A `blocking` view preempts the active `normal` view inside the same Pi component; blocking requests run FIFO,
then the exact normal component resumes.

All Suite Command Dialogs use one height-fitting rule. At ordinary sizes their layouts stay unchanged. Under severe
height pressure they first preserve the semantic title or current state, the selected row or attached error, and an
Escape/back footer; only then do they spend remaining rows on surrounding content. This keeps every focused surface
operable at the certified 24×16 floor without introducing a floating overlay.

The same coordinator owns one composed Footer seam. The Statusline remains the primary Footer, while Suite Capabilities
may register ordered tails beneath it. This is how Fleetview stays below both Statusline rows without a Pi Host fork;
standalone Packages can retain their native fallback. Dialog suppression and restoration operate on the composed Footer
as one unit, while creation, rendering, invalidation, and disposal failures remain isolated by section.

```ts
import { getCommandDialogCoordinator } from "../conversation-ui/index.js";

const dialogs = getCommandDialogCoordinator(pi);
const unregister = dialogs.registerChrome("todo", {
	setSuppressed: (suppressed) => todoOverlay.setSuppressed(suppressed),
});

await dialogs.show(ctx, {
	priority: "normal",
	create: ({ signal, tui, theme, keybindings, requestRender, close }) =>
		new CapabilityDialog({ signal, tui, theme, keybindings, requestRender, close }),
});

unregister();
```

While a dialog is open, the coordinator saves and clears the editor draft, installs an empty footer, hides the working
row, and suppresses registered Suite chrome. It restores the same owned state after the final view closes or
`session_shutdown` dismisses the host. Non-TUI contexts resolve `show()` without mounting a view.

Mounting, preempting, and resuming a view use Pi TUI's differential repaint. They do not clear the renderer cache or
replay the transcript; a Capability can still request an explicit forced repaint through `requestRender(true)` when it
has a concrete need for one.

The coordinator owns the Suite's desired working-row visibility through `setWorkingVisible(ctx, visible)`. Pi
provides public setters for the footer and working row but no getters, so exact restoration covers state owned through
this Package. Third-party extensions should not independently replace those surfaces after Pi Stuff loads.

The module uses Pi semantic theme tokens and does not create floating windows or transcript entries. `dim` is reserved
for separators, shortcuts, completed or stale metadata, and other safely optional decoration; required secondary
identity and state use `muted`, while primary content uses `text` or the relevant success/warning/error token.
