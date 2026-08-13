# Notification Capability reference

**Audit date:** 2026-08-13  
**Certified Host:** Pi 0.84.1 at `53fa77ccd8a279eb87e92294ef3687b03ff80112`, Linux x64  
**Comparative baselines:** Claude Code 2.1.229 and OpenAI Codex `rust-v0.147.0`  
**Decision:** Implement an internal Pi Stuff Notification Capability; do not adopt an existing notification Package

## Decision

Pi Stuff should implement notifications as one internal Capability Module in the existing `@jczhang02/pi-stuff` Package. The Capability should notify once when user-started Agent work is genuinely settled, distinguish a final failure from a successful completion, remain silent for an abort by default, and suppress an alert when the user has already resumed interacting with the terminal.

The decisive Host event is **`agent_settled`**, not `agent_end`.

Pi's Agent loop emits `agent_end` whenever one Agent run stops. The coding-agent session may subsequently perform an automatic retry, compact context, or continue because an `agent_end` handler queued another message. Only after all such post-run work ends does the session emit `agent_settled`. This is explicit in the certified Host's [`AgentSession._runAgentPrompt()` and `_handlePostAgentRun()`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts) and in the public [`AgentSettledEvent`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts).

Using `agent_end` as the user-visible completion boundary would therefore allow premature or duplicate alerts during retries, compaction, Goal continuations, and messages queued by another Capability. Pi's own minimal [notification example](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/examples/extensions/notify.ts) still listens to `agent_end`; it demonstrates OSC delivery, not the stronger settled-work contract required by the Suite.

## Required user-visible contract

### Outcomes

The Capability owns one work cycle from the first `agent_start` until the matching `agent_settled`, even when that cycle contains several internal Agent runs.

At settlement it classifies the latest finalized Assistant message:

- `stopReason === "aborted"`: do not notify by default;
- `stopReason === "error"` or a non-empty `errorMessage`: send a failure notification;
- every other settled final response: send a completion notification.

This deliberately does not require `stopReason === "stop"` for success. A Tool-ending response can use another non-error stop reason, and intermediate provider errors must not remain sticky after an automatic retry succeeds. The reducer should retain the latest finalized Assistant message across the whole work cycle and discard stale error state after a later successful message.

The notification body should contain only a bounded project/session label and elapsed time by default. It must not quote arbitrary model output, commands, paths, credentials, or Tool input. Any user-configurable preview added later must be bounded and control-character sanitized.

### Activity suppression

The selected defaults are:

- minimum work duration: **10 seconds**;
- post-settlement grace period: **2 seconds**;
- cancellation during that grace period on a new input event, any terminal input, a new Agent run, session replacement/reload, or shutdown.

The grace timer must be unreferenced and must not keep Pi alive. Starting a later work cycle invalidates the earlier cycle's pending notification. One cycle may produce at most one external alert.

Pi 0.84.1 exposes [`ExtensionContext.hasUI`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts) and terminal-input observation, but it does not expose the Host's terminal focus state to Extensions. Pi Stuff can therefore provide **recent-activity suppression**, but cannot prove that the terminal is unfocused as Codex can. Product copy and settings must not claim "notify only when unfocused."

### Delivery

The default mode uses terminal-native delivery only and never spawns an external process:

1. Kitty OSC 99 when Kitty is detected;
2. Ghostty OSC 777 when Ghostty is detected, including through its inherited resource marker inside tmux;
3. OSC 9 when iTerm2 or WezTerm is detected.

Unknown terminals remain unsupported in `auto`; Kitty, OSC 9, OSC 777, and BEL remain explicit delivery choices.

All title and body fields must remove ESC, BEL, C0/C1 controls, and protocol delimiters before encoding. Output must be emitted only when `ctx.mode === "tui"` and `ctx.hasUI` is true. RPC may expose a UI request facade with `hasUI === true`, so `hasUI` alone is not an interactive-terminal boundary. In RPC, print, SDK/headless, and other non-interactive modes, the Capability must remain silent so it cannot corrupt stdout or a JSON protocol.

System utilities such as `osascript`, `notify-send`, PowerShell, or a user script are a separate, explicit opt-in transport. They must never run during import, initialization, or `session_start`; invocation must be bounded, detached from the Agent lifecycle, and failure must degrade silently or to a Diagnostic Record without failing work settlement. The first implementation may omit an external-command transport until its security and cross-platform contract is complete.

Optional terminal attention is named `terminalBell` because it emits BEL, not a controllable notification sound. BEL
must not be duplicated when it is also the chosen delivery transport.

### Settings and UI authority

Settings belong in a dedicated native `/notifications` SettingsList Command Dialog rather than the shared `/ui`
surface. The settings cover:

- notifications: on/off;
- completion alerts: on/off;
- failure alerts: on/off;
- minimum runtime;
- settlement grace period;
- terminal delivery mode;
- an opt-in, bounded final-response preview, disabled by default for desktop-history privacy;
- optional terminal BEL behavior.

The dialog's bounded `T` shortcut exercises the selected transport without creating settings or changing Host state.

The Capability must not add a statusline field, footer counter, permanent dashboard, transcript message, or duplicate permission state. Permission alerts remain owned by the Permission Capability, which should eventually publish one authoritative Suite event rather than be inferred from Tool or Agent state.

## Comparative evidence

### Pi 0.84.1

The certified source establishes four relevant facts:

1. The Agent loop can emit `agent_end` after an error, abort, explicit stop-after-turn decision, or ordinary exhaustion ([`agent-loop.ts`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts)).
2. Agent event listeners are awaited, and the Agent does not become idle until `agent_end` listeners settle ([`agent.ts`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent.ts)).
3. The coding-agent session performs retry, compaction, and queued continuation after an Agent run, then emits `agent_settled` once in the outer `finally` path ([`agent-session.ts`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts)).
4. `agent_settled` is a public Extension event and the public RPC client uses it as the wait-for-settlement boundary ([Extension types](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts), [RPC client](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/rpc/rpc-client.ts)).

An `agent_settled` handler is itself awaited before the session resolves its idle waiter. The implementation should therefore schedule a short unreferenced grace timer and return immediately rather than block settlement on notification delivery.

### Claude Code 2.1.229

Claude Code separates in-terminal state from external attention. Official documentation exposes a `preferredNotifChannel` setting and terminal methods, plus Notification hooks for custom side effects ([terminal notifications](https://code.claude.com/docs/en/terminal-config#get-a-terminal-bell-or-notification), [settings](https://code.claude.com/docs/en/settings), [Notification hooks](https://code.claude.com/docs/en/hooks#notification)).

The first-party 2.1.229 Linux x64 package was inspected as released. Its npm wrapper identifies `@anthropic-ai/claude-code@2.1.229`; the native archive SHA-256 observed for this audit is `3504bb10af2adf351930b5ff5b90f7514fa52d9c1a6ebbf14464b72ad4f547f6`. The released dispatcher selects iTerm2, Kitty, Ghostty, or BEL according to configured/auto mode and otherwise permits no-method delivery. The foreground UI schedules an `idle_prompt` alert only after its configured idle threshold. Before delivery, it rechecks that Claude is no longer loading and that later user activity has not superseded the alert. Background session transitions use separate `agent_completed` and `agent_needs_input` notification types.

Pi Stuff should not reproduce Claude Code's private implementation names. It should notify for attention-worthy settled or blocked states, delay ordinary "waiting" alerts long enough to avoid noise, and keep external notifications separate from the in-terminal transcript and live work surfaces.

### OpenAI Codex `rust-v0.147.0`

Codex has a stronger focus seam than Pi Extensions. Its TUI tracks terminal focus from terminal events and defaults the notification condition to `unfocused`; an `always` condition is also available ([`tui.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/tui/src/tui.rs), [`types.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/config/src/types.rs)).

The TUI coalesces pending alerts by priority and supports `agent-turn-complete`, `approval-requested`, and `plan-mode-prompt` categories ([`chatwidget/notifications.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/tui/src/chatwidget/notifications.rs)). Delivery uses its terminal notification abstraction, including OSC 9 and BEL backends ([notification module](https://github.com/openai/codex/tree/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/tui/src/notifications)).

Codex also retains the legacy external `notify` command. Its payload is the historical `agent-turn-complete` JSON shape and is wired through the hook runtime, not the same focus-gated TUI path ([`legacy_notify.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/hooks/src/legacy_notify.rs), [configuration](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core/src/config/mod.rs)). Pi Stuff should not describe an external command hook as equivalent to a focus-aware terminal alert.

### Pi notification Packages

Exact npm archives were inspected rather than relying on package summaries:

| Package                                                                                   | Observed archive SHA-256                                           | Useful behavior                                                                      | Why Pi Stuff should not adopt it                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [`pi-notify@1.4.0`](https://registry.npmjs.org/pi-notify/1.4.0)                           | `7c6022211158ff088a6c9ba666c77263bacf68636e61718df5e991740fa87da5` | Small OSC transport selector                                                         | Listens to `agent_end`; no settlement, outcome, or activity contract                                              |
| [`pi-notify-agent@0.1.2`](https://registry.npmjs.org/pi-notify-agent/0.1.2)               | `7e3311e43282132603deb233be739520e7e56b0e79d78b8ed1da32f1e918eda9` | Duration threshold, success/error controls, desktop fallbacks, sound, BEL            | Listens to `agent_end`; retains provider-error state within a run and can notify before Host continuations settle |
| [`@pi-lab/notify@0.0.5`](https://registry.npmjs.org/@pi-lab%2Fnotify/0.0.5)               | `62879f1f2f146026a876fd9fdbfe9fbd36a23e1c2c0c51d7798085a15f059ae9` | Correctly listens to `agent_settled`; supports a script payload and permission event | Coupled to Pi Lab configuration and event conventions; broader dependency/product boundary than Pi Stuff needs    |
| [`@pi-archimedes/notify@2.0.1`](https://registry.npmjs.org/@pi-archimedes%2Fnotify/2.0.1) | `83d55edba7d811f1f203d23d5a0405b7ea3f752094b6d91d346e303435107a9b` | Thirty-second delay and cancellation on input, terminal input, or a new run          | Schedules from `agent_end`, depends on Archimedes core/bus/settings, and targets a forked Pi package surface      |

The packages validate several techniques: OSC selection, duration thresholds, delayed delivery, activity cancellation, and a settled event. None combines them under the Suite's Host lifecycle, UI authority, dependency, startup-purity, and headless-output constraints. The required implementation is smaller and safer as an owned Capability Module.

## Implementation shape

The Capability should be divided into three narrow parts:

1. The **work-cycle reducer** consumes public Pi lifecycle events and returns deterministic state transitions and a final outcome. It has no I/O or timers.
2. The **attention gate** owns the minimum-duration and post-settlement timers, generation IDs, cancellation, and one-alert-per-cycle guarantee.
3. The **transport** sanitizes bounded content, selects an explicitly supported terminal method, and emits only in an interactive UI context.

The Extension adapter should only translate public Host events into those parts and register settings/test controls. It should not inspect private Host state, duplicate Session history, or infer retries from error strings.

Import and `session_start` remain pure. A session may register callbacks and initialize in-memory defaults, but it must not write files, spawn subprocesses, probe the network, or alter Host settings. Notification errors are non-fatal and do not create transcript output.

## Acceptance gates

Implementation is complete only when all of the following pass:

1. A pure lifecycle matrix covers ordinary completion, Tool-ending completion, final error, abort, missing Assistant output, error followed by successful retry, retry exhaustion, auto-compaction continuation, Goal/extension-queued continuation, and several `agent_end` events followed by one `agent_settled`.
2. Fake-clock tests prove the 10-second minimum, 2-second grace period, one-alert-per-cycle behavior, stale-generation rejection, and cancellation by input, terminal input, new work, reload/replacement, and shutdown.
3. Outcome tests prove that an intermediate HTTP/provider failure does not make a recovered cycle fail and that an abort is silent by default.
4. Sanitization tests cover ESC, BEL, OSC terminators, newlines, long Unicode text, empty labels, and terminal-protocol delimiter injection.
5. Transport tests cover Kitty, each explicitly supported OSC path, BEL deduplication, unsupported terminals, disabled settings, write failure, `ctx.hasUI === false`, and RPC with `ctx.hasUI === true`.
6. A real certified Pi RPC/Package test proves discovery succeeds and no notification bytes enter the JSON stream.
7. Real PTY tests prove delayed completion and failure alerts, cancellation by terminal input, reload/shutdown cleanup, normal and narrow terminal behavior, and no statusline/footer/transcript duplication.
8. Import, initialization, and `session_start` purity audits prove no network, filesystem write, subprocess, or Host-setting mutation.
9. Suite generation, focused tests, `bun run check:fast`, the extracted Package seam, and the final `bun run check` pass.

## Evidence limits

This audit establishes source semantics and a Linux implementation direction. The automated PTY seam certifies one tmux path with `allow-passthrough` enabled; it does not visually certify macOS Notification Center, Windows toast delivery, desktop-bus availability over SSH, or every other terminal/tmux combination. Those transports must remain unclaimed until tested. Pi also cannot currently provide Codex-equivalent focus gating to a normal Extension, so recent activity is the supported suppression boundary.
