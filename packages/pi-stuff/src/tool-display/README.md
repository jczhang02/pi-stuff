# Tool Display module

Compact, presentation-only Tool UI for the Pi Stuff Suite.

The Capability re-registers seven Pi 0.84.4 built-in Tools with their original definitions and replaces only their
render slots. Tool schemas, prompt metadata, execution, result content, lifecycle events, and permission checks stay
unchanged. Pi 0.84.4's PowerShell Tool remains entirely Host-rendered; Pi Stuff recognizes its `powershell` name only
for reload/resume membership. Every Suite-owned Tool must declare Activity metadata through `registerSuiteOwnedTool`;
unknown third-party Tools keep their native renderer and form a display boundary.
`registration.ts` owns Suite Tool decoration, Activity coverage, and historical replay binding;
`index.ts` owns the ordered Host-event projection lifecycle; `registration-tracker.ts` owns Tool registry and active
surface projection;
`envelope-projection.ts` owns nested Tool decoding and ordinary-protocol projection; `group-projection.ts` owns
transcript grouping and result association; `activity-presentation.ts` owns live row reconciliation, while
`activity-query-projection.ts` owns summaries and Tool detail. `operation-block-presentation.ts` dispatches the closed
Operation Block family; `operation-block-evidence.ts` owns its bounded result boundary;
`file-operation-presentation.ts`, `operation-block-diff.ts`, and `background-operation-presentation.ts` own file
mutation evidence, diff normalization, and Background output respectively; and `operation-block-renderer.ts` owns the
Transcript grammar. `formatted-detail.ts` owns the complete semantic `/tools` map, while
`operation-block-formatted-detail.ts` adapts Operation Block evidence into Dialog sections;
`registered-tool-renderer.ts` owns row/detail publication; and `activity-clock.ts` owns running markers. `ToolUiRuntime`
remains the single public live-projection facade.
`activity-model.ts` owns Activity vocabulary, `activity.ts` preserves the public facade and Bash classification,
`retrieval-groups.ts` plans transcript membership, and `activity-summary-format.ts` owns pure summary wording.

## Daily use

- Every continuous native Read, Grep/Find, or List segment is one **Retrieval Group**, beginning with the first eligible
  invocation, except a Read whose resolved basename is exactly `SKILL.md`. The remaining eligibility set is closed:
  Bash, Web, MCP, media, mutations, Agent, Task, Background Work, Goal, unknown, and third-party Tools are independent
  Tool Activities and close retrieval.
- An exact resolved `SKILL.md` Read is one independent `Skill <name>` Tool Activity, with the name derived from its
  resolved parent directory. `Skill <name>` is the high-contrast primary identity; the normal semantic Tool marker and
  state style distinguish reading, loaded, and failure while settled `loaded` remains muted. It is one row rather than
  native `[skill]` or Operation Block grammar. Direct Read, nested Code Mode projection, and replay use the same
  identity; `/tools` Formatted preserves the Skill identity while Raw preserves the underlying Read protocol.
- A compact generic Tool Activity reserves identity and useful summary/state before its optional target. The target
  receives the actual remaining terminal-cell budget: whenever another meaningful complete grapheme fits with the
  ellipsis, it is shown rather than suppressed by a fixed minimum width or whole-token threshold. Latin text may end
  mid-token; at most one cell may remain when the next grapheme is double-width and cannot fit exactly. This adds no
  padding and does not replace the distinct Retrieval Group, Operation Block, or Agent Lifecycle fitting rules.
- Assistant prose, user input, visible model-context Custom Messages, turn completion, automatic continuation, and a
  newly visible Logical Thinking Run after Tool activity close the current Retrieval Group. Streaming updates within
  the same Logical Thinking Run, Tool results, hidden state, and branch or compaction metadata do not.
- A successful settled or active Retrieval Group occupies exactly one physical row. Search, Read, and List clauses use
  that fixed order; Read counts unique canonical paths while Search and List count invocations. Active rows use present
  tense, omit the expansion hint, and may add enabled elapsed time and a stabilized target inline. Narrow widths drop
  target, then elapsed time, before truncating the semantic summary. Settled rows omit targets and elapsed time and show
  `(ctrl+o to expand)` only when it fits without wrapping. User-visible counts use grammatical number, including
  `1 line` rather than `1 lines`.
- Failed, rejected, and cancelled native retrieval stays in its Retrieval Group. The only two-row compact exception
  keeps state-specific issue counts on the first row and the first bounded reason on one child row; remaining reasons
  stay available through expansion.
- Operation Block is a closed Transcript family: Bash, Write, Edit, Patch, `background` only for `action=output`, and
  an outer Code Mode error, rejection, or cancellation that no nested Tool or media projection represents. Its exact
  grammar is `Tool(operation identity)` followed by `⎿ outcome evidence`; parentheses are required. Other Tools cannot
  opt in through metadata.
- Every Bash invocation remains one standalone `Bash(<command>)` Operation Block in source order, including read-only
  commands. Its command uses a two-line/160-code-unit compact cap, output shows three lines before a bounded omission
  notice, and running, empty, stderr, exit, cancellation, rejection, and failure states remain explicit. A later empty
  Host abort record settles only the immediately preceding in-flight direct Bash call as cancelled, preserves partial
  output, and suppresses a second fallback error; exit code 128 alone remains an error.
- `Write(path)` shows `N lines written` and the syntax-highlighted final content, not a diff. Compact mode shows ten
  lines and `… +N lines (ctrl+o to expand)`; expanded evidence is capped at 240 lines and 24 KiB. `Edit(path)` shows
  exact `+A/-D` statistics and a syntax-highlighted old/new-line diff. `Patch(path)` or `Patch(N files)` shows total and
  per-file `M/A/D/R` statistics plus bounded changed-line evidence; a pure rename says
  `renamed without content changes`. Available evidence replaces generic success prose.
- The `subagent` Tool uses an Agent Lifecycle Row, not an Operation Block. Foreground rows identify the Agent, Task,
  terminal state, and useful duration; expansion shows each member and bounded foreground result evidence. A background
  launch and its later model-invisible completion row remain separate chronological events, while `/agents` remains the
  live control and full-evidence authority.
- Task, `tool_search`, and `ctx_reduce` calls stay absent from the compact Transcript from invocation through success;
  Todo owns Task state, while the two infrastructure calls remain transparent to retrieval. All remain inspectable
  through `Ctrl+O` and `/tools`; an error, rejection, or cancellation becomes an independent Tool Activity and closes
  retrieval on both sides.
- Pi's global `Ctrl+O` restores eligible calls, existing Tool-specific renderers, successful Task and infrastructure
  calls, and Logical Thinking Runs in persisted source order. `/tools [group-or-member-id]` keeps Tool Activity as its
  first-level unit: List rows expose Tool identity, bounded operation identity, optional verified non-state evidence,
  and explicit icon-and-word state, omitting generic outcomes that merely restate that state. A Retrieval Group exposes
  ordered `Calls`, while independent activity remains a singleton. Detail uses Tool-specific semantic sections such as
  Command/Output, Change/Diff, Files/Diff, Task/Result, Invocation/Result, or Code/Error. Image blocks use Pi's native
  image component when available. Up/Down selects members, PageUp/PageDown scrolls, Home/End jumps, `r` toggles
  Formatted and Raw, and Escape unwinds the Dialog.
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
- Formatted and Raw detail text is capped at 240 lines and 24 KiB per selected call. Formatted is the readable semantic
  view; Raw remains the complete bounded protocol inspection authority with call ID, Tool name, arguments, result
  content, and details. Operation Blocks do not copy the Transcript `⎿` grammar into the Dialog. Compact mode neither
  precomputes nor caches a global Raw transcript, and Tool-owned business results are never rewritten by this
  Capability.
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

See `UPSTREAM.md` for source provenance and the local delta. ADR 0022 owns Retrieval Group membership, while ADR 0023
owns the closed Operation Block family and distinct Agent Lifecycle Rows. Formatted/Raw navigation, semantic headings
without icons, compact-keyboard paging, singleton detail, and the fixed wide split are covered by focused tests and
the real PTY verifier.
