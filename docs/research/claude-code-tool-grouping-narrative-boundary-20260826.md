# Claude Code Tool Grouping and Narrative Boundaries

- **Date:** 2026-08-26
- **Product context:** Pi Stuff Tool presentation
- **Primary specimen:** official Claude Code 2.1.220 Linux x64 binary
- **Question:** how Claude Code and Pi Stuff group every Pi Stuff root Tool with an honest Claude counterpart, including
MCP, and why Thinking sometimes updates one row but sometimes creates another

## Answer

Claude Code 2.1.220 and Pi Stuff agree on the central rule: non-empty visible Assistant prose, a user turn, or a
standalone consequential Tool closes eligible retrieval folding; an Assistant API-response boundary does not.
Thinking and whitespace-only Assistant text remain transparent. This stays true even when two distinct Thinking rows
appear around retrieval calls.

This does **not** mean that Claude Code groups every Tool between those boundaries. Successful Edit, Write, ordinary
Bash, WebSearch, WebFetch, Agent, and background lifecycle operations each remain standalone. Two consecutive calls
of each family also remain independent. The exhaustive mapped sweep found two important default-projection
differences:

- Claude folds direct MCP calls into the same compact activity as Read, while Pi Stuff's `mcp` gateway calls remain
  standalone and split retrieval;
- Claude treats image reads as ordinary Read calls, while Pi Stuff's `view_image` calls remain standalone and split
  retrieval.

Task operations use a separate task surface in both clients. Claude hides their invocation rows even in the detailed
transcript, while Pi Stuff restores them only when Tool output is expanded. In both clients they split Read groups.

Therefore:

- "continuous eligible retrieval between narrative boundaries" matches the observed default behavior;
- "all Suite-owned Tool activity between narrative boundaries" would be a Pi Stuff product decision, not a copy of
  Claude Code's default transcript;
- making a new logical Thinking run a boundary would also be a deliberate Pi Stuff divergence, not Claude parity;
- Claude Code's optional `/focus` view is the closer official reference for a single summary spanning broader Tool
  work.

## Provenance

### Claude Code

- Binary: `~/.local/share/claude/versions/2.1.220`
- Reported version: `2.1.220 (Claude Code)`
- SHA-256: `674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863`

### Pi

- Binary: official `v0.84.3` Linux x64 release executable downloaded from the upstream GitHub release
- Reported version: `0.84.3`
- Size: `104,487,040` bytes
- SHA-256: `ca858fde375ab91531353b22fac6ebdf29c0a153efe754f5f9b8a72a7423ed08`
- Package under test: the repository-local `packages/pi-stuff` Extension loaded by that Host

The Pi identity exactly matches [`docs/compatibility.md`](../compatibility.md). An earlier exploratory capture used the
machine's `/opt/pi-coding-agent/pi`, which also reported `0.84.3` but had a different build hash; the final Pi matrix
below was rerun from scratch with the certified release executable.

### Shared protocol

- PTY geometry: `100x38`, one fresh tmux session per probe
- Isolation: fresh HOME or Pi config, XDG directories, project, Session store, and tmux server
- Transport: deterministic local provider fixtures; Claude used an Anthropic-compatible localhost SSE endpoint and Pi
  used a real registered Provider Extension
- Network: baseline probes pointed external HTTP(S) proxies to a closed localhost port; the WebSearch follow-up left
  the client network path available; WebFetch/`fetch_content` used real public HTTP responses
- Telemetry, updater, error reporting, terminal title, and nonessential traffic: disabled
- Permissions: Claude `dontAsk` with only the probed Tools allowed; Pi ran in its explicit approval mode inside an
  isolated project
- Fixture role: fixtures supplied deterministic Assistant content blocks only; the released clients owned Tool
  execution, lifecycle, grouping, rendering, compact projection, and detailed expansion

The removed Claude harness followed an isolated safe-mode and localhost-SSE pattern. It did not access a Claude
account, an external model, repository credentials, or the user's Claude configuration. Git history retains the
capture implementation.

## Probe matrix

Paths below are normalized to `<project>`; the released binary saw distinct absolute paths in each isolated project.

| Probe | Synthetic Assistant sequence | Settled compact projection | Determination |
| --- | --- | --- | --- |
| Same response | `Read(a) + Read(b)` in one Tool-use response | `Read 2 files` | Parallel calls share one group. |
| Cross response | `Read(a)` → result → next Assistant response `Read(b)` | `Read 2 files` | An Assistant API round trip is not a boundary. |
| Visible prose | `Read(a)` → result → `VISIBLE_PROSE_BOUNDARY + Read(b)` | `Read 1 file` → prose → `Read 1 file` | Non-empty visible Assistant prose is a hard boundary. |
| Thinking | `Read(a)` → result → Thinking + `Read(b)` | `Thought for 1s, read 2 files` | Thinking remains inside the same compact activity. |
| Whitespace text | `Read(a)` → result → whitespace-only text + `Read(b)` | `Read 2 files` | A text block alone is insufficient; visible content matters. |
| Ordinary Bash | `Read(a)` → `Bash(true)` → `Read(b)` | `Read 1 file` → `Bash(true)` → `Read 1 file` | Ordinary Bash is standalone and splits retrieval. |
| Successful Edit | `Read(edit.txt)` → `Edit(edit.txt)` → `Read(b)` | `Read 1 file` → `Update(edit.txt)` → `Read 1 file` | Consequential file mutation is standalone and splits retrieval. |
| Parallel WebSearch | `WebSearch(q1) + WebSearch(q2)` in one Tool-use response | two independent `Web Search(...)` blocks | Same-response WebSearch calls do not merge. |
| Cross-response WebSearch | `WebSearch(q1)` → result → next response `WebSearch(q2)` | two independent `Web Search(...)` blocks | An API round trip does not cause WebSearch aggregation. |
| Read/WebSearch/Read | `Read(a)` → `WebSearch(q)` → `Read(b)` | `Read 1 file` → `Web Search(...)` → `Read 1 file` | WebSearch splits adjacent retrieval. |
| New user turn | turn 1 `Read(a)`; turn 2 `Read(b)` | two separate `Read 1 file` rows | Turn completion and the next user input close the prior group. |

Each compact retrieval row retained `(ctrl+o to expand)`.

## Exhaustive mapped-Tool sweep

The Suite declares 23 root Tool names. Eighteen have an honest exact or semantic counterpart in the captured Claude
Code surface, and every one of those 18 was executed through both real clients. The remaining five root Tools, all
five deferred Context Tools, all four conditional Agent-channel Tools, and the provider-facing Code Mode envelope have
no honest counterpart in this Claude surface; they are recorded separately instead of being forced into misleading
tests.

The official Claude client received this active Tool surface from the fixture requests:

```text
Agent, Bash, Edit, Glob, Grep, Read,
TaskCreate, TaskGet, TaskList, TaskOutput, TaskStop, TaskUpdate,
WebFetch, WebSearch, Write, mcp__local__echo
```

The certified Pi Host received and executed these 18 Suite root Tools:

```text
read, grep, find, ls, bash, write, edit, apply_patch, view_image,
web_search, fetch_content, mcp, background, subagent,
TaskCreate, TaskGet, TaskList, TaskUpdate
```

### Result matrix

Each ordinary family was called twice between `Read(a)` and `Read(b)`. "Split" means the surrounding Reads remained
two compact retrieval rows; "joined" means the calls participated in one compact activity.

| Pi Stuff root Tool | Claude counterpart used | Claude Code 2.1.220 | Pi Stuff on Pi 0.84.3 | Comparison |
| --- | --- | --- | --- | --- |
| `read` | `Read` | Joins eligible retrieval. | Joins eligible retrieval. | Match. |
| `grep` | `Grep` | Joins the same retrieval row. | Joins the same retrieval row. | Match. |
| `find` | `Glob` file pattern | Joins retrieval. | Joins retrieval. | Match; many-to-one mapping. |
| `ls` | `Glob` directory pattern | Joins retrieval. | Joins retrieval. | Match; many-to-one mapping. |
| `bash` | `Bash` | Both calls standalone; split. | Both calls standalone; split. | Match. |
| `write` | `Write` | Both calls standalone; split. | Both calls standalone; split. | Match. |
| `edit` | `Edit` | Both calls render as `Update`; split. | Both calls render as `Edit`; split. | Same grouping, client-native labels. |
| `apply_patch` | `Edit` | Standalone `Update`; split. | Both Patch calls standalone; split. | Same semantics/grouping; many-to-one mapping. |
| `web_search` | `WebSearch` | Both calls standalone; split. | Both calls standalone; split. | Match. |
| `fetch_content` | `WebFetch` | Both calls standalone; split. | Both calls standalone; split. | Match. |
| `subagent` | foreground `Agent` | Both child runs standalone; split. | Both child runs standalone; split. | Match. |
| `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate` | same four Tools | No invocation rows in compact or detailed transcript; task panel updates; split. | Hidden compact; invocation rows restored on expansion; task panel updates; split. | Compact match; detailed transcript differs. |
| `mcp` invocation | direct `mcp__local__echo` | `Read 2 files, called local 2 times`; joined. | Two standalone `MCP local:local_echo` rows; split. | Mismatch. |
| `view_image` | `Read` on PNG | Text and image reads become `Read 4 files`; joined. | Two standalone `View … · loaded` rows; split. | Mismatch. |
| background `bash` + `background` output/stop | background `Bash` + `TaskOutput` + `TaskStop` | Start, output, and stop each standalone; split. | Start, output, and stop each standalone; split. | Semantic match; labels differ. |

The retrieval control was `Read → Grep → Glob → Glob → Read`. Claude rendered `Searched for 3 patterns, read 2 files`;
Pi rendered `Searched 2 patterns, read 2 files, listed 1 directory`. This confirms equivalent folding with different
semantic accounting for Pi's distinct `find` and `ls` operations.

The MCP fixture was a real stdio server, not a fabricated Tool result. Both clients started it and its independent log
recorded exactly:

```text
call:MCP_PARITY_ONE
call:MCP_PARITY_TWO
```

Claude's expanded transcript restored `Read → local - echo (MCP) → local - echo (MCP) → Read` in source order, while
its compact projection combined all four calls. Pi's MCP gateway also executed both calls, but its compact projection
kept both calls standalone. The evidence supports a grouping difference for successful direct invocation. It does not
justify folding Pi's other `mcp` gateway operations such as discovery, connection, instructions, or authentication.

Pi also cannot currently reproduce Claude's direct-MCP policy safely by assuming every invocation is retrieval. The
MCP server normalizer retains name, title, description, input schema, and `_meta`, but not the protocol's standard Tool
annotations; the later `ToolMetadata` and cache shapes narrow that further. In particular, a trustworthy
`readOnlyHint`/`destructiveHint` is unavailable at the Tool Activity grouping seam. Until that metadata is propagated,
"fold every successful MCP invocation" would also fold unknown mutating operations. See
[`mcp/runtime/server-manager.ts`](../../packages/pi-stuff/src/mcp/runtime/server-manager.ts),
[`mcp/runtime/types.ts`](../../packages/pi-stuff/src/mcp/runtime/types.ts), and
[`mcp/runtime/metadata-cache.ts`](../../packages/pi-stuff/src/mcp/runtime/metadata-cache.ts).

Both foreground Agent pairs completed through real child processes. Both background probes started a real `sleep`
process, read its output non-blockingly, and stopped it. Both image probes decoded real PNGs. Claude WebFetch and Pi
`fetch_content` received successful HTTP responses. Pi `web_search` returned five sources for each query; the isolated
Claude WebSearch path completed as `Did 0 searches`, so its grouping is established but positive-result decoration is
not.

### Root Tools without a Claude counterpart

These Suite root Tools were not executed because the captured official Claude surface had no semantically equivalent
Tool:

| Pi Stuff Tool | Why it is not paired |
| --- | --- |
| `imagegen` | No image-generation Tool in the captured Claude surface. Reading an image is not generation. |
| `goal_complete`, `goal_blocked` | Pi Goal terminal-policy controls, not ordinary Task status operations. |
| `get_search_content` | Retrieval from Pi's Session-persisted search/fetch artifact; Claude WebFetch is the producer, not this continuation interface. |
| `monitor` | Waits for arbitrary command, file, log, or HTTP conditions. A timer wake-up, where available, is not equivalent. |

The same exclusion applies to deferred `ctx_expand`, `ctx_search`, `ctx_memory`, `ctx_note`, and `ctx_reduce`; optional
`subagent_supervisor`, `intercom`, `contact_supervisor`, and `structured_output`; and Code Mode's `codemode`,
`tool_search`, and in-sandbox discovery helpers. They are Pi lifecycle, context, coordination, or infrastructure
interfaces rather than missed Claude grouping probes.

## Exact normalized observations

### Same response and cross response

Both controls produced the same compact row:

```text
Read 2 files (ctrl+o to expand)
```

This rules out grouping by Assistant API response.

### Visible prose

```text
Read 1 file (ctrl+o to expand)

VISIBLE_PROSE_BOUNDARY

Read 1 file (ctrl+o to expand)
```

The prose and second Read were emitted in the same Assistant response. The split therefore comes from the visible text,
not from a response transition.

### Thinking

Compact:

```text
Thought for 1s, read 2 files (ctrl+o to expand)
```

Expanded with `Ctrl+O`:

```text
Read(<project>/a.txt)
  Read 2 lines

THINKING_BRIDGE_MARKER

Read(<project>/b.txt)
  Read 2 lines
```

This converts the former reconstructed-source inference into black-box evidence for 2.1.220: Thinking does not split
retrieval, but it is not merely ignored either; it contributes a semantic clause to the compact activity.

### Whitespace-only Assistant text

```text
Read 2 files (ctrl+o to expand)
```

The intervening text block contained spaces and a newline. It rendered no prose and did not split the group.

### Ordinary Bash

```text
Read 1 file (ctrl+o to expand)

Bash(true)
  (No output)

Read 1 file (ctrl+o to expand)
```

`Ctrl+O` restored `Read(a)`, `Bash(true)`, and `Read(b)` as three calls in source order.

### Successful Edit

```text
Read 1 file (ctrl+o to expand)

Update(edit.txt)
  Added 1 line, removed 1 line
  1 -alpha
  1 +ALPHA

Read 1 file (ctrl+o to expand)
```

The Edit succeeded in the official binary. It remained standalone and split the adjacent Reads.

### WebSearch

Two WebSearch calls emitted in one Assistant response rendered independently:

```text
Web Search("OpenAI official site")
  Did 0 searches

Web Search("Anthropic official site")
  Did 0 searches
```

Emitting the same calls across two Assistant responses produced the same two-block projection. A mixed probe rendered:

```text
Read 1 file (ctrl+o to expand)

Web Search("Anthropic official site")
  Did 0 searches

Read 1 file (ctrl+o to expand)
```

The isolated client completed each invocation without an error marker but reported zero backend searches. This is
direct evidence for the released client's grouping projection under that result; it is not evidence about positive
search-result rendering.

### User-turn boundary

```text
> first user prompt

Read 1 file (ctrl+o to expand)

PROBE_TURN_ONE_DONE

> second user prompt

Read 1 file (ctrl+o to expand)
```

The two Reads did not become `Read 2 files` across turns.

## `Ctrl+O` verification

For every probe, the detailed transcript restored each underlying Tool invocation at its original source position.
The cross-response control restored two independent Read calls despite the compact projection containing one row.
The Thinking probe restored the Thinking block between the two Reads. The Bash and Edit probes retained their
standalone operation between the two Reads.

This agrees with Anthropic's official description of `Ctrl+O` as the detailed transcript viewer that shows detailed
Tool usage and execution: [Interactive mode](https://code.claude.com/docs/en/interactive-mode#transcript-viewer).

## Why Thinking sometimes replaces one row and sometimes creates another

Three identities must not be conflated:

- a **physical terminal row** is a layout artifact and can change because of wrapping, width, resize, or redraw;
- a **Thinking content block** is a provider-stream item identified only within one Assistant message;
- a **logical Thinking run** is a maximal adjacent sequence of Thinking blocks within one Assistant message, as
  rendered by the Host.

Pi 0.84.3 rebuilds one Assistant-message component as streaming content changes. Within it, the Host coalesces adjacent
Thinking blocks into one Markdown section. Pi Stuff's display-only transformer receives only that Markdown, not the
provider's content index, and projects its latest meaningful semantic block. Consequently:

- deltas for the current Thinking run update the same component and replace its visible content in place;
- two adjacent Thinking blocks are joined by the Host, and Pi Stuff keeps only their latest meaningful block;
- a Thinking block separated from the previous one by a Tool call or other content creates another logical run and
  therefore another visible Thinking component;
- a Thinking block in a later Assistant message also creates another component.

The Pi Stuff seam is [`conversation-ui/live-thought.ts`](../../packages/pi-stuff/src/conversation-ui/live-thought.ts),
registered from [`conversation-ui/index.ts`](../../packages/pi-stuff/src/conversation-ui/index.ts); its intended
display-only contract is documented in the owning
[`conversation-ui/README.md`](../../packages/pi-stuff/src/conversation-ui/README.md).

The live-stream capture changed one Pi row from:

```text
∗ thoughts: STREAM_PHASE_ONE
```

to:

```text
∗ thoughts: STREAM_PHASE_ONE STREAM_PHASE_TWO
```

with no additional Thinking component. Claude likewise updated its active Thinking spinner in place before settling
it to one elapsed-time summary.

### Boundary probes

| Valid Assistant sequence | Pi Stuff compact result | Claude compact result | Detailed result |
| --- | --- | --- | --- |
| `Read(a)` → next response `Thinking` + `Read(b)` | one `Read 2 files` row plus the visible thought | `Thought for 1s, read 2 files` | Thinking restored between Reads. |
| Same message `Read(a)` + `Thinking` + `Read(b)` | one `Read 2 files` row | `Read 2 files` | Thinking restored between Reads. |
| Adjacent `Thinking 1` + `Thinking 2` + Reads | only Pi's second semantic thought; one Read group | one Thought/Read group | Claude shows two detailed thoughts; Pi Host coalesces the run. |
| Same message `Thinking 1` + `Read(a)` + `Thinking 2` + `Read(b)` | two Thinking rows and one `Read 2 files` row | one `Thought for 1s, read 2 files` row | Both clients restore two Thinking rows around the Reads. |
| Two Assistant rounds, each `Thinking` + `Read` | two Thinking rows and one `Read 2 files` row | one `Thought for 1s, read 2 files` row | Both clients restore the two runs in source order. |

The decisive counterexample is the fourth row: **a newly visible Thinking row is not a grouping boundary in either
current Pi Stuff or Claude Code 2.1.220**. Claude even collapses two detailed Thinking rows into one compact activity.

If Pi Stuff deliberately changes that policy, the stable event is not "a new terminal line." It is "a new
non-contiguous logical Thinking run begins after Tool activity." That event could close only the current Tool Activity
Group without redefining all Thinking as visible Assistant narrative. Doing so would nevertheless diverge from Claude
and from the accepted transparent-Thinking contract in ADR 0010.

## Why successful Code Mode envelopes can still create rows

Code Mode is an execution envelope around nested Tools. Nested operations keep their ordinary Tool rows and are the
visible authority for their own work. The outer envelope uses a fallback only when no decoded nested operation owns
the result, or when an unmatched outer failure must remain visible.

Current successful-envelope suppression is intentionally narrow:

- an empty/no-output success is hidden;
- a program classified as strictly control-only is hidden;
- the classifier accepts one zero-argument `await yield_control()`, optionally followed by one literal `text(...)`,
  including the narrow supported arrow-function wrappers;
- dynamic text, yield arguments, repeated yields, any extra statement, and parse/decode failures are ambiguous and
  therefore keep the outer `Code Mode …` fallback visible;
- a nested issue owns its issue row and suppresses a duplicate outer issue, while an unmatched outer error remains
  visible.

The classifier lives in
[`code-mode/cloudflare/normalize.ts`](../../packages/pi-stuff/src/code-mode/cloudflare/normalize.ts), the visibility
decision in [`code-mode/extension.ts`](../../packages/pi-stuff/src/code-mode/extension.ts), and the shared nested/outer
authority seam in [`tool-display/contract.ts`](../../packages/pi-stuff/src/tool-display/contract.ts).

This is why apparently harmless Code Mode programs can still produce repeated outer rows: the current policy prefers
total rendering for any success that cannot be proven to be control-only by the strict syntax classifier. Removing
those rows is not a grouping problem. It is a separate visibility decision about whether a successful outer envelope
may be silent even when it produced meaningful pure-JavaScript text with no nested Tool row.

The focused Code Mode unit suite passed all four tests and 44 expectations. The existing real-Code-Mode acceptance
script did not reach its projection assertions because its request verifier rejected an additional provider request
whose Tool list was empty; that unrelated harness assumption means this note does not claim a fresh real-Host Code
Mode certification from that script.

## Product implication for Pi Stuff

The empirically supported Claude-style default rule is:

> Accumulate Claude's fold-eligible activity across Assistant API round trips until non-empty visible Assistant prose,
> a standalone Tool family, user input, or turn completion closes it. Thinking and invisible text do not close it.

In 2.1.220, that fold-eligible activity includes Read/Grep/Glob and direct MCP calls; image reads inherit Read
eligibility. Pi Stuff currently limits eligibility to its retrieval taxonomy and keeps MCP and `view_image` standalone.
Thus "Claude style" is not one universal Narrative-Boundary algorithm: it also depends on client-specific Tool-family
classification.

That is materially narrower than the proposed "one complete work group between Narrative Boundaries" design. If Pi
Stuff groups Edit, Write, ordinary Bash, WebSearch, Agent, Goal, and other consequential Tools into that row, it should
record the choice as a deliberate density-oriented deviation. Keeping WebSearch as a boundary matches the observed
Claude Code default. Making later logical Thinking runs close the current group would be another explicit deviation.

Claude Code does expose a more aggressive projection separately: `/focus` shows the last prompt, one-line Tool-call
summary with edit diffstats, and final response. See
[Fullscreen rendering](https://code.claude.com/docs/en/fullscreen#search-and-review-the-conversation). This is a useful
reference for the proposed Pi Stuff density, but it is not Claude Code's default grouping rule.

## Evidence limits

- The Claude facts are pinned to official Claude Code 2.1.220; the Pi facts are pinned to the repository-certified Pi
  0.84.3 release binary and the current working-tree Pi Stuff source. They do not claim unchanged behavior in later
  releases.
- The fixtures determined valid Assistant blocks, so they do not demonstrate what a live model would choose to emit.
  They do demonstrate how the released clients execute, group, and render those blocks and real Tool results.
- Every Suite root Tool with an honest counterpart in the captured Claude surface was exercised on its successful
  path. The explicitly unpaired Goal, Context, Monitor, image-generation, stored-Web-artifact, Agent-channel, and Code
  Mode interfaces were not fabricated into false equivalents.
- The sweep did not attempt a complete failure, cancellation, permission, attachment, or Custom Message matrix. Those
  states can add visible rows and should be separately certified before changing their boundary policy.
- WebSearch returned `Did 0 searches` with the isolated dummy-auth setup. The test establishes its independent Tool UI
  and retrieval-boundary behavior for that settled result, but it does not establish whether a positive-result call
  has additional presentation details.
- The focused Code Mode unit suite passed, but the repository's real-Code-Mode acceptance script failed in its fixture
  request verifier before the relevant assertions. Code Mode conclusions here therefore combine source inspection,
  focused unit evidence, and the user's observed surface rather than a newly passing end-to-end certification.
- Raw transient captures contained isolated temporary paths and were intentionally not committed. The normalized
  visible cells needed for each determination are reproduced above.
