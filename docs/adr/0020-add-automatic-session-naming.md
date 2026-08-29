---
status: accepted
beads:
  - ps-35b
  - ps-496
---

# Add automatic Session naming at the settled user-work boundary

## Context

Pi owns Session metadata and exposes public APIs for reading and changing a Session name. The upstream
[`pi-autoname`](https://github.com/ssdiwu/pi-autoname) Extension demonstrates useful semantic naming, but its
standalone configuration file, direct `agent_settled` listener, compatibility helper, and independent Package
lifecycle do not fit Pi Stuff's ownership boundaries.

A naming request is another Provider call. Triggering it for Goal continuation, child Agent completion, or a background
result would incorrectly treat Suite-authored work as a new user topic. Creating an upstream `pi-autoname.json` file
at startup would also violate the Suite's pure-import and read-only startup contract.

## Decision

Add `session-naming` as one internal Capability Module in the Pi Stuff Package, ordered after `conversation-ui`.
Keep it separate from `conversation-ui`: Conversation UI owns presentation and the shared direct-user work signal,
while Session Naming owns model selection, semantic naming policy, Session metadata, and persisted naming state.

Automatic naming listens to Conversation UI's certified user-Agent-run-settled event. The first settled direct-user
exchange is named from its first user/Assistant dialogue. A model-generated name may be reconsidered after the default
ten-minute cooldown using the six newest user and Assistant messages. The current authoritative name is included as
redacted untrusted data and retained exactly when it still fits. A local fallback is retried on the next settled
direct-user run. `/autoname` explicitly forces regeneration. Automatic naming is disabled in Child Agent Sessions;
Agents remains the authority for their assigned Session names.

Use Pi's public `modelRegistry.complete()`, `getSessionName()`, `setSessionName()`, and `appendEntry()` APIs.
Configured `provider/model` references are tried before the active Session model, with duplicate removal, configured-
auth checks, 12-second attempt limits, a 30-second total budget, and a 64-token output limit. Conversation content is
bounded, credential-shaped text is redacted, and the prompt identifies it as untrusted. Naming remains best-effort and
never blocks the settled lifecycle.

Persist branch-local `pi-stuff-session-naming-state` custom entries with the generated name, AI/fallback/user source,
trigger mode, and timestamp. Read upstream `pi-autoname-state` entries so resumed Sessions retain existing ownership
and manual-name policy. Pi's `session_info` entry remains the authority for the actual Session name.

Configuration belongs to the `sessionNaming` namespace of `<agentDir>/pi-stuff.json`. Startup only reads this
namespace and falls back as a whole to built-in defaults with one shared Diagnostic Record when invalid. A direct
`/autoname settings` interaction may update automatic naming, cooldown, manual-name policy, and the optional primary
model through Pi's native Settings List; changes apply immediately. The model row opens a searchable submenu populated
from Pi's scoped models, or its available authenticated models when no scope is active. Selecting **Session model**
removes the fixed primary route, while ordered fallback routing remains advanced JSON configuration. The Capability does
not create or migrate `pi-autoname.json`, and invalid existing settings are never overwritten by the Dialog.

The implementation is a fork of upstream commit `73d25caa9ff33dadfaa8187ad3f7d1495a01cec9`; its adjacent `LICENSE`
and `UPSTREAM.md` remain the source and license authority.

## Rejected alternatives

### Install `pi-autoname` as another Package

Rejected. It would create a second installation and configuration lifecycle, bypass Suite composition, and retain a
startup write and a broader settled trigger.

### Fold naming into `conversation-ui`

Rejected. Session naming is not a display projection: it calls a Provider, applies naming policy, and persists Session
state. Conversation UI contributes only the shared lifecycle signal.

### Trigger directly from Pi's `agent_settled`

Rejected. That event does not distinguish a direct user Agent run from Goal continuation or other Suite-authored work.
The existing shared signal already owns that attribution.

### Name immediately on user input

Rejected. The Assistant result contributes useful task context, and a cancelled or failed run should not trigger an
automatic naming request.

## Consequences

- Parent Sessions receive semantic names without another Package or settings file.
- Goal continuation, background resumption, and Child Agent Sessions do not cause automatic renames.
- One direct user turn can cause one additional bounded Provider request after the main run settles.
- Setting `enabled` to `false` stops automatic naming while explicit `/autoname` remains available.
- Setting `respectManualName` to `true` makes a user-issued or otherwise unmarked authoritative name sticky; the
  default `false` preserves periodic automatic ownership after the native rename timestamp's cooldown.
- Selecting a fixed primary model explicitly sends sanitized naming context to that model's Provider without changing
  the active Session model; **Session model** restores the active-Session default route.
- Existing upstream state is readable, but upstream standalone settings are intentionally not imported.
- Representative acceptance must use the certified real Pi Host and verify Provider traffic plus persisted JSONL
  entries across resume; mocks alone cannot certify the public seam.
