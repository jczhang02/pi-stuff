# Tool Display module

Compact, presentation-only Tool UI for the Pi Stuff Suite.

The Capability re-registers seven Pi 0.84.3 built-in Tools with their original definitions and replaces only their
render slots. Tool schemas, prompt metadata, execution, result content, lifecycle events, and permission checks stay
unchanged. Pi 0.84.3's PowerShell Tool remains entirely Host-rendered; Pi Stuff recognizes its `powershell` name only
for reload/resume membership. Every Suite-owned Tool must declare Activity metadata through `registerSuiteOwnedTool`;
unknown third-party Tools keep their native renderer and form a display boundary.
`registration.ts` owns Suite Tool decoration, Activity coverage, and historical replay binding;
`index.ts` owns the ordered Host-event projection lifecycle; `registration-tracker.ts` owns Tool registry and active
surface projection;
`envelope-projection.ts` owns nested Tool decoding and ordinary-protocol projection; `group-projection.ts` owns
transcript grouping and result association; `activity-presentation.ts` owns live row reconciliation, while
`activity-query-projection.ts` owns summaries and Tool detail and `bash-operation-presentation.ts` owns Bash rows;
`registered-tool-renderer.ts` owns row/detail publication; and `activity-clock.ts` owns running markers. `ToolUiRuntime`
remains the single public live-projection facade.
`activity-model.ts` owns Activity vocabulary, `activity.ts` preserves the public facade and Bash classification,
`retrieval-groups.ts` plans transcript membership, and `activity-summary-format.ts` owns pure summary wording.

## Daily use

- Every continuous native Read, Grep/Find, or List segment is one **Retrieval Group**, beginning with the first eligible
  invocation. The eligibility set is closed: Bash, Web, MCP, media, mutations, Agent, Task, Background Work, Goal,
  unknown, and third-party Tools are independent Tool Activities and close retrieval.
- Assistant prose, user input, visible model-context Custom Messages, turn completion, automatic continuation, and a
  newly visible Logical Thinking Run after Tool activity close the current Retrieval Group. Streaming updates within
  the same Logical Thinking Run, Tool results, hidden state, and branch or compaction metadata do not.
- A successful settled or active Retrieval Group occupies exactly one physical row. Search, Read, and List clauses use
  that fixed order; Read counts unique canonical paths while Search and List count invocations. Active rows use present
  tense, omit the expansion hint, and may add enabled elapsed time and a stabilized target inline. Narrow widths drop
  target, then elapsed time, before truncating the semantic summary. Settled rows omit targets and elapsed time and show
  `(ctrl+o to expand)` only when it fits without wrapping.
- Failed, rejected, and cancelled native retrieval stays in its Retrieval Group. The only two-row compact exception
  keeps state-specific issue counts on the first row and the first bounded reason on one child row; remaining reasons
  stay available through expansion.
- Every Bash invocation remains one standalone `Bash(<command>)` Operation Block in source order, including read-only
  commands. Its command uses Claude Code's two-line/160-code-unit cap, output shows three lines before a bounded
  `… +N lines` notice, and running, empty, stderr, exit, cancellation, rejection, and failure states remain explicit.
  `Ctrl+O` expands the bounded command and output in that same block without generic protocol chrome.
- Successful Task calls stay compact-silent because Todo owns their visible state. Successful `tool_search` and
  `ctx_reduce` calls are silent and transparent to retrieval. All remain inspectable through `Ctrl+O` and `/tools`;
  an issue in any of them becomes an independent Tool Activity and closes retrieval on both sides.
- Pi's global `Ctrl+O` restores eligible calls, existing Tool-specific renderers, successful Task and infrastructure
  calls, and Logical Thinking Runs in persisted source order. `/tools [group-or-member-id]` keeps Tool Activity as its
  first-level unit: a Retrieval Group exposes ordered `Calls`, while independent activity remains a singleton. Up/Down
  selects members, PageUp/PageDown scrolls, Home/End jumps, `r` toggles formatted and Raw views, and Escape unwinds the
  dialog.
- Tool rendering is total: a missing historical Tool definition, malformed optional metadata, or throwing presentation
  hook receives a bounded generic row at its source position. Nested envelope Tools and media retain their owning
  renderers. Only an otherwise unrepresented outer error, rejection, or cancellation receives one Envelope Fallback
  Row; successful pure-JavaScript Code Mode with no nested Tool or media row stays absent.
- Envelope replay keeps raw arguments for Raw detail and applies the Tool's current `prepareArguments` compatibility
  shim before Activity classification, semantic detail, and rendering. Historical results may omit `details`; optional
  malformed metadata is ignored without discarding the operation. Control-only `<system-reminder>` blocks added by a
  nested result hook do not become Code Mode business output; the owning outer Host result remains the control-message
  delivery boundary. Nested streaming reaches the caller immediately; informational update hooks run one at a time and
  retain only the latest pending update when a hook lags, while the final Tool result remains authoritative.
- `/ui` contains the default-on **Tool running timer** setting. It controls whether long-running standalone rows and
  active Retrieval Groups show elapsed time after the existing threshold. Settled summaries never retain it.
- An empty `/tools` Dialog keeps key-help and close hints, but omits selection and detail hints until a row exists.
- Formatted and Raw detail text is capped at 240 lines and 24 KiB per selected call. Raw includes call ID, Tool name,
  arguments, result content, and details. The default `Result` section shows an unlabeled target followed by
  Tool-owned detail instead of injecting repeated Tool, `Target:`, or `Summary:` fields; Raw is explicitly titled
  `Raw`. When a generic summary was automatically derived from the first result line, formatted `Ctrl+O` and `/tools`
  detail omit that same line; a one-line result adds no filler. Custom summaries, non-empty Tool-owned detail, and Raw
  remain unchanged. Compact mode neither precomputes nor caches a global Raw transcript. Tool-owned business results
  are never truncated or rewritten by this Capability.
- Grouping is a deterministic display projection. Session JSONL, model-visible messages, active Tool membership, and
  execution behavior remain unchanged, and Tool Activities are rebuilt after live updates, reload, restart/resume,
  tree navigation, and compaction without a migration or compatibility mode.
- In-process `/resume` pre-binds exactly the active Suite-rendered built-ins before Pi reconstructs history and preserves
  Host-native PowerShell membership without adding a renderer. The first resumed frame therefore stays compact without
  reviving disabled tools; the complete active Tool order is preserved, and new calls are rebound to the target session's
  working directory, trust, and project settings.

## Performance verification

`bun run benchmark:tool-activity` reconstructs one 20,000-call cross-round-trip Retrieval Group, compares its median
runtime with the former adjacent-Exploration projection, verifies all members survive, and enforces both a 25 ms
maximum regression from that baseline and a conservative 250 ms absolute ceiling. It also measures 200 incremental
stream updates after that 20,000-call history and formatted expansion of 1,000 short results under a 250 ms ceiling.
The formatted benchmark also rejects Raw protocol headings. Streaming updates replan only the current
Narrative Boundary tail, while timer frames reconcile only the affected group; neither path rescans the full Session.

See `UPSTREAM.md` for source provenance and the local delta. The current interaction contract is recorded in
repository ADR `docs/adr/0022-restrict-folding-to-native-retrieval.md`; ADR 0010 is retained only as superseded
decision history. The 2026-08-17 `/tools` readability update was
implemented on 2026-08-18, including lifecycle icons, `◆` sections, compact-keyboard paging, singleton detail,
formatted/Raw navigation, and the fixed wide split. Focused tests and the real PTY verifier cover the shipped Dialog,
including a Space page sequence and Tab pane switch sent through the real Host.
