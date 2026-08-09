# Claude Code 2.1.220 tool folding rules

**Date:** 2026-08-06
**Product context:** Pi Stuff Tool presentation
**Primary specimen:** official Claude Code 2.1.220 Linux x64 binary
**Question:** what Claude Code folds, where a group begins and ends, how it behaves while active and after settlement, and what detail remains recoverable

## Short answer

Claude Code's ordinary tool folding is not simply “same tool name repeated in one assistant message.” Its default read/search projection is a **semantic, turn-segment accumulator**:

- one operation is enough to create a folded row;
- reads, searches, and directory listings can share one row even when they use different Tool names;
- read-like Bash commands such as `cat`, search-like commands such as `grep`, and listing commands such as `ls` are classified by meaning;
- the group can continue across consecutive assistant API messages in the same user turn;
- assistant prose and a non-retrieval operation such as ordinary Bash break the group;
- while active, it uses present tense and shows only the latest target below the count summary;
- after settlement, it switches to past tense and drops the target line;
- `Ctrl+O` opens the global detailed transcript and restores the individual calls;
- failure does **not** veto folding: failed reads remain counted and hidden behind the same successful-sounding past-tense summary.

The last point is an important difference from Pi Stuff's current fail-open presentation rule.

## Provenance

The tested binary was:

```text
~/.local/share/claude/versions/2.1.220
2.1.220 (Claude Code)
SHA-256 674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863
```

It was run in isolated `100 × 38` tmux PTYs with fresh HOME/config/project directories and an Anthropic-compatible localhost SSE fixture. The fixture supplied deterministic assistant content blocks; the untouched official binary owned Tool execution, ordering, classification, lifecycle, transcript persistence, and every rendered cell. No external model or credential was used.

The public behavior was cross-checked against Anthropic's official [interactive-mode documentation](https://code.claude.com/docs/en/interactive-mode#transcript-viewer), [fullscreen documentation](https://code.claude.com/docs/en/fullscreen#search-and-review-the-conversation), and official [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).

## Black-box rule matrix

| Probe | Default active projection | Default settled projection | Determination |
| --- | --- | --- | --- |
| one `Read(a.txt)` | `Reading 1 file…` + `⎿ a.txt` | `Read 1 file` | minimum group size is 1 |
| two Reads + two searches | `Searching for 2 patterns, reading 2 files…` + latest pattern | `Searched for 2 patterns, read 2 files` | different retrieval classes share one group |
| Read + assistant prose + Read in one response | completed `Read 1 file`, prose, then active `Reading 1 file…` | two separate `Read 1 file` rows | non-empty assistant prose is a hard boundary |
| two Reads, then another assistant response containing search + Read | one `Searching for 1 pattern, reading 3 files…` row | one `Searched for 1 pattern, read 3 files` row | an assistant API-message boundary is not a boundary |
| two Reads, ordinary `Bash(true)`, then search + Read | Read group, standalone Bash row, second retrieval group | same three-part structure | non-retrieval Tool work is a hard boundary |
| `Read(a)`, `Read(a)`, `Read(b)` | `Reading 2 files…` | `Read 2 files` | file count is unique paths, not invocation count |
| Bash `cat`, Bash `grep`, Bash `ls` | `Searching for 1 pattern, reading 1 file, listing 1 directory…` | corresponding past-tense line | Bash is classified semantically, not by Tool name |
| successful Read + missing-file Read + successful Read | `Reading 3 files…` | `Read 3 files` | failed retrieval remains folded and counted |

In `Ctrl+O`, the duplicate-read probe restored all three original calls even though the compact row said two files. The failed-read probe likewise restored the missing-file call as a separate Tool operation.

## Exact grouping model

### 1. Eligible work is categorized by human meaning

The default compact row uses outcome categories rather than literal Tool labels:

```text
Searching for N patterns
Reading N files
Listing N directories
```

The released binary classified Bash `grep`, `cat`, and `ls` into those three categories. Anthropic's changelog independently records the same decisions:

- 2.1.0 fixed Bash read commands such as `ls` and `cat` being omitted from collapsed read/search groups;
- 2.1.89 changed `ls`/`tree`/`du` to `Listed N directories` rather than `Read N files`;
- 2.1.81 added collapsed MCP read/search calls as `Queried {server}`.

Ordinary Bash, edits, writes, and other consequential operations are not part of the default read/search group. The live `Bash(true)` probe remained a standalone row and split the surrounding retrieval work.

### 2. The unit is an uninterrupted segment of a user turn

A group does not require calls to originate in one provider response. It can absorb retrieval calls from multiple assistant round-trips as long as no visible prose or consequential Tool operation intervenes.

Observed hard boundaries:

- non-empty assistant prose;
- a non-retrieval Tool use, such as ordinary Bash;
- the end of the user turn.

The existing secondary source audit, [`claude-code-transcript-source-decisions.md`](./claude-code-transcript-source-decisions.md), additionally reports that thinking, attachments, and selected system messages do not fragment an in-progress retrieval group. That detail comes from a non-official reconstructed snapshot and was not independently black-box tested here.

### 3. One operation is folded

Claude Code does not wait for two calls. A single read becomes:

```text
Reading 1 file… (ctrl+o to expand)
⎿ a.txt
```

and later:

```text
Read 1 file (ctrl+o to expand)
```

This is substantially more aggressive than Pi Stuff's current two-or-more rule.

### 4. Counts are semantic and not all counts mean the same thing

- Reads count **unique file paths**. Reading `a.txt` twice and `b.txt` once reports two files.
- Searches report pattern operations.
- Listings report directory-listing operations.
- MCP queries are summarized by server and repetition count.
- A failed retrieval still contributes to the count.

The compact row therefore describes attempted activity, not guaranteed successful outcomes. The settled phrase `Read 3 files` can include a file that did not exist.

### 5. Active and settled groups are two lifecycle projections

While the last retrieval segment is active, the row has:

- a live Tool marker;
- present tense (`Reading`, `Searching for`, `Listing`);
- an ellipsis;
- a child line containing only the most recent file, quoted pattern, or command.

When the segment settles, it has:

- past tense (`Read`, `Searched for`, `Listed`);
- no latest-target child line;
- dim summary treatment;
- the same `Ctrl+O` detail affordance.

The official changelog documents the evolution of this grammar:

- 2.1.20: present tense while active, past tense when complete;
- 2.1.45: current file or search pattern beneath an active summary;
- 2.1.47: quoted search patterns and narrow-terminal hint truncation;
- 2.1.210: live elapsed time for long-running collapsed Tool work.

Secondary source inspection reports a 700 ms minimum display time for changing target hints, preventing a fast sequence of file names from flickering unreadably. Treat the exact duration as secondary evidence, not a public API contract.

### 6. Errors do not cause fail-open rendering

The released 2.1.220 binary folded this sequence:

```text
Read(a.txt) → Read(missing.txt) [error] → Read(b.txt)
```

into:

```text
Read 3 files (ctrl+o to expand)
```

No error was visible in the default settled row. `Ctrl+O` restored the failed call as an individual operation. This means Claude's compact projection optimizes continuity and density over immediate failure visibility.

That behavior should not be copied into Pi Stuff without an explicit product decision. Pi Stuff currently keeps an entire candidate group expanded if any member fails or becomes a background handoff.

## Expansion model

`Ctrl+O` is a **global transcript mode**, not a small local disclosure attached only to the selected row. Anthropic's official docs state that it shows detailed Tool usage and execution, timestamps and model metadata, and expands collapsed MCP calls. In fullscreen transcript mode:

- `/` searches;
- `n` / `N` navigate matches;
- `[` writes the full expanded conversation to native terminal scrollback;
- `v` exports it to a temporary file and opens the editor;
- `Esc`, `q`, or `Ctrl+O` returns to the normal projection.

The compact record and the detailed transcript are two projections over the same persisted calls; folding does not rewrite or discard the session history.

## Three separate Claude Code mechanisms that should not be conflated

### A. Default retrieval folding

The behavior measured above: read/search/list/MCP retrieval segments become semantic count rows in the normal conversation.

### B. Individual Tool-result truncation

A long Bash result can keep its own Tool row while showing only a bounded output preview and a hidden-line count. This is result truncation, not grouping of multiple Tool calls.

### C. Optional Focus view

Anthropic's official fullscreen docs describe `/focus` as a quieter persistent projection containing the last prompt, a one-line summary of Tool calls with edit diffstats, and the final response. It is more aggressive than the ordinary read/search folding and is optional. A standard 2.1.220 session still kept `Bash(true)` visible between two retrieval groups in the black-box probe.

## Known UX criticism

Anthropic issue [#21151](https://github.com/anthropics/claude-code/issues/21151), “No indication of WHICH file for READ tool,” remains open and has extensive user feedback asking to retain file/search targets or provide a less verbose middle mode. This aligns with the observed trade-off: Claude shows the latest target only while active, then removes all targets from the settled compact row.

This issue is user feedback, not specification evidence, but it is relevant when deciding what Pi Stuff should copy.

## Comparison with Pi Stuff's current rule

| Dimension | Claude Code 2.1.220 | Pi Stuff now |
| --- | --- | --- |
| Minimum | 1 eligible operation | 2 eligible operations |
| Segment | uninterrupted retrieval segment across assistant round-trips | adjacent calls within one assistant message |
| Labels | semantic counts: patterns/files/directories | `Explore N operations` + Tool labels |
| Bash | semantic read/search/list classification | conservative semantic exploration classification |
| Live state | compact immediately; present tense + latest target | individual rows until every member settles |
| Failure | stays folded and counted | entire group remains expanded |
| Settled target | omitted | representative Tool labels, not targets |
| Detail | global `Ctrl+O` transcript | `/tools` detail surface |
| Persistence | compact view is re-derived from stored calls | display-only plan; session JSONL unchanged |

## Product takeaway for later discussion

The strongest Claude ideas are:

1. group an uninterrupted **exploration segment**, not merely one assistant message;
2. summarize by semantic activity (`read`, `search`, `list`) rather than raw Tool names;
3. use present tense plus the current target while active and past tense after settlement;
4. keep one consistent detailed-transcript path;
5. stabilize changing hints and counts to avoid flicker.

The parts worth rejecting or modifying are:

1. folding a single read;
2. removing all target information after settlement;
3. counting failed retrievals under successful-sounding past tense;
4. hiding errors unless the user enters detailed transcript mode.

No Claude Code source was copied into Pi Stuff, and this research made no implementation change.
