<!-- translation-source: docs/reports/context-submit-concurrency-research-2026-08-14.md; translation-source-sha256: b4acc01e30c31d9606d93636ac9a49b7d74f974e773d26a7e04a484ee6562d4c -->

# Context 提交并发研究

日期：2026-08-14  
状态：历史研究

这份报告保留第一次提交延迟调查中的渲染顺序事实。事件循环屏障方案和当时对 Worker 的否定已经过时。
当前行为见 [ADR 0019](../adr/0019-isolate-context-engine-work-from-the-host-ui-thread.md) 和
[Context Management 指南](../capabilities/context-management.md)。

## 问题

Pi 能否在长时间 Context 转换开始前绘制已经提交的 Prompt？转换本身能否不再阻塞 Host UI 线程？

## 保留的发现

- Pi 先收到 Enter，随后才出现可见停顿。同步 Context 工作在提交状态送达终端前占用了 JavaScript 线程。
- Pi 会等待每个 `context` handler，再调用 Provider。提前调用 Provider 会发送错误的消息列表。
- `requestRender(force?)` 负责调度，`renderNow(force?)` 同步渲染。两者都不能确认终端模拟器已经画出像素。
- 让出一次事件循环可以让已经排队的输入渲染先运行，但不会产生 CPU 并发。
- 本次研究检查的 Magic Context 集成没有公开的分阶段或预热操作，无法把昂贵的纯计算和最终 Context
  提交分开。
- Stream drain 和 tmux 流控描述的是缓冲传输，不是屏幕已经完成绘制。

主要实现来源包括 Pi 的
[Extension runner](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts)、
[TUI](https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui.ts)、
[Magic Context handler](https://github.com/cortexkit/magic-context/blob/master/packages/pi-plugin/src/context-handler.ts)，
以及 Node 和 Bun 的事件循环文档。

## 当前处理方式

Context projection 现在由一个 Context Engine Worker 执行：

- 固定版本的 engine 和 Worker entry 被打成一个内存 Bun artifact，再从 Blob URL 启动。
- 输入、Transcript 渲染、Session、Provider request 和 Agent lifecycle 仍由 Pi 负责。
- 首次绑定或 branch 不连续时发送不可变 Session snapshot；普通 projection 只发送新的 leaf。
- Worker effect 仅限 `appendEntry`、`sendMessage`、`sendUserMessage`、`notify` 和 `setStatus`。
  `appendCompaction` 使用一次有界同步响应，而且只阻塞 Worker。
- Effect 失败、mirror 不一致或 Worker 致命错误会让当前请求回到 Pi 原生 Context。关闭时只等待一个有界
  grace period，随后终止 Worker。

Context runtime 仍可能为了输入顺序让出一次事件循环。这不是并发边界；真正把 engine 计算移出 Host UI
线程的是 Worker。

## 已放弃的中间方案

第一版实现在同步转换前等待一次 `setImmediate`。它替代了实验性的 17 ms 延迟，也没有直接调用
`renderNow()` 或强制渲染，但后续 CPU 密集型 Context 工作仍会阻塞界面。

研究还检查了提前调用 Provider、启动预热、直接渲染、固定 sleep、周期让出和 Effect v4。这些方案会破坏
Pi 的 Context 顺序、复制状态、只改变调度，或者增加一个不能把工作移出线程的 runtime。当时认为 Worker
必然需要第二套 Magic Context 集成；有界 snapshot 和 Host-effect bridge 完成后，这个结论不再成立。

## 验收边界

当前验收使用真实 Pi TUI 和长时间恢复的 Session，限制 Prompt 绘制与 Working frame 的停顿，检查 Provider
projection，并用受支持模型调用一个 Context Tool。当前契约见
[Context Management Module README](../../packages/pi-stuff/src/context-management/README.md)；这份报告不再充当实现清单。
