<!-- translation-source: docs/adr/0009-align-code-mode-with-openai-and-cloudflare.md; translation-source-sha256: 15684360dfb8f3dbd5075c7398c71dfea0de5d8f46a2d02e08c835fea11b8265 -->

---
status: accepted
---

# 使代码模式与 OpenAI 和 Cloudflare 对齐

## 背景

ADR 0005 证明：一个本地执行封装可以保留 Pi 工具行为和 UI，同时从 Provider 请求中移除重复工具 Schema。后来一个路由式原型把大部分工具保留在顶层，并在旁边增加代码模式。其验证基准比直接模式更差：Provider 可见工具为 23 个，首次请求估算为 9,907 tokens，而直接模式分别是 22 个和 9,573 tokens。该原型没有实现代码模式的主要收益。

本决策采用完整封装。Pi 仍是宿主，代码模式仍是 Pi Stuff 软件包中的一个能力模块，OpenAI Codex V8 Code Execution Runtime 仍是沙箱。Cloudflare Code Mode 是能力与 API 参考，不构成增加 workerd 或第二个宿主的理由。

## 决策

### Provider 界面

代码模式开启时：

- 所有活跃且由 Pi Stuff 软件包负责的工具都移到 `codemode` 后面，并可通过 `tools.*` 调用；
- Provider 从软件包只看到 `codemode` 和小型配套工具 `tool_search`；
- 另行安装且不由 Pi Stuff 负责的工具继续位于顶层，因为软件包无法安全地重新分派其私有实现；
- 后续注册或激活的工具会自动隐藏，无需逐工具路由声明。

代码模式关闭时，Pi 会得到完全相同的原始工具列表和顺序。代码模式只改变可见性。它不会赋予工具新的权限、绕过其校验，也不会判断其副作用能否安全重试。

工具虚拟化不得削弱由 Host 拥有的 Skill Discovery。当 `read` 在代码模式的虚拟 Tool 集中仍保持 active，且
Host 为一次 Agent 启动提供 Skill Discovery 输入时，Provider prompt 必须接收与直接模式相同、由 Host 加载且
允许模型调用的 Skill 名称、描述和位置。后续 provider-only continuation 可以复用该 Host snapshot。从未收到
Host snapshot 的 provider-only 自动首轮会 fail open，而不会重新发现 Skill 或依赖 Host 内部实现。代码模式
通过 Context Management 与 Pi 的公开 formatter 适配该目录；它不暴露顶层 `read`，也不改变 `--no-skills`、
resource enablement、`disable-model-invocation`、显式 `/skill` 或 custom-prompt 行为。

### 配置和对话框

代码模式使用一个布尔值，优先级从高到低如下：

1. 启动子 Agent 时捕获的 `PI_STUFF_CODE_MODE_FROZEN`；
2. 受信项目 `.pi/code-mode.json` 中的 `enabled` 覆盖；
3. `<agentDir>/pi-stuff.json` 中全局 `codeMode.enabled` 设置命名空间；
4. `PI_STUFF_CODE_MODE_DEFAULT`；
5. 内置默认值 `false`。

`/codemode on|off` 写入项目覆盖。`/codemode global on|off` 写入全局默认值。`/codemode` 命令对话框显示有效值及其来源，提供项目 `inherit|off|on` 和全局 `off|on`，并使用 Pi 原生 `SettingsList` 与共享命令对话框恢复约定。项目继承只删除其负责的 `enabled` 字段，并保留其他项目设置。

不受信项目不能提供或更改项目覆盖。被冻结的子 Agent 会显示冻结来源，且不能更改项目或全局设置。持久化完成后才能改变运行时投影；写入失败时继续显示最近的持久状态。会话启动和项目变化只读取配置。

不存在 `direct`/`programmatic`/`both` 调用方策略。该策略容易让每个新工具被错误分类，并继续暴露昂贵的 Schema。重放、批准、补偿和生命周期是彼此独立的副作用约定。未分类的软件包工具仍可通过代码模式使用，其保守重放策略默认为 `never`。

### 程序与发现约定

OpenAI 的 Programmatic Tool Calling 形式是规范形式：

- 使用带顶层 `await` 的普通 JavaScript；
- 通过 `tools.*` 进行嵌套调用；
- 通过 `text(...)`、`image(...)` 和其他受支持的输出辅助函数显式输出；
- 不直接访问 Node.js、Bun、文件系统、进程、模块、网络或凭据。

普通工具工作正常等待。对于带截止时间、可具体观察的命令、文件、日志或 HTTP 条件，应使用现有的一次性 Monitor，并只唤醒 Agent 一次；Bash sleep、状态轮询循环和反复对话轮询不是等待约定。

Pi 0.84.2 以 `codemode({ code })` 传输源码，因为它的公开工具 API 不暴露自由格式源码工具。该包装器不会建立第二种 JavaScript 方言。

Cloudflare 的 `async () => { return value; }` 形式和旧的 `suite.*` 命名空间继续作为兼容输入。只有程序没有调用输出辅助函数时，返回值才会输出，因此不会重复输出。`tool_search`、`codemode.search` 和 `codemode.describe` 读取同一个活跃本地目录和确定性排名。发现至少要求一个词法查询 token 匹配，绝不会用无关工具替代。顶层响应限制为 4,000 个字符，并依次降级为：带完整定义的有类型最高匹配及紧凑签名、仅签名、仅路径；`codemode.describe` 保留完整生成的 TypeScript 输入与结果类型。完整嵌套 Schema 留在 V8 内部，绝不进入 Provider 历史。

Pi Stuff 复用 `@cloudflare/codemode` 0.5.1 中与运行时无关的部分：源码规范化、Connector 搜索与描述、名称清理、JSON Schema 到 TypeScript 转换、代码片段、二进制与 bigint 编解码器、稳定重放序列化，以及聚焦的上游测试。精确内嵌源码、提交、软件包完整性、许可证和本地差异均记录在代码模式上游声明中。不导入仅适用于 Workers 的执行和 Durable Object 存储。

### 调用与宿主边界

每一个嵌套调用都经过套件工具注册表唯一的 `invoke()` 接缝。因此它会保留 Pi 参数准备与校验、`tool_call` 和 `tool_result` 钩子、权限提示、生命周期事件、流式更新、取消、工具活动、媒体、用量、动态激活的工具名和终止提示。代码模式绝不直接调用捕获的工具回调。返回结果显式带有 `isError: true` 时，嵌套 JavaScript 调用会被拒绝；未捕获的拒绝会停止该次执行，而普通 `try/catch` 可以有意恢复。

现有 Codex V8 Runtime 继续作为默认执行器。本地 workerd/Miniflare 没有必要，因为缺失的行为是 Connector、账本和批准约定，而不是 JavaScript 语法。用 Workers 运行时替换 V8，需要另一个决策，并需证明额外进程、RPC 桥、持久化和平台验证能改善必需行为。

V8 让出与继续仍是内部宿主协议。已让出的 cell 由运行时恢复，但 `yield_control` 不属于面向模型的辅助函数词汇，也不表示用户层面的完成。

### 持久副作用、批准与恢复

每次执行和嵌套调用都在仅追加的 Pi 会话账本中拥有稳定 ID。副作用约定必须明确：

- `never` 是默认值。恢复时可以提供已记录且已完成的结果；但含糊的未完成副作用不会自动重复，执行会变为 `incomplete`。
- `record` 存储并复用已完成结果。如果宿主丢失使调用未完成，执行会变为 `incomplete`，而不是猜测它是否运行过。
- `reexecute` 会在重放期间有意再次执行，并且只允许为可安全重复或受幂等保护的操作显式声明。
- `requiresApproval` 会在工具副作用前暂停，且不能与 `reexecute` 同时使用。

历史重放期间，如果持久化的有效嵌套结果显式带有 `isError: true`，即使旧封装记录为成功，内存中也会把它分类为错误。旧值保留为诊断证据；会话 JSONL 不会被重写，说明文字、缺失标志或异常结果数据都不会触发推断。

批准是持久状态，不是内存提示。首次遇到时，会追加一个待处理操作，并在不调用工具的情况下返回暂停结果。`/codemode pending` 显示执行 ID、序号、工具和参数。`/codemode approve <execution-id>` 重放先前已完成调用，把精确待处理操作转换为运行中调用，并执行一次。`/codemode reject <execution-id> <seq>` 终止该待处理操作，但不执行它。过期的批准或拒绝命令不会造成影响。

只有在同一个 Pi 会话、从已记录工作目录恢复，且待处理工具仍然活跃时才允许继续。目录变化或工具缺失会让执行保持暂停。程序不能吞掉批准信号后继续执行后续副作用：同一轮后续每个调用也会返回暂停，并且不会加入账本。

允许一次带类型的 V8 宿主丢失重试。已完成调用从账本重放；含糊且不可重放的副作用会变为 `incomplete`，并要求执行 `/codemode abandon`。`/codemode rollback <execution-id>` 只按逆序运行显式声明的补偿操作，绝不假装外部副作用已被抹除。陈旧的未完成和暂停工作会过期，终态历史有界；过大或不可序列化的值会失败，而不是近似存储。

Connector 生命周期钩子在每轮结束时运行，包括失败的宿主轮次和暂停等待批准的轮次。终态执行会以 `completed`、`error`、`rejected` 或 `rolled_back` 之一处置且仅处置一次。清理失败尽力处理，不能取代真实工具结果。

### Agents 与 RTK

每次前台、后台、并行、嵌套和恢复的 Agent 启动，都会冻结父会话的有效代码模式状态。子 Agent 获得显式 `on` 或 `off` 值，不修改全局 `process.env`；父会话后来切换设置不会改变已经运行的子 Agent。该冻结启动值优先于子 Agent 工作目录持久化的项目偏好。子 Agent 现有工具许可列表和权限上限仍会约束其本地目录。

RTK 仍然有用。代码模式移除 Provider 可见工具 Schema 和中间编排；RTK 减少嘈杂的 Bash 与搜索输出。嵌套 Bash 调用仍经过 `registry.invoke()` 和 Pi 的普通 `tool_call` 钩子，因此 RTK 可以像直接 Bash 调用一样重写它。

### 验证结果与发布门槛

已验证的 Pi 0.84.2 组合用例包含 Read、Bash、后台工作和 Agent 管理。同一个程序以直接和完整封装方式运行，并在会话恢复前后分别以 100 列和 64 列运行。只规范化真实的上下文使用量数字后，工具活动和完整 ANSI 屏幕完全相同。

当前测量结果为：

| 界面 | Provider 工具数 | 序列化工具 Schema | 估算首次请求 | 估算工具后请求 | 两次请求合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 直接 | 22 | 31,208 字符 | 9,573 tokens | 9,788 tokens | 19,361 tokens |
| 旧单工具封装 | 1 | 1,431 字符 | 1,184 tokens | — | — |
| 带搜索的完整封装 | 2 | 1,880 字符 | 1,321 tokens | 1,503 tokens | 2,824 tokens |

交付的完整封装只使用直接模式工具 Schema 字符数的 6.0%，首次请求输入的 13.8%。在代表性的两次请求交互中，它使用直接输入的 14.6%。验收会强制执行而非仅报告以下性质：

- 在验证用例中，恰好只有软件包负责的两个 Provider 工具 `codemode` 和 `tool_search` 可见；
- Schema 字符数和估算首次请求输入各自不超过直接模式的 20%；
- 代表性的累计估算输入低于直接模式；
- 直接与代码模式的行为、媒体、错误、取消、RTK 钩子、Agent 访问和 TUI 投影保持等价；
- 批准、宿主丢失、会话恢复、工作目录变化、工具缺失、拒绝、过期和回滚都不会重复副作用。

在兼容性证据积累期间，代码模式仍为选择加入。选择加入状态是一项推出策略，不构成把软件包负责的工具 Schema 留在封装之外的理由。

## 后果

- 开启代码模式时，软件包负责的工具 Schema 会离开 Provider 界面，同时不改变工具权限、校验、生命周期或可见结果。
- 只要虚拟 Read 仍保持 active，完整封装就会从 Host 提供的 Skill snapshot 保留由 Host 拥有的 Skill
  Discovery；只有调用路径变为嵌套 `tools.read`。
- 套件为直接调用和嵌套调用维护一个活跃工具目录与一个调用接缝。
- 项目覆盖保持隔离，而一个 Pi 可见的全局默认值避免逐项目重复选择。
- 持久批准与恢复状态可防止自动重复含糊的副作用。
- V8 Runtime 和兼容输入仍是实现细节；Pi 是唯一宿主。

## 合并历史

本 ADR 取代了 ADR 0005 记录的路由式和单工具封装实验，并已吸收原 ADR 0011 与 0014 记录的全局默认值和对话框决策。那些文件只是修订本代码模式约定，因此删除。

## 参考资料

- [OpenAI Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
- [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)
- [OpenAI Codex Code Mode execute 规范](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/execute_spec.rs)
- [OpenAI Codex Code Mode 运行时](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs)
- [Cloudflare Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
- [Cloudflare 持久 Code Mode 运行时](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/)
- [Cloudflare Code Mode 模块化重写](https://developers.cloudflare.com/changelog/post/2026-02-20-codemode-sdk-rewrite/)
