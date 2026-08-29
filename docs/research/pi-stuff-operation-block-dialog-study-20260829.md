# Pi Stuff Operation Block and Tool Dialog Study

Status: working design record, not accepted behavior or implementation authority.

Snapshot date: 2026-08-29. The study records the current discussion and the supporting real-Host `/tools` Dialog
capture. No Tool execution, Session protocol, or shipped renderer behavior is changed by this document.

## Authority and conflict

Current behavior remains governed by `CONTEXT.md`, `DESIGN.md`, the Tool Display Module README, and ADR 0022.
ADR 0022 deliberately rejected a universal Claude-style `Tool(args)` plus child-status block and retained
Tool-specific standalone shapes. This study does **not** propose a universal card. It explores a bounded family of
Tool-specific blocks that share parent/child reading order only when the child is useful outcome evidence.

If this proposal is accepted, its relationship to ADR 0022 must be resolved before implementation. Until then:

- **Bash Operation Block** remains the only accepted Operation Block term and implementation.
- **Operation Block** below is working language for the proposed family.
- Research examples are evidence and design intent, not claims about current UI.

## Working language

**Operation Block**:
A display-only projection of one independent Tool Activity with a bounded operation identity and an indented child
outcome preview at the invocation's native Transcript position. Expansion reveals more Tool-owned evidence without
changing protocol events, Session history, or the Tool result.

**Bash Operation Block**:
The existing Bash specialization whose parent is the bounded command and whose child is bounded stdout/stderr and
terminal-state evidence.

Avoid these names:

- **Command Block**: incorrectly implies every operation is a shell or Host command.
- **Log Block**: describes only one possible child representation.
- **Tool Card**: conflicts with the flat, terminal-native visual language.
- **Universal Tool Block**: conflicts with Tool-specific ownership and ADR 0022.

The relationship under study is:

```text
Tool Activity
└─ Operation Block
   ├─ Bash Operation Block
   ├─ File Mutation Operation Block
   ├─ Background Output Operation Block
   ├─ MCP Invocation Operation Block
   └─ Code Mode Failure Operation Block
```

## Decision rule

Use an Operation Block only when all of these are true:

1. The invocation has a recognizable operation identity.
2. Its result contains concrete evidence that is more useful than a terminal word such as `done` or `applied`.
3. The evidence has a bounded compact preview and a useful expanded representation.
4. The block does not duplicate another visible authority such as Todo, Agent roster, Goal status, or media.

Keep the existing semantic shape when the Tool is retrieval aggregation, lifecycle control, communication,
structured/media output, or successful infrastructure that is intentionally silent.

## Complete Tool decision matrix

| # | Tool | Current compact authority | Operation Block decision |
| ---: | --- | --- | --- |
| 1 | `read` | Retrieval Group | Keep; grouped retrieval is more useful than independent blocks. |
| 2 | `write` | Independent `Write path · line count` row | Adopt a File Mutation Operation Block. |
| 3 | `edit` | Independent `Edit path · applied` row | Adopt a File Mutation Operation Block. |
| 4 | `grep` | Retrieval Group | Keep. |
| 5 | `find` | Retrieval Group | Keep. |
| 6 | `ls` | Retrieval Group | Keep. |
| 7 | `bash` | Bash Operation Block | Existing reference; keep. |
| 8 | `apply_patch` | Independent `Patch target · changed files` row | Adopt a File Mutation Operation Block. |
| 9 | `view_image` | Media projection | Keep. |
| 10 | `imagegen` | Media projection | Keep. |
| 11 | `goal_complete` | Goal lifecycle event | Keep. |
| 12 | `goal_blocked` | Goal lifecycle event | Keep. |
| 13 | `web_search` | Web retrieval row | Keep. |
| 14 | `fetch_content` | Web document row | Keep. |
| 15 | `get_search_content` | Web continuation row | Keep. |
| 16 | `mcp` | Independent semantic MCP row | Conditional: direct invocation with bounded multiline text/log evidence only. |
| 17 | `background` | Background Work lifecycle/management row | Conditional: `action: "output"` only. Keep `list` and `stop`. |
| 18 | `monitor` | Monitor lifecycle row | Keep; later completion is a different event boundary. |
| 19 | `subagent` | Agent lifecycle row and Agent-owned surfaces | Keep. |
| 20 | `TaskCreate` | Compact-silent; Todo is authority | Keep. |
| 21 | `TaskGet` | Compact-silent; Todo is authority | Keep. |
| 22 | `TaskList` | Compact-silent; Todo is authority | Keep. |
| 23 | `TaskUpdate` | Compact-silent; Todo is authority | Keep. |
| 24 | `ctx_expand` | Context semantic row | Keep. |
| 25 | `ctx_search` | Context semantic row | Keep. |
| 26 | `ctx_memory` | Context semantic row | Keep. |
| 27 | `ctx_note` | Context semantic row | Keep. |
| 28 | `ctx_reduce` | Successful call is compact-silent | Keep. |
| 29 | `subagent_supervisor` | Agent lifecycle/control row | Keep. |
| 30 | `intercom` | Agent communication row | Keep. |
| 31 | `contact_supervisor` | Agent communication row | Keep. |
| 32 | `structured_output` | Structured result authority | Keep. |
| 33 | `tool_search` | Successful call is Transcript-transparent | Keep. |
| 34 | `codemode` | Nested Tool/media authority; outer fallback on issue | Conditional: unmatched error, rejection, or cancellation only. |

Tool-name totals: one existing Operation Block (`bash`), three proposed unconditional consumers (`write`, `edit`,
`apply_patch`), three conditional consumers (`background`, `mcp`, `codemode`), and 27 Tool names that keep their
current semantic family.

## Proposed Transcript shapes

| Tool/state | Current compact shape | Proposed compact shape |
| --- | --- | --- |
| `bash` | `Bash(command)` with `⎿` output | Unchanged reference shape. |
| `write` | `Write path · N lines` | `Write(path)` with child `Created/Overwritten · N lines · bytes`. |
| `edit` | `Edit path · applied` | `Edit(path)` with child `Replaced N lines · +A/−B`; expanded detail owns the bounded diff. |
| `apply_patch` | `Patch target · changed N files` | `Patch(N files)` with child `+A/−B · paths`; expanded detail owns the bounded diff. |
| `background`, `output` | `Background task-id · read` | `Background(task-id)` with recent output child and an omitted-lines notice. |
| `mcp`, direct text invocation | `MCP target · done` | `MCP(server.tool)` with bounded argument identity and multiline result child. |
| `codemode`, unmatched issue | `Code Mode · <issue>` fallback row | `Code Mode(<bounded code identity>)` with error/rejection/cancellation child. |

## Current `/tools` Dialog contract

The shipped Dialog has two navigation modes (`list`, `detail`) and two detail representations (`formatted`, `raw`).
At wide widths it uses one fixed split Dialog; narrow mode moves between the same list and detail content.

Current list rows expose only the Tool Activity summary, state glyph, and optional call count. They do not retain the
Tool name, target, action subtype, or Operation Block subtype as first-class list data.

Current formatted detail shows:

```text
Tools / <activity summary>
<state icon> <complete state> · <call count>

◆ Result
<unlabelled target when available>
<Tool-owned formatted result>
```

For a singleton activity, Tool identity and target are not guaranteed in the Header. Tool/member rows appear only
when the activity has multiple calls. Raw representation remains the protocol inspection authority and includes call
ID, Tool name, arguments, result content, and details.

This creates the principal design gap: the Dialog cannot reliably project the proposed Operation Block family from
its first-level `ToolActivityView`, because that view currently lacks Tool name, target, action subtype, and block
subtype metadata.

## Captured current Dialog evidence

Evidence was replayed through real Pi 0.84.3 in a 120×50 PTY using stored Tool calls/results. No Tool executor was
invoked during replay. Each selected detail was captured in an isolated Host process. The formatted capture first had
to match its exact Header; switching to Raw then had to expose the exact fixture call ID. This prevents selection
state from leaking between captures.

| Candidate/state | Current list row | Current formatted detail | Current limitation relative to the proposal |
| --- | --- | --- | --- |
| `write`, success | `Write · 3 lines` | `Tools / Write · 3 lines`; target `config/generated.json`; `Successfully wrote 22 bytes…` under `◆ Result`. | The list and Header omit the path; the semantic change must be inferred from a prose result. |
| `edit`, success | `Edit · +1/-1` | `Tools / Edit · +1/-1`; target `src/worker.ts`; success prose under `◆ Result`. | The Header omits the path and formatted detail does not show the available diff. |
| `bash`, success | `Bash · done` | `Tools / Bash · done`; description `Tool Display tests`; four output lines under `◆ Result`. | The command identity is absent from list and Header, although the result itself is preserved. |
| `apply_patch`, success | `Patch · changed 2 files` | `Tools / Patch · changed 2 files`; target `src/a.ts +1`; both paths under `◆ Result`. | The file set is useful, but the available patch evidence is Raw-only. |
| `background`, `output` success | `Background · read` | `Tools / Background · read`; task `bg-build-42`; four recent lines under `◆ Result`. | Neither list nor Header says `output` or identifies the task. |
| `mcp`, direct success | `MCP · done` | `Tools / MCP · done`; target `repo:repo.build`; three returned lines under `◆ Result`. | Target and operation identity are missing from list and Header. |
| `mcp`, direct error | `MCP · failed` | `Tools / MCP · failed`; `× error`; target `repo:repo.build`; complete error under `◆ Result`. | The target is missing from list and Header. |
| `mcp`, rejected | `MCP · failed` | `Tools / MCP · failed`; `! warning`; target `repo:repo.deploy`; blocked message under `◆ Result`. | Rejection is labelled `failed` and is indistinguishable from cancellation in the list. |
| `mcp`, cancelled | `MCP · failed` | `Tools / MCP · failed`; `! warning`; target `repo:repo.watch`; cancellation message under `◆ Result`. | Cancellation is labelled `failed` and is indistinguishable from rejection in the list. |
| `codemode`, error | `Code Mode · Code Mode failed: atlas failure` | The same issue is repeated in the Header; `× error`; `◆ Result` is empty. | The actionable issue is in chrome rather than the result body, and the code identity is absent. |
| `codemode`, rejected | `Code Mode · Tool execution was blocked by the user` | The same issue is repeated in the Header; `! warning`; `◆ Result` is empty. | Same gap; rejection has no dedicated formatted section. |
| `codemode`, cancelled | `Code Mode · Code Mode execution was cancelled` | The same issue is repeated in the Header; `! warning`; `◆ Result` is empty. | Same gap; cancellation has no dedicated formatted section. |
| successful `codemode` with nested `read` | `Read 1 file` | `Tools / Read 1 file`; target `nested.txt`; nested result under `◆ Result`. | No gap: the successful outer Code Mode envelope is absent and the nested Tool remains the sole authority. |

Raw presentation was captured for every row. It consistently exposes `Call ID`, `Tool name`, `Arguments`, `Result
content`, and `Details`; long payloads page vertically. The successful Code Mode route resolves to Raw call ID
`dialog-code-success-read` and Tool name `read`, confirming that the nested operation, not the outer envelope, owns
inspection.

These captures establish four concrete Dialog gaps for this proposal:

1. List and detail Header summaries discard target/action identity for singleton activities.
2. MCP rejection and cancellation collapse to the same `failed` summary despite warning state.
3. Code Mode issue text is placed in the list/Header while formatted `◆ Result` is empty.
4. Raw is complete but protocol-oriented; it is not a substitute for Tool-specific formatted evidence.

## Proposed `/tools` Dialog grammar

Operation Blocks remain a Transcript projection. The Dialog should not draw `⎿` connectors or reproduce the compact
block. It should inspect the same activity using Tool-specific semantic sections.

### List pane

Each candidate list row should preserve identity before outcome:

```text
› <Tool label> <target> · <semantic outcome> <state icon>
```

At narrow widths, remove counts and target fragments before truncating Tool identity and the actionable outcome.

### Formatted detail pane

| Candidate | Header | Tool-specific sections |
| --- | --- | --- |
| `bash` | `Tools / Bash · <description or bounded command>` | `◆ Command`, `◆ Output`, terminal state and omitted-output notice. |
| `write` | `Tools / Write · <path>` | `◆ Change`: created/overwritten, lines, bytes. Content remains Raw unless a future bounded preview has a demonstrated use. |
| `edit` | `Tools / Edit · <path>` | `◆ Change`: replacement summary; `◆ Diff`: bounded Tool-owned diff. |
| `apply_patch` | `Tools / Patch · <path or N files>` | `◆ Files`: created/changed/moved/deleted; `◆ Diff`: bounded patch evidence; fuzz warning when present. |
| `background`, `output` | `Tools / Background output · <task-id>` | `◆ Background`: task identity/status; `◆ Output`: recent bounded output and omitted byte/line evidence. |
| `mcp`, direct text invocation | `Tools / MCP · <server.tool>` | `◆ Invocation`: bounded meaningful arguments; `◆ Result`: bounded returned text/log. Structured/media results retain their owning representation. |
| `codemode`, unmatched issue | `Tools / Code Mode · <bounded code identity>` | `◆ Code`: bounded identity only; `◆ Error`, `◆ Rejection`, or `◆ Cancellation` with the complete actionable issue. Nested successful activities remain sole authority. |

### Raw detail

Raw remains unchanged and continues to expose protocol-level call ID, Tool name, complete arguments, result content,
and details. Proposed formatted sections must not copy protocol fields merely to fill space.

## Evidence backlog

The wide current-state evidence is complete for the candidate set. Remaining evidence should wait until the proposal
has accepted authority and concrete formatters:

1. Capture narrow and low-height geometry for the implemented content, including truncation and paging.
2. Exercise bounded-output omission notices for Bash, Background output, and MCP text results.
3. Capture Tool-owned Edit and Patch diffs after their formatted sections exist.
4. Re-run the same isolated selection/Raw-ID checks after implementation.

Use deterministic stored Tool results with the certified real Pi Host. Do not invoke file, shell, network, Goal,
Agent, background, or MCP effects merely to obtain UI evidence.
