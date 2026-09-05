<!-- translation-source: docs/reports/suite-resource-inventory-2026-09-05.md; translation-source-sha256: 2454904df7def4c793e712b18336f7afbe38098608bea54eb5a6ee47f8bd5f6e -->

# Suite 资源源码清单

这份 2026-09-05 清单覆盖 `07d2f473` 的 [suite.json](../../../../../packages/pi-stuff/suite.json) 中全部 16 个
Capability，以及共享加载、状态和注册路径。它记录待调查对象，不授权删除功能。
除[Ledger 冷加载复现](suite-responsiveness-observer-2026-09-05.md)外，下列路径的成本尚未量化。
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
