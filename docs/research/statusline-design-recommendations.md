# Pi Stuff Statusline 设计研究与建议

日期：2026-08-03

范围：Claude Code、Pi、Starship、Oh My Posh、Bubble Tea / Lip Gloss 的一手资料，以及当前 Pi Stuff 真实实现与 PTY 产物。

目的：判断当前 Statusline 哪些应保留、哪些值得优化。本文只提出设计建议，不修改实现。

## 结论先行

当前 Pi Stuff Statusline 的**视觉方向是对的，不建议再次换皮**：旧 Footer 的一格外边距、简单 ` | ` 分隔、低饱和语义色、Nerd Font / ASCII 双路径、完整 segment 换行，都比彩色 Powerline 色块或右对齐布局更稳。

最值得做的不是增加字段，而是改变**窄屏降级顺序**：当前实现按宽屏顺序从左到右装入 segment，一旦某个 segment 放不下，后面的核心信息也一起进入溢出队列。真实 `32 × 18` 帧因此保留了 `model + thinking + cwd + branch`，却丢掉了更重要的 context。建议宽屏继续保持旧样式，窄屏改为按信息重要性保留 `model + context`，再保留 Git，最后才是 cwd、thinking、cache、cost 和 extension status。

我的总体建议是：

1. **保留现有视觉语法。** 不改成色块、不加右对齐、不加渐变、不加更多常驻字段。
2. **优先实现语义化窄屏降级。** 这是唯一建议立即进入实现的改动。
3. **Context 永远优先可见。** 暂时未知时显示未知态，不伪装成 `0%`，也不要因为一个长 model/branch 而消失。
4. **继续条件显示并抑制重复。** Agent、Todo、BTW、Permission、Tool 活动仍由各自 UI 表达，不进入 Statusline。
5. **保持事件驱动和纯渲染。** Git 等慢数据在后台更新、缓存并丢弃过期结果；不要在每次 render 中启动命令。

## 1. 一手资料给出的共同答案

### 1.1 Statusline 的职责是“扫一眼即可判断当前处境”

Claude Code 官方把 Statusline 的核心用途限定为 context、费用、Git，以及区分并行会话所需的身份信息；官方最小示例也是 `model + directory + context`，而多行示例是 `model/directory/git` 与 `context/cost/duration` 的分层，不是把所有运行状态都塞进底部。[Claude Code Statusline](https://code.claude.com/docs/en/statusline)

Starship 为 Claude Code 提供的默认 profile 只有 `claude_model + git_branch + claude_context + claude_cost`，并为长模型名提供 alias；这说明成熟方案把模型、项目状态、context 和计费视为核心，而不是按“能取到什么数据”来决定展示什么。[Starship Claude Code profile](https://starship.rs/advanced-config/#statusline-for-claude-code)

Pi 自带 Footer 本身会显示工作目录、session、token/cache、cost、context 和 model；Pi 的扩展 API 则把普通扩展状态与自定义 Footer 分开：`setStatus()` 发布持久状态，`setFooter()` 才替换整套 Footer。[Pi interactive mode](https://www.npmjs.com/package/@earendil-works/pi-coding-agent?activeTab=readme)；[Pi extensions: Widgets, Status, and Footer](https://pi.dev/docs/latest/extensions#widgets-status-and-footer)

**对 Pi Stuff 的含义：** Statusline 应回答四个问题：

- 我正在用什么模型/推理档位？
- 我在哪个项目和 Git 状态中？
- Context 是否健康？
- 本 session 是否正在产生可计量费用，以及少量 Suite 环境状态是什么？

它不应回答“Agent 正在做什么”“Todo 下一项是什么”“Tool 刚执行了什么”。这些信息已有更合适、可交互的表面。

### 1.2 条件显示比完整展示更成熟

Starship 的条件格式在内部变量为空时整段不渲染；Oh My Posh 允许 segment 按模板、目录、终端宽度和空值隐藏，并允许用户临时关闭单个 segment。[Starship conditional format strings](https://starship.rs/config/#conditional-format-strings)；[Oh My Posh segment settings](https://ohmyposh.dev/docs/configuration/segment)

Pi 社区中较成熟的 `pi-inline-statusline` 会在 Git clean 时隐藏变更 marker，并把 extension status 当作独立、低优先级 segment；`pi-footer` 也为每个 widget 提供 `Hide when empty`，并把 compact preset 单独设计给窄终端。[pi-inline-statusline responsive layout](https://pi.dev/packages/pi-inline-statusline#responsive-layout)；[pi-footer widgets](https://pi.dev/packages/pi-footer#widgets)

**对 Pi Stuff 的含义：** 当前的以下做法应保留：

- 非 reasoning model 不显示 thinking；
- Git clean 不显示 `*0 +0 ?0`；
- 无可计量成本时不显示 `$0.00`；
- cache 为零时不显示 cache；
- extension status 只选 Goal / MCP / Loadout，且过滤空值与重复值；
- Agent / Todo / BTW / Permission / Tool activity 不进入 Statusline。

### 1.3 窄屏应按优先级降级，不能只按排版顺序截断

Oh My Posh 提供 `min_width` / `max_width` 来决定某个 segment 在什么宽度出现；右侧 block 与左侧冲突时必须明确选择 `break` 或 `hide`。`pi-inline-statusline` 也坚持完整 segment 换行，只允许一个自身比终端还长的 segment 被截断。[Oh My Posh segment width](https://ohmyposh.dev/docs/configuration/segment)；[Oh My Posh block overflow](https://ohmyposh.dev/docs/configuration/block)；[pi-inline-statusline responsive layout](https://pi.dev/packages/pi-inline-statusline#responsive-layout)

Lip Gloss 明确区分“字符数量”和终端 cell 宽度，提供 ANSI-aware `Width`、`Wrap`、`MaxWidth` 等工具；这与 Pi Stuff 当前使用 `visibleWidth`、`truncateToWidth`、`wrapTextWithAnsi` 的方向一致。[Lip Gloss width, wrapping, and measurement](https://github.com/charmbracelet/lipgloss#enforcing-rules)

**对 Pi Stuff 的含义：** “完整 segment 流到下一行”是正确的，但“宽屏展示顺序”不能同时充当“窄屏保留优先级”。两者应分开。

### 1.4 性能上应事件驱动、可取消、可缓存、失败可退化

Claude Code 在 session start、assistant message、compact、permission/vim mode 变化时触发更新，对快速连续变化做 300ms debounce，新变化会取消仍在运行的旧 statusline 命令；固定 `refreshInterval` 只推荐给时钟或主 session 空闲时仍会变化的外部数据。官方同时要求输出短、缓存昂贵操作，并指出慢脚本会让 Statusline 变旧。[Claude Code update lifecycle](https://code.claude.com/docs/en/statusline#how-status-lines-work)；[Claude Code tips](https://code.claude.com/docs/en/statusline#tips)

Starship 给目录扫描和外部命令分别设置 30ms 与 500ms 默认 timeout；Oh My Posh 支持 segment timeout，以及按 session、folder/repository、device 三种作用域缓存。其 streaming 模式先显示 prompt，慢 segment 使用 placeholder，约 100ms 是官方建议的起点；后台服务失败后会回退到普通渲染。[Starship prompt options](https://starship.rs/config/#prompt)；[Oh My Posh segment cache](https://ohmyposh.dev/docs/configuration/segment#cache)；[Oh My Posh streaming](https://ohmyposh.dev/docs/configuration/streaming)

Bubble Tea v2 的 renderer 会跳过无变化的 flush，并在支持的终端使用 synchronized output 让更新原子呈现；其设计重点同样是“状态变化后声明新 View”，不是让 View 自己做 I/O。[Bubble Tea releases](https://github.com/charmbracelet/bubbletea/releases)

**对 Pi Stuff 的含义：** 当前 Git 仅在 `turn_end` 后异步运行一个有 timeout 的只读命令、render 本身不启动 subprocess，是正确架构。后续若需要解决 background Agent 空闲期间 Git 变旧，应监听 Agent 完成/状态变化再刷新；只有没有可用事件时，才在“确有活动 Agent”期间做低频定时刷新，不应永久轮询。

### 1.5 颜色和分隔符应服从终端，而不是制造主题

Claude Code 的自定义主题按 `inactive`、`subtle`、`success`、`warning`、`error` 等语义 token 控制 UI；Lip Gloss 会根据终端能力自动把 truecolor 降级到 ANSI 256、ANSI 16，甚至无颜色，并可针对明暗背景选择颜色。[Claude Code terminal themes](https://code.claude.com/docs/en/terminal-config#create-a-custom-theme)；[Lip Gloss color downsampling](https://github.com/charmbracelet/lipgloss#automatically-downsampling-colors)

Oh My Posh 明确记录了 Powerline glyph 在 Git Bash 等环境中会因为宽度计算而破坏长输入和历史搜索，普通 plain style 则没有这类色块/分隔符耦合。[Oh My Posh segment styles](https://ohmyposh.dev/docs/configuration/segment#style)

**对 Pi Stuff 的含义：** 当前使用 Pi semantic theme token、简单 ` | `、Nerd Font 自动检测加 ASCII fallback 是比硬编码旧配色和 Powerline 三角块更稳的选择，应继续保持。

## 2. 当前 Pi Stuff Statusline 的实际状态

当前生产实现及其说明见 [statusline.ts](../../packages/pi-stuff-ui/statusline.ts) 和 [Pi Stuff UI README](../../packages/pi-stuff-ui/README.md)。真实 PTY 对照见 [parity report](../prototypes/tui/final-ui-review/statusline/parity-report.html)。

现有行为包括：

- 一格左右外边距与 dim ` | ` 分隔；
- `model → think → cwd basename → Git → context → cache input → cost → selected extension statuses`；
- Status segment 以完整单元流入第二状态行；
- 最近一次 user prompt 最多占两行，并隐藏展开的 Skill XML、本地路径和指令正文；
- Nerd Font 与 ASCII fallback；
- Context 在 `>70%` 使用 warning、`>90%` 使用 error，其他状态保持 dim；
- autocomplete 或共享 Command Dialog 占有输入区时隐藏 Statusline；
- Git 在 `turn_end` 后异步刷新，绑定测量时的 cwd 与 branch，过期结果不会冒充当前结果。

### 2.1 做得好的部分

| 维度 | 评价 | 原因 |
| --- | --- | --- |
| 视觉语法 | 保留 | 与旧 Footer 相符，但颜色已改为 Pi semantic tokens |
| 条件显示 | 保留 | zero/unsupported/unmetered 数据不制造占位噪音 |
| 终端兼容 | 保留 | cell width、ANSI-aware wrap、Nerd/ASCII fallback 都已覆盖 |
| UI 协作 | 保留 | autocomplete、Permission/Command Dialog 期间主动让位，与 Claude Code 的临时隐藏策略一致 |
| 数据边界 | 保留 | Skill payload 不泄露；Git snapshot 与 cwd/branch 绑定 |
| 性能模型 | 基本保留 | render 纯计算；Git 后台、有 timeout、过期数据不提交 |

### 2.2 最明显的设计缺口

当前 `renderStatusRows()` 使用“从左到右取能放下的连续前缀”的策略。第一次放不下后，后续 segment 全部进入下一行；第二行仍按同样顺序处理。它确保了旧样式的稳定顺序，却把**显示顺序误当成了信息优先级**。

真实 [`32 × 18` PTY 帧](../prototypes/tui/final-ui-review/statusline/parity-artifacts/pi-0.83-statusline-parity-fresh-32x18.txt) 是：

```text
  ui-pty-model | think:med
  验证 |  main
```

Context 完全消失。可是 Claude Code 官方把 context 列为 Statusline 的核心用途，Starship 的 Claude profile 也把 context 放在默认四项中。[Claude Code Statusline](https://code.claude.com/docs/en/statusline)；[Starship Claude Code profile](https://starship.rs/advanced-config/#statusline-for-claude-code)

这不是旧样式复现错误，而是响应式信息层级还可以更成熟。

## 3. 推荐的目标规则

### P0：立即建议采用

#### 3.1 宽屏顺序不变，窄屏改为语义优先级

宽屏继续保持旧配置的顺序和样式。只有空间不足时，按以下优先级决定保留内容：

| 优先级 | Segment | 理由 |
| --- | --- | --- |
| P0 | Model、Context、危险/异常状态 | 决定本 session 的身份与健康；Context 不应被前面的长文本挤掉 |
| P1 | Git branch + dirty counts、cwd | 决定代码工作对象与变更状态 |
| P1 | Thinking level | 会改变模型行为，但紧急程度低于 context |
| P2 | Cost、cache input | 有价值的计量信息，不应挤掉工作状态 |
| P3 | Goal / MCP / Loadout | Suite 姿态信息，只在空间允许时出现 |
| P3 | Latest prompt preview | 保留旧 Footer 特性，但在极窄屏最先隐藏或压成一行 |

推荐的用户可见结果：

```text
# 宽屏：保持当前旧 Footer 语法
  Sonnet 4.5 | think:high |  pi-stuff |  main *2 ?1 |  68.4%/200k 󰁨 |   18k | $0.42

# 中等宽度：先保住 session 身份、context 和 Git
  Sonnet 4.5 |  68.4%/200k 󰁨 |  main *2 ?1
  pi-stuff | think:high

# 紧凑宽度
  Sonnet 4.5 |  68%
  main *2 ?1

# 极窄宽度：核心信息仍不消失
  Sonnet |  68%
```

这不是简单设置四个硬断点。实现可以继续按实际 cell width 计算，但每个 segment 需要 `full / compact / omitted` 三种投影，并把“排序”与“保留优先级”分开。

#### 3.2 单个长 segment 先自我缩短，不得拖走其后的核心 segment

Starship 的 Claude model module提供 model alias，Claude Code 官方也明确要求保持输出短，否则会截断或笨拙换行。[Starship model aliases](https://starship.rs/advanced-config/#claude-model)；[Claude Code tips](https://code.claude.com/docs/en/statusline#tips)

建议：

- model：宽屏显示 display name；紧凑模式自动缩成稳定 family 名，例如 `Sonnet 4.5`；再窄才 ellipsis；
- cwd：宽屏 basename；紧凑模式可直接省略，不改成难读的半截路径；
- branch：优先保留 dirty counts，超长 branch 中部省略，例如 `feature/…/auth`；
- extension status：整段省略，不在内部截成无法理解的残句；
- prompt：仍按 cell width wrap，但窄屏最多一行，Skill badge 保持原子性。

#### 3.3 Context 未知必须是显式未知态

Claude Code 说明 context 字段在首个 API response 前可能为 `null`，并要求处理 fallback；它同时建议直接使用官方计算的 `used_percentage`，不要自己推算另一套值。[Claude Code null fields and context percentage](https://code.claude.com/docs/en/statusline#troubleshooting)

建议在 Pi 能提供 context window、但暂时不能提供准确 used percentage 时显示：

```text
  ?/200k
```

不要显示 `0.0%/200k`，也不建议整段消失。未知态能避免用户把“尚无准确数据”误解为“刚完成 compact、context 已空”，并让布局在 compact 前后更稳定。

### P1：建议在真实使用后决定

#### 3.4 保留数值 Context，暂不默认增加进度条

Starship 的默认 Claude context gauge 只有 5 cells，并支持阈值着色；Claude Code 的多行示例使用 `<70 / 70–89 / ≥90` 的 green/yellow/red 阈值。[Starship context gauge](https://starship.rs/advanced-config/#claude-context)；[Claude Code multi-line example](https://code.claude.com/docs/en/statusline#display-multiple-lines)

Pi Stuff 当前的 `68.4%/200k` 比 gauge 更精确，也更符合旧 Footer。建议继续使用数字，保留 warning/error 阈值，但正常状态维持 dim 而不是用绿色抢注意力。若以后提供 compact density，进度条可作为可选样式，不应成为默认样式。

#### 3.5 Latest prompt 保留旧行为，但作为最低优先级信息

Claude Code 官方 Statusline 数据没有“最近 prompt”字段，其推荐示例也不把 prompt 重复到底部；多行 ANSI 输出还更容易出现渲染问题。[Claude Code available data](https://code.claude.com/docs/en/statusline#available-data)；[Claude Code display glitches](https://code.claude.com/docs/en/statusline#troubleshooting)

但 Latest prompt 是旧 Pi 配置的明确特征，当前实现又已经安全去除 Skill 展开内容。因此建议：

- 现阶段默认继续开启，避免再次偏离旧 Footer；
- 宽屏最多两行；中等宽度最多一行；极窄宽度隐藏；
- 若真实使用发现 Footer 占高，再在统一 `/ui` 中增加一个 `Latest prompt` 开关，而不是立刻删除。

#### 3.6 Extension status 只表达“姿态”，不表达活动流

Pi 的 `setStatus()` 是持久状态通道；`pi-footer` 与 `pi-inline-statusline` 都允许 Footer 消费其他扩展发布的状态，但是否展示、摆在哪里应由 Footer 决定。[Pi setStatus](https://pi.dev/docs/latest/extensions#widgets-status-and-footer)；[pi-footer extension statuses](https://pi.dev/packages/pi-footer#pi-extension-statuses)；[pi-inline-statusline extension statuses](https://pi.dev/packages/pi-inline-statusline#extension-status-examples)

当前只接 Goal / MCP / Loadout 是合理上限。进一步建议：

- 它们永远不能挤掉 model/context/Git；
- 正常静态值仅在宽屏显示；异常值或需要用户注意的值可以提高一级；
- 不接受 Agent 数量、Todo 数量、BTW ready、Tool running timer、Permission mode 等新常驻项；
- 同一事实只能在一个 UI 表面出现。

#### 3.7 Background Agent 改动 Git 时做事件刷新，不做永久轮询

Claude Code 只有在 background subagent 会让外部数据在主 session 空闲时变化时，才建议配置 refresh interval。[Claude Code refreshInterval](https://code.claude.com/docs/en/statusline#manually-configure-a-status-line)

Pi Stuff 后续会有 background Agents，因此当前仅依赖 main `turn_end` 的 Git refresh 可能在主 session 等待时短暂陈旧。推荐顺序：

1. child Agent 完成、切换 worktree、或明确 Git-writing tool 完成时触发 refresh；
2. 多个快速事件合并为一次更新；
3. 新 cwd/branch 使旧结果失效；
4. 仅当没有可靠事件时，在“存在活动 Agent”期间低频刷新；
5. Statusline 关闭时不做任何 probe。

### P2：可选设置，不建议现在扩大范围

`pi-footer` 证明 segment builder、preset、颜色编辑、live preview 都可以实现，但它也形成了一套独立产品级配置器。[pi-footer configuration UI](https://pi.dev/packages/pi-footer#configuration-ui)

Pi Stuff 的目标是统一体验，不是成为 Footer builder。若 `/ui` 后续需要更多控制，建议最多增加：

- `Statusline density: Auto / Full / Compact`，默认 `Auto`；
- `Statusline icons: Auto / Nerd Font / ASCII`，默认 `Auto`；
- `Latest prompt: On / Off`，默认 `On` 以保持旧配置行为。

不建议开放字段任意排序、每段颜色、separator 编辑、任意 shell command segment。那会破坏统一 UI，也把性能和安全责任交给配置。

## 4. 明确不建议采用的方向

### 不做右对齐区

Starship 的 right prompt 依赖 shell 支持且只能占输入所在的单行；Oh My Posh 必须为左右冲突额外定义 break/hide，交互式 shell expansion 还会破坏宽度计算。[Starship right prompt](https://starship.rs/advanced-config/#enable-right-prompt)；[Oh My Posh block overflow](https://ohmyposh.dev/docs/configuration/block)

Pi Stuff 已有 editor、autocomplete、Command Dialog 和低宽度要求。左侧连续 flow 更可预测，不值得为了“看起来像桌面状态栏”引入右侧碰撞。

### 不做彩色 Powerline block、渐变或粗背景

这会偏离 Claude Code 的克制 TUI，也会增加 glyph width、主题适配和 ANSI 重绘风险。Oh My Posh 已记录 Powerline glyph 在部分终端会破坏长输入；Claude Code 也指出复杂 ANSI 与多行组合更容易发生显示异常。[Oh My Posh Powerline warning](https://ohmyposh.dev/docs/configuration/segment#style)；[Claude Code display glitches](https://code.claude.com/docs/en/statusline#troubleshooting)

### 不增加时钟、TTFT、speed、active tools、行数改动等默认字段

这些数据在特定用户场景中有价值，因此通用 Footer 包会提供，但它们不是 Pi Stuff 当前工作流的核心。默认增加只会挤压 model/context/Git，并让底部持续变化。需要时应在专门视图或未来可选 density 中出现。

### 不让每个 Package 自己占 Statusline

Pi 的 `setStatus()` 可以同时接收多个扩展状态，但 Pi Stuff 的统一 Footer 必须拥有最终选择权。否则会重现多个插件同时投影同一活动、底部持续增长的问题。[Pi setStatus API](https://pi.dev/docs/latest/extensions#widgets-status-and-footer)

## 5. 推荐验收方式

修改响应式策略后，不需要重做整套 Statusline，只需验证以下行为：

1. `100 / 80 / 64 / 48 / 32 / 24` columns 的真实 Pi PTY；
2. 长 model、长 branch、CJK cwd、emoji、Nerd Font 与 ASCII；
3. context `unknown / 0 / 69.9 / 70 / 89.9 / 90 / >100`；
4. clean/dirty/detached/unborn Git，以及 Git timeout/失败；
5. metered、OAuth/subscription、零 cache、极大 cache；
6. 无 prompt、长 prompt、多 Skill prompt；
7. autocomplete、`/ui`、Permission、BTW、Agents panel 打开与关闭；
8. main turn 与 background Agent 同时改变 Git；
9. 每行 `visibleWidth <= terminal width`，任何单个长 segment 都不能让整个 Statusline 变空；
10. resize `100 → 32 → 100` 后内容和颜色完全恢复，无空白残影。

## 6. 最终推荐决策

如果只采纳一个改动：**保留当前样式，把窄屏布局从“按顺序溢出”改成“按重要性降级”。**

最终应形成如下稳定规则：

> 宽屏像旧 Footer；窄屏像 Claude Code：先告诉我模型和 context，再告诉我 Git；普通状态安静，异常状态才变亮；慢数据永不阻塞输入；任何插件都不能把自己的活动塞进统一 Statusline。

这会让 Statusline 在视觉上继续是用户已确认的旧配置样式，同时在实际长期使用中比旧配置更稳、更安静，也更适合 Pi Stuff 后续加入 Agents、Todo、BTW、Memory 与 Permission 等能力。

## 主要一手来源

- [Claude Code: Customize your status line](https://code.claude.com/docs/en/statusline)
- [Claude Code: Configure your terminal](https://code.claude.com/docs/en/terminal-config)
- [Pi: Extensions](https://pi.dev/docs/latest/extensions)
- [Pi: Interactive mode / built-in Footer](https://www.npmjs.com/package/@earendil-works/pi-coding-agent?activeTab=readme)
- [Pi source: Extension UI types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- [Pi package: pi-inline-statusline](https://pi.dev/packages/pi-inline-statusline)
- [Pi package: pi-footer](https://pi.dev/packages/pi-footer)
- [Starship: Configuration](https://starship.rs/config/)
- [Starship: Claude Code Statusline](https://starship.rs/advanced-config/#statusline-for-claude-code)
- [Oh My Posh: Segment](https://ohmyposh.dev/docs/configuration/segment)
- [Oh My Posh: Block](https://ohmyposh.dev/docs/configuration/block)
- [Oh My Posh: Streaming](https://ohmyposh.dev/docs/configuration/streaming)
- [Bubble Tea](https://github.com/charmbracelet/bubbletea)
- [Bubble Tea releases / renderer behavior](https://github.com/charmbracelet/bubbletea/releases)
- [Lip Gloss](https://github.com/charmbracelet/lipgloss)
