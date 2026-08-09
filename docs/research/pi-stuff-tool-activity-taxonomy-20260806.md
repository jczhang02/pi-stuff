# Pi Stuff Tool Activity Taxonomy

Read-only architecture analysis; no repository files were changed.

## Aggregate scope

`packages/pi-stuff/index.ts:3-14,18-36` loads 12 Capability factories sequentially, matching `packages/pi-stuff/suite.json:4-16`:

`ui → tools → rtk → codex → goal → context → web → mcp → work → agents → todo → btw`.

The root aggregate registers **28 distinct Tool names**. `ui`, `rtk`, and `btw` register no Tools. Work replaces the aggregate-facing `bash` behavior, so Bash is counted once.

All 28 registrations pass through `registerSuiteOwnedTool`; no root Tool bypasses the shared presentation contract. The decorator and current interface are at:

- `packages/pi-stuff-tools/contract.ts:19-50`
- `packages/pi-stuff-tools/contract.ts:649-686`

However, that contract still implements adjacent successful `"exploration"` folding, not ADR 0002’s complete cross-message Tool Activity Group model.

## Tool matrix

“Fields” below means stable structured result fields currently available or consumed; `none` means the Suite currently relies on text or opaque upstream details.

### Host, execution, and file activity

| Exact Tool    | Family                      | Success clause | Recommended present → past · noun                                 | Count/dedup identity                                         | Active target                                              | Fields / notable behavior                                                                                                                                          |
| ------------- | --------------------------- | -------------: | ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`        | retrieval/file              |            Yes | Reading → Read · files                                            | Unique normalized path                                       | `path`                                                     | No Suite-stable fields consumed. Read can return image content, but its presentation has no `resultBody`.                                                          |
| `write`       | mutation/file               |            Yes | Writing → Wrote · files                                           | Unique normalized path                                       | `path`                                                     | No stable fields consumed.                                                                                                                                         |
| `edit`        | mutation/file               |            Yes | Editing → Edited · files                                          | Unique normalized path                                       | `path`                                                     | No stable fields consumed.                                                                                                                                         |
| `grep`        | retrieval/search            |            Yes | Searching → Searched · text patterns                              | Unique normalized `(pattern, root, glob)`                    | Pattern plus nearest useful root                           | No stable fields consumed.                                                                                                                                         |
| `find`        | retrieval/search            |            Yes | Searching → Searched · file patterns                              | Unique normalized `(pattern, root)`                          | Pattern plus nearest useful root                           | No stable fields consumed.                                                                                                                                         |
| `ls`          | retrieval/list              |            Yes | Listing → Listed · directories                                    | Unique normalized directory                                  | Directory                                                  | No stable fields consumed.                                                                                                                                         |
| `bash`        | execution/background launch |            Yes | Running → Ran · commands; Launching → Launched · background tasks | Invocation count; detached outcome keyed by returned task ID | Prefer `description`; semantic fallback, never raw command | Pass-through `BashToolDetails`; background ID is currently parsed from result text. Foreground calls may stream; detached calls settle origin then complete later. |
| `apply_patch` | mutation/file               |            Yes | Patching → Patched · files                                        | Unique union of affected paths                               | First patch path `+N`                                      | `changedFiles`, `createdFiles`, `deletedFiles`, `movedFiles`, `fuzz`; sequential mutation queue.                                                                   |
| `view_image`  | retrieval/media             |            Yes | Viewing → Viewed · images                                         | Unique normalized path                                       | `path`                                                     | `mimeType`, `path`; image remains visible through `resultBody`.                                                                                                    |
| `imagegen`    | outcome/media               |            Yes | Generating → Generated · images                                   | Unique produced path, fallback invocation                    | Bounded prompt description                                 | `model`, `path`, `latest_path`, `images[]`; text path plus up to four inline PNGs, each at most 25 MiB.                                                            |

Sources:

- Builtins: `packages/pi-stuff-tools/builtin-tools.ts:42-132`
- Builtin session registration: `packages/pi-stuff-tools/index.ts:64-80`
- Work Bash: `packages/pi-stuff-work/src/tools.ts:132-181`
- Codex definitions/results: `packages/pi-stuff-codex/tools.ts:28-68,104-292`
- Codex registrations/media: `packages/pi-stuff-codex/tools.ts:294-342`

### Goal, Context, and memory activity

| Exact Tool      | Family                             | Success clause | Recommended present → past · noun                                         | Count/dedup identity                             | Active target                            | Fields / notable behavior                                                                                       |
| --------------- | ---------------------------------- | -------------: | ------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `goal_complete` | goal/outcome                       |            Yes | Completing → Completed · goals                                            | Unique `goal_id`                                 | Short summary or `goal_id`               | `goal`, `goal_id`, `summary`, `evidence[]`; successful result terminates turn and keeps summary body visible.   |
| `goal_blocked`  | goal/outcome                       |            Yes | Blocking → Blocked · goals                                                | Unique `goal_id`                                 | Short reason or `goal_id`                | `goal`, `goal_id`, `reason`, `attempt`, `evidence`, `repeated_turns`; successful third-audit result terminates. |
| `ctx_expand`    | context retrieval                  |            Yes | Expanding → Expanded · context ranges                                     | Unique `message`, or `(start,end,verbose)`       | Message ID or `start-end`                | No Suite-stable outcome fields; bounded text result.                                                            |
| `ctx_search`    | context retrieval/search           |            Yes | Searching → Searched · context queries                                    | Unique normalized query plus source filter       | `query`                                  | No normalized fields; bounded ranked text result.                                                               |
| `ctx_memory`    | memory                             |            Yes | Reading/Saving/Updating/Archiving/Merging → corresponding past · memories | Action plus memory IDs; new memory’s returned ID | Action plus first ID/content description | No normalized Suite fields; action-dependent text result.                                                       |
| `ctx_note`      | note                               |            Yes | Reading/Saving/Updating/Dismissing → corresponding past · notes           | Action plus `note_id`; new note’s returned ID    | Action plus note ID/content description  | No normalized Suite fields; smart-note conditions remain user-meaningful.                                       |
| `ctx_reduce`    | infrastructure/context maintenance |     **Silent** | No successful clause                                                      | None                                             | None                                     | Failure must still affect Group issue state. Currently rendered as ordinary standalone “working” activity.      |

Sources:

- Context names: `packages/pi-stuff-context/index.ts:17-29`
- Current generic target/grouping: `packages/pi-stuff-context/index.ts:337-363`
- Lazy handoff registrations: `packages/pi-stuff-context/index.ts:398-423`
- Activated upstream registrations: `packages/pi-stuff-context/index.ts:602-606`
- Goal detail contracts/presentation: `packages/pi-stuff-goal/src/goal.ts:42-109`
- Goal registrations: `packages/pi-stuff-goal/src/goal.ts:593-594`

The current Context target extractor checks generic keys such as `query`, `memory_id`, and `id`, but misses important actual arguments including `ids`, `note_id`, `message`, and `drop`.

### Web and MCP activity

| Exact Tool           | Family                 | Success clause | Recommended present → past · noun                                                                    | Count/dedup identity                             | Active target                                           | Fields / notable behavior                                                                                                                                             |
| -------------------- | ---------------------- | -------------: | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search`         | retrieval/search       |            Yes | Searching → Searched · web queries                                                                   | Unique normalized query                          | First query or `N queries`                              | `successfulQueries`, `queryCount`, `totalResults`, `error`; synthesized text and URLs, no media/body hook.                                                            |
| `fetch_content`      | retrieval/fetch        |            Yes | Fetching → Fetched · pages                                                                           | Unique canonical URL                             | Hostname(s)                                             | `successful`, `urlCount`, `error`; PDFs may return temporary Markdown paths.                                                                                          |
| `get_search_content` | retrieval/continuation |            Yes | Retrieving → Retrieved · passages                                                                    | Unique `responseId + selector`                   | Short response ID plus query/URL/index                  | `returnedMatches`, `matchCount`, `returnedChars`, `resultCount`, `error`.                                                                                             |
| `mcp`                | MCP gateway            |            Yes | Invoking → Invoked · MCP tools; Connecting → Connected · servers; Searching → Searched · MCP catalog | ADR requires invocation count for every MCP call | Qualified server/tool or connect/search/describe target | Presentation consumes `error`, `mode`, `count`, `matches[]`, `outputGuard.truncated`; arbitrary text/tool content is guarded. No `resultBody` for possible MCP media. |

Sources:

- Web wrapping and registrations: `packages/pi-stuff-web/adapter.ts:67-122`
- Intentional Source Check exclusion: `packages/pi-stuff-web/adapter.ts:124-145`
- Web outcome extraction: `packages/pi-stuff-web/presentation.ts:18-126`
- Upstream definitions: `packages/pi-web-access/index.ts:1574,2138,2232,2550`
- MCP gateway registration/filter: `packages/pi-stuff-mcp/adapter.ts:69-87,105-128`
- `proxyOnly` installation: `packages/pi-stuff-mcp/adapter.ts:176-185`
- MCP semantics/outcomes: `packages/pi-stuff-mcp/presentation.ts:10-52`

Only `mcp` is aggregate-visible. Runtime-discovered direct MCP tools are deliberately suppressed by `proxyOnly: true` and the facade that accepts only `tool.name === "mcp"`.

### Background, Agent, and Todo activity

| Exact Tool   | Family                | Success clause | Recommended present → past · noun                                                              | Count/dedup identity                                     | Active target                                                     | Fields / notable behavior                                                                                                                                         |
| ------------ | --------------------- | -------------: | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background` | background management |            Yes | Inspecting → Inspected · background work; Reading → Read · outputs; Stopping → Stopped · tasks | Unique `taskId` for output/stop; list invocation         | `task_id`, otherwise action                                       | `action`, `status`, `taskId`, `outputPath`, `error`; text may contain recent output. Successful rows are currently hidden via `errors-only`.                      |
| `monitor`    | background launch     |            Yes | Starting → Started · monitors                                                                  | Actual launch IDs                                        | Prefer `description`; otherwise source plus safe shortened target | `status`, `taskId`, `outputPath`, `error`; returns immediately, terminal completion arrives later at a new Narrative Boundary.                                    |
| `subagent`   | Agent coordination    |            Yes | Launching → Launched · agents; Checking/Steering/Stopping/Resuming → past · agents             | Actual children launched; management invocation/agent ID | Agent name plus supplied display description; management ID       | Confirmed top-level `mode`, `results[]`; background launches return immediately, foreground returns direct-child summaries, `/agents` remains detailed authority. |
| `TaskCreate` | Todo mutation         |            Yes | Creating → Created · tasks                                                                     | Unique created task ID                                   | `subject`                                                         | Versioned snapshot: `capability`, `schemaVersion`, `tasks[]`, `nextId`, `action`, `params`, `error`. Success currently hidden.                                    |
| `TaskGet`    | Todo retrieval        |            Yes | Reading → Read · tasks                                                                         | Unique `taskId`                                          | `#taskId`                                                         | Same snapshot envelope; success currently hidden.                                                                                                                 |
| `TaskList`   | Todo retrieval        |            Yes | Listing → Listed · tasks                                                                       | Unique non-deleted task IDs returned                     | None                                                              | Same snapshot; current summary counts total/done/open; success hidden.                                                                                            |
| `TaskUpdate` | Todo mutation         |            Yes | Updating/Deleting → Updated/Deleted · tasks                                                    | Unique `taskId`                                          | `#taskId`                                                         | Same snapshot; success currently hidden.                                                                                                                          |

Sources:

- Background and Monitor definitions: `packages/pi-stuff-work/src/tools.ts:184-265`
- `background` successful-row suppression: `packages/pi-stuff-work/src/tools.ts:115-125`
- Root Agent definition/registration: `packages/pi-stuff-agents/src/extension/index.ts:620-630`
- Agent semantics: `packages/pi-stuff-agents/src/extension/agent-tool-presentation.ts:16-60`
- Todo names: `packages/pi-stuff-todo/tool/types.ts:3-14`
- Todo structured envelope: `packages/pi-stuff-todo/tool/types.ts:28-43`
- Todo registrations: `packages/pi-stuff-todo/todo.ts:82-148`
- Todo `errors-only`: `packages/pi-stuff-todo/todo.ts:42-57`

## Contract participation and architecture gaps

**Uncontracted root Tools: none.** Every root registration is decorated by `registerSuiteOwnedTool`.

Not aggregate Tools:

- Web `Source Check` is captured then intentionally discarded.
- MCP direct per-server Tools are suppressed; only the gateway is exposed.
- `ui`, `rtk`, and `btw` contribute no Tool definitions.
- Child-only Agent communication Tools `contact_supervisor` and fallback `intercom` are conditional subprocess surfaces, not root aggregate Tools; they also use `registerSuiteOwnedTool` (`packages/pi-stuff-agents/src/intercom/native-supervisor-channel.ts:343-408`).

Main gaps relative to ADR 0002:

1. `SuiteToolPresentation` has no structured family/action/noun/count-identity/outcome interface; it exposes ad hoc label/summary strings.
2. Current grouping is exploration-only, requires adjacent successful calls, and does not model all terminal states across Narrative Boundaries.
3. `ctx_reduce` lacks a “silent on success, issue-bearing on failure” contract.
4. `Task*` and `background` suppress successful transcript rows instead of contributing clauses.
5. Bash background identity is parsed from human text rather than stable fields.
6. Current Bash target exposes the first raw command line; ADR requires a supplied short description or semantic fallback.
7. Read and MCP can plausibly carry media, but only Codex image Tools currently preserve media through `resultBody`.
8. Goal Tools lack short targets, and Context’s generic target extractor does not match several actual schemas.
