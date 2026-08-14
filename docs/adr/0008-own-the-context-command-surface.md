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

## Consequences

- Users can discover Context from one command and complete parameter entry and destructive confirmation without knowing
  upstream syntax.
- Typed subcommands and Dialog actions cannot drift into separate execution paths.
- Context Activity survives Session resume without entering model context or pretending to be a Tool call.
- Upstream Magic Context upgrades must preserve the adapter's command and status-entry contracts or update this boundary
  deliberately; they must not silently add a second global UI.
