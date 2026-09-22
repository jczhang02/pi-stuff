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

Row one is only repository identity: a bold full directory and a parenthesized Git group. Ordinary Git counters are neutral; only conflicts use an error color. Row two has three primary groups: model/effort, context and cache hit. Two spaces separate groups; within each group there is one space. There is no right alignment or viewport-filling padding.

The previous always-visible input/output totals, cache-read/write counters, subscription cost estimate, provider and auto-compaction indicator were removed from this layout study. They competed with the three primary signals. Extra width no longer brings them back. This prototype adds no hidden details panel or new shortcut; native Pi behavior outside the footer is unchanged.

Goal and quota remain one secondary group on row two in the extended scenarios. The entire group yields before primary information and is suppressed when Git spans both rows. Secondary groups disappear in priority order, without smaller fields filling the gaps. Context capacity is retained only when the complete primary row fits; at 50 columns the ordinary sample still retains model/effort, the fixed ten-character continuous meter and hit.

Git samples distinguish `clean`, `+1` staged, `~1` modified, `?1` untracked, `!1` conflicted, `↑2` ahead and `↓1` behind. Zero counts are omitted. These are file counts and commit divergence, not line-change counts. The fixtures do not cover every Git operation, such as rebase or detached HEAD.

When the full Git group exceeds row one, counters move to row two before runtime groups. If directory and branch cannot fit together, row one holds the directory/counters and row two starts with the full branch. All tested 50–150-column cases retain full sample identities and every nonzero Git counter. Physically oversized individual names use an ellipsis; the prototype does not add a third row or an overflow count.

中文: 第一行只放仓库身份: 加粗完整目录和括号内的 Git 组. 普通 Git 计数统一中性色, 只有冲突使用错误色. 第二行以模型/强度、ctx、cache hit 三组为主. 组间两个空格, 组内一个空格, 不右对齐或填满终端宽度.

中文: 取消常驻 input/output 总量、缓存读写明细、订阅费用估算、provider 和 auto 标记, 避免它们与主要信息争夺注意力. 宽屏不会再把这些字段加回来. 原型不新增详情面板或快捷键, footer 之外仍使用原生 Pi 行为. 扩展场景中的 goal/额度合为第二行的一个次要组, 比主要信息更早整组隐藏; Git 占两行时不显示扩展组. 按优先级删除整组, 不用小字段填空. ctx 容量只在主要信息全部放得下时显示; 普通 50 列仍保留模型/强度、固定十字符连续进度条和 hit.

中文: Git 中 `clean` 表示干净, `+1` 暂存、`~1` 修改、`?1` 未跟踪、`!1` 冲突、`↑2` 领先、`↓1` 落后. 零值省略, 数值分别是文件数和提交数, 不是代码行数. 样例不覆盖 rebase、detached HEAD 等所有 Git 操作. Git 组放不下第一行时, 计数移至第二行运行信息之前. 目录和分支也放不下时, 第一行保留目录/计数, 第二行以完整分支开头. 测试的 50–150 列内保留完整样例身份与所有非零计数; 名称本身超过物理空间才显示省略号, 不加第三行或溢出计数.

## Evidence and limits

The PNGs are actual headless Terminal Control captures at 150/100/80/50 columns and 16 rows, in Latte and Mocha, using `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. They show the complete terminal viewport, not a cropped mockup or native Ghostty/compositor capture.

![Light, extended, 150 columns](captures/catppuccin-latte-extended-150.png)
![Dark, long directory and branch, 50 columns](captures/catppuccin-mocha-long-50.png)

The one-shot driver covers each theme/scenario at 150 → 100 → 80 → 50 → 150, then editing, submit, cancellation and resubmit. Assertions check two rows, full sample identities and Git states at every width, continuous meter and hit when space allows, bounded group spacing, whole extension groups, absence of removed details and restoration. See [verification.txt](captures/verification.txt).

```sh
PI_TEST_HOST=/opt/bin/pi bun prototypes/statusline/capture.ts /tmp/pi-statusline-captures
bun run check
git diff --check
```

Environment: Bun 1.4.0, compiled Pi 0.87.1, Terminal Control 1.2.1, repository API declarations at Pi 0.85.1. Temporary settings/sessions are cleaned up. The local provider and all displayed directory/Git/account/usage data are deterministic samples; no Git status, account quota, real model request or check command is executed. The native editor, message rendering, streaming, cancellation and resize are real Pi behavior. The provider uses Pi's [documented extension API](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/custom-provider.md).

中文: PNG 来自真实无头 Terminal Control, 包含完整 16 行终端视口, 覆盖明暗主题和 150/100/80/50 列, 字体栈见上. 它们不是裁剪的设计图或原生 Ghostty/合成器截图. 一次性驱动验证各场景的缩窄与恢复、编辑、提交、取消和再次提交, 检查双行、完整目录/分支/Git 计数、可容纳时的连续进度条/hit、有限组间距、扩展组整体显隐、无已移除明细及恢复结果. 复现命令及版本见上. 临时设置/会话会清理. 所有目录、Git、账号与用量均为确定样例, 不查询真实状态、不调用模型或检查命令; 编辑器、消息、流式输出、取消和缩放使用原生 Pi.

## Tracking

Issue [#110](https://github.com/jczhang02/pi-stuff/issues/110), draft PR [#111](https://github.com/jczhang02/pi-stuff/pull/111), Beads `pi-stuff-dmo`. Owner: `codex:01a0c7d6-a1a0-76d2-9995-08ea5fa365b3`. Baseline: `bb03c4e98874bbd6b0ee09c1e79ddb30e8319e31`. Production adoption and merging require a separate decision.

中文: 关联任务、草稿 PR、负责人和基线见上. 正式接入与合并另行决定.
