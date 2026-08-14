# Live-only Thoughts feasibility on Pi 0.84.1

Date: 2026-08-13

## Question

Can Pi Stuff implement this transcript contract without modifying Pi?

- Show one current Thought while an Assistant message is streaming.
- Replace that row in place as the current semantic block changes.
- Remove it completely when the Assistant message settles or starts Tool execution.
- Do not replay settled Thoughts after resize, reload, or resume.
- Leave no blank or otherwise invisible transcript row behind.
- Keep the original Thinking blocks unchanged in Session data and model context.
- Use supported public Extension seams rather than patching Host internals.

## Verdict

**No. The complete contract is not implementable through Pi 0.84.1's public Extension API.**

Pi Stuff can project the live text through `registerMarkdownTransformer()`, and it could instead place a live summary in the Working Row or an extension widget. None of those APIs can structurally omit a built-in Thinking block from `AssistantMessageComponent`. Returning an empty Markdown string hides the characters but leaves Host-owned `Spacer` rows. An empty hidden-Thinking label leaves even more blank rows.

The only public hook that can make the settled built-in component zero-height is `message_end` replacement with the Thinking blocks removed. That hook mutates the canonical finalized Assistant message in Agent state and Session persistence, so it violates the display-only and context-preservation requirements. Reconstructing the Thinking later through `context` would create a Pi Stuff-owned shadow transcript and would still change Session data, later lifecycle events, and behavior when the Package is absent.

A runtime monkey patch of `AssistantMessageComponent` could technically change the result without editing files under Pi, but it changes Host behavior through private implementation details. It is not a supported Extension solution and is equivalent to carrying a version-specific Pi patch in process.

## Certified scope

Pi Stuff certifies Pi `0.84.1` at upstream commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`, with Bun `1.3.14`; see [`docs/compatibility.md`](../compatibility.md#certified-host). Pi `v0.84.1` is also the current release examined for this note.

The relevant upstream source citations below are pinned to that commit rather than to a moving branch.

## Why the Markdown transformer cannot remove the row

Pi creates one `AssistantMessageComponent` at every Assistant `message_start`, appends it to `chatContainer`, updates that same component during streaming, and settles it on `message_end`. It then drops only the `streamingComponent` reference; it does not remove the settled component from the transcript. Restored messages each receive another `AssistantMessageComponent`.

Sources:

- [`interactive-mode.ts` lines 3121–3216](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3121-L3216)
- [`interactive-mode.ts` lines 3453–3550](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3453-L3550)

Inside `AssistantMessageComponent.updateContent()`, Pi makes vertical-layout decisions from the **original message content before Markdown transformation**:

1. Any non-empty original text or Thinking block sets `hasVisibleContent`.
2. `hasVisibleContent` unconditionally inserts a leading `Spacer(1)`.
3. A Thinking block computes `hasVisibleContentAfter` from the original following blocks.
4. If another original text or Thinking block follows, Pi inserts another `Spacer(1)` after the Thinking block.
5. Only the nested `Markdown` component receives the Extension transformer.

Source: [`assistant-message.ts` lines 89–168](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L89-L168).

Consequently, this apparently natural change is insufficient:

```ts
if (context.messageType === "assistant-thinking" && !context.isStreaming) {
  return "";
}
```

It makes the nested Markdown zero-height, but it cannot retract the leading or inter-block spacers that the parent already created.

This is a limitation of the seam, not of Pi Stuff's current semantic-block parser. The Host documents `registerMarkdownTransformer()` as a synchronous display-only **string-to-string** transform, and it exposes no omit/suppress result:

- [`extensions/types.ts` lines 1147–1153](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L1147-L1153)
- [`docs/extensions.md` lines 1566–1591](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/docs/extensions.md#L1566-L1591)

Pi Stuff currently uses exactly this public, display-only seam. Its transformer receives `isStreaming`, but the current implementation intentionally projects both live and settled blocks the same way:

- [`live-thought.ts` lines 34–51](../../packages/pi-stuff/src/conversation-ui/live-thought.ts#L34-L51)
- [`conversation-ui/README.md` lines 92–102](../../packages/pi-stuff/src/conversation-ui/README.md#L92-L102)

## Certified component probe

A direct probe instantiated Pi 0.84.1's real `AssistantMessageComponent`, called `updateContent(message, false)`, and rendered at 80 columns. Blank-looking terminal lines were normalized to `<blank>`.

| Finalized Assistant content | Attempt | Rendered lines |
| --- | --- | --- |
| Thinking + Tool call | settled Thinking transforms to `""` | `1`: `<blank>` |
| Tool call only | Thinking semantically removed | `0`: none |
| Thinking + final text | settled Thinking transforms to `""` | `3`: `<blank>`, `<blank>`, ` Done.` |
| Final text only | Thinking semantically removed | `2`: `<blank>`, ` Done.` |
| Thinking + Tool call | native hide mode and empty hidden label | `2`: `<blank>`, `<blank>` |
| Thinking + final text | native hide mode and empty hidden label | `4`: three `<blank>` rows, then ` Done.` |

The important comparisons are:

- A Tool-calling message changes from zero rows to one blank row when Thinking is preserved but transformed to empty.
- A final text message gains one extra blank row relative to the same message with Thinking removed.
- `setHiddenThinkingLabel("")` is worse because Pi still creates a styled `Text` component for every hidden Thinking run in addition to the structural spacers.

The probe used the repository's certified Pi `0.84.1` dependencies and Bun `1.3.14`. The observed counts follow directly from the parent layout logic cited above.

## Evaluation of every public candidate

| Candidate | Live one-row projection | Settled zero-height | Session/context unchanged | Decision |
| --- | ---: | ---: | ---: | --- |
| `registerMarkdownTransformer()` | Yes | **No**; parent spacers remain | Yes | Current safe seam, insufficient |
| `hideThinkingBlock` + `setHiddenThinkingLabel("")` | No useful live projection | **No**; two or more blanks in the probe | Yes | Reject |
| Working Row (`setWorkingMessage`) | Yes | Yes for the Working Row itself | Yes | Cannot suppress native transcript block |
| Extension widget (`setWidget`) | Yes | Yes for the widget itself | Yes | Cannot suppress native transcript block |
| `registerMessageRenderer()` | No | No | Yes | Only accepts `CustomMessage`, not built-in Assistant messages |
| `message_end` replacement | Yes, with a separate live surface | Yes | **No** | Visually works only by changing canonical data |
| Thinking level `off` | No Thinking to project | Yes | Model behavior changes | Not a UI solution |
| Runtime prototype/Host-tree monkey patch | Technically | Technically | Potentially | Unsupported private Host modification; reject |
| ANSI cursor movement/erasure | Superficially | Not structurally | Potentially | Corrupts TUI layout/scrollback; reject |

### Native hidden-Thinking mode

The public UI API can change only the collapsed label through `setHiddenThinkingLabel()`; it does not expose `setHideThinkingBlock`, a `ThinkingVisibility`, or separate live/historical transcript modes. Pi 0.84.1's `ExtensionUIContext` contains Working Row, hidden-label, and widget setters but no structural Thinking-visibility setter:

- [`extensions/types.ts` lines 140–176](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L140-L176)
- [`interactive-mode.ts` lines 2093–2104](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2093-L2104)

The Host's native hide mode means “render a collapsed label,” not “omit the block”; see [`assistant-message.ts` lines 139–166](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/components/assistant-message.ts#L139-L166).

### Working Row or widget

A Working Row or widget is a valid home for an ephemeral live summary and can disappear without retaining its own row. However, those setters operate on separate Host containers and have no authority over existing `AssistantMessageComponent` children. Moving the live text therefore does not solve settled transcript suppression.

Sources:

- [`extensions/types.ts` lines 148–176](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L148-L176)
- [`interactive-mode.ts` lines 2066–2081](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2066-L2081)

### Custom message renderer

`registerMessageRenderer()` is typed and documented only for extension-owned `CustomMessage` values. It cannot replace the built-in Assistant renderer:

- [`extensions/types.ts` lines 1159–1163 and 1288–1289](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L1159-L1163)
- [`docs/extensions.md` lines 1562–1564](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/docs/extensions.md#L1562-L1564)

### `message_end` replacement

This is the only supported hook that can make the built-in component structurally empty: return the finalized Assistant message without Thinking blocks. Pi runs Extension handlers first, then notifies the TUI, then persists that same message. Its replacement helper explicitly mutates the Agent-state object in place so later events and Session persistence see the replacement.

Sources:

- [`extensions/types.ts` lines 1097–1100](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts#L1097-L1100)
- [`agent-session.ts` lines 610–660](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts#L610-L660)
- [`agent-session.ts` lines 710–780](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts#L710-L780)

That is a message transformation, not a display transformation. It would remove or relocate provider Thinking data from the canonical Assistant message before Tool continuation, affect other extensions and later lifecycle events, alter resumed sessions, and make correct reconstruction depend on Pi Stuff remaining installed. A `context` handler could maintain a second private copy and reinsert it before requests, but that would be a new shadow Session/context layer and would still fail the “original Session data unchanged” contract. Pi Stuff should not take that path.

## Missing Host capability

The smallest acceptable Host capability is structural, not cosmetic. Pi must let an Extension suppress a Thinking block **before** `hasVisibleContent`, `hasVisibleContentAfter`, and spacer construction, while leaving the original message untouched.

One possible contract would be an `isStreaming`-aware visibility decision with three outcomes:

- `show`: render full transformed Thinking;
- `collapse`: render a label;
- `omit`: do not create a child or any spacing for that block.

For Live-only Thoughts, Pi Stuff would request `show` while streaming and `omit` after settlement and during historical rebuild. The Host would remain the authority for message components and spacing.

Upstream issue [#3203, “Zen mode in pi”](https://github.com/earendil-works/pi/issues/3203) proposed a related `ThinkingVisibility`/transcript-mode capability, but it was closed without becoming part of Pi 0.84.1. Upstream issue [#3629](https://github.com/earendil-works/pi/issues/3629) also confirms that a per-block hidden-Thinking renderer is not currently exposed; the maintainer declined that broader renderer hook. Neither issue changes the certified API described above.

## Upstream issue and PR search

A 2026-08-13 search covered Pi's GitHub Issues and pull requests with combinations of `thinking`, `hide`, `history`, `live transcript`, `renderer`, `blank line`, `zero height`, and the relevant API names. It also scanned the titles and bodies of all 277 GitHub Discussions then present. No open item provides this capability, and no merged change makes a settled transformed Thinking block structurally zero-height.

The closest records are:

| Record | Match to this problem | Outcome |
| --- | --- | --- |
| [#4031, “Allow hidden thinking blocks to render as no visible chat row”](https://github.com/earendil-works/pi/issues/4031) | Almost exact. It asks for TUI-only omission, reclaimed spacer rows, and unchanged Session/model context. | Auto-closed, later labeled `no-action` and closed `not planned`; no maintainer explanation. |
| [#3203, “Zen mode in pi”](https://github.com/earendil-works/pi/issues/3203) | Proposes separate live and historical transcript modes with `thinking: "show" | "collapse" | "hide"`. That surface could express live-show/historical-hide, though the proposal also covers Tools and the Working Row. | Auto-closed, later labeled `no-action` and closed `not planned`; not merged. |
| [#1954](https://github.com/earendil-works/pi/issues/1954) and [PR #1955](https://github.com/earendil-works/pi/pull/1955) | The first requested change is exact for native hidden mode: “fully hide, no label, no space.” The four-addition/six-deletion PR excluded hidden Thinking from `hasVisibleContent` and skipped its row. | PR closed unmerged under the contribution gate; the maintainer closed the paired issue with “No.” The issue also bundled a separate request to hide intermediate Assistant prose, so the one-word reply gives no narrower rationale. |
| [#3629, “Add per-block renderer hook for thinking”](https://github.com/earendil-works/pi/issues/3629) | A broader Extension renderer hook could implement omission. | Maintainer explicitly declined exposing it: “we already expose too many things,” with possible reconsideration after a server rewrite. |
| [#2673, “Add setHiddenThinkingLabel API”](https://github.com/earendil-works/pi/issues/2673) | Related accepted customization, but only changes the collapsed label. | Implemented as `ctx.ui.setHiddenThinkingLabel()`; it does not suppress the row or spacer. |
| [#6747](https://github.com/earendil-works/pi/issues/6747) and merged [PR #7231](https://github.com/earendil-works/pi/pull/7231) | Establishes the supported display-only Markdown-transform seam and supplies `isStreaming`. | Merged, but its return type is only `string`; parent layout still uses original content before applying it. |
| [#6524, “Hide GPT-5.6 reasoning-summary empty placeholders”](https://github.com/earendil-works/pi/issues/6524) | Different visible symptom, but directly discusses the same data/rendering boundary. | The maintainer said it must be fixed in `AssistantMessageComponent` and not filtered from the Assistant message because that may break the signature. It closed after the provider fixed that particular placeholder upstream. |

The current `main` branch still computes `hasVisibleContent` and inserts `Spacer(1)` before nested Markdown transformation, exposes `setHiddenThinkingLabel()` but not `setLiveTranscriptMode()`/`setHistoricalTranscriptMode()`, and has no built-in Assistant/Thinking renderer hook. Therefore these records confirm both parts of the local finding: the desired behavior has been requested before, and upstream currently offers no accepted structural display-only solution.

## Recommendation

Do **not** implement `!isStreaming ? "" : thought` in Pi Stuff. It would pass a pure-transformer test while failing the real Host contract with retained blank rows.

Do **not** strip Thinking in `message_end`, maintain a shadow copy, patch `AssistantMessageComponent.prototype`, or emit cursor-control tricks. Each option either changes canonical semantics or relies on private Host behavior.

Until Pi exposes zero-height Thinking suppression, keep the existing compact settled Thought projection or turn model Thinking off explicitly when the user accepts the behavior change. The requested Live-only, zero-residue UI should be tracked as blocked on a narrow upstream Host seam rather than implemented as a Pi Stuff-only fix.

## Acceptance criteria if the Host seam becomes available

A future implementation should be certified through real Host behavior, not only the pure transformer:

1. During one streaming Assistant message, exactly one Thought row updates in place.
2. After a Thought + Tool-call Assistant message settles, the Assistant component renders zero lines before the Tool row.
3. A Thought + final-text message has exactly the same spacing as the equivalent text-only message.
4. Multiple Tool round-trips leave no historical Thought text and no extra empty lines.
5. Resize, theme invalidation, reload, resume, tree navigation, and compaction do not resurrect settled Thoughts.
6. Session JSON and the next provider context retain byte-equivalent original Thinking blocks.
7. Pi's native Thinking toggle has deterministic semantics for the current live row.
