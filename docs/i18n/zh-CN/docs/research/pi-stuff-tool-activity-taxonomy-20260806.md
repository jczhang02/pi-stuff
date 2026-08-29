<!-- translation-source: docs/research/pi-stuff-tool-activity-taxonomy-20260806.md; translation-source-sha256: 8662cda2b1a537c96f1b3e78d31723d0ef6d0013cca518f9c2d3f587e4a2d427 -->
# Pi Stuff Tool Activity 分类

ADR 0002 完整 Tool Activity Grouping 的实现映射。

## 聚合范围

`packages/pi-stuff/index.ts:3-14,18-36` 按顺序加载 12 个 Capability factory，与 `packages/pi-stuff/suite.json:4-16` 一致：

`ui → tools → rtk → codex → goal → context → web → mcp → work → agents → todo → btw`。

根 aggregate 注册 **28 个不同的 Tool 名称**。`ui`、`rtk` 和 `btw` 不注册根 Tool。Work 替换了面向 aggregate 的 `bash` 行为，因此 Bash 只计数一次。Agent capability 还可以有条件地注册 parent-channel 别名 `subagent_supervisor` 和 `intercom`。

所有必需的和条件性的注册都经过 `registerSuiteOwnedTool`；没有任何 owned Tool 绕过共享的 presentation 契约。decorator、结构化 Activity interface、projection planner 以及生成的 coverage gate 实现在 `packages/pi-stuff/src/tool-display/contract.ts`、`packages/pi-stuff/src/tool-display/activity.ts` 和 `packages/pi-stuff/index.ts` 中。coverage gate 要求全部 28 个根 Tool，并在任一条件别名注册时验证该别名。

## Tool 矩阵

下文的“Fields”指当前可用或被消费的稳定结构化结果字段；`none` 表示 Suite 当前依赖文本或不透明的上游细节。

### Host、执行和文件活动

| Exact Tool    | Family                      | Success clause | Recommended present → past · noun                                 | Count/dedup identity                                         | Active target                                              | Fields / notable behavior                                                                                                                                          |
| ------------- | --------------------------- | -------------: | ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`        | retrieval/file              |            Yes | Reading → Read · files                                            | Unique normalized path                                       | `path`                                                     | 没有消费 Suite-stable fields。共享的 result-body projection 会将返回的图像保留在紧凑 Activity 行下方。                                           |
| `write`       | mutation/file               |            Yes | Writing → Wrote · files                                           | Unique normalized path                                       | `path`                                                     | 没有消费 stable fields。                                                                                                                                         |
| `edit`        | mutation/file               |            Yes | Editing → Edited · files                                          | Unique normalized path                                       | `path`                                                     | 没有消费 stable fields。                                                                                                                                         |
| `grep`        | retrieval/search            |            Yes | Searching → Searched · text patterns                              | Unique normalized `(pattern, root, glob)`                    | Pattern plus nearest useful root                           | 没有消费 stable fields。                                                                                                                                         |
| `find`        | retrieval/search            |            Yes | Searching → Searched · file patterns                              | Unique normalized `(pattern, root)`                          | Pattern plus nearest useful root                           | 没有消费 stable fields。                                                                                                                                         |
| `ls`          | retrieval/list              |            Yes | Listing → Listed · directories                                    | Unique normalized directory                                  | Directory                                                  | 没有消费 stable fields。                                                                                                                                         |
| `bash`        | execution/background launch |            Yes | Running → Ran · commands; Launching → Launched · background tasks | Invocation count; detached outcome keyed by returned task ID | Prefer `description`; semantic fallback, never raw command | 透传 `BashToolDetails`；background ID 当前从结果文本中解析。Foreground 调用可能流式输出；detached 调用先 settle origin，之后再完成。 |
| `apply_patch` | mutation/file               |            Yes | Patching → Patched · files                                        | Unique union of affected paths                               | First patch path `+N`                                      | `changedFiles`、`createdFiles`、`deletedFiles`、`movedFiles`、`fuzz`；顺序 mutation queue。                                                                   |
| `view_image`  | retrieval/media             |            Yes | Viewing → Viewed · images                                         | Unique normalized path                                       | `path`                                                     | `mimeType`、`path`；图像通过 `resultBody` 保持可见。                                                                                                    |
| `imagegen`    | outcome/media               |            Yes | Generating → Generated · images                                   | Unique produced path, fallback invocation                    | Bounded prompt description                                 | `model`、`path`、`latest_path`、`images[]`；文本路径加最多四个 inline PNG，每个不超过 25 MiB。                                                            |

来源：

- Builtins：`packages/pi-stuff/src/tool-display/builtin-tools.ts:42-132`
- Builtin session registration：`packages/pi-stuff/src/tool-display/index.ts:64-80`
- Work Bash：`packages/pi-stuff/src/background-work/src/tools.ts:132-181`
- Codex definitions/results：`packages/pi-stuff/src/codex/tools.ts:28-68,104-292`
- Codex registrations/media：`packages/pi-stuff/src/codex/tools.ts:294-342`

### Goal、Context 和 memory 活动

| Exact Tool      | Family                             | Success clause | Recommended present → past · noun                                         | Count/dedup identity                             | Active target                            | Fields / notable behavior                                                                                       |
| --------------- | ---------------------------------- | -------------: | ------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `goal_complete` | goal/outcome                       |            Yes | Completing → Completed · goals                                            | Unique `goal_id`                                 | Short summary or `goal_id`               | `goal`、`goal_id`、`summary`、`evidence[]`；成功结果终止本轮，并保持 summary body 可见。   |
| `goal_blocked`  | goal/outcome                       |            Yes | Blocking → Blocked · goals                                                | Unique `goal_id`                                 | Short reason or `goal_id`                | `goal`、`goal_id`、`reason`、`attempt`、`evidence`、`repeated_turns`；成功的第三次审计结果会终止本轮。 |
| `ctx_expand`    | context retrieval                  |            Yes | Expanding → Expanded · context ranges                                     | Unique `message`, or `(start,end,verbose)`       | Message ID or `start-end`                | 没有 Suite-stable outcome fields；有界文本结果。                                                            |
| `ctx_search`    | context retrieval/search           |            Yes | Searching → Searched · context queries                                    | Unique normalized query plus source filter       | `query`                                  | 没有 normalized fields；有界的排序文本结果。                                                               |
| `ctx_memory`    | memory                             |            Yes | Reading/Saving/Updating/Archiving/Merging → corresponding past · memories | Action plus memory IDs; new memory’s returned ID | Action plus first ID/content description | 没有 normalized Suite fields；结果文本取决于 action。                                                       |
| `ctx_note`      | note                               |            Yes | Reading/Saving/Updating/Dismissing → corresponding past · notes           | Action plus `note_id`; new note’s returned ID    | Action plus note ID/content description  | 没有 normalized Suite fields；smart-note 条件仍具有用户意义。                                       |
| `ctx_reduce`    | infrastructure/context maintenance |     **Silent** | No successful clause                                                      | None                                             | None                                     | 成功不贡献紧凑行；失败仍贡献明确的 Group issue state。                         |

来源：

- Context names：`packages/pi-stuff/src/context-management/index.ts:17-29`
- Current generic target/grouping：`packages/pi-stuff/src/context-management/index.ts:337-363`
- Lazy handoff registrations：`packages/pi-stuff/src/context-management/index.ts:398-423`
- Activated upstream registrations：`packages/pi-stuff/src/context-management/index.ts:602-606`
- Goal detail contracts/presentation：`packages/pi-stuff/src/goal/src/goal.ts:42-109`
- Goal registrations：`packages/pi-stuff/src/goal/src/goal.ts:593-594`

当前 Context target extractor 会检查 `query`、`memory_id` 和 `id` 等通用 key，但遗漏了包括 `ids`、`note_id`、`message` 和 `drop` 在内的重要实际参数。

### Web 和 MCP 活动

| Exact Tool           | Family                 | Success clause | Recommended present → past · noun                                                                    | Count/dedup identity                             | Active target                                           | Fields / notable behavior                                                                                                                                             |
| -------------------- | ---------------------- | -------------: | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search`         | retrieval/search       |            Yes | Searching → Searched · web queries                                                                   | Unique normalized query                          | First query or `N queries`                              | `successfulQueries`、`queryCount`、`totalResults`、`error`；合成文本和 URL，没有 media/body hook。                                                            |
| `fetch_content`      | retrieval/fetch        |            Yes | Fetching → Fetched · pages                                                                           | Unique canonical URL                             | Hostname(s)                                             | `successful`、`urlCount`、`error`；PDF 可能返回临时 Markdown 路径。                                                                                          |
| `get_search_content` | retrieval/continuation |            Yes | Retrieving → Retrieved · passages                                                                    | Unique `responseId + selector`                   | Short response ID plus query/URL/index                  | `returnedMatches`、`matchCount`、`returnedChars`、`resultCount`、`error`。                                                                                             |
| `mcp`                | MCP gateway            |            Yes | Invoking → Invoked · MCP tools; Connecting → Connected · servers; Searching → Searched · MCP catalog | ADR 要求每次 MCP 调用都计数 | Qualified server/tool or connect/search/describe target | presentation 消费 `error`、`mode`、`count`、`matches[]`、`outputGuard.truncated`；任意文本/tool content 都受保护。对于可能的 MCP media，没有 `resultBody`。 |

来源：

- Web wrapping and registrations：`packages/pi-stuff/src/web/adapter.ts:67-122`
- Intentional Source Check exclusion：`packages/pi-stuff/src/web/adapter.ts:124-145`
- Web outcome extraction：`packages/pi-stuff/src/web/presentation.ts:18-126`
- Upstream definitions：`packages/pi-stuff/src/web/runtime/index.ts:1574,2138,2232,2550`
- MCP gateway registration/filter：`packages/pi-stuff/src/mcp/adapter.ts:69-87,105-128`
- `proxyOnly` installation：`packages/pi-stuff/src/mcp/adapter.ts:176-185`
- MCP semantics/outcomes：`packages/pi-stuff/src/mcp/presentation.ts:10-52`

只有 `mcp` 对 aggregate 可见。运行时发现的直接 MCP tools 会通过 `proxyOnly: true` 以及只接受 `tool.name === "mcp"` 的 facade 被有意抑制。

### Background、Agent 和 Todo 活动

| Exact Tool   | Family                | Success clause | Recommended present → past · noun                                                              | Count/dedup identity                                     | Active target                                                     | Fields / notable behavior                                                                                                                                         |
| ------------ | --------------------- | -------------: | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background` | background management |            Yes | Inspecting → Inspected · background work; Reading → Read · outputs; Stopping → Stopped · tasks | Unique `taskId` for output/stop; list invocation         | `task_id`, otherwise action                                       | `action`、`status`、`taskId`、`outputPath`、`error`；文本可能包含近期输出。成功行当前通过 `errors-only` 隐藏。                      |
| `monitor`    | background launch     |            Yes | Starting → Started · monitors                                                                  | Actual launch IDs                                        | Prefer `description`; otherwise source plus safe shortened target | `status`、`taskId`、`outputPath`、`error`；立即返回，终端完成在新的 Narrative Boundary 到达。                                    |
| `subagent`   | Agent coordination    |            Yes | Launching → Launched · agents; Checking/Steering/Stopping/Resuming → past · agents             | Actual children launched; management invocation/agent ID | Agent name plus supplied display description; management ID       | 已确认顶层 `mode`、`results[]`；background launch 立即返回，foreground 返回直接 child summaries，`/agents` 仍是详细权威。 |
| `TaskCreate` | Todo mutation         |            Yes | Creating → Created · tasks                                                                     | Unique created task ID                                   | `subject`                                                         | 版本化 snapshot：`capability`、`schemaVersion`、`tasks[]`、`nextId`、`action`、`params`、`error`。成功当前被隐藏。                                    |
| `TaskGet`    | Todo retrieval        |            Yes | Reading → Read · tasks                                                                         | Unique `taskId`                                          | `#taskId`                                                         | 相同 snapshot envelope；成功当前被隐藏。                                                                                                                 |
| `TaskList`   | Todo retrieval        |            Yes | Listing → Listed · tasks                                                                       | Unique non-deleted task IDs returned                     | None                                                              | 相同 snapshot；当前 summary 统计 total/done/open；成功被隐藏。                                                                                            |
| `TaskUpdate` | Todo mutation         |            Yes | Updating/Deleting → Updated/Deleted · tasks                                                    | Unique `taskId`                                          | `#taskId`                                                         | 相同 snapshot；成功当前被隐藏。                                                                                                                          |

来源：

- Background and Monitor definitions：`packages/pi-stuff/src/background-work/src/tools.ts:184-265`
- `background` successful-row suppression：`packages/pi-stuff/src/background-work/src/tools.ts:115-125`
- Root Agent definition/registration：`packages/pi-stuff/src/subagents/src/extension/index.ts:620-630`
- Agent semantics：`packages/pi-stuff/src/subagents/src/extension/agent-tool-presentation.ts:16-60`
- Todo names：`packages/pi-stuff/src/todo/tool/types.ts:3-14`
- Todo structured envelope：`packages/pi-stuff/src/todo/tool/types.ts:28-43`
- Todo registrations：`packages/pi-stuff/src/todo/todo.ts:82-148`
- Todo `errors-only`：`packages/pi-stuff/src/todo/todo.ts:42-57`

## 契约参与和实现状态

**未纳入契约的 owned Tools：无。** 每个必需的根注册以及条件性的 Agent parent-channel 别名，都由 `registerSuiteOwnedTool` 装饰；当 owned registration 未声明、必需 registration 缺失，或已注册 Tool 缺少 Activity metadata 时，生成的 Aggregate gate 会失败。

不是 aggregate Tools 的项目：

- Web `Source Check` 会被捕获，然后有意丢弃。
- MCP 每个 server 的直接 Tools 会被抑制；只有 gateway 暴露出来。
- `ui`、`rtk` 和 `btw` 不贡献根 Tool 定义。
- 仅 child 使用的 Agent communication surfaces 保持在 subprocess-local。父进程可以有条件地暴露 `subagent_supervisor` 和 `intercom`；二者都使用 Agent coordination 词汇，并在 `suite.json` 中声明为 optional。

ADR 0002 通过结构化语义贡献、跨 round-trip Narrative Boundary 规划、静默成功的基础设施处理、mutation-outcome vetoes、有界语义 targets、真实媒体 projection、完整的当前分支 `/tools` 重建，以及 Host-native `Ctrl+O` 展开来实现。Bash background IDs 和保守的 Git outcomes 只从有界且已识别的结果形状中提取；任意 stdout 绝不会被提升为成功声明。
