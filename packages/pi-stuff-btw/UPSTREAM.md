# Upstream provenance

- Project: `@juicesharp/rpiv-btw`
- Version: `2.3.1`
- Source repository: `https://github.com/juicesharp/rpiv-mono`
- Source revision: `75823a68024a0a649cc28087976074be791ca554`
- License: MIT, preserved in `LICENSE`
- npm shasum (SHA-1): `568af4a3235b344a4f91d354cc0d1c967977cc06`
- npm archive SHA-256: `5318bbf4256b83825cb56a314bdbfa605e495e68043d83a169a65dd35ceabf59`

The imported non-image release files were byte-compared with that revision
before the owned-fork baseline commit.

## Pi Stuff changes

- Replaced the floating overlay with the shared non-overlay Command Dialog.
- Replaced cached raw-branch snapshots with Pi 0.83's effective, compaction-aware
  context at invocation time.
- Stream answer text in place through the active model's registered provider and
  Model Registry auth resolution. Pi 0.83 exposes no public transcript-free
  Host-call seam, so BTW calls do not participate in provider lifecycle/context
  hooks or Host retry and transport settings; adopt that seam when Pi exposes it.
- Keep successful history as session-owned invisible custom entries. It is
  never sent to the model, survives resume, and is ignored by new and forked
  session ids. Removed cross-session question hints.
- Rebuilt the surface around Claude-style information density: `/btw` question,
  native Pi loader, Markdown answer, compact history, and contextual controls;
  removed redundant headings and explanatory labels.
- Added copy, clear, Space/Enter/Esc dismissal, and idle-safe `f` promotion into
  a new session containing the selected question and answer as formal turns.
- Preserve completed text, images, tool calls/results, and compaction context;
  exclude unfinished assistant partials from the invocation snapshot.
- Added draft, footer, working-row, Suite-chrome, preemption, shutdown, and
  failure restoration through `@jczhang02/pi-stuff-ui`.
- Removed follow-up chat, floating-window geometry, status/widget output, and
  legacy pre-0.83 transport fallbacks.
- Added Pi Stuff unit, isolation, persistence/resume, promotion, package,
  real-Host, and 100x32/64x28 PTY acceptance gates.
