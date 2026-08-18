---
status: accepted
---

# Own the Context command surface

Pi Stuff exposes one Host command, `/ctx`, for Magic Context inspection and maintenance. Its `status`, `flush`,
`wrapup`, `recomp`, and `upgrade` subcommands share one dispatcher with the actions in Pi Stuff's full-width Context
Command Dialog. Upstream command handlers remain the authority for validation, confirmation, storage, Historian work,
and results, but their five flat command registrations are private adapter inputs rather than Host commands.

Presentation belongs to Pi Stuff. Status uses the shared Command Dialog. Maintenance work uses persisted,
model-invisible Context Activity entries rendered as one bullet row with bounded expanded detail. Magic Context Header,
Footer, Widget, Statusline, custom dialog, shortcut, flag, and entry-renderer registrations remain suppressed. Context
maintenance does not claim a Statusline slot.

## Accepted `/ctx` readability update

**Decision update:** 2026-08-17
**Status:** Accepted; implementation pending.

This update changes only the Suite-owned Context Command Dialog presentation. The dispatcher, upstream validation,
storage, confirmation authority, Historian work, Context Activity, typed subcommands, and suppression of upstream UI
remain unchanged.

The overview must answer three questions in order: how full the current model context is, what Context state needs
attention, and which maintenance actions are useful now. Context usage remains the Header's primary value. The body
uses short section marks instead of three unlabeled dense status lines:

```text
Context
72.4% · 145K / 200K tokens

│ Overview
8 compartments · compacted history ~54K tokens
3 memories · 2 notes
Historian idle · cache 12m remaining
12 active tags · 4 dropped tags

│ Attention
! 2 pending drops · removals waiting to apply

│ Actions
› Wrap up history
  Keep recent messages in full and compact older history
  Apply 2 pending drops
  Rebuild compartments
```

A Compartment is compacted derived conversation history. The Historian is the Context worker that creates or rebuilds
that derived history. A pending drop is a queued removal that has not yet been applied. Keep these canonical terms but
explain them in visible copy rather than assuming that users know the upstream vocabulary.

Omit `Attention` when there is no pending work or error. Use `●` for active Historian work, `!` for pending work or a
warning, and `×` for a Context error; retain the state word so the icon and color are never the only evidence. An error
appears before pending work. At low height, preserve Header usage, the first error or warning, the selected action, and
the Escape path before secondary counts, tags, cache detail, or descriptions.

`Wrap up history` is always present. `Apply pending drops` appears only when a positive pending count makes it useful.
`Upgrade legacy data` appears when an upgrade is needed or status cannot determine that safely; omit the no-op action
when the session is known to be current. `Rebuild compartments` remains available as explicit repair. The typed
`flush` and `upgrade` subcommands remain available even when their no-op Dialog rows are omitted.

Selection uses Pi's native `›` grammar and Up/Down behavior. Action labels remain visible before descriptions at narrow
widths. A one-line description may wrap when space exists and disappears before the selected label or Footer. Live
status refresh preserves the selected action and never moves focus merely because an optional action appears or
disappears.

Wrapup screens say plainly that recent messages remain in full while older messages become compact Compartments. The
recommended choice keeps 20 recent messages; custom input accepts one positive whole number. Rebuild scope offers the
full eligible session or one inclusive message range. Input errors stay next to the input and preserve the user's text.

Rebuild confirmation is the only warning screen in this flow:

```text
Context / Confirm rebuild

! Rebuild the full eligible session?
Compartment and fact data will be regenerated and may use model tokens.
The original Pi conversation is kept.

› Cancel
  Rebuild now
```

Cancel remains the initial selection. Escape returns exactly one screen. Flush, wrapup, rebuild, and upgrade still
close the Dialog before the shared dispatcher starts work; progress and completion continue through one persisted,
model-invisible Context Activity rather than a second modal or Statusline item.

The current implementation already has the correct dispatcher, nested Escape path, input validation, safe rebuild
default, refresh preservation, and low-height priority seam. Its remaining presentation deltas are the three unlabeled
overview lines, color-only status wording, no visible explanation of Context vocabulary, always-present no-op flush and
upgrade rows, a warning confirmation without an icon, and descriptions that compete with primary labels at narrow
widths.

## Consequences

- Users can discover Context from one command and complete parameter entry and destructive confirmation without knowing
  upstream syntax.
- Typed subcommands and Dialog actions cannot drift into separate execution paths.
- Context Activity survives Session resume without entering model context or pretending to be a Tool call.
- Upstream Magic Context upgrades must preserve the adapter's command and status-entry contracts or update this boundary
  deliberately; they must not silently add a second global UI.
