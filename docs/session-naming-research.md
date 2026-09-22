# Automatic session naming research

[简体中文](i18n/zh-CN/session-naming-research.md). Research dated 2026-09-22; recommendations are not an approved implementation contract.

Automatic naming is worth restoring for finding and resuming parallel sessions. The useful outcome is a recognizable, stable task label. Periodic renaming is useful when the task actually changes; elapsed time alone is not a reason to replace a good name. This is a product recommendation, not a measured usability result.

## Evidence and current state

The current baseline is `cd0f174f65bdbacdca265646b4e191943063d0ac`. Its [entrypoint](../index.ts) registers Web and RTK, and [configuration](../src/pi/configuration.ts) accepts only `tools`, `web` and `rtk`. There is no session-naming registration or setting. Unknown configuration fields are rejected, so copying the old `sessionNaming` settings into this version is not a supported installation path.

The local legacy checkout was inspected at `21b636eaccc487a08362165ec69ffe364e8730fb`, specifically `packages/pi-stuff/src/session-naming/{index,controller,state,prompt,model,settings}.ts`, `conversation-ui/{index,agent-run-origin}.ts` and `docs/adr/0020-add-automatic-session-naming.md`. These files were unchanged in that checkout. GitHub could not resolve that commit on the current repository, so these are local source observations, not publicly retrievable evidence. The old ADR records historical decisions; it is not an ADR of the rebuilt repository.

The legacy implementation forked [pi-autoname at 73d25ca](https://github.com/ssdiwu/pi-autoname/tree/73d25caa9ff33dadfaa8187ad3f7d1495a01cec9), which was still its upstream main when checked. The upstream README documents first-dialogue naming, cooldown-based reconsideration, explicit `/autoname`, and a configurable manual-name policy. Its language policy follows user language; the legacy fork deliberately required English.

| Legacy behavior observed in source                                                                                                     | Assessment for the rebuilt version                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enabled by default; reconsider after a settled user run when ten minutes have passed                                                   | Retain event-driven reconsideration; ten minutes is a starting value, not a measured optimum. No idle timer is needed.                                                                           |
| `respectManualName: false`                                                                                                             | Recommend changing the default: a manual name should remain until explicit regeneration. This is a proposed departure from legacy behavior.                                                      |
| Last six user/assistant messages, up to 700 characters per message before escaping; no tool-result messages, images or thinking blocks | Keep bounded text input. Preserve an initial task anchor as well as recent context so a small follow-up does not replace the task identity. Assistant text can still repeat sensitive tool data. |
| English prompt requesting 2-4 words; validation accepts 3-30 ASCII characters with an English letter                                   | Do not describe the word count as enforced. Language and display-width policy need a new decision; Chinese support requires changing validation too.                                             |
| Configured model, configured fallbacks, then current session model; 12-second attempts, 30-second total budget, 64 output tokens       | Reuse the host model registry. Prefer current model by default or one explicit alternative; an implicit cross-provider fallback is unnecessary for a cosmetic feature.                           |
| Automatic, forced and observed manual state persisted as custom entries                                                                | Preserve ownership across resume, but align metadata scope with Pi's session-wide name semantics.                                                                                                |
| Explicit `/autoname` remains available with automatic naming disabled                                                                  | Retain. Automatic errors should stay quiet; explicit invocation needs a useful failure message.                                                                                                  |

The legacy code already rejects superseded results after manual renames and shutdown, excludes child sessions through its child-process convention, and cancels managed requests. These are requirements worth retaining, not evidence that its full lifecycle can be copied into the current repository.

Pi 0.85.1 is pinned upstream at `d981de1229ef899957bbe968bc8dcda02a21f477`. Public sources for the installed-code observations below are its [extension types](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts), [agent lifecycle](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts), [session metadata](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts) and [session selector](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/session-selector.ts). The selector displays the first message when a name is absent.

## Two integration traps

Installed `@earendil-works/pi-coding-agent@0.85.1` exposes `getSessionName`, `setSessionName`, `appendEntry`, `modelRegistry.complete`, `session_info_changed`, `session_start`, `session_shutdown` and `session_tree`. Naming does not need a new provider client or direct JSONL editing.

`AgentSettledEvent` carries only its type. In `dist/core/agent-session.js`, `_runAgentPrompt` emits settlement in `finally`; settlement is not proof of success or direct user origin. `InputEvent.source` distinguishes `interactive`, `rpc` and `extension`, but accepted input must still be tied to delivered work. The legacy shared origin tracker makes that distinction, yet its inspected settlement publisher does not check the assistant stop reason. The old ADR's promise to exclude failed/cancelled runs is therefore not established by that path. A new implementation must explicitly test success, interruption, failure, handled input, queued steering/follow-ups and automatic continuation.

Pi's `SessionManager.getSessionName()` scans all entries, whereas the legacy rename marker is restored from `getBranch()`. A real in-memory Pi 0.85.1 probe appended a name and marker, then branched back before both:

```json
{
  "name": "RTK Review",
  "branchTypes": ["message"],
  "allTypes": ["message", "session_info", "custom"]
}
```

The name remains while the marker disappears from the active branch. The legacy `restore()` treats a name without a matching marker as manual; its naming registration also lacks a `session_tree` listener. This demonstrates a scope mismatch and a missing navigation hook, not a reproduced end-to-end overwrite. Track name ownership at session scope and independently invalidate pending requests when the active branch changes. Forking into another session needs an explicit inheritance policy.

Reproduce the probe from a checkout with the pinned dependencies installed:

```sh
bun -e 'import {SessionManager} from "@earendil-works/pi-coding-agent"; const s=SessionManager.inMemory(); const root=s.appendMessage({role:"user",content:"Investigate RTK",timestamp:0}); s.appendSessionInfo("RTK Review"); s.appendCustomEntry("research-marker",{name:"RTK Review"}); s.branch(root); console.log(JSON.stringify({name:s.getSessionName(),branchTypes:s.getBranch().map(e=>e.type),allTypes:s.getEntries().map(e=>e.type)}));'
```

## OpenCode comparison

OpenCode v2.0.9 (`6608799`) starts an automatic title request when input becomes visible for an untitled root session, before the main response finishes. Its [runner](https://github.com/anomalyco/opencode/blob/6608799d35d96c2821a48ac1d4b26a3b84b4e433/packages/core/src/session/runner/llm.ts#L156-L173) deduplicates concurrent naming jobs by session. This offers earlier identification; waiting for the first completed exchange instead gains the assistant's task context. Neither timing is universally necessary. For this repository I favor the latter, consistent with the legacy intent.

Its [title service](https://github.com/anomalyco/opencode/blob/6608799d35d96c2821a48ac1d4b26a3b84b4e433/packages/core/src/session/title.ts#L93-L141) combines the original request with bounded recent text for regeneration, rereads the current title before writing, skips changed or identical titles, and guards publication with an event sequence check. These are useful precedents for stable names and manual-rename protection. This is source evidence, not a live OpenCode test. The first-input model is an alternative to the periodic topic-update policy, not evidence that OpenCode uses the legacy ten-minute policy.

## Proposed first implementation

Name an unnamed parent session after its first successful, settled direct-user exchange. Start a bounded background request without awaiting it in the settled handler. For subsequent successful user exchanges, reconsider only a name owned by automatic naming after the cooldown. Ask the model to return the current name exactly when it still fits. Do not rename on tool completion, elapsed idle time, automatic continuation, or child completion alone.

Keep `/name` as the manual override and `/autoname` as explicit regeneration. A generated result may be committed only if the same session, branch, input revision and name ownership still apply. New input, tree navigation, session replacement, manual rename, disabling the feature and extension reload must invalidate or cancel stale work. Cancellation and a final validity check are both needed because a provider may finish while cancellation is being processed.

Use only text needed to recognize the task, without tools or thinking. Reject empty, multiline/control-character and overlong output. Pattern-based credential redaction reduces obvious leakage but cannot guarantee removal of private content. The model route must be visible to the user; adding a different provider should be explicit. On a rename failure retain an existing name. For an unnamed session, Pi's existing list fallback is adequate until the next eligible attempt; a local extraction fallback is optional, not a reason to retry on every turn.

Reuse the current host configuration owner and register one naming capability from the root entrypoint. Do not import the legacy conversation UI framework just to obtain its lifecycle signal. Determine the smallest local attribution logic that covers actual callers, coordinating the child-session convention with the ongoing subagent work. A new command/configuration namespace and persisted ownership marker would be public-interface/persistence work requiring maintainer agreement before implementation. No such change is made by this report.

I recommend a language policy that follows the user's task language and preserves technical identifiers. The legacy English-only policy remains a valid preference if the maintainer wants English session lists. Neither policy can be inferred from the repository's English-only Issue/PR title rule.

## Acceptance cases and limits

- First successful user exchange generates one short, recognizable title; retry/compaction/queued continuation do not create duplicate requests.
- A same-topic follow-up retains the exact title; a substantial task change after cooldown can replace an automatically owned title.
- A manual name survives resume and later turns. Explicit regeneration can replace it; disabling automatic naming does not disable the explicit command.
- A delayed response cannot rename a different session, a newly selected tree branch, a newer task revision or a manually renamed session.
- Missing credentials, timeout, provider failure and malformed output leave the main run usable and keep an existing name. Repeated failures have bounded retry behavior.
- Chinese, English, mixed identifiers, very long text and synthetic secret-like input satisfy the chosen title-language and display constraints.
- Verify actual provider traffic, persisted metadata and resume/tree/fork behavior in the pinned Bun-compiled Pi host. Unit tests alone do not establish this seam.

This investigation read source and executed the in-memory metadata probe. It did not run live model calls, benchmark title quality, measure token costs, certify the legacy extension, or modify runtime behavior. Cost depends on bounded input, actual request frequency and the selected provider; even returning the same title still costs a generation call. Production implementation and its independent concurrency/persistence review remain separate work.
