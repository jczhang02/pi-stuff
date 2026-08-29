<!-- translation-source: packages/pi-stuff/src/code-mode/README.md; translation-source-sha256: 5f5b244a59db4d01c869edb426eadacdc46d7e59dc4cfd1ba6f3adbbcd0e330f -->

# `code-mode`

代码模式是 Pi Stuff 软件包面向模型的工具封装。它把每个活跃且由软件包负责的工具 Schema 移到 `codemode({ code })` 后，在 OpenAI 隔离 V8 Code Mode 宿主中执行 JavaScript，再把 `tools.*` 调用委派回原始 Pi 工具。另行安装的工具继续位于顶层，因为软件包不负责其私有实现。

为兼容优先推出，它默认禁用。使用 `/codemode` 打开 Pi Stuff 命令对话框，或用 `/codemode on` 与 `/codemode off` 直接控制。对话框显示当前模式、Provider 界面、活跃本地目录大小和会话账本计数。显式逐项目开关存储在受信项目 `.pi/code-mode.json`，Pi 重启或更换项目后重新加载。`/codemode global on` 与 `/codemode global off` 设置全局默认值，存储在合并 Pi Stuff 设置文件（`<agentDir>/pi-stuff.json`）的 `codeMode.enabled` 命名空间。加载保持只读；值缺失时回退到 `PI_STUFF_CODE_MODE_DEFAULT`（未设置时为 `off`）。有效优先级为：冻结子进程启动值、项目文件、全局默认值、进程默认值、`off`。

启动 Agent 时，会把父会话的有效代码模式状态冻结进该子运行。子 Agent 接收显式 `on` 或 `off` 值，不修改父进程环境；父级后来切换不会改变已经运行的 Agent。该冻结子值优先于项目与全局持久偏好。子 Agent 现有工具许可列表和能力上限仍会约束其代码模式目录可调用内容。

## 模型使用方式

```js
const pkg = await tools.read({ path: "package.json" });
text(pkg.packageManager);
```

- `tools` 包含当前所有活跃且由 Pi Stuff 软件包负责的工具，包括启用代码模式后才激活的工具。
- 等待每个 `tools.*` 调用。稳定结构化内容直接返回；文本 JSON 会解析；其他文字以字符串返回。显式工具 `isError: true` 结果会拒绝调用；未捕获拒绝会停止执行，普通 JavaScript `try/catch` 是恢复机制。
- 普通工具工作正常等待。对于一个带截止时间、可具体观察的命令、文件、日志或 HTTP 条件，调用一次 `tools.monitor(...)`，继续有用工作，不要用 Bash、sleep、状态检查或反复 Agent 轮次轮询。
- `await codemode.search(query)` 与 `await codemode.describe(path)` 检查本地目录，不把目录加入模型历史。使用 `codemode.search("view image")` 等简短意图短语；冗长查询仍会保留工具名称含精确查询 token 的候选。
- JavaScript 无法直接访问 Node、Bun、文件系统、进程、网络、模块或凭据。I/O 只能通过软件包负责的工具进行。
- `text(...)`、`image(...)`、`generatedImage(...)`、`store(...)`、`load(...)`、`notify(...)` 和其他宿主辅助函数仍可用。`console` 不可用。直接返回产生图像的工具结果，例如该工具活跃时使用 `return await tools.view_image({ path: "/tmp/example.png" })`。Bash 等产生文字的工具返回的 Base64 可能被截断，因此会被拒绝。
- 接受 Cloudflare 的 `async () => { return value; }` 形式。只有程序尚未调用输出辅助函数时，返回值才会输出，因此显式输出绝不会重复。把完整图像工具结果传给 `image(...)` 仍是兼容输入，但直接返回是规范方式；两条路径都通过相同图像完整性与解码门槛。旧 `suite.*` 命名空间继续作为兼容别名，不属于提示词词汇。
- 顶层 `tool_search({ query })` 工具与 `codemode.search/describe` 读取同一个确定性排名目录。搜索至少要求一个词法查询 token 匹配，无匹配时不返回回退。顶层响应在 4,000 字符内最多投影五个匹配：能容纳时为完整定义，之后依次降级为带类型最高匹配及签名、仅签名、仅路径。`codemode.describe(path)` 继续提供完整生成的 TypeScript 输入与结果类型。
- 已让出的 V8 cell 在内部恢复。`yield_control` 仍是宿主协议能力，不属于面向模型的辅助函数词汇或用户层完成信号。

不存在逐工具调用方路由策略。可见性与副作用安全相互独立：所有软件包负责的工具进入 V8 目录，而每个工具可以独立声明重放、持久批准、补偿和生命周期行为。安全默认值为不可重放。Bash 继续不可重放，并仍经过 RTK 普通 `tool_call` Hook。另行安装的第三方工具保持顶层，因为 Pi Stuff 无法安全地重新分派其私有回调。

## UI 与会话约定

当嵌套工具或媒体已经表示代码模式结果时，代码模式没有自己的可见工具行。没有嵌套工具或媒体行的成功纯文本纯 JavaScript 执行，无论是否输出文字，都不会出现在对话记录、`Ctrl+O` 或普通 `/tools` 中；其模型可见结果、会话 JSONL 和账本记录保持不变。独立媒体继续由宿主渲染，不带文字封装框架。只有没有嵌套工具或媒体活动已经负责结果时，外层错误、拒绝或取消才得到一行封装回退。显式带 `isError: true` 的历史嵌套结果会投影为错误，即使旧账本状态写成成功；缺失标志、异常结果和形似错误的说明文字都不会触发。

每个嵌套调用保留原始工具的精确渲染器、工具活动元数据、流式状态、失败状态、展开行为和媒体行为。因此，`view_image` 负责“已查看图像”行，而 `read` 返回的图像仍是“读取文件”行；代码模式不会重命名任何工具。历史工具定义缺失或渲染器失败时，在同一源码位置显示通用工具行。外层结果把嵌套调用存入普通 Pi 会话 JSONL 详情，因此重载与恢复会重建相同投影，即使合法历史结果没有 `details`。原始参数可用于审计；工具参数兼容垫片则提供 Activity 语义和渲染。尤其是 Pi 0.84.3 的 Edit 兼容垫片，会把旧版顶层 `oldText`/`newText` 形式和 `edits` 中的单个 JSON 对象都规范为规范 `edits[]` 数组，用于直接嵌套执行与历史重放。

最终稳定会按模型源码顺序重新投影嵌套与直接调用，包括独立 Bash 行。嵌套图像通过外层宿主结果携带，使 Pi 正常图像规范化只进行一次。TUI 渲染前，规范化嵌套媒体移入持久呈现详情，并从外层图像列表删除，防止 Pi 把它追加到整个封装下。原始渲染器在精确文字/媒体边界再次接收它；公开上下文 Hook 为每次 Provider 请求恢复相同的已规范化内容，不再解码未变化图像载荷。因此会话 JSONL 只存储每个嵌套图像载荷一次，重载相同 UI，并且绝不以视觉等价换取模型可见性。无效或不完整图像输出在持久化前变成错误。Provider 上下文投影还会把早于规范化呈现详情的旧代码模式结果中的异常图像替换为可操作文字错误，不重写会话历史。

真实 Pi 0.84.3 验收门槛会在 100×32 与 64×28、会话恢复前后，比较代码模式开启/关闭时完整纯屏布局和精确 ANSI 工具活动块。真实上下文压力及其导致的完整/紧凑用例模型标签会被规范化；图标、位置和周边文字保持相同，工具活动颜色则精确一致。

门槛会演练包含 Read、Bash、后台工作和 Agent 管理的混合 Activity，再加一次失败工具调用、一次分类为取消的工具结果，以及通过 Pi 媒体规范化与终端回退路径交错读取真实 PNG/文字/PNG。媒体门槛还证明 UI 投影后两个图像都会进入下一次 Provider 请求。另一个测试使用 Pi 0.84.3 真实 `ToolExecutionComponent` 和 Kitty 能力，证明展开的多图输出仍与原始工具行交错。外层执行取消单独覆盖，使门槛不继承 Pi 原生 Bash 路径的进程退出计时竞态。门槛强制 token 节省：直接界面为 22 个工具 / 31,208 个 Schema 字符 / 9,573 个估算首次请求 tokens；完整封装为 2 个工具 / 1,880 个字符 / 1,321 个 tokens，即直接 Schema 的 6.0% 和直接首次请求的 13.8%。经过一次代表性工具往返，两次请求合计为直接 19,361 tokens，对代码模式 2,824 tokens。CI 要求 Schema 与首次请求输入都不超过直接模式的 20%，且累计输入更低。

嵌套执行保留 Pi 参数准备、校验、调用/结果 Hook、生命周期事件、取消、流式更新、工具用量、新激活工具名和终止提示。序列化失败会变成普通失败工具结果，不会让 V8 cell 卡住。嵌套结果 Hook 追加的仅控制 `<system-reminder>` 块留在 JavaScript 业务结果之外；外层宿主工具结果仍是其传输边界。

一次代码模式执行最多可发起 768 个嵌套工具调用。超过安全边界时显式失败；调用绝不会静默丢弃。跨代码模式调用的相邻原生检索可以贡献到一个检索组，直到叙事边界关闭它。

## 恢复与可复用程序

每次执行和嵌套调用都在仅追加 Pi 会话账本中获得稳定 ID。一次带类型 V8 宿主丢失重试后，可以复用已完成调用。默认 `never` 策略拒绝重复含糊的未完成副作用；`record` 只复用已稳定结果；`reexecute` 有意再次运行操作。任何未完成的 `never` 或 `record` 调用都会变为 `incomplete`，绝不会猜测或重复。

当 Pi 报告同一个会话叶节点时，账本读取复用一次 Fold；会话或叶节点变化时刷新。如果 Pi 无法提供当前分支，恢复命令会失败，而不是把持久历史当成空。

标记为 `requiresApproval` 的工具会在副作用前持久暂停。`/codemode pending` 显示精确操作；`/codemode approve <execution-id>` 恢复并执行一次；`/codemode reject <execution-id> <seq>` 不执行而终止。批准不能与 `reexecute` 同用。恢复要求原工作目录和活跃待处理工具；过期决定不会改变任何内容。被吞掉的暂停不能到达同一程序后续副作用。

`/codemode history`、`/codemode abandon <execution-id>`、`/codemode expire` 和 `/codemode rollback <execution-id>` 暴露恢复决定。旧 `compensate` 命令保留为别名。历史区分已显示、已保留和总执行计数，并报告时间、工具身份、状态和错误。回滚只按逆序运行显式声明的反向操作；混合结果保持 `compensated` 且可重试，直到每个目标成功；它绝不删除历史，也不假定外部副作用已消失。Connector 清理在每轮后运行，并在终态完成、拒绝或回滚时运行一次，不遮蔽原结果。

`codemode.step(name, fn)` 为长程序提供持久命名检查点。`/codemode save <execution-id> <name>` 把成功程序保存为会话代码片段；`codemode.run(name, input)`、`/codemode snippets` 和 `/codemode delete <name>` 用于复用或整理。账本保留有界终态历史，并使陈旧未完成工作过期。不需要新 Prune Tombstone：重放会折叠活跃分支，并在内存中派生保留视图。完成时只存储一份可重建工具结果或其规范值，绝不同时存储两者；一个会话内全部代码模式账本条目有固定 16 MiB 物理预算。进一步持久工作会在越界前失败，并要求新建 Pi 会话。账本仍是会话数据，不是第二个数据库。

## 原生宿主

V8 辅助程序只在第一次显式代码模式执行时准备。安装过程：

- 为当前平台下载精确 OpenAI Codex `rust-v0.145.0` 资源；
- 遵守标准代理环境变量；
- 超时为 120 秒且可取消；
- 把宿主启动/握手限制在十秒内，并跟随外层工具取消；
- 安装前验证固定 SHA-256；
- 使用进程间锁与原子暂存；
- 把可执行文件缓存到 Pi Agent 缓存目录。

设置 `PI_STUFF_CODE_MODE_HOST` 为现有绝对可执行路径，可使用预安装辅助程序。导入或启动 Pi 不会为代码模式下载、写入或启动任何内容。

## 兼容性

- Pi 宿主：`0.84.3`
- Pi 宿主内嵌 Bun 运行时：`1.3.14`
- 仓库 Bun 工具链：`1.4.0`
- 宿主资源：Linux/macOS x64 与 arm64，Windows x64 与 arm64
- 非 Windows 归档安装需要 `tar`

来源见 [UPSTREAM.md](UPSTREAM.md) 与[英文第三方声明](../../../../../../../packages/pi-stuff/src/code-mode/THIRD_PARTY_NOTICES.md)。

这是单一本地 `@jczhang02/pi-stuff` 软件包的内部模块，不是可独立安装的 Pi 资源。其注册表只在套件组合自有工具期间存在。
