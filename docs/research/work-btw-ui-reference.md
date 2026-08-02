# Work BTW UI reference: Claude Code and Pi Packages

**Research date:** 2026-08-01  
**Decision scope:** What happens on screen when the user asks a side question while the main Agent is still working.

## Bottom line

The meaningful choice is not a color or shortcut. It is whether BTW is:

1. **A single quick exchange — selected by the maintainer on 2026-08-01.** The question opens a temporary BTW Command Dialog and produces one answer. The dialog stays open for reading; the user closes it to return to the main prompt. Earlier exchanges remain browsable only inside session-local BTW history.
2. **An ephemeral side thread.** The same temporary surface remains open with its own composer, so the user can ask follow-up questions and optionally bring selected context into the main editor.
3. **A detached mailbox.** Submitting the question immediately restores the main prompt; the answer is read later by reopening BTW. This preserves focus but gives no in-terminal ready signal under the already-confirmed zero-transcript and zero-statusline rules.

All three occupy zero rows while BTW is closed, keep routine BTW exchanges out of the main transcript and model context, and use the accepted divider-led, full-width, non-floating Command Dialog. Only an explicit Bring followed by a user submission may add selected content to the main conversation. A proposed multi-thread shelf was rejected before prototyping because it would add another normal-screen widget beside Todo and the Agent roster, contradicting the established BTW surface rule.

The visual comparison is recorded in the [Work BTW report](../prototypes/tui/work-btw-comparison-report.html). The maintainer selected A, following the Claude Code lifecycle; B and C remain rejected comparison evidence.

## Owned-fork selection

Pi Stuff will use an owned fork of [`@juicesharp/rpiv-btw@2.3.1`](https://registry.npmjs.org/@juicesharp%2Frpiv-btw/2.3.1) at source commit `75823a68024a0a649cc28087976074be791ca554`. After the single no-tool exchange was selected, this smaller Package became a better semantic base than the earlier `@narumitw/pi-btw` candidate: it already owns parent-context conversion and budgeting, independent cancellation, one command/one answer, `tools: []`, and transcript isolation without a multi-turn composer or extra runtime dependency. The exact decision, archive identity, comparison, required fork delta, and Pi 0.83 verification are recorded in [Work BTW Package reference](./work-btw-package-reference.md).

## Product boundary already established

- BTW answers a side question without stopping the main Agent turn.
- BTW lives in its own Command Dialog and may keep session-local BTW history, but routine BTW questions and answers never become main-conversation messages.
- The dialog replaces the editor region while active, hides the ordinary statusline, and restores any main-editor draft that still exists when the dialog opens. The `/btw ...` command text itself has already been consumed and is not such a draft.
- Pi Stuff does not use floating windows or centered overlays.
- Todo remains the main-session plan above the editor. The vertical Agent roster below the editor remains the only live child-session surface.
- A question that needs new file reads, commands, web research, edits, or an extended independent investigation belongs to a child Agent, not to BTW.

## Current Claude Code behavior

Anthropic's current [interactive-mode documentation](https://code.claude.com/docs/en/interactive-mode#side-questions-with-btw) defines `/btw` as the inverse of a subagent:

- it sees the current parent conversation but has no tools;
- it runs independently while the main turn continues;
- each invocation produces one response, with no follow-up turn in the BTW surface;
- the question and answer never enter the main conversation history;
- earlier exchanges remain in a separate session-local BTW history until cleared;
- bare `/btw` reopens the most recent exchange;
- a completed answer can be dismissed, scrolled, copied, browsed with older answers, cleared, or forked into a separate session.

### Released 2.1.220 black-box observation

The genuine Claude Code **2.1.220** Linux x64 binary was exercised in an isolated `100 × 32` PTY with a localhost-only Messages fixture. No user credential, session, project data, or external model request was used. The fixture supplied deterministic prose; the release binary owned rendering, command handling, BTW history, keyboard behavior, and main-turn concurrency.

The observed sequence is:

1. A long main turn shows its ordinary live row.
2. Submitting `/btw <question>` replaces that live row with an inline, unboxed BTW focus surface while the normal editor shell remains below it.
3. The BTW answer streams in place. The main turn keeps running but its live row is temporarily hidden.
4. Dismissing BTW restores the main live row while the fixture still has not delivered the main response. The capture proves that BTW did not cancel the in-flight main turn; it does not include a later main-completion frame.
5. After dismissal, the visible main conversation contains the main request and no BTW exchange; the fixture's main answer is still pending.
6. A second BTW invocation shows the earlier question dimmed, permits left/right history browsing, and supports clearing earlier exchanges.

Pi Stuff should keep that information hierarchy and lifecycle, but translate the official overlay mechanism into the Suite's already-selected non-floating Command Dialog.

## Current Pi Package evidence

### `@narumitw/pi-btw` 0.42.1

The npm release is MIT, declares exact Pi `0.83.0` development dependencies, depends at runtime on `@narumitw/pi-tui-kit`, and identifies repository revision `387d48c3724557492658846259832f4570720e0e`. The last-month npm API reported **7,640 downloads** for 2026-07-02 through 2026-07-31. The current package behavior is described on its [Pi Package page](https://pi.dev/packages/%40narumitw/pi-btw) and in the [upstream repository](https://github.com/narumiruna/pi-extensions/tree/387d48c3724557492658846259832f4570720e0e/extensions/pi-btw).

Version 0.42.1 is no longer a one-shot clone of Claude BTW. It opens an ephemeral, scrollable side-thread workspace with its own composer, supports multiple sequential follow-ups, and can load selected BTW context into the main editor without sending it. The main Agent and BTW model request can compute concurrently, but interaction is serial: the near-full-height BTW workspace owns the editor region until the user closes it.

It snapshots the current branch when opened, limits the constructed context to roughly 40,000 characters, and makes direct no-tool model calls. The snapshot primarily retains user and assistant content, so a recent tool result may be absent even when “why did that test fail?” is the most natural side question. Follow-ups are sequential and inherit only successful BTW turns. There is one temporary thread per invocation, not multiple parallel BTW slots. Closing the surface, reloading Pi, or switching session discards the thread; an in-flight request is not recovered.

Cancelling generation aborts only BTW, not the main Agent, but upstream closes the whole side thread and discards any late result. A provider failure appears as an error turn and reopens the composer; failed turns are excluded from later BTW model context and from Bring-to-main choices.

The production source is about 2.1 thousand TypeScript lines, much of it devoted to paging, text selection, preview, and bring-to-main menus. Its useful capability seam is narrower: parent-context snapshot, independent model/auth/thinking selection, no-tool streaming, cancellation, and strict exclusion from the main conversation. It remains valuable behavior evidence, but the later fork audit selected the smaller `@juicesharp/rpiv-btw` base because most of this Package's multi-turn workspace would otherwise be removed.

### Other established packages

- [`pi-btw` 0.4.1](https://pi.dev/packages/pi-btw) reported **8,391 last-month downloads**. It supplies a continuous, tool-capable Pi sub-session, focused modal shell, main/BTW focus switching, and answer injection. This is capable, but it overlaps the already-selected multi-Agent kernel and uses an upstream floating/modal presentation Pi Stuff has rejected.
- [`@nguyenquangthai/pi-btw` 1.1.2](https://pi.dev/packages/%40nguyenquangthai/pi-btw) reported **757 last-month downloads**. It supplies nine parallel slots, persistence, streaming, and injection. Its product shape most closely resembles the rejected multi-thread shelf and creates another work-management system beside Agents.

Download counts are adoption signals, not proof of code quality. The final Package must still be an owned, pinned fork with preserved MIT provenance and a local-change record.

## A. Single quick exchange

Concrete use:

1. The main Agent is still implementing and the user submits `/btw Why is this cache request-scoped?`.
2. A divider-led BTW Command Dialog temporarily takes the editor region. It shows the question, one streaming answer, and the fact that the main task continues computationally.
3. The completed answer remains open until the user dismisses it. Closing restores the draft captured when the dialog opened, Todo, Agent roster, and newest main progress.
4. Bare `/btw` can reopen session-local earlier exchanges; those exchanges still do not enter the main transcript.
5. If the question needs tools or a continuing investigation, it is promoted to a child session rather than turning BTW into a second chat.

This is the smallest mental model and the closest match to Claude. Its cost is that clarification requires another BTW exchange or promotion instead of an inline follow-up. Main and BTW compute concurrently, but user interaction is still serial: while BTW owns the editor region, the user cannot submit another main prompt. Todo, the Agent roster, and the ordinary statusline temporarily yield; a long BTW answer also reduces the visible main transcript. If the main task requests permission or user input, that higher-priority surface must preempt BTW rather than leaving the main task silently paused behind it.

## B. Ephemeral side thread

Concrete use:

1. The same `/btw` command opens a non-floating side workspace.
2. After the first answer, a BTW-specific composer remains, so the user can clarify or ask another related question.
3. The whole temporary thread can be scrolled. Selected content may be loaded into the main editor but is never sent automatically; it enters the main conversation only if the user then submits it.
4. Closing the workspace restores the main draft and discards the side thread.

This is more forgiving when the first answer is incomplete and maps directly to the mature `@narumitw/pi-btw` behavior. The trade-off is conceptual: BTW becomes a second conversation in which the user can remain for a long time, blurring the boundary with the Agent/session system.

## C. Detached mailbox

Concrete use:

1. The user submits `/btw <question>` and immediately returns to the main prompt while the independent request runs.
2. The normal screen shows no BTW row, notification, transcript record, or statusline entry.
3. The user later runs bare `/btw` to open the answer and local history in the Command Dialog.

This maximizes main-conversation availability. Under the confirmed no-widget, no-statusline, and no-transcript policy, however, the user cannot tell whether the answer is ready without reopening BTW. It is therefore quiet at the cost of feedback and discoverability.

## Confirmed direction

Pi Stuff uses **A, single quick exchange**. It preserves BTW as a sharply bounded work-control feature rather than a second Agent or second conversation and follows the Claude Code lifecycle selected by the maintainer. The owned fork of `@juicesharp/rpiv-btw` supplies the no-tool/context-isolation core without inheriting a full side-thread workspace. This decision accepts serial user focus while the dialog is open; “main task continues” means computational concurrency, not simultaneous typing into both surfaces.

The confirmed large structure freezes these points:

- one no-tool side question produces one answer;
- the main Agent continues concurrently;
- BTW uses the common non-floating Command Dialog and occupies zero normal-screen rows while closed;
- routine question and answer stay out of the main transcript and main model context;
- session-local BTW history can be reopened and cleared;
- cancelling BTW never cancels the main Agent;
- closing restores the main editor draft captured when the dialog opened, plus Todo and the Agent roster;
- tool-requiring or continuing work is promoted to the existing Agent/session system.

The following remain later questions: exact promotion action, copy behavior, history capacity, whether history is memory-only or survives resume through invisible session state, provider/model selection, shortcut, colors, line budget, and narrow-terminal thresholds. Independent calls also resend context and incur provider cost; a separately configured provider creates an additional privacy boundary that must be explicit.

## Feasibility boundary

Pi 0.83 can implement all three without a Host fork, although C needs more extension-owned lifecycle state than A or B:

- extension commands execute immediately even while the main Agent streams;
- `ctx.ui.custom()` supplies the non-floating focused surface;
- `getBranch()` and Pi's LLM conversion utilities can form an invocation-time parent-context snapshot;
- an extension-owned model request can use a separate abort signal and no tools;
- the current editor draft can be captured and restored around the dialog.

C additionally needs an extension-owned background-request registry, session identity and generation checks, reload/session-switch cancellation, and protection against delivering a late answer into a different session. Pi has no native BTW job supervisor and cannot resume an in-flight model request after reload; the request would become interrupted. Static layout fixtures do not prove this lifecycle.

The difficult cases are concurrency, not layout: the BTW surface must not send `Esc` into the main abort path; a main permission request must win focus; a main turn may finish while BTW is open; a provider may rate-limit concurrent requests; and an in-flight main assistant partial may not yet be present in the stable branch snapshot. Todo, BTW, and the Agent roster also need a small shared work-surface ownership protocol so an expanded dialog can make the other Suite-owned surfaces yield and restore without a Pi fork. These need production tests during implementation of the selected direction.

## Provenance and reuse limits

- Claude Code is observable product evidence only. Do not copy, translate, port, mechanically adapt, or redistribute its code.
- The genuine release capture uses synthetic fixture prose and real release rendering; it is evidence, not an implementation dependency.
- `@juicesharp/rpiv-btw@2.3.1` is the selected owned-fork base, not a direct dependency. Preserve its MIT license, exact npm archive and source revision, and a visible local-change record. `@narumitw/pi-btw` remains comparison evidence only.
- Native Pi comparison fixtures are disposable layout evidence. They do not prove live model concurrency, reload behavior, or provider correctness.
