# Two-row statusline prototype

This throwaway prototype runs in real Pi. It explores whether two rows can preserve directory and Git information while making model/context/cache statistics easier to scan. It is retained on `codex/statusline-prototype`, outside the production package.

中文: 这个一次性原型在真实 Pi 中运行, 验证双行能否保住目录和 Git 信息, 同时让模型、上下文与缓存统计更易扫读. 保留在 `codex/statusline-prototype`, 不接入正式包.

## Run

From the prototype worktree, with the repository's pinned dependencies installed:

```sh
PI_TEST_HOST=/opt/bin/pi bun run tui run pi-statusline --host opentui -- bun prototypes/statusline/run.ts --theme catppuccin-latte --scenario extended
```

Omit `PI_TEST_HOST` to use the installed Pi 0.85.1 CLI under Bun. Choose `catppuccin-mocha` for dark mode. Scenarios: `base` has a clean branch; `extended` adds changes, goal and quota; `long` uses a full long branch, a directory containing wide characters and a conflict. Scenario selection stays outside the evaluated UI.

Use Pi's native editor, Enter to submit and Esc to cancel the two-second sample response. Successful responses advance the sample usage. Resize the foreground terminal itself: Terminal Control 1.2.1 `run` follows its outer PTY, not CLI `resize`. An already-running instance can load the revised footer through Pi's `/reload` command.

```sh
bun run tui show pi-statusline
bun run tui stop pi-statusline
```

中文: 在原型 worktree 中执行上述命令. 省略 `PI_TEST_HOST` 后使用安装的 Pi 0.85.1 CLI; 暗色主题选 `catppuccin-mocha`. `base` 是干净分支, `extended` 加入改动、goal 和额度, `long` 包含长分支、中文目录与冲突. 原生编辑器支持输入、Enter 提交、Esc 取消约两秒的样例回复. 成功回复增加统计. 缩放时调整前台终端本身; 已运行的实例可以用 `/reload` 载入修改.

## Layout and Git notation

The footer always occupies two rows. At ordinary widths, row one starts with the bold full directory, followed by the complete branch and Git counters. Goal and quota follow when space allows. Row two holds the model/effort, continuous ten-cell context meter and capacity, auto-compaction indicator, cache hit, token/cache counts and subscription cost estimate. Only the directory is bold; state colors and a context accent provide the remaining hierarchy. Fields have one normal separating space, without alignment padding.

Git samples distinguish `clean`, `+1` staged, `~1` modified, `?1` untracked, `!1` conflicted, `↑2` ahead and `↓1` behind. Zero counts are omitted. These are file counts and commit divergence, not line-change counts. The sample scenarios do not attempt to model every Git operation, such as rebase or detached HEAD.

When directory plus Git exceeds one row, the counters move before statistics on row two, preserving directory and branch together. If the two names themselves cannot share a row, the complete branch moves to row two and the directory/counters occupy row one. Goal and quota are hidden during this reflow. Optional statistics yield to these identities. Across the tested widths, even the long sample retains its entire directory, branch and every nonzero Git counter. If an individual branch exceeds the entire viewport, or the directory exceeds the space left by counters, an ellipsis marks unavoidable clipping. This is a physical limit, not a reason to hide the identity entirely.

Optional fields are selected by fit and priority, then shown in a fixed reading order. Context and hit lead statistics priority, followed by model/effort, capacity, tokens, cache read/write, auto, cost and provider. Smaller fields can occupy space that a larger higher-priority field cannot use. Goal and quota never displace directory/Git. In the long sample at 50 columns, the meter/model are hidden while the full branch and hit remain; at 80 columns, the meter returns. The ordinary 50-column sample keeps model/effort, meter and hit together, hiding capacity. No third row, details entry or overflow count is added.

中文: Footer 固定双行. 常规宽度第一行用加粗完整目录开头, 紧跟完整分支与 Git 计数, 有余地再放 goal 和额度. 第二行是模型/思考强度、十格宽的连续线条 ctx 进度条与容量、自动压缩标记、命中率、token/缓存读写和订阅估算费用. 仅目录加粗, 用状态色与 ctx 强调色建立其余层次, 字段间一个正常空格, 不用填充空白对齐.

中文: Git 中 `clean` 表示干净, `+1` 暂存、`~1` 修改、`?1` 未跟踪、`!1` 冲突、`↑2` 领先、`↓1` 落后. 零值省略, 数值分别是文件数与提交数, 不是代码行数. 样例未覆盖 rebase、detached HEAD 等所有 Git 操作状态. 目录和 Git 放不下一行时, 先把计数移至第二行的统计之前, 保留目录与分支相邻. 两个名称本身也无法同处一行时, 完整分支才移至第二行, 目录与计数留在第一行. 重排期间隐藏 goal/额度, 统计字段退让. 测试宽度下长样例的目录、分支和所有非零 Git 计数均完整保留. 单独分支超过整屏、或目录超过计数以外的空间时才用省略号截断, 不会整项消失.

中文: 可选统计按优先级和可用宽度选取, 按固定阅读顺序显示. 优先级依次为 ctx、hit、模型/强度、容量、token、缓存读写、auto、费用和 provider. 放不下的大字段不妨碍较小字段利用剩余空间. goal/额度不挤占目录/Git. 长样例在 50 列隐藏进度条和模型, 保留完整分支及 hit; 80 列恢复进度条. 普通样例在 50 列保留模型/强度、进度条和 hit, 隐藏容量. 不加第三行、详情入口或溢出计数.

## Evidence and limits

The PNGs are actual headless Terminal Control captures at 150/100/80/50 columns and 16 rows, in Latte and Mocha, using `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. They show the complete terminal viewport, not a cropped mockup or native Ghostty/compositor capture.

![Light, extended, 150 columns](captures/catppuccin-latte-extended-150.png)
![Dark, long directory and branch, 50 columns](captures/catppuccin-mocha-long-50.png)

The one-shot driver covers each theme/scenario at 150 → 100 → 80 → 50 → 150, then editing, submit, cancellation and resubmit. Assertions check two rows, full sample identities and Git states at every width, continuous meter/capacity and hit when space allows, normal spacing and restoration. See [verification.txt](captures/verification.txt).

```sh
PI_TEST_HOST=/opt/bin/pi bun prototypes/statusline/capture.ts /tmp/pi-statusline-captures
bun run check
git diff --check
```

Environment: Bun 1.4.0, compiled Pi 0.87.1, Terminal Control 1.2.1, repository API declarations at Pi 0.85.1. Temporary settings/sessions are cleaned up. The local provider and all displayed directory/Git/account/usage data are deterministic samples; no Git status, account quota, real model request or check command is executed. The native editor, message rendering, streaming, cancellation and resize are real Pi behavior. The provider uses Pi's [documented extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/custom-provider.md).

中文: PNG 来自真实无头 Terminal Control, 包含完整 16 行终端视口, 覆盖明暗主题和 150/100/80/50 列, 字体栈见上. 它们不是裁剪的设计图或原生 Ghostty/合成器截图. 一次性驱动验证各场景的缩窄与恢复、编辑、提交、取消和再次提交, 检查双行、完整目录/分支/Git 计数、可容纳时的连续进度条/容量/hit、正常空格和恢复结果. 复现命令及版本见上. 临时设置/会话会清理. 所有目录、Git、账号与用量均为确定样例, 不查询真实状态、不调用模型或检查命令; 编辑器、消息、流式输出、取消和缩放使用原生 Pi.

## Tracking

Issue [#110](https://github.com/jczhang02/pi-stuff/issues/110), draft PR [#111](https://github.com/jczhang02/pi-stuff/pull/111), Beads `pi-stuff-dmo`. Owner: `codex:01a0c7d6-a1a0-76d2-9995-08ea5fa365b3`. Baseline: `bb03c4e98874bbd6b0ee09c1e79ddb30e8319e31`. Production adoption and merging require a separate decision.

中文: 关联任务、草稿 PR、负责人和基线见上. 正式接入与合并另行决定.
