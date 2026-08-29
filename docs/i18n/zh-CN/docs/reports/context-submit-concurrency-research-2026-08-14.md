<!-- translation-source: docs/reports/context-submit-concurrency-research-2026-08-14.md; translation-source-sha256: 9c9c040dba680a1f3777bdc7427b0a142ccb7eee6059f6acf4e9977deb9e4201 -->

# Context 提交并发研究

日期：2026-08-14
状态：历史研究；初始实现后来被 ADR 0019 取代

> **当前处置（2026-08-29）：** 下方渲染顺序发现仍有价值，但“Magic Context 无法安全跨越 Worker 边界”的结论已不再成立。后续实现证据确立了 [ADR 0019](../adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md) 所记录的窄内存包、不可变快照和有界宿主副作用桥。当前行为以该 ADR 和 [Context Management README](../../packages/pi-stuff/src/context-management/README.md) 为准；本报告保留较早证据与被拒绝的中间设计。

## 问题

Pi Stuff 能否在 Magic Context 转换长会话时先清空并重绘编辑器，而不是在转换前插入固定延迟？转换本身能否在不改变 Magic Context 或 Pi 宿主的情况下安全异步或并发运行？

## 观察到的边界

Pi 很快收到 Enter。可见停顿发生在之后：终端尚未明显绘制提交状态时，Pi Stuff Context 处理器就开始转换面向 Provider 的消息列表。在恢复的长会话中，同步转换可能长时间占用 JavaScript 线程，使已提交文字仍留在编辑器中。

这不是键盘输入问题，而是两个独立操作的相互作用：

1. 调度或执行终端渲染；
2. 同步准备 Provider 必须接收的消息列表。

## 一手来源发现

### Pi 在 Provider 调用前串行执行 Context 转换

Pi 扩展运行器会等待每个 `context` 处理器，并继续传递结果消息列表。因此 Provider 不能与未完成 Context 转换安全并行启动，否则会收到错误消息列表。

来源：[Pi 扩展运行器](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts)

### Pi 有两种实质不同的渲染操作

Pi TUI 同时暴露：

- `requestRender(force?)`，通过事件循环调度渲染；
- `renderNow(force?)`，同步渲染。

`requestRender(true)` 会移除普通渲染节流，但仍是调度操作。Pi TUI 源码使用 `process.nextTick`，普通渲染请求还可能受 16 ms 最小间隔限制。没有公开 Promise 会在终端模拟器完成像素绘制时解决。

来源：[Pi TUI 实现](https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui.ts)、[Pi TUI 文档](https://pi.dev/docs/latest/tui)和 [Pi TUI README](https://github.com/badlogic/pi-mono/blob/main/packages/tui/README.md)

Pi Stuff 已经在对话 UI 呈现中拥有实际 `TUI` 对象。Context 当前通过 Pi Stuff 共享渲染请求事件间接访问它。该内部接缝可以扩展，无需改变 Pi 宿主或 Magic Context。

更重要的是，Pi TUI 在处理每次键盘输入后已经调用私有 `requestImmediateRender()`。Context 适配器无需请求第二次渲染。它只需在同步转换前让出，使 Pi 已调度的输入渲染可以运行。

### 事件循环让出有助绘制，但不会让 CPU 工作并发

执行大量同步工作的 JavaScript 回调会阻塞其他事件循环工作。`setImmediate` 会让出到后续事件循环阶段；它比任意 sleep 更适合作为排序原语，但两者都不会让 Context 转换在另一个 CPU 线程运行。

来源：[Node.js 事件循环指引](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)、[Node.js Timers](https://nodejs.org/api/timers.html)和 [Bun `setImmediate`](https://bun.sh/reference/globals)

### Worker 是真正并发，但不能作为 Magic Context 的安全包装器

Bun Worker 在另一线程运行独立 JavaScript 实例，并交换结构化克隆消息。然而，当前 Context 处理器依赖宿主对象、函数、会话状态、模块作用域缓存和同步 SQLite 运行时。这些对象与运行时无法直接移到 Worker。在那里重建它们等同于构建并同步第二套 Magic Context 集成。

Bun 还把 Worker 支持标记为实验性，尤其是终止。`bun:sqlite` 是同步的。Node Worker 文档同样建议 CPU 密集 JavaScript 使用池，而不是每次调用新建 Worker。

来源：[Bun Workers](https://bun.sh/docs/runtime/workers)、[Bun SQLite](https://bun.sh/docs/runtime/sqlite)和 [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)

### Magic Context 不暴露安全的分阶段或预热 API

Magic Context Pi 处理器接收完整的面向 Provider 消息列表，并把标签、历史注入、过滤和相关处理作为一个 Context 管线执行。其文档集成没有公开操作，让 Pi Stuff 预计算昂贵的纯部分，再稍后提交结果。

研究期间检查的上游源码比项目固定版本新，因此只是架构佐证，不是每个实现细节的精确证据。本地安装的固定源码仍是测量行为的权威。

来源：[Magic Context Pi 插件 README](https://github.com/cortexkit/magic-context/blob/master/packages/pi-plugin/README.md)和 [Magic Context 处理器](https://github.com/cortexkit/magic-context/blob/master/packages/pi-plugin/src/context-handler.ts)

### 终端输出没有可移植的像素已绘制确认

流写入或 Drain 回调可以描述缓冲区进度，tmux 控制模式描述 tmux 协议流控；两者都不能证明终端模拟器已经物理重绘像素。没有宿主/终端协议变化时，Pi Stuff 最强可保证的是：已生成提交帧，并在开始同步转换前让出执行。

来源：[Node.js Streams](https://nodejs.org/api/stream.html)和 [tmux 控制模式](https://github.com/tmux/tmux/wiki/Control-Mode)

## 历史架构决策：交互输入渲染屏障

成熟接缝不是定时器，也不是 Context 直接访问 `TUI`，而是 Context 适配器内的排序规则：

```ts
await yieldToHostUi()
```

其接口只保证 Pi Stuff 能诚实保证的内容：

- 只在 Pi 报告 `interactive` 输入来源后应用；
- 允许 Pi 已调度的键盘输入渲染和一个宿主事件循环轮次运行；
- 不引入固定时长 sleep，也不增加渲染请求；
- UI 排序失败绝不能阻塞 Provider 处理。

实现是一次 `setImmediate` 轮次。Pi TUI 调用聚焦输入处理器后，用 `process.nextTick` 调度原生键盘输入渲染。在已验证 Bun 1.3.14 运行时，`process.nextTick` 先于 `setImmediate` 执行。

Context 负责一个合并脏标志：自上一个 Context 事件以来，Pi 是否报告过交互输入。输入接缝尚无法知道后续扩展输入处理器会接受还是处理该输入，因此不建模为每次接受提交一个 Token。权威 `context` 处理器消费该标志，并在调用 Magic Context 前让出一个宿主轮次。多个快速输入只需一次绘制机会。RPC 与扩展发起提交不设置标志。显式把输入标为 `interactive` 的程序化 SDK 调用方，即使没有 TUI，也可能得到一次无害宿主轮次。

```text
交互输入
  -> Pi 处理编辑器输入
  -> Pi 在 process.nextTick 调度原生立即渲染
  -> Context 边界让出一个宿主事件循环轮次
  -> Pi TUI 执行已调度渲染
  -> 一个宿主事件循环轮次完成
  -> 未变化的 Magic Context 转换
  -> Provider 调用
```

这样让状态所有权保持局部：

| 状态或操作 | 所有者 |
| --- | --- |
| 编辑器与立即输入渲染调度 | Pi TUI |
| 合并的交互输入渲染标记 | Context 运行时代际 |
| Provider 消息转换 | 通过 Pi `context` 接缝的 Magic Context |
| Provider 调用顺序 | Pi 宿主 |

拒绝从 Context 调用 `renderNow()`，因为它绕过 TUI 调度器并引入重入渲染。也拒绝调用 `requestRender(true)`：Pi 主屏和替代屏实现会为强制请求重置先前渲染缓存，使下一次渲染变成全量重绘。原生键盘路径已经调度所需立即渲染，不重置这些缓存。

## Effect v4 可行性

截至本报告日期，官方 Releases 页把 `effect@4.0.0-rc.109` 列为预发布。npm Dist Tag 仍把 Effect v3 选为 `latest`，并通过显式 `rc` 标签暴露 v4。v4 迁移指南仍称该版本线为 Beta，并警告 API 可能变化，因此发布文档明显处于过渡期。

来源：[Effect Releases](https://github.com/Effect-TS/effect/releases)、[npm Effect 软件包](https://www.npmjs.com/package/effect?activeTab=versions)和 [Effect v4 迁移指南](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)

Effect v4 可以表示该协议：

- `Deferred` 可以表示一次性绘制屏障；
- Fiber 可以表达结构化并发与中断；
- `Scope` 可以把 Finalizer 附到会话生命周期；
- `Effect.yieldNow` 可以让出给其他 Effect Fiber。

来源：[Effect 核心模型与 `yieldNow`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts)、[Effect `Deferred`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Deferred.ts)和 [Effect `Scope`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Scope.ts)

它不会改善本实现：

1. `Effect.yieldNow` 让出给 Effect 运行时，不是专门让出给 Pi 已调度的 `process.nextTick` 渲染或终端传输。仍需要宿主调度原语。
2. `Deferred` 只会替换一个原生 Promise，不会增加第二等待方、背压或可复用协调行为。
3. Fiber 中断无法停止不透明 Magic Context 处理器；其工厂既不暴露中止信号，也不暴露处置器。
4. Effect Fiber 不会把同步 JavaScript 移到另一 CPU 线程。Worker 集成仍有上述状态传输问题。
5. Pi Stuff 当前没有 Effect 依赖。为一个有界排序操作增加预发布 Effect 运行时，会增加依赖、调度器、归档验证与迁移成本，却不改变核心宿主原语。

因此 Effect v4 技术可行，但本修复在架构上拒绝。绘制屏障接口有意与 Effect 无关。未来套件级 Effect 采用可以在 v4 稳定后实现同一接口，但前提是多项能力模块都需要对实际可中断操作共享结构化取消和资源作用域。

## 选项

| 选项 | 变更 | 用户可见结果 | 成本与风险 | 决策 |
| --- | --- | --- | --- | --- |
| 宿主原生输入渲染屏障 | 对直接交互输入，在 Context 转换前让出一次 `setImmediate` | Pi 现有立即输入渲染在同步 Context 工作前运行 | 无额外渲染、无固定 sleep、无跨能力 TUI 访问 | **采用** |
| 强制调度渲染 | 让出前调用 `requestRender(true)` | Context 前渲染提交状态 | 重置 TUI 渲染缓存，可能强制全量文档/屏幕重绘 | 拒绝 |
| 直接同步渲染 | Context 通过新握手调用 `tui.renderNow()` | 同步生成终端输出 | 绕过调度，存在重入跨能力渲染风险 | 除非调度屏障无法通过 PTY 验收，否则拒绝 |
| 固定一帧 sleep | 请求渲染、等待约 17 ms，再运行 Context | 通常允许一帧绘制 | 启发式延迟，无实际重绘保证 | 除非前两项失败，否则不作为最终设计 |
| 会话启动时预热 | 首次输入前运行等价 Context 工作 | 预热保持有效时首次提交更快 | 把同一延迟移到恢复，缺少安全上游 API，可能重复有状态工作 | 拒绝 |
| Context 完成前运行 Provider | 不等待 Context | Provider 更早开始 | Provider 消息错误，违反 Pi Context 约定 | 拒绝 |
| 在 Worker 运行完整处理器 | 在另一线程重建 Context | 理论上的真实 CPU 并发 | 需要序列化宿主状态并复制/同步 Magic Context 与 SQLite 状态 | 在仅 Pi Stuff 范围内拒绝 |
| 用周期让出拆分 Magic Context | 修改其循环，在块间让出 | 转换期间 UI 响应 | 需要上游/分叉变化和谨慎状态机工作 | 超出范围 |
| Effect v4 绘制管线 | 用 Fiber 与 `Deferred` 建模同一屏障 | 与原生 Promise 相同 | 增加预发布运行时，仍需同一宿主调度原语 | 本修复拒绝 |

## 历史建议

不要把当前固定 17 ms 实验当成最终方案。

实现更小且更强的仅 Pi Stuff 边界：

1. 交互输入标记一个合并待渲染标志，不等待或请求另一渲染。
2. Pi TUI 调度普通立即键盘输入渲染。
3. Context 处理器消费标记，让出一个宿主事件循环轮次，再启动未变化 Magic Context 处理器。
4. 真实 tmux PTY 测试在 Magic Context 转换计时标记出现后立即用 `SIGSTOP` 暂停 Pi，证明已提交文字已经离开编辑器，再用 `SIGCONT` 恢复 Pi。

该路径不保留固定 sleep、额外渲染请求、直接 `renderNow()` 调用、Worker、第二调度器或 Effect 运行时。

这会在不改变任一上游项目的情况下修复感知提交冻结，但**不会**缩短 Provider 启动时间：Pi 必须等待转换后的消息。减少计算时间本身需要上游增量/预热 API 或修改 Magic Context，Pi Stuff 无法用小包装器安全模拟。

## 历史验收标准

- 在真实 tmux PTY 捕获中，直接交互编辑器在 Context 转换开始前清空。
- RPC 和扩展发起输入不获得人工绘制等待。
- Context 处理器仍恰好运行一次，并在 Provider 调用前等待完成。
- 不通过把 Context 工作移到启动而增加恢复时间。
- 最终路径没有固定时长 sleep。
- Context 没有直接 `TUI` 引用，也不发出渲染请求。
- 普通提交不发送软件包渲染请求；Pi 只执行原生键盘输入绘制。
- 快速交互输入合并为一个待处理标记，每个 Context 事件至多消费一次。
- 会话关闭/重载不能把待处理标记留在旧 Context 运行时代际。
- 聚焦测试验证顺序，现有快速仓库检查通过。
