# Context and cross-session memory capability reference

**Audit date:** 2026-08-01  
**Product context:** Pi Stuff, with Pi 0.83.0 as the certified Host  
**Status:** Research complete; the default write policy still requires one maintainer decision

## Executive finding

Claude Code currently separates two different things that are often both called “memory”:

1. **Instructions written by people** live in `CLAUDE.md`, `CLAUDE.local.md`, and scoped rule files. They may apply globally, to one repository, or to part of a repository.
2. **Auto memory written by Claude** is enabled by default, stored locally per repository, and contains concise learnings that may help in later sessions.

That separation is the most important product lesson for Pi Stuff. Project rules should continue to use Pi's native `AGENTS.md`/`CLAUDE.md` loading. Agent-written memory should be a separate, local, auditable store rather than silently editing team instructions.

For the Agent-written store, the best Pi-native package base is an **owned, pinned fork of `pi-hermes-memory@0.9.2`**, tag commit [`5aafe2ca04cb55b62204b159389c8381894038ce`](https://github.com/chandra447/pi-hermes-memory/tree/5aafe2ca04cb55b62204b159389c8381894038ce). It has useful project/global storage, replace/remove operations, secret scanning, timestamps, automatic extraction, and the strongest native test base among the packages reviewed. Its existing product behavior is not suitable unchanged: it reviews the conversation periodically, flushes again at compaction/shutdown, exposes too many unrelated features, keys projects too weakly, and uses UI that does not match Pi Stuff.

The recommended Pi Stuff behavior is Claude-like **quiet auto memory during normal work**, not periodic transcript mining:

- “Remember this” and clear corrections are written immediately.
- The main Agent may save a genuinely durable fact when it notices one during work.
- Background Agents may propose memories, but only the main Agent commits them.
- No automatic “summarize this whole session into memory” pass runs every N turns or at exit.
- Every successful write leaves a compact, inspectable transcript record such as `Saved 1 memory`.
- Memory is local and per repository by default; global memory requires explicit wording such as “remember this in every project.”

The one remaining maintainer choice is whether **quiet automatic writes are on by default** or whether Pi Stuff writes only after an explicit “remember this” request. Concrete experiences appear at the end of this report.

## Verified Claude Code behavior

### Two layers, with different owners

Claude Code documents two complementary mechanisms:

| Mechanism | Written by | Intended content | Scope |
| --- | --- | --- | --- |
| `CLAUDE.md` and rules | A person or team | Instructions, conventions, workflows, architecture | Organization, user, project, or local project |
| Auto memory | Claude | Build commands, debugging discoveries, patterns, and preferences | One repository, shared across its worktrees |

Both are context, not hard enforcement. Claude Code explicitly directs enforced behavior to hooks or settings instead. Source: [Claude Code memory documentation](https://code.claude.com/docs/en/memory#claudemd-vs-auto-memory).

### Instruction hierarchy

Claude Code loads instruction files from broad to specific:

- managed organization policy;
- `~/.claude/CLAUDE.md` user instructions;
- repository `CLAUDE.md` or `.claude/CLAUDE.md`;
- gitignored `CLAUDE.local.md` for private repository-specific preferences.

It walks from the filesystem root toward the launch directory. Files nearer the current directory are appended later. Subdirectory files are loaded only when Claude works in those subdirectories. Files are concatenated rather than replacing one another. External imports from a project memory file require a trust decision the first time. Source: [scope table and loading order](https://code.claude.com/docs/en/memory#choose-where-to-put-claudemd-files), [external import trust](https://code.claude.com/docs/en/memory#import-additional-files).

Pi 0.83 already supplies the corresponding instruction layer. It loads `~/.pi/agent/AGENTS.md`, then matching `AGENTS.md` or `CLAUDE.md` files while walking through parent directories to the current directory, concatenating the matches. Source: [Pi 0.83 context-file documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/usage.md#context-files).

**Fact-based conclusion:** Pi Stuff does not need a Package to reproduce the basic instruction hierarchy, and should not fork Pi for it.

### When Claude writes auto memory

Auto memory is on by default. Claude decides whether a discovery is likely to help in a future conversation; it does not promise to write something in every session. The documented examples include build commands, debugging insights, architecture notes, code-style preferences, and workflow habits. An explicit request such as “remember that the API tests require Redis” is saved to auto memory. Source: [Claude Code auto memory](https://code.claude.com/docs/en/memory#auto-memory), [view and edit behavior](https://code.claude.com/docs/en/memory#view-and-edit-with-memory).

Claude Code's public documentation does not specify an every-N-turn review, an exit summarizer, or a separate model call that mines the whole transcript. Those are implementation choices in some Pi Packages, not verified Claude Code behavior.

### Scope and storage

Each repository receives a local directory at `~/.claude/projects/<project>/memory/`. Git worktrees and subdirectories of the same repository share it. Outside a repository, the project root supplies the identity. The store has a concise `MEMORY.md` entry point and may have topic files such as `debugging.md`. It is machine-local and is not automatically shared to other machines or cloud environments. Source: [Claude Code storage location](https://code.claude.com/docs/en/memory#storage-location).

The main conversation's auto memory is not automatically loaded into ordinary subagents. A fork inherits the parent's prompt and conversation; a subagent can instead have its own separate memory directory. Source: [Claude Code auto-memory loading](https://code.claude.com/docs/en/memory#how-it-works).

### Loading, visibility, and control

At session start Claude Code loads at most the first 200 lines or 25 KB of `MEMORY.md`, whichever comes first. Topic files are read on demand. Near the limit, Claude Code asks Claude to shorten the index, move detail to topic files, and merge or drop stale entries. A write beyond the limit succeeds but returns an error that asks Claude to rewrite the index because the overflow would not load next time. Source: [Claude Code memory limits](https://code.claude.com/docs/en/memory#how-it-works).

The user can see activity messages such as `Saved 2 memories` and `Recalled 2 memories`. `/memory` lists instruction and memory locations, toggles auto memory, and opens files. The files are plain Markdown and may be edited or deleted directly. Source: [audit and edit](https://code.claude.com/docs/en/memory#audit-and-edit-your-memory), [`/memory` behavior](https://code.claude.com/docs/en/memory#view-and-edit-with-memory).

Since Claude Code 2.1.214, when Claude writes a memory file that already has YAML frontmatter, it updates a `modified` timestamp. It does not add frontmatter to a file that has none. Source: [currentness metadata](https://code.claude.com/docs/en/memory#how-it-works).

### Privacy and staleness boundary

Verified protections are limited but useful:

- auto memory is local rather than cloud-synchronized by default;
- it is repository-scoped rather than one automatic global pool;
- a project-configured custom memory directory is honored only after workspace trust;
- everything is plain Markdown that the user can inspect, edit, or delete;
- current versions can expose a last-modified timestamp when frontmatter is present.

The current memory documentation does **not** promise secret redaction, encryption, a time-to-live, or correctness verification before recall. It warns that contradictory instruction files can reduce adherence and instructs Claude to merge or drop stale memory only when the index approaches its limit. Therefore a Claude-like product must treat remembered text as fallible local context, not truth or policy. Source: [storage and workspace trust](https://code.claude.com/docs/en/memory#storage-location), [conflict guidance](https://code.claude.com/docs/en/memory#write-effective-instructions).

## Pi Package audit

### Adoption snapshot

Downloads use the fixed npm window 2026-07-02 through 2026-07-31. Version, publication time, package count, dependencies, and license fields come from the npm registry records observed on 2026-08-01.

| Package | Latest audited version | 30-day downloads | License signal | What it actually does | Pi Stuff fit |
| --- | ---: | ---: | --- | --- | --- |
| `@remnic/plugin-pi` | 9.45.5 | 43,839 | MIT | Connector to a separate Remnic daemon; observes messages, recalls context, coordinates compaction, and exposes daemon tools | Mature adoption, but forking the connector does not own the memory engine |
| `pi-hermes-memory` | 0.9.2 | 19,357 | MIT | Native Markdown + SQLite memory, project/global scopes, auto reviews, correction capture, search, skills, session archive | Best native base, but must be narrowed and behaviorally rewritten |
| `pi-memory` | 0.4.0 | 14,523 | MIT | One large TypeScript extension with global Markdown, tools, optional qmd search, and exit summaries | Simpler, but lacks safe repository scope and is tied to deprecated Pi package names |
| `@loreai/pi` | 0.40.0 | 1,549 | Conflicting metadata | Starts or connects to a Lore gateway and routes supported LLM traffic through it for distillation/recall | Too invasive and too uncertain for the first memory capability |

Sources: npm downloads for [`@remnic/plugin-pi`](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40remnic%2Fplugin-pi), [`pi-hermes-memory`](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-hermes-memory), [`pi-memory`](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-memory), and [`@loreai/pi`](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40loreai%2Fpi); registry records for [`@remnic/plugin-pi`](https://registry.npmjs.org/%40remnic%2Fplugin-pi), [`pi-hermes-memory`](https://registry.npmjs.org/pi-hermes-memory), [`pi-memory`](https://registry.npmjs.org/pi-memory), and [`@loreai/pi`](https://registry.npmjs.org/%40loreai%2Fpi).

### `@remnic/plugin-pi`: highest adoption, wrong ownership boundary

The connector recalls relevant data in Pi's `context` hook, observes user/assistant/tool messages, flushes long-context memory before compaction, and registers Remnic tools. By default it connects to a localhost daemon, but it can be configured to use another daemon and namespace. The package exposes explicit remember/search commands and automatically observes turns when enabled. Source: [published Package README](https://pi.dev/packages/%40remnic/plugin-pi), [Remnic source repository](https://github.com/joshuaswarren/remnic).

The memory engine, extraction, indexes, and daemon are not contained in the Pi connector. Adopting it under Pi Stuff's “owned fork” rule would mean owning far more than the connector: at minimum the coupled `@remnic/core`, daemon protocol, storage migrations, and release train. The npm registry showed 400 published connector versions between 2026-05-10 and the audited 9.45.5 release, which is evidence of active maintenance but also unusually high churn.

A local startup audit installed `@remnic/plugin-pi@9.45.5` beside Pi 0.83.0 and loaded its exact published `dist/index.js` through the real Pi RPC Host in an isolated directory. Six Remnic commands registered and Pi emitted no Extension error. This proves Host startup compatibility only; it does not certify daemon authentication, observation, extraction, recall, compaction, or migration behavior.

**Fact-based disposition:** valuable architectural reference, but not a practical first owned fork for Pi Stuff.

### `pi-hermes-memory`: selected fork base

The audited version stores global `MEMORY.md`, global `USER.md`, failures, repository-specific `MEMORY.md`, and a SQLite search mirror. It can add, replace, and remove entries; scans writes for common prompt-injection patterns and secrets; timestamps entries; shares a repository identity across git worktrees; and treats current evidence as stronger than remembered text. Source: [0.9.2 README](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/README.md), [memory tool](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/tools/memory-tool.ts), [content scanner](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/store/content-scanner.ts).

Its automatic behavior is more aggressive than verified Claude Code behavior:

- after at least three user turns, it reviews the conversation every ten turns or fifteen tool calls by default;
- it separately reacts to text that heuristically looks like a correction;
- it runs another save pass before compaction and, fire-and-forget, at shutdown;
- it can launch an extra model completion for review, correction, flush, or consolidation;
- when a review saves something, it emits an emoji notification.

Sources: [background review](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/handlers/background-review.ts), [correction detector](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/handlers/correction-detector.ts), [session flush](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/handlers/session-flush.ts), [default configuration](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/config.ts).

The project-scoping implementation improves worktree behavior but derives its durable directory name from the repository basename. Two unrelated repositories both named `api` can therefore collide in the same `projects-memory/api/` directory. Source: [project detection](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/src/project.ts).

The repository was created in April 2026 and had 265 stars, 62 forks, 56 npm versions, and a release on 2026-07-30 at audit time. It is active and unusually well tested for a young Pi extension, but should not be described as long-established.

#### Pi 0.83 compatibility audit

The package declares `@earendil-works/pi-coding-agent >=0.74.0`, but upstream develops against `^0.80.2` and has a runtime dependency on `@earendil-works/pi-tui ^0.80.2`. It does not officially pin or certify Pi 0.83.0. Source: [0.9.2 package manifest](https://github.com/chandra447/pi-hermes-memory/blob/5aafe2ca04cb55b62204b159389c8381894038ce/package.json).

The local audit replaced the three Pi development/runtime packages with exact 0.83.0 versions, then:

1. passed TypeScript checking;
2. passed all 40 upstream test files, 732 tests total;
3. loaded the exact published Extension through the real Pi 0.83 RPC Host in an isolated environment;
4. observed nine memory commands and no Extension error.

This proves source-level compatibility and Host startup/registration. It does not certify real-model auto extraction, multi-process writes, interrupted shutdown, UI rendering, or recovery after a crash. The owned fork must pin exact Pi 0.83 development dependencies, remove the duplicate 0.80 TUI runtime, and add real-Host tests for those paths.

### `pi-memory`: attractive simplicity, expensive corrections

`pi-memory@0.4.0` is a single 2,325-line TypeScript Extension. It offers `memory_write`, `memory_forget`, `memory_restore`, `memory_read`, scratchpad, optional qmd search, and memory status. Deletion writes a recovery record before changing the source file. Source: [published package](https://pi.dev/packages/pi-memory), [exact npm tarball](https://registry.npmjs.org/pi-memory/-/pi-memory-0.4.0.tgz).

Its default store is one global `~/.pi/agent/memory/` directory. `MEMORY.md`, the current and previous daily log, and the scratchpad are injected into every turn up to fixed limits. At a final session exit it sends the conversation through another model call and appends decisions, lessons, notes, and follow-ups to the daily log; it skips trivial sessions and ordinary reload/new/resume/fork transitions. It does not have a per-repository automatic-memory boundary.

The package still imports deprecated `@mariozechner/*` Pi packages and declares peers `>=0.52.0`. Installing it for the audit pulled the last old-namespace Pi SDK, version 0.73.1, alongside Host 0.83. The Extension loaded without a Host error, but this is duplicate-runtime compatibility rather than native 0.83 integration.

**Fact-based disposition:** the deletion/recovery design is useful reference material, but fixing scope, prompt injection, deprecated SDK ownership, and exit summarization would erase most of the simplicity advantage.

### `@loreai/pi`: powerful but too invasive

The Extension starts or discovers a local Lore gateway, installs a process-wide fetch interceptor, reroutes supported Pi provider calls through the gateway, and replaces Pi compaction when the gateway returns a Lore summary. The memory engine and its three-tier storage live in coupled packages. Source: [Pi Extension source](https://github.com/BYK/loreai/blob/main/packages/pi/src/index.ts), [published Package README](https://pi.dev/packages/%40loreai/pi).

Its package metadata and root repository declare `FSL-1.1-Apache-2.0`, while `packages/pi/LICENSE` and the npm tarball contain an MIT license. That ambiguity must be resolved by the publisher before an owned product fork. Sources: [root FSL](https://github.com/BYK/loreai/blob/main/LICENSE), [Pi package manifest](https://github.com/BYK/loreai/blob/main/packages/pi/package.json), [Pi subpackage license](https://github.com/BYK/loreai/blob/main/packages/pi/LICENSE).

**Fact-based disposition:** do not adopt for the first Pi Stuff memory capability. Its gateway and provider interception change a much larger trust and reliability boundary than cross-session memory requires.

## Product recommendation

Everything in this section is a Pi Stuff recommendation, not a claim about hidden Claude Code internals.

### Adopt a narrow owned fork

Fork the exact `pi-hermes-memory@0.9.2` tag. Preserve its MIT license and upstream provenance. Do not depend on upstream `latest` at runtime.

Keep and harden:

- atomic Markdown mutation and its SQLite search mirror;
- add, replace, and remove operations;
- repository/global target separation;
- secret and prompt-injection scanning as defense in depth;
- entry creation/modification metadata;
- bounded index plus on-demand detailed files;
- migration and corruption-recovery tests.

Remove from the first capability:

- periodic every-N-turn transcript review;
- separate exit/shutdown transcript summarization;
- automatic failure diaries;
- generated skills and the skills manager;
- full session-history indexing/search;
- emoji notifications and the current modal UI;
- the basename-only project identifier.

This is an intentionally substantial fork. The Package is the storage and mutation base, not a product behavior that Pi Stuff should expose unchanged.

### Write policy

1. **Explicit memory is immediate.** When the user says “remember this,” the main Agent writes before moving on.
2. **A correction replaces, not appends.** “Use pnpm, not npm” replaces a conflicting package-manager memory atomically. It does not leave two equally active claims.
3. **Automatic writes are small and in-band.** The main Agent may call the memory tool while doing normal work when it encounters one durable fact. No separate reviewer rereads the transcript.
4. **One-off state is rejected.** Current task progress, temporary TODOs, branch status, generated output, and facts derivable cheaply from repository files do not become memory.
5. **Children propose; the main Agent commits.** A background Agent returns a candidate with evidence. The main Agent decides scope and serializes the write, avoiding races and low-quality child memories.
6. **Automatic scope is repository-local.** A cross-project preference is written globally only after explicit language such as “in every project” or “globally.”
7. **Writes do not ask for permission.** A compact transcript entry makes them visible, and `/memory` makes them reversible.

### Storage and recall policy

- Derive a stable repository identity from the git common directory plus a canonical remote/path hash, not only the basename. Share it across worktrees.
- Store auto memory outside the repository by default so it is not accidentally committed.
- Use a concise `MEMORY.md` index with topic files on demand, following Claude Code's proven bounded-index shape.
- Add `created`, `modified`, `lastConfirmed`, scope, and source session metadata. Do not include raw prompts or tool output in the index.
- Treat memory as untrusted context. Current user instructions, repository files, tests, and tool output override it.
- Search automatically only when the current request plausibly depends on a past choice, correction, or non-obvious environment fact. Do not inject the entire store into every turn.
- Never expire a fact solely because it is old. Mark it stale or replace it when current evidence contradicts it. Capacity consolidation must keep a recoverable history or tombstone.
- Reject obvious credentials before storage. Secret scanning is not a guarantee, so `/memory` must plainly describe the files as local plaintext.

### User-visible behavior

- A successful automatic write appears as one collapsed tool line: `Saved 1 memory · project`.
- Recall is similarly quiet: `Recalled 2 memories` only when recall actually influenced the turn.
- `/memory` opens Pi Stuff's standard full-width, non-floating Command Dialog. It lists project instructions, local instructions, project auto memory, and global user memory as separate sources.
- The dialog supports view, edit, delete, and the auto-memory toggle. It does not add a statusline indicator.
- Editing a memory opens the plain Markdown source through the normal editor path; deleting one creates a recoverable record before removal.

## Concrete “return days later” experiences

These are the three possible default write policies. Storage, visibility, edit/delete, and scope rules stay the same; only **when Pi Stuff writes without being explicitly asked** changes.

### A — Quiet auto memory during normal work — recommended

Monday:

1. You ask Pi to fix the test suite.
2. Pi discovers that this repository's integration tests require `REDIS_URL=redis://localhost:6379` and that `pnpm test:integration` is the correct command.
3. After the fix, the transcript contains one compact line: `Saved 1 memory · project`.
4. Pi stores the command and prerequisite, not the entire session summary.

Friday, in a fresh session:

1. You say “run the integration tests.”
2. Pi quietly recalls the repository memory, checks that the command still exists, and runs it with the Redis prerequisite.
3. The transcript says `Recalled 1 memory`. If `package.json` now disagrees, Pi trusts `package.json`, updates the stale memory, and mentions the change.

Cost: an occasional memory tool call, but no periodic extra model review. Risk: the main Agent can still choose an unhelpful fact, so visibility and easy deletion matter.

### B — Explicit-only memory

Monday:

1. The same Redis requirement is discovered.
2. Pi does not persist it unless you say “remember that for this project.”
3. If you do, the transcript shows `Saved 1 memory · project` immediately.

Friday:

1. Pi recalls it if you explicitly saved it.
2. Otherwise it rediscovers the requirement from the repository.

Cost: almost no surprise or privacy risk. Tradeoff: the user must recognize every useful future fact and remember to ask, so the product often feels forgetful.

### C — Automatic checkpoint extraction

Monday:

1. Pi works normally.
2. Every several turns, at compaction, or at exit, a separate review pass rereads the conversation and extracts memories.
3. It may save the Redis command, debugging failures, and other session facts even if the main Agent never called memory directly.

Friday:

1. More of the earlier session is searchable.
2. There is also more stale and low-value material, extra model cost, and a larger plaintext privacy surface.

This is close to current `pi-hermes-memory` defaults, but it is not the recommended Pi Stuff default and is not verified Claude Code behavior.

## The one maintainer decision

Choose the fresh-install default:

- **A — Quiet auto memory (recommended):** Pi may save a small durable fact during ordinary work, shows the write, never runs a transcript-mining checkpoint, and lets the user turn auto memory off.
- **B — Explicit-only:** Pi writes only after language such as “remember this,” while retaining the same storage, recall, and `/memory` management UI.

Option C should not be a first-release default. It can be reconsidered later only with memory-quality evaluation, privacy tests, cost/latency measurement, and a clear user-facing reason to exist.
