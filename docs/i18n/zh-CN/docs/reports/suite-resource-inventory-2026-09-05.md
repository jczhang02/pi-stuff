<!-- translation-source: docs/reports/suite-resource-inventory-2026-09-05.md; translation-source-sha256: 9dad9deecece3d0e7d0711471196f416b86edf6e905e178a0159b8145a69980b -->

# Suite 资源源码清单

这份 2026-09-05 清单覆盖 `07d2f473` 的 [suite.json](../../../../../packages/pi-stuff/suite.json) 中全部 16 个
Capability，以及共享加载、状态和注册路径。它记录待调查对象，不授权删除功能。
[连续观察器](suite-responsiveness-observer-2026-09-05.md)及下文 MCP／RTK 样本记录了工作负载成本；
表中各项源码操作的独立成本仍未量化。
发现、校验、恢复和可见刷新可能需要重复执行；重复操作不自动等于浪费。
Beads `ps-yon.3` 按 [ADR 0030](../adr/0030-remove-redundant-suite-work-without-feature-cuts.md) 跟踪缺失的测量。

## 所有者、触发条件与增长变量

`B` 表示 Session 分支条目，`T` 表示对应所有者的工具或任务数，`P` 表示载荷字节数。
保留策略仅描述已观察到的保护，不代表完整内存上限已经认证。

| Capability / 源码所有者 | 触发条件与待测工作 | 增长变量；已有复用或释放 |
| --- | --- | --- |
| Conversation UI — [SessionStatusSource](../../../../../packages/pi-stuff/src/conversation-ui/statusline-session.ts) | 状态行重绘读取 Session/叶节点；叶节点变化时向上查找到已缓存条目。 | 相同叶节点复用状态；新尾部按条目数增长。Session 切换重置祖先缓存；长 Session 的保留量待测。 |
| Session Naming — [controller](../../../../../packages/pi-stuff/src/session-naming/controller.ts) | 收尾/手动命名读取分支并选择消息；首次可能扫描完整分支。 | O(B)；后续选取六条消息。每条提示文本有上限，模型尝试有超时；保留自动命名。 |
| Tool Display — [ToolGroupProjection](../../../../../packages/pi-stuff/src/tool-display/group-projection.ts) | 结构性变化重建 envelope/group 索引；单成员更新也有增量路径。 | 有界 transcript 投影；测量重建频率与复制载荷，不能只数最终行数。 |
| Tool Display — [活动时钟](../../../../../packages/pi-stuff/src/tool-display/activity-clock.ts) | 活动定时器每 600 ms 更新标记并协调 leader。 | O(活动定时器)，状态上限 768；无定时器时停止。动画是功能成本。 |
| RTK — [RtkRuntime](../../../../../packages/pi-stuff/src/rtk/runtime.ts) | 每个符合条件的命令在证书查找后调用 `assertStable`，解析路径、stat 并哈希可执行文件。 | 每次 O(可执行文件字节数)；证书复用没有消除此读取。优化必须保留漂移检测。 |
| Codex — [自动用量](../../../../../packages/pi-stuff/src/codex/index.ts)、[HTTP 读取](../../../../../packages/pi-stuff/src/codex/usage.ts) | 用户工作收尾后刷新用量，读取并解析响应。 | O(P)；并发刷新合并。网络行为是功能成本，重复实现工作另测。 |
| Goal — [计量](../../../../../packages/pi-stuff/src/goal/src/accounting.ts) | 收尾、命令、菜单和压缩路径的用量更新读取并扫描完整分支。 | 每次 O(B)；此处未发现增量用量缓存。必须保持 token 计量正确。 |
| Goal — [持久化](../../../../../packages/pi-stuff/src/goal/src/persistence.ts) | Session 启动/重载选择最新规范或旧版 Goal 条目并规范化。 | O(B + 队列)；Goal 队列有界。重放必要，重复成本另测。 |
| Context Management — [投影](../../../../../packages/pi-stuff/src/context-management/projection.ts) | Context/Provider 激活投影消息；相同键的并发请求共享工作。 | 随消息载荷增长；Provider 缓存匹配模型及有序消息身份。失效清除投影和进行中请求；保留映射及冷重建待测。 |
| Context Management — [Worker 快照](../../../../../packages/pi-stuff/src/context-management/magic-worker-host.ts) | 激活及事件派发序列化 Host 上下文和工具元数据。 | O(P + 工具 schema)；省略执行结束的 result/details，并过滤调用参数。重复传输 schema 待测。 |
| Ponytail — [指令](../../../../../packages/pi-stuff/src/ponytail/instructions.ts)、[状态](../../../../../packages/pi-stuff/src/ponytail/state.ts) | 首次 Skill 使用读取规范正文；Session 启动恢复模式和设置；生成提示时过滤 Skill 目录。 | 正文缓存一次，所有者使用 WeakMap。Session 通知身份 Set 的生命周期待查，尚不能称为泄漏。 |
| Web — [存储](../../../../../packages/pi-stuff/src/web/runtime/storage.ts) | 搜索/抓取持久化结果；Session 启动/树变化从分支恢复引用。 | O(B + P)；一小时 TTL，关闭时清空。TTL 不等于峰值字节上限。 |
| Web — [实现](../../../../../packages/pi-stuff/src/web/runtime/implementation.ts) | 每次搜索/抓取快照设置并发布结果；检索切片内容。 | 随查询/结果大小增长；设置快照可能服务实时配置。规范化与发布分别测量。 |
| MCP — [元数据缓存](../../../../../packages/pi-stuff/src/mcp/runtime/metadata-cache.ts)、[初始化](../../../../../packages/pi-stuff/src/mcp/runtime/init.ts) | 启动恢复缓存元数据，元数据收尾时序列化并写入工具/资源。 | 随元数据字节增长；版本、配置哈希和七天时限使旧缓存失效。连接/断开执行另测。 |
| Background Work — [runtime](../../../../../packages/pi-stuff/src/background-work/src/runtime.ts)、[storage](../../../../../packages/pi-stuff/src/background-work/src/storage.ts) | 活动心跳持久化恢复元数据；恢复枚举所属目录并核验进程身份。 | 随活动任务/所属目录增长；生产心跳五秒，空闲或销毁时停止。必须保留原子写入及所有权校验。 |
| Background Work — [Tasks 对话框](../../../../../packages/pi-stuff/src/background-work/src/tasks-dialog.ts) | 打开时接收状态变化并每秒刷新。 | O(任务)；销毁取消定时器。它不是常驻 250 ms 轮询。 |
| Agents — [发现](../../../../../packages/pi-stuff/src/subagents/src/agents/agents.ts) | 启动/刷新及启动 Agent 时，通过 awaited 目录操作和文件读取发现定义。 | O(文件 + Markdown 字节)；此处无发现缓存。异步 I/O 会耗资源，但不一定同步阻塞 UI。 |
| Agents — [公开执行](../../../../../packages/pi-stuff/src/subagents/src/extension/public-agent-execution.ts)、[结果监听](../../../../../packages/pi-stuff/src/subagents/src/runs/background/result-watcher.ts) | 首次执行导入前台执行器；后台结果结合文件事件和三秒安全扫描。 | 复用导入 Promise；结果处理去重，停止时清空监听状态。启动、收尾和恢复分别测量。 |
| Todo — [重放](../../../../../packages/pi-stuff/src/todo/state/replay.ts)、[存储](../../../../../packages/pi-stuff/src/todo/state/store.ts) | 启动/树变化/压缩重放扫描分支候选并校验快照和依赖；变更替换 Session 状态。 | O(B + 任务)；未发现重放缓存。Session 关闭时移除存储。校验是功能成本。 |
| Todo — [覆盖层](../../../../../packages/pi-stuff/src/todo/todo-overlay.ts) | 状态变化和渲染过滤/统计任务并保留近期完成状态。 | O(任务)；完成保留有时间限制，销毁时清理。合并重复扫描前先测量。 |
| BTW — [上下文](../../../../../packages/pi-stuff/src/btw/btw.ts)、[历史](../../../../../packages/pi-stuff/src/btw/btw-history.ts) | 调用转换有效分支，超限重试重新适配；恢复扫描条目，交流记录复制/过滤并限制历史。 | O(B + P)；上下文容量限制，历史最多 1,000 次交流/8 MiB。Session 关闭释放历史。 |
| Notification — [runtime](../../../../../packages/pi-stuff/src/notification/runtime.ts) | 符合条件的工作收尾启动一个可取消宽限定时器，状态变化时取消。 | 未发现循环轮询；投递读取内存设置并输出终端序列。尚无重复热点证据。 |
| Code Mode — [Ledger](../../../../../packages/pi-stuff/src/code-mode/ledger.ts)、[规范化](../../../../../packages/pi-stuff/src/code-mode/ledger-state.ts) | 首次查找规范化记录并恢复值；普通分支推进只处理新增条目。 | 冷路径随 Ledger 字节增长，热路径随新增尾部增长。已复现冷路径 Spinner 失败，不重做已有热路径修复。克隆/JSON 往返待优化，保留 Host 记录所有权及校验。 |
| Code Mode — [Host 客户端](../../../../../packages/pi-stuff/src/code-mode/host/host-client.ts) | 执行构建工具 Map，并向共享 helper 发送定义。 | 随工具 schema 增长；共享启动 Deferred。重复定义传输与 helper 执行分别测量。 |

## 共享路径

| 所有者 | 触发条件与工作 | 已有保护 / 测量缺口 |
| --- | --- | --- |
| [Suite loader](../../../../../packages/pi-stuff/src/suite-loader.ts) | 加载/重载解析根路径，在导入缓存查找前计算源码树指纹。 | O(文件 + 源码字节)；指纹相同复用导入/安装，失败 Promise 被移除。改变漂移检测前测量未变更重载 I/O。 |
| [共享状态通道](../../../../../packages/pi-stuff/src/conversation-ui/statusline-channels.ts) | 发布时规范化并序列化新旧快照，再通知监听者。 | schema 小且固定，相同状态不重复通知。频率/成本待测。 |
| [工具注册](../../../../../packages/pi-stuff/src/tool-display/registration.ts) | 最终覆盖校验枚举工具；重载交接恢复缺失的历史定义。 | O(T)；提前返回、只恢复缺失项。覆盖校验和历史渲染必须保持正确。 |

## 仍需的证据

这完成了一轮源码清点，不是完整资源审计。每个所有者仍需执行适用的启动、空闲、长 Session、工具/Agent、
收尾和恢复工作负载，记录成本及处理结论。仅看源码不能关闭疑似热点。统计必须包括子进程和 Context Worker。

连续前台和后台 Agent 观察已到达真实子 Agent 的 Tool 结果，并核验与出生身份绑定的进程退出。
两种模式在没有 Code Mode 和旧 Ledger 时均出现门槛失败。后台观察还检查父空闲时的输入/选择、规范完成
记录及通过 Code Mode 的两次启动。原生 Context 请求投影、记忆写入/检索现已有 scope CPU 和记账内存
测量，包括 Code Mode 带旧 Ledger 和不带旧 Ledger 的配对。资源观察器还记录 cgroup 当前直接成员的 RSS、
I/O，包含仍存活的 Code Mode 辅助进程；已等待回收子进程的 I/O 按内核规则汇总。这些快照不能确定累计
分配量、进程树 RSS 峰值或各所有者的重复工作。
恢复、完整资源维度和优化前后闭环仍未完成；参见[观察器报告](suite-responsiveness-observer-2026-09-05.md)。

普通 Goal 续跑也已取得两个真实 Host scope 样本，包含自动 Naming／Usage、成功的 Goal Tool UI，
以及先持久化规范完成状态再输出最终回复。两个样本均通过锁定门槛。其整进程计数不能分离 Goal 记账成本，
也不能认证 Goal 重放、压缩和恢复；这些调查仍未完成。

## 复用 MCP 和 RTK 验证器的测量

在 `02547c8b`，未修改的 [MCP 验证器](../../../../../scripts/verify-mcp-pty.ts)和
[RTK 验证器](../../../../../scripts/verify-rtk-pty.ts)均在精确认证的 Pi 0.85.0 可执行文件上通过。
外部 Bun 1.4.0 读取器继承 PTY 描述符，等待每个 Pi 子进程退出后读取 `child.resourceUsage()`。
现有验证器、连续观察器及产品源码均未改变。[数值记录](../../../../../docs/reports/suite-resource-inventory-2026-09-05.json)
用可执行文件、验证器、fixture 和读取器哈希绑定样本。第一次尝试因缺少 GNU `time`，在 Pi 启动前失败，
没有产生资源样本；随后改用已安装 Bun 的 API 取得计数。

执行命令为 `bun scripts/verify-mcp-pty.ts` 和 `bun scripts/verify-rtk-pty.ts`，`PI_BIN` 指向调用认证
Host 的外部读取器，`RTK_BIN` 选择认证 RTK 0.45.0。每个验证器均运行于
`unshare --user --map-root-user --net --pid --fork --kill-child --mount-proc`；MCP 只启用新网络命名空间的
loopback。私有配置和合成 Session 未触及正在运行的用户 Pi。

| 工作负载，按执行顺序 | 开始时间，UTC | CPU 秒数 | 子进程存活秒数 | Bun maxRSS，十进制 MB |
| --- | --- | ---: | ---: | ---: |
| MCP 浅色设置 | 08:26:44.840 | 6.279 | 7.808 | 734.966 |
| MCP 深色设置 | 08:26:52.707 | 5.011 | 6.521 | 737.624 |
| MCP 连接、工具和历史 Session | 08:27:05.025 | 10.384 | 12.831 | 835.863 |
| RTK 新会话执行 | 08:33:18.935 | 20.309 | 14.027 | 927.912 |
| RTK 重启和恢复 | 08:33:33.042 | 7.201 | 7.204 | 687.849 |

RTK 单独的 `--version` 预检消耗 0.498 秒 CPU，未加载 Suite。六个 Pi 子进程退出码均为零。
MCP 执行了本地 stdio 工具、HTTP 发现及正常终止、连接失败、经确认的配置修改，以及切换 Session 后
显示预置历史 Tool 结果；也断言打开对话框不会连接两个服务器。历史为预置数据，不是崩溃恢复轨迹。
RTK 执行了三条改写后的 Bash 命令和一条 1,600 行 ANSI 输出命令，再用新 Host 打开同一 Session，
验证原始历史未变，且有界模型投影完全相同。

这些是整段 Host 工作负载的计数，不是 MCP／RTK 成本归因或优化对比。
[Bun API](https://bun.sh/docs/runtime/child-process#resource-usage)以微秒报告 CPU、以字节报告 maxRSS。
原生已等待后代计账可能包含子进程工作；读取器、Expect、`script` 及同级 HTTP fixture 服务不在边界内。
maxRSS 不是进程树 RSS 总和的峰值；文件系统计数是操作数而非字节，上下文切换不是唤醒次数。
[Linux 计账契约](https://man7.org/linux/man-pages/man2/getrusage.2.html)说明了这些限制。
墙钟时间包含验证器主动等待交互的时间，不能当作界面卡顿指标。

两个验证器都使用离线 Provider；RTK 还显式禁用 Naming，并预先批准 Bash。它们不认证自动 Naming／Usage、
真实 OAuth、原生 Context 载荷或连续 Vibe Line／输入／选择门槛。
MCP 使用新的私有 HOME／XDG／Agent／项目／Session 目录，但未重置环境临时目录及源码缓存。
RTK 使用新的私有 HOME／XDG／TMPDIR，新会话和恢复共用 fixture 状态。两者均未重置内核页缓存。
不同主题及新会话／恢复工作负载不是成对优化样本。各所有者的重复工作、规模增长、崩溃恢复、分配／GC
及完整资源维度仍未完成。

### RTK 可执行文件读取归因

另一项诊断于 UTC 08:51:10 在 `dee4f81b` 启动，使用 strace 7.1 跟随精确 Host，只追踪指向认证 RTK
可执行文件的文件操作，再次执行未修改的 RTK 验证器。新会话和恢复验证均通过。新会话轨迹包含五次
完整读取，每次 10,326,432 字节；十次返回数据的 `read` 和五次 EOF 读取共向用户缓冲区交付
51,632,160 字节。另有五次 `O_PATH` 打开只检查身份、不读取内容；把每次打开都算作完整读取会让结果翻倍。
解析时将一次中断的读取与对应恢复返回合并。数值记录的 `rtkIdentityTrace` 保留轨迹／源码哈希及计数。

[runtime 所有者](../../../../../packages/pi-stuff/src/rtk/runtime.ts)解释了次数：`certify()` 读取一次，
`assertStable()` 在四次改写请求前各读取一次，包含 RTK 不返回替代命令的那一次。实际记录到一次版本探测、
四次改写执行和三次改写后的 RTK 命令执行。打开已经 ready 的对话框未增加读取；恢复 fixture 没有追踪到
RTK 可执行文件读取或执行。这排除了该测量序列中的额外认证，不代表所有并发工作负载都已排除。

按当前[漂移检测契约](../capabilities/rtk.md#runtime-验证)保留这些身份校验。既有 runtime 和认证
可执行文件测试在仓库 Bun 1.4.0 上通过：14 个测试、60 次断言，覆盖认证缓存、并发认证去重、路径变化和
文件原地变化。现有证据不支持为了减少读取而削弱契约，也没有证明完整 RTK 实现不存在可删除的工作。

strace 会改变调度。读取持续时间不是哈希 CPU 时间、主线程阻塞或 Vibe Line 活性；返回字节数不是物理
存储读取量或累计分配量。这些维度，以及 RTK 投影／节省统计的成本，仍待核实。本次归因未修改产品或验证器。
