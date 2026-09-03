<!-- translation-source: docs/research/claude-code-tool-grouping-narrative-boundary-20260826.md; translation-source-sha256: bdbeb62bea75e2ac0115fecbd3a4ec2e10eab5bfc2bbe65071c087b5715ce089 -->
# Claude Code 工具分组与叙事边界

- **日期：** 2026-08-26
- **产品上下文：** Pi Stuff 工具展示
- **主要样本：** 官方 Claude Code 2.1.220 Linux x64 二进制文件
- **问题：** Claude Code 和 Pi Stuff 如何将每个 Pi Stuff 根 Tool 与诚实的 Claude 对应项分组（包括 MCP），以及为什么 Thinking 有时会更新一行、有时会创建另一行

## 答案

Claude Code 2.1.220 与 Pi Stuff 在核心规则上保持一致：非空的可见 Assistant prose、用户轮次，或独立的有后果 Tool，都会关闭符合条件的检索折叠；Assistant API 响应边界不会。Thinking 和仅包含空白的 Assistant 文本保持透明。即使检索调用周围出现两个不同的 Thinking 行，这一点仍然成立。

这**不**意味着 Claude Code 会将这些边界之间的每个 Tool 都分组。成功的 Edit、Write、普通 Bash、WebSearch、WebFetch、Agent 以及后台生命周期操作都保持独立。每个系列的连续两次调用也保持独立。穷尽式映射扫描发现了两个重要的默认投影差异：

- Claude 会将直接 MCP 调用折叠到与 Read 相同的紧凑活动中，而 Pi Stuff 的 `mcp` 网关调用保持独立，并会切分检索；
- Claude 将图像读取视为普通 Read 调用，而 Pi Stuff 的 `view_image` 调用保持独立，并会切分检索。

在两个客户端中，任务操作都使用独立的任务界面。Claude 即使在详细转录中也隐藏其调用行，而 Pi Stuff 仅在展开 Tool 输出时恢复它们。在两个客户端中，它们都会切分 Read 组。

因此：

- “叙事边界之间连续的、符合条件的检索”符合观察到的默认行为；
- “叙事边界之间所有 Suite 拥有的 Tool 活动”将是 Pi Stuff 的产品决策，而不是对 Claude Code 默认转录的复制；
- 将新的逻辑 Thinking 运行设为边界，也会是 Pi Stuff 有意偏离 Claude 的行为，而不是 Claude 兼容性；
- Claude Code 可选的 `/focus` 视图，才是跨越更广泛 Tool 工作、显示单一摘要的更接近的官方参考。

## 来源

### Claude Code

- 二进制文件：`~/.local/share/claude/versions/2.1.220`
- 报告版本：`2.1.220 (Claude Code)`
- SHA-256：`674f61f20ff306f3100cf9200e4c36c4b70278b5bef2884549819b942a89c863`

### Pi

- 二进制文件：从上游 GitHub release 下载的官方 `v0.84.3` Linux x64 release executable
- 报告版本：`0.84.3`
- 大小：`104,487,040` bytes
- SHA-256：`ca858fde375ab91531353b22fac6ebdf29c0a153efe754f5f9b8a72a7423ed08`
- 测试中的 Package：由该 Host 加载的仓库本地 `packages/pi-stuff` Extension

Pi 身份与 [`docs/compatibility.md`](../compatibility.md) 完全一致。早期探索性捕获使用了机器上的 `/opt/pi-coding-agent/pi`，它同样报告 `0.84.3`，但构建 hash 不同；下面的最终 Pi 矩阵已使用经过认证的 release executable 从头重新运行。

### 共享协议

- PTY 几何尺寸：`100x38`，每次探测使用一个全新的 tmux 会话
- 隔离：全新的 HOME 或 Pi 配置、XDG 目录、项目、Session store 和 tmux server
- 传输：确定性的本地 provider fixtures；Claude 使用兼容 Anthropic 的 localhost SSE endpoint，Pi 使用真实注册的 Provider Extension
- 网络：基线探测将外部 HTTP(S) proxies 指向已关闭的 localhost 端口；WebSearch 后续探测保留客户端网络路径可用；WebFetch/`fetch_content` 使用真实的公共 HTTP 响应
- Telemetry、updater、错误报告、终端标题和非必要流量：已禁用
- 权限：Claude 使用 `dontAsk`，仅允许被探测的 Tools；Pi 在隔离项目内以显式 approval mode 运行
- Fixture 作用：fixtures 仅提供确定性的 Assistant content blocks；发布版客户端负责 Tool 执行、生命周期、分组、渲染、紧凑投影和详细展开

已移除的 Claude harness 遵循隔离 safe-mode 和 localhost-SSE 模式。它没有访问 Claude account、外部 model、repository credentials 或用户的 Claude configuration。Git history 保留了 capture implementation。

## 探测矩阵

下面的路径统一表示为 `<project>`；在每个隔离项目中，release binary 实际看到的是不同的绝对路径。

| 探测 | Synthetic Assistant sequence | 稳定后的紧凑投影 | 判定 |
| --- | --- | --- | --- |
| 同一响应 | `Read(a) + Read(b)` in one Tool-use response | `Read 2 files` | 并行调用共享同一组。 |
| 跨响应 | `Read(a)` → result → next Assistant response `Read(b)` | `Read 2 files` | Assistant API 往返不是边界。 |
| 可见 prose | `Read(a)` → result → `VISIBLE_PROSE_BOUNDARY + Read(b)` | `Read 1 file` → prose → `Read 1 file` | 非空的可见 Assistant prose 是硬边界。 |
| Thinking | `Read(a)` → result → Thinking + `Read(b)` | `Thought for 1s, read 2 files` | Thinking 仍在同一紧凑活动内。 |
| 空白文本 | `Read(a)` → result → whitespace-only text + `Read(b)` | `Read 2 files` | 单独的 text block 不足以形成边界；必须有可见内容。 |
| 普通 Bash | `Read(a)` → `Bash(true)` → `Read(b)` | `Read 1 file` → `Bash(true)` → `Read 1 file` | 普通 Bash 独立显示，并切分检索。 |
| 成功的 Edit | `Read(edit.txt)` → `Edit(edit.txt)` → `Read(b)` | `Read 1 file` → `Update(edit.txt)` → `Read 1 file` | 有后果的文件修改独立显示，并切分检索。 |
| 并行 WebSearch | `WebSearch(q1) + WebSearch(q2)` in one Tool-use response | 两个独立的 `Web Search(...)` block | 同一响应中的 WebSearch 调用不会合并。 |
| 跨响应 WebSearch | `WebSearch(q1)` → result → next response `WebSearch(q2)` | 两个独立的 `Web Search(...)` block | API 往返不会导致 WebSearch 聚合。 |
| Read/WebSearch/Read | `Read(a)` → `WebSearch(q)` → `Read(b)` | `Read 1 file` → `Web Search(...)` → `Read 1 file` | WebSearch 会切分相邻检索。 |
| 新的用户轮次 | turn 1 `Read(a)`；turn 2 `Read(b)` | 两个独立的 `Read 1 file` 行 | 轮次完成和下一次用户输入会关闭上一组。 |

每个紧凑检索行都保留了 `(ctrl+o to expand)`。

## 穷尽式映射 Tool 扫描

Suite 声明了 23 个根 Tool 名称。其中 18 个在捕获的 Claude Code surface 中有诚实的精确或语义对应项，并且这 18 个都通过两个真实客户端执行。剩下的五个根 Tool、全部五个延期 Context Tool、全部四个条件式 Agent-channel Tool，以及面向 provider 的 Code Mode envelope，在这个 Claude surface 中没有诚实对应项；它们被单独记录，而没有被强行纳入误导性测试。

官方 Claude client 从 fixture requests 收到的 active Tool surface：

```text
Agent, Bash, Edit, Glob, Grep, Read,
TaskCreate, TaskGet, TaskList, TaskOutput, TaskStop, TaskUpdate,
WebFetch, WebSearch, Write, mcp__local__echo
```

经过认证的 Pi Host 收到并执行的 18 个 Suite root Tools：

```text
read, grep, find, ls, bash, write, edit, apply_patch, view_image,
web_search, fetch_content, mcp, background, subagent,
TaskCreate, TaskGet, TaskList, TaskUpdate
```

### 结果矩阵

每个普通系列都在 `Read(a)` 和 `Read(b)` 之间调用两次。“Split”表示周围的 Reads 仍然是两个紧凑检索行；“joined”表示这些调用参与同一紧凑活动。

| Pi Stuff 根 Tool | 使用的 Claude 对应项 | Claude Code 2.1.220 | Pi Stuff on Pi 0.84.3 | 对比 |
| --- | --- | --- | --- | --- |
| `read` | `Read` | 加入符合条件的检索。 | 加入符合条件的检索。 | 匹配。 |
| `grep` | `Grep` | 加入同一检索行。 | 加入同一检索行。 | 匹配。 |
| `find` | `Glob` file pattern | 加入检索。 | 加入检索。 | 匹配；many-to-one mapping。 |
| `ls` | `Glob` directory pattern | 加入检索。 | 加入检索。 | 匹配；many-to-one mapping。 |
| `bash` | `Bash` | 两次调用均独立；split。 | 两次调用均独立；split。 | 匹配。 |
| `write` | `Write` | 两次调用均独立；split。 | 两次调用均独立；split。 | 匹配。 |
| `edit` | `Edit` | 两次调用均渲染为 `Update`；split。 | 两次调用均渲染为 `Edit`；split。 | 分组相同，客户端原生标签不同。 |
| `apply_patch` | `Edit` | 独立的 `Update`；split。 | 两次 Patch 调用均独立；split。 | 语义/分组相同；many-to-one mapping。 |
| `web_search` | `WebSearch` | 两次调用均独立；split。 | 两次调用均独立；split。 | 匹配。 |
| `fetch_content` | `WebFetch` | 两次调用均独立；split。 | 两次调用均独立；split。 | 匹配。 |
| `subagent` | foreground `Agent` | 两次子运行均独立；split。 | 两次子运行均独立；split。 | 匹配。 |
| `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate` | 相同的四个 Tools | 紧凑或详细转录中都没有 invocation rows；task panel 更新；split。 | 紧凑视图隐藏；展开时恢复 invocation rows；task panel 更新；split。 | 紧凑视图匹配；详细转录不同。 |
| `mcp` invocation | direct `mcp__local__echo` | `Read 2 files, called local 2 times`；joined。 | 两个独立的 `MCP local:local_echo` 行；split。 | 不匹配。 |
| `view_image` | PNG 上的 `Read` | 文本和图像读取变为 `Read 4 files`；joined。 | 两个独立的 `View … · loaded` 行；split。 | 不匹配。 |
| background `bash` + `background` output/stop | background `Bash` + `TaskOutput` + `TaskStop` | start、output 和 stop 各自独立；split。 | start、output 和 stop 各自独立；split。 | 语义匹配；标签不同。 |

检索控制序列是 `Read → Grep → Glob → Glob → Read`。Claude 渲染为 `Searched for 3 patterns, read 2 files`；Pi 渲染为 `Searched 2 patterns, read 2 files, listed 1 directory`。这确认了等价的折叠，但 Pi 对其不同的 `find` 和 `ls` 操作采用了不同的语义计数。

MCP fixture 是真实的 stdio server，而不是伪造的 Tool result。两个客户端都启动了它，其独立日志准确记录：

```text
call:MCP_PARITY_ONE
call:MCP_PARITY_TWO
```

Claude 的展开转录按源顺序恢复为 `Read → local - echo (MCP) → local - echo (MCP) → Read`，而其紧凑投影将四次调用合并。Pi 的 MCP gateway 也执行了两次调用，但其紧凑投影将两次调用保持独立。证据支持成功的直接 invocation 存在分组差异。但这并不能证明 Pi 的其他 `mcp` gateway 操作（例如 discovery、connection、instructions 或 authentication）也应折叠。

Pi 当前也无法通过假设每个 invocation 都是检索，来安全地复现 Claude 的 direct-MCP policy。MCP server normalizer 保留 name、title、description、input schema 和 `_meta`，但没有保留协议的标准 Tool annotations；后续的 `ToolMetadata` 和 cache shapes 又进一步缩窄了这些信息。尤其是在 Tool Activity grouping seam 上，无法获得可信的 `readOnlyHint`/`destructiveHint`。在这些 metadata 被传递之前，“折叠每个成功的 MCP invocation”也会折叠未知的可变操作。参见 [`mcp/runtime/server-manager.ts`](../../../../../packages/pi-stuff/src/mcp/runtime/server-manager.ts)、[`mcp/runtime/types.ts`](../../../../../packages/pi-stuff/src/mcp/runtime/types.ts) 和 [`mcp/runtime/metadata-cache.ts`](../../../../../packages/pi-stuff/src/mcp/runtime/metadata-cache.ts)。

两组 foreground Agent 都通过真实的子进程完成。两次 background 探测都启动了真实的 `sleep` process，以非阻塞方式读取其输出，并将其停止。两次图像探测都解码了真实的 PNG。Claude WebFetch 和 Pi `fetch_content` 都收到了成功的 HTTP 响应。Pi `web_search` 为每个查询返回五个 sources；隔离的 Claude WebSearch 路径完成为 `Did 0 searches`，因此其分组已经确定，但正结果装饰尚未确定。

### 没有 Claude 对应项的根 Tools

以下 Suite root Tools 未执行，因为捕获的官方 Claude surface 没有语义等价的 Tool：

| Pi Stuff Tool | 未配对原因 |
| --- | --- |
| `imagegen` | 捕获的 Claude surface 中没有 image-generation Tool。读取图像不等于生成图像。 |
| `goal_complete`, `goal_blocked` | Pi Goal terminal-policy controls，而不是普通的 Task status operations。 |
| `get_search_content` | 从 Pi 的 Session-persisted search/fetch artifact 中检索；Claude WebFetch 是 producer，而不是这个 continuation interface。 |
| `monitor` | 等待任意 command、file、log 或 HTTP condition。可用时的 timer wake-up 也不等价。 |

同样的排除适用于延期的 `ctx_expand`、`ctx_search`、`ctx_memory`、`ctx_note` 和 `ctx_reduce`；可选的 `subagent_supervisor`、`intercom`、`contact_supervisor` 和 `structured_output`；以及 Code Mode 的 `codemode`、`tool_search` 和 in-sandbox discovery helpers。它们是 Pi 的 lifecycle、context、coordination 或 infrastructure interfaces，而不是遗漏的 Claude 分组探测。

## 精确的规范化观察

### 同一响应和跨响应

两个控制都产生了同一个紧凑行：

```text
Read 2 files (ctrl+o to expand)
```

这排除了按 Assistant API response 分组的可能。

### 可见 prose

```text
Read 1 file (ctrl+o to expand)

VISIBLE_PROSE_BOUNDARY

Read 1 file (ctrl+o to expand)
```

prose 和第二次 Read 在同一个 Assistant response 中发出。因此，切分来自可见文本，而不是 response transition。

### Thinking

紧凑视图：

```text
Thought for 1s, read 2 files (ctrl+o to expand)
```

使用 `Ctrl+O` 展开：

```text
Read(<project>/a.txt)
  Read 2 lines

THINKING_BRIDGE_MARKER

Read(<project>/b.txt)
  Read 2 lines
```

这将此前基于重建源代码的推断转化为针对 2.1.220 的 black-box 证据：Thinking 不会切分检索，但也不只是被忽略；它会为紧凑活动贡献一个语义分句。

### 仅包含空白的 Assistant 文本

```text
Read 2 files (ctrl+o to expand)
```

中间的 text block 包含空格和换行。它没有渲染 prose，也没有切分分组。

### 普通 Bash

```text
Read 1 file (ctrl+o to expand)

Bash(true)
  (No output)

Read 1 file (ctrl+o to expand)
```

`Ctrl+O` 按源顺序恢复了 `Read(a)`、`Bash(true)` 和 `Read(b)` 三次调用。

### 成功的 Edit

```text
Read 1 file (ctrl+o to expand)

Update(edit.txt)
  Added 1 line, removed 1 line
  1 -alpha
  1 +ALPHA

Read 1 file (ctrl+o to expand)
```

官方 binary 中的 Edit 成功执行。它保持独立，并切分相邻的 Reads。

### WebSearch

同一 Assistant response 中发出的两次 WebSearch 调用独立渲染：

```text
Web Search("OpenAI official site")
  Did 0 searches

Web Search("Anthropic official site")
  Did 0 searches
```

在两个 Assistant response 之间发出相同调用，产生了相同的两个 block 投影。混合探测渲染为：

```text
Read 1 file (ctrl+o to expand)

Web Search("Anthropic official site")
  Did 0 searches

Read 1 file (ctrl+o to expand)
```

隔离客户端完成了每次 invocation，且没有 error marker，但报告后端搜索次数为零。这是对该 result 下 release client 分组投影的直接证据；它不是关于正搜索结果渲染的证据。

### 用户轮次边界

```text
> first user prompt

Read 1 file (ctrl+o to expand)

PROBE_TURN_ONE_DONE

> second user prompt

Read 1 file (ctrl+o to expand)
```

两次 Read 没有跨轮次变成 `Read 2 files`。

## `Ctrl+O` 验证

对于每次探测，详细转录都在原始源位置恢复了每次底层 Tool invocation。跨响应控制尽管紧凑投影包含一行，仍恢复了两个独立的 Read 调用。Thinking 探测在两次 Read 之间恢复了 Thinking block。Bash 和 Edit 探测都保留了位于两次 Read 之间的独立操作。

这与 Anthropic 对 `Ctrl+O` 的官方描述一致：它是显示详细 Tool 使用和执行情况的详细转录查看器：[Interactive mode](https://code.claude.com/docs/en/interactive-mode#transcript-viewer)。

## 为什么 Thinking 有时替换一行，有时创建另一行

不能混淆以下三种身份：

- **物理终端行**是布局产物，可能因为换行、宽度、resize 或 redraw 而改变；
- **Thinking content block** 是只在单个 Assistant message 内标识的 provider-stream item；
- **逻辑 Thinking run** 是一个 Assistant message 内由 Host 渲染的、相邻 Thinking blocks 的最大连续序列。

Pi 0.84.3 会在 streaming content 变化时重建一个 Assistant-message component。在该 component 内，Host 会将相邻 Thinking blocks 合并为一个 Markdown section。Pi Stuff 的 display-only transformer 只接收该 Markdown，而不是 provider 的 content index，并投影最新的有意义语义 block。因此：

- 当前 Thinking run 的 deltas 会更新同一 component，并在原位置替换其可见内容；
- 两个相邻 Thinking blocks 会被 Host 合并，Pi Stuff 只保留其最新的有意义 block；
- 被 Tool call 或其他 content 与前一个 Thinking block 分隔开的 Thinking block，会创建另一个 logical run，因而创建另一个可见 Thinking component；
- 后续 Assistant message 中的 Thinking block 也会创建另一个 component。

Pi Stuff 的 seam 位于 [`conversation-ui/live-thought.ts`](https://github.com/jczhang02/pi-stuff/blob/add4468b5525e06acaae866f60c31a24534a829a/packages/pi-stuff/src/conversation-ui/live-thought.ts)，从 [`conversation-ui/index.ts`](../../../../../packages/pi-stuff/src/conversation-ui/index.ts) 注册；其 display-only contract 记录在所属的 [`conversation-ui/README.md`](../../packages/pi-stuff/src/conversation-ui/README.md) 中。

实时流捕获将 Pi 的一行从：

```text
∗ thoughts: STREAM_PHASE_ONE
```

变为：

```text
∗ thoughts: STREAM_PHASE_ONE STREAM_PHASE_TWO
```

没有新增 Thinking component。Claude 同样会在 settling 为一个 elapsed-time summary 之前，原位更新其 active Thinking spinner。

### 边界探测

| 有效的 Assistant sequence | Pi Stuff 紧凑结果 | Claude 紧凑结果 | 详细结果 |
| --- | --- | --- | --- |
| `Read(a)` → next response `Thinking` + `Read(b)` | 一个 `Read 2 files` 行加可见 thought | `Thought for 1s, read 2 files` | 在两次 Reads 之间恢复 Thinking。 |
| 同一 message `Read(a)` + `Thinking` + `Read(b)` | 一个 `Read 2 files` 行 | `Read 2 files` | 在两次 Reads 之间恢复 Thinking。 |
| 相邻的 `Thinking 1` + `Thinking 2` + Reads | 只有 Pi 的第二个语义 thought；一个 Read group | 一个 Thought/Read group | Claude 显示两个详细 thoughts；Pi Host 将该 run 合并。 |
| 同一 message `Thinking 1` + `Read(a)` + `Thinking 2` + `Read(b)` | 两个 Thinking 行和一个 `Read 2 files` 行 | 一个 `Thought for 1s, read 2 files` 行 | 两个客户端都在 Reads 周围恢复两个 Thinking 行。 |
| 两个 Assistant rounds，每个包含 `Thinking` + `Read` | 两个 Thinking 行和一个 `Read 2 files` 行 | 一个 `Thought for 1s, read 2 files` 行 | 两个客户端都按源顺序恢复两个 runs。 |

决定性的反例是第四行：**新出现的 Thinking 行在当前 Pi Stuff 或 Claude Code 2.1.220 中都不是分组边界**。Claude 甚至会将两个详细 Thinking 行折叠为一个紧凑活动。

如果 Pi Stuff 有意改变该策略，稳定事件不是“一个新的终端行”，而是“在 Tool activity 之后开始一个新的非连续 logical Thinking run”。该事件可以只关闭当前 Tool Activity Group，而无需将所有 Thinking 重新定义为可见 Assistant narrative。但这样仍会偏离 Claude，也会偏离 ADR 0010 中已接受的 transparent-Thinking contract。

## 为什么成功的 Code Mode envelopes 仍然可能创建行

Code Mode 是包裹嵌套 Tools 的 execution envelope。嵌套操作保留其普通 Tool 行，并且是其自身工作的可见 authority。只有在没有 decoded nested operation 拥有 result，或者 unmatched outer failure 必须保持可见时，outer envelope 才使用 fallback。

当前成功 envelope suppression 有意保持狭窄：

- 空的/无输出的成功会隐藏；
- 被分类为 strictly control-only 的 program 会隐藏；
- classifier 接受一个无参数的 `await yield_control()`，可选地后跟一个 literal `text(...)`，包括受支持的狭窄 arrow-function wrappers；
- dynamic text、yield arguments、重复 yields、任何额外 statement 以及 parse/decode failures 都是 ambiguous，因此会保留外层 `Code Mode …` fallback 可见；
- 嵌套 issue 拥有其 issue row，并抑制重复的 outer issue；unmatched outer error 保持可见。

classifier 位于 [`code-mode/cloudflare/normalize.ts`](../../../../../packages/pi-stuff/src/code-mode/cloudflare/normalize.ts)，visibility decision 位于 [`code-mode/extension.ts`](../../../../../packages/pi-stuff/src/code-mode/extension.ts)，共享的 nested/outer authority seam 位于 [`tool-display/contract.ts`](../../../../../packages/pi-stuff/src/tool-display/contract.ts)。

这就是为什么看似无害的 Code Mode programs 仍可能产生重复的 outer rows：当前 policy 对任何无法由严格 syntax classifier 证明为 control-only 的 success，都优先进行完整渲染。移除这些 rows 不是分组问题，而是一个独立的 visibility decision：当成功的 outer envelope 产生有意义的纯 JavaScript text、但没有 nested Tool row 时，是否允许其保持静默。

聚焦的 Code Mode unit suite 通过了全部四个 tests 和 44 个 expectations。已有的 real-Code-Mode acceptance script 没有到达 projection assertions，因为其 request verifier 拒绝了另一个 Tool list 为空的 provider request；这一无关的 harness assumption 意味着本文不声称该脚本完成了新的 real-Host Code Mode certification。

## 对 Pi Stuff 的产品影响

经验支持的 Claude-style 默认规则是：

> 在 Assistant API round trips 之间累积 Claude 的、符合折叠条件的 activity，直到非空的可见 Assistant prose、独立的 Tool family、用户输入或轮次完成将其关闭。Thinking 和不可见文本不会关闭它。

在 2.1.220 中，该可折叠 activity 包括 Read/Grep/Glob 和直接 MCP 调用；图像读取继承 Read 的 eligibility。Pi Stuff 当前将 eligibility 限制在自己的 retrieval taxonomy，并让 MCP 和 `view_image` 保持独立。因此，“Claude style”并不是一个通用的 Narrative-Boundary algorithm：它还取决于客户端对 Tool family 的分类。

这明显比拟议的“在 Narrative Boundaries 之间形成一个完整 work group”设计更窄。如果 Pi Stuff 将 Edit、Write、普通 Bash、WebSearch、Agent、Goal 及其他有后果的 Tools 分组到该行中，应将此选择记录为有意的、以密度为导向的偏离。保持 WebSearch 作为边界，与观察到的 Claude Code 默认行为一致。让后续 logical Thinking runs 关闭当前 group，则会是另一个显式偏离。

Claude Code 确实单独提供了更激进的投影：`/focus` 显示最后一个 prompt、包含 edit diffstats 的单行 Tool-call summary，以及最终响应。参见 [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen#search-and-review-the-conversation)。这是拟议 Pi Stuff 密度的有用参考，但它不是 Claude Code 的默认分组规则。

## 证据限制

- Claude 事实固定于官方 Claude Code 2.1.220；Pi 事实固定于经过仓库认证的 Pi 0.84.3 release binary 和当前工作树中的 Pi Stuff source。它们不声称后续版本中的行为保持不变。
- Fixtures 确定了有效的 Assistant blocks，因此没有证明 live model 会选择发出什么。它们证明的是 release clients 如何执行、分组并渲染这些 blocks 和真实 Tool results。
- 每个在捕获的 Claude surface 中有诚实对应项的 Suite root Tool，都在其成功路径上执行过。明确未配对的 Goal、Context、Monitor、image-generation、stored-Web-artifact、Agent-channel 和 Code Mode interfaces 没有被伪造为错误的等价物。
- 扫描没有尝试完整的 failure、cancellation、permission、attachment 或 Custom Message matrix。这些状态可能增加可见 rows，在改变其 boundary policy 前应单独认证。
- WebSearch 在隔离的 dummy-auth setup 中返回 `Did 0 searches`。测试建立了该 settled result 下独立的 Tool UI 和 retrieval-boundary behavior，但没有建立正结果调用是否拥有额外 presentation details。
- 聚焦的 Code Mode unit suite 已通过，但仓库的 real-Code-Mode acceptance script 在相关 assertions 之前，于 fixture request verifier 阶段失败。因此，本文的 Code Mode 结论结合了 source inspection、focused unit evidence 和用户观察到的 surface，而不是新的、通过的端到端 certification。
- 原始 transient captures 含有隔离的临时路径，且有意未提交。每项判定所需的规范化 visible cells 已在上文复现。
