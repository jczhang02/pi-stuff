# Tool Display module

Compact, presentation-only Tool UI for the Pi Stuff Suite.

The Capability re-registers seven Pi 0.84.3 built-in Tools with their original definitions and replaces only their
render slots. Tool schemas, prompt metadata, execution, result content, lifecycle events, and permission checks stay
unchanged. Pi 0.84.3's PowerShell Tool remains entirely Host-rendered; Pi Stuff recognizes its `powershell` name only
for reload/resume membership. Every Suite-owned Tool must declare Activity metadata through `registerSuiteOwnedTool`;
unknown third-party Tools keep their native renderer and form a display boundary.

## Daily use

- Every continuous retrieval segment in a user turn is represented by one **Tool Activity Group**. Native Read,
  Grep/Find, List, and conservatively classified read-only Bash calls participate. A group begins with one Tool and can
  span Assistant Tool round-trips and visible Thinking. Assistant prose, turn completion, user input, visible
  model-context Custom Messages, and every non-retrieval Tool close it.
- Ordinary Bash is one standalone `Bash(<command>)` operation block in native order with a bounded `⎿` child preview.
  Bash joins retrieval only when every effective command is one of `cat`, `head`, `tail`, `wc`, `jq`, `grep`, `rg`,
  `find`, `ls`, `tree`, or `du`, or a neutral `echo`, `printf`, `true`, `false`, or `:`. Unknown, mixed,
  consequential, malformed, redirected, or background commands remain standalone. Shell composition inside one call
  remains one block. The command title follows
  Claude Code's two-line/160-code-unit cap. Output shows three lines and then `… +N lines (ctrl+o to expand)`; an active
  call without output shows `Running…`, while a settled empty result shows `(No output)`. Streaming output, stderr,
  exit status, cancellation, rejection, and failure remain explicit. `Ctrl+O` retains the operation block and expands
  its bounded command and output in place, without Pi's generic `Call` / `Result` chrome. Apart from Pi Stuff's accepted
  small transcript bullet and semantic colors supplied by the active Host theme, the operation wording, row count,
  spacing, and child hierarchy are matched against real Claude Code 2.1.220 and Pi Host 0.84.3 captures.
- A group appears immediately, even for one retrieval Tool. Running summaries use present-tense semantic language and one short,
  width-safe target hint; settled summaries use past tense and remove raw commands, paths, result text, elapsed time,
  and redundant `done` labels. Native Read deduplicates canonical paths; Search, List, and Bash-only retrieval count
  invocations.
- Edit, Write, Apply Patch, Web, History, Memory, Agent, Background Work, Goal, Image, ordinary Bash, and unknown
  third-party or MCP calls retain independent Tool rows and bound retrieval. Task calls also bound retrieval, but
  successful calls stay silent because the Todo checklist owns their visible state; Task issues retain a row and every
  call remains available through `/tools`. `tool_search` and `ctx_reduce` are silent, transparent members that remain
  available in details. Failed, rejected, and cancelled retrieval remains folded but is called out with counts and the
  first issue reason.
- The compact transcript hides Tool arguments and textual results. Real media remains visible. Pi's global `Ctrl+O`
  restores every folded Tool row in native transcript order with formatted Tool-owned details and restores retrieval
  Bash as a Bash Operation Block. It does not add generic protocol headings or argument dumps. `/tools
  [group-or-member-id]` selects a Group or independent Tool; its five-member detail window builds only the selected
  call. Up/Down selects members, PageUp/PageDown scrolls, Home/End jumps, `r` toggles formatted and Raw protocol views,
  and Escape unwinds Raw, detail, list, then the dialog.
- Tool rendering is total: every visible Suite-owned call, result, and error has either its owning renderer or a generic
  Tool row. A missing historical Tool definition, malformed optional result metadata, or throwing presentation hook
  cannot remove the record or expose Pi's raw Tool-result fallback. A Tool envelope stays visually absent only while
  its nested rows completely represent the outcome. Code Mode additionally omits a strictly classified Control-only
  Execution and a successful no-output diagnostic before Activity planning. Other empty envelopes and outer errors not
  owned by a nested issue receive one envelope fallback row.
- Envelope replay keeps raw arguments for Raw detail and applies the Tool's current `prepareArguments` compatibility
  shim before Activity classification, semantic detail, and rendering. Historical results may omit `details`; optional
  malformed metadata is ignored without discarding the operation. Control-only `<system-reminder>` blocks added by a
  nested result hook do not become Code Mode business output; the owning outer Host result remains the control-message
  delivery boundary. Nested streaming reaches the caller immediately; informational update hooks run one at a time and
  retain only the latest pending update when a hook lags, while the final Tool result remains authoritative.
- `/ui` contains the default-on **Tool running timer** setting. It controls whether long-running standalone/expanded
  Tool rows show live elapsed time. Activity Group completion summaries never retain elapsed time.
- Formatted and Raw detail text is capped at 240 lines and 24 KiB per selected call. Raw includes call ID, Tool name,
  arguments, result content, and details. The default `Result` section shows an unlabeled target followed by
  Tool-owned detail instead of injecting repeated Tool, `Target:`, or `Summary:` fields; Raw is explicitly titled
  `Raw`. When a generic summary was automatically derived from the first result line, formatted `Ctrl+O` and `/tools`
  detail omit that same line; a one-line result adds no filler. Custom summaries, non-empty Tool-owned detail, and Raw
  remain unchanged. Compact mode neither precomputes nor caches a global Raw transcript. Tool-owned business results
  are never truncated or rewritten by this Capability.
- Grouping is a deterministic display projection. Session JSONL, model-visible messages, active Tool membership, and
  execution behavior remain unchanged, and groups are rebuilt after reload, restart/resume, tree navigation, and
  compaction. Control-only projection therefore cleans existing Sessions without rewriting their records.
- In-process `/resume` pre-binds exactly the active Suite-rendered built-ins before Pi reconstructs history and preserves
  Host-native PowerShell membership without adding a renderer. The first resumed frame therefore stays compact without
  reviving disabled tools; the complete active Tool order is preserved, and new calls are rebound to the target session's
  working directory, trust, and project settings.

## Performance verification

`bun run benchmark:tool-activity` reconstructs one 20,000-call cross-round-trip Activity Group, compares its median
runtime with the former adjacent-Exploration projection, verifies all members survive, and enforces both a 25 ms
maximum regression from that baseline and a conservative 250 ms absolute ceiling. It also measures 200 incremental
stream updates after that 20,000-call history and formatted expansion of 1,000 short results under a 250 ms ceiling.
The formatted benchmark also rejects Raw protocol headings. Streaming updates replan only the current
Narrative Boundary tail, while timer frames reconcile only the affected group; neither path rescans the full Session.

See `UPSTREAM.md` for source provenance and the local delta. The accepted interaction contract is recorded in the
repository ADR `docs/adr/0010-fold-continuous-retrieval-segments.md`. Its 2026-08-17 `/tools` readability update was
implemented on 2026-08-18, including lifecycle icons, `◆` sections, compact-keyboard paging, singleton detail,
formatted/Raw navigation, and the fixed wide split. Focused tests and the real PTY verifier cover the shipped Dialog,
including a Space page sequence and Tab pane switch sent through the real Host.
