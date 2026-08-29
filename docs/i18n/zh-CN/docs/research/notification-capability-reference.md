<!-- translation-source: docs/research/notification-capability-reference.md; translation-source-sha256: 0bd2f188eb6e79fdbffd450ceceb0ac6c1cc201672418952b1fb5dc4d1555aa4 -->

# Notification Capability 参考

**审计日期：**2026-08-13
**认证 Host：**Pi 0.84.1，commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`，Linux x64
**比较基线：**Claude Code 2.1.229 和 OpenAI Codex `rust-v0.147.0`
**决策：**实现一个内部 Pi Stuff Notification Capability；不采用已有的 notification Package

## 决策

Pi Stuff 应在现有 `@jczhang02/pi-stuff` Package 中实现一个内部 Capability Module。该 Capability 应在用户启动的 Agent 工作真正稳定时通知一次，区分最终失败和成功完成，默认对 abort 保持静默，并在用户已经恢复与终端交互时抑制提醒。

决定性的 Host event 是 **`agent_settled`**，而不是 `agent_end`。

Pi 的 Agent loop 会在每次 Agent run 停止时发出 `agent_end`。coding-agent session 随后可能执行自动 retry、compact context，或因为 `agent_end` handler 排队了另一条消息而继续。只有所有这些 post-run work 结束后，session 才会发出 `agent_settled`。认证 Host 的 [`AgentSession._runAgentPrompt()` 和 `_handlePostAgentRun()`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts) 以及公开的 [`AgentSettledEvent`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts) 都明确说明了这一点。

使用 `agent_end` 作为面向用户的完成边界，会因此允许在 retry、compaction、Goal continuations，以及另一个 Capability 排队的消息期间产生过早或重复的提醒。Pi 自己的最小 [notification example](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/examples/extensions/notify.ts) 仍监听 `agent_end`；它展示的是 OSC delivery，而不是 Suite 所需的更强 settled-work contract。

## 必需的用户可见 contract

### 结果

该 Capability 从第一个 `agent_start` 起，直到匹配的 `agent_settled` 为止，拥有一个 work cycle，即使该 cycle 包含多个内部 Agent runs。

在 settlement 时，它会分类最新 finalized Assistant message：

- `stopReason === "aborted"`：默认不通知；
- `stopReason === "error"` 或非空 `errorMessage`：发送 failure notification；
- 其他所有 settled final response：发送 completion notification。

这有意不要求 `stopReason === "stop"` 才算成功。以 Tool 结束的 response 可以使用其他非错误 stop reason，而 automatic retry 成功后，中间 provider errors 不能继续保持 sticky。Reducer 应在整个 work cycle 中保留最新 finalized Assistant message，并在之后成功的 message 到来后丢弃过时的 error state。

默认情况下，notification body 只应包含有界的 project/session label 和 elapsed time。不得引用任意 model output、commands、paths、credentials 或 Tool input。以后添加的任何用户可配置 preview 都必须有边界并清理 control characters。

### 活动抑制

选定的默认值是：

- 最短工作时长：**10 秒**；
- settlement 后宽限期：**2 秒**；
- 在该宽限期内出现 new input event、任何 terminal input、新 Agent run、session replacement/reload 或 shutdown 时取消。

Grace timer 必须 unreferenced，且不得阻止 Pi 退出。启动后续 work cycle 会使早期 cycle 的 pending notification 失效。一个 cycle 最多产生一个外部提醒。

Pi 0.84.1 暴露 [`ExtensionContext.hasUI`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts) 和 terminal-input observation，但没有向 Extensions 暴露 Host 的 terminal focus state。因此 Pi Stuff 可以提供 **recent-activity suppression**，但无法像 Codex 那样证明 terminal 处于 unfocused 状态。产品文案和 settings 不得声称“仅在 unfocused 时通知”。

### Delivery

默认模式只使用 terminal-native delivery，从不 spawn external process：

1. 检测到 Kitty 时使用 Kitty OSC 99；
2. 检测到 Ghostty 时使用 Ghostty OSC 777，包括在 tmux 中通过其 inherited resource marker 检测到的情况；
3. 检测到 iTerm2 或 WezTerm 时使用 OSC 9。

未知 terminal 在 `auto` 中保持 unsupported；Kitty、OSC 9、OSC 777 和 BEL 是显式 delivery choices。

所有 title 和 body fields 在编码前都必须移除 ESC、BEL、C0/C1 controls 以及 protocol delimiters。只有在 `ctx.mode === "tui"` 且 `ctx.hasUI` 为 true 时才可发出 output。RPC 可能暴露 `hasUI === true` 的 UI request facade，因此单独的 `hasUI` 不是 interactive-terminal boundary。在 RPC、print、SDK/headless 和其他非交互模式中，Capability 必须保持静默，以免破坏 stdout 或 JSON protocol。

诸如 `osascript`、`notify-send`、PowerShell 或用户脚本等 system utilities 属于独立的、明确 opt-in 的 transport。它们绝不能在 import、initialization 或 `session_start` 期间运行；调用必须有边界、与 Agent lifecycle 分离，并且失败时静默降级，或降级为 Diagnostic Record，而不能导致 work settlement 失败。在安全性和跨平台 contract 完整之前，第一版可以省略 external-command transport。

可选的 terminal attention 称为 `terminalBell`，因为它发出 BEL，而不是可控制的 notification sound。BEL 在同时也是选定 delivery transport 时不得重复发出。

### Settings 和 UI authority

Settings 应属于专用的原生 `/notifications` SettingsList Command Dialog，而不是共享的 `/ui` surface。Settings 包括：

- notifications：on/off；
- completion alerts：on/off；
- failure alerts：on/off；
- minimum runtime；
- settlement grace period；
- terminal delivery mode；
- opt-in、有限长度的 final-response preview，默认禁用，以保护 desktop-history privacy；
- 可选的 terminal BEL behavior。

Dialog 的有界 `T` shortcut 用于测试选定 transport，不得创建 settings 或改变 Host state。

Capability 不得添加 statusline field、footer counter、permanent dashboard、transcript message 或重复的 permission state。Permission alerts 仍归 Permission Capability 所有，该 Capability 最终应发布一个权威的 Suite event，而不是从 Tool 或 Agent state 推断。

## 比较证据

### Pi 0.84.1

认证源代码确立了四个相关事实：

1. Agent loop 可以在 error、abort、explicit stop-after-turn decision 或 ordinary exhaustion 后发出 `agent_end`（[`agent-loop.ts`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent-loop.ts)）。
2. Agent event listeners 会被 await，且直到 `agent_end` listeners settle 后，Agent 才变为空闲（[`agent.ts`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/agent/src/agent.ts)）。
3. coding-agent session 在一次 Agent run 后执行 retry、compaction 和 queued continuation，然后在外层 `finally` path 中发出一次 `agent_settled`（[`agent-session.ts`](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/agent-session.ts)）。
4. `agent_settled` 是公开 Extension event，公开 RPC client 使用它作为 wait-for-settlement boundary（[Extension types](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/extensions/types.ts)，[RPC client](https://github.com/earendil-works/pi/blob/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/modes/rpc/rpc-client.ts)）。

`agent_settled` handler 本身会在 session resolve 其 idle waiter 之前被 await。因此实现应安排一个短的、unreferenced grace timer，并立即返回，而不要让 settlement 阻塞在 notification delivery 上。

### Claude Code 2.1.229

Claude Code 将终端内状态与外部 attention 分离。官方文档暴露了 `preferredNotifChannel` setting 和 terminal methods，以及用于自定义副作用的 Notification hooks（[terminal notifications](https://code.claude.com/docs/en/terminal-config#get-a-terminal-bell-or-notification)、[settings](https://code.claude.com/docs/en/settings)、[Notification hooks](https://code.claude.com/docs/en/hooks#notification)）。

已检查作为正式发布版本的 first-party 2.1.229 Linux x64 package。其 npm wrapper 标识为 `@anthropic-ai/claude-code@2.1.229`；本次审计观察到的 native archive SHA-256 为 `3504bb10af2adf351930b5ff5b90f7514fa52d9c1a6ebbf14464b72ad4f547f6`。已发布的 dispatcher 会根据 configured/auto mode 选择 iTerm2、Kitty、Ghostty 或 BEL，否则不允许 no-method delivery。前台 UI 仅在配置的 idle threshold 之后安排 `idle_prompt` alert。Delivery 前，它会重新检查 Claude 不再 loading，且后续 user activity 没有取代该 alert。后台 session transitions 使用独立的 `agent_completed` 和 `agent_needs_input` notification types。

Pi Stuff 不应复刻 Claude Code 的私有 implementation names。它应针对值得 attention 的 settled 或 blocked states 发出通知，将普通的“waiting”提醒延迟足够长以避免噪音，并将 external notifications 与终端内 transcript 和 live work surfaces 分离。

### OpenAI Codex `rust-v0.147.0`

Codex 拥有比 Pi Extensions 更强的 focus seam。其 TUI 从 terminal events 跟踪 terminal focus，默认将 notification condition 设为 `unfocused`；也提供 `always` condition（[`tui.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/tui/src/tui.rs)、[`types.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/config/src/types.rs)）。

TUI 按 priority 合并 pending alerts，并支持 `agent-turn-complete`、`approval-requested` 和 `plan-mode-prompt` categories（[`chatwidget/notifications.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/tui/src/chatwidget/notifications.rs)）。Delivery 使用其 terminal notification abstraction，包括 OSC 9 和 BEL backends（[notification module](https://github.com/openai/codex/tree/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/tui/src/notifications)）。

Codex 还保留 legacy external `notify` command。其 payload 是历史上的 `agent-turn-complete` JSON shape，并通过 hook runtime 接入，不是同一个受 focus gating 的 TUI path（[`legacy_notify.rs`](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/hooks/src/legacy_notify.rs)、[configuration](https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core/src/config/mod.rs)）。Pi Stuff 不应将 external command hook 描述为等同于 focus-aware terminal alert。

### Pi notification Packages

检查的是精确的 npm archives，而不是依赖 package summaries：

| Package | Observed archive SHA-256 | Useful behavior | Why Pi Stuff should not adopt it |
| --- | --- | --- | --- |
| [`pi-notify@1.4.0`](https://registry.npmjs.org/pi-notify/1.4.0) | `7c6022211158ff088a6c9ba666c77263bacf68636e61718df5e991740fa87da5` | Small OSC transport selector | 监听 `agent_end`；没有 settlement、outcome 或 activity contract |
| [`pi-notify-agent@0.1.2`](https://registry.npmjs.org/pi-notify-agent/0.1.2) | `7e3311e43282132603deb233be739520e7e56b0e79d78b8ed1da32f1e918eda9` | Duration threshold、success/error controls、desktop fallbacks、sound、BEL | 监听 `agent_end`；在一次 run 内保留 provider-error state，并可能在 Host continuations settle 前通知 |
| [`@pi-lab/notify@0.0.5`](https://registry.npmjs.org/@pi-lab%2Fnotify/0.0.5) | `62879f1f2f146026a876fd9fdbfe9fbd36a23e1c2c0c51d7798085a15f059ae9` | 正确监听 `agent_settled`；支持 script payload 和 permission event | 与 Pi Lab configuration 和 event conventions 耦合；依赖/产品边界比 Pi Stuff 所需更宽 |
| [`@pi-archimedes/notify@2.0.1`](https://registry.npmjs.org/@pi-archimedes/notify/2.0.1) | `83d55edba7d811f1f203d23d5a0405b7ea3f752094b6d91d346e303435107a9b` | 三十秒延迟，并在 input、terminal input 或 new run 时取消 | 从 `agent_end` 调度，依赖 Archimedes core/bus/settings，并面向 forked Pi package surface |

这些 packages 验证了若干技术：OSC selection、duration thresholds、delayed delivery、activity cancellation 和 settled event。但没有任何一个同时满足 Suite 的 Host lifecycle、UI authority、dependency、startup-purity 和 headless-output constraints。在 Pi Stuff 中，所需实现作为自有 Capability Module 会更小、更安全。

## 实现形态

Capability 应分为三个窄部分：

1. **work-cycle reducer** 消费公开的 Pi lifecycle events，并返回确定性的 state transitions 和 final outcome。它没有 I/O 或 timers。
2. **attention gate** 负责 minimum-duration 和 post-settlement timers、generation IDs、cancellation，以及 one-alert-per-cycle guarantee。
3. **transport** 清理有界内容，选择明确支持的 terminal method，并且只在 interactive UI context 中发出。

Extension adapter 只应将公开 Host events 转换到这些部分，并注册 settings/test controls。它不应检查私有 Host state、复制 Session history，或从 error strings 推断 retries。

Import 和 `session_start` 保持纯净。Session 可以注册 callbacks 并初始化内存中的 defaults，但不得写文件、spawn subprocesses、探测网络或修改 Host settings。Notification errors 是 non-fatal，不会创建 transcript output。

## 验收 gates

只有以下全部通过，implementation 才算完成：

1. Pure lifecycle matrix 覆盖 ordinary completion、Tool-ending completion、final error、abort、missing Assistant output、error followed by successful retry、retry exhaustion、auto-compaction continuation、Goal/extension-queued continuation，以及多个 `agent_end` 后跟一个 `agent_settled`。
2. Fake-clock tests 证明 10 秒 minimum、2 秒 grace period、one-alert-per-cycle behavior、stale-generation rejection，以及由 input、terminal input、new work、reload/replacement 和 shutdown 导致的 cancellation。
3. Outcome tests 证明 intermediate HTTP/provider failure 不会使 recovered cycle 失败，且 abort 默认保持静默。
4. Sanitization tests 覆盖 ESC、BEL、OSC terminators、newlines、long Unicode text、empty labels 和 terminal-protocol delimiter injection。
5. Transport tests 覆盖 Kitty、每条明确支持的 OSC path、BEL deduplication、unsupported terminals、disabled settings、write failure、`ctx.hasUI === false` 以及 `ctx.hasUI === true` 的 RPC。
6. Real certified Pi RPC/Package test 证明 discovery 成功，且没有 notification bytes 进入 JSON stream。
7. Real PTY tests 证明 delayed completion 和 failure alerts、terminal input cancellation、reload/shutdown cleanup、normal 和 narrow terminal behavior，以及没有 statusline/footer/transcript duplication。
8. Import、initialization 和 `session_start` purity audits 证明没有 network、filesystem write、subprocess 或 Host-setting mutation。
9. Suite generation、focused tests、`bun run check:fast`、extracted Package seam 以及最终的 `bun run check` 均通过。

## 证据限制

本审计确立了 source semantics 和 Linux implementation direction。自动化 PTY seam 认证了一个启用 `allow-passthrough` 的 tmux path；它没有对 macOS Notification Center、Windows toast delivery、SSH 上的 desktop-bus availability 或其他每种 terminal/tmux combination 做视觉认证。这些 transports 在测试前必须保持未声明支持。Pi 当前也无法向普通 Extension 提供 Codex 等价的 focus gating，因此 recent activity 是受支持的 suppression boundary。
