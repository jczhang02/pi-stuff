# `@jczhang02/pi-stuff-ui`

The unified presentation layer for the Pi Stuff Suite. It keeps Pi as the Host and adds a responsive Statusline,
Welcome header, live Thought projection, input enhancements, one `/ui` settings surface, and the shared non-floating
Command Dialog used by focused Suite commands.

## Daily UI

### Statusline

The Statusline preserves the visual grammar of the maintainer's former Powerline footer through an independent Pi Stuff
implementation. Each row has one-cell outer padding and dim `|` separators. It presents the model display name,
`think:<level>`, working-directory basename, Git branch with `!conflict`, `*unstaged`, `+staged`, `?untracked`, `⇡ahead`,
and `⇣behind`, context percentage/window, cache hit rate, and metered cost or Codex weekly allowance. Context renders as
`?/200k` when the Host knows the window but cannot yet calculate a percentage. Complete segments flow to a second
Statusline row instead of being cut in half. Capability state such as Goal, MCP, Agents, Todo, BTW, and Tool activity
stays on its own focused surface instead of adding Statusline segments.

Automatic density preserves the former wide ordering when it fits. As space narrows, it retains model and Context
first, then Git, cwd and Thinking, and finally cost and cache. The latest user prompt may use two
rows at 80 columns or wider, one row from 48 through 79 columns, and no row below 48 columns; Compact density also omits
it. Long model and branch names shorten from the middle; a constrained dirty Git segment aggregates file changes as
`ΔN` and reserves space for conflict and `⇡`/`⇣` markers before branch text. Persisted skill expansion and recognized
inline or multiple `/skill:*` commands are reduced back to the submitted
task plus compact skill badges; Skill XML, instructions, and local paths never enter the preview.

Nerd Font terminals receive the former model, folder, branch, context, cache, and input glyphs. Other terminals receive
the width-safe `dir`, `⎇`, `◫`, `cache`, and `in:` fallbacks. Set `POWERLINE_NERD_FONTS=1` or `0` to override automatic
detection, or choose a fixed mode in `/ui`. Colors still come only from Pi semantic theme tokens; the former hard-coded
personal palette is intentionally not copied.

The cache value is the active branch's cumulative hit rate across successful assistant messages:
`cacheRead / (input + cacheRead + cacheWrite)`. Failed or aborted messages and compaction metadata do not affect the
rate or cost. A zero denominator, unavailable context, and Thinking for a non-reasoning model are omitted. Subscription
models omit both cost and the former `(sub)` label.

For `openai-codex`, cost is always replaced by observed weekly allowance. The independently loaded Codex Capability
publishes that snapshot through `getCodexStatusChannel(pi)`; the Statusline performs no authentication or network work.
Weekly allowance stays hidden until real data arrives, and `fast` appears only while Fast mode is enabled. The shared
channel is keyed by Pi's Extension event bus, so late-loaded and physically separate Capability copies still converge
on one observer identity.

Session import and startup do not probe Git. A user-driven Agent turn or background Agent completion requests one
bounded, read-only, no-lock status refresh that binds counts to the measured working directory and branch. Stale counts
disappear across branch or cwd changes, and disabling Statusline stops future probes. Requests arriving during an
active probe collapse into one trailing measurement, so the newest state is not lost and bursts remain bounded.

It reduces lower-priority information at narrow widths and disappears while autocomplete or a Command Dialog owns the
input area. It does not duplicate Agent, Todo, BTW, Permission, or Tool activity.

### Welcome header

The startup header shows model and working-directory orientation plus counts available from Pi's public registries. It
uses a two-column layout at wide widths, a compact stacked layout at narrow widths, and an identity-only layout at
ultra-narrow widths. It is part of Pi's normal scrollback, not a floating window.

### Input enhancements

Recognized commands and skills are highlighted without changing the editor's text or width. Slash autocomplete also
works after slash text elsewhere in the input, while preserving Pi's native editor, completion provider, and keybindings.

### Live Thoughts

Through Pi's public Markdown-transform hook, streaming and settled thinking are projected as one bounded row beginning
with `✻ thoughts:`. Blank paragraphs, headings, list items, and standalone emphasis start a new semantic block; only
the current block remains visible, so consecutive model thoughts replace the same row instead of accumulating on one
line. Narrow rows preserve a readable action word and the newest tail without cutting into the middle of a word. The
projection is display-only: the complete original Thinking remains in model context and session data. Pi Stuff fails
clearly on an older Host that lacks this required rendering API instead of silently presenting a different UI. Keep
Pi's native **Hide thinking blocks** setting disabled so the transformed live row is rendered.

## `/ui`

`/ui` opens one searchable Pi-native `SettingsList` inside the shared Command Dialog. In the full Suite it contains
eight settings:

| Setting | Effect | Applies |
| --- | --- | --- |
| Statusline | Show session context below the editor | Immediately |
| Statusline density | Choose automatic, full, or compact responsive detail | Immediately |
| Latest prompt | Show the latest prompt when Statusline space allows | Immediately |
| Statusline icons | Detect icons automatically or force Nerd Font or ASCII icons | Immediately |
| Welcome header | Show startup orientation and inventory | Next launch |
| Input highlighting | Style recognized commands and skills while typing | Immediately |
| Inline slash autocomplete | Suggest real commands and skills after slash text | Immediately |
| Tool running timer | Show elapsed time for long-running Tool operations | Immediately |

The Tools Capability contributes the timer through the shared settings registry. The former `/tool-settings` command is
removed. Settings files are written only after an explicit change in `/ui`; opening the Suite does not write them.
Concurrent changes share a kernel-held file lease, so a process exit releases ownership without deleting or replacing
another Pi process's lock; a leftover lock file is safe and is reused.

## Command Dialog

The Package gives independently owned Capabilities one full-width, non-floating focus surface without coupling them to
each other. A `blocking` view preempts the active `normal` view inside the same Pi component; blocking requests run FIFO,
then the exact normal component resumes.

```ts
import { getCommandDialogCoordinator } from "@jczhang02/pi-stuff-ui";

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

The coordinator owns the Suite's desired working-row visibility through `setWorkingVisible(ctx, visible)`. Pi 0.83
provides public setters for the footer and working row but no getters, so exact restoration covers state owned through
this Package. Third-party extensions should not independently replace those surfaces after Pi Stuff loads.

The Package uses Pi semantic theme tokens and does not create floating windows or transcript entries.
