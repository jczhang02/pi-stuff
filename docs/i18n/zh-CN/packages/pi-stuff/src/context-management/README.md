<!-- translation-source: packages/pi-stuff/src/context-management/README.md; translation-source-sha256: 8041549b2332454028b5e2f1ff077365ea7dc0c2587a5bbc8a8543c3b5c66c4e -->

# Context Management 模块

这是 Pi Stuff 的 Magic Context 适配器。当会话已经拥有可识别 Magic Context 配置且没有待迁移内容时，它会在编辑器就绪前完成精确官方模块、工厂、数据库和会话初始化。官方派生状态引擎在一个内部上下文引擎 Worker 中运行，使投影无需独占 Pi UI 线程；Pi 仍负责输入、对话记录渲染、会话、模型请求和 Agent 生命周期。适配器本身不渲染或刷新已提交输入。缺失或旧版配置保持休眠，直到直接使用能够授权创建或迁移。输入拦截只使过期投影失效，并可启动回退重试。Provider 与压缩边界在消费上下文前会防御性等待任何待处理重试。Pi JSONL 会话仍是原始权威；Magic 接管前派生本地存储不可用时，模块回退到 Pi 原生上下文路径。

Magic Context 0.40 会把扁平用户级 Historian 与 Dreamer 执行设置迁移到逐 Harness 块。Context 会在不修改文件的情况下检测这项待处理重写，延后无修改启动，并让官方工厂在直接使用后执行迁移。

该能力不暴露上游浮动 UI、状态栏条目、迁移提示或第二个 Todo 权威。Magic Context 的历史、记忆、搜索、笔记和 Historian 仍可在该边界后使用。Pi Stuff 负责一个 `/ctx` 命令界面：状态和操作使用共享命令对话框，维护进度持久化为对模型不可见的上下文活动。BTW 接收精确冻结的 Pi 分支及普通 Magic 轮次捕获的有界、仅引用项目记忆副本；全新 Agent 只接收项目记忆，分叉 Agent 可以接收有界父历史。Magic 自己的内部 Historian 进程不表示为 Pi Stuff Agent。

上下文管理不会创建任务锚点，不统计通用 Provider 轮次、工具或 Agent 委派，不阻止工具或套件发起消息，也不决定 Pi、Goal 或 Agents 是否应暂停、停止、完成或失败。每项所属能力保留自己的生命周期政策。

`index.ts` 是面向 Pi 的布线与公开外观，也是宿主侧激活和投影的 Effect runner；`runtime.ts` 仍是唯一生命周期与激活权威。`activity.ts` 负责持久上下文活动，`command-runtime.ts` 负责 `/ctx` 分派，`tool-presentation.ts` 负责 Magic 工具呈现。`projection.ts` 负责投影缓存与进行中工作，`projection-format.ts` 负责有界原生/Magic 投影。`magic-runtime.ts` 包含事件 Schema 和安静宿主代理。`magic-worker-client.ts` 是面向 Pi 的 Worker 适配器，负责 Worker 注册、Session 投影及其带 Scope 的 runner 边界；`magic-worker-transport.ts` 负责原生 Worker 获取、请求关联、取消与释放。

激活、Session 启动串行化、已提交引擎清理和投影 flight 都使用 Effect 原语，不再使用 Promise 自建队列。并发调用者共享一个激活 `Deferred`；若自动激活被延后，更强的直接使用触发会在释放等待者前胜出。激活会暂存注册、重放捕获的 Session 启动，并且只有完整计划成功后才提交；失败时运行暂存的关闭处理器，并继续让 Pi 原生 Context 保持权威。投影调用者共享按代际与键标识的 `Deferred`；失效会先让等待者回退到原生投影，再清除已发布的 flight，代际围栏则拒绝它的迟到结果。仅有两类启动后继续运行的程序——直接输入预热和已提交引擎的致命故障清理——由 `index.ts` 在当前 Pi Session signal 下启动；其他所有 Effect 程序都由发起它们的 Pi 回调或公开外观等待完成。

外部引擎依赖固定为 `@cortexkit/pi-magic-context@0.40.0`。仓库应用一个临时且经过审查的依赖补丁，使引擎在独立 Pi 中解析并预加载已安装 `ai-tokenizer`，并避免只为内容哈希而重新分词图像载荷；[UPSTREAM.md](./UPSTREAM.md) 记录补丁和删除触发条件。适配器抑制上游 Todo、状态栏、公告、命令和辅助 UI，同时在套件负责的 `/ctx` 分派器后保留五个维护处理器。它还会在官方引擎处理 `before_agent_start` 前，提供紧凑的面向 Provider 行为约定。因此引擎继续进行自己的提示词缓存处理，但跳过更长的默认指引；历史语义、检索、归约、记忆、笔记和开放回退行为保持不变。

Context 还负责其他能力使用的有序系统提示词贡献接缝。贡献由标记分隔并幂等协调：宿主/基础提示词在前，Magic Context 随后，已注册能力指令最后。Provider 请求回退覆盖 Pi 在没有 `before_agent_start` 时启动的继续轮次，它会重写已知 Anthropic、OpenAI、Google、Bedrock 和 Mistral 系统提示词载荷形态。遇到不受支持载荷时，开放通过并发送一条静默诊断，不修改未知请求形态。Ponytail 注册在最后的有序位置：需要时，其代码模式 Skill 目录位于当前模式指令之前。Ponytail 的常驻贡献独立于 Context 的 8,000 字符直接模式约定进行测量与限制。

适配器在激活期间把固定引擎打包成内存 Worker 产物，因为已验证的独立 Pi 二进制文件无法解析其外部 Worker 模块图。不把任何包写入磁盘。宿主事件、工具和命令仍注册在 Pi 中，并以不可变、字段受限快照跨越边界。Worker 首次绑定会话、检测到分支不连续后，以及执行显式历史重建命令时，会接收一份完整会话快照。普通上下文投影和持久化至多发送一个新叶节点，因此长会话不会在每次提示词时再次克隆。当前会话的 Effect Capability Scope 拥有 Worker 获取与初始化，每个事件、工具或命令请求由一个 operation Scope 拥有。中断会移除待处理请求并发送原生取消消息；Bun 打包、Worker 消息、Worker 侧 `AbortController`、同步共享内存副作用和终止仍留在狭窄的原生适配器内。致命 Worker 错误会立即让该能力返回原生 Context。宿主关闭先给予官方处理器一个有界宽限期，随后 Suite 最终 Effect hook 中断剩余请求、即使序列化队列卡住也只终止 Worker 一次，并撤销内存 URL。只有请求待处理时，宿主才引用 Worker，因此空闲引擎不会阻止 Print 或 RPC 进程走到普通退出路径。范围狭窄、逐项列举的宿主副作用和生命周期约定记录在 [ADR 0019](../../../../docs/adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md)。

已接受的 `/ctx` 可读性目标记录在 [`docs/adr/0008-own-the-context-command-surface.md`](../../../../docs/adr/0008-own-the-context-command-surface.md)。其 2026-08-17 更新已于 2026-08-18 实现。交付的单列对话框以用量为首，使用 `◆` 小节与语义状态图标，隐藏已知无操作项，并解释 Context 词汇。其操作列表和文本字段保留 Pi 原生 SelectList 与 Input 键盘行为，不拦截只读对话框别名。

套件负责的自定义 Agent 消息使用一个共享传输接缝。该接缝会在宿主冻结第一次请求前等待 Context 激活。Pi 0.84.4 不会为一个空闲 `sendMessage` 轮次发送 `before_agent_start`，因此当此类自定义消息是第一个 Agent 轮次时，普通 Magic `context` 转换只为该次 Provider 请求添加同样的紧凑指引。它不会写入 Pi JSONL，之后普通提示词会恢复到正常系统提示词注入路径。

第一次直接交互/RPC 激活（或显式 Context 投影）时，只有不存在可识别用户或项目配置，才写入保守用户配置；绝不覆盖现有配置。扩展发起的自动轮次只有在官方工厂没有旧版用户/项目配置待迁移时，才可使用现有 CortexKit 用户或项目配置。创建和迁移始终等待直接使用。精确源码与产物来源记录在 [UPSTREAM.md](./UPSTREAM.md)。

用户归属与直接使用权限有意不同。延迟完成可继续归属于用户原始 Agent 运行，用于状态栏和 Git 观察，但它会把 Context 作为自动工作激活，不能创建或迁移配置。只有当前交互/RPC 提示词、套件命令或显式套件 UI/RPC 操作携带一次传输的直接使用标记。

首次使用配置选择 Magic Context 官方词法搜索路径，不加载可选本地嵌入运行时，使初始激活保持小型，同时历史与记忆召回仍可使用。现有用户或项目嵌入配置仍是权威，绝不会重写。

## Pi 宿主约束

该边界有意在 Pi 扩展接口范围内工作：

- 事件、命令、渲染器和工具注册无法注销。因此 Magic 注册会暂存到激活成功后再提交；已提交事件处理器由所属运行时代际保护。
- Pi 不暴露活跃工具政策变化事件或修改来源。Context 激活期间绝不会向当前活跃集合添加名称；只能保持集合不变，或删除不可用的交接。激活失败后禁用的交接会保持禁用，直到外部政策或会话重载显式启用。
- 扩展上下文不暴露宿主标识。能力通过 `session_start` 观察到的 `sessionManager` 对象路由；未绑定上下文总是接收 Pi 原生行为，而非进程全局回退。
- Magic 工厂既不提供中止信号，也不返回处置器。重载会使迟到继续失效，并运行任何暂存关闭处理器；但 Pi Stuff 无法取消卡住的第三方工厂，也无法撤销该处理器注册前已发生的副作用。
- Pi 公开 token 估算是通用四代码单元启发式，不是模型特定分词器。因此安全关键 Agent 投影使用 UTF-8 字节长度作为与分词器无关的上界，并结合解析后的子模型与回退模型窗口和保守启动预留；精确 Provider 分词仍由 Provider 负责。
- Pi 0.84.4 会在 Tool result 之后、下一次 Assistant 请求之前执行原生阈值检查；Context 不复制这条 Host 路径。
- Pi 0.84.4 仍会跳过空闲自定义 `sendMessage` 轮次的轮次前原生压缩阈值检查。如果 Magic 保持休眠或不可用，Context 会读取 Pi 精确当前压缩设置，并且只有同一阈值已超出时，才在传输前运行公开 `ctx.compact` 回调边界。禁用的原生压缩继续禁用。因为公开 API 只暴露手动压缩，该安全预检由 Pi 报告为 `manual`；Goal 会识别进程内预检标记，不安排重复继续。宿主关闭会在其他 Context 工作使用的同一个有界关闭宽限期内等待进行中的预检。
- Magic 健康时手动 `/compact` 会记录一个扩展负责的 Pi 压缩边界，并带正面的受管历史结果。自动阈值或溢出压缩仍由 Magic 负责，并取消 Pi 原生摘要。Pi 0.84.4 通过原生 `session_compact_failed` 事件报告该取消；Goal 只使用匹配的待处理会话事件，替换它在 `session_before_compact` 暂停的继续。`session_compact` 仍是唯一成功路径。如果 Context 在尝试前已经降级，Pi 原生路径仍可用。如果活跃 Magic 压缩 Hook 本身失败，适配器会取消该尝试、报告失败并保持完整 JSONL，而不是在部分 Magic 尝试后叠加原生摘要。
- 官方引擎负责其持久消息索引。Context 激活会精确重放一次捕获的 `session_start`，使全新与恢复会话进入该索引生命周期。可识别且无需迁移的配置会在编辑器就绪前完成；休眠或降级重试则在替换运行时提交前事务式完成。
- 真实 Pi 验收会观察最终 Provider 请求，要求紧凑约定，拒绝上游冗长指引，并把直接模式系统提示词限制在 8,000 字符。这样可捕获依赖升级造成的提示词回归，而不把适配器耦合到私有引擎辅助函数。
