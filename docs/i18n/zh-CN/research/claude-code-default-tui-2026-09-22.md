# Claude Code /tui default: 工具子块与展开提示

[English](../../../research/claude-code-default-tui-2026-09-22.md) · [全部截图](../../../../prototypes/ui-session/default-reference/README.md) · [UI spec](../ui-spec.md)

## 之前漏测了什么

一次 Bash 调用可以有多个 `⎿`. 此前探针覆盖了短命令和运行中被中断的命令, 没有覆盖进度信息保留 timeout 的命令完成态. 因此, 之前的证据不能建立 "每个工具一个连接符" 的规则.

本轮使用本机官方 Claude Code 2.1.261. 每次保留的运行都实际输入 `/tui default`, 并记录 `Switched back to the classic renderer`. 该命令选择渲染器, 不是权限模式. 官方文档区分 classic 的原生终端滚动记录、详细记录视图与 fullscreen 的鼠标交互; 不能将 fullscreen 的点击限制移植到 Pi. [命令文档](https://code.claude.com/docs/en/commands), [渲染器比较](https://code.claude.com/docs/en/fullscreen#what-changes).

![实际切换到 classic 渲染器](../../../../prototypes/ui-session/default-reference/running-120/mode.png)

## 一次 Bash, 两个结果子块

命令运行 12 秒, 输出十二行进度, 输入明确指定 90 秒 timeout. 完成后, 输出前有一个 `⎿`, `(timeout 1m 30s)` 前另有一个. Ctrl+O 展开后两个标记仍在. 输出续行和隐藏行提示不增加连接符.

![完成态: 输出和 timeout 分别使用连接符](../../../../prototypes/ui-session/default-reference/running-120/compact.png)

![详细记录中仍有两个连接符](../../../../prototypes/ui-session/default-reference/running-120/expanded.png)

对照结果如下:

| 输入与执行                        | 完成态展示                           |
| --------------------------------- | ------------------------------------ |
| 快速命令, 明确指定 90 秒 timeout  | 一个输出块, 无 timeout 块            |
| 同一快速命令, 加长命令标题        | 仍为一个输出块                       |
| 12 秒命令, 明确指定 90 秒 timeout | 输出块和 timeout 块                  |
| 12 秒命令, 不指定 timeout         | 一个输出块                           |
| 一秒后实际超时                    | 一个错误块, 包含 exit 143 和超时文本 |
| 成功命令同时产生 stdout 和 stderr | 本样例合并在一个输出块               |

[索引及各场景交换记录](../../../../prototypes/ui-session/default-reference/README.md)保留输入与实际工具结果. 只读检查已安装发布版中的渲染实现, 可以解释前四项: Bash 结果路径从最后一个进度事件读取 timeout 元数据, 结果渲染器可以追加独立的 timeout 子块. 快速命令仅有显式输入并不足以触发它. 这是本版本的观察, 不代表普遍的时间阈值, 也不是 Pi 必须照搬的条件.

用户截图中的 `Allowed by auto mode classifier` 是另一个子块. 该截图的观察成立, 但本轮没有实际执行 classifier. Auto mode 属于 Claude 的权限系统, 不属于 Pi 结果布局的要求. [官方 auto mode 文档](https://code.claude.com/docs/en/auto-mode-config).

"每次调用一个连接符" 和 "stdout/stderr 各一个连接符" 都不能解释这些结果. 合适的布局单位是实际显示的子块: 第一行使用 `⎿`, 续行对齐到子块正文.

## default 模式的其他细节

| 场景                 | 收起态实测                                           | Ctrl+O 后                                        |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| 两行输出             | 全部显示, 无展开提示                                 | 工具正文不变, 全局详细记录界面变化               |
| 十二行输出           | 前三行及 `… +9 lines (ctrl+o to expand)`             | 全部十二行                                       |
| 长命令, 120 与 80 列 | 标题换到第二行后截断                                 | 完整命令标题                                     |
| 运行中的命令         | 新输出替换旧行, 附近保留耗时及已配置 timeout         | 本轮捕获普通运行态, 未覆盖全部运行中详细记录状态 |
| 成功但无输出         | `(No output)`                                        | 结果相同                                         |
| Exit 3               | 错误行及 stderr 共用一个块                           | 错误正文相同                                     |
| 小 Edit              | 增删计数、语法颜色及改动周围未变上下文               | Update diff 相同, 前面的 Read 恢复显示           |
| 大 Edit              | 在 72 行视口中完整显示替换二十行的 hunk 和周围上下文 | 未建立 Edit 一律限制六行的规则                   |
| Write 十五行         | 十行高亮源码及 `… +5 lines`                          | 完整正文                                         |
| Glob、Read、Grep     | `Searched for 2 patterns, read 1 file`, 无 `⎿`       | 三个独立结果                                     |

较晚的运行截图显示当时已经产生的输出中的滚动窗口. 完成后的收起视图回到结果开头. 这是本版本的实测行为, 不是通用的预览行数规则.

![运行中显示输出尾部和时间信息](../../../../prototypes/ui-session/default-reference/running-120/running-late.png)

![小 Edit 保留未变上下文](../../../../prototypes/ui-session/default-reference/edit-120/compact.png)

![此版本 Write 预览十行](../../../../prototypes/ui-session/default-reference/write-120/compact.png)

![classic 普通视图中的检索聚合](../../../../prototypes/ui-session/default-reference/retrieval-120/compact.png)

Ctrl+O 改变 Claude 的全局详细记录视图, 包括其他调用和时间戳. 按键前后截图不同, 不足以证明某个短工具增加了正文. Pi 的原生点击和 Ctrl+O 保持自身行为, 包括两种视觉状态恰好相同时仍可切换.

## 对 Pi Stuff 的修改建议

以下建议在研究阶段未修改原型. 用户随后批准实施, 当前行为与更新截图见 [UI spec](../ui-spec.md).

1. **落实已确定的展开文案.** 删除 `· expand` 和 `· collapse`. 只有收起态确实隐藏了仍可展开查看的输出时, 才在预览后显示 `n more lines`, 避免它与结果摘要挤在一起. 即使没有额外正文, 也保留原生展开能力. 长标题的省略号与输出行数分开处理.
2. **允许既有信息形成独立子块.** 结果摘要和输出保持在一起; 已配置 timeout、上游截断提示及日志路径可以另用一个 `⎿` 子块. 没有信息就不显示, 不预留空位, 不新增权限系统. Pi 0.85.1 的 Bash 已支持以秒为单位的可选 timeout, 并提供截断和日志路径信息; stdout/stderr 共用输出累积器, 不应人为拆分. 直接按输入显示 timeout, 比照搬 Claude 依赖进度事件的可见性更简单.
3. **长命令标题收起时允许两行.** 当前原型一行即截断. 两行能多显示实际命令, 同时限制占用; 展开保留完整标题. 续行对齐到命令正文.
4. **收起的 Edit 保留少量上下文.** 使用包含未变上下文的小 hunk, 避免只显示孤立改动行. 用户图中的三行改动, 若带上所在函数及闭合行, 更容易判断位置. 保留当前语法颜色和单列行号. 不照搬 Claude 大 hunk 的不限高度展示, 不引入第二套 diff 引擎, 仅使用真实结果已有的上下文.

保留既定 Write 三行预览、Bash 完成态前三行、运行态尾部、Thoughts 样式、Ls 聚合、原生用户消息、页脚与取消展示. 摘要继续使用确定性信息, 不解析测试输出. 不移植 classifier 文案、后台任务控制、Claude 状态栏及其全局详细记录交互.

## 方法、局限与复现

保留 16 组场景/宽度运行和 86 个画面. 每次使用独立的临时 HOME、Claude 配置和项目, 通过明确工具允许列表与 `dontAsk` 权限模式限定夹具工作. 本地 Anthropic 兼容 SSE endpoint 提供工具调用, 官方客户端实际执行 Bash/Read/Edit/Write/Glob/Grep, 返回结果后再收到 `PROBE_COMPLETE`. 没有真实模型推理、账户凭据、个人配置复制或宿主终端修改. 画面的计费与模型标签来自客户端的假 endpoint 配置.

[manifest](../../../../prototypes/ui-session/default-reference/manifest.json)记录二进制哈希、工具链、尺寸和图片哈希. 各场景保留精确输入、工具交换记录、模式确认、普通/详细/恢复态 PNG、文本和 gzip 压缩的原始 ANSI. 多数视口为 120×42; 长标题另测 80×42, 大 diff 使用 120×72 保留完整 hunk. 字体为 JetBrainsMono Nerd Font Mono、Symbols Nerd Font Mono、LXGW WenKai Mono. Claude 使用浅色主题, 隔离 PTY 设置黑色默认文字与白色默认背景. 图片是终端导出, 不是 compositor 截图.

复现时, 按各场景建立样例文件, 通过本地 Messages endpoint 返回其 tool-use 块, 在隔离配置中启动固定官方客户端, 输入 `/tui default` 后提交探针, 捕获 Ctrl+O 前后及恢复态. 两个慢脚本每秒输出一行, 共十二行, 只有一个指定 timeout=90000. 小 Edit 初始文件为三行函数; 大 Edit 定义 item1..item28, 修改 item4..item23. Write 创建十五行源码. 精确工具输入与返回值随截图保留.

初次探针暴露了环境问题: 假 API key 提示未处理、动画状态无法满足静止截图条件、LSP 推荐遮挡代码, 以及浅色客户端所在导出 PTY 的默认色仍为深色. 最终保留的运行正确处理 key 提示, 将运行态作为瞬时帧捕获, 拒绝推荐且不安装插件, 并在启动前设置隔离配色. 配色修正后全部重跑. 这些失败属于测试环境, 不是渲染器行为.
