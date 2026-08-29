<!-- translation-source: packages/pi-stuff/CHANGELOG.md; translation-source-sha256: c646ff31e19f8b80885464505aab0f0237960c7408fe5195b4f1d3e193d5a89e -->

# @jczhang02/pi-stuff

> 私有本地软件包的工程变更记录，不作为 npm 发布输入。当前宿主验证由 [`docs/compatibility.md`](../../docs/compatibility.md) 定义。

## 未发布

- 修补 Magic Context 0.40.0 打包后的分词器路径，使其搜索自身 Bun 模块祖先路径、在首轮前预加载，并避免对只用于哈希的图像载荷执行 BPE。这样可恢复精确 token 计数，又不会造成输入停顿或在 Pi 编辑器中出现原始 `[magic-context]` 回退警告。增加真实宿主 PTY 回归覆盖；等同官方版本通过验证后删除补丁。
- 把共享状态栏两行统一为一套语义明确、只用 Nerd Font 的图标语法，覆盖模型、Thinking、Context、额度、成本、Git、Goal、Prompt 与 Ponytail 状态标记。删除终端图标检测、Unicode/ASCII 回退和 `/ui` 状态栏图标设置；在内存中迁移 Schema v2 UI 设置，不产生启动写入。
- 增加 `@dietrichgebert/ponytail@4.9.0` 的功能完整内部分叉：四种持久会话模式、六个打包 Skill、自然语言停用、子 Agent 模式快照、Context 管理的提示词投影、合并设置、共享状态栏 `󱖿` 模式片段和 `/ponytail` 控制对话框。通过一个仅显式调用的 Frontmatter 适配保留经过审查的 MIT 上游 Skill 正文和来源，同时删除独立状态/活动与配置所有权。让 `off` 成为硬模型边界，并用活跃模式紧凑政策与目录替换重复完整 Skill 投影。为对话框、低视口、草稿与状态栏恢复、配置、环境变量覆盖、会话账本和 Provider 提示词边界增加专用真实 Pi PTY 验证。增加预登记、模式盲的 18 会话 ox-alpha 行为基准，带隐藏正确性与精确符号检验门槛；验证运行全部通过，测得汇总代码行 87 对 141（`p = 0.01953125`），总代价增加 31% token。增加经过完整性检查、非修改式的上游候选/差异审查命令，并把固定 npm 完整性修正为已验证注册表产物。见 ADR 0021。
- 在内部内存 Worker 中运行精确官方 Magic Context 引擎，使长会话投影和异常图像处理不独占 Pi UI 线程。增量镜像普通会话叶节点，不在每个提示词克隆完整分支；保留 Pi 原生输入和对话记录权威；保持工作动画流畅；释放空闲 Worker，使无头宿主正常退出；Worker 崩溃或超过关闭宽限时回退到原生 Context。见 ADR 0019。
- 把官方 Magic Context 引擎从 0.33.1 升级到 0.40.0，在 Schema v81 共享数据库上恢复 Context 所有权。生成逐 Harness 首次使用配置，把扁平用户配置迁移延后到直接使用，同时保留套件负责的 `/ctx` 界面和原生开放回退行为。
- 为用户与 Assistant 对话 Markdown 中完整 `chart` 和严格两空格 `tree` 围栏增加只用于显示的终端投影。无效、不完整、不安全、超限或过窄输入保留源码；Thinking、会话记录和 Provider 上下文保持不变。见 ADR 0017。
- 把全局 Pi Stuff 设置合并到 `<agentDir>/pi-stuff.json` 的单一 `pi-stuff.json`，每项能力负责一个顶层命名空间（`ui`、`tools`、`rtk`、`codex`、`notification`、`goal`、`codeMode`）。合并文件读写都使用普通 JSON（无 JSONC、无注释）；写入在整文件 flock 下生成规范制表符缩进 JSON。旧版逐能力文件（`pi-stuff-ui.json`、`pi-stuff-tools.json`、`pi-stuff-rtk.json`、`pi-stuff-codex.json`、`pi-stuff-notification.json`、`pi-goal.json`）曾一次性提升到合并文件并删除。见 ADR 0012。
- 增加全局代码模式默认值。`/codemode global on|off` 把套件级默认值持久化到合并文件 `codeMode` 命名空间；项目 `.pi/code-mode.json` 现在只记录相对全局默认值的显式差异。见 ADR 0009。
- 把紧凑检索组限制为原生 Read、Grep/Find 与 List。Bash、Web、MCP、媒体、修改、委派工作、生命周期工具和未知工具保持独立；每个新可见逻辑 Thinking 运行形成边界；基础设施问题在检索片段间保持可见。成功和活跃组占一行，问题组使用一行有界原因；活跃经过时间与稳定目标按宽度让位。删除成功纯 JavaScript 代码模式封装框架，同时保留嵌套工具、宿主媒体、会话/模型内容、`Ctrl+O` 与 `/tools` 检查约定。见 ADR 0022。
- 在不支持行内图像的终端中，用柔和、与对话记录对齐的预览说明替换原始图像 MIME 占位符，同时保留格式、尺寸和媒体顺序。
- 用单单元、文字轴居中的 `∗` Thought 标记、套件结果记录小圆点，以及每条 Assistant Markdown 消息的一个外层圆点，统一对话记录层级。每次 Bash 调用作为独立、经过截图验证的 Claude 风格 `Bash(<command>)` 操作块显示，在原生检索组旁带有界 `⎿` 输出；`Ctrl+O` 在同一块展开有界 Bash 命令与输出，不恢复通用 Pi 工具框架。
- 删除捆绑的 `general-purpose` Agent 定义。Subagents 现在只发现已安装 Pi 软件包、用户或当前项目提供的 Agent 定义。
- 增加原生 Catppuccin Latte、Frappé、Macchiato 和 Mocha 主题，并让剩余 MCP TUI 颜色使用 Pi 语义主题 token。
- 增加 Notification 模块：稳定工作完成/失败提醒、近期活动抑制、语义标题/正文、选择加入的响应预览、包括 Ghostty OSC 777 与 tmux 透传的终端原生传输、自有 `/notifications` 设置和对话框内测试操作，以及准确命名的终端 BEL 控制。
- 把套件合并为一个私有本地 Pi 软件包，含十五个命名内部模块。删除原逐能力清单、自有运行时依赖、版本同步、Changesets 和 npm 发布工作流，同时保留已接受安装顺序和 Pi 0.84.1 迁移基线。
- 增加选择加入的代码模式模块，以一个本地 JavaScript 封装替换活跃套件工具 Schema，同时保留原始工具执行、会话、媒体和 UI 行为。
- 把改编的 Web 与 MCP 实现吸收到所属模块。其固定上游修订、许可证正文、安全说明、原始文档和 Pi Stuff 差异记录都保留在源码旁。
- 用一次提取后软件包验证替换多归档发布验证；检查完整运行时资源集合，并演练真实 Pi 宿主、恢复路径、宽/窄 TUI、Magic Context、RTK、Web、MCP、Goal、Subagents、Todo、BTW、工具呈现与后台工作。
- 加固套件生命周期边界：把 Magic Context 配置迁移留在直接使用后；隔离 Subagent 清理与恢复状态；完整交互、RPC 或命令驱动 Agent 工作后只刷新一次状态栏 Git 观察，而扩展发起自动运行不探测 Git。只有 Pi 实际传输排队后续时才归属，并跨套件 Goal、Web、MCP、后台工作、Supervisor 与 Subagent 边界传播短暂用户/自动来源。历史用户归属与直接使用配置权限分开；把异步自定义消息传输限制到所属会话或 Goal；只有每个套件启动处理器都成功稳定后才释放已恢复 Goal 工作。
- 删除可避免的套件生命周期停顿：编辑器就绪前完成已配置 Magic Context 初始化；配置创建和迁移保持由用户触发；确认直接输入时不等待合成帧；跨 `/reload` 缓存未变化的生成套件运行时；用隔离真实 Pi 基准验证启动、重载、退出、首轮、稳态提示词和资源上限。
- 把 Magic Context 维护统一到一个可发现 `/ctx` 命令。增加套件负责的状态与操作对话框、嵌套参数和确认流程，以及对模型不可见、会话支持的上下文活动，同时隔离上游全局 UI。

## 0.3.3

### 补丁变更

- 更新依赖 [fce3e45]
  - @jczhang02/pi-stuff-todo@0.1.8

## 0.3.2

### 补丁变更

- e073e67：加固共享 TUI 呈现：低高度下保留必需命令对话框控制；使用可读语义颜色；如实报告 Agent 启动；行内确认 BTW 历史清除；删除无意义的窄工具目标碎片。
- 更新依赖 [e073e67]
  - @jczhang02/pi-stuff-agents@1.0.2
  - @jczhang02/pi-stuff-btw@0.1.7
  - @jczhang02/pi-stuff-codex@0.1.6
  - @jczhang02/pi-stuff-goal@0.2.6
  - @jczhang02/pi-stuff-mcp@0.2.6
  - @jczhang02/pi-stuff-rtk@0.2.6
  - @jczhang02/pi-stuff-todo@0.1.7
  - @jczhang02/pi-stuff-tools@0.1.7
  - @jczhang02/pi-stuff-ui@0.2.6
  - @jczhang02/pi-stuff-work@0.2.2
  - @jczhang02/pi-stuff-context@0.1.7
  - @jczhang02/pi-stuff-web@0.2.6

## 0.3.1

### 补丁变更

- 更新依赖 [16bbd08]
  - @jczhang02/pi-stuff-ui@0.2.5
  - @jczhang02/pi-stuff-agents@1.0.1
  - @jczhang02/pi-stuff-btw@0.1.6
  - @jczhang02/pi-stuff-codex@0.1.5
  - @jczhang02/pi-stuff-goal@0.2.5
  - @jczhang02/pi-stuff-mcp@0.2.5
  - @jczhang02/pi-stuff-rtk@0.2.5
  - @jczhang02/pi-stuff-todo@0.1.6
  - @jczhang02/pi-stuff-tools@0.1.6
  - @jczhang02/pi-stuff-work@0.2.1
  - @jczhang02/pi-stuff-context@0.1.6
  - @jczhang02/pi-stuff-web@0.2.5

## 0.3.0

### 次版本变更

- e56bba8：增加会话负责的后台 Shell 与一次性 Monitor 工具、全宽 `/tasks` 活动对话框、条件 Ctrl+B 前台交接、有界输出与进程树清理，以及只读运行中 Agent 投影。

### 补丁变更

- dd7bcb6：把必需 Web 与 MCP 分叉快照内化到 Pi Stuff monorepo，删除自有 GitHub Release 依赖，并保留已验证的窄适配器、来源、捆绑运行时闭包和降级行为。
- 47f2efd：用 Context 能力后的精确官方 `@cortexkit/pi-magic-context@0.33.1` 软件包，替换已废弃 Pi Stuff 自有 Magic Context 发布。保留延迟激活和遗漏的 `session_start` 重放；抑制重复 UI 与 Todo 界面；通过套件暴露聚焦诊断；引导非破坏性首次配置；强制一个压缩所有者，不在 Magic 尝试后叠加原生摘要。
- 更新依赖 [e56bba8]
- 更新依赖 [dd7bcb6]
- 更新依赖 [47f2efd]
- 更新依赖 [8d42a58]
  - @jczhang02/pi-stuff-work@0.2.0
  - @jczhang02/pi-stuff-agents@1.0.0
  - @jczhang02/pi-stuff-web@0.2.4
  - @jczhang02/pi-stuff-mcp@0.2.4
  - @jczhang02/pi-stuff-context@0.1.5
  - @jczhang02/pi-stuff-ui@0.2.4
  - @jczhang02/pi-stuff-btw@0.1.5
  - @jczhang02/pi-stuff-codex@0.1.4
  - @jczhang02/pi-stuff-goal@0.2.4
  - @jczhang02/pi-stuff-rtk@0.2.4
  - @jczhang02/pi-stuff-todo@0.1.5
  - @jczhang02/pi-stuff-tools@0.1.5

## 0.2.3

### 补丁变更

- 更新依赖 [bd6ae2d]
- 更新依赖 [2377f24]
- 更新依赖 [9da041a]
  - @jczhang02/pi-stuff-ui@0.2.3
  - @jczhang02/pi-stuff-rtk@0.2.3
  - @jczhang02/pi-stuff-todo@0.1.4
  - @jczhang02/pi-stuff-agents@0.2.3
  - @jczhang02/pi-stuff-btw@0.1.4
  - @jczhang02/pi-stuff-codex@0.1.3
  - @jczhang02/pi-stuff-goal@0.2.3
  - @jczhang02/pi-stuff-mcp@0.2.3
  - @jczhang02/pi-stuff-tools@0.1.4
  - @jczhang02/pi-stuff-context@0.1.4
  - @jczhang02/pi-stuff-web@0.2.3

## 0.2.2

### 补丁变更

- 在已安装模型试用后打磨真实日用 TUI：保持窄 Welcome 与 Codex 内容语义完整；从普通页脚删除 Goal 状态；显示持久 Goal 完成摘要与证据；避免小型 Agent 任务的浪费性嵌套委派；把 Magic 负责的手动压缩呈现为成功、可恢复边界；防止同步渲染时重复追加已稳定工具结果正文。
- 在保持 Pi JSONL 权威且不让可见实时尾部进入重复搜索结果的同时，恢复 Magic Context 压缩与冷恢复后的精确早期历史召回。
- 更新依赖
  - @jczhang02/pi-stuff-agents@0.2.2
  - @jczhang02/pi-stuff-codex@0.1.2
  - @jczhang02/pi-stuff-context@0.1.3
  - @jczhang02/pi-stuff-goal@0.2.2
  - @jczhang02/pi-stuff-tools@0.1.3
  - @jczhang02/pi-stuff-ui@0.2.2
  - @jczhang02/pi-stuff-btw@0.1.3
  - @jczhang02/pi-stuff-mcp@0.2.2
  - @jczhang02/pi-stuff-todo@0.1.3
  - @jczhang02/pi-stuff-web@0.2.2
  - @jczhang02/pi-stuff-rtk@0.2.2

## 0.2.1

### 补丁变更

- 更新依赖 [e44dfe7]
- 更新依赖 [9f26a85]
  - @jczhang02/pi-stuff-agents@0.2.1
  - @jczhang02/pi-stuff-goal@0.2.1
  - @jczhang02/pi-stuff-todo@0.1.2
  - @jczhang02/pi-stuff-tools@0.1.2
  - @jczhang02/pi-stuff-ui@0.2.1
  - @jczhang02/pi-stuff-web@0.2.1
  - @jczhang02/pi-stuff-codex@0.1.1
  - @jczhang02/pi-stuff-context@0.1.2
  - @jczhang02/pi-stuff-mcp@0.2.1
  - @jczhang02/pi-stuff-btw@0.1.2
  - @jczhang02/pi-stuff-rtk@0.2.1

## 0.2.0

### 次版本变更

- 563d427：增加自有 Goal 能力，带结构化证据门槛、活跃重载恢复、会话持久继续、Provider 错误恢复、不可禁用紧急后备限制和套件原生呈现。
- c26a3d7：增加延迟 Magic Context 能力，通过共享工具渲染器呈现其工具，并为 BTW 与子 Agents 提供有界、仅引用上下文投影，同时保留原生 Pi 开放回退行为。
- 34af590：增加开放回退 RTK 命令重写和只面向模型的工具输出投影，作为自有 Pi Stuff 能力。
- 14396c9：把有界 Web 读取/搜索和延迟纯代理 MCP 网关加入默认套件，包括共享工具渲染、非浮动状态 UI、自有不可变分叉和真实 Pi 0.83 传输验证。
- dcc49da：增加自有 Codex 能力：一个非浮动控制界面、真实 Fast 请求状态、订阅用量，以及共享渲染的应用补丁、图像查看和已确认 GPT Image 2 生成工具。
- 60ba544：删除 Permissions 能力及所有子 Agent 注入、批准转发、运行时依赖和发布产物。Pi Stuff 现在不增加权限或命令拦截层。
- f7037f1：让有界 Todo 摘要与对话输出对齐；用活跃分支缓存命中率替换缓存读取 token 计数；增加共享、仅观察的 Codex 每周/Fast 状态栏通道。

### 补丁变更

- f51759f：让 Goal 控制提示词保留在模型上下文，同时从 TUI 和渲染后 HTML 对话导出隐藏内部协议与所有权标记。
- 24de36a：让后台 Agent 完成离开模型轮次，并默认把 Agent 产物存到 Pi 会话旁。
- 更新依赖 [563d427]
- 更新依赖 [c26a3d7]
- 更新依赖 [34af590]
- 更新依赖 [14396c9]
- 更新依赖 [dcc49da]
- 更新依赖 [c7fc358]
- 更新依赖 [f51759f]
- 更新依赖 [24de36a]
- 更新依赖 [60ba544]
- 更新依赖 [3705d7a]
- 更新依赖 [f7037f1]
  - @jczhang02/pi-stuff-goal@0.2.0
  - @jczhang02/pi-stuff-ui@0.2.0
  - @jczhang02/pi-stuff-agents@0.2.0
  - @jczhang02/pi-stuff-btw@0.1.1
  - @jczhang02/pi-stuff-context@0.1.1
  - @jczhang02/pi-stuff-rtk@0.2.0
  - @jczhang02/pi-stuff-web@0.2.0
  - @jczhang02/pi-stuff-mcp@0.2.0
  - @jczhang02/pi-stuff-tools@0.1.1
  - @jczhang02/pi-stuff-codex@0.1.0
  - @jczhang02/pi-stuff-todo@0.1.1

## 0.1.0

### 次版本变更

- a921d13：增加当前会话前台与后台 Agents，带紧凑 Claude 风格生命周期 UI、有界会话级执行和所有深度根路由的破坏性命令保护。
- a60a399：增加自有一次性 BTW 能力和共享非浮动命令对话框协调器，包括 Todo 框架协调与阻塞界面抢占。
- 02dca12：增加自有会话 Todo 能力，包含四个 Task 工具、分支重放和有界编辑器上方清单。
- 9b5aa96：为全部七个 Pi 内置工具增加自有紧凑工具 UI、聚焦 `/tools` 详情，以及 Agent 与 Todo 工具共用的呈现约定。
- 4978806：增加普通宿主页脚，具备确定性窄宽度优先级压缩，并在命令对话框生命周期路径中精确恢复套件负责的页脚和工作行，不强制重放对话记录。
- e1ec84f：把自有权限强制能力加入默认 Pi Stuff 套件，包括所有深度 Agent 路由及不可用根的快速拒绝。
- 6241af8：以会话所有权和有界存储持久化 BTW 历史，增加历史导航、复制与清除控制，并允许把选中交互提升到新主会话。
- 9b5aa96：增加已确认 Welcome、实时 Thought、响应式状态栏、编辑器增强与统一 `/ui` 体验；暴露有界密度、提示词和图标控制；把工具运行计时器移入共享原生设置界面。

### 补丁变更

- 4fa6265：澄清 Agent 工具互斥的单个、并行与控制调用形态，并在执行前拒绝混合或已废弃启动字段。
- 在每个已发布归档中包含对应软件包 Changelog。
- 394fffb：为子 Agents 复用正在运行的独立 Pi 宿主，并让已接受的迟到引导输入跨终态输出排空保持有效。
- 更新依赖 [a921d13]
- 更新依赖 [a60a399]
- 更新依赖 [02dca12]
- 更新依赖 [9b5aa96]
- 更新依赖 [4fa6265]
- 更新依赖 [4978806]
- 更新依赖 [e1ec84f]
- 更新依赖
- 更新依赖 [6241af8]
- 更新依赖 [9b5aa96]
- 更新依赖 [394fffb]
  - @jczhang02/pi-stuff-agents@0.1.0
  - @jczhang02/pi-stuff-btw@0.1.0
  - @jczhang02/pi-stuff-todo@0.1.0
  - @jczhang02/pi-stuff-ui@0.1.0
  - @jczhang02/pi-stuff-tools@0.1.0
  - @jczhang02/pi-stuff-permissions@0.1.0
