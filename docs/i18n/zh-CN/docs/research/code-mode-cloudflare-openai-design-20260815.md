<!-- translation-source: docs/research/code-mode-cloudflare-openai-design-20260815.md; translation-source-sha256: 3b047164e8f1948bb21b65d598d99e707492a5955d86c228a2918bba33f04052 -->

# Code Mode 参考比较与修订设计

日期：2026-08-15
状态：设计提案
范围：Pi Stuff Code Mode 模型契约、Tool 路由、执行与恢复

本报告记录了 OpenAI 评审之前提出的 Cloudflare 对等方案，总结了官方 OpenAI 模型，并提出替代设计。报告本身没有修改 [ADR 0005，现已合并至 ADR 0009](../adr/0009-align-code-mode-with-openai-and-cloudflare.md)。在实施之前，已将接受的替代方案记录在那里，因为提议的路由策略有意不再把每个活跃 Suite Tool 都视为仅限程序调用。

## 一段话决策

使用 OpenAI 的 Programmatic Tool Calling 和 Codex Code Mode 作为面向模型的规范契约，因为 Pi Stuff 已经运行官方 Codex V8 Host 并服务于 OpenAI 模型。对 Cloudflare 已进一步完善的部分进行复用：宽松的源码规范化、类型化连接器发现、结果解包、持久化执行历史、重放、回滚和代码片段。保留现有 Pi Tool 注册表、V8 runtime 和 Session 条目这三个实现接缝。不要添加第二个 runtime 或通用适配器框架。

最终规则很简单：

- 模型通常应使用 `tools.*`、`await` 和 `text(...)` 或 `image(...)` 编写顶层 JavaScript；
- Cloudflare 的异步箭头函数加 `return` 形式，以及 Pi Stuff 现有的 `suite.*` 名称，仍作为兼容形式接受；
- 每个 Tool 都要明确声明它是否可以被直接调用、以编程方式调用，或两者皆可；
- 嵌套调用后恢复正在运行的 V8 cell；重放仅作为恢复机制，并且只有声明为可安全重放的调用才会自动重放。

## 本地已经确立的证据

本地 live-provider 实验发现，Code Mode 确实显著减少了 provider 报告的总 token 数，但也暴露了结果形状和最终输出方面的错误。根据模型和任务不同，测得的减少幅度为 48.6% 至 73.0%。详细的一次性 token 消耗证据仍可从 Git 历史中获取。

随后进行的 Cloudflare 调查确认，生产环境中生成的程序确实会犯语法和语义错误。Cloudflare 采用窄范围规范化、runtime 验证和可操作错误，而不是仅依赖提示词或静默强制转换。详细的一次性调用可靠性证据仍可从 Git 历史中获取。

这些发现仍然成立。下面的建议之所以改变，是因为后续 OpenAI 研究揭示了一个官方契约，它比 Cloudflare Worker 契约更接近 Pi Stuff 现有的 runtime。

## 方案 A：已记录的 Cloudflare 对等方案

这是紧接 OpenAI 研究之前提出的修订方案。

### 参考标准与模型契约

- 将 `@cloudflare/codemode` 0.5.1 作为兼容性目标，而不仅仅是灵感来源。
- 将规范生成程序定义为一个异步箭头函数，其返回值就是 Code Mode 结果：

  ```js
  async () => {
    const result = await service.method({ key: "value" });
    return result;
  }
  ```

- 用 Cloudflare 契约替换 Pi Stuff 私有的 `codemode.resultText()` 和 `codemode.emitText()` 方言。
- 保留 `registry.invoke()`，确保嵌套调用仍经过 Pi 的验证、钩子、权限和 Tool 展示流程。

### 复用策略

1. 对于与 Host 无关的 Cloudflare 代码，直接导入。
2. 如果包的公共入口因导入 `cloudflare:workers` 而无法在 Pi 中运行，则以 vendoring 方式引入完全一致的纯上游源码，并记录版本、提交、完整性、许可证和上游测试。
3. 只编写 Pi 专属适配器：一个 V8 executor、一个 Suite connector 和一个 Session store。
4. 后续优先使用上游的 Host-neutral 包导出，但不要让 Pi Stuff 等待该导出。

### 对等范围

方案包含 Cloudflare 的源码规范化、连接器名称清理、`search` 和 `describe` TypeScript 描述、结果解包、值格式化与截断、console 捕获、稳定执行标识符、审批暂停与重放、确定性重放策略、回滚、历史、代码片段、保留与过期、二进制编解码以及连接器生命周期。

其主要执行模型是持久化追加日志。审批和恢复会基于记录的结果重放程序，而尚未完成的调用则正常运行。

### 交付顺序

1. 匹配面向模型的接口与规范化行为。
2. 添加 executor 和 connector 抽象。
3. 添加持久化执行、审批、重放、回滚、历史和代码片段。
4. 添加兼容性 fixture 和 live-provider 评估。

## 官方 OpenAI 来源说明了什么

### Programmatic Tool Calling 是 OpenAI 的直接对应方案

OpenAI 对这种模式使用的公开名称是 **Programmatic Tool Calling**。在 Responses API 中，模型会编写 JavaScript，在隔离的 V8 runtime 中协调符合条件的 Tool。程序可以使用顶层 `await`、循环、条件和并行调用，并通过 `text(...)` 和 `image(...)` 向模型可见的输出。runtime 不提供 Node.js、任意网络访问、文件系统、子进程、`console` 或持久化 JavaScript 状态。外部影响只能通过允许的 Tool 发生（[OpenAI Programmatic Tool Calling guide](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)）。

OpenAI 不会把所有 Tool 都置于程序之后。每个 Tool 都有一个 `allowed_callers` 策略：仅直接调用、仅程序调用或两者皆可。该指南建议：对于孤立调用、需要判断的序列、未知结果形状、对引用敏感的输出，以及默认需要审批的写入操作，使用直接调用。程序调用适合有界、可预测的控制流，其中间数据可以缩减为紧凑的结构化结果。

同一指南还把结构化结果契约、显式失败、参数和权限验证、幂等性、有界重试以及高影响操作的审批列为 Tool 设计的一部分。指南建议先评估任务成功率和证据，再比较 token、延迟、成本、调用次数、轮次和重试次数。

### 程序启动前进行发现

OpenAI Tool Search 会将延迟加载的 Tool schema 排除在初始提示之外，只加载相关定义。搜索是顶层模型操作；已经运行的 JavaScript 程序无法在自身内部发现并加载新的 Tool。必须先找到所需 Tool，之后的程序才能使用它们（[OpenAI Tool Search guide](https://developers.openai.com/api/docs/guides/tools-tool-search)）。

这将 Cloudflare 客户端 API 合并的两个关注点分开：目录发现和程序执行。

### Codex 具有具体的 Code Mode 协议

开源 Codex 实现将 Code Mode 暴露为一个由进程内 V8 Host 支持的自由格式 JavaScript Tool。该 Tool 接受源码文本，而不是 `{ code: string }` 函数式参数。嵌套 Tool 调用与父程序关联，经过普通 Tool runtime 和钩子，并返回到被暂停的 cell。函数 Tool 的参数仍必须是 JSON 对象，而自由格式 Tool 接收字符串。runtime 会阻止程序递归调用自身的 execute Tool，并按 token 截断输出（[execute specification](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/execute_spec.rs)、[runtime implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs)、[response adapter](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/response_adapter.rs)）。

当前 Codex 源码将本地 Code Mode 标记为开发中，并默认禁用。这是有用的实现证据，但不是稳定的公开兼容性承诺（[Codex feature registry](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs)）。

## 方案 B：OpenAI 原生、兼容 Cloudflare 的设计

### 1. 规范程序语法

提示词和示例应教授一种 OpenAI 原生形式：

```js
const [left, right] = await Promise.all([
  tools.read({ path: "left.json" }),
  tools.read({ path: "right.json" }),
]);

text(JSON.stringify({ left: left.value, right: right.value }));
```

契约如下：

- 使用 JavaScript，而不是 TypeScript；
- 使用顶层 `await`；
- `tools.<name>(args)` 是规范形式；
- `text(...)` 和 `image(...)` 是显式输出路径；
- 除了通过 Tool 外，不提供 `console`、Node.js、网络、文件系统或子进程访问；
- 安全的独立读取可以使用 `Promise.all`；
- 一个有界程序只应返回模型所需的证据。

如果 Pi 的经过认证的公共 Tool 接口能够表示自由格式源码，外层 Pi Tool 应使用自由格式源码。如果 Pi 0.84.2 只支持对象 schema Tool，则保留 `codemode({ code })` 作为传输适配器。`code` 内部的 JavaScript 仍必须遵循上面的规范契约；传输限制不能产生另一种执行方言。

### 2. 兼容性规范化器

复用 Cloudflare 的纯规范化行为，使 runtime 同时接受：

- Markdown 代码围栏；
- `export default` 包装器；
- 命名函数声明；
- 原始语句和尾部表达式；
- Cloudflare 的 `async () => { ...; return value; }` 形式；
- 现有的 `suite.*` 全局对象，作为 `tools.*` 的别名。

当兼容形式返回值但没有调用输出 helper 时，适配器应发出该值一次。如果已经调用过 `text(...)` 或 `image(...)`，则不得重复输出。无效 TypeScript 应带行号和列号失败；不要尝试基于正则表达式删除 TypeScript。

`codemode.resultText()` 和 `codemode.emitText()` 不应成为面向模型的公开词汇。它们有用的行为——验证结果形状并发出一个最终值——应归入 Tool-result adapter 和兼容层。

### 3. 显式调用方路由

在现有 Tool 目录中添加一种调用方策略：

| 策略 | 含义 | 默认用途 |
| --- | --- | --- |
| `direct` | 模型直接调用 Tool。 | 写入、审批、语义或自适应步骤、引用、本机 artifact，或未知输出形状。 |
| `programmatic` | 只有 JavaScript 可以调用 Tool。 | 可预测的结构化读取或转换。 |
| `both` | 两条路径均有效。 | 适合单独使用和批量工作流的安全 Tool。 |

未分类的 Tool 默认使用 `direct`。这是安全默认值，并不永久禁止 Code Mode 中的写入。满足以下条件时，写入可以标记为 `programmatic` 或 `both`：具有明确的审批行为、稳定的结构化结果、幂等性或重放策略，以及针对副作用边界中断的测试。

每个嵌套调用都必须继续使用现有的中心 `registry.invoke()` 接缝。Code Mode 不得重复实现参数验证、权限检查、生命周期钩子、Tool 展示或结果构造。

### 4. 延迟目录发现

初始最多暴露两个小型定义：`tool_search` 和 Code Mode execute Tool。`tool_search` 只返回匹配的名称、描述、调用方策略和 TypeScript 签名。随后一轮可以：

- 通过 Pi 现有的 active-Tool 机制激活选定的直接 Tool 定义；或者
- 让选定的签名对下一次 Code Mode 程序可用，而无需暴露整个 Suite schema。

保留 V8 内部的 `codemode.search()` 和 `codemode.describe()`，以兼容 Cloudflare 和代码片段工作流，但不要把它们作为规范方式来教授模型，使其在运行中的程序内发现 Tool。两种界面必须读取同一目录；不能存在两个 Tool 元数据来源。

### 5. 结构化结果边界

只有当 Tool 的结果具有文档化的稳定形状时，它才符合程序调用资格。优先使用已有的输出 schema；否则在目录边界添加最小验证器。作为后备方案，复用 Cloudflare 针对 MCP 形状结果的解包规则：

1. 显式的 `toolResult`；
2. 结构化错误作为抛出的失败；
3. `structuredContent`；
4. 拼接全部文本内容，并在有效时进行 JSON 解码；
5. 将原始结果作为最后的兼容值。

未知结果或包含丰富 artifact 的结果，在契约明确之前保持直接调用。错误应指出 Tool、参数或结果路径、预期类型、收到的类型，以及是否可以安全重试。

### 6. 优先暂停并恢复；仅在恢复时重放

正常执行应使用现有的 Codex V8 cell 协议：

1. 执行一个 cell；
2. 当 JavaScript 调用 Tool 时暂停它；
3. 通过 `registry.invoke()` 运行该 Tool；
4. 将结果返回同一个 cell；
5. 继续执行，直到程序发出输出、失败或被取消。

记录父程序标识符和子调用标识符，使活动、钩子和错误保留调用方谱系。这样无需仅仅为了交付嵌套结果而重新运行已经完成的 JavaScript。

保留 Cloudflare 风格的追加日志、重放、回滚、代码片段、保留和过期，将其放入 Execution Ledger，但改变其作用：

- Host 存活时，审批会恢复被暂停的 cell；
- Host 丢失后，从 ledger 提供已完成调用的结果；
- 只有声明为可安全重放或具有幂等性的未完成调用才可以自动运行；
- 不明确的副作用变为 `incomplete`，需要用户明确决定；
- 回滚是显式补偿操作，绝不能声称外部副作用被神奇地撤销。

在引入另一套持久化系统之前，先使用 Pi Session 自定义条目保存该 ledger。只有当 Session 条目证明不足，并且另一个已接受的 ADR 定义了其生命周期时，才添加派生本地存储。

### 7. 重试、审批和钩子

- 只重试类型明确的临时性失败，并使用小的固定上限和退避。
- 只重试声明为可安全重放或受幂等键保护的调用。
- 不要自动重试审批拒绝、验证失败、未知结果形状或不明确的写入。
- 当目标 Tool 支持幂等键时，使用稳定的子调用标识符作为幂等键。
- pre-call hook 可以在 Tool 运行前阻止或重写参数。
- post-call hook 可以拒绝程序看到的结果，但 ledger 必须记录 Tool 已经运行。
- 取消必须同时传递到 V8 cell 和当前活动的嵌套 Tool。

### 8. 输出和诊断

- 通过现有 response adapter 保留文本、图像、音频和生成图像内容。
- 按 token 截断并使用清晰标记，而不是使用很大的字符常量。
- 语法失败要报告行号和列号。
- 未知 Tool 名称要报告最接近的目录匹配，并提供 `tool_search` 提示。
- 无效参数和结果要报告 JSON 路径。
- 将缺少输出与有效的空输出分别报告。
- 保留一个规范提示词示例；将边界情况放入 `describe` 输出和测试，而不是永久 schema。

## 复用映射

新设计更多地复用了 Pi Stuff 已有的内容，并缩小了新增代码范围：

| 需求 | 复用内容 | Pi 专属工作 |
| --- | --- | --- |
| V8 执行、yielded calls、等待、取消 | 现有固定版本的官方 Codex V8 Host 和当前 runtime | 对齐模型契约与调用方谱系；不要创建第二个 executor。 |
| Tool 执行 | 现有 Suite 目录和 `registry.invoke()` | 添加调用方策略和稳定结果元数据。 |
| 源码容错 | Cloudflare 0.5.1 纯 normalizer；仅当不存在 Host-neutral 导出时 vendoring | 将返回值适配为 `text(...)`，避免重复发出。 |
| 搜索和类型描述 | 现有目录加 Cloudflare connector 算法 | 添加一个共享的顶层搜索结果，并保留 V8 内部兼容 facade。 |
| MCP 结果处理 | Cloudflare 纯解包行为 | 保留 Pi media 和 Tool-result 类型。 |
| 持久化 | 现有 Pi Session 自定义条目 | 添加程序/子调用谱系和重放安全字段。 |
| 历史、重放、回滚、代码片段 | Cloudflare durable-runtime 行为及其测试，作为兼容性参考 | 优先恢复活动 cell，并根据安全元数据限制恢复重放。 |

不要仅仅为了仿照 Cloudflare 的类布局而添加通用的 `PiV8Executor`、`PiSuiteConnector` 或 `PiSessionStore` 框架。这些接缝已经存在于 Pi Stuff 中。只有当两个真实实现需要它时，才提取 Interface。

## 方案 A 与方案 B

| 问题 | 方案 A：Cloudflare 对等 | 方案 B：OpenAI 原生混合方案 |
| --- | --- | --- |
| 主要参考 | Cloudflare Code Mode 0.5.1 | OpenAI Programmatic Tool Calling 和 Codex；Cloudflare 用于兼容性和持久化 |
| 规范源码 | 异步箭头函数加 `return` | 顶层 JavaScript、`tools.*` 和 `text(...)`/`image(...)` |
| 接受的源码 | 主要是 Cloudflare 形式 | OpenAI 形式，加规范化后的 Cloudflare 和现有 Pi 形式 |
| 外层 Tool 传输 | `{ code: string }` | Pi 支持时使用自由格式；否则 `{ code }` 仅作为传输方式 |
| Tool 暴露 | 所有活跃 Suite Tool 都可程序调用 | 显式的 `direct`、`programmatic` 或 `both` 路由 |
| 发现 | sandbox 内的 `search`/`describe` | 顶层延迟 `tool_search`；sandbox 内搜索保留兼容性 |
| 结果契约 | connector 解包和格式化 | 程序调用资格要求结构化输出契约，并以后备方式使用 Cloudflare 解包 |
| 写入和审批 | 在 Code Mode 内运行，并使用持久化暂停/重放 | 默认直接调用；显式安全写入可以程序调用；审批后恢复活动 cell |
| 正常继续 | 持久化日志和确定性重放 | 恢复同一个 V8 cell |
| 崩溃恢复 | 重放已记录的执行 | 仅重放安全调用；不明确的影响停止为 incomplete |
| 重试 | 主要由持久化重放策略控制 | 类型化临时性错误，加重放安全/幂等声明和上限 |
| 跟踪标识 | 执行和序列标识符 | 父程序和子调用方谱系，也存储在 ledger 中 |
| 输出 | 程序返回值 | OpenAI 支持 media 的输出 helper；为兼容性自动发出返回值 |
| 主要复用 | vendored Cloudflare 核心加三个 Pi 适配器 | 现有 Codex V8 Host、registry 和 Session 接缝，加选定的 Cloudflare 纯工具 |
| Token 策略 | 用一个 Tool 隐藏整个 Suite | 以两个小 Tool 开始，只加载相关直接 schema/签名 |
| 主要正确性风险 | 学到的方言不匹配，以及重放期间的重复影响 | 目录元数据更多，但方言错误更少，中断语义更安全 |

方案 B 可能比方案 A 暴露稍多的 schema，因为它保留一个小型搜索 Tool，并可以加载选定的直接 Tool。这是有意为之。它在避免错误假设“所有操作在强制通过 JavaScript 时都更安全或更容易”的同时，保留了大部分已测得的 schema 节省。

## 实施计划

### 第 1 阶段：契约对齐

- 修订 ADR 0005，定义调用方路由和两种参考角色。
- 将 `tools.*`、顶层 `await` 以及 `text(...)`/`image(...)` 设为规范形式。
- 保留 `suite.*` 和 Cloudflare 异步箭头程序作为兼容性输入。
- 只移植有用的 worktree 变更：一个完整示例、可操作的结果错误和回归测试。
- 从面向模型的指导中移除 `resultText()` 和 `emitText()`。

验收：相同的 exact-completion 任务能够使用规范 OpenAI 语法和规范化的 Cloudflare 语法成功完成，且没有重复输出。

### 第 2 阶段：路由和发现

- 为现有目录添加调用方策略和结构化结果资格。
- 添加由该目录支持的顶层延迟搜索 Tool。
- 仅激活选定的直接定义；仅向 Code Mode 传递选定的程序签名。
- 保持所有嵌套执行经过 `registry.invoke()`。

验收：未分类和高影响 Tool 保持直接调用；程序调用不能绕过验证、钩子或权限；首次请求的 schema 仍显著小于直接模式。

### 第 3 阶段：实时继续和谱系

- 在 V8、registry 调用、Tool 展示和结果之间保留程序和子调用方标识符。
- 在嵌套调用和审批后恢复同一个 yield 的 cell。
- 在副作用边界定义取消和 post-call-hook 行为。

验收：暂停的调用恢复时不会重新执行已完成的 JavaScript，并且每个子调用都能在 trace 和 UI 状态中归属于一个程序。

### 第 4 阶段：Cloudflare 持久化对等

- 在 Pi Session 条目中添加追加式 Execution Ledger。
- 添加可安全重放的恢复、历史、代码片段、保留、过期以及显式回滚/补偿。
- 移植 Cloudflare 兼容的规范化、搜索描述、结果解包、清理、二进制处理和针对性的上游 fixture。

验收：恢复不会重复不明确的副作用；已完成结果可以确定性重放；Session 恢复后代码片段和历史仍然存在；兼容性 fixture 与固定版本的 Cloudflare 相匹配。

### 第 5 阶段：评估和推出

在三组条件下运行同一代表性语料：

1. 直接 Tool；
2. 方案 A 行为，将所有 Suite Tool 强制通过 Code Mode；
3. 方案 B 路由和兼容行为。

评估 exact task completion、证据保留、首次程序成功率、缺失或重复输出、参数和结果错误、provider tokens、cache tokens、延迟、Tool 调用、模型轮次、重试、审批、取消和重复影响。正确性和证据是发布门槛；token 节省是次要优化目标。

在方案 B 达到约定代表性语料上的直接基线之前，保持 Code Mode 选择性启用。这不是缩减范围：所有 Cloudflare 持久化功能仍在计划中，但推出门槛可以防止实验性的模型契约默默变成默认契约。

## 建议

用方案 B 替换方案 A。方案 A 正确地要求 Cloudflare 对等和源码复用，但选择了错误的规范方言，并让持久化重放承担了 Pi Stuff 现有 Codex V8 continuation protocol 已经做得更好的工作。方案 B 复现了两个业界参考方案中的有用能力，同时复用了 Pi Stuff 已有的 Host、registry 和 Session 机制。

当前的 `code-mode-result-helpers` worktree 应继续作为实验。保留其测试以及对完整示例和可操作验证的重视，但不要将其 helper 名称作为最终公共契约合并。

## 后续：用本地 Workers runtime 替换 Codex V8

### 发现

技术上可行，但不是直接的二进制替换。

Cloudflare 官方支持通过 Miniflare 在本地运行 Worker 代码；Miniflare 使用与托管平台相同的开源 `workerd` runtime（[Workers local development](https://developers.cloudflare.com/workers/local-development/)）。Cloudflare 官方 Dynamic Workers playground 也记录了本地运行方式，并使用 `env.LOADER` 创建 Dynamic Workers（[Dynamic Workers playground](https://developers.cloudflare.com/dynamic-workers/examples/dynamic-workers-playground/)）。这两个来源共同确立了相关 Workers 执行模型受支持的本地开发路径。

替代架构如下：

```text
Pi
  -> local Miniflare/workerd supervisor Worker
  -> Worker Loader binding
  -> isolated Dynamic Worker for generated code
  -> RPC/HTTP bridge back to Pi registry.invoke()
```

它不会是：

```text
Pi -> import @cloudflare/codemode -> run
```

`DynamicWorkerExecutor` 要求 Worker Loader binding，而持久化 Code Mode runtime 还要求通过 `ctx.exports` 导出的 Durable Object facet（[Cloudflare durable Code Mode runtime](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/)）。这些设施由 Workers 环境提供，因此 Pi 需要启动并监管该环境作为独立本地进程，并将调用桥接回 Pi。

### 替代方案的收益

- 模型生成的代码将在 Cloudflare 自有的 Worker 语义下运行。
- 可以复用 `DynamicWorkerExecutor`、网络隔离、console 捕获、超时行为和 Worker RPC，减少转换工作。
- Cloudflare 持久化 runtime 可以使用本地 Durable Objects，而不是在 Pi Session 条目上重新实现其存储模型。
- Cloudflare 兼容性测试将运行在更接近托管参考环境的 runtime 上。

本地 Durable Object 持久化不是自动启用的：Miniflare 默认将其存储在内存中，必须显式配置磁盘持久化（[Miniflare Durable Object storage](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/)）。

### 替代方案的成本

- 用本地 Worker 服务和 RPC 或 HTTP bridge 替换当前的小型 stdio 协议。
- 重新实现当前 Codex cell 操作——execute、yielded wait、terminate、cancellation、嵌套 Tool callback、notifications、media output 和 trace attachment——或有意将它们映射到 Cloudflare 执行语义。
- 添加并认证 Wrangler/Miniflare/workerd/Vite 依赖链及其本地状态生命周期。
- 决定本地 Durable Object 文件存放位置、清理方式，以及它们与 Pi Session 的关系。
- 跨进程和 RPC 边界保留 Pi 的验证、权限、钩子、UI 和取消能力。
- 根据 Pi Stuff 的认证配置文件重新检查支持的平台和二进制要求。

此外还有安全方面的限定。`workerd` 项目表示，仅靠 runtime 本身无法为潜在恶意代码提供足够的纵深防御，并建议使用外部安全 sandbox，例如虚拟机（[workerd security note](https://github.com/cloudflare/workerd#readme)）。因此，本地 workerd 进程本身并不比当前专用 Codex host 进程提供更强的安全边界。

### 重要的复用影响

Cloudflare 将 Code Mode `Executor` Interface 设计为与 runtime 无关。其最小契约可以为任何 sandbox 实现，而 `DynamicWorkerExecutor` 只是所提供的 Workers 实现（[Cloudflare Code Mode modular rewrite](https://developers.cloudflare.com/changelog/post/2026-02-20-codemode-sdk-rewrite/)）。

这留下两条有效的实现路径：

| 路径 | Executor | 影响 |
| --- | --- | --- |
| 在当前 runtime 上复用 Cloudflare 核心 | Cloudflare `Executor` Interface 的薄 Codex V8 实现 | 保留 Pi 当前的 host 协议，需要更少的替换工作。 |
| 替换 runtime | 本地 Miniflare/workerd 中的 Cloudflare `DynamicWorkerExecutor` | 更接近 Cloudflare 执行语义，但增加 Worker supervisor、RPC bridge、持久化生命周期和安全加固。 |

第一条路径是源码复用。第二条路径是 runtime 替换。两者都可以提供 Cloudflare 功能对等；在修改 ADR 0005 之前，应通过一个小型本地 prototype 进行比较。prototype 必须证明：无需凭据即可启动 Worker Loader、嵌套 Pi Tool RPC、取消、media results、本地 Durable Object 持久化、重启恢复，以及生成代码无法直接访问网络。

## 主要来源

- [OpenAI Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
- [OpenAI model guidance for Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)
- [OpenAI Tools overview](https://developers.openai.com/api/docs/guides/tools)
- [OpenAI Agents SDK Tool documentation](https://openai.github.io/openai-agents-python/tools/)
- [OpenAI Codex Code Mode execute specification](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/execute_spec.rs)
- [OpenAI Codex Code Mode runtime](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs)
- [OpenAI Codex Code Mode response adapter](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/response_adapter.rs)
- [OpenAI Codex feature registry](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs)
- [Cloudflare Code Mode overview](https://developers.cloudflare.com/agents/tools/codemode/)
- [Cloudflare Code Mode internals](https://developers.cloudflare.com/agents/tools/codemode/how-it-works/)
- [Cloudflare durable runtime](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/)
- [Cloudflare Code Mode API reference](https://developers.cloudflare.com/agents/tools/codemode/api-reference/)
- [Cloudflare Code Mode package source](https://github.com/cloudflare/agents/tree/main/packages/codemode)
